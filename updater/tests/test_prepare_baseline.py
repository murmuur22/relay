"""Prepare-only receipt boundary regressions for reviewer blockers F1/F2."""
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from updater.broker.auth import Denied, atomic_json
from updater.broker.engine import Engine
from updater.tests.test_prepare import authorization, client, prepare, running_engine


class PreparationBaselineTests(unittest.TestCase):
    def test_ready_restart_retires_nonobject_receipt_with_runtime_alive(self):
        with running_engine() as (box, engine):
            _token, ready = prepare(engine, box)
            self.assertEqual(ready['job']['phase'], 'ready')
            process = engine.driver.process
            assert process is not None
            pid, link = process.pid, engine.current.readlink()
            receipt = engine.current.resolve() / '.relay-verified.json'
            receipt.write_text('[]')
            engine.lockfile.close()  # Broker lifetime only; do not stop the real Node runtime.
            recovered = Engine(box.config)
            try:
                self.assertEqual(recovered.snapshot()['job']['phase'], 'failed')
                self.assertEqual(json.loads(engine.journal.read_text())['job']['phase'], 'failed')
                self.assertNotIn('prepared', recovered.data)
                self.assertFalse((engine.install / 'releases' / ('.stage-' + ready['job']['id'])).exists())
                self.assertIsNone(process.poll())
                self.assertEqual(process.pid, pid)
                self.assertEqual(engine.current.readlink(), link)
                self.assertEqual(box.ready()['version'], '0.3.0')
                self.assertFalse(box.maintenance.exists())
                self.assertIsNone(recovered.data['checkpoint'])
            finally:
                recovered.close()

    def test_receipt_schema_and_exact_version_reject_before_admission(self):
        with running_engine() as (box, engine):
            token = client(engine, box)
            engine.check()
            receipt = engine.current.resolve() / '.relay-verified.json'
            valid = json.loads(receipt.read_text())
            cases = [[], None, 1, 'receipt', {},
                     dict(valid, mode=[]), dict(valid, version=[]),
                     dict(valid, version='0.3.0'), dict(valid, version='v00.3.0'),
                     dict(valid, version='v0.3.1'), dict(valid, sha256=[]),
                     dict(valid, sha256='not-a-digest'),
                     {k: v for k, v in valid.items() if k != 'sha256'}]
            for value in cases:
                with self.subTest(value=value):
                    atomic_json(receipt, value)
                    with self.assertRaises(Denied):
                        engine.request('prepare', dict(token=token, version='v0.3.1', authorization=authorization(engine, box, 'prepare', version='v0.3.1')))
                    self.assertIsNone(engine.data['job'])
                    self.assertIsNone(engine.thread)
                    self.assertFalse(box.maintenance.exists())
            atomic_json(receipt, valid)
            baseline = engine.preparation_baseline()
            self.assertEqual(baseline['version'], 'v0.3.0')
            engine.current.unlink()
            engine.current.symlink_to(Path('releases') / receipt.parent.name)
            self.assertEqual(engine.preparation_baseline()['release'], receipt.parent.name)

    def test_oversized_receipt_is_never_read_or_parsed(self):
        with running_engine() as (box, engine):
            receipt = engine.current.resolve() / '.relay-verified.json'
            value = json.loads(receipt.read_text())
            atomic_json(receipt, dict(value, padding='x' * 1024 * 1024))
            with patch.object(Path, 'read_text', side_effect=AssertionError('Path reader used')), patch('updater.broker.engine.os.read', side_effect=AssertionError('Oversized bytes read')), patch('updater.broker.engine.json.loads', side_effect=AssertionError('Oversized bytes parsed')):
                with self.assertRaises(Denied):
                    engine.preparation_baseline()

    def test_receipt_and_managed_directories_require_trusted_metadata(self):
        for kind in ('receipt-link', 'receipt-hardlink', 'receipt-fifo', 'receipt-directory', 'receipt-writable', 'release-writable', 'releases-writable', 'install-writable', 'release-link', 'releases-link'):
            with self.subTest(kind=kind), running_engine() as (box, engine):
                receipt = engine.current.resolve() / '.relay-verified.json'
                if kind == 'receipt-link':
                    receipt.rename(box.root / 'foreign')
                    receipt.symlink_to(box.root / 'foreign')
                elif kind == 'receipt-hardlink':
                    os.link(receipt, box.root / 'foreign')
                elif kind in ('receipt-fifo', 'receipt-directory'):
                    receipt.unlink()
                    os.mkfifo(receipt) if kind == 'receipt-fifo' else receipt.mkdir()
                elif kind.endswith('-writable'):
                    target = {'receipt-writable': receipt, 'release-writable': receipt.parent, 'releases-writable': receipt.parent.parent, 'install-writable': engine.install}[kind]
                    target.chmod(0o777)
                else:
                    target = receipt.parent if kind == 'release-link' else receipt.parent.parent
                    target.rename(box.root / 'foreign')
                    target.symlink_to(box.root / 'foreign', target_is_directory=True)
                with patch.object(Path, 'read_text', side_effect=AssertionError('Path reader used')):
                    with self.assertRaises(Denied):
                        engine.preparation_baseline()
                self.assertFalse(box.maintenance.exists())
                self.assertIsNone(engine.data['job'])

    def test_receipt_replacement_between_stat_and_open_is_not_followed(self):
        with running_engine() as (box, engine):
            receipt = engine.current.resolve() / '.relay-verified.json'
            foreign = box.root / 'foreign'
            foreign.write_bytes(receipt.read_bytes())
            original = os.open
            swapped = []
            def swap(path, flags, *args, **kwargs):
                if Path(path).name == receipt.name and not swapped:
                    swapped.append(True)
                    receipt.unlink()
                    receipt.symlink_to(foreign)
                return original(path, flags, *args, **kwargs)
            with patch('updater.broker.engine.os.open', side_effect=swap), patch('updater.broker.engine.os.read', side_effect=AssertionError('Swapped receipt read')):
                with self.assertRaises(Denied):
                    engine.preparation_baseline()
            self.assertTrue(swapped)
            self.assertFalse(box.maintenance.exists())

    def test_bounded_reader_accepts_exact_limit_and_rejects_growth_before_open(self):
        with running_engine() as (box, engine):
            receipt = engine.current.resolve() / '.relay-verified.json'
            raw = receipt.read_bytes()
            receipt.write_bytes(raw + b' ' * (4096 - len(raw)))
            original_open, original_read = os.open, os.read
            reads = []
            def read(fd, count):
                reads.append(count)
                return original_read(fd, count)
            with patch('updater.broker.engine.os.read', side_effect=read):
                self.assertEqual(engine.preparation_baseline()['version'], 'v0.3.0')
            self.assertEqual(reads, [4097])
            def grow(path, flags, *args, **kwargs):
                if Path(path).name == receipt.name:
                    self.assertIsNotNone(kwargs.get('dir_fd'))
                    self.assertTrue(flags & os.O_NOFOLLOW)
                    self.assertTrue(flags & os.O_NONBLOCK)
                    with receipt.open('ab') as output:
                        output.write(b' ' * 8192)
                return original_open(path, flags, *args, **kwargs)
            with patch('updater.broker.engine.os.open', side_effect=grow), patch('updater.broker.engine.os.read', side_effect=AssertionError('Grown receipt read')):
                with self.assertRaises(Denied):
                    engine.preparation_baseline()

    def test_ready_restart_receipt_race_fails_durably_without_runtime_effects(self):
        with running_engine() as (box, engine):
            _token, ready = prepare(engine, box)
            self.assertEqual(ready['job']['phase'], 'ready')
            receipt = engine.current.resolve() / '.relay-verified.json'
            original = os.open
            swapped = []
            def swap(path, flags, *args, **kwargs):
                if Path(path).name == receipt.name and not swapped:
                    swapped.append(True)
                    receipt.rename(box.root / 'foreign')
                    receipt.symlink_to(box.root / 'foreign')
                return original(path, flags, *args, **kwargs)
            engine.lockfile.close()
            with patch('updater.broker.engine.os.open', side_effect=swap):
                recovered = Engine(box.config)
            try:
                self.assertTrue(swapped)
                self.assertEqual(recovered.snapshot()['job']['phase'], 'failed')
                self.assertEqual(json.loads(engine.journal.read_text())['job']['phase'], 'failed')
                self.assertNotIn('prepared', recovered.data)
                self.assertFalse(box.maintenance.exists())
                process = engine.driver.process
                assert process is not None
                self.assertIsNone(process.poll())
                self.assertEqual(box.ready()['version'], '0.3.0')
            finally:
                recovered.close()

    def test_baseline_owner_is_checked_on_opened_objects(self):
        with running_engine() as (box, engine):
            owner = os.getuid()
            with patch('updater.broker.engine.os.getuid', return_value=owner + 1), patch('updater.broker.engine.os.read', side_effect=AssertionError('Foreign metadata read')):
                with self.assertRaises(Denied):
                    engine.preparation_baseline()

    def test_mutation_during_descriptor_read_is_refused(self):
        for kind in ('receipt-grow', 'receipt-replace', 'release-replace', 'releases-replace', 'install-replace', 'current-replace'):
            with self.subTest(kind=kind), running_engine() as (box, engine):
                receipt = engine.current.resolve() / '.relay-verified.json'
                original = os.read
                changed = []
                def read(fd, count):
                    raw = original(fd, count)
                    if not changed:
                        changed.append(True)
                        if kind == 'receipt-grow':
                            with receipt.open('ab') as output:
                                output.write(b' ' * 8192)
                        elif kind == 'receipt-replace':
                            receipt.rename(box.root / 'moved')
                            receipt.write_bytes(raw)
                        elif kind == 'current-replace':
                            link = engine.current.readlink()
                            engine.current.rename(box.root / 'old-current')
                            engine.current.symlink_to(link)
                        else:
                            target = {'release-replace': receipt.parent, 'releases-replace': receipt.parent.parent, 'install-replace': engine.install}[kind]
                            target.rename(box.root / 'moved')
                            target.symlink_to(box.root / 'moved', target_is_directory=True)
                    return raw
                with patch('updater.broker.engine.os.read', side_effect=read):
                    with self.assertRaises(Denied):
                        engine.preparation_baseline()
                self.assertTrue(changed)
                self.assertFalse(box.maintenance.exists())


if __name__ == '__main__':
    unittest.main()
