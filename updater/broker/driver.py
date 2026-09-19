"""Only two service drivers: fixed Linux relay.service, owned disposable Node fixture."""
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit

from .auth import Denied, fsync_dir
from .releases import SAFE_ENV


def private_path(path, owner=None, directory=False):
    path = Path(path)
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or (directory and not stat.S_ISDIR(info.st_mode)) or (not directory and not stat.S_ISREG(info.st_mode)) or info.st_uid != (os.getuid() if owner is None else owner) or info.st_mode & 0o022:
        raise Denied('Untrusted control path')
    return path


def validate_config(config):
    config = dict(config)
    mode = config.get('mode')
    if mode not in ('fixture', 'observe', 'production'):
        raise Denied('Explicit mode required')
    origin = urlsplit(config.get('uiOrigin', ''))
    if origin.scheme != 'http' or origin.hostname not in ('localhost', '127.0.0.1') or origin.username or origin.password or origin.path or origin.query or origin.fragment or not origin.port:
        raise Denied('Explicit loopback UI origin required')
    if mode == 'production':
        if sys.platform != 'linux' or os.geteuid() != 0:
            raise Denied('Production requires Linux privileged service')
        fixed = dict(installRoot='/opt/relay', stateRoot='/var/lib/relay', controlRoot='/var/lib/relay-updater', maintenance='/var/lib/relay-updater-control/maintenance', socketPath='/run/relay-updater-control/broker.sock', bridgeKeyFile='/etc/relay-updater/bridge.key')
        for key, value in fixed.items():
            if config.get(key, value) != value:
                raise Denied('Production path is fixed')
            config[key] = value
        for key in ('controlRoot', 'installRoot'):
            private_path(config[key], owner=0, directory=True)
        private_path(Path(config['maintenance']).parent, owner=0, directory=True)
        private_path(Path(config['socketPath']).parent, owner=0, directory=True)
        if Path(config['maintenance']).parent.stat().st_mode & 0o005 != 0o005:
            raise Denied('Maintenance control directory must be readable/traversable')
        private_path(config['bridgeKeyFile'], owner=0)
        if Path(config['bridgeKeyFile']).stat().st_mode & 0o007:
            raise Denied('Bridge key must not be world-readable')
        for key in ('node', 'python', 'gh'):
            path = Path(config.get(key, {'node':'/usr/bin/node', 'python':'/usr/bin/python3', 'gh':'/usr/bin/gh'}[key]))
            if not path.is_absolute():
                raise Denied('Absolute prerequisite path required')
            private_path(path.resolve(), owner=0)
            config[key] = str(path)
        if type(config.get('relayUid')) is not int or config['relayUid'] <= 0 or type(config.get('socketGid')) is not int:
            raise Denied('Explicit Relay UID/socket GID required')
        config.setdefault('readinessUrl', 'http://localhost:4190/health/ready')
        ready = urlsplit(config['readinessUrl'])
        if ready.scheme != 'http' or ready.hostname != origin.hostname or ready.username or ready.password or ready.path != '/health/ready' or ready.query or ready.fragment or not ready.port or ready.port == origin.port:
            raise Denied('Readiness must use the fixed Relay loopback host and a distinct port')
    else:
        if os.geteuid() == 0:
            raise Denied('Nonproduction modes refuse root')
        root = Path(config.get('fixtureRoot' if mode == 'fixture' else 'observeRoot', '')).resolve()
        private_path(root, directory=True)
        if root.stat().st_mode & 0o077:
            raise Denied('Sandbox root must be private')
        if mode == 'fixture':
            temp = Path(tempfile.gettempdir()).resolve()
            if temp not in root.parents or (root / '.relay-updater-fixture').read_text() != 'DISPOSABLE FIXTURE ONLY\n':
                raise Denied('Fixture requires marked temporary root')
        for key in ('controlRoot', 'socketPath', 'bridgeKeyFile') + (('installRoot', 'stateRoot', 'maintenance', 'fixtureKeyFile') if mode == 'fixture' else ()):
            path = Path(config[key])
            if not path.is_absolute() or root not in path.resolve().parents:
                raise Denied('Path escapes sandbox')
            current = path
            while current != root:
                if current.is_symlink():
                    raise Denied('Sandbox control symlink rejected')
                current = current.parent
        if mode == 'fixture':
            url = urlsplit(config.get('fixtureFeed', ''))
            if url.scheme != 'http' or url.hostname != '127.0.0.1' or not url.port or url.username or url.password or url.path or url.query or url.fragment:
                raise Denied('Invalid fixture feed')
            if type(config.get('fixturePort')) is not int or not 1024 <= config['fixturePort'] <= 65535:
                raise Denied('Invalid fixture port')
            config['node'] = shutil.which('node')
            config['readinessUrl'] = f"http://127.0.0.1:{config['fixturePort']}/health/ready"
    return config


def copy_state(source, target, preserve_owner=False):
    """Descriptor-relative copy: never follow replaced ancestors, links or special files."""
    source, target = Path(source), Path(target)
    size, count = 0, 0
    deadline = time.monotonic() + 120
    def walk(fd, dst, depth=0):
        nonlocal size, count
        if depth > 64 or time.monotonic() > deadline:
            raise Denied('State backup bounds exceeded')
        original = os.fstat(fd)
        dst.mkdir(mode=0o700)
        if preserve_owner:
            os.chown(dst, original.st_uid, original.st_gid)
        for name in os.listdir(fd):
            count += 1
            if count > 100000 or time.monotonic() > deadline:
                raise Denied('State backup bounds exceeded')
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            out = dst / name
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    walk(child, out, depth + 1)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                with os.fdopen(child, 'rb') as src:
                    opened = os.fstat(src.fileno())
                    if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1:
                        raise Denied('State changed during backup')
                    with out.open('xb') as dest:
                        while True:
                            chunk = src.read(65536)
                            if not chunk:
                                break
                            size += len(chunk)
                            if size > 4 * 1024**3 or time.monotonic() > deadline:
                                raise Denied('State backup bounds exceeded')
                            dest.write(chunk)
                        dest.flush()
                        os.fsync(dest.fileno())
                out.chmod(0o600)
                if preserve_owner:
                    os.chown(out, opened.st_uid, opened.st_gid)
            else:
                raise Denied('State backup rejects links and special files')
        fsync_dir(dst)
    try:
        fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            walk(fd, target)
        finally:
            os.close(fd)
    except OSError:
        raise Denied('Unsafe or unreadable state backup')
    fsync_dir(target.parent)


def restore_state(source, target, preserve_owner=False, *, max_bytes=4 * 1024**3,
                  max_files=100000, max_depth=64, timeout=120):
    """Restore contents, never the mounted root. Caller must stop Relay and gate it.

    The protected backup is not moved or consumed. A failed/partial restore is
    retryable from that same backup. All traversal and mutation below the opened
    roots is descriptor-relative and no-follow; directory metadata at target is
    deliberately left unchanged. Bounds cover validation, deletion and copying.
    """
    deadline = time.monotonic() + timeout
    count = size = 0
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

    def bound(depth, byte_count=0, entry=False):
        nonlocal count, size
        count += int(entry)
        size += byte_count
        if depth > max_depth or count > max_files or size > max_bytes or time.monotonic() > deadline:
            raise Denied('State restore bounds exceeded')

    def directory(name, parent, info):
        fd = os.open(name, flags, dir_fd=parent)
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            os.close(fd)
            raise Denied('State directory changed during restore')
        return fd

    def copy(src, dst=None, depth=0):
        bound(depth)
        with os.scandir(src) as entries:
            for entry in entries:
                bound(depth, entry=True)
                name = entry.name
                info = os.stat(name, dir_fd=src, follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    child = directory(name, src, info)
                    out = None
                    try:
                        if dst is not None:
                            os.mkdir(name, 0o700, dir_fd=dst)
                            out = os.open(name, flags, dir_fd=dst)
                            if preserve_owner:
                                os.fchown(out, info.st_uid, info.st_gid)
                        copy(child, out, depth + 1)
                    finally:
                        os.close(child)
                        if out is not None:
                            try:
                                os.fsync(out)
                            finally:
                                os.close(out)
                elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=src)
                    with os.fdopen(child, 'rb') as stream:
                        opened = os.fstat(child)
                        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                            raise Denied('State file changed during restore')
                        if dst is None:
                            bound(depth, opened.st_size)
                            continue
                        out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dst)
                        with os.fdopen(out, 'wb') as dest:
                            if preserve_owner:
                                os.fchown(out, opened.st_uid, opened.st_gid)
                            while True:
                                chunk = stream.read(65536)
                                bound(depth, len(chunk))
                                if not chunk:
                                    break
                                dest.write(chunk)
                            dest.flush()
                            os.fsync(out)
                else:
                    raise Denied('State restore rejects backup links and special files')

    def clear(fd, depth=0):
        bound(depth)
        try:
            with os.scandir(fd) as entries:
                for entry in entries:
                    bound(depth, entry=True)
                    info = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        child = directory(entry.name, fd, info)
                        try:
                            clear(child, depth + 1)
                        finally:
                            os.close(child)
                        os.rmdir(entry.name, dir_fd=fd)
                    else:
                        # Includes malicious symlinks/hardlinks/FIFOs: unlink only.
                        os.unlink(entry.name, dir_fd=fd)
        finally:
            os.fsync(fd)

    src = dst = None
    try:
        src = os.open(source, flags)
        dst = os.open(target, flags)
        if (os.fstat(src).st_dev, os.fstat(src).st_ino) == (os.fstat(dst).st_dev, os.fstat(dst).st_ino):
            raise Denied('Backup and state must be distinct')
        # Reject invalid backups before removing any state. Reset per-pass byte/
        # entry budgets, but share one deadline across the complete operation.
        copy(src)
        count = size = 0
        clear(dst)
        count = size = 0
        copy(src, dst)
    except OSError as error:
        raise Denied('Unsafe or unreadable state restore') from error
    finally:
        if src is not None:
            os.close(src)
        if dst is not None:
            try:
                os.fsync(dst)
            finally:
                os.close(dst)


class Driver:
    def __init__(self, config):
        self.config = config
        self.process = None

    def command(self, args, timeout=20):
        try:
            subprocess.run(args, env=SAFE_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=timeout)
        except (OSError, subprocess.SubprocessError):
            raise Denied('Service command failed')

    def stop(self):
        if self.config['mode'] == 'production':
            self.command(['/usr/bin/systemctl', 'stop', 'relay.service'])
        elif self.config['mode'] == 'fixture':
            if self.process:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
                self.process = None
        else:
            raise Denied('Observe mode cannot stop services')

    def start(self):
        if self.config['mode'] == 'production':
            self.command(['/usr/bin/systemctl', 'start', 'relay.service'])
        elif self.config['mode'] == 'fixture':
            if self.process is not None:
                raise Denied('Fixture service already owned')
            current = Path(self.config['installRoot']) / 'current'
            env = {'PATH': '/usr/bin:/bin', 'PORT': str(self.config['fixturePort']), 'STATE': self.config['stateRoot'], 'MAINTENANCE': self.config['maintenance']}
            self.process = subprocess.Popen([self.config['node'], str(current / 'service.mjs')], cwd=current, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            raise Denied('Observe mode cannot start services')

    def preflight(self, release, version):
        package = json.loads((release / 'package.json').read_text())
        if 'v' + package['version'] != version:
            raise Denied('Payload version mismatch')
        if self.config['mode'] == 'fixture':
            if not (release / 'service.mjs').is_file():
                raise Denied('Missing fixture service')
        else:
            for name in ('server/index.mjs', 'dist/index.html', 'node_modules/playwright/package.json', 'browsers', 'tools/icon-normalize.py', 'updater/web/broker-client.mjs'):
                if not (release / name).exists():
                    raise Denied('Incomplete standalone payload')
            self.command([self.config['node'], '-e', "const v=process.versions.node.split('.').map(Number);if(v[0]<26||(v[0]===26&&(v[1]<8||(v[1]===8&&v[2]<1))))process.exit(1)"])
            self.command([self.config['python'], '-c', 'from PIL import Image'])

    def ready(self, version, timeout=10):
        deadline = time.monotonic() + timeout
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                raise Denied('Readiness redirects are forbidden')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        while time.monotonic() < deadline:
            try:
                with opener.open(self.config['readinessUrl'], timeout=1) as response:
                    value = json.loads(response.read(4097))
                    if value.get('status') == 'ready' and value.get('version') == version.removeprefix('v') and value.get('maintenance') == Path(self.config['maintenance']).exists():
                        return value
            except (OSError, ValueError):
                pass
            time.sleep(0.1)
        raise Denied('Expected-version readiness failed')
