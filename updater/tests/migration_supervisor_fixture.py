"""Controlled subprocess using the actual supervisor; no Linux/service authority."""
import argparse,contextlib,hashlib,json,os,signal,subprocess,sys,time,types
from pathlib import Path
from unittest.mock import patch
from deploy.migration_069 import qualify as q

p=argparse.ArgumentParser();p.add_argument('root');p.add_argument('--fault',default='signal');a=p.parse_args()
r=Path(a.root);work=r/'admitted';dest=r/'installed';migration=r/'migrations';output=r/'output'
info=json.loads((r/'listener.json').read_text())
def identity(pid):
 try:
  text=subprocess.check_output(['/bin/ps','-p',str(pid),'-o','stat=','-o','lstart='],text=True).strip()
  return None if not text or text.startswith('Z') else text.split(None,1)[1]
 except subprocess.CalledProcessError:return None

def event(name):
 with (r/'events.jsonl').open('a') as f:f.write(json.dumps(dict(event=name,migrationExists=migration.is_dir(),mode=(migration.stat().st_mode&0o777) if migration.exists() else None))+'\n')
def run(cmd,**kw):
 if cmd[0]=='/usr/bin/systemctl':
  action=cmd[1]
  if action=='start':event('first-systemd-launch');return ''
  if action=='stop':
   event('stop')
   if a.fault=='cleanup-error':raise OSError('controlled stop failure')
   if identity(info['pid'])==info['start']:os.kill(info['pid'],signal.SIGTERM)
   deadline=time.monotonic()+3
   while identity(info['pid']) is not None and time.monotonic()<deadline:time.sleep(.01)
   return ''
  alive=identity(info['pid']) is not None
  if '--property=MainPID,ControlGroup' in cmd:return 'MainPID='+str(info['pid'] if alive else 0)+'\nControlGroup=/fixture'
  if '--property=MainPID,ActiveState,Result' in cmd:return 'MainPID=0\nActiveState=inactive\nResult=success'
  if '--property=LoadState' in cmd:return 'loaded' if alive else 'not-found'
  return ''
 if cmd[0]=='/usr/bin/systemd-run':
  journal=json.loads((output/'ownership-loopback.json').read_text())
  assert journal['unitIntents']==[q.UNIT], 'Transient unit must be durable before launch'
  assert '--description='+q.unit_description(journal['context']) in cmd
  event('worker')
  # Completion-shaped data must not turn cancellation or child failure into pass.
  (work/'execution.json').write_text(json.dumps(dict(exit=0,cases=[])))
  (r/'ready').write_text('ready')
  if a.fault in ('signal','repeat','cleanup-error'):
   while True:signal.pause()
  if a.fault=='worker-failure':raise subprocess.CalledProcessError(7,cmd)
  return ''
 return ''
def apply(*args):dest.mkdir();event('installed')
def write_new(path,data,*args,**kw):
 with Path(path).open('x') as f:f.write(data)
install=types.SimpleNamespace(DESTINATIONS=(str(dest),),UNITS=('fixture.service',),FILES=('relay-release.json',),run=run,regular=lambda *a:None,
 write_new=write_new,prepare=lambda args:contextlib.nullcontext((r,{})),apply_install=apply,deployment_network=lambda lan:{'hostname':'127.0.0.1'})
h=types.SimpleNamespace(install=install,base=types.SimpleNamespace(NETWORK={'hostname':'127.0.0.1'}))
source=Path(q.__file__).resolve().parents[2];n='deploy/migration_069/qualification_worker.py';f=source/n
inventory={n:dict(mode=f.stat().st_mode&0o777,size=f.stat().st_size,sha256=hashlib.sha256(f.read_bytes()).hexdigest())}
args=types.SimpleNamespace(source_commit='c'*40,ack=q.ACK,mode='loopback',old_release_dir=str(r/'old'),candidate_dir=str(r/'candidate'),output=str(output))
previous=signal.getsignal(signal.SIGTERM)
try:
 with patch.object(q,'ROOT',work),patch.object(q,'MIGRATIONS',migration,create=True),patch.object(q,'workflow_guard'),patch.object(q,'fresh_host'),patch.object(q,'helper',return_value=h),patch.object(q,'git_inventory',return_value=inventory),patch.object(q,'process_identity',side_effect=identity),patch.dict(os.environ,dict(GITHUB_REF='refs/heads/main',GITHUB_SHA='c'*40,GITHUB_RUN_ID='1',GITHUB_RUN_ATTEMPT='1')):
  if a.fault=='create-failure':
   original=Path.mkdir
   def mkdir(path,*args,**kw):
    if path==migration:raise PermissionError('controlled migration mkdir failure')
    return original(path,*args,**kw)
   with patch.object(Path,'mkdir',mkdir):q.run(args)
  else:q.run(args)
except Exception as exc:
 (r/'failed.json').write_text(json.dumps(dict(error=type(exc).__name__,handlerRestored=signal.getsignal(signal.SIGTERM)==previous)))
 sys.exit(1)
else:sys.exit(0)
