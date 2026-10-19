"""Durable Relay-only update state machine. Incomplete activation stays gated."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import stat
import tempfile
import threading
import time

from .auth import Authority, Denied, atomic_json, fsync_dir
from .driver import Driver, copy_state, restore_state, validate_config, private_path
from .releases import Releases, ARTIFACT, MAX_EXPANDED, extract, transfer


def metadata_identity(info):
    # Reads can update atime. Security identity includes nanosecond write/change
    # times, but never treats an access-time update as payload mutation.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def stage_fingerprint(path, owner, *, max_entries=100001, max_bytes=MAX_EXPANDED + 4096, max_depth=64, timeout=120, dir_fd=None):
    """Bounded descriptor-relative inventory; no links, writable or foreign files.

    The root is a broker-private wrapper under protected releases. This digest
    detects later drift; it is NOT a replacement for artifact attestation.
    """
    deadline = time.monotonic() + timeout
    count = size = 0
    digest = hashlib.sha256()
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK

    def bound(depth):
        if count > max_entries or size > max_bytes or depth > max_depth or time.monotonic() > deadline:
            raise Denied('Prepared payload inventory bounds exceeded')

    def record(name, info, kind, sha=None):
        digest.update(json.dumps([name, kind, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid, info.st_size if kind == 'file' else None, sha], separators=(',', ':'), ensure_ascii=True).encode() + b'\n')

    def walk(fd, relative='', depth=0):
        nonlocal count, size
        bound(depth)
        directory_info = os.fstat(fd)
        if not stat.S_ISDIR(directory_info.st_mode) or directory_info.st_uid != owner or directory_info.st_mode & 0o7022:
            raise Denied('Prepared payload directory is untrusted')
        record(relative, directory_info, 'directory')
        names = []
        with os.scandir(fd) as entries:
            for entry in entries:
                count += 1
                bound(depth)
                names.append(entry.name)
        for name in sorted(names):
            bound(depth)
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            relative_name = relative + '/' + name
            directory = stat.S_ISDIR(info.st_mode)
            if info.st_uid != owner or info.st_mode & 0o7022 or not (directory or stat.S_ISREG(info.st_mode)) or (not directory and info.st_nlink != 1):
                raise Denied('Prepared payload entry is untrusted')
            child = os.open(name, flags | (os.O_DIRECTORY if directory else 0), dir_fd=fd)
            try:
                opened = os.fstat(child)
                if (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_uid, opened.st_gid, opened.st_nlink) != (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_nlink):
                    raise Denied('Prepared payload changed during inventory')
                if directory:
                    walk(child, relative_name, depth + 1)
                else:
                    sha = hashlib.sha256()
                    while True:
                        chunk = os.read(child, 65536)
                        size += len(chunk)
                        bound(depth)
                        if not chunk:
                            break
                        sha.update(chunk)
                    record(relative_name, opened, 'file', sha.hexdigest())
                after = os.fstat(child)
                if (after.st_mtime_ns, after.st_ctime_ns, after.st_size) != (opened.st_mtime_ns, opened.st_ctime_ns, opened.st_size):
                    raise Denied('Prepared payload changed during inventory')
            finally:
                os.close(child)
        after = os.fstat(fd)
        if (after.st_mtime_ns, after.st_ctime_ns) != (directory_info.st_mtime_ns, directory_info.st_ctime_ns):
            raise Denied('Prepared payload directory changed during inventory')

    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    named = os.stat(path, dir_fd=dir_fd, follow_symlinks=False)
    fd = os.open(path, flags | os.O_DIRECTORY, dir_fd=dir_fd)
    try:
        initial = os.fstat(fd)
        if identity(initial) != identity(named) or stat.S_IMODE(initial.st_mode) != 0o700:
            raise Denied('Prepared payload wrapper must be private and unchanged')
        walk(fd)
        if identity(os.fstat(fd)) != identity(initial) or identity(os.stat(path, dir_fd=dir_fd, follow_symlinks=False)) != identity(initial):
            raise Denied('Prepared payload wrapper changed during inventory')
    finally:
        os.close(fd)
    return dict(sha256=digest.hexdigest(), entries=count, bytes=size)


@contextlib.contextmanager
def managed_releases(install, owner):
    """Pin protected install/releases; refuse substituted parents before access."""
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_DIRECTORY
    with contextlib.ExitStack() as descriptors:
        pinned = []
        for name, parent in ((install, None), ('releases', 'root')):
            parent = pinned[0][2] if parent == 'root' else None
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
            fd = os.open(name, flags, dir_fd=parent)
            descriptors.callback(os.close, fd)
            actual = os.fstat(fd)
            if metadata_identity(actual) != metadata_identity(info) or not stat.S_ISDIR(actual.st_mode) or actual.st_uid != owner or actual.st_mode & 0o7022:
                raise Denied('Managed releases parent is untrusted or changed')
            pinned.append((name, parent, fd, actual))
        yield pinned[0][2], pinned[1][2]
        for name, parent, fd, info in reversed(pinned):
            if metadata_identity(os.fstat(fd)) != metadata_identity(info) or metadata_identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) != metadata_identity(info):
                raise Denied('Managed releases parent changed during acquisition')


def rollback_receipt(install, name, owner, mode, version):
    """Acquire bounded rollback metadata without the inherited pathname reader."""
    import re
    from .releases import VERSION
    if not isinstance(name, str) or not name or Path(name).name != name or name in ('.', '..'):
        raise Denied('Invalid rollback release identity')
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with managed_releases(install, owner) as (_root, releases), contextlib.ExitStack() as descriptors:
        pinned = []
        parent = releases
        for child, directory in ((name, True), ('.relay-verified.json', False)):
            info = os.stat(child, dir_fd=parent, follow_symlinks=False)
            fd = os.open(child, flags | (os.O_DIRECTORY if directory else 0), dir_fd=parent)
            descriptors.callback(os.close, fd)
            actual = os.fstat(fd)
            if metadata_identity(actual) != metadata_identity(info) or actual.st_uid != owner or actual.st_mode & 0o7022:
                raise Denied('Rollback metadata is untrusted or changed')
            if directory:
                if not stat.S_ISDIR(actual.st_mode):
                    raise Denied('Rollback release is not a directory')
            elif not stat.S_ISREG(actual.st_mode) or actual.st_nlink != 1 or not 0 < actual.st_size <= 4096:
                raise Denied('Rollback receipt exceeds bounds or is untrusted')
            pinned.append((child, parent, fd, actual))
            parent = fd
        raw = os.read(fd, 4097)
        if len(raw) != actual.st_size or not 0 < len(raw) <= 4096:
            raise Denied('Rollback receipt changed during read')
        for child, parent, descriptor, info in reversed(pinned):
            if metadata_identity(os.fstat(descriptor)) != metadata_identity(info) or metadata_identity(os.stat(child, dir_fd=parent, follow_symlinks=False)) != metadata_identity(info):
                raise Denied('Rollback metadata changed during acquisition')
    try:
        value = json.loads(raw)
        if not isinstance(value, dict) or value.get('mode') != mode or value.get('version') != version or not isinstance(version, str) or not VERSION.fullmatch(version) or not isinstance(value.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', value['sha256']):
            raise Denied('Rollback receipt mismatch')
    except (ValueError, TypeError, RecursionError) as error:
        raise Denied('Rollback receipt is invalid') from error
    return hashlib.sha256(raw).hexdigest()


TERMINAL = {'succeeded', 'failed', 'rolled-back', 'rollback-failed', 'cancelled', 'interrupted'}
PRE = {'downloading', 'verifying', 'staging'}


class Engine:
    def __init__(self, config):
        self.config = validate_config(config)
        self.mode = self.config['mode']
        self.root = Path(self.config['controlRoot'])
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.lockfile = (self.root / 'broker.lock').open('a+')
        try:
            fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lockfile.close()
            raise Denied('Broker already running')
        self.lock = threading.RLock()
        self.checklock = threading.Lock()
        self.work = self.root / 'work'
        self.work.mkdir(mode=0o700, exist_ok=True)
        self.journal = self.root / 'journal.json'
        self.data = json.loads(self.journal.read_text()) if self.journal.exists() else dict(currentVersion=None, job=None, history=[], previous=None, checkpoint=None)
        self.authority = Authority(self.root / 'authority.json', Path(self.config['bridgeKeyFile']).read_bytes(), self.config['uiOrigin'])
        self.releases = Releases(self.config)
        self.driver = Driver(self.config)
        self.thread = None
        self.cancelled = threading.Event()
        self.available = []
        self.last_check = float('-inf')
        self.reason = 'Observe mode is read-only' if self.mode == 'observe' else None
        if self.mode == 'observe':
            package = json.loads(Path(self.config['currentPackage']).read_text())
            self.data['currentVersion'] = 'v' + package['version']
        else:
            self.install = Path(self.config['installRoot'])
            self.state = Path(self.config['stateRoot'])
            self.maintenance = Path(self.config['maintenance'])
            self.current = self.install / 'current'
            release_root = self.install / 'releases'
            release_root.mkdir(mode=0o755, parents=True, exist_ok=True)
            private_path(release_root, owner=0 if self.mode == 'production' else os.getuid(), directory=True)
            release_root.chmod(0o755)
            if self.current.is_symlink() and self.data['currentVersion'] is None:
                # Initial current must have an operator-established verified receipt.
                previous = self.current_release()
                receipt = json.loads((previous / '.relay-verified.json').read_text())
                self.data['currentVersion'] = receipt['version']
            job = self.data.get('job')
            if job and job.get('kind') == 'prepare' and job['phase'] == 'ready' and not self.data.get('checkpoint'):
                try:
                    self.validate_prepared()
                except (Denied, OSError, ValueError, KeyError, TypeError):
                    job['error'] = 'Prepared payload no longer validates; prepare again'
                    self.phase('failed', 'Prepared payload refused after restart; runtime unchanged', outcome='failed')
            elif job and job['phase'] not in TERMINAL:
                if self.data.get('checkpoint'):
                    self.gate()
                    self.reason = 'Recovery required: interrupted activation; maintenance preserved'
                self.phase('interrupted', 'Broker restarted during an incomplete job', outcome='interrupted')
            if self.maintenance.exists():
                self.reason = 'Recovery required: maintenance is closed; operator inspection required'
        self.save()

    def close(self):
        if self.thread and self.thread.is_alive():
            self.cancelled.set()
            self.thread.join(timeout=150)
        if self.mode == 'fixture':
            self.driver.stop()
        self.lockfile.close()

    def save(self):
        atomic_json(self.journal, self.data)

    def snapshot(self):
        with self.lock:
            allowed = self.mode != 'observe' and self.reason is None and not self.busy()
            ready = self.mode != 'observe' and self.reason is None and not self.maintenance.exists() and isinstance(self.data.get('job'), dict) and self.data['job'].get('kind') == 'prepare' and self.data['job'].get('phase') == 'ready' and not self.data.get('checkpoint')
            return json.loads(json.dumps(dict(protocol=1, mode=self.mode, currentVersion=self.data['currentVersion'], available=self.available, job=self.data['job'], history=self.data['history'][-20:], canInstall=allowed, canPrepare=allowed, canApply=ready, capabilities=dict(prepare=1, apply=1), reason=self.reason)))

    def busy(self):
        return self.data['job'] is not None and self.data['job']['phase'] not in TERMINAL

    def phase(self, phase, message, outcome=None):
        with self.lock:
            if phase in TERMINAL and self.mode != 'observe' and not self.maintenance.exists():
                try:
                    job = self.data['job']
                    if job.get('kind') == 'prepare':
                        import re
                        if not re.fullmatch('[0-9a-f]{32}', job['id']):
                            raise OSError('Invalid prepared job cleanup identity')
                        stage = self.install / 'releases' / ('.stage-' + job['id'])
                        if stage.is_symlink() or (stage.exists() and not stage.is_dir()):
                            stage.unlink()
                        elif stage.exists():
                            shutil.rmtree(stage)
                        fsync_dir(stage.parent)
                        self.data.pop('prepared', None)
                    self.prune()
                except OSError:
                    self.reason = 'Storage cleanup failed; operator inspection required'
            job = self.data['job']
            now = int(time.time() * 1000)
            job.update(phase=phase, updatedAt=now, canCancel=phase in PRE or phase == 'ready', canRollback=bool(self.data.get('previous')) and phase in TERMINAL and self.reason is None, outcome=outcome)
            job['events'].append(dict(at=now, phase=phase, message=message))
            job['events'] = job['events'][-64:]
            self.save()

    def gate(self):
        self.maintenance.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        fd = os.open(str(self.maintenance), os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o644)
        try:
            os.fchmod(fd, 0o644)
            os.fsync(fd)
        finally:
            os.close(fd)
        fsync_dir(self.maintenance.parent)

    def ungate(self):
        self.maintenance.unlink(missing_ok=True)
        fsync_dir(self.maintenance.parent)

    def current_release(self):
        if not self.current.is_symlink():
            raise Denied('Current release is not a managed symlink')
        release = self.current.resolve(strict=True)
        if release.parent != (self.install / 'releases').resolve() or release.is_symlink():
            raise Denied('Current release escapes managed releases')
        receipt = release / '.relay-verified.json'
        if receipt.is_symlink() or not receipt.is_file():
            raise Denied('Current release lacks verified receipt')
        value = json.loads(receipt.read_text())
        if value.get('mode') != self.mode:
            raise Denied('Release verification mode mismatch')
        return release

    def preparation_baseline(self):
        """Prepare-only acquisition; never call the legacy pathname receipt reader.

        Protected install ancestors remain required. Pin the actual install root,
        then open each managed child relative to it without following links.
        """
        import contextlib
        import re
        from .releases import VERSION

        owner = 0 if self.mode == 'production' else os.getuid()
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK

        def identity(info):
            return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                    info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

        try:
            with contextlib.ExitStack() as descriptors:
                pinned = []

                def opened(name, parent=None, directory=False):
                    info = os.stat(name, dir_fd=parent, follow_symlinks=False)
                    fd = os.open(name, flags | (os.O_DIRECTORY if directory else 0), dir_fd=parent)
                    descriptors.callback(os.close, fd)
                    actual = os.fstat(fd)
                    if identity(actual) != identity(info):
                        raise Denied('Prepared baseline changed during acquisition')
                    if actual.st_uid != owner or actual.st_mode & 0o7022:
                        raise Denied('Prepared baseline metadata is untrusted')
                    if directory:
                        if not stat.S_ISDIR(actual.st_mode):
                            raise Denied('Prepared baseline directory is untrusted')
                    elif not stat.S_ISREG(actual.st_mode) or actual.st_nlink != 1 or not 0 < actual.st_size <= 4096:
                        raise Denied('Prepared baseline receipt is untrusted')
                    pinned.append((name, parent, fd, actual))
                    return fd

                root = opened(self.install, directory=True)
                releases = opened('releases', root, directory=True)
                current = os.stat('current', dir_fd=root, follow_symlinks=False)
                if not stat.S_ISLNK(current.st_mode) or current.st_uid != owner:
                    raise Denied('Current release is not a managed symlink')
                link = os.readlink('current', dir_fd=root)
                target = Path(link)
                if target.parent not in (self.install / 'releases', Path('releases')) or target.name in ('', '.', '..'):
                    raise Denied('Current release escapes managed releases')
                release = opened(target.name, releases, directory=True)
                fd = opened('.relay-verified.json', release)
                raw = os.read(fd, 4097)
                if not 0 < len(raw) <= 4096 or len(raw) != os.fstat(fd).st_size:
                    raise Denied('Prepared baseline receipt exceeded bounds or changed')
                for name, parent, descriptor, info in reversed(pinned):
                    if identity(os.fstat(descriptor)) != identity(info) or identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) != identity(info):
                        raise Denied('Prepared baseline changed during acquisition')
                if identity(os.stat('current', dir_fd=root, follow_symlinks=False)) != identity(current) or os.readlink('current', dir_fd=root) != link:
                    raise Denied('Prepared baseline current link changed')
            value = json.loads(raw)
            if not isinstance(value, dict) or not all(isinstance(value.get(key), str) for key in ('mode', 'version', 'sha256')):
                raise Denied('Prepared baseline receipt schema mismatch')
            if value['mode'] != self.mode or not VERSION.fullmatch(value['version']) or value['version'] != self.data['currentVersion'] or not re.fullmatch('[0-9a-f]{64}', value['sha256']):
                raise Denied('Prepared baseline receipt mismatch')
        except (OSError, ValueError, TypeError, RecursionError) as error:
            raise Denied('Prepared baseline is unsafe or unreadable') from error
        return dict(currentLink=link, release=target.name, version=value['version'], receiptSha256=hashlib.sha256(raw).hexdigest())

    def validate_prepared(self):
        job, prepared = self.data['job'], self.data.get('prepared')
        from .releases import manifest_valid
        if not isinstance(job, dict) or not isinstance(prepared, dict) or type(prepared.get('schema')) is not int or prepared['schema'] != 1 or prepared.get('jobId') != job['id'] or prepared.get('version') != job['version']:
            raise Denied('Prepared payload identity mismatch')
        if not isinstance(job.get('userId'), str) or not 1 <= len(job['userId']) <= 128 or prepared.get('userId') != job['userId']:
            raise Denied('Prepared payload owner mismatch')
        manifest = manifest_valid(prepared.get('manifest'), job['version'])
        if prepared.get('artifact') != manifest['artifact']:
            raise Denied('Prepared artifact identity mismatch')
        if prepared.get('baseline') != job.get('baseline') or prepared.get('baseline') != self.preparation_baseline():
            raise Denied('Prepared baseline changed')
        # The path is derived solely from the broker-created job, never a stored path.
        import re
        if not re.fullmatch('[0-9a-f]{32}', job['id']):
            raise Denied('Prepared payload job invalid')
        stage = self.install / 'releases' / ('.stage-' + job['id'])
        owner = 0 if self.mode == 'production' else os.getuid()
        with managed_releases(self.install, owner) as (_root, releases):
            inventory = stage_fingerprint(stage.name, owner, dir_fd=releases)
        if inventory != prepared['inventory']:
            raise Denied('Prepared payload inventory mismatch')
        return stage

    def switch(self, release):
        tmp = self.install / ('.current-' + secrets.token_hex(8))
        tmp.symlink_to(release)
        os.replace(tmp, self.current)
        fsync_dir(self.install)

    def check(self):
        if not self.checklock.acquire(blocking=False):
            return self.snapshot()
        try:
            if time.monotonic() - self.last_check >= 10:
                self.last_check = time.monotonic()
                entries = self.releases.check(self.work)
                with self.lock:
                    self.available = entries
            return self.snapshot()
        finally:
            self.checklock.release()

    def request(self, action, params):
        if action == 'redeem-ui':
            return self.authority.redeem(params.get('ticket'), params.get('origin'))
        self.authority.read(params.get('token'))
        if action == 'state':
            return self.snapshot()
        if action == 'check':
            return self.check()
        with self.lock:
            if self.mode == 'observe':
                raise Denied('Observe mode forbids activation')
            if action == 'cancel':
                job = self.data['job']
                if not job or job['id'] != params.get('jobId') or not (job['phase'] in PRE or (job.get('kind') == 'prepare' and job['phase'] == 'ready')):
                    raise Denied('Job cannot safely be cancelled')
                self.authority.consume(params.get('token'), params.get('authorization'), 'cancel', jobId=job['id'])
                self.cancelled.set()
                if job['phase'] == 'ready':
                    self.data.pop('prepared', None)
                    self.phase('cancelled', 'Prepared payload cancelled; running Relay unchanged', outcome='cancelled')
                return self.snapshot()
            if action == 'apply':
                job = self.data.get('job')
                if self.reason or self.maintenance.exists() or self.data.get('checkpoint') or not isinstance(job, dict) or job.get('kind') != 'prepare' or job.get('phase') != 'ready' or params.get('jobId') != job.get('id') or params.get('version') != job.get('version'):
                    raise Denied('Apply requires the exact ready job and version')
                target = dict(version=job['version'], jobId=job['id'])
                cap = self.authority.validate_action(params.get('token'), params.get('authorization'), 'apply', **target)
                if not isinstance(job.get('userId'), str) or cap['userId'] != job['userId']:
                    raise Denied('Prepared job owner mismatch')
                try:
                    stage = self.validate_prepared()
                    self.driver.ready(self.data['currentVersion'])
                    # Readiness can wait: reacquire BOTH baseline and staged bytes
                    # before consuming authority or recording activation intent.
                    stage = self.validate_prepared()
                    artifact = self.data['prepared']['artifact']
                    release = self.install / 'releases' / (job['version'] + '-' + artifact['sha256'][:16])
                    if os.path.lexists(release):
                        raise Denied('Release already exists; operator inspection required')
                except (OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError) as error:
                    raise Denied('Prepared apply revalidation failed') from error
                self.authority.consume(params.get('token'), params.get('authorization'), 'apply', **target)
                checkpoint = dict(release=job['baseline']['release'], version=self.data['currentVersion'], backup='backup-' + job['id'], backupComplete=False, preparedBaseline=dict(job['baseline']))
                self.data['checkpoint'] = checkpoint
                job['applyRequested'] = True
                self.phase('backing-up', 'Explicit apply accepted; closing admission for consistent backup')
                self.thread = threading.Thread(target=self.run_apply, args=(stage, release, checkpoint), daemon=True)
                self.thread.start()
                return self.snapshot()
            if action not in ('start', 'prepare', 'rollback'):
                raise Denied('Unknown action')
            if self.busy() or self.reason or self.maintenance.exists():
                raise Denied('Updater busy or recovery required')
            baseline = self.preparation_baseline() if action == 'prepare' else None
            if action in ('start', 'prepare'):
                version = params.get('version')
                if version not in self.releases.entries or version == self.data['currentVersion']:
                    raise Denied('Select a checked release other than current')
                self.authority.consume(params.get('token'), params.get('authorization'), 'prepare' if action == 'prepare' else 'install', version=version)
            else:
                previous = self.data.get('previous')
                if not previous:
                    raise Denied('No verified rollback checkpoint')
                version = previous['version']
                self.authority.consume(params.get('token'), params.get('authorization'), 'rollback')
            old = self.data.get('job')
            if old:
                self.data['history'].append({k: old[k] for k in ('id', 'version', 'phase', 'startedAt', 'updatedAt', 'outcome', 'error')})
                self.data['history'] = self.data['history'][-20:]
            now = int(time.time() * 1000)
            self.data['job'] = dict(id=secrets.token_hex(16), version=version, kind=action, phase='staging' if action == 'rollback' else 'downloading', downloadedBytes=0, totalBytes=None, startedAt=now, updatedAt=now, canCancel=action in ('start', 'prepare'), canRollback=False, outcome=None, error=None, events=[])
            if action == 'prepare':
                self.data['job']['baseline'] = baseline
                self.data['job']['userId'] = self.authority.read(params.get('token'))['userId']
            self.cancelled.clear()
            self.save()
            self.thread = threading.Thread(target=self.run_rollback if action == 'rollback' else self.run_install, args=(version,) if action != 'prepare' else (version, True), daemon=True)
            self.thread.start()
            return self.snapshot()

    def progress(self, size):
        with self.lock:
            self.data['job']['downloadedBytes'] = size
            self.data['job']['updatedAt'] = int(time.time() * 1000)
            self.save()

    def restore(self, checkpoint):
        self.gate()
        self.driver.stop()
        backup = self.root / checkpoint['backup']
        release = self.install / 'releases' / checkpoint['release']
        if checkpoint.get('backupComplete') is not True or release.parent != self.install / 'releases' or backup.parent != self.root:
            raise Denied('Invalid rollback checkpoint')
        owner = 0 if self.mode == 'production' else os.getuid()
        if 'preparedBaseline' in checkpoint:
            baseline = checkpoint['preparedBaseline']
            if not isinstance(baseline, dict) or baseline.get('release') != checkpoint['release'] or baseline.get('version') != checkpoint['version']:
                raise Denied('Invalid prepared rollback baseline')
            acquired = rollback_receipt(self.install, checkpoint['release'], owner, self.mode, checkpoint['version'])
            if acquired != baseline.get('receiptSha256'):
                raise Denied('Prepared rollback baseline changed')
        else:
            # Preserve immediate-install's inherited rollback contract unchanged.
            private_path(release, owner=owner, directory=True)
            private_path(release / '.relay-verified.json', owner=owner)
            receipt = json.loads((release / '.relay-verified.json').read_text())
            if receipt.get('mode') != self.mode or receipt.get('version') != checkpoint['version']:
                raise Denied('Rollback receipt mismatch')
        # Backup roots preserve Relay ownership, but their parent is private to
        # the broker. Never consume the backup or clear intent before readiness.
        self.data['checkpoint'] = checkpoint
        self.save()
        restore_state(backup, self.state, preserve_owner=self.mode == 'production')
        self.switch(release)
        self.driver.start()
        self.driver.ready(checkpoint['version'])

        self.data['currentVersion'] = checkpoint['version']
        self.data['checkpoint'] = None
        self.data['previous'] = None
        self.save()
        self.ungate()

    def run_rollback(self, version):
        try:
            checkpoint = self.data['previous']
            self.data['checkpoint'] = checkpoint
            self.phase('activating', 'Restoring verified release and matching state checkpoint')
            self.gate()
            self.restore(checkpoint)
            self.phase('rolled-back', 'Previous verified release is ready', outcome='rolled-back')
        except Exception:
            self.gate()
            self.reason = 'Recovery required: rollback failed; maintenance preserved'
            self.data['job']['error'] = 'Rollback failed; operator recovery required'
            self.phase('rollback-failed', self.reason, outcome='rollback-failed')

    def run_apply(self, staging, release, checkpoint):
        """No network/discovery: activate only the exact revalidated ready bytes."""
        version = self.data['job']['version']
        try:
            self.gate()
            self.driver.stop()
            copy_state(self.state, self.root / checkpoint['backup'], preserve_owner=self.mode == 'production')
            checkpoint = dict(checkpoint, backupComplete=True)
            self.data['checkpoint'] = checkpoint
            self.phase('activating', 'Publishing verified code with admission closed')
            if os.path.lexists(release):
                raise Denied('Release already exists')
            os.replace(staging / 'payload', release)
            fsync_dir(staging)
            fsync_dir(release.parent)
            self.switch(release)
            self.phase('restarting', 'Starting Relay')
            self.driver.start()
            self.phase('health-checking', 'Waiting for expected-version readiness')
            self.driver.ready(version)
            self.data.update(currentVersion=version, previous=checkpoint, checkpoint=None)
            self.save()
            self.ungate()
            self.phase('succeeded', 'Explicitly applied release is ready', outcome='succeeded')
        except Exception:
            try:
                if not checkpoint.get('backupComplete'):
                    self.driver.start()
                    self.driver.ready(checkpoint['version'])
                    self.data['checkpoint'] = None
                    self.save()
                    self.ungate()
                    self.data['job']['error'] = 'Apply failed before activation'
                    self.phase('failed', 'Previous release remains ready', outcome='failed')
                else:
                    self.phase('activating', 'Apply failed; restoring matching code and state')
                    self.restore(checkpoint)
                    self.data['job']['error'] = 'Apply failed; previous release and matching state restored'
                    self.phase('rolled-back', 'Previous verified release is ready', outcome='rolled-back')
            except Exception:
                self.gate()
                self.reason = 'Recovery required: apply or rollback failed; maintenance preserved'
                self.data['job']['error'] = 'Apply recovery failed; operator recovery required'
                self.phase('rollback-failed', self.reason, outcome='rollback-failed')

    def run_install(self, version, prepare_only=False):
        work = self.work / self.data['job']['id']
        work.mkdir(mode=0o700)
        gated = False
        checkpoint = None
        staging = None
        try:
            self.phase('verifying', 'Verifying release identity before transfer')
            manifest = self.releases.verified_manifest(version, work)
            archive = work / ARTIFACT
            self.data['job']['totalBytes'] = manifest['artifact']['size']
            self.phase('downloading', 'Downloading verified release payload')
            transfer(self.releases.base(version) + '/' + ARTIFACT, archive, limit=manifest['artifact']['size'], progress=self.progress, cancelled=self.cancelled.is_set, fixture=self.mode == 'fixture')
            self.phase('verifying', 'Checking payload digest and exact size')
            sha = hashlib.sha256()
            with archive.open('rb') as stream:
                for chunk in iter(lambda: stream.read(65536), b''):
                    sha.update(chunk)
            if archive.stat().st_size != manifest['artifact']['size'] or sha.hexdigest() != manifest['artifact']['sha256']:
                raise Denied('Payload verification failed')
            self.phase('staging', 'Extracting and checking standalone release')
            # ReadWritePaths are separate mounts, even on the same filesystem.
            # The private wrapper keeps extraction inaccessible until publication.
            if prepare_only:
                staging = self.install / 'releases' / ('.stage-' + self.data['job']['id'])
                staging.mkdir(mode=0o700)
            else:
                staging = Path(tempfile.mkdtemp(prefix='.stage-', dir=self.install / 'releases'))
            stage = staging / 'payload'
            extract(archive, stage)
            self.driver.preflight(stage, version)
            atomic_json(stage / '.relay-verified.json', dict(mode=self.mode, version=version, sha256=sha.hexdigest()))
            stage.chmod(0o755)
            # Flush final file metadata as well as contents after extraction's
            # chmods and preflight; persist nested entries before publication.
            for base, _dirs, files in os.walk(stage, topdown=False):
                for name in files:
                    fd = os.open(Path(base) / name, os.O_RDONLY | os.O_NOFOLLOW)
                    try:
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                fsync_dir(base)
            if prepare_only:
                fsync_dir(staging)
                fsync_dir(staging.parent)
                with self.lock:
                    if self.cancelled.is_set():
                        raise Denied('Cancelled before ready')
                    baseline = self.data['job']['baseline']
                    if baseline != self.preparation_baseline():
                        raise Denied('Prepared baseline changed during transfer')
                    self.data['prepared'] = dict(schema=1, jobId=self.data['job']['id'], userId=self.data['job']['userId'], version=version, baseline=baseline, artifact=dict(manifest['artifact']), manifest=json.loads(json.dumps(manifest)), inventory=stage_fingerprint(staging, 0 if self.mode == 'production' else os.getuid()))
                    self.phase('ready', 'Verified payload staged, not installed; explicit apply required')
                    staging = None  # Durable job owns it until explicit cancellation.
                return
            release = self.install / 'releases' / (version + '-' + sha.hexdigest()[:16])
            if release.exists():
                raise Denied('Release already staged; operator inspection required')
            os.replace(stage, release)
            fsync_dir(staging)
            fsync_dir(release.parent)
            with self.lock:
                if self.cancelled.is_set():
                    raise Denied('Cancelled before activation')
                prior = self.current_release()
                backup_name = 'backup-' + self.data['job']['id']
                checkpoint = dict(release=prior.name, version=self.data['currentVersion'], backup=backup_name)
                # Persist intent BEFORE admission/service effects. Incomplete backup is never auto-restored.
                self.data['checkpoint'] = dict(checkpoint, backupComplete=False)
                self.phase('backing-up', 'Closing admission and stopping Relay for consistent backup')
                gated = True
                self.gate()
            self.driver.stop()
            copy_state(self.state, self.root / backup_name, preserve_owner=self.mode == 'production')
            checkpoint['backupComplete'] = True
            self.data['checkpoint'] = checkpoint
            self.phase('activating', 'Activating verified code with admission closed')
            self.switch(release)
            self.phase('restarting', 'Starting Relay')
            self.driver.start()
            self.phase('health-checking', 'Waiting for expected-version readiness')
            self.driver.ready(version)
            self.data.update(currentVersion=version, previous=checkpoint, checkpoint=None)
            self.save()
            self.ungate()
            self.phase('succeeded', 'Verified release is ready', outcome='succeeded')

        except Exception:
            if gated:
                try:
                    if not checkpoint or not checkpoint.get('backupComplete'):
                        # No candidate was switched if the consistent backup did not finish.
                        self.driver.start()
                        self.driver.ready(self.data['currentVersion'])
                        self.data['checkpoint'] = None
                        self.save()
                        self.ungate()
                        self.data['job']['error'] = 'Update failed before activation'
                        self.phase('failed', 'Previous release remains ready', outcome='failed')
                    else:
                        self.phase('activating', 'Candidate failed; restoring matching code and state')
                        self.restore(checkpoint)
                        self.data['job']['error'] = 'Candidate failed readiness; previous release restored'
                        self.phase('rolled-back', 'Previous verified release is ready', outcome='rolled-back')
                except Exception:
                    self.gate()
                    self.reason = 'Recovery required: rollback failed; maintenance preserved'
                    self.data['job']['error'] = 'Update and rollback failed; operator recovery required'
                    self.phase('rollback-failed', self.reason, outcome='rollback-failed')
            else:
                phase = 'cancelled' if self.cancelled.is_set() else 'failed'
                self.data['job']['error'] = None if phase == 'cancelled' else 'Release verification, transfer or staging failed'
                self.phase(phase, 'No running Relay state was changed', outcome=phase)
        finally:
            if staging is not None and staging.exists():
                shutil.rmtree(staging)
                fsync_dir(staging.parent)
            shutil.rmtree(work, ignore_errors=True)

    def prune(self):
        # Only engine-created obsolete checkpoint data; never current/previous releases.
        import re
        keep_backups = {record['backup'] for record in (self.data.get('previous'), self.data.get('checkpoint')) if record and 'backup' in record}
        for path in self.root.iterdir():
            if re.fullmatch('backup-[0-9a-f]{32}', path.name) and path.name not in keep_backups and path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
        keep = {self.current.resolve().name}
        if self.data.get('previous'):
            keep.add(self.data['previous']['release'])
        for release in (self.install / 'releases').iterdir():
            if release.is_dir() and not release.is_symlink() and release.name not in keep:
                shutil.rmtree(release)
