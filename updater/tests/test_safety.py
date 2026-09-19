import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

from updater.broker.auth import Denied
from updater.broker.driver import copy_state
from updater.broker.releases import extract


def archive_at(path, entries):
    with tarfile.open(path, 'w:gz') as archive:
        for name, kind in entries:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.size = 1 if kind == tarfile.REGTYPE else 0
            entry.linkname = '/tmp/no-follow'
            archive.addfile(entry, io.BytesIO(b'x') if entry.size else None)


class ArchiveTests(unittest.TestCase):
    def test_extracted_runtime_is_traversable_under_private_broker_umask(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive_at(root / 'good.tar.gz', [('node_modules/pkg/file.js', tarfile.REGTYPE)])
            previous = os.umask(0o077)
            try:
                extract(root / 'good.tar.gz', root / 'out')
            finally:
                os.umask(previous)
            self.assertEqual((root / 'out/node_modules').stat().st_mode & 0o777, 0o755)
            self.assertEqual((root / 'out/node_modules/pkg').stat().st_mode & 0o777, 0o755)

    def test_reject_unsafe_archive_shapes(self):
        bad = [
            [('../escape', tarfile.REGTYPE)],
            [('/absolute', tarfile.REGTYPE)],
            [('a', tarfile.SYMTYPE)],
            [('a', tarfile.LNKTYPE)],
            [('a', tarfile.FIFOTYPE)],
            [('a', tarfile.REGTYPE), ('a', tarfile.REGTYPE)],
            [('A', tarfile.REGTYPE), ('a', tarfile.REGTYPE)],
            [('Folder/a', tarfile.REGTYPE), ('folder/b', tarfile.REGTYPE)],
        ]
        for entries in bad:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp)
                archive_at(path / 'bad.tar.gz', entries)
                with self.assertRaises(Denied):
                    extract(path / 'bad.tar.gz', path / 'out')

    def test_backup_refuses_hardlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            source = path / 'state'
            source.mkdir()
            (path / 'outside').write_text('outside state')
            os.link(path / 'outside', source / 'linked')
            with self.assertRaises(Denied):
                copy_state(source, path / 'backup')

    def test_backup_refuses_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            source = path / 'state'
            source.mkdir()
            (source / 'private').symlink_to('/etc/passwd')
            with self.assertRaises(Denied):
                copy_state(source, path / 'backup')


if __name__ == '__main__':
    unittest.main()
