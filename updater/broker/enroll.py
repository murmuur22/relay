"""Operator-only first baseline enrollment. NOT an HTTP/broker action.

Refuses an existing current link, requires a maintenance gate, and never starts or
stops Relay. Production additionally requires an inactive unit and empty state.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from .auth import Denied, atomic_json, fsync_dir
from .driver import private_path, validate_config
from .engine import Engine
from .releases import ARTIFACT, SAFE_ENV, extract, transfer


def enroll(config, version):
    config = validate_config(config)
    if config['mode'] == 'observe':
        raise Denied('Observe mode cannot enroll')
    current = Path(config['installRoot']) / 'current'
    if current.exists() or current.is_symlink():
        raise Denied('Enrollment refuses an existing current installation')
    if not Path(config['maintenance']).is_file():
        raise Denied('Operator must close maintenance admission first')
    if config['mode'] == 'production':
        result = subprocess.run(['/usr/bin/systemctl', 'is-active', '--quiet', 'relay.service'], env=SAFE_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        if result.returncode != 3:
            raise Denied('Enrollment requires a verified inactive Relay unit')
        if any(Path(config['stateRoot']).iterdir()):
            raise Denied('First enrollment requires empty state; existing-install migration is separate')
    engine = Engine(config)
    try:
        with tempfile.TemporaryDirectory(dir=engine.work) as tmp:
            work = Path(tmp)
            manifest = engine.releases.verified_manifest(version, work)
            archive = work / ARTIFACT
            transfer(engine.releases.base(version) + '/' + ARTIFACT, archive, limit=manifest['artifact']['size'], fixture=config['mode'] == 'fixture')
            sha = hashlib.sha256()
            with archive.open('rb') as stream:
                for chunk in iter(lambda: stream.read(65536), b''):
                    sha.update(chunk)
            if archive.stat().st_size != manifest['artifact']['size'] or sha.hexdigest() != manifest['artifact']['sha256']:
                raise Denied('Enrollment payload verification failed')
            stage = work / 'stage'
            extract(archive, stage)
            engine.driver.preflight(stage, version)
            receipt = dict(mode=config['mode'], version=version, sha256=sha.hexdigest())
            atomic_json(stage / '.relay-verified.json', receipt)
            stage.chmod(0o755)
            fsync_dir(stage)
            release = Path(config['installRoot']) / 'releases' / (version + '-' + sha.hexdigest()[:16])
            if release.exists():
                raise Denied('Enrollment target already exists')
            os.replace(stage, release)
            fsync_dir(release.parent)
            engine.switch(release)
            engine.data['currentVersion'] = version
            engine.save()
            return receipt
    finally:
        engine.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    path = private_path(args.config)
    receipt = enroll(json.loads(path.read_text()), args.version)
    print(json.dumps(dict(version=receipt['version'], mode=receipt['mode'], outcome='baseline-enrolled-maintenance-still-closed')))


if __name__ == '__main__':
    main()
