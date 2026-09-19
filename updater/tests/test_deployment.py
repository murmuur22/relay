"""Deployment tests use temporary files only; never install or contact production."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def installer():
    path = ROOT / 'deploy/install-release.py'
    assert path.is_file(), 'Missing real release installer'
    spec = importlib.util.spec_from_file_location('relay_install', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DeploymentTests(unittest.TestCase):
    def test_anonymous_provenance_and_both_payloads(self):
        import hashlib
        import json
        from unittest.mock import patch
        m = installer()
        self.assertTrue(hasattr(m, 'verify_release'), 'Missing both-artifact verification')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            manifest = dict(protocol=1, repository='murmuur22/relay', version='v0.4.0',
                            platform='linux-x64', stateSchema=1, rollbackCompatible=True,
                            minimumNode='26.8.1')
            for key, name in [('artifact', 'relay-linux-x64.tar.gz'),
                              ('updaterArtifact', 'relay-updater-linux-x64.tar.gz')]:
                (root / name).write_bytes(b'payload')
                manifest[key] = dict(name=name, size=7, sha256=hashlib.sha256(b'payload').hexdigest())
            (root / 'relay-release.json').write_text(json.dumps(manifest))
            (root / 'relay-release.attestation.json').write_text('{}')
            homes = []
            def anonymous_command(*args, home=None, **kwargs):
                assert home is not None, 'Sigstore requires a private writable credential-free HOME'
                self.assertTrue(Path(home).is_dir())
                self.assertEqual(Path(home).stat().st_mode & 0o777, 0o700)
                homes.append(Path(home))
                return ''
            with patch.object(m, 'run', side_effect=anonymous_command) as command:
                self.assertEqual(m.verify_release(root, 'v0.4.0', '/usr/bin/gh'), manifest)
                self.assertTrue(all(not home.exists() for home in homes))
                argv = command.call_args.args[0]
                self.assertIn('--bundle', argv)
                self.assertIn('--deny-self-hosted-runners', argv)
                self.assertIn('refs/tags/v0.4.0', argv)
                self.assertIn('murmuur22/relay/.github/workflows/release.yml', argv)
                self.assertFalse(any(k in m.SAFE_ENV for k in ('GH_TOKEN', 'GITHUB_TOKEN')))
                (root / manifest['updaterArtifact']['name']).write_bytes(b'corrupt')
                with self.assertRaises(m.InstallError):
                    m.verify_release(root, 'v0.4.0', '/usr/bin/gh')
                (root / manifest['updaterArtifact']['name']).unlink()
                (root / manifest['updaterArtifact']['name']).symlink_to(root / manifest['artifact']['name'])
                with self.assertRaises(m.InstallError):
                    m.verify_release(root, 'v0.4.0', '/usr/bin/gh')

    def test_fresh_host_accounts_ownership_and_units(self):
        from unittest.mock import patch
        m = installer()
        self.assertTrue(hasattr(m, 'host_conflicts'), 'Missing fresh-host preflight')
        with patch.object(m.pwd, 'getpwnam', return_value=object()):
            with self.assertRaises(m.InstallError):
                m.host_conflicts()
        self.assertTrue(hasattr(m, 'trusted_path'), 'Missing prerequisite ownership validation')
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp).resolve() / 'node'
            p.write_text('tool')
            p.chmod(0o777)
            with self.assertRaises(m.InstallError):
                m.trusted_path(p)
        relay = (ROOT / 'deploy/relay.service').read_text()
        web = (ROOT / 'updater/web/relay-updater-web.service').read_text()
        self.assertIn('ExecStart=/usr/bin/node ', relay)
        self.assertIn('RELAY_MAINTENANCE_FILE=/var/lib/relay-updater-control/maintenance', relay)
        self.assertIn('SupplementaryGroups=relay-updater-socket', relay)
        self.assertIn('ExecStart=/usr/bin/node /opt/relay-updater/updater/web/index.mjs', web)
        for text, user in [(relay, 'relay'), (web, 'relay-updater-web')]:
            self.assertIn('User=' + user + '\n', text)
            self.assertIn('NoNewPrivileges=true', text)
            self.assertIn('ProtectSystem=strict', text)
        self.assertIn('InaccessiblePaths=-/var/lib/relay', web)

    def test_plan_never_applies_and_staging_rejects_archive_escape(self):
        from unittest.mock import patch
        import io
        import tarfile
        m = installer()
        self.assertTrue(hasattr(m, 'main'), 'Missing runnable inspect/apply CLI')
        with patch.object(m, 'prepare') as prepare, patch.object(m, 'apply_install') as apply:
            prepare.return_value.__enter__.return_value = (Path('/synthetic'), {})
            m.main(['--release-dir', '/synthetic', '--version', 'v0.4.0'])
            apply.assert_not_called()
            m.main(['--release-dir', '/synthetic', '--version', 'v0.4.0', '--apply'])
            apply.assert_called_once()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            archive = root / 'evil.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                member = tarfile.TarInfo('../escape')
                member.size = 1
                tar.addfile(member, io.BytesIO(b'x'))
            with self.assertRaises(Exception):
                m.extract(archive, root / 'stage')
            self.assertFalse((root / 'escape').exists())

    def test_qualification_requires_explicit_hosted_disposable_guard(self):
        from unittest.mock import patch
        path = ROOT / 'deploy/qualify-systemd.py'
        self.assertTrue(path.exists(), 'Missing executable systemd qualification')
        spec = importlib.util.spec_from_file_location('relay_qualify', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with patch.dict(module.os.environ, {}, clear=True):
            with self.assertRaises(module.install.InstallError):
                module.guard(True)
        with patch.dict(module.os.environ, {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                                           'RELAY_DISPOSABLE_SYSTEMD': 'I_ACCEPT_DISPOSABLE_HOST_MUTATION'}, clear=True):
            with self.assertRaises(module.install.InstallError):
                module.guard(False)

    def test_preflight_refuses_loaded_unit_even_without_unit_file(self):
        from unittest.mock import patch
        m = installer()
        with patch.object(m.pwd, 'getpwnam', side_effect=KeyError), patch.object(m.grp, 'getgrnam', side_effect=KeyError), patch.object(m, 'require_absent'), patch.object(m, 'trusted_path'), patch.object(m.os.path, 'lexists', return_value=False), patch.object(m, 'run', return_value='loaded'):
            with self.assertRaises(m.InstallError):
                m.host_conflicts()

    def test_control_plane_waits_for_real_socket_and_web_readiness(self):
        from unittest.mock import patch
        path = ROOT / 'deploy/qualify-systemd.py'
        spec = importlib.util.spec_from_file_location('relay_qualify_wait', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(hasattr(module, 'wait_control'), 'Missing bounded control-plane readiness')
        with patch.object(module, 'http', side_effect=[ConnectionRefusedError(), (200, {'authenticated': False}, '')]) as request, patch.object(module, 'socket_ready', return_value=True), patch.object(module.time, 'sleep'):
            module.wait_control()
            self.assertEqual(request.call_count, 2)

    def test_control_socket_readiness_requires_a_live_listener(self):
        import socket
        path = ROOT / 'deploy/qualify-systemd.py'
        spec = importlib.util.spec_from_file_location('relay_qualify_socket', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(hasattr(module, 'socket_ready'), 'Missing live socket readiness')
        with tempfile.TemporaryDirectory() as tmp:
            target = str(Path(tmp) / 'broker.sock')
            self.assertFalse(module.socket_ready(target))
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(target)
                self.assertFalse(module.socket_ready(target))
                listener.listen(1)
                self.assertTrue(module.socket_ready(target))

    def test_verified_snapshot_stages_both_real_archives_without_host_mutations(self):
        import argparse
        import hashlib
        import io
        import json
        import tarfile
        from unittest.mock import patch
        m = installer()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            required = {
                'artifact': (m.FILES[2], ('server/index.mjs', 'dist/index.html', 'node_modules/playwright/package.json',
                                        'browsers/marker', 'tools/icon-normalize.py', 'updater/web/broker-client.mjs')),
                'updaterArtifact': (m.FILES[3], ('updater/broker/enroll.py', 'updater/broker/server.py',
                                                'updater/web/index.mjs', 'updater/ui/dist/index.html', *m.UNIT_SOURCES.values()))}
            manifest = dict(protocol=1, repository='murmuur22/relay', version='v0.4.0', platform='linux-x64',
                            stateSchema=1, rollbackCompatible=True, minimumNode='26.8.1')
            for key, (name, files) in required.items():
                with tarfile.open(root / name, 'w:gz') as tar:
                    for filename in (*files, 'package.json'):
                        data = b'{"version":"0.4.0"}' if filename == 'package.json' else b'synthetic test content'
                        entry = tarfile.TarInfo(filename)
                        entry.size, entry.mode = len(data), 0o644
                        tar.addfile(entry, io.BytesIO(data))
                raw = (root / name).read_bytes()
                manifest[key] = dict(name=name, size=len(raw), sha256=hashlib.sha256(raw).hexdigest())
            (root / m.FILES[0]).write_text(json.dumps(manifest))
            (root / m.FILES[1]).write_text('{}')
            args = argparse.Namespace(release_dir=str(root), version='v0.4.0', apply=False)
            # Only the external attestation process and Linux host inspection are doubles.
            # Snapshot, digest/size verification, tar extraction and shape validation are real.
            with patch.object(m, 'preflight_host'), patch.object(m, 'run') as command:
                with m.prepare(args) as (work, result):
                    self.assertEqual(result, manifest)
                    self.assertEqual((work / 'control/updater/web/index.mjs').read_bytes(), b'synthetic test content')
                    self.assertEqual((work / 'runtime/package.json').read_text(), '{"version":"0.4.0"}')
                    self.assertEqual(command.call_count, 1)
                    self.assertEqual(command.call_args.args[0][1:3], ['attestation', 'verify'])
                self.assertFalse(work.exists())

    def test_restore_probe_runs_under_broker_equivalent_systemd_hardening(self):
        path = ROOT / 'deploy/qualify-systemd.py'
        spec = importlib.util.spec_from_file_location('relay_qualify_hardening', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(hasattr(module, 'restore_command'), 'Restore probe must run in hardened systemd namespace')
        command = module.restore_command('v0.4.0')
        self.assertEqual(command[0], '/usr/bin/systemd-run')
        self.assertIn('--property=ProtectSystem=strict', command)
        self.assertIn('--property=NoNewPrivileges=true', command)
        self.assertIn('--property=ReadWritePaths=/opt/relay /var/lib/relay /var/lib/relay-updater /var/lib/relay-updater-control /run/relay-updater-control', command)
        self.assertIn('/opt/relay-updater/deploy/qualify-systemd.py', command)
        self.assertIn('--restore-baseline', command)
        self.assertIn('--wait', command)

    def test_apply_rechecks_conflicts_before_any_command(self):
        from unittest.mock import patch
        m = installer()
        with patch.object(m.os, 'geteuid', return_value=0), patch.object(m, 'host_conflicts', side_effect=m.InstallError('conflict')), patch.object(m, 'run') as command:
            with self.assertRaises(m.InstallError):
                m.apply_install(Path('/unused'), {}, 'v0.4.0')
            command.assert_not_called()

    def test_verification_failure_does_not_extract_or_mutate(self):
        import argparse
        from unittest.mock import patch
        m = installer()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            for name in m.FILES:
                (root / name).write_bytes(b'untrusted')
            args = argparse.Namespace(release_dir=str(root), version='v0.4.0', apply=False)
            with patch.object(m, 'preflight_host'), patch.object(m, 'verify_release', side_effect=m.InstallError('bad signature')), patch.object(m, 'extract') as extract:
                with self.assertRaises(m.InstallError):
                    with m.prepare(args):
                        self.fail('Unverified payload accepted')
                extract.assert_not_called()

    def test_qualification_http_uses_exact_host_and_does_not_follow_redirect(self):
        import json
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading
        path = ROOT / 'deploy/qualify-systemd.py'
        spec = importlib.util.spec_from_file_location('relay_qualify_http', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        seen = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                seen.append((self.headers['Host'], self.headers['Origin']))
                self.send_response(302)
                self.send_header('Location', 'http://example.invalid/forbidden')
                self.end_headers()
                self.wfile.write(json.dumps({'redirect': True}).encode())
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_port
            self.assertEqual(module.http(port, '/health/ready')[0], 302)
            self.assertEqual(seen, [(f'localhost:{port}', f'http://localhost:{port}')])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_refuse_existing_and_symlink_ancestors(self):
        m = installer()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            m.require_absent(root / 'new')
            (root / 'existing').mkdir()
            with self.assertRaises(m.InstallError):
                m.require_absent(root / 'existing')
            (root / 'link').symlink_to(root / 'existing')
            with self.assertRaises(m.InstallError):
                m.require_absent(root / 'link' / 'child')
            (root / 'dangling').symlink_to(root / 'missing')
            with self.assertRaises(m.InstallError):
                m.require_absent(root / 'dangling')


if __name__ == '__main__':
    unittest.main()
