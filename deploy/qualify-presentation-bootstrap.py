#!/usr/bin/env python3
"""Narrow web-only qualification helper, callable ONLY by fresh disposable coordinator.

No existing-host CLI, alternate roots, maintenance verb or production controller.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import sys
sys.dont_write_bytecode = True
import time

spec = importlib.util.spec_from_file_location('relay_bootstrap_base', Path(__file__).with_name('qualify-systemd.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def inventory(root, *, uid=0):
    """Complete protected ordinary path set. uid override is local-fixture only."""
    root = Path(root)
    base.require(root.is_absolute(), 'Absolute protected tree required')
    for parent in (root, *root.parents):
        info = parent.lstat()
        base.require(not stat.S_ISLNK(info.st_mode) and info.st_uid in (0, uid) and not info.st_mode & 0o022,
                     'Unprotected or linked ancestor refused')
    result = {}
    total = 0
    deadline = time.monotonic() + 10
    def visit(path):
        nonlocal total
        base.require(len(result) < 4096 and time.monotonic() < deadline, 'Inventory bounds exceeded')
        info = path.lstat()
        base.require(info.st_uid == uid and not info.st_mode & 0o022 and not info.st_mode & 0o7000,
                     'Unprotected tree entry')
        base.require(stat.S_ISDIR(info.st_mode) or (stat.S_ISREG(info.st_mode) and info.st_nlink == 1),
                     'Links or special files refused')
        entry = dict(mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid,
                     kind='directory' if stat.S_ISDIR(info.st_mode) else 'file')
        if stat.S_ISREG(info.st_mode):
            total += info.st_size
            base.require(info.st_size <= 64 * 1024 * 1024 and total <= 128 * 1024 * 1024, 'Inventory byte bound')
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as stream:
                opened = os.fstat(stream.fileno())
                base.require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino), 'Inventory entry changed')
                digest = hashlib.sha256()
                read = 0
                for chunk in iter(lambda: stream.read(65536), b''):
                    read += len(chunk)
                    base.require(read <= info.st_size and time.monotonic() < deadline, 'Inventory entry grew')
                    digest.update(chunk)
                after = os.fstat(stream.fileno())
            base.require(read == info.st_size and after.st_mtime_ns == info.st_mtime_ns and after.st_nlink == 1,
                         'Inventory entry changed while reading')
            entry.update(size=read, sha256=digest.hexdigest(), nlink=info.st_nlink, mtimeNs=info.st_mtime_ns)
        result[path.relative_to(root).as_posix()] = entry
        if stat.S_ISDIR(info.st_mode):
            for child in sorted(path.iterdir()):
                visit(child)
    visit(root)
    return result


def admit_baseline(root, expected, *, uid=0):
    base.require(inventory(root, uid=uid) == expected, 'Complete signed control baseline differs')


HARNESS = Path('/opt/relay-qualification')
CONTROL = Path('/opt/relay-updater')


def guard_bootstrap(apply, old, target, private_lan):
    import json
    base.guard_environment(apply)
    base.require(os.environ.get('RELAY_DISPOSABLE_SIGNED_UPGRADE') ==
                 'I_ACCEPT_FRESH_HOST_SIGNED_UPGRADE_AND_ROLLBACK', 'Disposable signed-upgrade acknowledgment required')
    base.require(old in ('v0.6.3', 'v0.6.4') and target == 'v0.6.5', 'Unqualified bootstrap baseline/target')
    marker = HARNESS / 'marker.json'
    inventory(marker)
    base.require(marker.stat().st_mode & 0o777 == 0o600 and json.loads(marker.read_bytes()) ==
                 dict(old=old, target=target, privateLan=private_lan), 'Missing matching fresh-install marker')
    signed = HARNESS / 'signed-baseline.json'
    inventory(signed)
    base.require(signed.stat().st_mode & 0o777 == 0o600, 'Unprotected signed baseline inventory')
    admit_baseline(CONTROL, json.loads(signed.read_bytes()))


CHANGES = ('updater/web/server.mjs', 'updater/web/presentation.mjs')
BROKER_FILES = tuple('updater/broker/' + n + '.py' for n in
                     ('auth', 'driver', 'engine', 'enroll', 'observe', 'releases', 'server'))


def broker_hashes(control, *, uid=0):
    entries = inventory(Path(control) / 'updater/broker', uid=uid)
    expected = {Path(name).name for name in BROKER_FILES}
    base.require(set(entries) == expected | {'.'} and all(entries[name]['kind'] == 'file' for name in expected),
                 'Unexpected broker path set')
    return {name: entries[Path(name).name]['sha256'] for name in BROKER_FILES}


def copy_preserving(source, target):
    """Copy only previously admitted ordinary files; preserve uid/gid/mode/mtime."""
    import shutil
    shutil.copy2(source, target, follow_symlinks=False)
    info = Path(source).stat()
    if os.geteuid() == 0:
        os.chown(target, info.st_uid, info.st_gid)
    with Path(target).open('rb') as stream:
        os.fsync(stream.fileno())


def backup_tree(source, destination, *, uid=0):
    import shutil
    before = inventory(source, uid=uid)
    shutil.copytree(source, destination, copy_function=copy_preserving)
    # copytree preserves directory mode/mtime, but not owner/group.
    if os.geteuid() == 0:
        for name, item in before.items():
            if item['kind'] == 'directory':
                os.chown(Path(destination) / name, item['uid'], item['gid'])
    admit_baseline(destination, before, uid=uid)
    admit_baseline(source, before, uid=uid)
    return before


def candidate_files(control, candidate, *, uid=0):
    old = inventory(control, uid=uid)
    new = inventory(candidate, uid=uid)
    base.require(CHANGES[1] not in old, 'Existing reader refused; not a signed old baseline')
    for name in (*BROKER_FILES, 'updater/web/index.mjs', 'updater/web/broker-client.mjs'):
        base.require(name in old and name in new and old[name]['sha256'] == new[name]['sha256'] and
                     old[name]['mode'] == new[name]['mode'], 'Incompatible signed web/broker composition')
    for name in CHANGES:
        base.require(name in new and new[name]['kind'] == 'file' and new[name]['mode'] == 0o644,
                     'Missing or unsafe signed bootstrap module')
    return old, {name: new[name] for name in CHANGES}


def replace_web(control, candidate, backup, stop, *, uid=0, checkpoint=lambda phase: None, protected=None):
    """Internal fixed two-file rehearsal. No start on failure/interruption."""
    import json
    control, candidate, backup = map(Path, (control, candidate, backup))
    old, selected = candidate_files(control, candidate, uid=uid)
    base.require(not os.path.lexists(backup), 'Existing backup refused')
    for name in CHANGES:
        base.require(not os.path.lexists(control / (name + '.next')), 'Existing staged sibling refused')
    stop()
    backup.mkdir(mode=0o700)
    backed = backup_tree(control, backup / 'control', uid=uid)
    base.require(backed == old, 'Control changed before backup')
    for name, source in (protected or {}).items():
        base.require('/' not in name and name not in ('control', 'inventory.json', '.', '..'), 'Invalid internal backup label')
        if Path(source).is_dir():
            backup_tree(source, backup / name, uid=uid)
        else:
            expected = inventory(source, uid=uid)
            copy_preserving(source, backup / name)
            admit_baseline(backup / name, expected, uid=uid)
            admit_baseline(source, expected, uid=uid)
    metadata = backup / 'inventory.json'
    with metadata.open('x') as stream:
        os.chmod(metadata, 0o600)
        json.dump(old, stream)
        stream.flush()
        os.fsync(stream.fileno())
    checkpoint('backup-complete')
    for name in CHANGES:
        target = control / name
        staged = control / (name + '.next')
        copy_preserving(candidate / name, staged)
        base.require(inventory(staged, uid=uid)['.'] == selected[name], 'Staged signed module differs')
        os.replace(staged, target)
        fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        checkpoint('server-replaced' if name == CHANGES[0] else 'reader-replaced')
    after = inventory(control, uid=uid)
    expected = dict(old, **selected)
    base.require(after == expected, 'Unexpected bootstrap change set')
    return expected


def restore_web(control, candidate, backup, stop, *, uid=0):
    """Explicit complete readback before restoring server/removing NEW reader."""
    import json
    control, candidate, backup = map(Path, (control, candidate, backup))
    stop()
    inventory(backup, uid=uid)
    old = json.loads((backup / 'inventory.json').read_bytes())
    admit_baseline(backup / 'control', old, uid=uid)
    current = inventory(control, uid=uid)
    for name in set(current) | set(old):
        if name not in CHANGES:
            base.require(current.get(name) == old.get(name), 'Unexpected control change; automatic repair refused')
    for name in CHANGES:
        base.require(not os.path.lexists(control / (name + '.restore')), 'Existing restore sibling refused')
    server = control / CHANGES[0]
    candidate_server = inventory(candidate / CHANGES[0], uid=uid)['.']
    base.require(current.get(CHANGES[0]) in (old[CHANGES[0]], candidate_server),
                 'Unadmitted server repair refused; inspect rather than overwrite')
    staged = control / (CHANGES[0] + '.restore')
    copy_preserving(backup / 'control' / CHANGES[0], staged)
    base.require(inventory(staged, uid=uid)['.'] == old[CHANGES[0]], 'Restore sibling differs')
    reader = control / CHANGES[1]
    if os.path.lexists(reader):
        base.require(reader.read_bytes() == (candidate / CHANGES[1]).read_bytes(), 'Unexpected reader bytes refused')
        reader.unlink()
    os.replace(staged, server)
    fd = os.open(server.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    admit_baseline(control, old, uid=uid)


def download_candidate(releases, api, directory, target):
    """The installed official verifier first; exact updater hash/size before extract."""
    import json
    base.require(target == 'v0.6.5' and releases.fixture is False, 'Official production candidate required')
    directory = Path(directory)
    base.require(not os.path.lexists(directory), 'Existing candidate staging refused')
    directory.mkdir(mode=0o700)
    manifest = releases.verified_manifest(target, directory)
    descriptor = manifest.get('updaterArtifact')
    base.require(isinstance(descriptor, dict), 'Attested updater artifact required')
    archive = directory / 'relay-updater-linux-x64.tar.gz'
    api.transfer(releases.base(target) + '/relay-updater-linux-x64.tar.gz', archive, limit=descriptor['size'])
    api.verify_artifact(archive, descriptor, updater=True)
    candidate = directory / 'control'
    api.extract(archive, candidate)
    base.require(json.loads((candidate / 'package.json').read_bytes()).get('version') == target[1:], 'Candidate archive version differs')
    return candidate, descriptor


def rehearse_bootstrap(control, candidate, directory, protected, stop, start, health, startup_failure, *, uid=0):
    """Internal rehearsal: interruption + failed start + explicit restores + final apply."""
    directory = Path(directory)
    directory.mkdir(mode=0o700)
    frozen = {name: inventory(path, uid=uid) for name, path in protected.items()}
    def unchanged():
        for name, path in protected.items():
            admit_baseline(path, frozen[name], uid=uid)
    def interrupt(phase):
        if phase == 'server-replaced':
            raise InterruptedError('Deliberate disposable operator interruption after server replacement')
    backup = directory / 'interruption'
    try:
        replace_web(control, candidate, backup, stop, uid=uid, checkpoint=interrupt, protected=protected)
    except InterruptedError:
        restore_web(control, candidate, backup, stop, uid=uid)
    else:
        raise base.install.InstallError('Interruption rehearsal did not interrupt')
    unchanged()
    start()
    health(False)
    backup = directory / 'startup-failure'
    replace_web(control, candidate, backup, stop, uid=uid, protected=protected)
    try:
        startup_failure()
    except OSError:
        restore_web(control, candidate, backup, stop, uid=uid)
    else:
        raise base.install.InstallError('Startup-failure rehearsal did not fail')
    unchanged()
    start()
    health(False)
    backup = directory / 'final'
    expected = replace_web(control, candidate, backup, stop, uid=uid, protected=protected)
    unchanged()
    try:
        start()
        health(True)
        unchanged()
        admit_baseline(control, expected, uid=uid)
    except BaseException:
        # Failed readiness never licenses starting a partially replaced web.
        restore_web(control, candidate, backup, stop, uid=uid)
        unchanged()
        start()
        health(False)
        raise
    return expected


def security_probe(cookie, csrf, other_cookie=''):
    """HTTP evidence only. No browser claim and no successful install mutation."""
    from urllib.parse import urlsplit
    status, _, headers = base.raw_http(4191, '/updater/')
    base.require(status == 200 and 'x-frame-options' not in headers and
                 [directive.strip() for directive in headers.get('content-security-policy', '').split(';')
                  if directive.strip().startswith('frame-ancestors')] == ['frame-ancestors ' + base.NETWORK['relayOrigin']] and
                 headers.get('x-relay-updater-presentation') == 'builtin', 'Bootstrap fallback HTML/CSP not ready')
    for values in ({'Host': 'evil.example:4191'}, {'Origin': 'http://evil.example:4191'}):
        base.require(base.raw_http(4191, '/updater/', headers=values)[0] == 403, 'Host/Origin negative failed')
    status, auth, _ = base.http(4191, '/updater/api/auth')
    base.require(status == 200 and auth.get('authenticated') is False and
                 base.http(4191, '/updater/api/state')[0] == 401, 'Anonymous API authority admitted')
    status, launch, _ = base.http(4180, '/api/updater/launch', 'POST', {}, cookie, csrf)
    base.require(status == 200, 'Genuine ticket issuance failed')
    ticket = urlsplit(launch['url']).fragment
    base.require(base.http(4191, '/updater/api/exchange', 'POST', dict(ticket=ticket))[0] == 401,
                 'Ticket accepted without real owner cookie')
    if other_cookie:
        base.require(base.http(4191, '/updater/api/exchange', 'POST', dict(ticket=ticket), other_cookie)[0] == 401,
                     'Another genuine administrator redeemed original-owner ticket')
    monitor = base.launch_monitor(cookie, csrf)  # also checks consumed-ticket denial
    status, auth, _ = base.http(4191, '/updater/api/auth', cookie=cookie + '; ' + monitor)
    base.require(status == 200 and auth.get('authenticated') is True, 'Original-owner monitor not authenticated')
    base.require(base.http(4191, '/updater/api/logout', 'POST', {}, cookie + '; ' + monitor, 'wrong-csrf')[0] == 403,
                 'Missing independent CSRF admitted')
    base.require(base.http(4191, '/updater/api/install', 'POST',
                          dict(version='v0.6.5', confirmed=True, password='wrong-qualification-password'),
                          cookie + '; ' + monitor, auth['csrf'])[0] == 403, 'Wrong password admitted mutation')
    base.require(base.http(4191, '/updater/api/auth', cookie=monitor)[0] == 401, 'Ownerless monitor retained authority')
    monitor = base.launch_monitor(cookie, csrf)
    if other_cookie:
        base.require(base.http(4191, '/updater/api/state', cookie=other_cookie + '; ' + monitor)[0] == 401,
                     'Another genuine administrator reused original monitor')
        monitor = base.launch_monitor(cookie, csrf)
    status, auth, _ = base.http(4191, '/updater/api/auth', cookie=cookie + '; ' + monitor)
    base.require(status == 200 and base.http(4191, '/updater/api/logout', 'POST', {},
                 cookie + '; ' + monitor, auth['csrf'])[0] == 200, 'Independent logout readback failed')


def qualify_bootstrap(apply, old, target, private_lan):
    """Runs ONLY after fresh signed no-bootstrap upgrade/rollback has completed."""
    import json
    import secrets
    guard_bootstrap(apply, old, target, private_lan)
    base.NETWORK = base.install.deployment_network(private_lan)
    # Import verifier only from the previously admitted signed old control tree.
    for name in tuple(sys.modules):
        if name == 'updater' or name.startswith('updater.'):
            del sys.modules[name]
    sys.path.insert(0, str(CONTROL))
    from updater.broker import releases as api
    base.require(Path(api.__file__).resolve() == CONTROL / 'updater/broker/releases.py', 'Checkout verifier refused')
    config = json.loads(Path('/etc/relay-updater/broker.json').read_bytes())
    base.require(config['mode'] == 'production', 'Production verifier required')
    candidate, descriptor = download_candidate(api.Releases(config), api, HARNESS / 'candidate-release', target)
    candidate_files(CONTROL, candidate)
    journal = json.loads(Path('/var/lib/relay-updater/journal.json').read_bytes())
    base.require(journal['currentVersion'] == old and journal.get('job', {}).get('phase') == 'rolled-back' and
                 journal.get('checkpoint') is None and not base.GATE.exists(), 'No complete idle matching rollback')
    password = (HARNESS / 'password').read_text()
    cookie, csrf = base.authenticate(password)
    # Genuine other-admin fixture is created BEFORE bootstrap invariant baselines.
    other_password = secrets.token_urlsafe(40)
    status, _, _ = base.http(4180, '/api/admin/users', 'POST',
                            dict(username='bootstrap-other', password=other_password, role='admin', grants=[]), cookie, csrf)
    base.require(status == 200, 'Genuine second-administrator fixture preparation failed')
    status, auth, _ = base.http(4180, '/api/auth')
    base.require(status == 200, 'Other-admin auth discovery failed')
    status, _, other_cookie = base.http(4180, '/api/login', 'POST',
                                      dict(username='bootstrap-other', password=other_password), csrf=auth['csrf'])
    base.require(status == 200 and other_cookie, 'Genuine other-admin login failed')
    protected = {'config': Path('/etc/relay-updater'),
                 **{u: Path('/etc/systemd/system') / u for u in base.install.UNITS}}
    broker_before = broker_hashes(CONTROL)
    broker_identity = base.service_identity('relay-updater-broker.service')
    relay_identity = base.service_identity('relay.service')
    runtime = Path('/opt/relay/current').resolve(strict=True)
    # Reuse the complete ordinary-tree admission for all synthetic Relay state;
    # sessions/authorization journals are intentionally not an immutability claim.
    import pwd
    relay_uid = pwd.getpwnam('relay').pw_uid
    state_before = inventory(Path('/var/lib/relay'), uid=relay_uid)
    def stable():
        base.require(base.service_identity('relay-updater-broker.service') == broker_identity and
                     base.service_identity('relay.service') == relay_identity and
                     Path('/opt/relay/current').resolve(strict=True) == runtime and broker_hashes(CONTROL) == broker_before,
                     'Bootstrap changed broker/Relay/runtime')
        admit_baseline(Path('/var/lib/relay'), state_before, uid=relay_uid)
    def stop():
        base.run(['/usr/bin/systemctl', 'stop', 'relay-updater-web.service'])
        base.require(base.run(['/usr/bin/systemctl', 'show', 'relay-updater-web.service', '--property=MainPID', '--value']) == '0',
                     'Web did not stop')
        try:
            base.raw_http(4191, '/updater/api/auth')
        except OSError:
            pass
        else:
            raise base.install.InstallError('Stopped web listener still responds')
        stable()
    def start():
        base.run(['/usr/bin/systemctl', 'start', 'relay-updater-web.service'])
        base.wait_control()
        stable()
    def health(new):
        stable()
        base.ready(old, False)
        base.isolation()
        if new:
            security_probe(cookie, csrf, other_cookie)
        else:
            status, index, headers = base.raw_http(4191, '/updater/')
            base.require(status == 200 and index == (CONTROL / 'updater/ui/dist/index.html').read_bytes(), 'Restored fallback differs')
            if old == 'v0.6.3':
                base.require(headers.get('x-frame-options') == 'DENY', 'Restored v0.6.3 framing negative lost')
    def startup_failure():
        # Exact signed bytes verified above, then a disposable DAC fault, NOT a
        # corrupted candidate or relaxed unit. Restore the admitted mode before
        # explicit old-file restoration. Broker/Relay remain running throughout.
        server = CONTROL / CHANGES[0]
        server.chmod(0o000)
        denied = False
        try:
            base.run(['/usr/bin/systemctl', 'start', 'relay-updater-web.service'])
            try:
                base.wait_control()
            except base.install.InstallError:
                denied = True
        finally:
            stop()
            server.chmod(0o644)
        base.require(denied, 'Unreadable signed web module unexpectedly started')
        raise OSError('Deliberate disposable unprivileged web startup denial')
    expected = rehearse_bootstrap(CONTROL, candidate, HARNESS / 'bootstrap-rehearsal', protected, stop, start, health, startup_failure)
    stable()
    base.install.write_new(HARNESS / 'delivery-marker.json', json.dumps(expected))
    status, session, _ = base.http(4180, '/api/session', cookie=other_cookie)
    base.require(status == 200 and base.http(4180, '/api/logout', 'POST', {}, other_cookie, session['csrf'])[0] == 200,
                 'Other-admin fixture logout failed')
    base.require(base.http(4180, '/api/logout', 'POST', {}, cookie, csrf)[0] == 200, 'Bootstrap owner logout failed')
    return dict(passed=True, baseline=old, target=target, fallbackPreserved=True,
                brokerHashesBefore=broker_before, brokerHashesAfter=broker_hashes(CONTROL),
                brokerIdentity=broker_identity, relayIdentity=relay_identity,
                changedFiles=list(CHANGES), officialUpdaterArtifact=descriptor,
                evidence=['anonymous-installed-official-verifier', 'complete-signed-old-control-inventory-and-metadata',
                          'protected-control-config-all-units-backup-readback', 'web-only-systemd-stop-start',
                          'interruption-explicit-restore', 'unprivileged-DAC-startup-failure-explicit-restore',
                          'unchanged-broker-Relay-PID-start-and-seven-broker-modules',
                          'real-HTTP-CSP-Host-Origin-CSRF-password-ticket-owner-negatives'],
                limits=['no-browser-click-or-rendering', 'no-production-access', 'no-reboot-power-loss',
                        'operator-interruption-is-caught-exception-not-SIGKILL'])


if __name__ == '__main__':
    print('No existing-host bootstrap CLI. Use the guarded fresh-host signed-upgrade coordinator only.', file=sys.stderr)
    sys.exit(1)
