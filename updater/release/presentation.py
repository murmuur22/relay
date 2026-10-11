"""Bounded inert runtime-presentation descriptor; never extends engine manifests."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time

MAX_FILES = 64
MAX_BYTES = 4 * 1024 * 1024
MAX_DESCRIPTOR = 16384
# Reader candidate limit includes both these independently bounded metadata files.
MAX_ASSET_BYTES = MAX_BYTES - 2 * MAX_DESCRIPTOR
VERSION = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
NOTICES = {'licenses/three.txt', 'licenses/silkscreen-OFL.txt',
           'licenses/sharetechmono-OFL.txt', 'licenses/updater-font-sources.json'}


def allowed(name):
    return (name == 'index.html' or name in NOTICES or
            re.fullmatch(r'assets/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(js|css)', name) is not None or
            re.fullmatch(r'assets/(silkscreen-bold|share-tech-mono)-[A-Za-z0-9_-]+\.woff2', name) is not None)


def inventory(dist, version):
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError('Exact stable-form presentation version required')
    dist = Path(dist).absolute()
    # Source is a private build input, not an installed-root admission substitute.
    for part in (dist, *dist.parents):
        if part.is_symlink():
            raise ValueError('Presentation ancestor link')
    if not dist.is_dir():
        raise ValueError('Missing built runtime presentation')
    files = []
    total = entries = 0
    deadline = time.monotonic() + 5
    for directory, dirs, names in os.walk(dist, followlinks=False):
        for name in sorted(dirs + names):
            entries += 1
            if entries > MAX_FILES + 3 or time.monotonic() > deadline:
                raise ValueError('Presentation entry/time bounds')
            path = Path(directory) / name
            info = path.lstat()
            rel = path.relative_to(dist).as_posix()
            if stat.S_ISDIR(info.st_mode):
                if rel not in ('assets', 'licenses'):
                    raise ValueError('Unexpected presentation directory')
                continue
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError('Presentation links or special files')
            if rel == 'presentation.json':
                if info.st_size > MAX_DESCRIPTOR:
                    raise ValueError('Presentation descriptor bounds')
                continue
            if not allowed(rel) or len(files) >= MAX_FILES or info.st_size > MAX_BYTES:
                raise ValueError('Unexpected or oversized presentation asset')
            total += info.st_size
            if total > MAX_ASSET_BYTES:
                raise ValueError('Presentation byte bounds')
            with path.open('rb') as stream:
                raw = stream.read(info.st_size + 1)
            if len(raw) != info.st_size:
                raise ValueError('Presentation changed while reading')
            files.append(dict(path=rel, size=len(raw), sha256=hashlib.sha256(raw).hexdigest()))
    files.sort(key=lambda f: f['path'])
    if not any(f['path'] == 'index.html' for f in files):
        raise ValueError('Missing presentation index')
    index = (dist / 'index.html').read_text()
    prefix = '/updater/presentation/' + version + '/'
    references = re.findall(r'(?:src|href)=[\"\']([^\"\']+)[\"\']', index)
    paths = {f['path'] for f in files}
    if not references or any(not r.startswith(prefix) or r[len(prefix):] not in paths for r in references):
        raise ValueError('Presentation index must pin exact-version packaged assets')
    return dict(schema=1, webApi=1, version=version, files=files)


def describe(dist, version):
    descriptor = inventory(dist, version)
    raw = json.dumps(descriptor, separators=(',', ':')) + '\n'
    if len(raw.encode()) > MAX_DESCRIPTOR:
        raise ValueError('Presentation descriptor bounds')
    (Path(dist) / 'presentation.json').write_text(raw)
    return descriptor


def validate(dist, version):
    expected = inventory(dist, version)
    raw = (Path(dist) / 'presentation.json').read_bytes()
    if len(raw) > MAX_DESCRIPTOR:
        raise ValueError('Presentation descriptor bounds')
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError('Duplicate descriptor key')
            value[key] = item
        return value
    descriptor = json.loads(raw, object_pairs_hook=unique)
    if (not isinstance(descriptor, dict) or set(descriptor) != set(expected) or
            type(descriptor.get('schema')) is not int or descriptor['schema'] != 1 or
            type(descriptor.get('webApi')) is not int or descriptor['webApi'] != 1 or
            not isinstance(descriptor.get('files'), list)):
        raise ValueError('Incompatible presentation descriptor')
    for entry in descriptor['files']:
        if (not isinstance(entry, dict) or set(entry) != {'path', 'size', 'sha256'} or
                type(entry.get('size')) is not int or not isinstance(entry.get('sha256'), str) or
                not re.fullmatch(r'[0-9a-f]{64}', entry['sha256'])):
            raise ValueError('Invalid presentation asset descriptor')
    if descriptor != expected:
        raise ValueError('Presentation descriptor/path set/bytes mismatch')
    return descriptor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    describe(args.dist, args.version)


if __name__ == '__main__':
    main()
