#!/usr/bin/env python3
"""Fresh-host installer. Default is read-only inspection; --apply is explicit.

Run from a reviewed checkout. Release code is never imported before verification.
"""
import os
from pathlib import Path
import stat
import hashlib
import json
import re
import subprocess
import sys
sys.dont_write_bytecode = True
import pwd
import grp

DESTINATIONS = ('/opt/relay', '/opt/relay-updater', '/etc/relay-updater',
                '/var/lib/relay', '/var/lib/relay-updater',
                '/var/lib/relay-updater-control', '/run/relay-updater-control')
UNITS = ('relay.service', 'relay-updater-broker.service', 'relay-updater-web.service')


def trusted_path(path):
    path = Path(path)
    if not path.is_absolute():
        raise InstallError('Absolute prerequisite required')
    # Accept distro-owned executable symlinks but validate both chains.
    for item in (path, path.resolve(strict=True)):
        for p in (item, *item.parents):
            info = p.lstat()
            if info.st_uid != 0 or (not stat.S_ISLNK(info.st_mode) and info.st_mode & 0o022):
                raise InstallError('Prerequisite must be root-owned and not writable by others')


def host_conflicts():
    for name in ('relay', 'relay-updater-web'):
        try:
            pwd.getpwnam(name)
        except KeyError:
            pass
        else:
            raise InstallError('Existing service account refused')
    for name in ('relay', 'relay-updater-web', 'relay-updater-socket'):
        try:
            grp.getgrnam(name)
        except KeyError:
            pass
        else:
            raise InstallError('Existing service group refused')
    for name in DESTINATIONS:
        require_absent(name)
        trusted_path(Path(name).parent)
    require_absent('/var/lib/relay.updater-discard')
    trusted_path('/etc/systemd/system')
    for unit in UNITS:
        if run(['/usr/bin/systemctl', 'show', unit, '--property=LoadState', '--value']) != 'not-found':
            raise InstallError('Existing loaded/generated unit refused')
        for directory in ('/etc/systemd/system', '/run/systemd/system', '/usr/local/lib/systemd/system', '/usr/lib/systemd/system', '/lib/systemd/system'):
            # /lib may be a distro symlink; unit existence is still a conflict.
            for suffix in ('', '.d'):
                if os.path.lexists(Path(directory) / (unit + suffix)):
                    raise InstallError('Existing unit/drop-in refused')
    if os.stat('/opt').st_dev != os.stat('/var/lib').st_dev:
        raise InstallError('Install/state/control paths must share a filesystem')

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from updater.broker.releases import extract, manifest_valid
from updater.broker.driver import network_host

SAFE_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent',
            'GH_CONFIG_DIR': '/nonexistent', 'GH_PROMPT_DISABLED': '1',
            'PYTHONNOUSERSITE': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
FILES = ('relay-release.json', 'relay-release.attestation.json',
         'relay-linux-x64.tar.gz', 'relay-updater-linux-x64.tar.gz')


def run(argv, cwd=None, timeout=120, home=None):
    try:
        environment = dict(SAFE_ENV, HOME=str(home)) if home is not None else SAFE_ENV
        return subprocess.run(argv, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=timeout, check=True).stdout.decode().strip()
    except (OSError, subprocess.SubprocessError):
        # Never include command output (could contain enrollment credentials).
        raise InstallError('Required command failed: ' + Path(argv[0]).name) from None


def regular(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
        raise InstallError('Unsafe or oversized release input')


def verify_release(directory, version, gh):
    if not re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version):
        raise InstallError('Exact release tag required')
    directory = Path(directory)
    for name in FILES:
        regular(directory / name, 4 * 1024**2 if name.endswith('.json') else 1024**3)
    # Sigstore needs a writable trust cache, not an operator's GitHub login.
    # Keep all ambient credentials excluded and remove the private cache afterward.
    with tempfile.TemporaryDirectory(prefix='gh-anonymous-', dir=directory) as home:
        run([gh, 'attestation', 'verify', str(directory / FILES[0]), '--bundle',
             str(directory / FILES[1]), '--repo', 'murmuur22/relay', '--signer-workflow',
             'murmuur22/relay/.github/workflows/release.yml', '--source-ref',
             'refs/tags/' + version, '--deny-self-hosted-runners'], timeout=60, home=home)
    manifest = manifest_valid(json.loads((directory / FILES[0]).read_bytes()), version)
    for key, name in [('artifact', FILES[2]), ('updaterArtifact', FILES[3])]:
        value = manifest.get(key)
        if not isinstance(value, dict) or value.get('name') != name or type(value.get('size')) is not int or not 0 < value['size'] <= 1024**3 or not isinstance(value.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', value['sha256']):
            raise InstallError('Invalid artifact manifest')
        digest = hashlib.sha256()
        with (directory / name).open('rb') as stream:
            for chunk in iter(lambda: stream.read(65536), b''):
                digest.update(chunk)
        if (directory / name).stat().st_size != value['size'] or digest.hexdigest() != value['sha256']:
            raise InstallError('Release artifact digest/size mismatch')
    return manifest


class InstallError(RuntimeError):
    pass


def require_absent(path):
    path = Path(path)
    if not path.is_absolute():
        raise InstallError('Absolute destination required')
    for parent in path.parents:
        if parent.is_symlink():
            raise InstallError('Symlink destination ancestor refused')
    if os.path.lexists(path):
        raise InstallError('Existing destination refused: ' + str(path))


from contextlib import contextmanager
import argparse
import platform
import secrets
import shutil
import socket
import tempfile

UNIT_SOURCES = {'relay.service': 'deploy/relay.service',
                'relay-updater-web.service': 'updater/web/relay-updater-web.service',
                'relay-updater-broker.service': 'updater/deploy/relay-updater-broker.service'}


def write_new(path, data, mode=0o600, gid=0):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), mode)
        os.fchown(stream.fileno(), 0, gid)
        stream.write(data if isinstance(data, bytes) else data.encode())
        stream.flush()
        os.fsync(stream.fileno())


def deployment_network(private_lan=None):
    mode, host = ('loopback', 'localhost') if private_lan is None else ('private-lan', private_lan)
    try:
        bind = network_host(host, mode)
    except ValueError:
        raise InstallError('Private LAN requires a canonical RFC1918 IPv4 literal') from None
    return dict(networkMode=mode, hostname=host, bind=bind,
                relayOrigin=f'http://{host}:4190', uiOrigin=f'http://{host}:4191')


def preflight_network(private_lan=None, ports=(4190, 4191)):
    network = deployment_network(private_lan)
    if private_lan is not None:
        # Binding alone is insufficient on Linux hosts with ip_nonlocal_bind enabled.
        trusted_path('/usr/sbin/ip')
        interfaces = json.loads(run(['/usr/sbin/ip', '-j', '-4', 'address', 'show']))
        if not any(address.get('local') == private_lan for interface in interfaces for address in interface.get('addr_info', [])):
            raise InstallError('Private LAN IPv4 must be assigned to this host')
    for port in ports:
        with socket.socket() as sock:
            try:
                sock.bind((network['bind'], port))
            except OSError:
                raise InstallError('Configured interface unavailable or required port occupied') from None
    return network


def preflight_host(private_lan=None):
    deployment_network(private_lan)
    if sys.platform != 'linux' or platform.machine() != 'x86_64':
        raise InstallError('Linux x86_64 systemd host required')
    if not Path('/run/systemd/system').is_dir():
        raise InstallError('Running systemd required')
    host_conflicts()
    for tool in ('/usr/bin/node', '/usr/bin/python3', '/usr/bin/gh',
                 '/usr/bin/systemctl', '/usr/sbin/useradd', '/usr/sbin/groupadd',
                 '/usr/sbin/nologin'):
        trusted_path(tool)
    version = run(['/usr/bin/node', '--version']).removeprefix('v')
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version) or tuple(map(int, version.split('.'))) < (26, 8, 1):
        raise InstallError('Node >=26.8.1 required')
    # Validate Pillow itself as well as the interpreter; do not import user site packages.
    pillow = run(['/usr/bin/python3', '-I', '-c', 'import PIL; from PIL import Image; print(PIL.__file__)'])
    trusted_path(pillow)
    run(['/usr/bin/gh', 'attestation', 'verify', '--help'])
    preflight_network(private_lan)
    # Require room for downloaded/staged baseline plus a future state checkpoint.
    if shutil.disk_usage('/var/lib').free < 10 * 1024**3:
        raise InstallError('At least 10 GiB free required; size state backups separately')


@contextmanager
def prepare(args):
    if args.apply and os.geteuid() != 0:
        raise InstallError('--apply requires root')
    preflight_host(getattr(args, 'private_lan', None))
    # Copy external inputs to a private snapshot before checking signatures/digests.
    # No host account, unit, configuration or application state changes before verification.
    with tempfile.TemporaryDirectory(prefix='relay-verified-') as tmp:
        work = Path(tmp)
        source = Path(args.release_dir)
        if not source.is_absolute() or source.is_symlink():
            raise InstallError('Absolute non-symlink release directory required')
        for name in FILES:
            src = source / name
            regular(src, 4 * 1024**2 if name.endswith('.json') else 1024**3)
            fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as reader, (work / name).open('xb') as writer:
                info = os.fstat(reader.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise InstallError('Release input changed')
                copied = 0
                while chunk := reader.read(65536):
                    copied += len(chunk)
                    if copied > 1024**3:
                        raise InstallError('Release input grew beyond limit')
                    writer.write(chunk)
        manifest = verify_release(work, args.version, '/usr/bin/gh')
        extract(work / FILES[2], work / 'runtime')
        extract(work / FILES[3], work / 'control')
        for tree, names in [('runtime', ('server/index.mjs', 'dist/index.html',
                                        'node_modules/playwright/package.json', 'browsers',
                                        'tools/icon-normalize.py', 'updater/web/broker-client.mjs')),
                            ('control', ('updater/broker/enroll.py', 'updater/broker/server.py',
                                         'updater/web/index.mjs', 'updater/ui/dist/index.html',
                                         *UNIT_SOURCES.values()))]:
            for name in names:
                if not (work / tree / name).exists():
                    raise InstallError('Incomplete verified payload: ' + name)
            if json.loads((work / tree / 'package.json').read_text()).get('version') != args.version[1:]:
                raise InstallError('Payload package version mismatch')
        yield work, manifest


def apply_install(work, manifest, version, private_lan=None):
    network = deployment_network(private_lan)
    # Recheck immediately before first host mutation; never adopt an existing identity.
    if os.geteuid() != 0:
        raise InstallError('Root required')
    host_conflicts()
    preflight_network(private_lan)
    os.umask(0o077)
    for name in ('relay', 'relay-updater-web', 'relay-updater-socket'):
        run(['/usr/sbin/groupadd', '--system', name])
    for name in ('relay', 'relay-updater-web'):
        run(['/usr/sbin/useradd', '--system', '--gid', name, '--groups', 'relay-updater-socket',
             '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', name])
    relay = pwd.getpwnam('relay')
    for name in DESTINATIONS:
        if name == '/opt/relay-updater':
            continue
        Path(name).mkdir(mode=0o755)
        Path(name).chmod(0o700 if name in ('/var/lib/relay', '/var/lib/relay-updater') else 0o755)
    os.chown('/var/lib/relay', relay.pw_uid, relay.pw_gid)
    shutil.copytree(work / 'control', '/opt/relay-updater')
    Path('/opt/relay-updater').chmod(0o755)
    # Retain verified source manifest/bundle for operator audit, not fabricated receipts.
    for name in FILES[:2]:
        write_new('/etc/relay-updater/' + name, (work / name).read_bytes())
    write_new('/etc/relay-updater/bridge.key', secrets.token_bytes(48), 0o640, relay.pw_gid)
    config = dict(mode='production', networkMode=network['networkMode'], uiOrigin=network['uiOrigin'],
                  readinessUrl=network['relayOrigin']+'/health/ready', relayUid=relay.pw_uid,
                  socketGid=grp.getgrnam('relay-updater-socket').gr_gid,
                  installRoot='/opt/relay', stateRoot='/var/lib/relay', controlRoot='/var/lib/relay-updater',
                  maintenance='/var/lib/relay-updater-control/maintenance',
                  socketPath='/run/relay-updater-control/broker.sock',
                  bridgeKeyFile='/etc/relay-updater/bridge.key', node='/usr/bin/node',
                  python='/usr/bin/python3', gh='/usr/bin/gh')
    write_new('/etc/relay-updater/broker.json', json.dumps(config))
    web = dict(uiOrigin=config['uiOrigin'], relayOrigin=network['relayOrigin'], networkMode=network['networkMode'],
               socketPath=config['socketPath'], bind=network['bind'])
    write_new('/etc/relay-updater/web.json', json.dumps(web), 0o644)
    write_new('/etc/relay-updater/relay.env',
              'RELAY_UPDATER_SOCKET=/run/relay-updater-control/broker.sock\n'
              'RELAY_UPDATER_BRIDGE_KEY_FILE=/etc/relay-updater/bridge.key\n'
              f"RELAY_UPDATER_UI_ORIGIN={network['uiOrigin']}\n"
              f"RELAY_NETWORK_MODE={network['networkMode']}\n"
              f"RELAY_HOSTNAME={network['hostname']}\n", 0o640, relay.pw_gid)
    write_new(config['maintenance'], b'', 0o644)
    for unit, source in UNIT_SOURCES.items():
        write_new('/etc/systemd/system/' + unit, (work / 'control' / source).read_bytes(), 0o644)
    run(['/usr/bin/systemd-analyze', 'verify', *('/etc/systemd/system/' + u for u in UNITS)])
    run(['/usr/bin/systemctl', 'daemon-reload'])
    # Genuine baseline enrollment independently fetches/verifies the official release again.
    # No hand-crafted receipt and no local/fixture trust bypass.
    run(['/usr/bin/python3', '-m', 'updater.broker.enroll', '--config',
         '/etc/relay-updater/broker.json', '--version', version], cwd='/opt/relay-updater', timeout=360)
    receipt = json.loads(Path('/opt/relay/current/.relay-verified.json').read_text())
    if receipt != dict(mode='production', version=version, sha256=manifest['artifact']['sha256']):
        raise InstallError('Enrolled baseline differs from inspected signed release; maintenance stays closed')
    print('Verified baseline enrolled. Services remain stopped/disabled; maintenance remains CLOSED.')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-dir', required=True, help='Absolute directory containing the four public release assets')
    parser.add_argument('--version', required=True, help='Exact vMAJOR.MINOR.PATCH tag, including public prereleases using that tag')
    parser.add_argument('--apply', action='store_true', help='Create dedicated accounts, paths, config and units, enroll verified baseline; do not start services')
    parser.add_argument('--private-lan', metavar='CANONICAL_IP', help='Explicit trusted-network HTTP mode; exact assigned RFC1918 IPv4, no TLS')
    args = parser.parse_args(argv)
    with prepare(args) as (work, manifest):
        if args.apply:
            apply_install(work, manifest, args.version, args.private_lan)
        else:
            print('Verified fresh-host plan: create relay and relay-updater-web nonlogin accounts, dedicated socket group;')
            print('install root-owned code/config, private Relay state, three systemd units and a gated verified baseline.')
            print('No services started/enabled. No host mutations applied. Pass --apply after operator approval.')


if __name__ == '__main__':
    try:
        main()
    except InstallError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Installation refused or failed. No credentials logged. If apply began, retain partial paths and maintenance gate; inspect with the recovery guide.', file=sys.stderr)
        sys.exit(1)
