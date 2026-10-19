import contextlib
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from updater.broker.auth import Denied, atomic_json

from updater.broker.engine import Engine
from updater.fixtures.harness import Sandbox, envelope


@contextlib.contextmanager
def running_engine():
    box = Sandbox()
    engine = None
    try:
        engine = Engine(box.config)
        engine.driver.start()
        engine.driver.ready('v0.3.0')
        yield box, engine
    finally:
        if engine:
            engine.close()
        box.close()


def client(engine, box, user='fixture-admin'):
    ticket = engine.authority.issue(envelope(box.key, 'issue-ui', dict(userId=user, interfaceAnimations=False)))['ticket']
    return engine.authority.redeem(ticket, box.config['uiOrigin'])['token']


def authorization(engine, box, action, user='fixture-admin', **target):
    return engine.authority.issue(envelope(box.key, 'issue-action', dict(userId=user, action=action, **target)))['authorization']


def prepare(engine, box, version='v0.3.1'):
    token = client(engine, box)
    engine.check()
    engine.request('prepare', dict(token=token, version=version, authorization=authorization(engine, box, 'prepare', version=version)))
    engine.thread.join(10)
    if engine.thread.is_alive():
        raise AssertionError('Preparation did not settle within fixture bound')
    return token, engine.snapshot()


class PreparationTests(unittest.TestCase):
    def test_prepare_authority_negatives_and_one_use_replay(self):
        from updater.broker.auth import digest
        with running_engine() as (box, engine):
            token = client(engine, box)
            engine.check()
            expired = authorization(engine, box, 'prepare', version='v0.3.1')
            engine.authority.data['caps'][digest(expired)]['expiresAt'] = 0
            wrong = [None, 'forged-capability-not-issued', expired,
                     authorization(engine, box, 'install', version='v0.3.1'),
                     authorization(engine, box, 'prepare', version='v0.3.2'),
                     authorization(engine, box, 'prepare', user='other-admin', version='v0.3.1')]
            for index, auth in enumerate(wrong):
                with self.subTest(index=index), self.assertRaises(Denied):
                    engine.request('prepare', dict(token=token, version='v0.3.1', authorization=auth))
                self.assertIsNone(engine.data['job'])
            signed = envelope(box.key, 'issue-action', dict(userId='fixture-admin', action='prepare', version='v0.3.1'))
            forged = dict(signed, mac='0' * 64)
            with self.assertRaises(Denied):
                engine.authority.issue(forged)
            auth = engine.authority.issue(signed)['authorization']
            with self.assertRaises(Denied):
                engine.authority.issue(signed)
            with self.assertRaises(Denied):
                engine.request('prepare', dict(token='not-a-valid-user-token', version='v0.3.1', authorization=auth))
            engine.request('prepare', dict(token=token, version='v0.3.1', authorization=auth))
            engine.thread.join(10)
            self.assertEqual(engine.snapshot()['job']['phase'], 'ready')
            job_id = engine.data['job']['id']
            engine.request('cancel', dict(token=token, jobId=job_id, authorization=authorization(engine, box, 'cancel', jobId=job_id)))
            with self.assertRaises(Denied):
                engine.request('prepare', dict(token=token, version='v0.3.1', authorization=auth))
            self.assertEqual(engine.snapshot()['job']['phase'], 'cancelled')
            self.assertFalse(box.maintenance.exists())
            self.assertEqual(box.ready()['version'], '0.3.0')

    def test_observe_rejects_prepare_apply_and_prepare_authority_cannot_apply(self):
        box = Sandbox()
        try:
            config = dict(box.config, mode='observe', observeRoot=str(box.root), currentPackage=str(box.root / 'install/current/package.json'))
            engine = Engine(config)
            try:
                token = client(engine, box)
                for action in ('prepare', 'apply'):
                    with self.assertRaises(Denied):
                        engine.request(action, dict(token=token, version='v0.3.1', authorization=authorization(engine, box, 'prepare', version='v0.3.1')))
                self.assertFalse(engine.snapshot()['canPrepare'])
                self.assertFalse(engine.snapshot()['canApply'])
                self.assertIsNone(engine.data['job'])
            finally:
                engine.close()
        finally:
            box.close()
        with running_engine() as (box, engine):
            token, ready = prepare(engine, box)
            with self.assertRaises(Denied):
                engine.request('apply', dict(token=token, jobId=ready['job']['id'], version='v0.3.1', authorization=authorization(engine, box, 'prepare', version='v0.3.1')))
            # Apply issuance is now supported, but it grants only the exact
            # prepared job/version; issuing it alone does not apply anything.
            auth = authorization(engine, box, 'apply', version='v0.3.1', jobId=ready['job']['id'])
            cap = engine.authority.validate_action(token, auth, 'apply', version='v0.3.1', jobId=ready['job']['id'])
            self.assertEqual(cap['userId'], 'fixture-admin')
            self.assertEqual(engine.snapshot()['job']['phase'], 'ready')
            self.assertFalse(box.maintenance.exists())

    def test_restart_rejects_adversarial_stage_shapes_and_identity(self):
        changes = ('missing', 'extra', 'removed-file', 'renamed', 'file-mode', 'directory-mode', 'hardlink', 'symlink', 'directory-link', 'wrapper-link', 'fifo', 'wrong-owner', 'job-identity', 'version-identity')
        for change in changes:
            with self.subTest(change=change), running_engine() as (box, engine):
                _token, before = prepare(engine, box)
                staged = engine.install / 'releases' / ('.stage-' + before['job']['id'])
                payload = staged / 'payload'
                target = payload / 'service.mjs'
                outside = box.root / 'untouched'
                outside.mkdir()
                marker = outside / 'marker'
                marker.write_text('must not follow')
                if change == 'missing':
                    import shutil
                    shutil.rmtree(staged)
                elif change == 'extra':
                    (payload / 'extra').write_text('extra')
                elif change == 'removed-file':
                    target.unlink()
                elif change == 'renamed':
                    target.rename(payload / 'renamed.mjs')
                elif change == 'file-mode':
                    target.chmod(0o666)
                elif change == 'directory-mode':
                    payload.chmod(0o777)
                elif change == 'hardlink':
                    os.link(target, outside / 'hardlinked')
                elif change in ('symlink', 'fifo'):
                    target.unlink()
                    if change == 'symlink':
                        target.symlink_to(marker)
                    else:
                        os.mkfifo(target)
                elif change in ('directory-link', 'wrapper-link'):
                    directory = payload if change == 'directory-link' else staged
                    directory.rename(box.root / 'displaced-stage')
                    directory.symlink_to(outside, target_is_directory=True)
                elif change == 'job-identity':
                    engine.data['prepared']['jobId'] = 'a' * 32
                    engine.save()
                elif change == 'version-identity':
                    engine.data['prepared']['version'] = 'v0.3.2'
                    engine.save()
                engine.close()
                # Non-root fixtures cannot chown to a foreign UID. Inject only
                # the expected owner; the actual lstat/fstat traversal is real.
                owner_check = contextlib.nullcontext()
                # Limit owner injection to stage validation, not config validation.
                if change == 'wrong-owner':
                    from updater.broker.engine import stage_fingerprint
                    owner_check = patch('updater.broker.engine.stage_fingerprint', side_effect=lambda path, owner: stage_fingerprint(path, owner + 1))
                with owner_check:
                    recovered = Engine(box.config)
                try:
                    self.assertEqual(recovered.snapshot()['job']['phase'], 'failed')
                    self.assertFalse(box.maintenance.exists())
                    self.assertIsNone(recovered.data['checkpoint'])
                    self.assertFalse(os.path.lexists(staged))
                    self.assertEqual(marker.read_text(), 'must not follow')
                finally:
                    recovered.close()

    def test_admission_reserved_through_ready_and_discovery_cannot_replace_stage(self):
        with running_engine() as (box, engine):
            token = client(engine, box)
            engine.check()
            entered, release = threading.Event(), threading.Event()
            original = engine.driver.preflight

            def held_preflight(stage, version):
                original(stage, version)
                entered.set()
                if not release.wait(5):
                    raise AssertionError('Preflight barrier timed out')

            with patch.object(engine.driver, 'preflight', side_effect=held_preflight):
                first = engine.request('prepare', dict(token=token, version='v0.3.1', authorization=authorization(engine, box, 'prepare', version='v0.3.1')))
                try:
                    self.assertTrue(entered.wait(5))
                    for action, operation in (('prepare', 'prepare'), ('start', 'install'), ('rollback', 'rollback')):
                        with self.subTest(phase='preparing', action=action), self.assertRaises(Denied):
                            engine.request(action, dict(token=token, version='v0.3.2', authorization=authorization(engine, box, operation, version='v0.3.2')))
                finally:
                    release.set()
                engine.thread.join(10)
            self.assertEqual(engine.snapshot()['job']['phase'], 'ready')
            identity = json.loads(json.dumps(engine.data['prepared']))
            for action, operation in (('prepare', 'prepare'), ('start', 'install'), ('rollback', 'rollback')):
                with self.subTest(phase='ready', action=action), self.assertRaises(Denied):
                    engine.request(action, dict(token=token, version='v0.3.2', authorization=authorization(engine, box, operation, version='v0.3.2')))
            engine.last_check = float('-inf')
            with patch.object(engine.releases, 'check', return_value=[]):
                engine.check()
            self.assertEqual(engine.data['prepared'], identity)
            self.assertEqual(engine.snapshot()['job']['id'], first['job']['id'])
            self.assertEqual(engine.snapshot()['job']['version'], 'v0.3.1')
            self.assertTrue(engine.validate_prepared().exists())
            self.assertFalse(box.maintenance.exists())

    def test_cancel_linearizes_at_ready_lock_boundary(self):
        from updater.broker.engine import stage_fingerprint
        for cancel_first in (True, False):
            with self.subTest(cancel_first=cancel_first), running_engine() as (box, engine):
                token = client(engine, box)
                engine.check()
                entered, release, attempted, finished = (threading.Event() for _ in range(4))
                original_preflight = engine.driver.preflight
                outcomes = []

                def barrier():
                    entered.set()
                    if not release.wait(5):
                        raise AssertionError('Ready/cancel barrier timed out')

                def held_preflight(stage, version):
                    original_preflight(stage, version)
                    barrier()

                def held_inventory(stage, owner):
                    result = stage_fingerprint(stage, owner)
                    barrier()
                    return result

                interception = patch.object(engine.driver, 'preflight', side_effect=held_preflight) if cancel_first else patch('updater.broker.engine.stage_fingerprint', side_effect=held_inventory)
                worker = None
                with interception:
                    initial = engine.request('prepare', dict(token=token, version='v0.3.1', authorization=authorization(engine, box, 'prepare', version='v0.3.1')))
                    job_id = initial['job']['id']
                    auth = authorization(engine, box, 'cancel', jobId=job_id)

                    def cancel():
                        attempted.set()
                        try:
                            outcomes.append(engine.request('cancel', dict(token=token, jobId=job_id, authorization=auth)))
                        except Exception as error:
                            outcomes.append(error)
                        finally:
                            finished.set()

                    try:
                        self.assertTrue(entered.wait(5))
                        worker = threading.Thread(target=cancel)
                        worker.start()
                        self.assertTrue(attempted.wait(5))
                        if cancel_first:
                            self.assertTrue(finished.wait(5))
                        else:
                            self.assertFalse(finished.wait(0.05), 'Cancel must wait for ready transition lock')
                    finally:
                        release.set()
                        if worker:
                            worker.join(10)
                        engine.thread.join(10)
                self.assertEqual(len(outcomes), 1)
                self.assertIsInstance(outcomes[0], dict)
                final = engine.snapshot()['job']
                self.assertEqual(final['phase'], 'cancelled', final)
                self.assertEqual(any(event['phase'] == 'ready' for event in final['events']), not cancel_first)
                self.assertFalse((engine.install / 'releases' / ('.stage-' + job_id)).exists())
                self.assertFalse(box.maintenance.exists())
                self.assertIsNone(engine.data['checkpoint'])
                self.assertEqual(box.ready()['version'], '0.3.0')

    def test_baseline_is_bound_at_admission_not_after_transfer(self):
        with running_engine() as (box, engine):
            original = engine.driver.preflight

            def change_baseline(stage, version):
                original(stage, version)
                receipt = engine.current.resolve() / '.relay-verified.json'
                value = json.loads(receipt.read_text())
                value['sha256'] = '0' * 64
                atomic_json(receipt, value)

            with patch.object(engine.driver, 'preflight', side_effect=change_baseline):
                _token, result = prepare(engine, box)
            self.assertEqual(result['job']['phase'], 'failed')
            self.assertFalse(box.maintenance.exists())
            self.assertIsNone(engine.data['checkpoint'])
            self.assertIsNone(engine.data.get('prepared'))
            self.assertEqual(box.ready()['version'], '0.3.0')

    def test_inventory_bounds_are_enforced(self):
        from updater.broker.engine import stage_fingerprint
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            (root / 'nested').mkdir(mode=0o755)
            (root / 'nested/payload').write_bytes(b'bounded')
            for bounds in (dict(max_entries=1), dict(max_bytes=1), dict(max_depth=0), dict(timeout=-1)):
                with self.subTest(bounds=bounds), self.assertRaises(Denied):
                    stage_fingerprint(root, os.getuid(), **bounds)
            inventory = stage_fingerprint(root, os.getuid())
            self.assertEqual(inventory['entries'], 2)
            self.assertEqual(inventory['bytes'], len(b'bounded'))

    def test_interrupted_preparation_never_recovers_as_ready(self):
        with running_engine() as (box, engine):
            _token, result = prepare(engine, box)
            engine.data['job']['phase'] = 'staging'
            engine.save()
            engine.close()
            recovered = Engine(box.config)
            try:
                self.assertEqual(recovered.snapshot()['job']['phase'], 'interrupted')
                self.assertFalse(box.maintenance.exists())
                self.assertIsNone(recovered.data.get('prepared'))
                self.assertFalse((engine.install / 'releases' / ('.stage-' + result['job']['id'])).exists())
            finally:
                recovered.close()

    def test_ready_cancel_requires_fresh_job_bound_authority_and_retires_stage(self):
        with running_engine() as (box, engine):
            pid, link = engine.driver.process.pid, engine.current.readlink()
            token, before = prepare(engine, box)
            job_id = before['job']['id']
            staged = engine.install / 'releases' / ('.stage-' + job_id)
            wrong = [None,
                     authorization(engine, box, 'install', version='v0.3.1'),
                     authorization(engine, box, 'cancel', jobId='a' * 32),
                     authorization(engine, box, 'cancel', user='other-admin', jobId=job_id)]
            expired = authorization(engine, box, 'cancel', jobId=job_id)
            from updater.broker.auth import digest
            engine.authority.data['caps'][digest(expired)]['expiresAt'] = 0
            wrong.append(expired)
            for auth in wrong:
                with self.subTest(auth_kind='invalid'), self.assertRaises(Denied):
                    engine.request('cancel', dict(token=token, jobId=job_id, authorization=auth))
                self.assertEqual(engine.snapshot()['job']['phase'], 'ready')
                self.assertTrue(staged.exists())
            auth = authorization(engine, box, 'cancel', jobId=job_id)
            result = engine.request('cancel', dict(token=token, jobId=job_id, authorization=auth))
            self.assertEqual(result['job']['phase'], 'cancelled')
            self.assertFalse(staged.exists())
            self.assertIsNone(engine.data.get('prepared'))
            self.assertTrue(result['canPrepare'])
            with self.assertRaises(Denied):
                engine.authority.consume(token, auth, 'cancel', jobId=job_id)
            self.assertEqual(engine.driver.process.pid, pid)
            self.assertIsNone(engine.driver.process.poll())
            self.assertEqual(engine.current.readlink(), link)
            self.assertFalse(box.maintenance.exists())
            self.assertIsNone(engine.data['checkpoint'])
            engine.close()
            recovered = Engine(box.config)
            try:
                self.assertEqual(recovered.snapshot()['job']['phase'], 'cancelled')
            finally:
                recovered.close()

    def test_restart_refuses_changed_baseline_without_gating_runtime(self):
        for change in ('link', 'receipt', 'version'):
            with self.subTest(change=change), running_engine() as (box, engine):
                _token, before = prepare(engine, box)
                baseline = engine.current.resolve()
                if change == 'link':
                    alternate = baseline.with_name('alternate-baseline')
                    alternate.mkdir()
                    atomic_json(alternate / '.relay-verified.json', json.loads((baseline / '.relay-verified.json').read_text()))
                    engine.switch(alternate)
                elif change == 'receipt':
                    receipt = baseline / '.relay-verified.json'
                    value = json.loads(receipt.read_text())
                    value['sha256'] = '0' * 64
                    atomic_json(receipt, value)
                else:
                    engine.data['currentVersion'] = 'v0.3.2'
                    engine.save()
                engine.close()
                recovered = Engine(box.config)
                try:
                    self.assertEqual(recovered.snapshot()['job']['phase'], 'failed')
                    self.assertFalse(box.maintenance.exists())
                    self.assertIsNone(recovered.data['checkpoint'])
                    self.assertFalse((engine.install / 'releases' / ('.stage-' + before['job']['id'])).exists())
                finally:
                    recovered.close()

    def test_restart_refuses_changed_staged_bytes_without_gating_runtime(self):
        with running_engine() as (box, engine):
            _token, before = prepare(engine, box)
            staged = engine.install / 'releases' / ('.stage-' + before['job']['id'])
            (staged / 'payload/service.mjs').write_text('process.exit(1);')
            engine.close()
            recovered = Engine(box.config)
            try:
                snapshot = recovered.snapshot()
                self.assertEqual(snapshot['job']['phase'], 'failed', snapshot)
                self.assertIn('Prepared payload', snapshot['job']['error'])
                self.assertFalse(box.maintenance.exists())
                self.assertEqual(recovered.data['currentVersion'], 'v0.3.0')
                self.assertIsNone(recovered.data['checkpoint'])
                self.assertFalse(staged.exists())
            finally:
                recovered.close()

    def test_ready_survives_broker_restart(self):
        with running_engine() as (box, engine):
            _token, before = prepare(engine, box)
            engine.close()
            recovered = Engine(box.config)
            try:
                after = recovered.snapshot()
                self.assertEqual(after['job']['phase'], 'ready', after)
                self.assertEqual(after['job']['id'], before['job']['id'])
                self.assertEqual(after['job']['version'], 'v0.3.1')
                self.assertFalse(after['canInstall'])
                self.assertTrue(after['canApply'])
                self.assertFalse(box.maintenance.exists())
            finally:
                recovered.close()

    def test_prepare_stages_verified_bytes_without_runtime_effects(self):
        with running_engine() as (box, engine):
            pid = engine.driver.process.pid
            current = engine.current.readlink()
            token, snapshot = prepare(engine, box)
            job = snapshot['job']
            self.assertEqual(job['phase'], 'ready', job)
            self.assertEqual(job['downloadedBytes'], job['totalBytes'])
            self.assertGreater(job['totalBytes'], 0)
            self.assertEqual(engine.driver.process.pid, pid)
            self.assertIsNone(engine.driver.process.poll())
            self.assertEqual(engine.current.readlink(), current)
            self.assertFalse(box.maintenance.exists())
            self.assertIsNone(engine.data['checkpoint'])
            self.assertEqual(list(engine.root.glob('backup-*')), [])
            self.assertEqual(box.state.joinpath('fixture.txt').read_text(), 'initial synthetic state')
            self.assertFalse(snapshot['canInstall'])
            self.assertFalse(snapshot['canPrepare'])
            self.assertTrue(snapshot['canApply'])
            self.assertTrue(job['canCancel'])
            staged = engine.install / 'releases' / ('.stage-' + job['id'])
            self.assertEqual(staged.stat().st_mode & 0o777, 0o700)
            self.assertTrue((staged / 'payload/service.mjs').is_file())
            self.assertEqual(json.loads(engine.journal.read_text())['job']['phase'], 'ready')
            self.assertEqual(engine.request('state', dict(token=token))['job']['id'], job['id'])


if __name__ == '__main__':
    unittest.main()
