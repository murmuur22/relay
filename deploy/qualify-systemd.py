#!/usr/bin/env python3
"""Destructive fresh-host qualification ONLY on explicitly disposable hosted CI.

Never runs on an arbitrary operator host; no cleanup of existing installations.
Failure preserves closed maintenance and stops only the units created by this run.
"""
import argparse
from http.client import HTTPConnection
import importlib.util
import json
import os
from pathlib import Path
import pwd
import grp
import secrets
import sys
sys.dont_write_bytecode = True
import time
from urllib.parse import urlsplit

spec = importlib.util.spec_from_file_location('relay_install', Path(__file__).with_name('install-release.py'))
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)
run = install.run
GATE = Path('/var/lib/relay-updater-control/maintenance')


MARKER = Path('/var/lib/relay-updater/.disposable-qualification')
DISPOSABLE_ENV = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                  'RELAY_DISPOSABLE_SYSTEMD': 'I_ACCEPT_DISPOSABLE_HOST_MUTATION'}


def guard_environment(apply):
    if not apply or any(os.environ.get(k) != v for k, v in DISPOSABLE_ENV.items()):
        raise install.InstallError('Requires --apply and explicit disposable GitHub-hosted runner environment')
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise install.InstallError('Disposable Linux root execution required')


def guard(apply):
    guard_environment(apply)
    install.preflight_host()
    for tool in ('/usr/bin/systemd-run', '/usr/sbin/runuser', '/usr/bin/test'):
        install.trusted_path(tool)
    require(run(['/usr/bin/systemctl', 'show', 'relay-qualification-restore.service', '--property=LoadState', '--value']) == 'not-found',
            'Existing qualification unit refused')


def require(value, message):
    if not value:
        raise install.InstallError(message)


def http(port, path, method='GET', data=None, cookie='', csrf=''):
    conn = HTTPConnection('127.0.0.1', port, timeout=10)
    headers = {'Host': f'localhost:{port}', 'Origin': f'http://localhost:{port}',
               'Content-Type': 'application/json', 'Cookie': cookie, 'X-CSRF-Token': csrf}
    try:
        conn.request(method, path, body=json.dumps(data) if data is not None else None, headers=headers)
        response = conn.getresponse()
        raw = response.read(1024 * 1024 + 1)
        require(len(raw) <= 1024 * 1024, 'Oversized qualification HTTP response')
        return response.status, json.loads(raw), response.getheader('Set-Cookie', '').split(';')[0]
    finally:
        conn.close()


def ready(version, maintenance):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            status, body, _ = http(4190, '/health/ready')
            if status == 200 and body == dict(status='ready', version=version[1:], maintenance=maintenance):
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise install.InstallError('Real Relay readiness/version/gate check failed')


def socket_ready(path='/run/relay-updater-control/broker.sock'):
    import socket
    try:
        with socket.socket(socket.AF_UNIX) as connection:
            connection.settimeout(1)
            connection.connect(path)
        return True
    except OSError:
        return False


def wait_control():
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            if socket_ready() and http(4191, '/updater/api/auth')[0] == 200:
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise install.InstallError('Control-plane socket/web readiness failed')


def gate():
    if not GATE.exists():
        install.write_new(GATE, b'', 0o644)
    with open(GATE, 'rb') as stream:
        os.fsync(stream.fileno())
    fd = os.open(GATE.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def ungate():
    GATE.unlink()
    fd = os.open(GATE.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def authenticate(password):
    status, auth, _ = http(4190, '/api/auth')
    require(status == 200, 'Normal auth discovery failed')
    data = dict(username='admin', password=password)
    if auth['setup']:
        data['setup'] = urlsplit(Path('/var/lib/relay/setup-url.txt').read_text().strip()).fragment
    status, _, cookie = http(4190, '/api/enroll' if auth['setup'] else '/api/login', 'POST', data, csrf=auth['csrf'])
    require(status == 200 and bool(cookie), 'Normal administrator enrollment/login failed')
    status, session, _ = http(4190, '/api/session', cookie=cookie)
    require(status == 200 and session['user']['role'] == 'admin', 'Administrator session failed')
    return cookie, session['csrf']


def launch_monitor(cookie, csrf):
    status, value, _ = http(4190, '/api/updater/state', cookie=cookie)
    require(status == 200, 'Desktop read bridge failed')
    status, value, _ = http(4190, '/api/updater/launch', 'POST', {}, cookie, csrf)
    require(status == 200, 'Normal desktop launch failed')
    url = urlsplit(value['url'])
    require(url.scheme == 'http' and url.netloc == 'localhost:4191' and url.path == '/updater/', 'Unsafe launch target')
    status, _, monitor = http(4191, '/updater/api/exchange', 'POST', {'ticket': url.fragment})
    require(status == 200 and bool(monitor), 'Independent ticket exchange failed')
    status, _, _ = http(4191, '/updater/api/exchange', 'POST', {'ticket': url.fragment})
    require(status != 200, 'Launch ticket was reusable')
    return monitor


def isolation():
    relay, web = pwd.getpwnam('relay'), pwd.getpwnam('relay-updater-web')
    require(relay.pw_uid > 0 and web.pw_uid > 0 and relay.pw_uid != web.pw_uid, 'Distinct unprivileged UIDs required')
    socket_gid = grp.getgrnam('relay-updater-socket').gr_gid
    for user in (relay, web):
        require(user.pw_dir == '/nonexistent' and user.pw_shell == '/usr/sbin/nologin', 'Unexpected login/home')
        require(set(os.getgrouplist(user.pw_name, user.pw_gid)) == {user.pw_gid, socket_gid}, 'Unexpected supplementary privilege')
    for unit, expected in [('relay.service', relay.pw_uid), ('relay-updater-web.service', web.pw_uid)]:
        pid = run(['/usr/bin/systemctl', 'show', unit, '--property=MainPID', '--value'])
        status = Path('/proc/' + pid + '/status').read_text()
        fields = dict(line.split(':', 1) for line in status.splitlines() if ':' in line)
        require(all(int(v) == expected for v in fields['Uid'].split()), 'Actual process UID mismatch')
        require(fields['NoNewPrivs'].strip() == '1', 'Actual NoNewPrivileges missing')
        require(int(fields['CapEff'].strip(), 16) == 0, 'Unexpected effective capability')
    for user, denied in [('relay-updater-web', ('/var/lib/relay/accounts.json', '/etc/relay-updater/bridge.key', '/var/lib/relay-updater/journal.json')),
                         ('relay', ('/var/lib/relay-updater/journal.json',))]:
        for target in denied:
            # Test DAC outside namespace, not just a textual unit assertion.
            result = __import__('subprocess').run(['/usr/sbin/runuser', '-u', user, '--', '/usr/bin/test', '-r', target],
                                                env=install.SAFE_ENV, capture_output=True, timeout=10)
            require(result.returncode == 1, 'Service can read protected control/state')
    for target in ('/opt/relay/current', '/opt/relay-updater', '/etc/relay-updater/bridge.key'):
        install.trusted_path(target)


def restore_command(version):
    properties = ('User=root', 'Group=root', 'WorkingDirectory=/opt/relay-updater',
                  'UMask=0077', 'NoNewPrivileges=true', 'ProtectHome=true', 'ProtectSystem=strict',
                  'ReadWritePaths=/opt/relay /var/lib/relay /var/lib/relay-updater /var/lib/relay-updater-control /run/relay-updater-control',
                  'PrivateTmp=true', 'ProtectKernelTunables=true', 'ProtectKernelModules=true',
                  'ProtectControlGroups=true', 'RestrictSUIDSGID=true',
                  'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6', 'LockPersonality=true',
                  'MemoryMax=1G', 'TasksMax=64', 'LimitNOFILE=256', 'RuntimeMaxSec=180')
    return ['/usr/bin/systemd-run', '--unit=relay-qualification-restore', '--wait', '--pipe', '--collect',
            *('--property=' + value for value in properties),
            *('--setenv=' + key + '=' + value for key, value in {**DISPOSABLE_ENV, **install.SAFE_ENV}.items()),
            '/usr/bin/python3', '/opt/relay-updater/deploy/qualify-systemd.py',
            '--restore-baseline', '--version', version, '--apply']


def signed_baseline_restore(version):
    run(['/usr/bin/systemctl', 'stop', 'relay-updater-broker.service'])
    run(restore_command(version), timeout=200)
    run(['/usr/bin/systemctl', 'start', 'relay-updater-broker.service'])
    wait_control()


def restore_probe(version, apply):
    guard_environment(apply)
    install.trusted_path(MARKER)
    require(not MARKER.is_symlink() and MARKER.stat().st_mode & 0o777 == 0o600
            and MARKER.read_text() == version + '\n', 'Missing protected disposable qualification marker')
    status = Path('/proc/self/status').read_text()
    fields = dict(line.split(':', 1) for line in status.splitlines() if ':' in line)
    require(fields['NoNewPrivs'].strip() == '1', 'Recovery probe must run under hardened transient systemd service')
    # Operator-level recovery primitive, NOT a second-release install or UI rollback.
    # Checkpoint is a real stopped-state copy of the genuinely enrolled baseline.
    # Import the verified installed control plane, not mutable checkout modules.
    for name in tuple(sys.modules):
        if name == 'updater' or name.startswith('updater.'):
            del sys.modules[name]
    sys.path.insert(0, '/opt/relay-updater')
    from updater.broker.engine import Engine
    from updater.broker.driver import copy_state
    from updater.broker.auth import Denied
    engine = Engine(json.loads(Path('/etc/relay-updater/broker.json').read_text()))
    try:
        engine.gate()
        engine.driver.stop()
        release = engine.current_release()
        before = (engine.state / 'accounts.json').read_bytes()
        backup = 'qualification-baseline-checkpoint'
        copy_state(engine.state, engine.root / backup, preserve_owner=True)
        checkpoint = dict(release=release.name, version=version, backup=backup, backupComplete=True)
        # Only synthetic disposable state is changed. No code/receipt/signature substitution.
        probe = engine.state / 'qualification-transient.txt'
        probe.write_text('synthetic state created after checkpoint\n')
        engine.driver.start()
        engine.driver.ready(version)
        try:
            engine.driver.ready('v999999.0.0', timeout=1)
        except Denied:
            pass
        else:
            raise install.InstallError('Unexpected-version readiness was accepted')
        require(GATE.exists(), 'Readiness failure lost admission gate')
        engine.restore(checkpoint)
        require(not probe.exists() and (engine.state / 'accounts.json').read_bytes() == before,
                'Matching-state baseline restoration failed')
        require(engine.current_release() == release and not GATE.exists(), 'Baseline recovery did not restore readiness/admission')
    finally:
        engine.close()


def qualify(args):
    guard(args.apply)
    installed = False
    try:
        with install.prepare(args) as (work, manifest):
            installed = True  # own any partial installer mutations after preflight
            install.apply_install(work, manifest, args.version)
        install.write_new(MARKER, args.version + '\n')
        # Start runtime under the persistent gate; never enable on boot in qualification.
        run(['/usr/bin/systemctl', 'start', *install.UNITS])
        wait_control()
        ready(args.version, True)
        require(http(4190, '/api/auth')[0] == 503, 'Initial maintenance admission open')
        ungate()
        # Broker cached the initial closed-gate reason; restart only after readiness validation.
        run(['/usr/bin/systemctl', 'restart', 'relay-updater-broker.service'])
        wait_control()
        ready(args.version, False)
        password = secrets.token_urlsafe(40)
        cookie, csrf = authenticate(password)
        isolation()
        monitor = launch_monitor(cookie, csrf)
        require(http(4191, '/updater/api/state', cookie=monitor)[0] == 200, 'Monitoring failed')
        gate()
        run(['/usr/bin/systemctl', 'restart', 'relay-updater-broker.service', 'relay.service'])
        wait_control()
        ready(args.version, True)
        require(http(4190, '/api/auth')[0] == 503 and GATE.exists(), 'Restart lost durable admission gate')
        require(http(4191, '/updater/api/state', cookie=monitor)[0] == 200, 'Broker restart lost monitoring capability')
        run(['/usr/bin/systemctl', 'stop', 'relay.service'])
        require(http(4191, '/updater/api/state', cookie=monitor)[0] == 200, 'Independent monitoring failed during stop')
        run(['/usr/bin/systemctl', 'start', 'relay.service'])
        ready(args.version, True)
        signed_baseline_restore(args.version)
        ready(args.version, False)
        cookie, csrf = authenticate(password)
        require(http(4190, '/api/updater/state', cookie=cookie)[0] == 200, 'Read bridge failed after recovery')
        result = dict(passed=True, version=args.version,
                      evidence=['official-attested-initial-enrollment', 'systemd-distinct-uids-no-new-privileges',
                                'key-state-DAC-denial', 'normal-admin-auth-and-HTTP-ticket-handoff',
                                'monitoring-during-stop', 'persistent-maintenance-across-restarts',
                                'unexpected-version-readiness-rejection', 'signed-baseline-code-and-state-restore'],
                      limits=['no-second-signed-release-update', 'no-browser-rendering-or-stream-test',
                              'no-host-reboot-or-power-loss', 'not-production-deployment'])
    finally:
        if installed:
            # Do not remove accounts, state, units, receipts or diagnostic journals.
            if GATE.parent.is_dir():
                gate()
            owned_units = [unit for unit in install.UNITS if Path('/etc/systemd/system', unit).is_file()]
            if owned_units:
                run(['/usr/bin/systemctl', 'stop', *owned_units])
    print(json.dumps(result))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-dir')
    parser.add_argument('--version', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--restore-baseline', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.restore_baseline:
        restore_probe(args.version, args.apply)
    else:
        if not args.release_dir:
            parser.error('--release-dir is required')
        qualify(args)


if __name__ == '__main__':
    try:
        main()
    except install.InstallError as error:
        print('Systemd qualification refused/failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Systemd qualification FAILED or refused; no credentials emitted. Preserve gated runner state for diagnosis. No Linux qualification claimed.', file=sys.stderr)
        sys.exit(1)
