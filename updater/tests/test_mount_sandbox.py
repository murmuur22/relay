"""Mount-boundary regressions; local tests use real HTTP/Node, simulated rename errors."""
import errno
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from updater.broker.engine import Engine
from updater.fixtures.harness import Sandbox, envelope


def client_for(engine, box):
    ticket = engine.authority.issue(envelope(box.key, 'issue-ui', dict(userId='admin', interfaceAnimations=False)))['ticket']
    token = engine.authority.redeem(ticket, box.config['uiOrigin'])['token']
    def call(action, **params):
        if action in ('start', 'rollback'):
            target = dict(version=params['version']) if action == 'start' else {}
            params['authorization'] = engine.authority.issue(envelope(box.key, 'issue-action', dict(userId='admin', action='install' if action == 'start' else action, **target)))['authorization']
        return engine.request(action, dict(token=token, **params))
    return call


class MountTests(unittest.TestCase):
    def test_install_rename_stays_on_install_mount(self):
        box = Sandbox()
        engine = Engine(box.config)
        try:
            engine.driver.start()
            engine.driver.ready('v0.3.0')
            call = client_for(engine, box)
            call('check')
            original = os.replace
            install = Path(box.config['installRoot'])
            def mounted_replace(src, dst, *args, **kwargs):
                if install in Path(dst).parents and install not in Path(src).parents:
                    raise OSError(errno.EXDEV, 'separate systemd writable mounts')
                return original(src, dst, *args, **kwargs)
            with patch('os.replace', side_effect=mounted_replace):
                call('start', version='v0.3.1')
                engine.thread.join(25)
                self.assertFalse(engine.thread.is_alive())
            self.assertEqual(engine.snapshot()['job']['phase'], 'succeeded')
            self.assertEqual(box.ready()['version'], '0.3.1')
            self.assertFalse(list((install / 'releases').glob('.stage-*')))
        finally:
            engine.close()
            box.close()

    def test_rollback_keeps_mounted_root_and_removes_links_without_following(self):
        box = Sandbox()
        engine = Engine(box.config)
        try:
            engine.driver.start()
            call = client_for(engine, box)
            call('check')
            call('start', version='v0.3.1')
            engine.thread.join(25)
            self.assertEqual(engine.snapshot()['job']['phase'], 'succeeded')
            before = box.state.stat()
            outside = box.root / 'outside'
            outside.mkdir()
            (outside / 'keep').write_text('untouched')
            (box.state / 'linked-dir').symlink_to(outside, target_is_directory=True)
            (box.state / 'fixture.txt').unlink()
            (box.state / 'fixture.txt').symlink_to(outside / 'keep')
            original = os.replace
            def mounted_replace(src, dst, *args, **kwargs):
                if Path(src) == box.state or Path(dst) == box.state:
                    raise OSError(errno.EBUSY, 'state root is a mount point')
                return original(src, dst, *args, **kwargs)
            with patch('os.replace', side_effect=mounted_replace):
                call('rollback')
                engine.thread.join(25)
                self.assertFalse(engine.thread.is_alive())
            self.assertEqual(engine.snapshot()['job']['phase'], 'rolled-back')
            after = box.state.stat()
            self.assertEqual((after.st_dev, after.st_ino, after.st_uid, after.st_gid, after.st_mode),
                             (before.st_dev, before.st_ino, before.st_uid, before.st_gid, before.st_mode))
            self.assertEqual((outside / 'keep').read_text(), 'untouched')
            self.assertEqual((box.state / 'fixture.txt').read_text(), 'initial synthetic state')
            self.assertFalse((box.state / 'linked-dir').exists())
            self.assertFalse(box.maintenance.exists())
        finally:
            engine.close()
            box.close()

    def test_stage_is_private_until_verified_and_failure_cleans_only_owned_stage(self):
        from updater.broker.auth import Denied
        box = Sandbox()
        engine = Engine(box.config)
        try:
            call = client_for(engine, box)
            call('check')
            visited = []
            def reject(stage, version):
                self.assertEqual(stage.parent.parent, engine.install / 'releases')
                self.assertEqual(stage.parent.stat().st_mode & 0o777, 0o700)
                self.assertEqual(stage.stat().st_mode & 0o777, 0o700)
                self.assertFalse((stage / '.relay-verified.json').exists())
                visited.append(stage)
                raise Denied('injected preflight failure')
            with patch.object(engine.driver, 'preflight', side_effect=reject):
                call('start', version='v0.3.1')
                engine.thread.join(25)
            self.assertEqual(len(visited), 1)
            self.assertEqual(engine.snapshot()['job']['phase'], 'failed')
            self.assertFalse(visited[0].parent.exists())
            self.assertEqual(engine.current_release().name, 'v0.3.0-baseline')
            self.assertEqual([p.name for p in (engine.install / 'releases').iterdir()], ['v0.3.0-baseline'])
            self.assertEqual(list(engine.work.iterdir()), [])
        finally:
            engine.close()
            box.close()

    def test_final_payload_files_are_fsynced_after_preflight(self):
        box = Sandbox()
        engine = Engine(box.config)
        try:
            call = client_for(engine, box)
            call('check')
            preflight_done = []
            synced = set()
            preflight, sync = engine.driver.preflight, os.fsync
            def checked(stage, version):
                preflight(stage, version)
                preflight_done.append(True)
            def fsync(fd):
                if preflight_done:
                    synced.add(os.fstat(fd).st_ino)
                return sync(fd)
            with patch.object(engine.driver, 'preflight', side_effect=checked), patch('os.fsync', side_effect=fsync):
                call('start', version='v0.3.1')
                engine.thread.join(25)
            self.assertEqual(engine.snapshot()['job']['phase'], 'succeeded')
            for name in ('package.json', 'service.mjs', 'payload.bin', '.relay-verified.json'):
                self.assertIn((engine.current_release() / name).stat().st_ino, synced)
        finally:
            engine.close()
            box.close()

    def test_process_death_during_restore_keeps_backup_and_restart_closed(self):
        import subprocess
        import sys
        box = Sandbox()
        engine = Engine(box.config)
        try:
            call = client_for(engine, box)
            call('check')
            call('start', version='v0.3.1')
            engine.thread.join(25)
            checkpoint = dict(engine.data['previous'])
            engine.close()
            child = '''import os, sys, json
from updater.broker.engine import Engine
engine = Engine(json.load(open(sys.argv[1])))
original = os.open
def crash(path, flags, *args, **kwargs):
    if path == 'fixture.txt' and flags & os.O_EXCL:
        os._exit(73)
    return original(path, flags, *args, **kwargs)
os.open = crash
engine.restore(engine.data['previous'])
'''
            result = subprocess.run([sys.executable, '-c', child, str(box.config_path)],
                                    cwd=Path(__file__).resolve().parents[2], timeout=15)
            self.assertEqual(result.returncode, 73)
            engine = Engine(box.config)
            self.assertTrue(box.maintenance.exists())
            self.assertFalse(engine.snapshot()['canInstall'])
            self.assertEqual(engine.data['checkpoint'], checkpoint)
            self.assertFalse((box.state / 'fixture.txt').exists())
            self.assertEqual((engine.root / checkpoint['backup'] / 'fixture.txt').read_text(), 'initial synthetic state')
            engine.restore(checkpoint)
            self.assertEqual((box.state / 'fixture.txt').read_text(), 'initial synthetic state')
        finally:
            engine.close()
            box.close()

    def test_partial_restore_failure_retains_durable_checkpoint_for_retry(self):
        import json
        box = Sandbox()
        engine = Engine(box.config)
        try:
            call = client_for(engine, box)
            call('check')
            call('start', version='v0.3.1')
            engine.thread.join(25)
            checkpoint = dict(engine.data['previous'])
            original = os.open
            def fail_copy(path, flags, *args, **kwargs):
                if path == 'fixture.txt' and flags & os.O_EXCL:
                    self.assertTrue(box.maintenance.exists())
                    self.assertIsNone(engine.driver.process)
                    raise OSError(errno.ENOSPC, 'injected partial restore failure')
                return original(path, flags, *args, **kwargs)
            with patch('os.open', side_effect=fail_copy):
                call('rollback')
                engine.thread.join(25)
            self.assertEqual(engine.data['job']['phase'], 'rollback-failed')
            self.assertFalse((box.state / 'fixture.txt').exists())
            self.assertTrue(box.maintenance.exists())
            self.assertEqual(json.loads(engine.journal.read_text())['checkpoint'], checkpoint)
            backup = engine.root / checkpoint['backup']
            self.assertEqual((backup / 'fixture.txt').read_text(), 'initial synthetic state')
            engine.close()
            engine = Engine(box.config)
            self.assertFalse(engine.snapshot()['canInstall'])
            # Operator recovery, not automatic retry or a public API bypass.
            engine.restore(checkpoint)
            self.assertEqual((box.state / 'fixture.txt').read_text(), 'initial synthetic state')
            self.assertEqual(box.ready()['version'], '0.3.0')
            self.assertTrue(backup.exists())
        finally:
            engine.close()
            box.close()


class QualificationGuardTests(unittest.TestCase):
    def test_root_runner_rejects_non_ci_before_allocating(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'disposable GitHub'):
                qualification_guard()

    def test_foreign_workspace_is_rejected(self):
        for path in ('/var/lib/relay', '/opt/relay', '/tmp/workspace', '/tmp/not-qualification/workspace'):
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                checked_workspace(path)


class RestoreSafetyTests(unittest.TestCase):
    def test_bounds_and_invalid_backups_refuse_before_deletion(self):
        import tempfile
        from updater.broker.auth import Denied
        from updater.broker.driver import restore_state
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            backup, state = root / 'backup', root / 'state'
            backup.mkdir()
            state.mkdir()
            (state / 'keep').write_text('untouched')
            (backup / 'file').write_text('backup')
            for limits in ({'max_bytes': 1}, {'max_files': 0}, {'timeout': -1}):
                with self.subTest(limits=limits), self.assertRaises(Denied):
                    restore_state(backup, state, **limits)
                self.assertEqual((state / 'keep').read_text(), 'untouched')
            (backup / 'nested').mkdir()
            with self.assertRaises(Denied):
                restore_state(backup, state, max_depth=0)
            (backup / 'link').symlink_to(state)
            with self.assertRaises(Denied):
                restore_state(backup, state)
            (backup / 'link').unlink()
            os.link(backup / 'file', backup / 'hardlink')
            with self.assertRaises(Denied):
                restore_state(backup, state)
            self.assertEqual((state / 'keep').read_text(), 'untouched')

    def test_nested_restore_preserves_owners_and_fsyncs_directories(self):
        import tempfile
        from updater.broker.driver import restore_state
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            backup, state = root / 'backup', root / 'state'
            (backup / 'nested/deep').mkdir(parents=True)
            (backup / 'nested/deep/file').write_bytes(b'checkpoint')
            (state / 'stale/deep').mkdir(parents=True)
            (state / 'stale/deep/file').write_bytes(b'old')
            original = os.fsync
            synced = set()
            def sync(fd):
                synced.add(os.fstat(fd).st_ino)
                return original(fd)
            with patch('os.fsync', side_effect=sync):
                restore_state(backup, state, preserve_owner=True)
            self.assertFalse((state / 'stale').exists())
            for suffix in ('', 'nested', 'nested/deep', 'nested/deep/file'):
                self.assertIn((state / suffix).stat().st_ino, synced)
                self.assertEqual((state / suffix).stat().st_uid, (backup / suffix).stat().st_uid)
            self.assertEqual((state / 'nested/deep/file').read_bytes(), b'checkpoint')


# Hosted qualification (NOT a production install or GitHub-attestation test):
# sudo env CI=true GITHUB_ACTIONS=true /usr/bin/python3 -m \
#   updater.tests.test_mount_sandbox --disposable-github-systemd
# Run from the checkout on an explicitly disposable GitHub-hosted Linux runner,
# after the installer created its existing nonlogin relay account. No new users,
# installed services, /opt/relay or real /var/lib state are modified.

QUALIFICATION_MARKER = 'DISPOSABLE RELAY SYSTEMD MOUNT QUALIFICATION\n'


def qualification_guard():
    import sys
    if (sys.platform != 'linux' or os.geteuid() != 0 or
            os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true' or
            not Path('/run/systemd/system').is_dir()):
        raise RuntimeError('Requires explicit disposable GitHub Actions Linux/systemd root runner')


def checked_workspace(workspace):
    workspace = Path(workspace)
    parent = workspace.parent
    if (workspace.name != 'workspace' or parent.parent != Path('/tmp') or
            not parent.name.startswith('relay-mount-qualification-') or
            parent.is_symlink() or parent.stat().st_uid != 0 or parent.stat().st_mode & 0o022 or
            (parent / '.qualification').read_text() != QUALIFICATION_MARKER or
            workspace.is_symlink() or not workspace.is_dir()):
        raise RuntimeError('Refusing unmarked or foreign qualification path')
    return workspace


def coordinate(workspace):
    import json
    import selectors
    import sys
    from updater.broker.auth import atomic_json
    workspace = checked_workspace(workspace)
    if os.geteuid() == 0 or workspace.stat().st_uid != os.geteuid():
        raise RuntimeError('Fixture coordinator requires workspace owner, not root')
    box = Sandbox()
    try:
        if box.root.parent != workspace:
            raise RuntimeError('Fixture did not use isolated TMPDIR')
        control = box.root / 'control'
        control.mkdir(mode=0o700)
        box.maintenance = control / 'maintenance'
        box.config['maintenance'] = str(box.maintenance)
        atomic_json(box.config_path, box.config)
        print(str(box.config_path), flush=True)
        with selectors.DefaultSelector() as selector:
            selector.register(sys.stdin, selectors.EVENT_READ)
            if not selector.select(180):
                raise RuntimeError('Fixture coordinator deadline exceeded')
            sys.stdin.buffer.read(1)
    finally:
        box.close()


def mounted_lifecycle(config_path):
    import json
    import tempfile
    from types import SimpleNamespace
    config_path = Path(config_path)
    checked_workspace(config_path.parent.parent)
    # The fixture parent is intentionally read-only in this namespace. Avoid
    # tempfile's write probe there; all engine allocations pass explicit dirs
    # inside the writable islands. Validation still uses this marked tmp root.
    tempfile.tempdir = str(config_path.parent.parent)
    config = json.loads(config_path.read_text())
    root = Path(config['fixtureRoot'])
    if root != config_path.parent or (root / '.relay-updater-fixture').read_text() != 'DISPOSABLE FIXTURE ONLY\n':
        raise RuntimeError('Unmarked child fixture')
    # Prove these are distinct real mount IDs, not only directories on st_dev.
    mount_rows = [line.split() for line in Path('/proc/self/mountinfo').read_text().splitlines()]
    mount_ids = {}
    for key in ('installRoot', 'stateRoot', 'controlRoot'):
        rows = [row for row in mount_rows if row[4] == config[key]]
        if len(rows) != 1 or 'rw' not in rows[0][5].split(','):
            raise RuntimeError('Missing separate writable fixture mount: ' + key)
        mount_ids[key] = rows[0][0]
    if len(set(mount_ids.values())) != 3:
        raise RuntimeError('Writable paths are not distinct mounts')
    probe = Path(config['controlRoot']) / 'mount-probe'
    probe.write_text('disposable')
    try:
        try:
            os.replace(probe, Path(config['installRoot']) / 'mount-probe')
        except OSError as error:
            if error.errno != errno.EXDEV:
                raise
        else:
            raise RuntimeError('Cross-mount rename unexpectedly succeeded')
    finally:
        probe.unlink(missing_ok=True)
    try:
        (root / 'readonly-probe').write_text('must not be writable')
    except OSError as error:
        if error.errno != errno.EROFS:
            raise
    else:
        raise RuntimeError('Fixture mount parent unexpectedly writable')
    engine = Engine(config)
    box = SimpleNamespace(config=config, key=Path(config['bridgeKeyFile']).read_bytes())
    state = Path(config['stateRoot'])
    before = state.stat()
    outcomes = []
    try:
        engine.driver.start()
        engine.driver.ready('v0.3.0')
        call = client_for(engine, box)
        call('check')
        def job(action, expected, **params):
            call(action, **params)
            engine.thread.join(35)
            if engine.thread.is_alive() or engine.snapshot()['job']['phase'] != expected:
                raise RuntimeError('Mounted lifecycle failed: ' + str(engine.snapshot()['job']))
            outcomes.append(expected)
        job('start', 'succeeded', version='v0.3.1')
        (state / 'fixture.txt').write_text('state to discard')
        job('rollback', 'rolled-back')
        if (state / 'fixture.txt').read_text() != 'initial synthetic state':
            raise RuntimeError('Explicit rollback did not restore matching state')
        job('start', 'succeeded', version='v0.3.1')
        (state / 'fixture.txt').write_text('matching checkpoint')
        job('start', 'rolled-back', version='v0.3.2')
        if (state / 'fixture.txt').read_text() != 'matching checkpoint':
            raise RuntimeError('Automatic rollback did not restore matching state')
        after = state.stat()
        if (before.st_dev, before.st_ino, before.st_uid, before.st_gid) != (after.st_dev, after.st_ino, after.st_uid, after.st_gid):
            raise RuntimeError('Mounted state root identity changed')
        engine.driver.ready('v0.3.1')
        if engine.maintenance.exists():
            raise RuntimeError('Successful recovery left maintenance closed')
        print(json.dumps(dict(evidence='FIXTURE-HMAC-NOT-GITHUB', mountIds=mount_ids,
                              outcomes=outcomes, stableStateRoot=True)), flush=True)
    finally:
        engine.close()


def run_systemd_qualification():
    import json
    import pwd
    import selectors
    import shutil
    import subprocess
    import sys
    import tempfile
    qualification_guard()
    relay = pwd.getpwnam('relay')  # Existing installer account ONLY.
    if relay.pw_uid == 0 or relay.pw_shell not in ('/usr/sbin/nologin', '/sbin/nologin', '/bin/false'):
        raise RuntimeError('Existing nonlogin relay account required')
    if not shutil.which('node') or not shutil.which('systemd-run'):
        raise RuntimeError('Node and systemd-run required')
    parent = Path(tempfile.mkdtemp(prefix='relay-mount-qualification-', dir='/tmp'))
    coordinator = None
    unit = parent.name + '.service'
    try:
        parent.chmod(0o755)
        (parent / '.qualification').write_text(QUALIFICATION_MARKER)
        (parent / '.qualification').chmod(0o644)
        workspace = parent / 'workspace'
        workspace.mkdir(mode=0o700)
        os.chown(workspace, relay.pw_uid, relay.pw_gid)
        # Root-owned, read-only code snapshot; do not run writable checkout code
        # as root or copy unrelated worker/generated/runtime files.
        code = parent / 'code'
        repo = Path(__file__).resolve().parents[2]
        for relative in ('broker/auth.py', 'broker/driver.py', 'broker/engine.py',
                         'broker/releases.py', 'fixtures/harness.py', 'tests/test_mount_sandbox.py'):
            source = repo / 'updater' / relative
            if source.is_symlink() or not source.is_file():
                raise RuntimeError('Refusing linked qualification source')
            target = code / 'updater' / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            target.write_bytes(source.read_bytes())
            target.chmod(0o644)
            for directory in (target.parent, target.parent.parent, code):
                directory.chmod(0o755)
        env = dict(PATH=os.environ['PATH'], TMPDIR=str(workspace), PYTHONDONTWRITEBYTECODE='1')
        def drop_privileges():
            os.setgroups([])
            os.setgid(relay.pw_gid)
            os.setuid(relay.pw_uid)
        coordinator = subprocess.Popen(['/usr/bin/python3', '-m', 'updater.tests.test_mount_sandbox',
                                        '--coordinate', str(workspace)], cwd=code, env=env,
                                       preexec_fn=drop_privileges, stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, text=True)
        with selectors.DefaultSelector() as selector:
            selector.register(coordinator.stdout, selectors.EVENT_READ)
            if not selector.select(20):
                raise RuntimeError('Fixture setup deadline exceeded')
            config_path = Path(coordinator.stdout.readline(4096).strip())
        if (config_path.name != 'broker.json' or config_path.parent.parent != workspace or
                config_path.is_symlink() or not config_path.is_file()):
            raise RuntimeError('Invalid coordinator fixture path')
        config = json.loads(config_path.read_text())
        fixture = config_path.parent
        for key, suffix in (('installRoot', 'install'), ('stateRoot', 'state'), ('controlRoot', 'control')):
            if config[key] != str(fixture / suffix) or (fixture / suffix).is_symlink():
                raise RuntimeError('Refusing foreign writable mount')
        args = ['systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--unit=' + unit,
                '--property=User=relay', '--property=Group=' + str(relay.pw_gid),
                '--property=ProtectSystem=strict', '--property=ProtectHome=true',
                '--property=NoNewPrivileges=true', '--property=PrivateTmp=false',
                '--property=RuntimeMaxSec=150', '--property=TimeoutStopSec=10',
                '--property=KillMode=control-group', '--property=UMask=0077',
                '--property=ReadOnlyPaths=' + str(fixture),
                '--property=ReadWritePaths=' + ' '.join(config[k] for k in ('installRoot', 'stateRoot', 'controlRoot')),
                '--property=WorkingDirectory=' + str(code),
                '--setenv=PATH=' + env['PATH'], '--setenv=TMPDIR=' + str(workspace),
                '--setenv=PYTHONDONTWRITEBYTECODE=1', '/usr/bin/python3', '-m',
                'updater.tests.test_mount_sandbox', '--mounted-child', str(config_path)]
        subprocess.run(args, check=True, timeout=165)
    finally:
        # Only the unpredictable unit created by this invocation is addressed.
        subprocess.run(['systemctl', 'stop', unit], check=False, timeout=20,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['systemctl', 'reset-failed', unit], check=False, timeout=10,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        stopped = subprocess.run(['systemctl', 'show', unit, '--property=ActiveState', '--value'],
                                 check=False, timeout=10, capture_output=True, text=True)
        if stopped.stdout.strip() not in ('', 'inactive', 'failed'):
            raise RuntimeError('Fixture service still active; retaining fixture for inspection')
        if coordinator is not None:
            coordinator.stdin.close()
            try:
                coordinator.wait(timeout=15)
            except subprocess.TimeoutExpired:
                coordinator.kill()
                coordinator.wait(timeout=5)
            coordinator.stdout.close()
        if (parent.parent != Path('/tmp') or parent.is_symlink() or
                parent.stat().st_uid != 0 or (parent / '.qualification').read_text() != QUALIFICATION_MARKER):
            raise RuntimeError('Refusing cleanup of foreign fixture')
        shutil.rmtree(parent)
        if parent.exists():
            raise RuntimeError('Fixture cleanup incomplete')


if __name__ == '__main__':
    import sys
    if sys.argv[1:] == ['--disposable-github-systemd']:
        run_systemd_qualification()
    elif len(sys.argv) == 3 and sys.argv[1] == '--coordinate':
        coordinate(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == '--mounted-child':
        mounted_lifecycle(sys.argv[2])
    else:
        unittest.main()
