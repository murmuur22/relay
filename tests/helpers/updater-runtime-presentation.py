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


class PresentationSandbox(Sandbox):
    def __init__(self, presentation, ui_origin, old_archive=None):
        self.presentation = Path(presentation).resolve()
        self.descriptor = json.loads((self.presentation / 'presentation.json').read_text())
        self.old_archive = old_archive
        self.old_hashes = {}
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
            with tarfile.open(old_archive) as archive:
                for entry in archive:
                    parts = Path(entry.name).parts
                    try:
                        start = parts.index('updater')
                    except ValueError:
                        continue
                    relative = Path(*parts[start:])
                    if len(relative.parts) != 3 or relative.parts[1] != 'broker' or relative.suffix != '.py':
                        continue
                    if not entry.isfile():
                        raise RuntimeError('Old broker module must be a regular file')
                    stream = archive.extractfile(entry)
                    if stream is None:
                        raise RuntimeError('Missing old broker module bytes')
                    data = stream.read()
                    source = Path(__file__).resolve().parents[2] / relative
                    if data != source.read_bytes():
                        raise RuntimeError('Broker source differs from genuine old archive: ' + str(relative))
                    target = modules / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                    self.old_hashes[str(relative)] = hashlib.sha256(data).hexdigest()
            if len(self.old_hashes) < 7:
                raise RuntimeError('Incomplete genuine old broker module inventory')
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
        def old_process(*args, **kwargs):
            kwargs['cwd'] = self.old_modules
            kwargs['env'] = dict(os.environ, PYTHONPATH=str(self.old_modules))
            return original(*args, **kwargs)
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
    args = parser.parse_args()
    box = PresentationSandbox(args.presentation, args.ui_origin, args.old_archive)
    try:
        box.start()
        if box.process is None:
            raise RuntimeError('Broker process did not start')
        print(json.dumps(dict(root=str(box.root), config=box.config, brokerPid=box.process.pid, oldBrokerHashes=box.old_hashes, tier='compiled source rebased + fixture HMAC, NOT public signature or real release')), flush=True)
        sys.stdin.readline()
    finally:
        box.close()


if __name__ == '__main__':
    main()
