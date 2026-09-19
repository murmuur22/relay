"""Durable Relay-only update state machine. Incomplete activation stays gated."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import threading
import time

from .auth import Authority, Denied, atomic_json, fsync_dir
from .driver import Driver, copy_state, restore_state, validate_config, private_path
from .releases import Releases, ARTIFACT, extract, transfer

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
            if job and job['phase'] not in TERMINAL:
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
            return json.loads(json.dumps(dict(protocol=1, mode=self.mode, currentVersion=self.data['currentVersion'], available=self.available, job=self.data['job'], history=self.data['history'][-20:], canInstall=allowed, reason=self.reason)))

    def busy(self):
        return self.data['job'] is not None and self.data['job']['phase'] not in TERMINAL

    def phase(self, phase, message, outcome=None):
        with self.lock:
            if phase in TERMINAL and self.mode != 'observe' and not self.maintenance.exists():
                try:
                    self.prune()
                except OSError:
                    self.reason = 'Storage cleanup failed; operator inspection required'
            job = self.data['job']
            now = int(time.time() * 1000)
            job.update(phase=phase, updatedAt=now, canCancel=phase in PRE, canRollback=bool(self.data.get('previous')) and phase in TERMINAL and self.reason is None, outcome=outcome)
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
                if not job or job['id'] != params.get('jobId') or job['phase'] not in PRE:
                    raise Denied('Job cannot safely be cancelled')
                self.authority.consume(params.get('token'), params.get('authorization'), 'cancel', jobId=job['id'])
                self.cancelled.set()
                return self.snapshot()
            if action not in ('start', 'rollback'):
                raise Denied('Unknown action')
            if self.busy() or self.reason or self.maintenance.exists():
                raise Denied('Updater busy or recovery required')
            if action == 'start':
                version = params.get('version')
                if version not in self.releases.entries or version == self.data['currentVersion']:
                    raise Denied('Select a checked release other than current')
                self.authority.consume(params.get('token'), params.get('authorization'), 'install', version=version)
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
            self.data['job'] = dict(id=secrets.token_hex(16), version=version, phase='staging' if action == 'rollback' else 'downloading', downloadedBytes=0, totalBytes=None, startedAt=now, updatedAt=now, canCancel=action == 'start', canRollback=False, outcome=None, error=None, events=[])
            self.cancelled.clear()
            self.save()
            self.thread = threading.Thread(target=self.run_rollback if action == 'rollback' else self.run_install, args=(version,), daemon=True)
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

    def run_install(self, version):
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
