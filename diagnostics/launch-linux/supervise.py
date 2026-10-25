"""Harness-only ownership envelope; original kit bytes and all test assertions unchanged.
Durable prelaunch intent + systemd control-group ownership, 360s maximum lifetime,
10s stop bound. Always cleanup is a separate consumer of that exact unit identity.
Cgroup teardown covers detached descendants and supervisor SIGKILL, not VM loss.
"""
from pathlib import Path
import os,sys,json,subprocess,time,hashlib
K=Path(__file__).resolve().parent
T=Path(os.environ['RUNNER_TEMP']); P=T/'relay-launch-private'
U='relay-launch-'+os.environ['GITHUB_RUN_ID']+'-'+os.environ['GITHUB_RUN_ATTEMPT']+'.service'
DESC='Relay isolated launch diagnostic '+os.environ['GITHUB_RUN_ID']+' attempt '+os.environ['GITHUB_RUN_ATTEMPT']
W=Path(os.environ['GITHUB_WORKSPACE'])
def durable(name,data):
 P.mkdir(mode=0o700,exist_ok=True)
 with (P/name).open('w') as f:json.dump(data,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 fd=os.open(P,os.O_RDONLY);os.fsync(fd);os.close(fd)
def call(a):
 p=subprocess.run(a,text=True,capture_output=True,timeout=390);return {'argv':a,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
def show():
 r=call(['systemctl','show',U,'--property=LoadState,ActiveState,SubState,Description,User,WorkingDirectory,KillMode,TimeoutStopUSec,RuntimeMaxUSec,Result,ExecMainStatus,ExecMainCode,ControlGroup,InvocationID'])
 return {x.split('=',1)[0]:x.split('=',1)[1] for x in r['stdout'].splitlines() if '=' in x}
def pids():
 c=Path('/sys/fs/cgroup/system.slice')/U
 return sorted({int(p) for f in c.rglob('cgroup.procs') for p in f.read_text().split()}) if c.exists() else []
def run():
 import PIL
 assert PIL.__version__=='11.3.0'
 assert os.environ['RELAY_ICON_PYTHON']==sys.executable
 assert os.environ['RUNNER_KIND']=='github-hosted'
 assert os.environ['GITHUB_REF']=='refs/heads/diag/relay-0611-launch-linux'
 assert show().get('LoadState')=='not-found','Do not adopt an existing unit'
 argv=['sudo','systemd-run','--quiet','--wait','--service-type=exec','--unit='+U,'--description='+DESC,'--property=User='+str(os.getuid()),'--property=Group='+str(os.getgid()),'--property=WorkingDirectory='+str(W),'--property=Slice=system.slice','--property=KillMode=control-group','--property=TimeoutStopSec=10s','--property=RuntimeMaxSec=360s','--property=UMask=0077','/usr/bin/env','-i','PATH='+os.environ['PATH'],'HOME='+os.environ['HOME'],'LANG=C.UTF-8','PLAYWRIGHT_BROWSERS_PATH='+os.environ['PLAYWRIGHT_BROWSERS_PATH'],'RELAY_ICON_PYTHON='+os.environ['RELAY_ICON_PYTHON'],'PYTHONDONTWRITEBYTECODE=1',sys.executable,str(K/'interception-runner.py'),'--source',str(W/'source'),'--output',str(P/'experiment')]
 durable('prelaunch.json',{'unit':U,'description':DESC,'uid':os.getuid(),'workspace':str(W),'argv':argv,'beforeLaunch':True,'at':time.time(),'source':'abe681a2837fa4b9b5236ea34970019c0b8934d1','route':os.environ['GITHUB_SHA']})
 with (P/'runner.log').open('wb') as f:
  p=subprocess.run(argv,stdout=f,stderr=subprocess.STDOUT)
 durable('supervisor.json',{'exit':p.returncode,'unit':U,'properties':show(),'remainingPids':pids()})
 return p.returncode

def cleanup():
 intent=P/'prelaunch.json'
 if not intent.exists():
  durable('cleanup.json',{'launched':False,'ownedPids':[],'note':'No durable launch intent; no unit adopted or signalled.'});return 0
 v=json.loads(intent.read_text());assert v['unit']==U and v['description']==DESC and v['workspace']==str(W)
 s=show()
 if s.get('LoadState')!='not-found':
  assert s['Description']==DESC and s['WorkingDirectory']==str(W) and s['User'] in [str(v['uid']),'runner']
  assert s['KillMode']=='control-group'
  stop=call(['sudo','systemctl','stop',U]);assert stop['exit']==0,stop
 else:stop={'exit':0,'note':'unit already absent'}
 after=show();left=pids()
 durable('cleanup.json',{'launched':True,'unit':U,'before':s,'stop':stop,'after':after,'ownedPids':left,'acknowledged':not left and after.get('ActiveState') in ['inactive','failed',None]})
 assert not left and after.get('ActiveState') in ['inactive','failed',None],(after,left)
 return 0
if __name__=='__main__':sys.exit({'run':run,'cleanup':cleanup}[sys.argv[1]]())
