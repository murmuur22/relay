"""Compare seven source broker modules to an ALREADY attestation-verified archive.

Read-only source gate; this script does not verify GitHub signatures itself.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile

MODULES = tuple('updater/broker/' + n + '.py' for n in
                ('auth', 'driver', 'engine', 'enroll', 'observe', 'releases', 'server'))


def verify(source, manifest_path, archive_path):
    source, archive_path = Path(source), Path(archive_path)
    descriptor = json.loads(Path(manifest_path).read_bytes())['updaterArtifact']
    if descriptor['name'] != 'relay-updater-linux-x64.tar.gz' or archive_path.stat().st_size != descriptor['size']:
        raise ValueError('Baseline artifact name/size mismatch')
    digest = hashlib.sha256()
    with archive_path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            digest.update(chunk)
    if digest.hexdigest() != descriptor['sha256']:
        raise ValueError('Baseline archive hash mismatch')
    proofs = {}
    with tarfile.open(archive_path) as archive:
        seen = set()
        for entry in archive:
            if entry.name in seen:
                raise ValueError('Duplicate archive path')
            seen.add(entry.name)
            if entry.name not in MODULES:
                continue
            if not entry.isfile() or entry.size > 1024 * 1024:
                raise ValueError('Unsafe broker source entry')
            raw = archive.extractfile(entry).read()
            if raw != (source / entry.name).read_bytes():
                raise ValueError('Broker source differs from baseline: ' + entry.name)
            proofs[entry.name] = hashlib.sha256(raw).hexdigest()
    if set(proofs) != set(MODULES):
        raise ValueError('Incomplete baseline broker inventory')
    return proofs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--archive', required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.source, args.manifest, args.archive), sort_keys=True))


if __name__ == '__main__':
    main()
