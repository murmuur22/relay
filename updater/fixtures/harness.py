"""Real disposable fixture: signed bytes over HTTP, Unix broker, actual Node service.

python3 -m updater.fixtures.harness --demo
python3 -m updater.fixtures.harness --serve  # prints config paths, never capabilities
"""
import argparse
import base64
import functools
import hashlib
import hmac
import http.server
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request

from updater.broker.auth import atomic_json
from updater.broker.releases import ARTIFACT, extract

SERVICE = '''import http from 'node:http';
import fs from 'node:fs';
const pkg=JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url)));
const bad=pkg.version==='0.3.2';
if(bad)fs.writeFileSync(process.env.STATE+'/fixture.txt','candidate mutation');
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify({status:bad?'not-ready':'ready',version:pkg.version,maintenance:fs.existsSync(process.env.MAINTENANCE)}));
});
server.listen(Number(process.env.PORT),'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
'''


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def envelope(key, action, payload):
    timestamp, nonce = int(time.time()), secrets.token_hex(16)
    body = base64.b64encode(json.dumps(payload).encode()).decode()
    mac = hmac.new(key, f'{timestamp}\n{nonce}\n{action}\n{body}'.encode(), hashlib.sha256).hexdigest()
    return dict(action=action, timestamp=timestamp, nonce=nonce, payload=body, mac=mac)


def rpc(path, message):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(20)
        sock.connect(str(path))
        sock.sendall(json.dumps(message).encode() + b'\n')
        with sock.makefile('rb') as stream:
            data = stream.readline(1024 * 1024 + 1)
        value = json.loads(data)
        if not value['ok']:
            raise RuntimeError(value['error'])
        return value['result']


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Sandbox:
    def __init__(self, ui_origin='http://localhost:4190'):
        if os.geteuid() == 0:
            raise RuntimeError('Fixture refuses root')
        self.temp = tempfile.TemporaryDirectory(prefix='relay-updater-')
        self.root = Path(self.temp.name).resolve()
        self.root.chmod(0o700)
        self.process = None
        self.http = None
        self.root.joinpath('.relay-updater-fixture').write_text('DISPOSABLE FIXTURE ONLY\n')
        self.state = self.root / 'state'
        self.state.mkdir(mode=0o700)
        self.state.joinpath('fixture.txt').write_text('initial synthetic state')
        self.maintenance = self.root / 'maintenance'
        self.key = secrets.token_bytes(32)
        self.fixture_key = secrets.token_bytes(32)
        for name, key in [('bridge.key', self.key), ('fixture.key', self.fixture_key)]:
            (self.root / name).write_bytes(key)
            (self.root / name).chmod(0o600)
        self.feed = self.root / 'feed'
        self.feed.mkdir()
        for version in ('v0.3.0', 'v0.3.1', 'v0.3.2'):
            self.release(version)
        atomic_json(self.feed / 'index.json', [dict(tag_name=v, body='FIXTURE SANDBOX: ' + ('readiness failure and real rollback' if v == 'v0.3.2' else 'successful disposable release'), draft=False, prerelease=False) for v in ('v0.3.1', 'v0.3.2')])
        self.http = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(self.feed)))
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        install = self.root / 'install'
        releases = install / 'releases'
        releases.mkdir(parents=True)
        baseline = releases / 'v0.3.0-baseline'
        # Baseline is built locally and HMAC-checked before receipt issuance.
        raw = (self.feed / 'v0.3.0' / 'relay-release.json').read_bytes()
        proof = json.loads((self.feed / 'v0.3.0' / 'relay-release.attestation.json').read_text())
        assert hmac.compare_digest(proof['mac'], hmac.new(self.fixture_key, raw, hashlib.sha256).hexdigest())
        extract(self.feed / 'v0.3.0' / ARTIFACT, baseline)
        atomic_json(baseline / '.relay-verified.json', dict(mode='fixture', version='v0.3.0', sha256=json.loads(raw)['artifact']['sha256']))
        (install / 'current').symlink_to(baseline)
        # macOS Unix socket paths have a small limit; root is deliberately short enough.
        self.config = dict(mode='fixture', fixtureRoot=str(self.root), installRoot=str(install), stateRoot=str(self.state), controlRoot=str(self.root / 'control'), maintenance=str(self.maintenance), socketPath=str(self.root / 'b.sock'), bridgeKeyFile=str(self.root / 'bridge.key'), fixtureKeyFile=str(self.root / 'fixture.key'), fixtureFeed=f'http://127.0.0.1:{self.http.server_port}', fixturePort=free_port(), uiOrigin=ui_origin)
        self.config_path = self.root / 'broker.json'
        atomic_json(self.config_path, self.config)

    def release(self, version):
        folder = self.feed / version
        folder.mkdir()
        payload = folder / ARTIFACT
        with tarfile.open(payload, 'w:gz') as archive:
            for name, data in [('package.json', json.dumps(dict(version=version[1:])).encode()), ('service.mjs', SERVICE.encode()), ('payload.bin', secrets.token_bytes(512 * 1024))]:
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode = len(data), 0o644
                archive.addfile(entry, io.BytesIO(data))
        manifest = dict(protocol=1, repository='murmuur22/relay', version=version, platform='linux-x64', stateSchema=1, rollbackCompatible=True, minimumNode='26.8.1', artifact=dict(name=ARTIFACT, sha256=hashlib.sha256(payload.read_bytes()).hexdigest(), size=payload.stat().st_size))
        raw = json.dumps(manifest, separators=(',', ':')).encode()
        (folder / 'relay-release.json').write_bytes(raw)
        atomic_json(folder / 'relay-release.attestation.json', dict(kind='FIXTURE-HMAC-NOT-GITHUB', mac=hmac.new(self.fixture_key, raw, hashlib.sha256).hexdigest()))

    def start(self):
        self.process = subprocess.Popen([sys.executable, '-m', 'updater.broker.server', '--config', str(self.config_path)], cwd=Path(__file__).resolve().parents[2], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                error = self.process.stderr.read().decode()
                raise RuntimeError('Fixture broker failed: ' + error)
            try:
                self.ready()
                if Path(self.config['socketPath']).exists():
                    return self
            except (OSError, ValueError):
                pass
            time.sleep(0.05)
        raise RuntimeError('Fixture startup deadline exceeded')

    def ready(self):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{self.config['fixturePort']}/health/ready", timeout=1) as response:
            return json.loads(response.read(4096))

    def client(self):
        issued = rpc(self.config['socketPath'], envelope(self.key, 'issue-ui', dict(userId='fixture-admin', interfaceAnimations=True, relayVersion='0.3.0')))
        redeemed = rpc(self.config['socketPath'], dict(action='redeem-ui', params=dict(ticket=issued['ticket'], origin=self.config['uiOrigin'])))
        def call(action, **params):
            return rpc(self.config['socketPath'], dict(action=action, params=dict(params, token=redeemed['token'])))
        return call

    def authorization(self, action, **target):
        return rpc(self.config['socketPath'], envelope(self.key, 'issue-action', dict(target, userId='fixture-admin', action=action)))['authorization']

    def install(self, version):
        client = self.client()
        client('check')
        client('start', version=version, authorization=self.authorization('install', version=version))
        return self.wait(client)

    def wait(self, client):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            state = client('state')
            if state['job']['phase'] in ('succeeded', 'failed', 'rolled-back', 'rollback-failed', 'interrupted', 'cancelled'):
                return state['job']
            time.sleep(0.05)
        raise RuntimeError('Fixture job deadline exceeded')

    def close(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
            self.process.stderr.close()
        if self.http:
            self.http.shutdown()
            self.http.server_close()
        self.temp.cleanup()

    def __enter__(self):
        try:
            return self.start()
        except Exception:
            self.close()
            raise

    def __exit__(self, *args):
        self.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--ui-origin', default='http://localhost:4190')
    args = parser.parse_args()
    if not (args.demo or args.serve):
        parser.error('Select --demo or --serve')
    with Sandbox(ui_origin=args.ui_origin) as box:
        if args.demo:
            for version in ('v0.3.1', 'v0.3.2'):
                result = box.install(version)
                print(json.dumps(dict(mode='FIXTURE SANDBOX', version=version, phase=result['phase'], downloadedBytes=result['downloadedBytes'], totalBytes=result['totalBytes'], ready=box.ready()), sort_keys=True), flush=True)
        else:
            print('FIXTURE SANDBOX only. Config: ' + str(box.config_path), flush=True)
            print('Socket: ' + box.config['socketPath'], flush=True)
            print('Bridge key FILE (never print contents): ' + box.config['bridgeKeyFile'], flush=True)
            done = threading.Event()
            signal.signal(signal.SIGTERM, lambda *_: done.set())
            signal.signal(signal.SIGINT, lambda *_: done.set())
            done.wait()


if __name__ == '__main__':
    main()
