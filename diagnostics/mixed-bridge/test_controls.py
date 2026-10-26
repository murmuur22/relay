import os,sys,json,subprocess,socket,signal,tempfile,time
from pathlib import Path
ROOT=Path(__file__).parent

def accepted(r):
 return r.get('functional') is True and r.get('childExit')==0 and r.get('signal') is None and r.get('cleanup') is True and r.get('evidenceWritten') is True

def main():
 env=dict(GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_REPOSITORY='murmuur22/relay',GITHUB_REF='refs/heads/diag/relay-mixed-presentation-bridge',GITHUB_WORKFLOW_REF='murmuur22/relay/.github/workflows/ui-delivery-compatibility.yml@refs/heads/diag/relay-mixed-presentation-bridge',RUNNER_KIND='github-hosted',RUNNER_OS='Linux',RUNNER_ARCH='X64',DIAGNOSTIC_SHA='a'*40,GITHUB_SHA='a'*40,SOURCE_SHA='f477a9d8f227d42e83308d45c37e689d085649b7',ACKNOWLEDGE='MIXED_BRIDGE_DISPOSABLE_HOST_ONLY',ImageOS='ubuntu24',PATH=os.environ['PATH'])
 assert subprocess.run(['bash',str(ROOT/'admit.sh')],env=env).returncode==0
 for k,v in dict(GITHUB_EVENT_NAME='push',GITHUB_REPOSITORY='other/relay',GITHUB_REF='refs/heads/main',GITHUB_WORKFLOW_REF='other/workflow',RUNNER_KIND='self-hosted',RUNNER_OS='Darwin',RUNNER_ARCH='ARM64',DIAGNOSTIC_SHA='b'*40,SOURCE_SHA='c'*40,ACKNOWLEDGE='wrong',ImageOS='ubuntu22').items():
  result=subprocess.run(['/bin/bash','-x',str(ROOT/'admit.sh')],env={**env,k:v},capture_output=True,text=True)
  assert result.returncode!=0,(k,result.returncode,result.stdout,result.stderr)
 results=[]
 for mode in ('happy','nonzero','evidence-failure','cancel'):
  with tempfile.TemporaryDirectory(prefix='mixed-controls-',dir=os.environ.get('TMPDIR')) as d:
   p=subprocess.Popen([sys.executable,'-B',str(ROOT/'supervise.py'),'probe',mode,d],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   deadline=time.monotonic()+10;ready=Path(d)/'ready.json'
   while not ready.exists() and p.poll() is None and time.monotonic()<deadline:time.sleep(.02)
   assert ready.exists(),'owned resource never acquired'
   owned=json.loads(ready.read_text())
   if mode=='cancel':
    p.send_signal(signal.SIGTERM)
    p.send_signal(signal.SIGTERM)
   out,err=p.communicate(timeout=15)
   r=json.loads((Path(d)/'receipt.json').read_text());r['childExit']=p.returncode
   with socket.socket() as s:assert s.connect_ex(('127.0.0.1',owned['port']))!=0
   assert r['cleanup'] and not (Path(d)/'owned').exists()
   assert accepted(r)==(mode=='happy'),(mode,r)
   results.append(dict(mode=mode,exit=p.returncode,cleanup=r['cleanup'],accepted=accepted(r)))
 good=dict(functional=True,childExit=0,signal=None,cleanup=True,evidenceWritten=True)
 assert accepted(good)
 for k,v in dict(childExit=1,signal='SIGKILL',cleanup=False,evidenceWritten=False,functional=False).items():assert not accepted({**good,k:v})
 print(json.dumps(dict(passed=True,admissionNegatives=11,realCleanupControls=results,finalizerNegatives=5),indent=2))
if __name__=='__main__':main()
