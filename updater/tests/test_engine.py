import json
from pathlib import Path
import tempfile
import unittest

from updater.fixtures.harness import Sandbox


class EngineTests(unittest.TestCase):
    def test_failed_rollback_preserves_maintenance_and_read_monitoring(self):
        with Sandbox() as box:
            client = box.client()
            (box.root / 'install/current/service.mjs').write_text('process.exit(1);')
            result = box.install('v0.3.2')
            self.assertEqual(result['phase'], 'rollback-failed')
            self.assertTrue(box.maintenance.exists())
            snapshot = client('state')
            self.assertFalse(snapshot['canInstall'])
            self.assertIn('Recovery required', snapshot['reason'])
            with self.assertRaises(RuntimeError):
                client('start', version='v0.3.1', authorization=box.authorization('install', version='v0.3.1'))

    def test_offline_enrollment_requires_verified_payload_and_empty_current(self):
        from updater.broker.enroll import enroll
        from updater.broker.auth import Denied
        box = Sandbox()
        try:
            with self.assertRaises(Denied):
                enroll(box.config, 'v0.3.1')
            (box.root / 'install/current').unlink()
            box.maintenance.touch()
            enrolled = enroll(box.config, 'v0.3.1')
            self.assertEqual(enrolled['version'], 'v0.3.1')
            self.assertTrue(box.maintenance.exists())
            self.assertEqual(json.loads((box.root / 'install/current/.relay-verified.json').read_text())['version'], 'v0.3.1')
        finally:
            box.close()

    def test_safe_cancel_during_real_pending_transfer(self):
        import functools
        import threading
        from updater.fixtures.harness import QuietHandler
        entered, release = threading.Event(), threading.Event()
        class HeldTransfer(QuietHandler):
            def copyfile(self, source, output):
                if self.path.endswith('.tar.gz'):
                    entered.set()
                    if not release.wait(5):
                        return
                try:
                    super().copyfile(source, output)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        with Sandbox() as box:
            box.http.RequestHandlerClass = functools.partial(HeldTransfer, directory=str(box.feed))
            client = box.client()
            client('check')
            started = client('start', version='v0.3.1', authorization=box.authorization('install', version='v0.3.1'))
            try:
                self.assertTrue(entered.wait(5))
                jobid = started['job']['id']
                client('cancel', jobId=jobid, authorization=box.authorization('cancel', jobId=jobid))
            finally:
                release.set()
            self.assertEqual(box.wait(client)['phase'], 'cancelled')
            self.assertEqual(box.ready()['version'], '0.3.0')
            self.assertFalse(box.maintenance.exists())

    def test_interrupted_activation_preserves_gate_on_restart(self):
        from updater.broker.auth import atomic_json
        from updater.broker.engine import Engine
        box = Sandbox()
        try:
            engine = Engine(box.config)
            engine.data['job'] = dict(id='a'*32, version='v0.3.1', phase='activating', downloadedBytes=123, totalBytes=123, startedAt=1, updatedAt=1, canCancel=False, canRollback=False, outcome=None, error=None, events=[])
            engine.data['checkpoint'] = dict(backupComplete=False)
            engine.save()
            engine.close()
            engine = Engine(box.config)
            try:
                self.assertEqual(engine.snapshot()['job']['phase'], 'interrupted')
                self.assertFalse(engine.snapshot()['canInstall'])
                self.assertTrue(box.maintenance.exists())
            finally:
                engine.close()
        finally:
            box.close()

    def test_observe_rejects_activation_and_exclusive_lock(self):
        from updater.broker.auth import Denied
        from updater.broker.engine import Engine
        from updater.fixtures.harness import envelope
        box = Sandbox()
        try:
            config = dict(box.config, mode='observe', observeRoot=str(box.root), currentPackage=str(box.root / 'install/current/package.json'))
            engine = Engine(config)
            try:
                with self.assertRaises(Denied):
                    Engine(config)
                ticket = engine.authority.issue(envelope(box.key, 'issue-ui', dict(userId='admin', interfaceAnimations=False)))['ticket']
                token = engine.authority.redeem(ticket, config['uiOrigin'])['token']
                self.assertEqual(engine.request('state', dict(token=token))['currentVersion'], 'v0.3.0')
                for action in ('start', 'cancel', 'rollback'):
                    with self.assertRaises(Denied):
                        engine.request(action, dict(token=token))
                self.assertFalse(engine.snapshot()['canInstall'])
            finally:
                engine.close()
        finally:
            box.close()

    def test_explicit_rollback_restores_preupdate_checkpoint(self):
        with Sandbox() as box:
            self.assertEqual(box.install('v0.3.1')['phase'], 'succeeded')
            box.state.joinpath('fixture.txt').write_text('new release state')
            client = box.client()
            client('rollback', authorization=box.authorization('rollback'))
            self.assertEqual(box.wait(client)['phase'], 'rolled-back')
            self.assertEqual(box.ready()['version'], '0.3.0')
            self.assertEqual(box.state.joinpath('fixture.txt').read_text(), 'initial synthetic state')
            with self.assertRaises(RuntimeError):
                client('rollback', authorization=box.authorization('rollback'))

    def test_payload_tamper_does_not_stop_service(self):
        from updater.broker.releases import ARTIFACT
        with Sandbox() as box:
            path = box.feed / 'v0.3.1' / ARTIFACT
            with path.open('r+b') as stream:
                stream.write(b'corrupt')
            result = box.install('v0.3.1')
            self.assertEqual(result['phase'], 'failed')
            self.assertEqual(box.ready()['version'], '0.3.0')
            self.assertFalse(box.maintenance.exists())

    def test_forged_manifest_is_not_listed(self):
        with Sandbox() as box:
            (box.feed / 'v0.3.1/relay-release.attestation.json').write_text('{"kind":"FIXTURE-HMAC-NOT-GITHUB","mac":"forged"}')
            client = box.client()
            with self.assertRaises(RuntimeError):
                client('check')
            self.assertEqual(client('state')['available'], [])
            self.assertEqual(box.ready()['version'], '0.3.0')

    def test_actual_transfer_activation_and_state_rollback(self):
        with Sandbox() as box:
            client = box.client()
            initial = client('state')
            self.assertEqual(initial['currentVersion'], 'v0.3.0')
            checked = client('check')
            self.assertEqual([r['version'] for r in checked['available']], ['v0.3.1', 'v0.3.2'])
            job = box.install('v0.3.1')
            self.assertEqual(job['phase'], 'succeeded', job)
            self.assertGreater(job['downloadedBytes'], 0)
            self.assertEqual(job['downloadedBytes'], job['totalBytes'])
            self.assertEqual(box.ready()['version'], '0.3.1')
            self.assertEqual((box.root / 'install/current').stat().st_mode & 0o777, 0o755)
            self.assertFalse(box.maintenance.exists())
            box.state.joinpath('fixture.txt').write_text('matching checkpoint')
            failed = box.install('v0.3.2')
            self.assertEqual(failed['phase'], 'rolled-back', failed)
            self.assertEqual(box.ready()['version'], '0.3.1')
            self.assertEqual(box.state.joinpath('fixture.txt').read_text(), 'matching checkpoint')
            self.assertFalse(box.maintenance.exists())
            self.assertEqual(client('state')['currentVersion'], 'v0.3.1')
            self.assertEqual(len(list((box.root / 'install/releases').iterdir())), 1)
            self.assertEqual(len(list((box.root / 'control').glob('backup-*'))), 0)


if __name__ == '__main__':
    unittest.main()
