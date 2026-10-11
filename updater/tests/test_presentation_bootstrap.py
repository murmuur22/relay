"""Disposable local guard/file tests. NOT hosted/signed/systemd evidence."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = os.environ.get('TMPDIR', str(Path.home()))


def qualifier():
    path = ROOT / 'deploy/qualify-presentation-bootstrap.py'
    assert path.is_file(), 'Missing narrow disposable bootstrap qualifier'
    spec = importlib.util.spec_from_file_location('relay_bootstrap_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BootstrapTests(unittest.TestCase):
    def test_complete_seven_broker_hashes_are_public_source_readback_not_private_state(self):
        import hashlib
        q = qualifier()
        self.assertTrue(hasattr(q, 'broker_hashes'), 'Missing full broker source hash evidence')
        with tempfile.TemporaryDirectory(dir=SCRATCH) as tmp:
            root = Path(tmp).resolve()
            (root / 'updater/broker').mkdir(parents=True)
            for name in q.BROKER_FILES:
                (root / name).write_bytes(name.encode())
            before = q.broker_hashes(root, uid=os.getuid())
            self.assertEqual(set(before), set(q.BROKER_FILES))
            self.assertEqual(before[q.BROKER_FILES[0]], hashlib.sha256(q.BROKER_FILES[0].encode()).hexdigest())
            (root / q.BROKER_FILES[0]).write_bytes(b'changed')
            self.assertNotEqual(q.broker_hashes(root, uid=os.getuid()), before)
            (root / 'updater/broker/extra.py').write_bytes(b'extra')
            with self.assertRaises(q.base.install.InstallError):
                q.broker_hashes(root, uid=os.getuid())

    def test_bootstrap_http_security_probe_requires_csp_host_origin_and_owner_denials(self):
        from unittest.mock import patch
        q = qualifier()
        self.assertTrue(hasattr(q, 'security_probe'), 'Missing genuine HTTP security/readiness probes')
        calls = []
        def raw(port, path, method='GET', data=None, cookie='', csrf='', headers=None):
            calls.append((path, cookie, headers))
            if headers:
                return 403, b'{}', {}
            return 200, b'fallback', {'content-security-policy': "frame-ancestors http://localhost:4180", 'x-relay-updater-presentation': 'builtin'}
        def http(port, path, method='GET', data=None, cookie='', csrf=''):
            if path == '/updater/api/state' and not cookie:
                return 401, {}, ''
            if path == '/api/updater/launch':
                return 200, {'url': 'http://localhost:4191/updater/#real-ticket-seam'}, ''
            if path == '/updater/api/exchange':
                return (401 if not cookie else 403), {}, ''
            if path == '/updater/api/auth':
                if cookie == 'relay_updater_session=monitor':
                    return 401, {}, ''
                return 200, {'authenticated': bool(cookie), 'csrf': 'csrf'}, ''
            if path == '/updater/api/install':
                return 403, {}, ''
            if path == '/updater/api/logout':
                return (200 if csrf == 'csrf' else 403), {}, ''
            raise AssertionError(path)
        with patch.object(q.base, 'raw_http', side_effect=raw), patch.object(q.base, 'http', side_effect=http), \
             patch.object(q.base, 'launch_monitor', return_value='relay_updater_session=monitor'):
            q.security_probe('relay_session=owner', 'csrf')
        self.assertTrue(any(headers == {'Host': 'evil.example:4191'} for _, _, headers in calls))
        self.assertTrue(any(headers == {'Origin': 'http://evil.example:4191'} for _, _, headers in calls))
        for bad_csp in ('frame-ancestors http://localhost:4180 http://evil.example', "frame-ancestors 'none'"):
            def bad_raw(port, path, **kwargs):
                if kwargs.get('headers'):
                    return 403, b'{}', {}
                return 200, b'fallback', {'content-security-policy': bad_csp, 'x-relay-updater-presentation': 'builtin'}
            with patch.object(q.base, 'raw_http', side_effect=bad_raw), patch.object(q.base, 'http', side_effect=http), \
                 patch.object(q.base, 'launch_monitor', return_value='relay_updater_session=monitor'), \
                 self.assertRaises(q.base.install.InstallError):
                q.security_probe('relay_session=owner', 'csrf')
        with patch.object(q.base, 'raw_http', return_value=(200, b'fallback', {'x-frame-options': 'DENY'})):
            with self.assertRaises(q.base.install.InstallError):
                q.security_probe('relay_session=owner', 'csrf')

    def test_bootstrap_rehearsal_restores_interruption_and_failed_start_before_final_apply(self):
        q = qualifier()
        self.assertTrue(hasattr(q, 'rehearse_bootstrap'), 'Missing interruption/start-failure/restore cycle')
        with tempfile.TemporaryDirectory(dir=SCRATCH) as tmp:
            root = Path(tmp).resolve()
            control, candidate = root / 'control', root / 'candidate'
            for tree in (control, candidate):
                (tree / 'updater/web').mkdir(parents=True)
                (tree / 'updater/broker').mkdir()
                for name in q.BROKER_FILES:
                    (tree / name).write_bytes(b'broker')
                for name in ('index.mjs', 'broker-client.mjs'):
                    (tree / 'updater/web' / name).write_bytes(b'web')
            (control / q.CHANGES[0]).write_bytes(b'old')
            (candidate / q.CHANGES[0]).write_bytes(b'new')
            (candidate / q.CHANGES[1]).write_bytes(b'reader')
            config = root / 'config'
            config.mkdir()
            (config / 'private.json').write_bytes(b'synthetic private config')
            unit = root / 'web.service'
            unit.write_bytes(b'unchanged unit')
            events = []
            def start():
                events.append('start-web')
            def health(new):
                events.append('new-ready' if new else 'old-ready')
            def failure():
                events.append('actual-start-failure-seam')
                raise OSError('fixture start denied')
            expected = q.rehearse_bootstrap(control, candidate, root / 'rehearsal',
                {'config': config, 'web.service': unit}, lambda: events.append('stop-web'), start, health, failure,
                uid=os.getuid())
            self.assertEqual(events.count('old-ready'), 2)
            self.assertEqual(events[-1], 'new-ready')
            q.admit_baseline(control, expected, uid=os.getuid())
            for cycle in ('interruption', 'startup-failure', 'final'):
                self.assertEqual((root / 'rehearsal' / cycle / 'config/private.json').read_bytes(), b'synthetic private config')
                self.assertEqual((root / 'rehearsal' / cycle / 'web.service').read_bytes(), b'unchanged unit')
            self.assertEqual((control / q.CHANGES[0]).read_bytes(), b'new')
            self.assertEqual((control / q.CHANGES[1]).read_bytes(), b'reader')

    def test_candidate_signature_failure_precedes_transfer_extract_and_web_stop(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch
        q = qualifier()
        self.assertTrue(hasattr(q, 'download_candidate'), 'Missing anonymous official candidate archive path')
        releases = Mock(fixture=False)
        releases.verified_manifest.side_effect = RuntimeError('signature denied')
        api = SimpleNamespace(transfer=Mock(), verify_artifact=Mock(), extract=Mock())
        with tempfile.TemporaryDirectory(dir=SCRATCH) as tmp:
            with self.assertRaises(RuntimeError):
                q.download_candidate(releases, api, Path(tmp).resolve() / 'public', 'v0.6.5')
        api.transfer.assert_not_called()
        api.verify_artifact.assert_not_called()
        api.extract.assert_not_called()
        self.assertTrue(hasattr(q, 'qualify_bootstrap'), 'Missing separately guarded real bootstrap qualification')
        with patch.object(q, 'guard_bootstrap', side_effect=q.base.install.InstallError('not fresh')), \
             patch.object(q, 'download_candidate') as download, patch.object(q.base, 'run') as service:
            with self.assertRaises(q.base.install.InstallError):
                q.qualify_bootstrap(True, 'v0.6.4', 'v0.6.5', None)
            download.assert_not_called()
            service.assert_not_called()

    def test_bootstrap_guard_refuses_non_disposable_before_loading_or_writing(self):
        from unittest.mock import patch
        q = qualifier()
        self.assertTrue(hasattr(q, 'guard_bootstrap'), 'Missing fresh-only bootstrap admission')
        with patch.dict(os.environ, {}, clear=True), patch.object(q, 'inventory') as read:
            with self.assertRaises(q.base.install.InstallError):
                q.guard_bootstrap(True, 'v0.6.4', 'v0.6.5', None)
            read.assert_not_called()
        with patch.object(q.base, 'guard_environment'), patch.dict(os.environ, {
            'RELAY_DISPOSABLE_SIGNED_UPGRADE': 'I_ACCEPT_FRESH_HOST_SIGNED_UPGRADE_AND_ROLLBACK'
        }, clear=True):
            for old, target in [('v0.6.2', 'v0.6.5'), ('v0.6.4', 'v0.6.6'), ('v0.6.4\n', 'v0.6.5')]:
                with self.subTest(old=old, target=target), self.assertRaises(q.base.install.InstallError):
                    q.guard_bootstrap(True, old, target, None)
            # Even otherwise-correct flags never substitute a matching protected fresh marker.
            with tempfile.TemporaryDirectory(dir=SCRATCH) as tmp, patch.object(q, 'HARNESS', Path(tmp).resolve()):
                with self.assertRaises((q.base.install.InstallError, FileNotFoundError)):
                    q.guard_bootstrap(True, 'v0.6.4', 'v0.6.5', None)

    def test_restore_refuses_unadmitted_server_and_candidate_broker_or_staging_changes(self):
        q = qualifier()
        with tempfile.TemporaryDirectory(dir=SCRATCH) as tmp:
            root = Path(tmp).resolve()
            control, candidate = root / 'control', root / 'candidate'
            for tree in (control, candidate):
                (tree / 'updater/web').mkdir(parents=True)
                (tree / 'updater/broker').mkdir()
                for name in q.BROKER_FILES:
                    (tree / name).write_bytes(b'broker')
                for name in ('index.mjs', 'broker-client.mjs'):
                    (tree / 'updater/web' / name).write_bytes(b'web')
            (control / q.CHANGES[0]).write_bytes(b'old')
            (candidate / q.CHANGES[0]).write_bytes(b'new')
            (candidate / q.CHANGES[1]).write_bytes(b'reader')
            calls = []
            (candidate / q.BROKER_FILES[0]).write_bytes(b'incompatible')
            with self.assertRaises(q.base.install.InstallError):
                q.replace_web(control, candidate, root / 'refused', lambda: calls.append('stop'), uid=os.getuid())
            self.assertEqual(calls, [])
            (candidate / q.BROKER_FILES[0]).write_bytes(b'broker')
            backup = root / 'backup'
            q.replace_web(control, candidate, backup, lambda: calls.append('stop'), uid=os.getuid())
            (control / q.CHANGES[0]).write_bytes(b'unadmitted third-party repair')
            with self.assertRaises(q.base.install.InstallError):
                q.restore_web(control, candidate, backup, lambda: calls.append('stop'), uid=os.getuid())
            self.assertEqual((control / q.CHANGES[0]).read_bytes(), b'unadmitted third-party repair')

    def test_web_only_transaction_preserves_fallback_and_full_broker_then_restores_after_interruption(self):
        q = qualifier()
        self.assertTrue(hasattr(q, 'replace_web'), 'Missing fixed-file bootstrap/backup transaction')
        with tempfile.TemporaryDirectory(dir=SCRATCH) as tmp:
            root = Path(tmp).resolve()
            control, candidate, backup = root / 'control', root / 'candidate', root / 'backup'
            for tree in (control, candidate):
                (tree / 'updater/web').mkdir(parents=True)
                (tree / 'updater/broker').mkdir()
                for name in ('auth.py', 'driver.py', 'engine.py', 'enroll.py', 'observe.py', 'releases.py', 'server.py'):
                    (tree / 'updater/broker' / name).write_bytes(b'unchanged signed broker ' + name.encode())
                for name in ('index.mjs', 'broker-client.mjs'):
                    (tree / 'updater/web' / name).write_bytes(b'unchanged ' + name.encode())
            (control / 'updater/ui/dist').mkdir(parents=True)
            (control / 'updater/ui/dist/index.html').write_bytes(b'old fallback preserved')
            (control / 'updater/web/server.mjs').write_bytes(b'old server')
            (candidate / 'updater/web/server.mjs').write_bytes(b'new server importing presentation')
            (candidate / 'updater/web/presentation.mjs').write_bytes(b'new fixed reader')
            old = q.inventory(control, uid=os.getuid())
            calls = []
            def stop():
                calls.append('stop-web')
            def start():
                calls.append('start-web')
            def interrupted(phase):
                if phase == 'server-replaced':
                    raise InterruptedError('synthetic interruption')
            with self.assertRaises(InterruptedError):
                q.replace_web(control, candidate, backup, stop, uid=os.getuid(), checkpoint=interrupted)
            self.assertEqual(calls, ['stop-web'])
            self.assertEqual((backup / 'control/updater/web/server.mjs').read_bytes(), b'old server')
            q.restore_web(control, candidate, backup, stop, uid=os.getuid())
            q.admit_baseline(control, old, uid=os.getuid())
            start()
            self.assertEqual(calls, ['stop-web', 'stop-web', 'start-web'])
            complete = root / 'complete-backup'
            q.replace_web(control, candidate, complete, stop, uid=os.getuid())
            after = q.inventory(control, uid=os.getuid())
            changed = {name for name in set(old) | set(after) if old.get(name) != after.get(name)}
            self.assertEqual(changed, {'updater/web/server.mjs', 'updater/web/presentation.mjs'})
            self.assertEqual((control / 'updater/ui/dist/index.html').read_bytes(), b'old fallback preserved')
            q.restore_web(control, candidate, complete, stop, uid=os.getuid())
            q.admit_baseline(control, old, uid=os.getuid())
            # A corrupted backup is never consumed or started.
            (complete / 'control/updater/web/server.mjs').write_bytes(b'bad backup')
            with self.assertRaises(q.base.install.InstallError):
                q.restore_web(control, candidate, complete, stop, uid=os.getuid())

    def test_inventory_checks_bytes_metadata_and_rejects_links_specials_and_extra_baseline(self):
        self.assertTrue((ROOT / 'deploy/qualify-presentation-bootstrap.py').is_file(), 'Missing narrow disposable bootstrap qualifier')
        q = qualifier()
        with tempfile.TemporaryDirectory(dir=SCRATCH) as tmp:
            root = Path(tmp).resolve()
            (root / 'file').write_bytes(b'signed baseline fixture')
            before = q.inventory(root, uid=os.getuid())
            self.assertEqual(before['file']['size'], len(b'signed baseline fixture'))
            q.admit_baseline(root, before, uid=os.getuid())
            (root / 'file').chmod(0o600)
            with self.assertRaises(q.base.install.InstallError):
                q.admit_baseline(root, before, uid=os.getuid())
            (root / 'file').chmod(0o644)
            (root / 'extra').write_bytes(b'extra')
            with self.assertRaises(q.base.install.InstallError):
                q.admit_baseline(root, before, uid=os.getuid())
            (root / 'extra').unlink()
            for kind in ('symlink', 'hardlink', 'fifo', 'writable'):
                with self.subTest(kind=kind):
                    path = root / 'unsafe'
                    if kind == 'symlink':
                        path.symlink_to(root / 'file')
                    elif kind == 'hardlink':
                        os.link(root / 'file', path)
                    elif kind == 'fifo':
                        os.mkfifo(path)
                    else:
                        path.write_bytes(b'unsafe')
                        path.chmod(0o666)
                    with self.assertRaises(q.base.install.InstallError):
                        q.inventory(root, uid=os.getuid())
                    path.unlink()
            linked = root / 'alias'
            linked.symlink_to(root, target_is_directory=True)
            with self.assertRaises(q.base.install.InstallError):
                q.inventory(linked / 'file', uid=os.getuid())
