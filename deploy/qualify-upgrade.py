#!/usr/bin/env python3
"""Signed old baseline -> explicit candidate -> matching rollback, DISPOSABLE ONLY.

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


BASELINES = ('v0.4.2', 'v0.6.1', 'v0.6.2', 'v0.6.3', 'v0.6.4')
DIAGNOSTIC_CONTEXT = None


def diagnostic_monitor_failure(old, target, delivery):
    """Fixed public journal label; no exception string or private request data."""
    import subprocess
    base.require(old in ('v0.6.3', 'v0.6.4') and target == 'v0.6.5' and type(delivery) is bool,
                 'Invalid diagnostic enums')
    message = ('stage=delivery.wait_job.monitor-state status=401 exception=InstallError '
               'reason=independent-monitoring-failed old=' + old + ' target=' + target +
               ' delivery=' + str(delivery).lower() + ' file=qualify-upgrade.py function=wait_job')
    try:
        subprocess.run(['/usr/bin/logger', '--socket-errors=on', '-t',
                        'relay-qualification-diagnostic', '--', message],
                       check=False, timeout=5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        pass  # Never replace the original qualification failure.



def diagnostic_exception(error):
    """Only fixed type/file/function enums and an integer source line."""
    import subprocess
    kind = 'InstallError' if isinstance(error, install.InstallError) else 'Exception'
    function, line = 'unknown', 0
    trace = error.__traceback__
    while trace is not None:
        code = trace.tb_frame.f_code
        if (Path(code.co_filename).resolve() == Path(__file__).resolve() and
                code.co_name in ('main', 'qualify', 'installed_worker', 'wait_job', 'guard', 'guard_environment')):
            function, line = code.co_name, trace.tb_lineno
        trace = trace.tb_next
    message = ('stage=qualification.exception exception=' + kind +
               ' file=qualify-upgrade.py function=' + function + ' line=' + str(line))
    try:
        subprocess.run(['/usr/bin/logger', '--socket-errors=on', '-t',
                        'relay-qualification-diagnostic', '--', message],
                       check=False, timeout=5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        pass


def baseline_gateway_mode(old):
    base.require(old in BASELINES, 'Unqualified baseline refused')
    return {'v0.4.2': None, 'v0.6.1': 'direct', 'v0.6.2': 'reverse', 'v0.6.3': 'remote', 'v0.6.4': 'remote'}[old]


def validate_versions(old, target):
    base.require(old in BASELINES, 'Only explicit v0.4.2, v0.6.1, v0.6.2, v0.6.3 or v0.6.4 baselines are admitted')
    base.require(isinstance(target, str) and re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', target),
                 'Exact stable-form target tag required')
    base.require(tuple(map(int, target[1:].split('.'))) > tuple(map(int, old[1:].split('.'))), 'Target must be newer than baseline')


def gateway_reference(directory, reverse=False, remote=False):
    common = dict(bind='127.0.0.1', port=18444, appBaseDomain='apps.example.test',
                  targets=[dict(id='synthetic', label='Synthetic qualification', upstream='http://127.0.0.1:18445')])
    if remote:
        return dict(common, version=3, mode='reverse-proxy', desktopOrigin='https://desktop.example.test', trustedProxy='127.0.0.1',
                    backendTLS=dict(keyPath=str(directory / 'server.key'), certPath=str(directory / 'server.pem'),
                                    clientCAPath=str(directory / 'client-ca.pem'), serverName='backend.example.test', clientName='caddy.example.test'),
                    caddyTLS=dict(serverCAPath=str(directory / 'server-ca.pem'), clientCertPath=str(directory / 'client.pem'), clientKeyPath=str(directory / 'client.key')))
    if reverse:
        return dict(common, version=2, mode='reverse-proxy', desktopOrigin='https://desktop.example.test', trustedProxy='127.0.0.1')
    return dict(common, version=1, desktopHostname='desktop.example.test',
                keyPath=str(directory / 'key.pem'), certPath=str(directory / 'cert.pem'))


def make_remote_tls(directory):
    """Synthetic offline PKI in a NEW directory; no trust installation or reuse."""
    import subprocess
    directory.mkdir(mode=0o700)
    def openssl(*args):
        subprocess.run(['openssl', *args], cwd=directory, check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=30, umask=0o077)
    for ca in ('server-ca', 'client-ca'):
        openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', ca + '.key',
                '-out', ca + '.pem', '-subj', '/CN=' + ca, '-addext', 'basicConstraints=critical,CA:TRUE',
                '-addext', 'keyUsage=critical,keyCertSign,cRLSign')
    for name, dns, purpose in [('server', 'backend.example.test', 'serverAuth'), ('client', 'caddy.example.test', 'clientAuth')]:
        openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=' + dns)
        with (directory / (name + '.ext')).open('x') as stream:
            stream.write('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=' + purpose + '\nsubjectAltName=DNS:' + dns + '\n')
        openssl('x509', '-req', '-in', name + '.csr', '-CA', name + '-ca.pem', '-CAkey', name + '-ca.key',
                '-CAcreateserial', '-days', '1', '-extfile', name + '.ext', '-out', name + '.pem')
    with (directory / 'server.pem').open('ab') as stream:
        stream.write((directory / 'server-ca.pem').read_bytes())
    for path in directory.iterdir():
        path.chmod(0o600)


def apply_gateway(config, cookie, csrf, password):
    status, _, _ = base.http(4180, '/api/admin/gateway', 'PUT', dict(config=config, password=password), cookie, csrf)
    base.require(status == 200, 'Gateway mode apply failed')
    status, result, _ = base.http(4180, '/api/admin/gateway', cookie=cookie)
    base.require(status == 200 and result.get('enabled') is True and result.get('config') == config, 'Gateway mode readback failed')


def probe_gateway(reverse=False, remote=None):
    import http.client
    import ssl
    import socket
    if remote:
        context = ssl.create_default_context(cafile=str(remote / 'server-ca.pem'))
        context.load_cert_chain(str(remote / 'client.pem'), str(remote / 'client.key'))
        connection = http.client.HTTPSConnection('backend.example.test', 18444, context=context, timeout=5)
        connection.sock = context.wrap_socket(socket.create_connection(('127.0.0.1', 18444), timeout=5), server_hostname='backend.example.test')
        headers = {'Host': 'desktop.example.test', 'X-Forwarded-Host': 'desktop.example.test', 'X-Forwarded-Proto': 'https'}
    elif reverse:
        connection = http.client.HTTPConnection('127.0.0.1', 18444, timeout=5)
        headers = {'Host': 'desktop.example.test', 'X-Forwarded-Host': 'desktop.example.test', 'X-Forwarded-Proto': 'https'}
    else:
        context = ssl.create_default_context(cafile='/var/lib/relay/qualification-tls/cert.pem')
        connection = http.client.HTTPSConnection('desktop.example.test', 18444, context=context, timeout=5)
        connection.sock = context.wrap_socket(socket.create_connection(('127.0.0.1', 18444), timeout=5), server_hostname='desktop.example.test')
        headers = {'Host': 'desktop.example.test:18444'}
    try:
        connection.request('GET', '/api/auth', headers=headers)
        response = connection.getresponse()
        base.require(response.status == 200, 'Gateway actual listener probe failed')
        response.read(16384)
    finally:
        connection.close()


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
    status, auth, _ = base.http(4191, '/updater/api/auth', cookie=cookie + '; ' + monitor)
    base.require(status == 200 and auth.get('authenticated') is True, 'Independent authentication lost')
    status, result, _ = base.http(4191, '/updater/api/' + action, 'POST',
                                  dict(confirmed=True, password=password, **target),
                                  cookie + '; ' + monitor, auth['csrf'])
    base.require(status == 200 and result.get('job', {}).get('id'), 'HTTP consent/mutation rejected')
    return result['job']['id']


def wait_job(monitor, job_id, expected, timeout=420, cookie=''):
    import time
    terminal = {'succeeded', 'failed', 'rolled-back', 'rollback-failed', 'cancelled', 'interrupted'}
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status, result, _ = base.http(4191, '/updater/api/state', cookie=cookie + '; ' + monitor)
        if status == 401 and DIAGNOSTIC_CONTEXT is not None and DIAGNOSTIC_CONTEXT[2]:
            diagnostic_monitor_failure(*DIAGNOSTIC_CONTEXT)
        base.require(status == 200, 'Independent monitoring failed during upgrade')
        job = result.get('job') or {}
        base.require(job.get('id') == job_id, 'Unexpected qualification job')
        if job.get('phase') in terminal:
            base.require(job['phase'] == expected and job.get('outcome') == expected,
                         'Signed qualification job did not reach expected outcome')
            return result
        time.sleep(0.5)
    raise install.InstallError('Signed qualification job timed out')


def delivery_release(old, target):
    return old in ('v0.6.3', 'v0.6.4') and target == 'v0.6.5'


def bootstrap_helper():
    spec = importlib.util.spec_from_file_location('relay_bootstrap', Path(__file__).with_name('qualify-presentation-bootstrap.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.base.NETWORK = base.NETWORK
    return module


def retained_presentation(target, pin, fallback):
    status, index, headers = base.raw_http(4191, '/updater/')
    base.require(status == 200 and index == fallback and headers.get('x-relay-updater-presentation') == 'builtin',
                 'Rollback did not select old built-in fallback')
    for name, raw in pin.items():
        if name == 'index.html':
            continue
        status, served, _ = base.raw_http(4191, '/updater/presentation/' + target + '/' + name)
        base.require(status == 200 and served == raw, 'Pinned lazy asset lost after rollback/candidate deletion')


def worker_command(old, target, private_lan, delivery=False):
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
            *(['--delivery-worker'] if delivery else []),
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


def load_installed(old='v0.4.2'):
    """Resolve updater imports from the authenticated baseline, never the checkout."""
    root = Path('/opt/relay-updater')
    install.trusted_path(root)
    base.require(old in BASELINES and json.loads((root / 'package.json').read_text())['version'] == old[1:],
                 'Not the exact old control plane')
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


def installed_worker(apply, old, target, private_lan, delivery=False):
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
    ui_release = delivery_release(old, target)
    helper = bootstrap_helper() if ui_release else None
    if delivery:
        base.require(ui_release, 'Delivery worker is only for qualified UI-delivery release')
        marker = HARNESS / 'delivery-marker.json'
        helper.inventory(marker)
        base.require(marker.stat().st_mode & 0o777 == 0o600, 'Missing protected bootstrap completion marker')
        helper.admit_baseline(Path('/opt/relay-updater'), json.loads(marker.read_bytes()))
    protected = [Path('/opt/relay-updater'), Path('/etc/relay-updater'),
                 *(Path('/etc/systemd/system') / u for u in install.UNITS)]
    control_fingerprint = helper.inventory if helper else fingerprint
    before = {str(p): control_fingerprint(p) for p in protected}
    web_identity = base.service_identity('relay-updater-web.service')
    broker_identity = (os.getpid(), Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()[19])
    Engine, Broker = load_installed(old)
    engine = Engine(json.loads(Path('/etc/relay-updater/broker.json').read_text()))
    broker = thread = None
    try:
        starting_job = engine.data['job']
        base.require(engine.mode == 'production' and engine.data['currentVersion'] == old and
                     (starting_job is None if not delivery else starting_job and starting_job.get('phase') == 'rolled-back') and
                     not engine.maintenance.exists(), 'Fresh signed baseline/matching rollback required')
        manifest = select_target(engine, target)
        broker = Broker(engine)
        thread = threading.Thread(target=broker.serve_forever, kwargs={'poll_interval': 0.1}, daemon=True)
        thread.start()
        base.wait_control()
        base.ready(old, False)
        if ui_release:
            secret = HARNESS / 'password'
            helper.inventory(secret)
            base.require(secret.stat().st_mode & 0o777 == 0o600, 'Unprotected synthetic qualification password')
            password = secret.read_text()
        else:
            password = secrets.token_urlsafe(40)
        cookie, csrf = base.authenticate(password)
        base.isolation()
        status, _, _ = base.http(4180, '/api/onboarding/complete', 'POST', {}, cookie, csrf)
        base.require(status == 200, 'Synthetic onboarding state failed')
        status, folder, _ = base.http(4180, '/api/desktop/folders', 'POST',
                                    dict(label='Signed upgrade baseline', parentId=None), cookie, csrf)
        base.require(status == 200 and folder.get('itemId'), 'Synthetic personal desktop state failed')
        state_paths = [Path('/var/lib/relay/accounts.json'), Path('/var/lib/relay/users')]
        tls_dir = Path('/var/lib/relay/qualification-tls')
        gateway_mode = baseline_gateway_mode(old)
        backend = tls_dir / 'backend'
        if gateway_mode and not delivery:
            import pwd
            tls_dir.mkdir(mode=0o700)
            identity = pwd.getpwnam('relay')
            install.run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                         '-keyout', str(tls_dir / 'key.pem'), '-out', str(tls_dir / 'cert.pem'),
                         '-subj', '/CN=desktop.example.test', '-addext', 'subjectAltName=DNS:desktop.example.test,DNS:*.apps.example.test',
                         '-addext', 'basicConstraints=critical,CA:TRUE'])
            for path in (tls_dir, tls_dir / 'key.pem', tls_dir / 'cert.pem'):
                os.chown(path, identity.pw_uid, identity.pw_gid)
                path.chmod(0o700 if path.is_dir() else 0o600)
            if gateway_mode == 'remote':
                make_remote_tls(backend)
                for path in (backend, *backend.iterdir()):
                    os.chown(path, identity.pw_uid, identity.pw_gid)
            apply_gateway(gateway_reference(backend if gateway_mode == 'remote' else tls_dir,
                                            reverse=(gateway_mode == 'reverse'), remote=(gateway_mode == 'remote')), cookie, csrf, password)
            probe_gateway(reverse=(gateway_mode == 'reverse'), remote=backend if gateway_mode == 'remote' else None)
        if gateway_mode:
            state_paths += [Path('/var/lib/relay/gateway-managed.json'), tls_dir]
        state_before = {str(p): fingerprint(p) for p in state_paths}
        root_inode = Path('/var/lib/relay').stat().st_ino
        baseline_release = engine.current_release()
        monitor = base.launch_monitor(cookie, csrf)
        job = mutate('install', cookie, monitor, password, version=target)
        result = wait_job(monitor, job, 'succeeded', cookie=cookie)
        base.require(result['currentVersion'] == target, 'Target current version mismatch')
        engine.thread.join(30)
        base.require(not engine.thread.is_alive(), 'Install cleanup did not finish')
        base.ready(target, False)
        receipt = json.loads((engine.current_release() / '.relay-verified.json').read_text())
        base.require(receipt == dict(mode='production', version=target, sha256=manifest['artifact']['sha256']),
                     'Genuine engine receipt differs from verified target')
        base.require({str(p): fingerprint(p) for p in state_paths} == state_before, 'Upgrade changed baseline state')
        pin = None
        candidate_release = engine.current_release()
        if ui_release:
            if delivery:
                pin = base.presentation_probe(target, defer_lazy=True)
            else:
                status, index, headers = base.raw_http(4191, '/updater/')
                base.require(status == 200 and index == Path('/opt/relay-updater/updater/ui/dist/index.html').read_bytes() and
                             headers.get('x-relay-updater-presentation') != target, 'Old web unexpectedly changed with runtime')
                if old == 'v0.6.3':
                    base.require(headers.get('x-frame-options') == 'DENY' and "frame-ancestors 'none'" in
                                 headers.get('content-security-policy', ''), 'Old v0.6.3 framing DENY was lost before bootstrap')
        base.require(base.service_identity('relay-updater-web.service') == web_identity,
                     'Runtime upgrade restarted updater web')
        base.require({str(p): control_fingerprint(p) for p in protected} == before, 'Upgrade changed independent control plane/config/units')
        # Sessions must expire after the real restart. Reauthenticate normally.
        base.require(base.http(4180, '/api/session', cookie=cookie)[0] == 401, 'Old Relay session survived restart')
        cookie, csrf = base.authenticate(password)
        if gateway_mode:
            probe_gateway(reverse=(gateway_mode == 'reverse'), remote=backend if gateway_mode == 'remote' else None)
            if gateway_mode == 'reverse':
                import pwd
                identity = pwd.getpwnam('relay')
                make_remote_tls(backend)
                for path in (backend, *backend.iterdir()):
                    os.chown(path, identity.pw_uid, identity.pw_gid)
                apply_gateway(gateway_reference(backend, remote=True), cookie, csrf, password)
                probe_gateway(remote=backend)
            else:
                apply_gateway(gateway_reference(tls_dir, reverse=True), cookie, csrf, password)
                probe_gateway(reverse=True)
        status, _, _ = base.http(4180, '/api/desktop/folders', 'POST',
                                 dict(label='After upgrade; must disappear on rollback', parentId=None), cookie, csrf)
        base.require(status == 200, 'Post-upgrade synthetic state mutation failed')
        base.require({str(p): fingerprint(p) for p in state_paths} != state_before, 'Rollback test lacks changed state')
        job = mutate('rollback', cookie, monitor, password)
        result = wait_job(monitor, job, 'rolled-back', cookie=cookie)
        engine.thread.join(30)
        base.require(not engine.thread.is_alive() and result['currentVersion'] == old, 'Rollback incomplete')
        base.ready(old, False)
        base.require(engine.current_release() == baseline_release, 'Rollback selected wrong signed baseline')
        base.require({str(p): fingerprint(p) for p in state_paths} == state_before, 'Rollback did not restore matching state')
        base.require(Path('/var/lib/relay').stat().st_ino == root_inode, 'Mounted state root replaced')
        if gateway_mode:
            probe_gateway(reverse=(gateway_mode == 'reverse'), remote=backend if gateway_mode == 'remote' else None)
        final_cookie, final_csrf = base.authenticate(password)
        base.require({str(p): control_fingerprint(p) for p in protected} == before, 'Rollback changed independent control plane/config/units')
        base.require(base.service_identity('relay-updater-web.service') == web_identity and
                     (os.getpid(), Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()[19]) == broker_identity and thread.is_alive(),
                     'Upgrade/rollback restarted independent web or qualification broker')
        if ui_release:
            # The unchanged engine refuses a duplicate staged release. Its existing
            # prune primitive removes ONLY obsolete releases after matching rollback.
            base.require(engine.data['previous'] is None and engine.current_release() == baseline_release,
                         'Candidate cleanup requires complete matching rollback')
            engine.prune()
            base.require(not candidate_release.exists(), 'Obsolete signed candidate was not removed')
            if delivery:
                retained_presentation(target, pin, Path('/opt/relay-updater/updater/ui/dist/index.html').read_bytes())
        base.require(base.http(4180, '/api/logout', 'POST', {}, final_cookie, final_csrf)[0] == 200,
                     'Synthetic final session cleanup failed')
        return dict(passed=True, deliveryCycle=delivery, upgradeFrom=old, target=target, controlPlane=old, gatewayEnabled=bool(gateway_mode), remoteMTLS=(gateway_mode in ('reverse', 'remote')),
                    webBootstrap=target if delivery else None, webIdentity=web_identity, brokerHarnessIdentity=broker_identity,
                    relayOrigin=base.NETWORK['relayOrigin'], updaterOrigin=base.NETWORK['uiOrigin'],
                    evidence=['official-signed-baseline',
                              'old-installed-engine-with-signed-web-only-bootstrap' if delivery else 'old-installed-engine-and-web',
                              'explicit-target-genuine-attestation-and-payload-verification',
                              'HTTP-password-consent-install-and-rollback', 'accounts-and-personal-desktop-preserved',
                              'matching-state-signed-rollback', 'control-plane-config-units-unchanged',
                              'port-4180-readiness-and-session-revocation', 'unchanged-web-and-broker-harness-PID-start',
                              *(['runtime-index-descriptor-eager-assets-and-post-deletion-lazy-pin-retention'] if delivery else []),
                              *(['v063-old-screen-framing-DENY-before-bootstrap'] if ui_release and not delivery and old == 'v0.6.3' else [])],
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


def legacy_no_bootstrap_admission(enabled, old, target):
    base.require(type(enabled) is bool and (not enabled or (old == 'v0.6.3' and target == 'v0.6.5')),
                 'Legacy-only phase requires exact v063 to v065')
    return enabled


def qualify(args):
    legacy_only = legacy_no_bootstrap_admission(getattr(args, 'legacy_no_bootstrap', False), args.upgrade_from, args.version)
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
            if delivery_release(args.upgrade_from, args.version):
                import shutil
                helper = bootstrap_helper()
                signed_control = HARNESS / 'signed-control'
                shutil.copytree(work / 'control', signed_control, copy_function=helper.copy_preserving)
                signed_control.chmod(0o755)
                signed_inventory = helper.inventory(signed_control)
                helper.admit_baseline(Path('/opt/relay-updater'), signed_inventory)
                install.write_new(HARNESS / 'signed-baseline.json', json.dumps(signed_inventory))
                install.write_new(HARNESS / 'password', __import__('secrets').token_urlsafe(40))
        names = ['qualify-upgrade.py', 'qualify-systemd.py', 'install-release.py']
        if delivery_release(args.upgrade_from, args.version):
            names.append('qualify-presentation-bootstrap.py')
        for name in names:
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
        if legacy_only:
            base.require(result.get('deliveryCycle') is False and result.get('webBootstrap') is None,
                         'Legacy cycle must not bootstrap web')
            result = dict(passed=True, target=args.version, upgradeFrom=args.upgrade_from,
                          networkMode=base.NETWORK['networkMode'], noBootstrap=result,
                          compatibility='legacy-signed-runtime-only-no-new-web',
                          webOnlyBootstrap=None, runtimePresentationDelivery=None,
                          modernMonitoringQualified=False, productionTouched=False)
        elif delivery_release(args.upgrade_from, args.version):
            # The first cycle has ended with matching old code/state and unchanged
            # whole control tree. Only this explicitly separate phase changes web.
            install.run(['/usr/bin/systemctl', 'start', 'relay-updater-broker.service'])
            base.wait_control()
            bootstrap_result = bootstrap_helper().qualify_bootstrap(args.apply, args.upgrade_from, args.version, args.private_lan)
            base.require(bootstrap_result.get('passed') is True, 'Web-only bootstrap did not qualify')
            install.run(['/usr/bin/systemctl', 'stop', 'relay-updater-broker.service'])
            delivery_result = json.loads(install.run(worker_command(args.upgrade_from, args.version, args.private_lan, delivery=True), timeout=960))
            base.require(delivery_result.get('passed') is True and delivery_result.get('deliveryCycle') is True and
                         delivery_result.get('upgradeFrom') == args.upgrade_from and delivery_result.get('target') == args.version,
                         'Invalid presentation-delivery cycle result')
            result = dict(passed=True, target=args.version, upgradeFrom=args.upgrade_from,
                          networkMode=base.NETWORK['networkMode'], noBootstrap=result,
                          webOnlyBootstrap=bootstrap_result, runtimePresentationDelivery=delivery_result,
                          productionTouched=False)
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
    global DIAGNOSTIC_CONTEXT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-dir', help='Four official assets for the exact --upgrade-from baseline (not candidate assets)')
    parser.add_argument('--upgrade-from', required=True)
    parser.add_argument('--version', required=True, help='Published exact candidate target tag')
    parser.add_argument('--private-lan', metavar='CANONICAL_IP')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--legacy-no-bootstrap', action='store_true', help='Separate legacy signed runtime-only gate; never counts as modern delivery')
    parser.add_argument('--installed-worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--delivery-worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    base.require(args.upgrade_from in ('v0.6.3', 'v0.6.4') and args.version == 'v0.6.5', 'Bounded diagnostic target only')
    DIAGNOSTIC_CONTEXT = (args.upgrade_from, args.version, args.delivery_worker)
    base.require(not args.delivery_worker or args.installed_worker, 'Internal delivery phase requires installed worker')
    if args.installed_worker:
        print(json.dumps(installed_worker(args.apply, args.upgrade_from, args.version, args.private_lan, args.delivery_worker)))
    else:
        if not args.release_dir:
            parser.error('--release-dir is required')
        qualify(args)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        diagnostic_exception(error)
        # Do not expose passwords, sessions, private state, or subprocess output.
        print('Signed upgrade qualification refused/failed. No success claimed; retain gated disposable runner diagnostics.', file=sys.stderr)
        sys.exit(1)
