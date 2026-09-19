"""Package a prebuilt standalone runtime, never execute npm/install scripts.

Only the hosted tag workflow creates a GitHub attestation. Local output has none.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import stat
import tarfile

from updater.broker.auth import Denied, atomic_json, VERSION
from updater.broker.releases import ARTIFACT, UPDATER_ARTIFACT, MAX_ARCHIVE, MAX_EXPANDED


CONTROL_FILES = tuple('updater/broker/' + name + '.py' for name in
                      ('auth', 'server', 'releases', 'engine', 'observe', 'enroll', 'driver')) + (
    'updater/web/index.mjs', 'updater/web/server.mjs', 'updater/web/broker-client.mjs',
    'deploy/install-release.py', 'deploy/qualify-systemd.py', 'deploy/relay.service',
    'deploy/verify-standalone.mjs', 'deploy/README.md', 'LICENSE',
    'updater/web/relay-updater-web.service',
    'updater/deploy/relay-updater-broker.service', 'updater/deploy/README.md',
)


def control_bundle(source, output, package):
    selected = [(name, source / name) for name in CONTROL_FILES]
    dist = source / 'updater/ui/dist'
    if not (dist / 'index.html').is_file():
        raise Denied('Missing independently built updater UI')
    for directory, dirs, files in os.walk(dist, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink():
                raise Denied('Control bundle contains link')
        for name in sorted(files):
            path = Path(directory) / name
            if path.suffix not in ('.html', '.js', '.css') and path.relative_to(dist).as_posix() != 'licenses/three.txt':
                raise Denied('Unexpected updater UI asset')
            selected.append((path.relative_to(source).as_posix(), path))
    size = 0
    with tarfile.open(output / UPDATER_ARTIFACT, 'w:gz', compresslevel=6) as archive:
        for name, path in sorted(selected):
            # Check every ancestor as well as the file, including exact-file inputs.
            for part in (path, *path.parents):
                if part == source:
                    break
                if part.is_symlink():
                    raise Denied('Control bundle contains link')
            if not path.is_file():
                raise Denied('Missing control-plane input: ' + name)
            info = path.lstat()
            size += info.st_size
            if not stat.S_ISREG(info.st_mode) or size > MAX_EXPANDED:
                raise Denied('Unsafe control-plane input')
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode = info.st_size, 0o644
            with path.open('rb') as stream:
                archive.addfile(entry, stream)
        metadata = dict(name='relay-updater', version=package['version'], type='module')
        if 'license' in package:
            metadata['license'] = package['license']
        raw = json.dumps(metadata).encode()
        entry = tarfile.TarInfo('package.json')
        entry.size, entry.mode = len(raw), 0o644
        archive.addfile(entry, io.BytesIO(raw))
    path = output / UPDATER_ARTIFACT
    if path.stat().st_size > MAX_ARCHIVE:
        raise Denied('Control bundle too large')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            digest.update(chunk)
    return dict(name=UPDATER_ARTIFACT, sha256=digest.hexdigest(), size=path.stat().st_size)


def build(source, browsers, output, version, allow_nonlinux=False):
    source, browsers, output = Path(source).resolve(), Path(browsers).resolve(), Path(output).resolve()
    if not allow_nonlinux and (platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'AMD64')):
        raise Denied('Linux x64 builder required; local fixture builds are not publishable')
    if not VERSION.fullmatch(version):
        raise Denied('Exact stable tag required')
    package = json.loads((source / 'package.json').read_text())
    if version != 'v' + package['version']:
        raise Denied('Tag must match package version')
    if output == source or source in output.parents or browsers in output.parents:
        raise Denied('Output must be outside input trees')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    for path in ('server/index.mjs', 'dist/index.html', 'version.js', 'node_modules/playwright/package.json', 'updater/web/broker-client.mjs', 'tools/icon-normalize.py'):
        if not (source / path).is_file():
            raise Denied('Missing standalone runtime input')
    if not browsers.is_dir() or not any(browsers.iterdir()):
        raise Denied('Missing matching Playwright browsers')
    selected = []
    for base, prefix in [(source / 'server', 'server'), (source / 'dist', 'dist'), (source / 'node_modules', 'node_modules'), (browsers, 'browsers')]:
        for directory, dirs, files in os.walk(base, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in ('.bin', '.cache', '.git', '.links', 'fonts', 'test', 'tests', '__tests__'))
            for name in dirs + sorted(files):
                path = Path(directory) / name
                info = path.lstat()
                if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                    raise Denied('Release input contains link or special file')
                if stat.S_ISREG(info.st_mode):
                    relative = prefix + '/' + path.relative_to(base).as_posix()
                    selected.append((relative, path))
    selected.extend((name, source / name) for name in ('version.js', 'updater/web/broker-client.mjs', 'tools/icon-normalize.py', 'LICENSE'))
    size = 0
    seen = set()
    with tarfile.open(output / ARTIFACT, 'w:gz', compresslevel=6) as archive:
        for name, path in sorted(selected):
            if name.casefold() in seen:
                raise Denied('Duplicate release path')
            seen.add(name.casefold())
            for part in (path, *path.parents):
                if part in (source, browsers):
                    break
                if part.is_symlink():
                    raise Denied('Release input contains link')
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode):
                raise Denied('Release input must be a regular file')
            size += info.st_size
            if size > MAX_EXPANDED or len(seen) > 100000:
                raise Denied('Release input exceeds limits')
            entry = tarfile.TarInfo(name)
            entry.size = info.st_size
            entry.mode = 0o755 if info.st_mode & 0o111 else 0o644
            with path.open('rb') as stream:
                archive.addfile(entry, stream)
        # Runtime metadata retains dependency identities but never package commands.
        metadata = {k: package[k] for k in ('name', 'version', 'type', 'dependencies', 'license') if k in package}
        raw = json.dumps(metadata, separators=(',', ':')).encode()
        entry = tarfile.TarInfo('package.json')
        entry.size, entry.mode = len(raw), 0o644
        archive.addfile(entry, io.BytesIO(raw))
    artifact = output / ARTIFACT
    if artifact.stat().st_size > MAX_ARCHIVE:
        raise Denied('Compressed release exceeds limit')
    sha = hashlib.sha256()
    with artifact.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            sha.update(chunk)
    manifest = dict(protocol=1, repository='murmuur22/relay', version=version, platform='linux-x64', stateSchema=1, rollbackCompatible=True, minimumNode='26.8.1', artifact=dict(name=ARTIFACT, sha256=sha.hexdigest(), size=artifact.stat().st_size))
    manifest['updaterArtifact'] = control_bundle(source, output, package)
    atomic_json(output / 'relay-release.json', manifest)
    if allow_nonlinux:
        (output / 'LOCAL-UNQUALIFIED-NOT-FOR-PUBLICATION').write_text('Local packaging exercise only. No GitHub attestation.\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--browsers', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--local-unqualified', action='store_true')
    args = parser.parse_args()
    result = build(args.source, args.browsers, args.output, args.version, args.local_unqualified)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
