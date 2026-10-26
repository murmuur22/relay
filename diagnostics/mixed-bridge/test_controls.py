import os,sys,json,subprocess,socket,signal,tempfile,time,ast,stat
from pathlib import Path
ROOT=Path(__file__).parent

def accepted(r):
 return r.get('functional') is True and r.get('childExit')==0 and r.get('signal') is None and r.get('cleanup') is True and r.get('evidenceWritten') is True

def private_controls():
 def require(value,message):
  if not value:raise RuntimeError(message)
 tree=ast.parse((ROOT/'rehearse.py').read_text())
 functions=[f for f in tree.body if isinstance(f,ast.FunctionDef) and f.name in ('private_json','private_write')]
 assert len(functions)==2
 env=dict(os=os,json=json,stat=stat,require=require)
 exec(compile(ast.Module(body=functions,type_ignores=[]),'<exact-private-helpers>','exec'),env)
 results=[]
 with tempfile.TemporaryDirectory(prefix='private-controls-',dir=os.environ.get('TMPDIR')) as d:
  p=Path(d)/'receipt.json';env['private_write'](p,dict(passed=True));assert env['private_json'](p,os.getuid())==dict(passed=True)
  for mode in ('wrong-uid','wrong-mode','symlink','hardlink','fifo','oversize','malformed','array','missing'):
   if p.exists() or p.is_symlink():p.unlink()
   p.write_text('{"passed":true}');p.chmod(0o600);uid=os.getuid()
   if mode=='wrong-uid':uid+=1
   if mode=='wrong-mode':p.chmod(0o644)
   if mode=='symlink':p.unlink();p.symlink_to(Path(d)/'missing')
   if mode=='hardlink':os.link(p,Path(d)/'hardlink')
   if mode=='fifo':p.unlink();os.mkfifo(p,0o600)
   if mode=='oversize':p.write_bytes(b' '*65537)
   if mode=='malformed':p.write_text('{')
   if mode=='array':p.write_text('[]')
   if mode=='missing':p.unlink()
   try:env['private_json'](p,uid)
   except (RuntimeError,OSError,ValueError):results.append(mode)
   else:raise AssertionError(('private-reader-admitted',mode))
 assert len(results)==9
 return dict(actualDescriptorNegatives=results,atomicWriteReadback=True,systemdQualified=False)

def main():
 env=dict(GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_REPOSITORY='murmuur22/relay',GITHUB_REF='refs/heads/diag/relay-mixed-presentation-bridge',GITHUB_WORKFLOW_REF='murmuur22/relay/.github/workflows/ui-delivery-compatibility.yml@refs/heads/diag/relay-mixed-presentation-bridge',RUNNER_KIND='github-hosted',RUNNER_OS='Linux',RUNNER_ARCH='X64',DIAGNOSTIC_SHA='a'*40,GITHUB_SHA='a'*40,SOURCE_SHA='f477a9d8f227d42e83308d45c37e689d085649b7',ACKNOWLEDGE='MIXED_BRIDGE_DISPOSABLE_HOST_ONLY',ImageOS='ubuntu24',PATH=os.environ['PATH'])
 assert subprocess.run(['bash',str(ROOT/'admit.sh')],env=env).returncode==0
 for k,v in dict(GITHUB_EVENT_NAME='push',GITHUB_REPOSITORY='other/relay',GITHUB_REF='refs/heads/main',GITHUB_WORKFLOW_REF='other/workflow',RUNNER_KIND='self-hosted',RUNNER_OS='Darwin',RUNNER_ARCH='ARM64',DIAGNOSTIC_SHA='b'*40,SOURCE_SHA='c'*40,ACKNOWLEDGE='wrong',ImageOS='ubuntu22').items():
  result=subprocess.run(['/bin/bash','-x',str(ROOT/'admit.sh')],env={**env,k:v},capture_output=True,text=True)
  assert result.returncode!=0,(k,result.returncode,result.stdout,result.stderr)
 results=[]
 for mode in ('happy','nonzero','evidence-failure','cancel','timeout','no-result'):
  with tempfile.TemporaryDirectory(prefix='mixed-controls-',dir=os.environ.get('TMPDIR')) as d:
   p=subprocess.Popen([sys.executable,'-B',str(ROOT/'supervise.py'),'probe',mode,d],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   deadline=time.monotonic()+10;ready=Path(d)/'ready.json'
   while not ready.exists() and p.poll() is None and time.monotonic()<deadline:time.sleep(.02)
   assert ready.exists(),'owned resource never acquired'
   owned=json.loads(ready.read_text())
   if mode=='cancel':
    p.send_signal(signal.SIGTERM)
    p.send_signal(signal.SIGTERM)
   timedout=False
   try:out,err=p.communicate(timeout=.2 if mode=='timeout' else 15)
   except subprocess.TimeoutExpired:
    timedout=True;p.send_signal(signal.SIGTERM);out,err=p.communicate(timeout=15)
   receipt=Path(d)/'receipt.json';r=json.loads(receipt.read_text()) if receipt.exists() else {};r['childExit']=p.returncode
   with socket.socket() as s:assert s.connect_ex(('127.0.0.1',owned['port']))!=0
   assert not (Path(d)/'owned').exists() and p.poll() is not None
   assert bool(r.get('cleanup'))==(mode!='no-result')
   assert timedout==(mode=='timeout')
   assert accepted(r)==(mode=='happy'),(mode,r)
   results.append(dict(mode=mode,exit=p.returncode,cleanupObserved=True,receiptPresent=receipt.exists(),deadlineExpired=timedout,accepted=accepted(r)))
 good=dict(functional=True,childExit=0,signal=None,cleanup=True,evidenceWritten=True)
 assert accepted(good)
 for k,v in dict(childExit=1,signal='SIGKILL',cleanup=False,evidenceWritten=False,functional=False).items():assert not accepted({**good,k:v})
 print(json.dumps(dict(passed=True,admissionNegatives=11,realCleanupControls=results,privateReceiptControls=private_controls(),finalizerNegatives=5),indent=2))
if __name__=='__main__':main()
