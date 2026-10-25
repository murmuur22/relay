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
    def workflow_upgrade(self):
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        job = workflow.split('  qualify-upgrade:\n', 1)[1]
        guard = job.split('      - name: Require explicit old baseline and stable-form published target\n', 1)[1]
        guard = guard.split('        run: |\n', 1)[1].split('      - uses:', 1)[0]
        return job, '\n'.join(line[10:] for line in guard.splitlines())

    def workflow_admits(self, old, target):
        import os
        import subprocess
        _, guard = self.workflow_upgrade()
        # Check each literal predicate exit separately: macOS Bash 3.2 does not
        # reliably apply errexit to a failed [[ ... || ... ]] compound command.
        return all(subprocess.run(['bash', '-eu', '-c', predicate],
                                  env=dict(os.environ, UPGRADE_FROM=old, RELEASE_TAG=target),
                                  capture_output=True, text=True, timeout=5).returncode == 0
                   for predicate in guard.splitlines() if predicate.strip())

    def test_v068_immediate_predecessor_harness_admission(self):
        q = qualifier()
        q.validate_versions('v0.6.8', 'v0.6.9')
        self.assertEqual(q.baseline_gateway_mode('v0.6.8'), 'remote')
        config = q.gateway_reference(Path('/synthetic/backend'), remote=True)
        self.assertEqual(config['version'], 3)
        self.assertEqual(config['mode'], 'reverse-proxy')
        self.assertEqual(config['trustedProxy'], '127.0.0.1')
        self.assertEqual(config['backendTLS']['serverName'], 'backend.example.test')
        self.assertEqual(config['backendTLS']['clientName'], 'caddy.example.test')
        self.assertFalse(q.delivery_release('v0.6.8', 'v0.6.9'))
        self.assertFalse(q.delivery_release('v0.6.4', 'v0.6.9'))

    def test_v068_workflow_admission(self):
        self.assertTrue(self.workflow_admits('v0.6.8', 'v0.6.9'))
        self.assertTrue(self.workflow_admits('v0.6.4', 'v0.6.9'))

    def test_predecessor_exact_allowlist_and_version_refusals(self):
        q = qualifier()
        expected = {'v0.4.2': None, 'v0.6.1': 'direct', 'v0.6.2': 'reverse',
                    'v0.6.3': 'remote', 'v0.6.4': 'remote', 'v0.6.8': 'remote'}
        self.assertEqual(set(q.BASELINES), set(expected))
        for old, mode in expected.items():
            with self.subTest(old=old):
                q.validate_versions(old, 'v0.6.9')
                self.assertEqual(q.baseline_gateway_mode(old), mode)
                self.assertTrue(self.workflow_admits(old, 'v0.6.9'))
        for old in ('v0.6.5', 'v0.6.6', 'v0.6.7', 'v0.6.9', 'v0.06.8', 'v0.6.8\n',
                    '0.6.8', 'refs/tags/v0.6.8', 'v0.6.8-rc1', ''):
            with self.subTest(old=old):
                self.assertFalse(self.workflow_admits(old, 'v0.6.9'))
                with self.assertRaises(q.install.InstallError):
                    q.validate_versions(old, 'v0.6.9')
                with self.assertRaises(q.install.InstallError):
                    q.baseline_gateway_mode(old)
        for target in ('v0.6.9-rc1', 'v0.06.9', 'v0.6.9\n', '0.6.9', 'refs/tags/v0.6.9', ''):
            with self.subTest(target=target):
                self.assertFalse(self.workflow_admits('v0.6.8', target))
                with self.assertRaises(q.install.InstallError):
                    q.validate_versions('v0.6.8', target)
        # Ordering is enforced by the harness; the shell guard only checks tag syntax.
        for target in ('v0.6.8', 'v0.6.7', 'v0.4.2'):
            with self.subTest(target=target), self.assertRaises(q.install.InstallError):
                q.validate_versions('v0.6.8', target)

    def test_predecessor_dispatch_is_exact_repository_opt_in_and_two_modes(self):
        import os
        import subprocess
        job, _ = self.workflow_upgrade()
        condition = job.splitlines()[0].strip().removeprefix('if: ')
        condition = condition.replace('github.repository', '"$REPO"').replace('github.event_name', '"$EVENT"')
        condition = condition.replace("inputs['upgrade-from']", '"$UPGRADE_FROM"')
        for repo, event, old, expected in [('murmuur22/relay', 'workflow_dispatch', 'v0.6.8', True),
                                          ('murmuur22/relay', 'workflow_dispatch', 'v0.6.4', True),
                                          ('other/relay', 'workflow_dispatch', 'v0.6.8', False),
                                          ('murmuur22/relay', 'push', 'v0.6.8', False),
                                          ('murmuur22/relay', 'workflow_dispatch', '', False)]:
            with self.subTest(repo=repo, event=event, old=old):
                result = subprocess.run(['bash', '-eu', '-c', '[[ ' + condition + ' ]]'],
                                        env=dict(os.environ, REPO=repo, EVENT=event, UPGRADE_FROM=old),
                                        capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode == 0, expected, result.stderr)
        self.assertIn('network-mode: [loopback, private-lan]', job)
        self.assertIn('ref: ${{ inputs.version }}', job)
        self.assertIn('contents: read', job)
        self.assertNotIn('contents: write', job)
        q = qualifier()
        for address in (None, '10.20.30.40'):
            command = q.worker_command('v0.6.8', 'v0.6.9', address)
            self.assertEqual(command[command.index('--upgrade-from') + 1], 'v0.6.8')
            self.assertEqual(command[command.index('--version') + 1], 'v0.6.9')
            self.assertNotIn('--delivery-worker', command)
            self.assertIn('--property=ProtectSystem=strict', command)
            self.assertEqual('--private-lan' in command, address is not None)

    def test_predecessor_ack_and_existing_host_refuse_before_install(self):
        from types import SimpleNamespace
        q = qualifier()
        args = SimpleNamespace(apply=True, upgrade_from='v0.6.8', version='v0.6.9',
                               private_lan=None, release_dir='/unused')
        for missing in q.UPGRADE_ENV:
            env = dict(q.UPGRADE_ENV)
            del env[missing]
            with self.subTest(missing=missing), patch.dict(q.os.environ, env, clear=True), \
                    patch.object(q.base, 'guard') as fresh, patch.object(q.install, 'prepare') as prepare:
                with self.assertRaises(q.install.InstallError):
                    q.qualify(args)
                fresh.assert_not_called()
                prepare.assert_not_called()
        with patch.dict(q.os.environ, q.UPGRADE_ENV, clear=True), \
                patch.object(q.base, 'guard_environment'), \
                patch.object(q.install, 'preflight_host', side_effect=q.install.InstallError('existing host')) as preflight, \
                patch.object(q.install, 'prepare') as prepare, patch.object(q.install, 'write_new') as write:
            with self.assertRaisesRegex(q.install.InstallError, 'existing host'):
                q.qualify(args)
            preflight.assert_called_once_with(None)
            prepare.assert_not_called()
            write.assert_not_called()
        with patch.dict(q.os.environ, {}, clear=True), patch.object(q, 'load_installed') as load:
            with self.assertRaises(q.install.InstallError):
                q.installed_worker(True, 'v0.6.8', 'v0.6.9', None)
            load.assert_not_called()

    def test_frontend_qualification_keeps_timeouts_and_reports_finished_failures(self):
        for filename in ('check.yml', 'release.yml'):
            workflow = (ROOT / '.github/workflows' / filename).read_text()
            with self.subTest(workflow=filename):
                self.assertIn('--test-force-exit --test-reporter=tap --test-timeout=130000 tests/backend/private-lan*.test.mjs tests/frontend/updater*.test.mjs', workflow)
        source = (ROOT / 'tests/frontend/updater-desktop.test.mjs').read_text()
        self.assertIn('page.setDefaultTimeout(5000)', source)
        self.assertIn('timeout:10000', source)

    def test_signed_fresh_handoff_and_reads_carry_real_relay_owner_cookie(self):
        q = qualifier()
        calls = []
        def http(port, path, method='GET', body=None, cookie='', csrf=''):
            calls.append((port, path, method, body, cookie, csrf))
            if path == '/api/updater/state':
                return 200, {}, ''
            if path == '/api/updater/launch':
                return 200, {'url': f"http://{q.base.NETWORK['hostname']}:4191/updater/#one-use"}, ''
            if path == '/updater/api/exchange':
                if cookie != 'relay_session=owner':
                    return 401, {}, ''
                exchanges = [c for c in calls if c[1] == path and c[4] == cookie]
                return (200, {}, 'relay_updater_session=monitor') if len(exchanges) == 1 else (403, {}, '')
            if path == '/updater/api/state':
                return (200 if cookie == 'relay_session=owner; relay_updater_session=monitor' else 401), {}, ''
            raise AssertionError(path)
        with patch.object(q.base, 'http', side_effect=http):
            monitor = q.base.launch_monitor('relay_session=owner', 'csrf')
            self.assertEqual(monitor, 'relay_updater_session=monitor')
            self.assertEqual(q.base.monitor_state('relay_session=owner', monitor)[0], 200)
        exchange = [c for c in calls if c[1] == '/updater/api/exchange']
        self.assertEqual([c[4] for c in exchange], ['relay_session=owner', 'relay_session=owner'])

    def test_post_rollback_retention_reads_only_http_after_candidate_is_absent(self):
        q = qualifier()
        self.assertTrue(hasattr(q, 'retained_presentation'), 'Missing post-deletion lazy asset probe')
        pin = {'index.html': b'new index', 'assets/lazy-HASH.js': b'lazy', 'assets/font-HASH.woff2': b'font'}
        def raw(port, path):
            if path == '/updater/':
                return 200, b'old fallback', {'x-relay-updater-presentation': 'builtin'}
            name = path.removeprefix('/updater/presentation/v0.6.5/')
            return 200, pin[name], {}
        with patch.object(q.base, 'raw_http', side_effect=raw) as request:
            q.retained_presentation('v0.6.5', pin, b'old fallback')
            self.assertEqual(request.call_count, 3)
        def bad_lazy(port, path):
            if path == '/updater/':
                return raw(port, path)
            return 200, b'bad lazy bytes', {}
        with patch.object(q.base, 'raw_http', side_effect=bad_lazy):
            with self.assertRaises(q.install.InstallError):
                q.retained_presentation('v0.6.5', pin, b'old fallback')
        with patch.object(q.base, 'raw_http', return_value=(200, b'bad', {'x-relay-updater-presentation': 'builtin'})):
            with self.assertRaises(q.install.InstallError):
                q.retained_presentation('v0.6.5', pin, b'old fallback')

    def test_delivery_cycle_is_separate_and_uses_guarded_second_worker_not_old_path(self):
        q = qualifier()
        self.assertTrue(hasattr(q, 'delivery_release'), 'Missing separate UI-delivery qualification cycle')
        self.assertTrue(q.delivery_release('v0.6.4', 'v0.6.5'))
        self.assertTrue(q.delivery_release('v0.6.3', 'v0.6.5'))
        self.assertFalse(q.delivery_release('v0.6.3', 'v0.6.4'))
        self.assertFalse(q.delivery_release('v0.6.2', 'v0.6.3'))
        self.assertNotIn('--delivery-worker', q.worker_command('v0.6.3', 'v0.6.4', None))
        self.assertIn('--delivery-worker', q.worker_command('v0.6.4', 'v0.6.5', None, delivery=True))
        with patch.dict(q.os.environ, {}, clear=True), patch.object(q, 'load_installed') as load:
            with self.assertRaises(q.install.InstallError):
                q.installed_worker(True, 'v0.6.4', 'v0.6.5', None, delivery=True)
            load.assert_not_called()
        source = (ROOT / 'deploy/qualify-upgrade.py').read_text()
        self.assertIn('qualify_bootstrap(args.apply', source)
        self.assertIn('retained_presentation(target, pin,', source)
        self.assertIn('base.service_identity(\'relay-updater-web.service\') == web_identity', source)

    def test_signed_upgrade_auth_and_poll_keep_original_owner_cookie(self):
        q = qualifier()
        with patch.object(q.base, 'http', side_effect=[
            (200, {'authenticated': True, 'csrf': 'csrf'}, ''),
            (200, {'job': {'id': 'id'}}, '')
        ]) as http:
            q.mutate('install', 'relay_session=owner', 'relay_updater_session=monitor', 'secret', version='v0.6.5')
            self.assertEqual(http.call_args_list[0].kwargs['cookie'], 'relay_session=owner; relay_updater_session=monitor')
        with patch.object(q.base, 'http', return_value=(200, {'job': {'id': 'id', 'phase': 'succeeded', 'outcome': 'succeeded'}}, '')) as http:
            q.wait_job('relay_updater_session=monitor', 'id', 'succeeded', cookie='relay_session=owner')
            self.assertEqual(http.call_args.kwargs['cookie'], 'relay_session=owner; relay_updater_session=monitor')

    def test_process_identity_requires_live_pid_and_start_and_fresh_probe_is_version_scoped(self):
        q = qualifier()
        self.assertTrue(hasattr(q.base, 'service_identity'), 'Missing actual unchanged web PID/start check')
        with patch.object(q.base, 'run', return_value='MainPID=123\nExecMainStartTimestampMonotonic=456\nActiveState=active'):
            self.assertEqual(q.base.service_identity('relay-updater-web.service'), ('123', '456'))
        for response in ('MainPID=0\nExecMainStartTimestampMonotonic=456\nActiveState=inactive',
                         'MainPID=123\nExecMainStartTimestampMonotonic=0\nActiveState=active'):
            with patch.object(q.base, 'run', return_value=response), self.assertRaises(q.install.InstallError):
                q.base.service_identity('relay-updater-web.service')
        self.assertFalse(q.base.presentation_required('v0.6.4'))
        self.assertTrue(q.base.presentation_required('v0.6.5'))
        self.assertTrue(q.base.presentation_required('v0.7.0'))
        with self.assertRaises(q.install.InstallError):
            q.base.presentation_required('v0.6.5\n')
        # The dispatch path must exercise this probe, not just ship a helper.
        self.assertIn('presentation_probe(args.version)', (ROOT / 'deploy/qualify-systemd.py').read_text())

    def test_runtime_presentation_probe_reads_real_http_index_and_every_descriptor_byte(self):
        import hashlib
        import json
        import tempfile
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        q = qualifier()
        self.assertTrue(hasattr(q.base, 'presentation_probe'), 'Missing actual runtime-presentation HTTP qualification')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'assets').mkdir()
            blobs = {'index.html': b'<script src="/updater/presentation/v0.6.5/assets/index-HASH.js"></script>',
                     'assets/index-HASH.js': b'console.log("synthetic")', 'assets/lazy-HASH.js': b'lazy bytes'}
            files = []
            for name, raw in blobs.items():
                (root / name).write_bytes(raw)
                files.append(dict(path=name, size=len(raw), sha256=hashlib.sha256(raw).hexdigest()))
            descriptor = dict(schema=1, webApi=1, version='v0.6.5', files=files)
            (root / 'presentation.json').write_text(json.dumps(descriptor))
            requests = []
            broken = {'marker': False, 'bytes': False}
            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *args):
                    pass
                def do_GET(self):
                    requests.append(self.path)
                    name = 'index.html' if self.path == '/updater/' else self.path.removeprefix('/updater/presentation/v0.6.5/')
                    self.send_response(200)
                    self.send_header('X-Relay-Updater-Presentation', 'builtin' if broken['marker'] else 'v0.6.5')
                    self.end_headers()
                    self.wfile.write(b'corrupt' if broken['bytes'] and name.startswith('assets/') else blobs[name])
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                pin = q.base.presentation_probe('v0.6.5', root, port=server.server_port)
                self.assertEqual(pin, blobs)
                self.assertIn('/updater/presentation/v0.6.5/assets/lazy-HASH.js', requests)
                requests.clear()
                self.assertEqual(q.base.presentation_probe('v0.6.5', root, port=server.server_port, defer_lazy=True), blobs)
                self.assertNotIn('/updater/presentation/v0.6.5/assets/lazy-HASH.js', requests)
                self.assertIn('/updater/presentation/v0.6.5/assets/index-HASH.js', requests)
                for key in broken:
                    broken[key] = True
                    with self.subTest(key=key), self.assertRaises(q.install.InstallError):
                        q.base.presentation_probe('v0.6.5', root, port=server.server_port)
                    broken[key] = False
                descriptor['webApi'] = 2
                (root / 'presentation.json').write_text(json.dumps(descriptor))
                with self.assertRaises(q.install.InstallError):
                    q.base.presentation_probe('v0.6.5', root, port=server.server_port)
            finally:
                server.shutdown()
                thread.join(5)
                server.server_close()

    def test_v064_baseline_admits_ui_delivery_without_changing_v063_gateway_path(self):
        q = qualifier()
        q.validate_versions('v0.6.4', 'v0.6.5')
        self.assertEqual(q.baseline_gateway_mode('v0.6.4'), 'remote')
        self.assertEqual(q.baseline_gateway_mode('v0.6.3'), 'remote')
        for target in ('v0.6.4', 'v0.6.3', 'v0.6.5-rc1', 'v0.6.5\n'):
            with self.subTest(target=target), self.assertRaises(q.install.InstallError):
                q.validate_versions('v0.6.4', target)

    def test_v063_baseline_preserves_enabled_mtls_and_requires_newer_exact_target(self):
        q = qualifier()
        q.validate_versions('v0.6.3', 'v0.6.4')
        self.assertEqual(q.baseline_gateway_mode('v0.6.3'), 'remote')
        self.assertEqual(q.baseline_gateway_mode('v0.6.2'), 'reverse')
        self.assertEqual(q.baseline_gateway_mode('v0.6.1'), 'direct')
        self.assertIsNone(q.baseline_gateway_mode('v0.4.2'))
        for old, target in [('v0.6.3', 'v0.6.3'), ('v0.6.3', 'v0.6.2'), ('v0.6.3', 'v0.6.4-rc1'), ('v0.6.3\n', 'v0.6.4'), ('v0.6.5', 'v0.6.6')]:
            with self.subTest(old=old, target=target), self.assertRaises(q.install.InstallError):
                q.validate_versions(old, target)
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertIn('"$UPGRADE_FROM" = v0.6.3', workflow)

    def test_release_and_preflight_execute_embedded_isolation_and_ascii_regressions(self):
        for filename in ('release.yml', 'check.yml'):
            workflow = (ROOT / '.github/workflows' / filename).read_text()
            with self.subTest(workflow=filename):
                self.assertIn('tests/backend/updater*.test.mjs', workflow)
                self.assertIn('tests/frontend/updater*.test.mjs', workflow)
                self.assertIn('npm --prefix updater/ui test', workflow)
                self.assertIn('--test-concurrency=1', workflow)
        config = (ROOT / 'updater/ui/playwright.config.js').read_text()
        self.assertNotIn('testIgnore', config)

    def test_v062_to_remote_mtls_reference_and_real_offline_certificates(self):
        import tempfile
        import ssl
        q = qualifier()
        q.validate_versions('v0.6.2', 'v0.6.3')
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / 'backend'
            q.make_remote_tls(directory)
            ref = q.gateway_reference(directory, remote=True)
            self.assertEqual(ref['version'], 3)
            self.assertEqual(ref['backendTLS']['serverName'], 'backend.example.test')
            context = ssl.create_default_context(cafile=ref['caddyTLS']['serverCAPath'])
            context.load_cert_chain(ref['caddyTLS']['clientCertPath'], ref['caddyTLS']['clientKeyPath'])
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            for file in directory.iterdir():
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                q.make_remote_tls(directory)

    def test_v061_enabled_gateway_baseline_is_explicit_and_target_must_be_newer(self):
        q = qualifier()
        q.validate_versions('v0.6.1', 'v0.6.2')
        for old, target in [('v0.6.1', 'v0.6.1'), ('v0.6.1', 'v0.5.0'), ('v0.6.0', 'v0.6.2')]:
            with self.assertRaises(q.install.InstallError):
                q.validate_versions(old, target)
        config = q.gateway_reference(Path('/var/lib/relay/qualification-tls'), reverse=False)
        self.assertEqual(config['version'], 1)
        self.assertEqual(config['bind'], '127.0.0.1')
        proxy = q.gateway_reference(Path('/var/lib/relay/qualification-tls'), reverse=True)
        self.assertEqual(proxy['version'], 2)
        self.assertEqual(proxy['desktopOrigin'], 'https://desktop.example.test')
        self.assertNotIn('keyPath', proxy)

    def test_gateway_qualification_requires_real_api_success_and_probe(self):
        q = qualifier()
        with patch.object(q.base, 'http', return_value=(403, {}, '')):
            with self.assertRaises(q.install.InstallError):
                q.apply_gateway({}, 'cookie', 'csrf', 'password')
        with patch.object(q.base, 'http', side_effect=[(200, {}, ''), (200, {'enabled': False}, '')]):
            with self.assertRaises(q.install.InstallError):
                q.apply_gateway({}, 'cookie', 'csrf', 'password')

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
