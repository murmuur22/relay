"""One owner, cooperative TERM, bounded wait, strict completion. Never force-kill."""
import os,sys,json,signal,socket,shutil,time,subprocess
from pathlib import Path
from test_controls import accepted
ROOT=Path(__file__).parent

def probe(mode,d):
 d=Path(d);s=None;cancelled=False;r=dict(functional=False,childExit=None,signal=None,cleanup=False,evidenceWritten=False)
 old=signal.getsignal(signal.SIGTERM)
 def term(*_):
  nonlocal cancelled
  cancelled=True
 signal.signal(signal.SIGTERM,term)
 try:
  (d/'owned').mkdir();s=socket.socket();s.bind(('127.0.0.1',0));s.listen()
  (d/'ready.json').write_text(json.dumps(dict(pid=os.getpid(),port=s.getsockname()[1])))
  if mode=='cancel':
   end=time.monotonic()+8
   while not cancelled and time.monotonic()<end:time.sleep(.01)
   if not cancelled:raise RuntimeError('cancellation never delivered')
   r['signal']='SIGTERM';raise InterruptedError()
  r['functional']=mode!='nonzero'
  if mode=='evidence-failure':raise OSError('injected evidence-write failure')
  r['evidenceWritten']=True
 finally:
  if s:s.close()
  shutil.rmtree(d/'owned');r['cleanup']=not (d/'owned').exists()
  signal.signal(signal.SIGTERM,old)
  r['childExit']=0 if r['functional'] and r['evidenceWritten'] and not cancelled else 1
  (d/'receipt.json').write_text(json.dumps(r))
 return r['childExit']

def run():
 # Public files are generated from a fixed schema, never arbitrary stdout/journal.
 public=Path(os.environ['RUNNER_TEMP'])/'relay-mixed-public';public.mkdir(mode=0o700,exist_ok=True)
 private=Path('/var/lib/relay-mixed-private')
 env={k:os.environ[k] for k in ('GITHUB_ACTIONS','RUNNER_ENVIRONMENT','GITHUB_REPOSITORY','GITHUB_REF','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT')}
 env.update(PATH='/usr/bin:/bin',LANG='C.UTF-8',PYTHONDONTWRITEBYTECODE='1',RELAY_DISPOSABLE_SYSTEMD='I_ACCEPT_DISPOSABLE_HOST_MUTATION',RELAY_MIXED_ACK='MIXED_BRIDGE_DISPOSABLE_HOST_ONLY')
 cmd=['sudo','env','-i',*(k+'='+v for k,v in env.items()),'/usr/bin/python3','-B','/opt/relay-mixed-kit/rehearse.py','run']
 cancelled=False;p=None;rc=None
 def term(*_):
  nonlocal cancelled
  cancelled=True
  if p and p.poll() is None:
   subprocess.run(['sudo','systemctl','kill','--kill-whom=main','--signal=TERM','relay-mixed-owner.service'],timeout=10,check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 old=signal.signal(signal.SIGTERM,term)
 try:
  # The producer itself owns cleanup; this supervisor and workflow cleanup independently read it back.
  p=subprocess.Popen(['sudo','systemd-run','--unit=relay-mixed-owner','--wait','--pipe','--collect','--property=RuntimeMaxSec=1200','--property=TimeoutStopSec=120','--property=SendSIGKILL=no',*cmd[1:]],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  out,err=p.communicate(timeout=1380);rc=p.returncode
 finally:
  signal.signal(signal.SIGTERM,old)
  cleanup=subprocess.run(['sudo','env','-i','PATH=/usr/bin:/bin','/usr/bin/python3','-B','/opt/relay-mixed-kit/rehearse.py','cleanup'],capture_output=True,timeout=150)
  # Only schema-constrained receipt, no code/state/config, is allowed across privilege boundary.
  fetched=subprocess.run(['sudo','/bin/cat',str(private/'result.json')],capture_output=True,timeout=10)
  try:r=json.loads(fetched.stdout)
  except Exception:r=dict(passed=False,gates={},error='missing-producer-receipt')
  r.update(supervisorExit=rc,supervisorCancelled=cancelled,workflowCleanupExit=cleanup.returncode)
  r['passed']=r.get('passed') is True and rc==0 and not cancelled and cleanup.returncode==0
  (public/'result.json').write_text(json.dumps(r,indent=2)+'\n')
 if not r['passed']:return 1
 return 0
if __name__=='__main__':
 try:sys.exit(probe(sys.argv[2],sys.argv[3]) if sys.argv[1]=='probe' else run())
 except BaseException as e:
  if isinstance(e,SystemExit):raise
  print('Owned supervisor failed; no qualification claimed.',file=sys.stderr);sys.exit(1)
