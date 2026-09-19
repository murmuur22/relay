"""Run read-only GitHub observation with a disposable protected broker control root."""
import argparse
import json
from pathlib import Path
import secrets
import signal
import tempfile
import threading

from .auth import atomic_json
from .engine import Engine
from .server import Broker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', required=True)
    parser.add_argument('--ui-origin', default='http://localhost:4191')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='relay-observe-') as temp:
        root = Path(temp).resolve()
        root.chmod(0o700)
        key = root / 'bridge.key'
        key.write_bytes(secrets.token_bytes(32))
        key.chmod(0o600)
        config = dict(mode='observe', observeRoot=str(root), controlRoot=str(root / 'control'), socketPath=str(root / 'b.sock'), bridgeKeyFile=str(key), uiOrigin=args.ui_origin, currentPackage=str(Path(args.package).resolve()))
        atomic_json(root / 'broker.json', config)
        engine = Engine(config)
        try:
            if args.check:
                print(json.dumps(engine.check(), sort_keys=True))
            else:
                server = Broker(engine)
                def stop(*_):
                    threading.Thread(target=server.shutdown, daemon=True).start()
                signal.signal(signal.SIGTERM, stop)
                signal.signal(signal.SIGINT, stop)
                print('OBSERVE ONLY config: ' + str(root / 'broker.json'), flush=True)
                try:
                    server.serve_forever(poll_interval=0.1)
                finally:
                    server.server_close()
        finally:
            engine.close()


if __name__ == '__main__':
    main()
