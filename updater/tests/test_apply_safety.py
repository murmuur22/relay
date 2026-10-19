"""Apply boundary/race/crash qualification; synthetic HMAC and real Node only."""
import contextlib
import copy
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import types
import unittest
from unittest.mock import patch

from updater.broker.auth import Denied, digest
from updater.broker.engine import Engine, rollback_receipt
from updater.fixtures.harness import Sandbox, envelope
from updater.tests.test_prepare import authorization, client, prepare, running_engine


class ApplySafetyTests(unittest.TestCase):
    def test_apply_authority_is_fresh_one_use_user_job_and_version_bound(self):
        with running_engine() as (box, engine):
            token, ready = prepare(engine, box)
            job = ready['job']
            params = dict(token=token, version=job['version'], jobId=job['id'])
            expired = authorization(engine, box, 'apply', version=job['version'], jobId=job['id'])
            engine.authority.data['caps'][digest(expired)]['expiresAt'] = 0
            wrong = [None, 'forged-not-issued-apply-authority', expired,
                     authorization(engine, box, 'prepare', version=job['version']),
                     authorization(engine, box, 'apply', version='v0.3.2', jobId=job['id']),
                     authorization(engine, box, 'apply', version=job['version'], jobId='a'*32),
                     authorization(engine, box, 'apply', user='other-admin', version=job['version'], jobId=job['id'])]
            pid, link = engine.driver.process.pid, engine.current.readlink()
            for auth in wrong:
                with self.subTest(case=wrong.index(auth)), self.assertRaises(Denied):
                    engine.request('apply', dict(params, authorization=auth))
                self.assertIsNone(engine.data['checkpoint'])
                self.assertEqual(engine.data['job']['phase'], 'ready')
                self.assertFalse(box.maintenance.exists())
                self.assertEqual(engine.driver.process.pid, pid)
                self.assertEqual(engine.current.readlink(), link)
            auth = authorization(engine, box, 'apply', version=job['version'], jobId=job['id'])
            for changed in (dict(jobId='b'*32), dict(version='v0.3.2')):
                with self.assertRaises(Denied):
                    engine.request('apply', dict(params, authorization=auth, **changed))
                self.assertIn(digest(auth), engine.authority.data['caps'])
            engine.request('apply', dict(params, authorization=auth))
            engine.thread.join(15)
            self.assertFalse(engine.thread.is_alive())
            self.assertEqual(engine.data['job']['phase'], 'succeeded')
            self.assertNotIn(digest(auth), engine.authority.data['caps'])
            with self.assertRaises(Denied):
                engine.request('apply', dict(params, authorization=auth))

    def test_expiry_during_validation_refuses_intent_and_runtime_effects(self):
        for expired_kind in ('action', 'token'):
            with self.subTest(expired_kind=expired_kind), running_engine() as (box, engine):
                token, ready = prepare(engine, box)
                job = ready['job']
                auth = authorization(engine, box, 'apply', version=job['version'], jobId=job['id'])
                original = engine.driver.ready
                now = time.time()
                clock = types.SimpleNamespace(time=lambda: now)
                original_pid, link = engine.driver.process.pid, engine.current.readlink()
                def expire(version):
                    original(version)
                    cap = engine.authority.data['caps'][digest(auth if expired_kind == 'action' else token)]
                    clock.time = lambda: cap['expiresAt'] + 1
                # Module-local clock, never global time or a fake auth-success hook.
                with patch('updater.broker.auth.time', clock), patch.object(engine.driver, 'ready', side_effect=expire):
                    with self.assertRaises(Denied):
                        engine.request('apply', dict(token=token, authorization=auth, version=job['version'], jobId=job['id']))
                self.assertIn(digest(auth), engine.authority.data['caps'])
                self.assertIsNone(engine.data['checkpoint'])
                self.assertFalse(box.maintenance.exists())
                self.assertEqual(engine.data['job']['phase'], 'ready')
                self.assertEqual(engine.driver.process.pid, original_pid)
                self.assertEqual(engine.current.readlink(), link)
                self.assertEqual(box.ready()['version'], '0.3.0')

    def test_apply_cancel_linearize_in_both_lock_orders(self):
        for first in ('apply', 'cancel'):
            with self.subTest(first=first), running_engine() as (box, engine):
                token, ready = prepare(engine, box)
                job = ready['job']
                auths = {op: authorization(engine, box, op, **(dict(version=job['version'], jobId=job['id']) if op == 'apply' else dict(jobId=job['id']))) for op in ('apply', 'cancel')}
                entered, release, attempted, finished = (threading.Event() for _ in range(4))
                outcomes = {}
                workers = []
                original_ready, original_phase = engine.driver.ready, engine.phase
                def barrier():
                    entered.set()
                    if not release.wait(5):
                        raise AssertionError('Apply/cancel lock barrier timed out')
                def held_ready(version):
                    original_ready(version)
                    if version == 'v0.3.0':
                        barrier()
                def held_phase(phase, *args, **kwargs):
                    if phase == 'cancelled':
                        barrier()
                    return original_phase(phase, *args, **kwargs)
                def invoke(op, second=False):
                    if second:
                        attempted.set()
                    try:
                        params = dict(token=token, authorization=auths[op], jobId=job['id'])
                        if op == 'apply':
                            params['version'] = job['version']
                        outcomes[op] = engine.request(op, params)
                    except Exception as error:
                        outcomes[op] = error
                    finally:
                        if second:
                            finished.set()
                interception = patch.object(engine.driver, 'ready', side_effect=held_ready) if first == 'apply' else patch.object(engine, 'phase', side_effect=held_phase)
                with interception:
                    try:
                        worker = threading.Thread(target=invoke, args=(first,))
                        workers.append(worker)
                        worker.start()
                        self.assertTrue(entered.wait(5))
                        second = 'cancel' if first == 'apply' else 'apply'
                        worker = threading.Thread(target=invoke, args=(second, True))
                        workers.append(worker)
                        worker.start()
                        self.assertTrue(attempted.wait(5))
                        self.assertFalse(finished.wait(0.05), 'Contender must await the engine lock')
                    finally:
                        release.set()
                        for worker in workers:
                            worker.join(15)
                        if engine.thread:
                            engine.thread.join(15)
                self.assertTrue(all(not worker.is_alive() for worker in workers))
                self.assertIsInstance(outcomes[first], dict)
                self.assertIsInstance(outcomes[second], Denied)
                self.assertNotIn(digest(auths[first]), engine.authority.data['caps'])
                self.assertIn(digest(auths[second]), engine.authority.data['caps'])
                self.assertEqual(engine.data['job']['phase'], 'succeeded' if first == 'apply' else 'cancelled')
                self.assertEqual(box.ready()['version'], '0.3.1' if first == 'apply' else '0.3.0')
                self.assertFalse(box.maintenance.exists())
                self.assertIsNone(engine.data['checkpoint'])
                self.assertFalse((engine.install/'releases'/('.stage-'+job['id'])).exists())

    def test_ready_restart_keeps_live_runtime_and_does_not_autoapply(self):
        with running_engine() as (box, engine):
            _token, ready = prepare(engine, box)
            process, link = engine.driver.process, engine.current.readlink()
            engine.lockfile.close()  # Simulate broker lifetime only, not service death.
            recovered = Engine(box.config)
            try:
                self.assertEqual(recovered.snapshot()['job']['phase'], 'ready')
                self.assertTrue(recovered.snapshot()['canApply'])
                self.assertIsNone(recovered.thread)
                self.assertIsNone(recovered.driver.process)
                self.assertIsNone(process.poll())
                self.assertEqual(recovered.current.readlink(), link)
                self.assertFalse(box.maintenance.exists())
                token = client(recovered, box)
                with self.assertRaises(Denied):
                    recovered.request('apply', dict(token=token, jobId=ready['job']['id'], version=ready['job']['version']))
            finally:
                recovered.close()

    def test_real_broker_crashes_preserve_checkpoint_and_never_resume_apply(self):
        for crash_phase in ('activating', 'restarting'):
            with self.subTest(crash_phase=crash_phase):
                box = Sandbox()
                helper = None
                try:
                    config = box.root / 'crash-config.json'
                    config.write_text(json.dumps(box.config))
                    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                               PYTHONPATH=str(Path(__file__).resolve().parents[2]))
                    helper = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--crash', str(config), crash_phase], env=env, start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    stdout, stderr = helper.communicate(timeout=30)
                    self.assertEqual(helper.returncode, 73, stderr.decode())
                    self.assertIn(b'DURABLE_CRASH_POINT', stdout)
                    before = json.loads((box.root/'control/journal.json').read_text())
                    self.assertTrue(before['checkpoint']['backupComplete'])
                    self.assertTrue(box.maintenance.exists())
                    link = (box.root/'install/current').readlink()
                    recovered = Engine(box.config)
                    try:
                        state = recovered.snapshot()
                        self.assertEqual(state['job']['phase'], 'interrupted')
                        self.assertEqual(recovered.data['checkpoint'], before['checkpoint'])
                        self.assertIsNone(recovered.thread)
                        self.assertFalse(state['canApply'])
                        self.assertFalse(state['canInstall'])
                        self.assertTrue(box.maintenance.exists())
                        self.assertEqual(recovered.current.readlink(), link)
                        self.assertTrue((recovered.root/before['checkpoint']['backup']).is_dir())
                        token = client(recovered, box)
                        for action in ('apply', 'prepare', 'start', 'rollback'):
                            with self.assertRaises(Denied):
                                recovered.request(action, dict(token=token, jobId=state['job']['id'], version=state['job']['version']))
                    finally:
                        recovered.close()
                finally:
                    if helper:
                        # This group is created solely for this exact helper and its
                        # fixtures. Normal crash points stop Node before exiting.
                        try:
                            os.killpg(helper.pid, 0)
                        except ProcessLookupError:
                            pass
                        else:
                            os.killpg(helper.pid, signal.SIGTERM)
                        helper.communicate(timeout=10)
                    box.close()

    def test_rollback_receipt_bounds_shapes_and_links(self):
        with running_engine() as (box, engine):
            release = engine.current.resolve()
            receipt = release/'.relay-verified.json'
            raw = receipt.read_bytes()
            def acquire():
                return rollback_receipt(engine.install, release.name, os.getuid(), engine.mode, 'v0.3.0')
            self.assertEqual(acquire(), hashlib.sha256(raw).hexdigest())
            receipt.write_bytes(raw + b' '*(4096-len(raw)))
            self.assertEqual(acquire(), hashlib.sha256(receipt.read_bytes()).hexdigest())
            receipt.write_bytes(raw + b' '*4096)
            with patch('updater.broker.engine.os.read', side_effect=AssertionError('Oversized rollback receipt read')):
                with self.assertRaises(Denied):
                    acquire()
            for value in ([], None, {}, {'mode':engine.mode,'version':[],'sha256':'0'*64}):
                receipt.write_text(json.dumps(value))
                with self.assertRaises(Denied):
                    acquire()
            receipt.write_bytes(raw)
            receipt.rename(box.root/'original-receipt')
            try:
                for kind in ('symlink', 'fifo', 'hardlink'):
                    if kind == 'symlink':
                        receipt.symlink_to(box.root/'original-receipt')
                    elif kind == 'fifo':
                        os.mkfifo(receipt)
                    else:
                        os.link(box.root/'original-receipt', receipt)
                    try:
                        with patch('updater.broker.engine.os.read', side_effect=AssertionError('Linked rollback receipt read')):
                            with self.assertRaises((Denied, OSError)):
                                acquire()
                    finally:
                        receipt.unlink()
            finally:
                (box.root/'original-receipt').rename(receipt)

    def test_rollback_parent_and_receipt_substitution_are_refused(self):
        for boundary in ('releases', '.relay-verified.json', 'during-read'):
            with self.subTest(boundary=boundary), running_engine() as (box, engine):
                release = engine.current.resolve()
                receipt = release/'.relay-verified.json'
                original_open, original_read = os.open, os.read
                changed = []
                target = engine.install/'releases' if boundary == 'releases' else receipt
                displaced = box.root/'displaced'
                def substitute():
                    changed.append(True)
                    target.rename(displaced)
                    target.symlink_to(displaced, target_is_directory=boundary == 'releases')
                def open_at(name, flags, *args, **kwargs):
                    if str(name) == boundary and not changed:
                        self.assertIsNotNone(kwargs.get('dir_fd'))
                        self.assertTrue(flags & os.O_NOFOLLOW)
                        substitute()
                    return original_open(name, flags, *args, **kwargs)
                def read(fd, count):
                    self.assertEqual(count, 4097)
                    raw = original_read(fd, count)
                    if boundary == 'during-read' and not changed:
                        substitute()
                    return raw
                try:
                    with patch('updater.broker.engine.os.open', side_effect=open_at), patch('updater.broker.engine.os.read', side_effect=read):
                        with self.assertRaises((Denied, OSError)):
                            rollback_receipt(engine.install, release.name, os.getuid(), engine.mode, 'v0.3.0')
                    self.assertEqual(changed, [True])
                finally:
                    if changed:
                        target.unlink()
                        displaced.rename(target)

    def test_socket_protocol_apply_is_explicit_and_bound_to_prepared_job(self):
        # Genuine Unix protocol, fixture HMAC issuance, HTTP transfer and Node.
        with Sandbox() as box:
            call = box.client()
            call('check')
            ready = call('prepare', version='v0.3.1', authorization=box.authorization('prepare', version='v0.3.1'))
            deadline = time.monotonic()+15
            while ready['job']['phase'] != 'ready' and time.monotonic() < deadline:
                time.sleep(0.02)
                ready = call('state')
            self.assertEqual(ready['job']['phase'], 'ready')
            job = ready['job']
            self.assertEqual(box.ready()['version'], '0.3.0')
            with self.assertRaises(RuntimeError):
                call('apply', jobId=job['id'], version='v0.3.1', authorization=box.authorization('install', version='v0.3.1'))
            auth = box.authorization('apply', version='v0.3.1', jobId=job['id'])
            call('apply', jobId=job['id'], version='v0.3.1', authorization=auth)
            self.assertEqual(box.wait(call)['phase'], 'succeeded')
            self.assertEqual(box.ready()['version'], '0.3.1')
            with self.assertRaises(RuntimeError):
                call('apply', jobId=job['id'], version='v0.3.1', authorization=auth)


def crash_helper(config_path, crash_phase):
    config = json.loads(Path(config_path).read_text())
    engine = Engine(config)
    engine.driver.start()
    engine.driver.ready('v0.3.0')
    box = types.SimpleNamespace(key=Path(config['bridgeKeyFile']).read_bytes(), config=config)
    token, ready = prepare(engine, box)
    if ready['job']['phase'] != 'ready':
        raise AssertionError('Crash helper preparation failed')
    original = engine.phase
    def crash_at(phase, *args, **kwargs):
        original(phase, *args, **kwargs)
        if phase == crash_phase:
            print('DURABLE_CRASH_POINT '+phase, flush=True)
            os._exit(73)
    engine.phase = crash_at
    job = ready['job']
    engine.request('apply', dict(token=token, authorization=authorization(engine, box, 'apply', version=job['version'], jobId=job['id']), version=job['version'], jobId=job['id']))
    engine.thread.join(20)
    raise AssertionError('Crash point was not reached')


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--crash':
        crash_helper(sys.argv[2], sys.argv[3])
    else:
        unittest.main()
