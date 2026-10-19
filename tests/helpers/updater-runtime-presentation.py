"""TEST ONLY: compiled source presentation copied/rebased for v0.3.0/1/2.
Recomputed inert descriptor + real fixture HMAC archives; NOT public signatures,
NOT real releases. Genuine Sandbox/Engine service activation and readiness apply.
"""
import argparse
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tarfile

from updater.fixtures.harness import Sandbox, SERVICE
from updater.broker.auth import atomic_json
from updater.broker.releases import ARTIFACT
from updater.release.verify_broker_baseline import MODULES, verify


def verified_old_files(old_archive, old_source, old_manifest):
    """Already attested by the workflow; recheck hash/size and exact seven pins.

    Never infer a reference from candidate source or accept archive path rebasing.
    Static legacy UI bytes share the same manifest-bound archive as the broker.
    """
    if not old_source or not old_manifest:
        raise ValueError('Old archive requires explicit trusted old source and manifest')
    proofs = verify(old_source, old_manifest, old_archive)
    files = {}
    with tarfile.open(old_archive) as archive:
        for entry in archive:
            if entry.name not in MODULES and not entry.name.startswith('updater/ui/dist/'):
                continue
            parts = entry.name.split('/')
            if any(part in ('', '.', '..') for part in parts) or not entry.isfile() or entry.size > 4 * 1024 * 1024:
                raise ValueError('Unsafe old fixture path: ' + entry.name)
            stream = archive.extractfile(entry)
            if stream is None:
                raise ValueError('Missing old fixture bytes')
            files[entry.name] = stream.read()
    if 'updater/ui/dist/index.html' not in files:
        raise ValueError('Missing genuine old UI')
    for name, digest in proofs.items():
        if hashlib.sha256(files[name]).hexdigest() != digest:
            raise ValueError('Old module changed while copying: ' + name)
    return proofs, files


class PresentationSandbox(Sandbox):
    def __init__(self, presentation, ui_origin, old_archive=None, old_source=None, old_manifest=None):
        self.presentation = Path(presentation).resolve()
        self.descriptor = json.loads((self.presentation / 'presentation.json').read_text())
        self.old_archive = old_archive
        self.old_hashes = {}
        old_files = {}
        if old_archive:
            # Validate before starting a sandbox, feed thread or runtime process.
            self.old_hashes, old_files = verified_old_files(old_archive, old_source, old_manifest)
        super().__init__(ui_origin=ui_origin)
        # Give the locally verified baseline the exact Engine release naming shape.
        current = Path(self.config['installRoot']) / 'current'
        baseline = current.resolve()
        manifest = json.loads((self.feed / 'v0.3.0' / 'relay-release.json').read_text())
        canonical = baseline.parent / ('v0.3.0-' + manifest['artifact']['sha256'][:16])
        baseline.rename(canonical)
        current.unlink()
        current.symlink_to(canonical)
        if old_archive:
            # Explicit test-owned copy; never import or modify installed production.
            modules = self.root / 'old-control'
            modules.mkdir(mode=0o700)
            for name, data in old_files.items():
                target = modules / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            self.old_modules = modules

    def release(self, version):
        folder = self.feed / version
        folder.mkdir()
        files = []
        records = []
        source_base = '/updater/presentation/' + self.descriptor['version'] + '/'
        target_base = '/updater/presentation/' + version + '/'
        for entry in self.descriptor['files']:
            data = (self.presentation / entry['path']).read_bytes()
            if len(data) != entry['size'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
                raise RuntimeError('Compiled presentation changed during fixture copy')
            if Path(entry['path']).suffix in ('.html', '.js', '.css'):
                data = data.replace(source_base.encode(), target_base.encode())
            records.append(dict(path=entry['path'], size=len(data), sha256=hashlib.sha256(data).hexdigest()))
            files.append(('updater-presentation/' + entry['path'], data))
        descriptor = dict(schema=1, webApi=1, version=version, files=records)
        files.append(('updater-presentation/presentation.json', json.dumps(descriptor, separators=(',', ':')).encode()))
        files.extend([('package.json', json.dumps(dict(version=version[1:])).encode()), ('service.mjs', SERVICE.encode()), ('payload.bin', secrets.token_bytes(512 * 1024))])
        payload = folder / ARTIFACT
        with tarfile.open(payload, 'w:gz') as archive:
            for name, data in files:
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode = len(data), 0o644
                archive.addfile(entry, io.BytesIO(data))
        manifest = dict(protocol=1, repository='murmuur22/relay', version=version, platform='linux-x64', stateSchema=1, rollbackCompatible=True, minimumNode='26.8.1', artifact=dict(name=ARTIFACT, sha256=hashlib.sha256(payload.read_bytes()).hexdigest(), size=payload.stat().st_size))
        raw = json.dumps(manifest, separators=(',', ':')).encode()
        (folder / 'relay-release.json').write_bytes(raw)
        atomic_json(folder / 'relay-release.attestation.json', dict(kind='FIXTURE-HMAC-NOT-GITHUB', mac=hmac.new(self.fixture_key, raw, hashlib.sha256).hexdigest()))

    def start(self):
        if not self.old_archive:
            return super().start()
        # Sandbox.start already has bounded readiness logic. Substitute only the
        # subprocess launch cwd so its normal -m command loads copied old modules.
        original = subprocess.Popen
        def old_process(args, **kwargs):
            kwargs['cwd'] = self.old_modules
            kwargs['env'] = dict(os.environ, PYTHONPATH=str(self.old_modules))
            # Record actual import origins/hashes in the broker process, not merely
            # a parent's inventory of files it intended the child to import.
            probe = self.root / 'old-imports.json'
            launch = self.root / 'launch-old.py'
            launch.write_text(
                'import hashlib, importlib, json, pathlib, sys\n'
                'proof = {}\n'
                'for name in ' + repr(MODULES) + ':\n'
                ' module = importlib.import_module(name[:-3].replace("/", "."))\n'
                ' path = pathlib.Path(module.__file__).resolve()\n'
                ' expected = pathlib.Path(' + repr(str(self.old_modules)) + ') / name\n'
                ' assert path == expected, (path, expected)\n'
                ' proof[name] = {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}\n'
                'pathlib.Path(' + repr(str(probe)) + ').write_text(json.dumps(proof))\n'
                'from updater.broker.server import main\n'
                'main()\n')
            return original([args[0], str(launch), *args[3:]], **kwargs)
        subprocess.Popen = old_process
        try:
            return super().start()
        finally:
            subprocess.Popen = original


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--presentation', required=True)
    parser.add_argument('--ui-origin', required=True)
    parser.add_argument('--old-archive')
    parser.add_argument('--old-source')
    parser.add_argument('--old-manifest')
    args = parser.parse_args()
    box = PresentationSandbox(args.presentation, args.ui_origin, args.old_archive, args.old_source, args.old_manifest)
    try:
        box.start()
        if box.process is None:
            raise RuntimeError('Broker process did not start')
        imports = json.loads((box.root / 'old-imports.json').read_text()) if args.old_archive else {}
        if {name: entry['sha256'] for name, entry in imports.items()} != box.old_hashes:
            raise RuntimeError('Actual old imports do not match all seven verified pins')
        print(json.dumps(dict(root=str(box.root), config=box.config, brokerPid=box.process.pid, oldBrokerHashes=box.old_hashes, oldBrokerImports=imports, oldUIDir=str(box.old_modules / 'updater/ui/dist') if args.old_archive else None, tier=('genuine old broker compatibility' if args.old_archive else 'current candidate staged broker') + '; compiled source rebased + fixture HMAC, NOT public signature or real release')), flush=True)
        sys.stdin.readline()
    finally:
        box.close()


if __name__ == '__main__':
    main()
