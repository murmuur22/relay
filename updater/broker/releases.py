"""Fixed GitHub release transport and strict archive verification; stdlib only."""
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

from .auth import VERSION, Denied, fsync_dir

REPO = 'murmuur22/relay'
ARTIFACT = 'relay-linux-x64.tar.gz'
MAX_ARCHIVE = 1024 * 1024 * 1024
MAX_EXPANDED = 3 * MAX_ARCHIVE
SAFE_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent', 'GH_CONFIG_DIR': '/nonexistent', 'GH_PROMPT_DISABLED': '1'}


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != 'https' or parsed.hostname not in ('github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com') or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise Denied('Release redirect rejected')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def transfer(url, destination=None, limit=1024 * 1024, progress=None, cancelled=None, fixture=False, deadline=None):
    # No proxy credentials, ambient developer tokens, cookies or arbitrary HTTP input.
    parsed = urllib.parse.urlsplit(url)
    if fixture:
        if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.username or parsed.password:
            raise Denied('Invalid fixture transport')
    elif parsed.scheme != 'https' or parsed.hostname not in ('api.github.com', 'github.com'):
        raise Denied('Invalid release transport')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise Denied('Fixture redirect rejected')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect() if fixture else Redirects())
    start = time.monotonic()
    deadline = min(deadline, start + 120) if deadline is not None else start + 120
    if deadline <= start:
        raise Denied('Release check deadline exceeded')
    data, total = bytearray(), 0
    stream = open(destination, 'xb') if destination else None
    try:
        with opener.open(urllib.request.Request(url, headers={'User-Agent': 'Relay-updater/1', 'Accept': 'application/json'}), timeout=min(5, max(0.1, deadline - start))) as response:
            length = response.headers.get('Content-Length')
            if length and (not length.isdigit() or int(length) > limit):
                raise Denied('Release exceeds byte limit')
            while True:
                if time.monotonic() > deadline or (cancelled and cancelled()):
                    raise Denied('Transfer interrupted')
                chunk = response.read1(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise Denied('Release exceeds byte limit')
                if stream:
                    stream.write(chunk)
                else:
                    data.extend(chunk)
                if progress:
                    progress(total)
        if stream:
            stream.flush()
            os.fsync(stream.fileno())
        return bytes(data)
    finally:
        if stream:
            stream.close()


def manifest_valid(value, version):
    if not isinstance(value, dict) or value.get('protocol') != 1 or value.get('repository') != REPO or value.get('version') != version or not VERSION.fullmatch(version):
        raise Denied('Invalid release manifest')
    if value.get('platform') != 'linux-x64' or value.get('stateSchema') != 1 or value.get('rollbackCompatible') is not True or value.get('minimumNode') != '26.8.1':
        raise Denied('Unsupported release requirements')
    artifact_valid(value.get('artifact'), ARTIFACT)
    if 'updaterArtifact' in value:
        artifact_valid(value['updaterArtifact'], UPDATER_ARTIFACT)
    return value


UPDATER_ARTIFACT = 'relay-updater-linux-x64.tar.gz'


def artifact_valid(artifact, name):
    import re
    if not isinstance(artifact, dict) or artifact.get('name') != name or not isinstance(artifact.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', artifact['sha256']) or type(artifact.get('size')) is not int or not 0 < artifact['size'] <= MAX_ARCHIVE:
        raise Denied('Invalid artifact manifest')
    return artifact


def verify_artifact(path, artifact, *, updater=False):
    """Check bytes against an ALREADY attestation-verified manifest descriptor.

    This is not signature verification. Initial installers must first call
    Releases.verified_manifest; ordinary runtime updates never install this bundle.
    """
    artifact_valid(artifact, UPDATER_ARTIFACT if updater else ARTIFACT)
    digest, size = hashlib.sha256(), 0
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size != artifact['size']:
            raise Denied('Artifact size/type mismatch')
        for chunk in iter(lambda: stream.read(65536), b''):
            size += len(chunk)
            if size > artifact['size']:
                raise Denied('Artifact size mismatch')
            digest.update(chunk)
    if size != artifact['size'] or not hmac.compare_digest(digest.hexdigest(), artifact['sha256']):
        raise Denied('Artifact digest mismatch')
    return True


def extract(archive, destination):
    destination = Path(destination)
    destination.mkdir(mode=0o700)
    seen, expanded, count = set(), 0, 0
    spellings = {}
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            count += 1
            name = member.name
            parts = PurePosixPath(name).parts
            if not parts or name.startswith('/') or '\\' in name or any(p in ('..', '.') for p in name.split('/')) or any(ord(c) < 32 for c in name):
                raise Denied('Unsafe archive path')
            if name.casefold() in seen or count > 100000 or member.mode & 0o7000 or not (member.isfile() or member.isdir()):
                raise Denied('Unsafe archive entry')
            # Case-colliding parent directories are also forbidden.
            for index in range(1, len(parts) + 1):
                prefix = '/'.join(parts[:index])
                folded = prefix.casefold()
                if folded in spellings and spellings[folded] != prefix:
                    raise Denied('Case-colliding archive paths')
                spellings[folded] = prefix
            seen.add(name.casefold())
            expanded += member.size
            if member.size < 0 or expanded > MAX_EXPANDED:
                raise Denied('Expanded archive too large')
            target = destination.joinpath(*parts)
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(mode=0o755, exist_ok=True)
            else:
                with source.extractfile(member) as src, target.open('xb') as dst:
                    shutil.copyfileobj(src, dst, 65536)
                    dst.flush()
                    os.fsync(dst.fileno())
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    for base, _dirs, _files in os.walk(destination, topdown=False):
        if Path(base) != destination:
            os.chmod(base, 0o755)
        fsync_dir(base)


class Releases:
    def __init__(self, config):
        self.config = config
        self.fixture = config['mode'] == 'fixture'
        self.entries = {}

    def base(self, version):
        if not VERSION.fullmatch(version):
            raise Denied('Invalid version')
        if self.fixture:
            return self.config['fixtureFeed'] + '/' + version
        return f'https://github.com/{REPO}/releases/download/{version}'

    def verified_manifest(self, version, directory, deadline=None):
        directory = Path(directory)
        raw = transfer(self.base(version) + '/relay-release.json', fixture=self.fixture, deadline=deadline)
        bundle = transfer(self.base(version) + '/relay-release.attestation.json', limit=4 * 1024 * 1024, fixture=self.fixture, deadline=deadline)
        mp, bp = directory / 'relay-release.json', directory / 'relay-release.attestation.json'
        mp.write_bytes(raw)
        bp.write_bytes(bundle)
        if self.fixture:
            key = Path(self.config['fixtureKeyFile']).read_bytes()
            expected = hmac.new(key, raw, hashlib.sha256).hexdigest()
            proof = json.loads(bundle)
            if proof.get('kind') != 'FIXTURE-HMAC-NOT-GITHUB' or not hmac.compare_digest(proof.get('mac', ''), expected):
                raise Denied('Fixture signature rejected')
        else:
            gh = self.config.get('gh', '/usr/bin/gh')
            try:
                timeout = min(30, max(0.1, deadline - time.monotonic())) if deadline is not None else 30
                # Sigstore initializes a trust-root cache even with --bundle.
                # Supply a fresh private HOME, never the operator's gh credentials.
                import tempfile
                with tempfile.TemporaryDirectory(prefix='gh-anonymous-', dir=directory) as home:
                    env = dict(SAFE_ENV, HOME=home)
                    subprocess.run([gh, 'attestation', 'verify', str(mp), '--bundle', str(bp), '--repo', REPO, '--signer-workflow', REPO + '/.github/workflows/release.yml', '--source-ref', 'refs/tags/' + version, '--deny-self-hosted-runners'], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout, check=True)
            except (OSError, subprocess.SubprocessError):
                raise Denied('GitHub attestation verification unavailable or failed')
        return manifest_valid(json.loads(raw), version)

    def check(self, work):
        import tempfile
        deadline = time.monotonic() + 8
        url = self.config['fixtureFeed'] + '/index.json' if self.fixture else f'https://api.github.com/repos/{REPO}/releases?per_page=20'
        releases = json.loads(transfer(url, limit=2 * 1024 * 1024, fixture=self.fixture, deadline=deadline))
        if not isinstance(releases, list):
            raise Denied('Invalid release index')
        entries = {}
        for release in releases[:5]:
            version = release.get('tag_name')
            if release.get('draft') or release.get('prerelease') or not isinstance(version, str) or not VERSION.fullmatch(version):
                continue
            with tempfile.TemporaryDirectory(dir=work) as tmp:
                manifest = self.verified_manifest(version, tmp, deadline=deadline)
            entries[version] = dict(version=version, notes=str(release.get('body') or '')[:8000], size=manifest['artifact']['size'], verified=True)
        self.entries = entries
        return list(entries.values())
