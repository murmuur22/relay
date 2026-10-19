"""Controlled-service/local archive tier ONLY; NOT real-linux-systemd evidence."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import threading
import types
import unittest
from unittest.mock import Mock, patch
from deploy.migration_069 import qualification_worker as w
from updater.broker import engine as engine_module
from updater.broker.releases import extract


class FutureFixtureTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory())).resolve()
        self.stack.enter_context(patch.object(w, 'R', self.root))
        self.mark = dict(sourceCommit='c' * 40, sourceInventory={})
        self.admission = self.stack.enter_context(patch.object(w, 'admission', return_value=self.mark))
        # Keep the real pinned bounded reader, changing only the synthetic owner.
        read = w.c.bounded_read
        self.stack.enter_context(patch.object(w.c, 'bounded_read', side_effect=lambda p, n, owner=0: read(p, n, os.getuid())))
        payload = self.root / 'input'
        files = {'package.json': json.dumps(dict(name='relay', version='0.6.9')).encode(),
                 'version.js': b'export const VERSION = "0.6.9";\n',
                 'server/index.mjs': b'// inert canonical runtime fixture\n',
                 'standalone/server.mjs': b'// inert standalone fixture\n',
                 'updater/web/broker-client.mjs': b'// inert broker client\n',
                 'tools/icon-normalize.py': b'# inert tool\n',
                 'updater-presentation/index.html': b'<html><script src="/updater/presentation/v0.6.9/assets/app-test.js"></script></html>',
                 'updater-presentation/assets/app-test.js': b'// inert presentation\n'}
        for name, raw in files.items():
            p = payload / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(raw)
            if name.startswith('server/') or name in ('version.js', 'updater/web/broker-client.mjs', 'tools/icon-normalize.py'):
                self.mark['sourceInventory'][name] = dict(size=len(raw), sha256=w.c.sha(raw))
        w.fixture_presentation.describe(payload / 'updater-presentation', w.c.TARGET)
        candidate = self.root / 'candidate'
        candidate.mkdir()
        archive = candidate / 'relay-linux-x64.tar.gz'
        with tarfile.open(archive, 'w:gz') as out:
            for p in sorted(payload.rglob('*')):
                if p.is_file():
                    out.add(p, arcname=p.relative_to(payload).as_posix(), recursive=False)
        updater = candidate / 'relay-updater-linux-x64.tar.gz'
        updater.write_bytes(b'local descriptor-only updater fixture')
        def pin(p):
            return dict(name=p.name, size=p.stat().st_size, sha256=w.c.sha(p.read_bytes()))
        self.manifest = dict(protocol=1, repository='murmuur22/relay', version=w.c.TARGET,
                             platform='linux-x64', stateSchema=1, rollbackCompatible=True,
                             minimumNode='26.8.1', artifact=pin(archive), updaterArtifact=pin(updater))
        (candidate / 'relay-release.json').write_bytes(w.c.canonical(self.manifest))
        self.before = {p.name: p.read_bytes() for p in candidate.iterdir()}

    def build(self):
        return w.build_future_fixture()

    def test_real_archive_future_metadata_hash_size_and_unchanged_069(self):
        fixture = self.build()
        value, _ = w.unsigned_manifest(w.FUTURE, fixture)
        metadata = json.loads((fixture / 'build-metadata.json').read_bytes())
        archive = fixture / value['artifact']['name']
        self.assertEqual(value['version'], 'v0.6.10')
        self.assertNotIn('updaterArtifact', value)
        self.assertEqual(value['artifact']['size'], archive.stat().st_size)
        self.assertEqual(value['artifact']['sha256'], hashlib.sha256(archive.read_bytes()).hexdigest())
        self.assertEqual(metadata, dict(kind=w.FIXTURE_KIND, version=w.FUTURE, baseline=w.c.TARGET,
                                       sourceCommit=self.mark['sourceCommit'],
                                       candidateManifestSha256=w.c.sha(self.before['relay-release.json']), artifact=value['artifact']))
        unpacked = self.root / 'unpacked'
        extract(archive, unpacked)
        package = json.loads((unpacked / 'package.json').read_bytes())
        self.assertEqual(package['version'], '0.6.10')
        self.assertEqual(package['qualificationFixture']['kind'], w.FIXTURE_KIND)
        w.fixture_presentation.validate(unpacked / 'updater-presentation', w.FUTURE)
        for name in (*self.mark['sourceInventory'], 'standalone/server.mjs'):
            self.assertEqual((unpacked / name).read_bytes(), (self.root / 'input' / name).read_bytes())
        self.assertEqual({p.name: p.read_bytes() for p in (self.root / 'candidate').iterdir()}, self.before)
        self.assertEqual(w.c.TARGET, 'v0.6.9')
        self.assertFalse(list(fixture.glob('*attestation*')))

    def test_staged_authority_ready_apply_and_matching_069_rollback(self):
        fixture = self.build()
        matrix = object.__new__(w.Matrix)
        matrix.layout = types.SimpleNamespace(marker=self.root / 'gate')
        baseline = self.root / 'runtime-069'
        live = dict(version=w.c.TARGET, pid=69, link=baseline, state='private-state', web=9)
        events = []
        engine = types.SimpleNamespace(data=dict(currentVersion=w.c.TARGET),
            current_release=lambda: live['link'], thread=types.SimpleNamespace(join=lambda n: None, is_alive=lambda: False))
        def ready(version, gate):
            self.assertEqual((live['version'], matrix.layout.marker.exists()), (version, gate))
            events.append(('ready', version))
        def http(port, path, method='GET', body=None, cookie=None, csrf=None):
            if path.endswith('/auth'):
                events.append(('authorize', live['version']))
                return 200, dict(authenticated=True, csrf='fresh'), {}
            if path.endswith('/prepare'):
                self.assertEqual(events[-1], ('authorize', w.c.TARGET))
                self.assertEqual(body['version'], w.FUTURE)
                self.assertEqual((live['pid'], live['link'], live['state'], matrix.layout.marker.exists()), (69, baseline, 'private-state', False))
                events.append(('prepare', live['version']))
                engine.data['job'] = dict(id='job', phase='ready')
                return 200, dict(job=engine.data['job']), {}
            if path.endswith('/apply'):
                self.assertEqual(events[-1], ('authorize', w.c.TARGET))
                self.assertEqual(body['version'], w.FUTURE)
                live.update(version=w.FUTURE, pid=610, link=self.root / 'runtime-0610')
                engine.data['currentVersion'] = w.FUTURE
                events.append(('apply', w.FUTURE))
                return 200, {}, {}
            self.assertEqual((port, path), (4180, '/api/session'))
            return 401, {}, {}
        def monitor(*args):
            self.assertEqual((live['pid'], live['link'], live['state'], matrix.layout.marker.exists()), (69, baseline, 'private-state', False))
            events.append(('observed-ready', w.c.TARGET))
            return 200, dict(job=engine.data['job']), {}
        def mutate(action, *args, **kw):
            self.assertEqual(action, 'rollback')
            self.assertEqual(live['version'], w.FUTURE)
            live.update(version=w.c.TARGET, pid=70, link=baseline)
            engine.data['currentVersion'] = w.c.TARGET
            events.append(('rollback', w.c.TARGET))
            return 'rollback-job'
        base = types.SimpleNamespace(ready=ready, service_identity=lambda u: live['pid'] if u == w.m.UNITS[0] else live['web'],
            http=http, raw_http=lambda *a: (200, b'<html>local fixture</html>', {}), monitor_state=monitor,
            authenticate=lambda password: ('cookie', 'csrf'))
        matrix.q = types.SimpleNamespace(base=base, fingerprint=lambda p: live['state'], mutate=mutate,
            wait_job=lambda *a, **kw: dict(currentVersion=live['version']))
        matrix.apply = lambda: events.append(('control-apply', live['version']))
        root = self.root / 'installed'
        root.mkdir()
        (root / 'package.json').write_text('{"version":"0.6.9"}')
        real_path = Path
        def mapped(p):
            return root if str(p) == '/opt/relay-updater' else real_path(p)
        fake_engine = types.ModuleType('updater.broker.engine')
        fake_engine.Engine = object
        fake_broker = types.ModuleType('updater.broker.server')
        fake_broker.Broker = object
        def serve(q, E, B, password, action, **kw):
            self.assertEqual(kw, dict(target=w.FUTURE, fixture=fixture))
            return action(engine, 'cookie', 'csrf', 'monitor')
        # Exercise staged() itself without loading or operating a host installation.
        with patch.object(w, 'Path', side_effect=mapped), patch.object(w, 'build_future_fixture', return_value=fixture), \
             patch.object(w, 'serve_engine', side_effect=serve), patch.object(sys, 'path', list(sys.path)), patch.dict(sys.modules):
            # staged() deliberately clears updater imports; intercept only its two installed imports.
            import builtins
            original_import = builtins.__import__
            def installed(name, *args, **kwargs):
                if name == 'updater.broker.engine': return fake_engine
                if name == 'updater.broker.server': return fake_broker
                return original_import(name, *args, **kwargs)
            with patch.object(builtins, '__import__', side_effect=installed):
                matrix.staged('local-password')
        self.assertEqual([e for e in events if e[0] in ('prepare', 'observed-ready', 'apply', 'rollback')],
                         [('prepare', w.c.TARGET), ('observed-ready', w.c.TARGET), ('apply', w.FUTURE), ('rollback', w.c.TARGET)])
        self.assertNotIn('v0.6.4', [e[1] for e in events])
        self.assertEqual([x['phase'] for x in matrix.lifecycle], ['live-069-before-prepare', 'ready-with-live-069', 'synthetic-future-applied', 'matching-069-restored'])
        self.assertEqual((live['link'], live['state'], matrix.layout.marker.exists()), (baseline, 'private-state', False))

    def test_wrong_future_version_path_and_admission_refuse_before_broker_stop(self):
        fixture = self.build()
        q = types.SimpleNamespace(install=types.SimpleNamespace(run=Mock()))
        for target, path, denied in [('v0.6.11', fixture, False), (w.FUTURE, self.root / 'elsewhere', False), (w.FUTURE, fixture, True)]:
            with self.subTest(target=target, path=path, admission=denied):
                self.admission.side_effect = w.c.Refused('admission denied') if denied else None
                with self.assertRaises(w.c.Refused):
                    w.serve_engine(q, Mock(), Mock(), 'local', Mock(), target=target, fixture=path)
                q.install.run.assert_not_called()

    def test_unsigned_transport_restores_all_hooks_after_failed_health(self):
        fixture = self.build()
        class Engine: pass
        Engine.__module__ = engine_module.__name__
        engine = Engine()
        engine.releases = types.SimpleNamespace(verified_manifest=object(), base=object(), check=object(), entries={'old': {}})
        engine.available = ['original']
        before = vars(engine.releases).copy(), engine.available, engine_module.transfer
        with self.assertRaisesRegex(RuntimeError, 'fixture health'):
            with w.unsigned_transport(engine, target=w.FUTURE, fixture=fixture) as manifest:
                self.assertEqual(engine.releases.check(None)[0]['notes'], w.FIXTURE_KIND)
                for version in (w.c.TARGET, 'v0.6.11'):
                    with self.assertRaises(w.c.Refused): engine.releases.verified_manifest(version, None)
                destination = self.root / 'transferred.tar.gz'
                engine_module.transfer(engine.releases.base(w.FUTURE) + '/relay-linux-x64.tar.gz', destination,
                                       limit=manifest['artifact']['size'])
                self.assertEqual(w.c.sha(destination.read_bytes()), manifest['artifact']['sha256'])
                with self.assertRaises(w.c.Refused): engine_module.transfer('https://example.invalid/escape', self.root / 'escape', limit=1)
                raise RuntimeError('fixture health failed')
        self.assertEqual(vars(engine.releases), before[0])
        self.assertIs(engine.available, before[1])
        self.assertIs(engine_module.transfer, before[2])

    def test_failed_health_and_cleanup_restore_broker_without_false_success(self):
        fixture = self.build()
        config = self.root / 'broker.json'
        config.write_text('{}')
        for failure in ('health', 'close', 'restoration'):
            with self.subTest(failure=failure):
                calls = []
                releases = types.SimpleNamespace(verified_manifest=object(), base=object(), check=object(), entries={})
                engine = types.SimpleNamespace(releases=releases, available=[], thread=None)
                # Transport locates the module of the actual engine class.
                class Engine:
                    def __new__(cls, config): return engine
                def close():
                    calls.append('engine-close')
                    if failure == 'close': raise RuntimeError('close failed')
                engine.close = close
                stopped = threading.Event()
                class Broker:
                    def __init__(self, engine): pass
                    def serve_forever(self, **kw): stopped.wait(5)
                    def shutdown(self): calls.append('shutdown'); stopped.set()
                    def server_close(self): calls.append('server-close')
                def wait():
                    calls.append('wait-control')
                    if failure == 'restoration' and 'start' in calls: raise RuntimeError('restoration failed')
                q = types.SimpleNamespace(install=types.SimpleNamespace(run=lambda argv: calls.append(argv[1])),
                    base=types.SimpleNamespace(wait_control=wait, authenticate=lambda p: ('cookie', 'csrf'), launch_monitor=lambda *a: 'monitor'))
                def action(*args):
                    if failure == 'health': raise RuntimeError('health failed')
                    return 'action-complete'
                def mapped(p): return config if str(p) == '/etc/relay-updater/broker.json' else Path(p)
                # The real transport is covered above; isolate service cleanup here.
                with patch.object(w, 'Path', side_effect=mapped), patch.object(w, 'unsigned_transport', return_value=contextlib.nullcontext()), \
                     self.assertRaisesRegex(RuntimeError, failure + ' failed'):
                    w.serve_engine(q, Engine, Broker, 'local', action, target=w.FUTURE, fixture=fixture)
                self.assertEqual(calls[0], 'stop')
                self.assertEqual(calls[-2:], ['start', 'wait-control'])
                self.assertIn('engine-close', calls)
                self.assertIn('server-close', calls)


if __name__ == '__main__':
    unittest.main(verbosity=2)
