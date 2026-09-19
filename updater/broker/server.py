"""Unix NDJSON protocol v1. No caller-provided paths or service commands."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import socketserver
import stat
import struct
import threading

from .auth import Denied
from .driver import private_path
from .engine import Engine


class Broker(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    block_on_close = False
    request_queue_size = 16

    def __init__(self, engine):
        self.engine = engine
        self.slots = threading.BoundedSemaphore(16)
        path = Path(engine.config['socketPath'])
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.exists():
            info = path.lstat()
            if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
                raise Denied('Refusing existing non-owned socket path')
            path.unlink()
        super().__init__(str(path), Handler)
        os.chmod(path, 0o660 if engine.mode == 'production' else 0o600)
        if engine.mode == 'production':
            os.chown(path, 0, engine.config['socketGid'])

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        # Never let socketserver print payloads, stack locals or credentials.
        pass

    def server_close(self):
        super().server_close()
        Path(self.server_address).unlink(missing_ok=True)


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(10)
        engine = self.server.engine
        try:
            raw = self.rfile.readline(65537)
            if len(raw) > 65536 or not raw.endswith(b'\n'):
                raise Denied('Request size or framing invalid')
            value = json.loads(raw)
            if not isinstance(value, dict) or not isinstance(value.get('action'), str):
                raise Denied('Invalid request')
            action = value['action']
            if action in ('issue-ui', 'issue-action'):
                if engine.mode == 'production':
                    _pid, uid, _gid = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                    if uid != engine.config['relayUid']:
                        raise Denied('Issuer peer rejected')
                result = engine.authority.issue(value)
            else:
                params = value.get('params', {})
                if not isinstance(params, dict):
                    raise Denied('Invalid parameters')
                result = engine.request(action, params)
            response = dict(ok=True, result=result)
        except Denied as error:
            response = dict(ok=False, error=str(error))
        except Exception:
            response = dict(ok=False, error='Broker request failed')
        encoded = json.dumps(response, separators=(',', ':'), allow_nan=False).encode() + b'\n'
        if len(encoded) > 1024 * 1024:
            encoded = b'{"ok":false,"error":"Response limit exceeded"}\n'
        try:
            self.wfile.write(encoded)
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser(description='Relay updater Unix broker (explicit trusted config required)')
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    path = private_path(args.config)
    config = json.loads(path.read_text())
    engine = Engine(config)
    broker = Broker(engine)
    def stop(_signum, _frame):
        threading.Thread(target=broker.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        if engine.mode == 'fixture' and not engine.maintenance.exists():
            engine.driver.start()
            engine.driver.ready(engine.data['currentVersion'])
        broker.serve_forever(poll_interval=0.1)
    finally:
        broker.server_close()
        engine.close()


if __name__ == '__main__':
    main()
