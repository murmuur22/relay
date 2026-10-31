"""Required root notices are exact inputs, not general text-file admission."""
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from updater.broker.auth import Denied
from updater.release.build import build, control_bundle, CONTROL_FILES
from updater.release.presentation import describe

NOTICE = 'THIRD_PARTY_NOTICES.md'


class NoticeReleaseTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'source'
        source.mkdir()
        (source / 'package.json').write_text(json.dumps({'version': '1.2.3'}))
        for name in (*CONTROL_FILES, NOTICE, 'server/index.mjs', 'dist/index.html',
                     'version.js', 'node_modules/playwright/package.json', 'browsers/chrome',
                     'tools/icon-normalize.py', 'tools/relay-agent.mjs', 'updater/ui/dist/index.html'):
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'synthetic input\n')
        (source / NOTICE).write_bytes(b'Exact notice fixture\r\nCopyright \xc2\xa9\n')
        (source / 'private.md').write_text('must remain excluded')
        presentation = source / 'updater/ui/presentation-dist'
        (presentation / 'assets').mkdir(parents=True)
        (presentation / 'index.html').write_text('<script src="/updater/presentation/v1.2.3/assets/index-ABC123.js"></script>')
        (presentation / 'assets/index-ABC123.js').write_text('synthetic')
        describe(presentation, 'v1.2.3')
        return source

    def package(self, kind, source, output):
        if kind == 'runtime':
            build(source, source / 'browsers', output, 'v1.2.3', allow_nonlinux=True)
            return output / 'relay-linux-x64.tar.gz'
        output.mkdir()
        result = control_bundle(source, output, {'version': '1.2.3'})
        return output / result['name']

    def test_both_actual_archives_contain_byte_exact_required_notice_only(self):
        for kind in ('runtime', 'control'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                source = self.fixture(root)
                artifact = self.package(kind, source, root / 'out')
                with tarfile.open(artifact) as archive:
                    self.assertIn(NOTICE, archive.getnames())
                    self.assertNotIn('private.md', archive.getnames())
                    member = archive.getmember(NOTICE)
                    self.assertTrue(member.isfile())
                    self.assertEqual(member.mode, 0o644)
                    self.assertEqual(archive.extractfile(member).read(), (source / NOTICE).read_bytes())

    def test_both_builders_fail_closed_when_required_notice_is_absent(self):
        for kind in ('runtime', 'control'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                source = self.fixture(root)
                (source / NOTICE).unlink()
                with self.assertRaises((Denied, FileNotFoundError)):
                    self.package(kind, source, root / 'out')
                self.assertFalse((root / 'out/relay-release.json').exists())

    def test_notice_uses_existing_no_link_regular_file_and_size_guards(self):
        for kind in ('runtime', 'control'):
            for invalid in ('symlink', 'directory', 'size'):
                with self.subTest(kind=kind, invalid=invalid), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    source = self.fixture(root)
                    notice = source / NOTICE
                    notice.unlink()
                    if invalid == 'symlink':
                        notice.symlink_to(source / 'LICENSE')
                    elif invalid == 'directory':
                        notice.mkdir()
                    else:
                        notice.write_bytes(b'x' * (1024 * 1024 + 1))
                    with patch('updater.release.build.MAX_EXPANDED', 1024 * 1024):
                        with self.assertRaises(Denied):
                            self.package(kind, source, root / 'out')


if __name__ == '__main__':
    unittest.main()
