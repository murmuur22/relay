"""Cheap owned listener for supervisor tests; never a qualification worker."""
import json,os,signal,socket,sys
from pathlib import Path
s=socket.socket();s.bind(('127.0.0.1',0));s.listen()
Path(sys.argv[1]).write_text(json.dumps(dict(pid=os.getpid(),port=s.getsockname()[1])))
def stop(*args):s.close();raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
while True:signal.pause()
