"""Read-only external Exterminator source, isolated ephemeral DB/listeners only."""
import sys
import json
import signal
import threading
from werkzeug.serving import make_server, WSGIRequestHandler
sys.path.insert(0, sys.argv[1])
from app import create_app, VERSION
from production import Surface
class Quiet(WSGIRequestHandler):
    def log(self, *args, **kwargs):
        pass
servers = []
for surface in ('admin', 'submission'):
    app = create_app(sys.argv[2], surface=surface, boundary=None)
    server = make_server('127.0.0.1', 0, app, request_handler=Quiet)
    # Exact actual ephemeral authority, same production Origin/peer/Host checks.
    # Factory closure references this immutable surface; recreate before serving.
    app = create_app(sys.argv[2], surface=surface,
                     boundary=Surface('127.0.0.1', server.server_port, ('127.0.0.1',), sys.argv[3]))
    server.app = app
    threading.Thread(target=server.serve_forever, daemon=True).start()
    servers.append(server)
print(json.dumps(dict(version=VERSION, admin=servers[0].server_port, submission=servers[1].server_port)), flush=True)
signal.pause()
