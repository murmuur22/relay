import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from updater.release.build import build


class ReleaseTests(unittest.TestCase):
    def test_optional_updater_manifest_and_initial_installer_verification(self):
        import hashlib
        from updater.broker import releases
        from updater.broker.auth import Denied
        artifact = dict(name=releases.ARTIFACT, sha256='a' * 64, size=1)
        manifest = dict(protocol=1, repository=releases.REPO, version='v1.2.3', platform='linux-x64', stateSchema=1, rollbackCompatible=True, minimumNode='26.8.1', artifact=artifact)
        releases.manifest_valid(manifest, 'v1.2.3')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'payload'
            path.write_bytes(b'control plane')
            updater = dict(name='relay-updater-linux-x64.tar.gz', sha256=hashlib.sha256(path.read_bytes()).hexdigest(), size=path.stat().st_size)
            manifest['updaterArtifact'] = updater
            releases.manifest_valid(manifest, 'v1.2.3')
            self.assertTrue(releases.verify_artifact(path, updater, updater=True))
            path.write_bytes(b'tampered')
            with self.assertRaises(Denied):
                releases.verify_artifact(path, updater, updater=True)
            for invalid in (None, [], {}, dict(updater, name='../payload'), dict(updater, size=True), dict(updater, sha256='A' * 64), dict(updater, size=releases.MAX_ARCHIVE + 1)):
                with self.subTest(invalid=invalid), self.assertRaises(Denied):
                    releases.manifest_valid(dict(manifest, updaterArtifact=invalid), 'v1.2.3')
            with self.assertRaises(Denied):
                releases.manifest_valid(dict(manifest, artifact=[]), 'v1.2.3')

    def test_control_plane_rejects_missing_inputs_and_symlink_ancestors(self):
        from updater.release.build import control_bundle, CONTROL_FILES
        from updater.broker.auth import Denied
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source'
            source.mkdir()
            output = Path(tmp) / 'output'
            output.mkdir()
            for name in (*CONTROL_FILES, 'updater/ui/dist/index.html'):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic')
            (source / 'deploy').rename(source / 'operator')
            (source / 'deploy').symlink_to(source / 'operator', target_is_directory=True)
            with self.assertRaises(Denied):
                control_bundle(source, output, {'version': '1.2.3'})
            (source / 'deploy').unlink()
            (source / 'operator').rename(source / 'deploy')
            (source / 'deploy/install-release.py').unlink()
            with self.assertRaises(Denied):
                control_bundle(source, output, {'version': '1.2.3'})

    def test_runtime_rejects_exact_input_symlink(self):
        from updater.release.build import CONTROL_FILES
        from updater.broker.auth import Denied
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source'
            source.mkdir()
            (source / 'package.json').write_text('{"version":"1.2.3"}')
            for name in ('server/index.mjs', 'dist/index.html', 'version.js', 'node_modules/playwright/package.json', 'browsers/chrome', 'tools/icon-normalize.py', 'updater/ui/dist/index.html', *CONTROL_FILES):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic')
            (source / 'version.js').unlink()
            (source / 'version.js').symlink_to(source / 'package.json')
            with self.assertRaises(Denied):
                build(source, source / 'browsers', Path(tmp) / 'out', 'v1.2.3', allow_nonlinux=True)

    def test_production_verifier_uses_downloaded_bundle_without_login(self):
        from unittest.mock import patch
        from updater.broker.releases import Releases, SAFE_ENV
        manifest = dict(protocol=1, repository='murmuur22/relay', version='v1.2.3', platform='linux-x64', stateSchema=1, rollbackCompatible=True, minimumNode='26.8.1', artifact=dict(name='relay-linux-x64.tar.gz', sha256='a' * 64, size=1))
        # This tests invocation, NOT a real GitHub signature.
        with tempfile.TemporaryDirectory() as tmp, patch('updater.broker.releases.transfer', side_effect=[json.dumps(manifest).encode(), b'{}']) as transfer, patch('updater.broker.releases.subprocess.run') as run:
            Releases({'mode': 'production'}).verified_manifest('v1.2.3', tmp)
            args, kwargs = run.call_args
            self.assertIn('--bundle', args[0])
            self.assertIn('--deny-self-hosted-runners', args[0])
            self.assertIn('refs/tags/v1.2.3', args[0])
            self.assertIn('murmuur22/relay/.github/workflows/release.yml', args[0])
            self.assertEqual(kwargs['env']['PATH'], SAFE_ENV['PATH'])
            self.assertNotEqual(kwargs['env']['HOME'], '/nonexistent')
            self.assertTrue(Path(kwargs['env']['HOME']).is_relative_to(Path(tmp)))
            self.assertNotIn('GH_TOKEN', kwargs['env'])
            self.assertEqual(kwargs['env']['GH_CONFIG_DIR'], '/nonexistent')
            self.assertEqual(transfer.call_count, 2)

    def test_tag_validation_matches_both_package_files(self):
        from updater.release.validate_tag import validate
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'package.json').write_text('{"version":"1.2.3"}')
            (root / 'package-lock.json').write_text('{"version":"1.2.3","packages":{"":{"version":"1.2.3"}}}')
            validate('v1.2.3', root)
            for tag in ('v1.2.3-rc1', 'v01.2.3', 'v1.2.4', 'main'):
                with self.assertRaises(ValueError):
                    validate(tag, root)

    def test_allowlisted_payload_excludes_private_data_and_scripts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.mkdir()
            (source / 'package.json').write_text(json.dumps(dict(name='we-relay', version='1.2.3', type='module', scripts={'postinstall':'unsafe'})))
            for name in ('server/index.mjs', 'dist/index.html', 'dist/fonts/private.woff2', 'version.js', 'node_modules/playwright/package.json', 'browsers/chromium/chrome', '.runtime/accounts.json', 'integrations/private.txt', 'updater/web/broker-client.mjs', 'tools/icon-normalize.py'):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic')
            from updater.release.build import CONTROL_FILES
            for name in (*CONTROL_FILES, 'updater/ui/dist/index.html', 'updater/ui/dist/assets/app.js', 'updater/ui/dist/licenses/three.txt', 'updater/broker/secret.json', 'updater/broker/tests/private.py', 'deploy/private.env'):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic')
            output = root / 'out'
            result = build(source, source / 'browsers', output, 'v1.2.3', allow_nonlinux=True)
            with tarfile.open(output / 'relay-linux-x64.tar.gz') as archive:
                names = archive.getnames()
                self.assertIn('updater/web/broker-client.mjs', names)
                self.assertIn('tools/icon-normalize.py', names)
                self.assertFalse(any('private' in n or '.runtime' in n or 'integrations' in n or '/fonts/' in n for n in names))
                package = json.load(archive.extractfile('package.json'))
                self.assertNotIn('scripts', package)
            self.assertEqual(result['version'], 'v1.2.3')
            from updater.broker.releases import verify_artifact
            self.assertTrue(verify_artifact(output / result['updaterArtifact']['name'], result['updaterArtifact'], updater=True))
            with tarfile.open(output / result['updaterArtifact']['name']) as archive:
                names = archive.getnames()
                self.assertIn('updater/broker/server.py', names)
                self.assertIn('updater/web/index.mjs', names)
                self.assertIn('updater/ui/dist/index.html', names)
                self.assertIn('updater/ui/dist/licenses/three.txt', names)
                self.assertIn('deploy/install-release.py', names)
                self.assertIn('updater/web/relay-updater-web.service', names)
                self.assertIn('updater/deploy/relay-updater-broker.service', names)
                self.assertIn('deploy/verify-standalone.mjs', names)
                self.assertFalse(any('private' in n or 'secret' in n or '/tests/' in n for n in names))
                self.assertEqual(json.load(archive.extractfile('package.json'))['type'], 'module')
            self.assertGreater(result['artifact']['size'], 0)
            self.assertFalse((output / 'relay-release.attestation.json').exists())
            from updater.release.build import control_bundle
            from updater.broker.auth import Denied
            (source / 'updater/ui/dist/secret.txt').write_text('must not be packaged')
            with self.assertRaisesRegex(Denied, 'Unexpected updater UI asset'):
                control_bundle(source, output, {'version': '1.2.3'})


if __name__ == '__main__':
    unittest.main()
