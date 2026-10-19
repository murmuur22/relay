import unittest
from updater.tests.test_prepare import running_engine, prepare, authorization


class ApplyTests(unittest.TestCase):
    def test_apply_refuses_malformed_or_rebound_prepared_state_before_intent(self):
        import copy
        from updater.broker.auth import Denied, digest
        changes = ('artifact-digest', 'artifact-size', 'artifact-name', 'owner', 'schema-bool', 'manifest-version', 'job-version', 'job-kind', 'job-stage', 'prepared-array')
        for change in changes:
            with self.subTest(change=change), running_engine() as (box, engine):
                token, ready = prepare(engine, box)
                job = ready['job']
                auth = authorization(engine, box, 'apply', version=job['version'], jobId=job['id'])
                before = copy.deepcopy(engine.data)
                p = engine.data['prepared']
                if change == 'artifact-digest': p['artifact']['sha256'] = '0' * 64
                elif change == 'artifact-size': p['artifact']['size'] = 1
                elif change == 'artifact-name': p['artifact']['name'] = '../../outside'
                elif change == 'owner': engine.data['job']['userId'] = 'other-admin'
                elif change == 'schema-bool': p['schema'] = True
                elif change == 'manifest-version': p['manifest'] = dict(version='v0.3.2')
                elif change == 'job-version': engine.data['job']['version'] = 'v0.3.2'
                elif change == 'job-kind': engine.data['job']['kind'] = 'start'
                elif change == 'job-stage': engine.data['job']['phase'] = 'staging'
                else: engine.data['prepared'] = []
                engine.save()
                pid, link = engine.driver.process.pid, engine.current.readlink()
                with self.assertRaises(Denied):
                    engine.request('apply', dict(token=token, authorization=auth, version=job['version'], jobId=job['id']))
                self.assertIn(digest(auth), engine.authority.data['caps'])
                self.assertIsNone(engine.data['checkpoint'])
                self.assertFalse(box.maintenance.exists())
                self.assertEqual(engine.driver.process.pid, pid)
                self.assertIsNone(engine.driver.process.poll())
                self.assertEqual(engine.current.readlink(), link)
                self.assertEqual(list(engine.root.glob('backup-*')), [])
                engine.data = before
                engine.save()

    def test_apply_revalidates_stage_after_runtime_readiness_wait(self):
        from unittest.mock import patch
        from updater.broker.auth import Denied
        with running_engine() as (box, engine):
            token, ready = prepare(engine, box)
            job = ready['job']
            auth = authorization(engine, box, 'apply', version=job['version'], jobId=job['id'])
            original = engine.driver.ready
            def changed(version):
                original(version)
                stage = engine.install / 'releases' / ('.stage-' + job['id'])
                (stage / 'payload/service.mjs').write_text('process.exit(1);')
            with patch.object(engine.driver, 'ready', side_effect=changed):
                with self.assertRaises(Denied):
                    engine.request('apply', dict(token=token, authorization=auth, version=job['version'], jobId=job['id']))
            self.assertIsNone(engine.data['checkpoint'])
            self.assertFalse(box.maintenance.exists())
            self.assertEqual(box.ready()['version'], '0.3.0')

    def test_stage_revalidation_never_follows_releases_parent_link(self):
        from unittest.mock import patch
        from updater.broker.auth import Denied
        with running_engine() as (box, engine):
            _token, ready = prepare(engine, box)
            releases = engine.install / 'releases'
            displaced = engine.install / 'displaced'
            releases.rename(displaced)
            releases.symlink_to(displaced, target_is_directory=True)
            try:
                # Baseline already acquired before this controlled substitution.
                with patch.object(engine, 'preparation_baseline', return_value=ready['job']['baseline']):
                    with self.assertRaises((Denied, OSError)):
                        engine.validate_prepared()
            finally:
                releases.unlink()
                displaced.rename(releases)

    def test_failed_apply_restores_matching_state_without_pathname_receipt_reads(self):
        from unittest.mock import patch
        from pathlib import Path
        with running_engine() as (box, engine):
            token, ready = prepare(engine, box, 'v0.3.2')
            job = ready['job']
            original = Path.read_text
            def bounded_only(path, *args, **kwargs):
                if path.name == '.relay-verified.json':
                    raise AssertionError('unbounded receipt pathname reader entered')
                return original(path, *args, **kwargs)
            with patch.object(Path, 'read_text', bounded_only):
                engine.request('apply', dict(token=token, authorization=authorization(engine, box, 'apply', version=job['version'], jobId=job['id']), version=job['version'], jobId=job['id']))
                engine.thread.join(15)
            self.assertFalse(engine.thread.is_alive())
            self.assertEqual(engine.snapshot()['job']['phase'], 'rolled-back', engine.snapshot())
            self.assertEqual(box.ready()['version'], '0.3.0')
            self.assertEqual((box.state / 'fixture.txt').read_text(), 'initial synthetic state')
            self.assertFalse(box.maintenance.exists())
            self.assertIsNone(engine.data['checkpoint'])

    def test_explicit_apply_uses_ready_job_without_redownload_and_retains_matching_rollback(self):
        with running_engine() as (box, engine):
            token, ready = prepare(engine, box)
            job = ready['job']
            self.assertEqual(box.ready()['version'], '0.3.0')
            self.assertTrue(ready['canApply'])
            auth = authorization(engine, box, 'apply', version=job['version'], jobId=job['id'])
            # The verified stage is sufficient: discovery/remote feed are not
            # authority for apply, and must not silently replace the target.
            from unittest.mock import patch
            with patch.object(engine.releases, 'verified_manifest', side_effect=AssertionError('apply redownloaded')):
                result = engine.request('apply', dict(token=token, authorization=auth, version=job['version'], jobId=job['id']))
                self.assertEqual(result['job']['id'], job['id'])
                engine.thread.join(15)
            final = engine.snapshot()
            self.assertFalse(engine.thread.is_alive())
            self.assertEqual(final['job']['phase'], 'succeeded', final)
            self.assertEqual(box.ready()['version'], '0.3.1')
            self.assertEqual(final['currentVersion'], 'v0.3.1')
            self.assertFalse(box.maintenance.exists())
            self.assertTrue(engine.data['previous']['backupComplete'])
            self.assertIsNone(engine.data.get('prepared'))
            with self.assertRaises(ValueError):
                engine.request('apply', dict(token=token, authorization=auth, version=job['version'], jobId=job['id']))
            box.state.joinpath('fixture.txt').write_text('new state')
            engine.request('rollback', dict(token=token, authorization=authorization(engine, box, 'rollback')))
            engine.thread.join(15)
            self.assertEqual(engine.snapshot()['job']['phase'], 'rolled-back')
            self.assertEqual(box.ready()['version'], '0.3.0')
            self.assertEqual(box.state.joinpath('fixture.txt').read_text(), 'initial synthetic state')


if __name__ == '__main__':
    unittest.main()
