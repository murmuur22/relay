"""Local harness regressions, NOT evidence of GitHub signatures or systemd execution."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def qualifier():
    path = ROOT / 'deploy/qualify-upgrade.py'
    assert path.is_file(), 'Missing guarded signed-version upgrade qualifier'
    spec = importlib.util.spec_from_file_location('relay_upgrade', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class UpgradeQualificationTests(unittest.TestCase):
    def test_explicit_target_is_admitted_only_after_production_verification(self):
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import Mock
        q = qualifier()
        self.assertTrue(hasattr(q, 'select_target'), 'Missing verified explicit candidate selection')
        with tempfile.TemporaryDirectory() as tmp:
            releases = Mock(entries={})
            engine = SimpleNamespace(mode='production', work=Path(tmp), releases=releases, available=[])
            releases.verified_manifest.side_effect = RuntimeError('bad signature')
            with self.assertRaises(RuntimeError):
                q.select_target(engine, 'v0.4.3')
            self.assertEqual(releases.entries, {})
            self.assertEqual(engine.available, [])
            releases.verified_manifest.side_effect = None
            releases.verified_manifest.return_value = {'artifact': {'size': 123}}
            q.select_target(engine, 'v0.4.3')
            self.assertEqual(list(releases.entries), ['v0.4.3'])
            self.assertEqual(engine.available[0]['size'], 123)
            self.assertTrue(engine.available[0]['verified'])
            releases.check.assert_not_called()
            engine.mode = 'fixture'
            with self.assertRaises(q.install.InstallError):
                q.select_target(engine, 'v0.4.3')

    def test_http_consent_and_job_failure_are_not_reported_as_success(self):
        q = qualifier()
        self.assertTrue(hasattr(q, 'mutate'), 'Missing actual HTTP consent path')
        with patch.object(q.base, 'http', side_effect=[(200, {'authenticated': True, 'csrf': 'csrf'}, ''), (200, {'job': {'id': 'id'}}, '')]) as http:
            self.assertEqual(q.mutate('install', 'relay_session=r', 'relay_updater_session=u', 'secret', version='v0.4.3'), 'id')
            self.assertEqual(http.call_args.args, (4191, '/updater/api/install', 'POST', {'confirmed': True, 'password': 'secret', 'version': 'v0.4.3'}, 'relay_session=r; relay_updater_session=u', 'csrf'))
        with patch.object(q.base, 'http', return_value=(403, {}, '')):
            with self.assertRaises(q.install.InstallError):
                q.mutate('install', 'r', 'u', 'secret', version='v0.4.3')
        self.assertTrue(hasattr(q, 'wait_job'), 'Missing bounded actual job polling')
        for phase in ('failed', 'rolled-back', 'rollback-failed', 'cancelled', 'interrupted'):
            with patch.object(q.base, 'http', return_value=(200, {'job': {'id': 'id', 'phase': phase}}, '')):
                with self.subTest(phase=phase), self.assertRaises(q.install.InstallError):
                    q.wait_job('u', 'id', 'succeeded')
        with patch.object(q.base, 'http', return_value=(200, {'job': {'id': 'id', 'phase': 'succeeded', 'outcome': 'succeeded'}}, '')):
            self.assertEqual(q.wait_job('u', 'id', 'succeeded')['job']['phase'], 'succeeded')

    def test_hardened_worker_and_protected_tree_comparison(self):
        import tempfile
        q = qualifier()
        self.assertTrue(hasattr(q, 'worker_command'), 'Missing hardened old-engine worker')
        command = q.worker_command('v0.4.2', 'v0.4.3', None)
        for token in ('--wait', '--pipe', '--collect', '--property=ProtectSystem=strict', '--property=NoNewPrivileges=true', '--property=RuntimeMaxSec=900', '/opt/relay-qualification/qualify-upgrade.py', '--installed-worker'):
            self.assertIn(token, command)
        self.assertNotIn('/opt/relay/current', command)
        self.assertIn('--setenv=PYTHONDONTWRITEBYTECODE=1', command)
        self.assertTrue(hasattr(q, 'fingerprint'), 'Missing byte and metadata preservation checks')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'file').write_bytes(b'baseline')
            before = q.fingerprint(root)
            (root / 'file').write_bytes(b'changed')
            self.assertNotEqual(q.fingerprint(root), before)
            (root / 'file').write_bytes(b'baseline')
            (root / 'file').chmod(0o444)
            self.assertNotEqual(q.fingerprint(root), before)
            (root / 'link').symlink_to(root / 'file')
            with self.assertRaises(q.install.InstallError):
                q.fingerprint(root)
        # Private internal worker cannot be used as a general existing-host tool.
        self.assertTrue(hasattr(q, 'installed_worker'), 'Missing installed-engine lifecycle')
        with patch.dict(q.os.environ, {}, clear=True), patch.object(q, 'load_installed') as load:
            with self.assertRaises(q.install.InstallError):
                q.installed_worker(True, 'v0.4.2', 'v0.4.3', None)
            load.assert_not_called()

    def test_parent_guard_precedes_all_installation_and_dispatch_is_opt_in(self):
        from types import SimpleNamespace
        q = qualifier()
        self.assertTrue(hasattr(q, 'qualify'), 'Missing runnable fresh-host upgrade coordinator')
        args = SimpleNamespace(apply=True, upgrade_from='v0.4.2', version='v0.4.3', private_lan=None, release_dir='/unused')
        with patch.object(q, 'guard', side_effect=q.install.InstallError('existing host')), patch.object(q.install, 'prepare') as prepare, patch.object(q.install, 'write_new') as write:
            with self.assertRaises(q.install.InstallError):
                q.qualify(args)
            prepare.assert_not_called()
            write.assert_not_called()
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertIn('upgrade-from:', workflow)
        self.assertIn('qualify-upgrade.py', workflow)
        self.assertIn("inputs['upgrade-from'] != ''", workflow)
        self.assertIn('RELAY_DISPOSABLE_SIGNED_UPGRADE=I_ACCEPT_FRESH_HOST_SIGNED_UPGRADE_AND_ROLLBACK', workflow)
        self.assertIn('network-mode: [loopback, private-lan]', workflow)
        self.assertIn('deploy/qualify-systemd.py --release-dir', workflow)

    def test_only_explicit_hosted_fresh_v042_upgrade_is_admitted(self):
        q = qualifier()
        with patch.dict(q.os.environ, {}, clear=True), patch.object(q.base, 'guard') as fresh:
            with self.assertRaises(q.install.InstallError):
                q.guard(True, 'v0.4.2', 'v0.4.3', None)
            fresh.assert_not_called()
        with patch.dict(q.os.environ, q.UPGRADE_ENV, clear=True), patch.object(q.base, 'guard') as fresh, patch.object(q.install, 'require_absent') as absent, patch.object(q.install, 'run', return_value='not-found'):
            for old, target in [('v0.4.1', 'v0.4.3'), ('v0.4.2', 'v0.4.2'), ('v0.4.2', 'v0.4.1'), ('v0.4.2', 'v0.4.3-rc1'), ('v0.4.2', 'v0.04.3'), ('v0.4.2', 'v0.4.3\n')]:
                with self.subTest(old=old, target=target), self.assertRaises(q.install.InstallError):
                    q.guard(True, old, target, None)
            fresh.assert_not_called()
            q.guard(True, 'v0.4.2', 'v0.4.3', None)
            fresh.assert_called_once_with(True, None)
            absent.assert_any_call(q.HARNESS)
            absent.assert_any_call(Path('/etc/systemd/system') / (q.UNIT + '.d'))

    def test_cli_refuses_real_local_invocation_without_host_mutation(self):
        import subprocess
        import sys
        result = subprocess.run([sys.executable, str(ROOT / 'deploy/qualify-upgrade.py'),
                                 '--release-dir', '/nonexistent', '--upgrade-from', 'v0.4.2',
                                 '--version', 'v0.4.3', '--apply'], env={'PATH': '/usr/bin:/bin'},
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn('refused/failed', result.stderr)
        self.assertNotIn('passed', result.stdout)
