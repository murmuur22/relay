"""Source packaging tests; synthetic archives are not GitHub attestation."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest


class PresentationReleaseTests(unittest.TestCase):
    def test_runtime_archive_carries_inert_complete_presentation_and_old_manifest_protocol(self):
        from updater.release.build import build, CONTROL_FILES
        from updater.release.presentation import describe
        import tarfile
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp).resolve() / 'source'
            source.mkdir()
            (source / 'package.json').write_text('{"version":"1.2.3"}')
            for name in ('server/index.mjs', 'dist/index.html', 'version.js', 'node_modules/playwright/package.json',
                         'browsers/chrome', 'tools/icon-normalize.py', 'tools/relay-agent.mjs', 'updater/ui/dist/index.html', *CONTROL_FILES):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic source')
            presentation = source / 'updater/ui/presentation-dist'
            (presentation / 'assets').mkdir(parents=True)
            (presentation / 'index.html').write_text('<script src="/updater/presentation/v1.2.3/assets/index-ABC123.js"></script>')
            (presentation / 'assets/index-ABC123.js').write_text('source')
            describe(presentation, 'v1.2.3')
            output = Path(tmp).resolve() / 'output'
            manifest = build(source, source / 'browsers', output, 'v1.2.3', allow_nonlinux=True)
            self.assertEqual(set(manifest), {'protocol', 'repository', 'version', 'platform', 'stateSchema',
                                            'rollbackCompatible', 'minimumNode', 'artifact', 'updaterArtifact'})
            with tarfile.open(output / manifest['artifact']['name']) as archive:
                for path in presentation.rglob('*'):
                    if path.is_file():
                        name = 'updater-presentation/' + path.relative_to(presentation).as_posix()
                        self.assertIn(name, archive.getnames())
                        self.assertEqual(archive.extractfile(name).read(), path.read_bytes())
            from updater.broker.releases import manifest_valid
            manifest_valid(manifest, 'v1.2.3')

    def test_new_delivery_tests_do_not_depend_on_private_operator_paths(self):
        root = Path(__file__).resolve().parents[2]
        for path in ('tests/backend/updater-presentation.test.mjs', 'tests/frontend/updater-presentation.test.mjs',
                     'tests/helpers/updater-runtime-presentation.py'):
            source = (root / path).read_text()
            import re
            self.assertIsNone(re.search(r'/Users/[^\s\"\']+', source), path)
            self.assertTrue('.hermes/cache/scratch' not in source, path)

    def test_signed_old_archive_broker_comparison_rejects_tampering(self):
        from updater.release.verify_broker_baseline import verify
        from updater.release.build import CONTROL_FILES, control_bundle
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp).resolve() / 'source', Path(tmp).resolve() / 'output'
            output.mkdir()
            for name in (*CONTROL_FILES, 'updater/ui/dist/index.html'):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic old source')
            descriptor = control_bundle(source, output, {'version': '0.6.4'})
            manifest = output / 'relay-release.json'
            manifest.write_text(json.dumps({'version': 'v0.6.4', 'updaterArtifact': descriptor}))
            proof = verify(source, manifest, output / descriptor['name'])
            self.assertEqual(len(proof), 7)
            (source / 'updater/broker/engine.py').write_text('must refuse')
            with self.assertRaises(ValueError):
                verify(source, manifest, output / descriptor['name'])

    def test_official_workflows_build_presentation_and_execute_every_delivery_and_font_case(self):
        root = Path(__file__).resolve().parents[2]
        for name in ('check.yml', 'release.yml'):
            workflow = (root / '.github/workflows' / name).read_text()
            self.assertIn('npm run build:updater', workflow)
            self.assertIn('python3 -m unittest discover -s updater/tests -v', workflow)
            self.assertIn('tests/backend/updater*.test.mjs', workflow)
            self.assertIn('tests/frontend/updater*.test.mjs', workflow)
            self.assertIn('updater/ui/tests/http-smoke.mjs updater/ui/tests/fixture-smoke.mjs', workflow)
            self.assertIn('npm --prefix updater/ui test', workflow)
        release = (root / '.github/workflows/release.yml').read_text()
        for required in ('--source-ref', '--source-digest', '--signer-digest', '--deny-self-hosted-runners',
                         '--prerelease --latest=false', 'runs-on: ubuntu-24.04'):
            self.assertIn(required, release)
        self.assertNotIn('self-hosted,', release)

    def test_all_three_built_surfaces_ship_byte_exact_font_and_original_license_pins(self):
        root = Path(__file__).resolve().parents[2]
        from updater.release.presentation import validate
        version = 'v' + json.loads((root / 'package.json').read_text())['version']
        validate(root / 'updater/ui/presentation-dist', version)
        pins = json.loads((root / 'updater/ui/src/assets/font-sources.json').read_text())
        for relative in ('dist', 'updater/ui/dist', 'updater/ui/presentation-dist'):
            dist = root / relative
            for pin in pins['sources']:
                if 'woff2Sha256' in pin:
                    stem = 'silkscreen-bold' if pin['family'] == 'silkscreen' else 'share-tech-mono'
                    fonts = list((dist / 'assets').glob(stem + '-*.woff2'))
                    self.assertEqual(len(fonts), 1, relative + ': missing/duplicate bundled font')
                    self.assertEqual(hashlib.sha256(fonts[0].read_bytes()).hexdigest(), pin['woff2Sha256'])
                else:
                    notice = dist / 'licenses' / (pin['family'] + '-OFL.txt')
                    self.assertEqual(hashlib.sha256(notice.read_bytes()).hexdigest(), pin['sha256'])
            self.assertEqual(json.loads((dist / 'licenses/updater-font-sources.json').read_text()), pins)
            self.assertEqual((dist / 'licenses/three.txt').read_bytes(), (root / 'public/licenses/three.txt').read_bytes())

    def test_descriptor_binds_complete_versioned_presentation_without_manifest_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp).resolve() / 'presentation'
            (dist / 'assets').mkdir(parents=True)
            prefix = '/updater/presentation/v1.2.3/'
            (dist / 'index.html').write_text('<script type="module" src="' + prefix + 'assets/index-ABC123.js"></script>')
            (dist / 'assets/index-ABC123.js').write_text('const api="/updater/api/auth";')
            from updater.release.presentation import describe, validate
            descriptor = describe(dist, 'v1.2.3')
            self.assertEqual(set(descriptor), {'schema', 'webApi', 'version', 'files'})
            self.assertEqual((descriptor['schema'], descriptor['webApi'], descriptor['version']), (1, 1, 'v1.2.3'))
            self.assertEqual([f['path'] for f in descriptor['files']], ['assets/index-ABC123.js', 'index.html'])
            for entry in descriptor['files']:
                raw = (dist / entry['path']).read_bytes()
                self.assertEqual(entry['size'], len(raw))
                self.assertEqual(entry['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(validate(dist, 'v1.2.3'), descriptor)
            self.assertNotIn('presentation.json', [f['path'] for f in descriptor['files']])


    def test_source_description_refuses_links_unknown_paths_wrong_base_and_bounds(self):
        from updater.release.presentation import describe
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp).resolve() / 'presentation'
            (dist / 'assets').mkdir(parents=True)
            index = dist / 'index.html'
            index.write_text('<script src="/updater/assets/index-ABC123.js"></script>')
            with self.assertRaises(ValueError):
                describe(dist, 'v1.2.3')
            index.write_text('<script src="/updater/presentation/v1.2.3/assets/index-ABC123.js"></script>')
            asset = dist / 'assets/index-ABC123.js'
            asset.write_text('source')
            for name in ('private.txt', 'assets/private.woff2', 'licenses/secret.json', '.secret', 'assets/index.js'):
                path = dist / name
                path.parent.mkdir(exist_ok=True)
                path.write_text('not permitted')
                with self.subTest(name=name), self.assertRaises(ValueError):
                    describe(dist, 'v1.2.3')
                path.unlink()
            link = dist / 'assets/linked-ABC123.js'
            link.symlink_to(asset)
            with self.assertRaises(ValueError):
                describe(dist, 'v1.2.3')
            link.unlink()
            import os
            os.link(asset, link)
            with self.assertRaises(ValueError):
                describe(dist, 'v1.2.3')
            link.unlink()
            asset.write_bytes(b'x' * (4 * 1024 * 1024 + 1))
            with self.assertRaises(ValueError):
                describe(dist, 'v1.2.3')
            asset.write_bytes(b'x' * (4 * 1024 * 1024 - 1024))
            with self.assertRaises(ValueError, msg='Reserve bounded descriptor and runtime package metadata inside candidate budget'):
                describe(dist, 'v1.2.3')
            asset.write_text('source')
            for n in range(64):
                (dist / f'assets/chunk-{n:06}.js').write_text('x')
            with self.assertRaises(ValueError):
                describe(dist, 'v1.2.3')

    def test_validate_rejects_corrupt_duplicate_missing_extra_and_incompatible_descriptor(self):
        from updater.release.presentation import describe, validate
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp).resolve()
            (dist / 'index.html').write_text('<script src="/updater/presentation/v1.2.3/assets/index-ABC123.js"></script>')
            (dist / 'assets').mkdir()
            asset = dist / 'assets/index-ABC123.js'
            asset.write_text('source')
            good = describe(dist, 'v1.2.3')
            descriptor_path = dist / 'presentation.json'
            for bad in (dict(good, schema=2), dict(good, webApi=2), dict(good, surprise=True),
                        dict(good, version='v1.2.4'), dict(good, files=good['files'] * 2),
                        dict(good, files=[dict(good['files'][0], size=True), good['files'][1]]),
                        dict(good, files=[dict(good['files'][0], sha256='A' * 64), good['files'][1]])):
                descriptor_path.write_text(json.dumps(bad))
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    validate(dist, 'v1.2.3')
            descriptor_path.write_text(json.dumps(good))
            asset.write_text('corrupt')
            with self.assertRaises(ValueError):
                validate(dist, 'v1.2.3')
            asset.unlink()
            with self.assertRaises(ValueError):
                validate(dist, 'v1.2.3')


if __name__ == '__main__':
    unittest.main()
