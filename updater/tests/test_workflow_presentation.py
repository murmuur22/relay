"""Permanent presentation helper guards. Synthetic fixtures are not attestation.
When workflow old inputs are present, additionally verify the genuine archive.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('presentation_helper', ROOT / 'tests/helpers/updater-runtime-presentation.py')
assert spec is not None and spec.loader is not None
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class WorkflowPresentationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.source = self.root / 'trusted-old'
        self.archive = self.root / 'relay-updater-linux-x64.tar.gz'
        self.manifest = self.root / 'relay-release.json'
        self.files = {name: ('synthetic archived ' + name).encode() for name in helper.MODULES}
        self.files['updater/ui/dist/index.html'] = b'synthetic archived UI'
        for name, data in self.files.items():
            p = self.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        self.bundle()

    def bundle(self):
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, data in self.files.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
        self.manifest.write_text(json.dumps({'updaterArtifact': {'name': self.archive.name, 'size': self.archive.stat().st_size, 'sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest()}}))

    def verify(self, source=None, manifest=None, archive=None):
        return helper.verified_old_files(archive or self.archive, source or self.source, manifest or self.manifest)

    def test_all_seven_exact_pins_and_archived_ui(self):
        proofs, files = self.verify()
        self.assertEqual(set(proofs), set(helper.MODULES))
        self.assertEqual(files, self.files)
        self.assertEqual(proofs, {name: hashlib.sha256(self.files[name]).hexdigest() for name in helper.MODULES})

    def test_reference_required_not_inferred_from_candidate(self):
        for source, manifest in [(None, self.manifest), (self.source, None)]:
            with self.subTest(source=source, manifest=manifest), self.assertRaisesRegex(ValueError, 'explicit trusted old source and manifest'):
                helper.verified_old_files(self.archive, source, manifest)

    def test_each_module_reference_mismatch_rejected(self):
        for name in helper.MODULES:
            path = self.source / name
            path.write_bytes(self.files[name] + b' changed candidate')
            with self.subTest(module=name), self.assertRaisesRegex(ValueError, 'Broker source differs from baseline'):
                self.verify()
            path.write_bytes(self.files[name])

    def test_archive_digest_and_size_still_required(self):
        good = self.manifest.read_bytes()
        for key, value in [('sha256', '0' * 64), ('size', self.archive.stat().st_size + 1)]:
            obj = json.loads(good)
            obj['updaterArtifact'][key] = value
            self.manifest.write_text(json.dumps(obj))
            with self.subTest(field=key), self.assertRaises(ValueError):
                self.verify()
        self.manifest.write_bytes(good)
        self.archive.write_bytes(self.archive.read_bytes() + b'tamper')
        with self.assertRaises(ValueError):
            self.verify()

    def test_unsafe_old_ui_and_missing_old_ui_rejected(self):
        self.files['updater/ui/dist/../escape.js'] = b'unsafe synthetic path'
        self.bundle()
        with self.assertRaisesRegex(ValueError, 'Unsafe old fixture path'):
            self.verify()
        del self.files['updater/ui/dist/../escape.js']
        del self.files['updater/ui/dist/index.html']
        self.bundle()
        with self.assertRaisesRegex(ValueError, 'Missing genuine old UI'):
            self.verify()

    def test_workflows_export_all_explicit_old_inputs_without_weakening_attestation(self):
        for name in ('check.yml', 'release.yml'):
            text = (ROOT / '.github/workflows' / name).read_text()
            with self.subTest(workflow=name):
                for variable in ('RELAY_PRESENTATION_OLD_SOURCE', 'RELAY_PRESENTATION_OLD_MANIFEST', 'RELAY_PRESENTATION_OLD_UPDATER_ARCHIVE'):
                    self.assertIn(variable + '=%s', text)
                self.assertIn('verify_broker_baseline --source "$reference"', text)
                self.assertIn('test "$(git -C "$reference" rev-parse HEAD)" = "$reference_source"', text)
                self.assertIn('reference_source=0bf423eae6709b28fd5ace2a4b97e74924626fc8', text)
                self.assertIn('--source-ref "refs/tags/$baseline" --source-digest "$source" --signer-digest "$source" --deny-self-hosted-runners', text)
                self.assertIn('tests/frontend/updater*.test.mjs', text)
                self.assertIn('python3 -m unittest discover -s updater/tests -v', text)

    def test_explicit_workflow_baseline_and_candidate_mislabel(self):
        values = [os.environ.get(k) for k in ('RELAY_PRESENTATION_OLD_SOURCE', 'RELAY_PRESENTATION_OLD_MANIFEST', 'RELAY_PRESENTATION_OLD_UPDATER_ARCHIVE')]
        if any(values):
            self.assertTrue(all(values), 'Incomplete explicit workflow baseline')
            source, manifest, archive = values
            proofs, files = self.verify(source, manifest, archive)
            self.assertEqual(set(proofs), set(helper.MODULES))
            self.assertIn('updater/ui/dist/index.html', files)
            with self.assertRaisesRegex(ValueError, 'Broker source differs from baseline'):
                self.verify(ROOT, manifest, archive)
            print('Genuine cached workflow archive: seven exact pins and candidate-as-old rejection verified')
        else:
            candidate = self.root / 'candidate'
            shutil.copytree(self.source, candidate)
            (candidate / helper.MODULES[0]).write_bytes(b'synthetic changed candidate')
            with self.assertRaisesRegex(ValueError, 'Broker source differs from baseline'):
                self.verify(candidate)


if __name__ == '__main__':
    unittest.main()
