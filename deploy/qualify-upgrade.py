#!/usr/bin/env python3
"""Signed v0.4.2 -> explicit candidate -> signed rollback, DISPOSABLE HOSTS ONLY.

The checkout harness is not the control plane. It uses the unchanged installed
Engine/Broker, production verification and real HTTP consent. Never run on prod.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
sys.dont_write_bytecode = True
# The copied root-owned harness deliberately has NO checkout updater package.
# Its helper imports must resolve to the already authenticated old installation.
if Path(__file__).resolve().parent == Path('/opt/relay-qualification'):
    sys.path.insert(0, '/opt/relay-updater')

spec = importlib.util.spec_from_file_location('relay_qualification', Path(__file__).with_name('qualify-systemd.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
install = base.install
HARNESS = Path('/opt/relay-qualification')
UNIT = 'relay-qualification-upgrade.service'
UPGRADE_ENV = {**base.DISPOSABLE_ENV,
               'RELAY_DISPOSABLE_SIGNED_UPGRADE': 'I_ACCEPT_FRESH_HOST_SIGNED_UPGRADE_AND_ROLLBACK'}


def validate_versions(old, target):
    base.require(old == 'v0.4.2', 'Only the v0.4.2 old control plane is qualified')
    base.require(isinstance(target, str) and re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', target),
                 'Exact stable-form target tag required')
    base.require(tuple(map(int, target[1:].split('.'))) > (0, 4, 2), 'Target must be newer than baseline')


def guard_environment(apply, old, target):
    validate_versions(old, target)
    base.require(all(os.environ.get(k) == v for k, v in UPGRADE_ENV.items()),
                 'Explicit disposable signed-upgrade acknowledgment required')
    base.guard_environment(apply)


def select_target(engine, target):
    """Qualification-only selection; normal Releases.check still excludes prereleases.

    No verifier replacement: the installed verifier authenticates this exact tag
    here, and Engine.run_install verifies it again and checks the actual tar bytes.
    """
    import tempfile
    validate_versions('v0.4.2', target)
    base.require(engine.mode == 'production', 'Real production verifier required')
    with tempfile.TemporaryDirectory(dir=engine.work) as work:
        manifest = engine.releases.verified_manifest(target, Path(work))
    entry = dict(version=target, notes='Explicit disposable qualification target',
                 size=manifest['artifact']['size'], verified=True)
    engine.releases.entries = {target: entry}
    engine.available = [entry]
    return manifest


def mutate(action, cookie, monitor, password, **target):
    base.require(action in ('install', 'rollback'), 'Unsupported qualification action')
    status, auth, _ = base.http(4191, '/updater/api/auth', cookie=monitor)
    base.require(status == 200 and auth.get('authenticated') is True, 'Independent authentication lost')
    status, result, _ = base.http(4191, '/updater/api/' + action, 'POST',
                                  dict(confirmed=True, password=password, **target),
                                  cookie + '; ' + monitor, auth['csrf'])
    base.require(status == 200 and result.get('job', {}).get('id'), 'HTTP consent/mutation rejected')
    return result['job']['id']


def wait_job(monitor, job_id, expected, timeout=420):
    import time
    terminal = {'succeeded', 'failed', 'rolled-back', 'rollback-failed', 'cancelled', 'interrupted'}
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status, result, _ = base.http(4191, '/updater/api/state', cookie=monitor)
        base.require(status == 200, 'Independent monitoring failed during upgrade')
        job = result.get('job') or {}
        base.require(job.get('id') == job_id, 'Unexpected qualification job')
        if job.get('phase') in terminal:
            base.require(job['phase'] == expected and job.get('outcome') == expected,
                         'Signed qualification job did not reach expected outcome')
            return result
        time.sleep(0.5)
    raise install.InstallError('Signed qualification job timed out')


def worker_command(old, target, private_lan):
    # Reuse the broker-equivalent hardening, but execute this separately owned
    # harness, NEVER replace a file in the signed old control-plane tree.
    command = base.restore_command(old)
    stop = command.index('/usr/bin/python3')
    command = [v.replace('--unit=relay-qualification-restore', '--unit=relay-qualification-upgrade')
               .replace('--property=RuntimeMaxSec=180', '--property=RuntimeMaxSec=900')
               for v in command[:stop]]
    return [*command, *('--setenv=' + k + '=' + v for k, v in UPGRADE_ENV.items()),
            '/usr/bin/python3', str(HARNESS / 'qualify-upgrade.py'), '--installed-worker',
            '--upgrade-from', old, '--version', target, '--apply',
            *(['--private-lan', private_lan] if private_lan else [])]


def fingerprint(root):
    """Private in-memory comparison; never print state/key hashes or contents."""
    import hashlib
    import stat
    root = Path(root)
    result = {}
    def visit(path):
        info = path.lstat()
        base.require(not stat.S_ISLNK(info.st_mode) and (stat.S_ISDIR(info.st_mode) or
                     (stat.S_ISREG(info.st_mode) and info.st_nlink == 1)), 'Unsafe qualification tree')
        digest = None
        if stat.S_ISREG(info.st_mode):
            h = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(65536), b''):
                    h.update(chunk)
            digest = h.hexdigest()
        result[str(path.relative_to(root))] = (info.st_mode, info.st_uid, info.st_gid, digest)
        if stat.S_ISDIR(info.st_mode):
            for child in sorted(path.iterdir()):
                visit(child)
    visit(root)
    return result


def load_installed():
    """Resolve every updater import from the authenticated v0.4.2 installation."""
    root = Path('/opt/relay-updater')
    install.trusted_path(root)
    base.require(json.loads((root / 'package.json').read_text())['version'] == '0.4.2',
                 'Not the old v0.4.2 control plane')
    for name in tuple(sys.modules):
        if name == 'updater' or name.startswith('updater.'):
            del sys.modules[name]
    sys.path.insert(0, str(root))
    from updater.broker.engine import Engine
    from updater.broker.server import Broker
    for name, module in tuple(sys.modules.items()):
        if name.startswith('updater.') and getattr(module, '__file__', None):
            base.require(root in Path(module.__file__).resolve().parents, 'Checkout updater import refused')
    return Engine, Broker


def installed_worker(apply, old, target, private_lan):
    import secrets
    import threading
    guard_environment(apply, old, target)
    install.trusted_path(HARNESS / 'marker.json')
    marker = HARNESS / 'marker.json'
    base.require(marker.stat().st_mode & 0o777 == 0o600 and
                 json.loads(marker.read_text()) == dict(old=old, target=target, privateLan=private_lan),
                 'Missing matching fresh-host qualification marker')
    fields = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    base.require(fields['NoNewPrivs'].strip() == '1', 'Worker requires hardened systemd execution')
    base.NETWORK = install.deployment_network(private_lan)
    protected = [Path('/opt/relay-updater'), Path('/etc/relay-updater'),
                 *(Path('/etc/systemd/system') / u for u in install.UNITS)]
    before = {str(p): fingerprint(p) for p in protected}
    Engine, Broker = load_installed()
    engine = Engine(json.loads(Path('/etc/relay-updater/broker.json').read_text()))
    broker = thread = None
    try:
        base.require(engine.mode == 'production' and engine.data['currentVersion'] == old and
                     engine.data['job'] is None and not engine.maintenance.exists(), 'Fresh signed baseline required')
        manifest = select_target(engine, target)
        broker = Broker(engine)
        thread = threading.Thread(target=broker.serve_forever, kwargs={'poll_interval': 0.1}, daemon=True)
        thread.start()
        base.wait_control()
        base.ready(old, False)
        password = secrets.token_urlsafe(40)
        cookie, csrf = base.authenticate(password)
        base.isolation()
        status, _, _ = base.http(4180, '/api/onboarding/complete', 'POST', {}, cookie, csrf)
        base.require(status == 200, 'Synthetic onboarding state failed')
        status, folder, _ = base.http(4180, '/api/desktop/folders', 'POST',
                                    dict(label='Signed upgrade baseline', parentId=None), cookie, csrf)
        base.require(status == 200 and folder.get('itemId'), 'Synthetic personal desktop state failed')
        state_paths = [Path('/var/lib/relay/accounts.json'), Path('/var/lib/relay/users')]
        state_before = {str(p): fingerprint(p) for p in state_paths}
        root_inode = Path('/var/lib/relay').stat().st_ino
        baseline_release = engine.current_release()
        monitor = base.launch_monitor(cookie, csrf)
        job = mutate('install', cookie, monitor, password, version=target)
        result = wait_job(monitor, job, 'succeeded')
        base.require(result['currentVersion'] == target, 'Target current version mismatch')
        engine.thread.join(30)
        base.require(not engine.thread.is_alive(), 'Install cleanup did not finish')
        base.ready(target, False)
        receipt = json.loads((engine.current_release() / '.relay-verified.json').read_text())
        base.require(receipt == dict(mode='production', version=target, sha256=manifest['artifact']['sha256']),
                     'Genuine engine receipt differs from verified target')
        base.require({str(p): fingerprint(p) for p in state_paths} == state_before, 'Upgrade changed baseline state')
        base.require({str(p): fingerprint(p) for p in protected} == before, 'Upgrade changed independent control plane/config/units')
        # Sessions must expire after the real restart. Reauthenticate normally.
        base.require(base.http(4180, '/api/session', cookie=cookie)[0] == 401, 'Old Relay session survived restart')
        cookie, csrf = base.authenticate(password)
        status, _, _ = base.http(4180, '/api/desktop/folders', 'POST',
                                 dict(label='After upgrade; must disappear on rollback', parentId=None), cookie, csrf)
        base.require(status == 200, 'Post-upgrade synthetic state mutation failed')
        base.require({str(p): fingerprint(p) for p in state_paths} != state_before, 'Rollback test lacks changed state')
        job = mutate('rollback', cookie, monitor, password)
        result = wait_job(monitor, job, 'rolled-back')
        engine.thread.join(30)
        base.require(not engine.thread.is_alive() and result['currentVersion'] == old, 'Rollback incomplete')
        base.ready(old, False)
        base.require(engine.current_release() == baseline_release, 'Rollback selected wrong signed baseline')
        base.require({str(p): fingerprint(p) for p in state_paths} == state_before, 'Rollback did not restore matching state')
        base.require(Path('/var/lib/relay').stat().st_ino == root_inode, 'Mounted state root replaced')
        base.authenticate(password)
        base.require({str(p): fingerprint(p) for p in protected} == before, 'Rollback changed independent control plane/config/units')
        return dict(passed=True, upgradeFrom=old, target=target, controlPlane='v0.4.2',
                    relayOrigin=base.NETWORK['relayOrigin'], updaterOrigin=base.NETWORK['uiOrigin'],
                    evidence=['official-signed-baseline', 'old-installed-engine-and-web',
                              'explicit-target-genuine-attestation-and-payload-verification',
                              'HTTP-password-consent-install-and-rollback', 'accounts-and-personal-desktop-preserved',
                              'matching-state-signed-rollback', 'control-plane-config-units-unchanged',
                              'port-4180-readiness-and-session-revocation'],
                    limits=['no-browser-click-or-rendering', 'no-production-access', 'no-power-loss-test',
                            'qualification-only-explicit-target-not-production-prerelease-discovery'])
    finally:
        if broker:
            broker.shutdown()
            thread.join(10)
            broker.server_close()
        engine.close()


def guard(apply, old, target, private_lan):
    validate_versions(old, target)
    base.require(all(os.environ.get(k) == v for k, v in UPGRADE_ENV.items()),
                 'Explicit disposable signed-upgrade acknowledgment required')
    base.guard(apply, private_lan)
    install.require_absent(HARNESS)
    for directory in ('/etc/systemd/system', '/run/systemd/system', '/usr/local/lib/systemd/system', '/usr/lib/systemd/system'):
        for suffix in ('', '.d'):
            install.require_absent(Path(directory) / (UNIT + suffix))
    base.require(install.run(['/usr/bin/systemctl', 'show', UNIT, '--property=LoadState', '--value']) == 'not-found',
                 'Existing upgrade qualification unit refused')


def qualify(args):
    guard(args.apply, args.upgrade_from, args.version, args.private_lan)
    base.NETWORK = install.deployment_network(args.private_lan)
    baseline = argparse.Namespace(release_dir=args.release_dir, version=args.upgrade_from,
                                  apply=args.apply, private_lan=args.private_lan)
    installed = False
    try:
        with install.prepare(baseline) as (work, manifest):
            installed = True  # owns partial mutations only AFTER fresh-host checks
            install.apply_install(work, manifest, args.upgrade_from, args.private_lan)
        HARNESS.mkdir(mode=0o700)
        for name in ('qualify-upgrade.py', 'qualify-systemd.py', 'install-release.py'):
            install.write_new(HARNESS / name, Path(__file__).with_name(name).read_bytes())
        install.write_new(HARNESS / 'marker.json', json.dumps(dict(old=args.upgrade_from,
                          target=args.version, privateLan=args.private_lan)))
        install.run(['/usr/bin/systemctl', 'start', *install.UNITS])
        base.wait_control()
        base.ready(args.upgrade_from, True)
        base.require(base.http(4180, '/api/auth')[0] == 503, 'Baseline admission unexpectedly open')
        # Stop original broker before opening a single Engine in the hardened
        # worker; web stays the genuinely installed v0.4.2 systemd service.
        install.run(['/usr/bin/systemctl', 'stop', 'relay-updater-broker.service'])
        base.ungate()
        result = json.loads(install.run(worker_command(args.upgrade_from, args.version, args.private_lan), timeout=960))
        base.require(result.get('passed') is True and result.get('target') == args.version and
                     result.get('upgradeFrom') == args.upgrade_from, 'Invalid qualification worker result')
    finally:
        if installed:
            if base.GATE.parent.is_dir():
                base.gate()
            if install.run(['/usr/bin/systemctl', 'show', UNIT, '--property=LoadState', '--value']) != 'not-found':
                install.run(['/usr/bin/systemctl', 'stop', UNIT])
            owned = [u for u in install.UNITS if Path('/etc/systemd/system', u).is_file()]
            if owned:
                install.run(['/usr/bin/systemctl', 'stop', *owned])
    print(json.dumps(result))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-dir', help='Four official baseline v0.4.2 assets (not candidate assets)')
    parser.add_argument('--upgrade-from', required=True)
    parser.add_argument('--version', required=True, help='Published exact candidate target tag')
    parser.add_argument('--private-lan', metavar='CANONICAL_IP')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--installed-worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.installed_worker:
        print(json.dumps(installed_worker(args.apply, args.upgrade_from, args.version, args.private_lan)))
    else:
        if not args.release_dir:
            parser.error('--release-dir is required')
        qualify(args)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not expose passwords, sessions, private state, or subprocess output.
        print('Signed upgrade qualification refused/failed. No success claimed; retain gated disposable runner diagnostics.', file=sys.stderr)
        sys.exit(1)
