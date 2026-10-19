"""Supervisor fault rehearsal with real owned PIDs/listeners, NOT Linux/systemd."""
import contextlib,hashlib,json,os,signal,socket,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest.mock import patch
from deploy.migration_069 import qualify as q

class SupervisorTests(unittest.TestCase):
 def test_cleanup_continues_other_resources_after_stop_error(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);owned=root/'owned';owned.mkdir();observed=[]
   def run(cmd,**kw):
    if 'stop' in cmd:
     observed.append(cmd[-1])
     if cmd[-1]==q.UNIT:raise OSError('injected stop acknowledgment loss')
     return ''
    if '--property=LoadState' in cmd:return 'loaded' if cmd[2]==q.UNIT else 'not-found'
    if '--property=MainPID,ControlGroup' in cmd:return 'MainPID=0\nControlGroup='
    return ''
   helper=types.SimpleNamespace(install=types.SimpleNamespace(DESTINATIONS=(str(owned),),UNITS=('fixture.service',),run=run),
     base=types.SimpleNamespace(NETWORK={'hostname':'127.0.0.1'}))
   owner=q.Ownership(helper);owner.capture()
   with patch.object(q,'ROOT',root/'absent'):
    try:clean=owner.cleanup()
    except Exception:clean={'acknowledged':False}
   self.assertFalse(clean['acknowledged'])
   self.assertIn(q.UNIT,observed)
   self.assertFalse(owned.exists(),'A failed stop must not skip unrelated owned-path cleanup')

 def test_real_supervisor_failure_cancel_and_artifact_failure_close_owned_listener(self):
  for fault in ('worker','cancel','artifact','upload'):
   with self.subTest(fault=fault),tempfile.TemporaryDirectory() as d:
    root=Path(d);work=root/'admitted';dest=root/'installed';old=root/'old';candidate=root/'candidate';output=root/'output';migration=root/'migrations'
    for p in (old,candidate,output):p.mkdir()
    for directory in (old,candidate):
     for n in ('relay-release.json','relay-release.attestation.json','relay-linux-x64.tar.gz','relay-updater-linux-x64.tar.gz'):(directory/n).write_bytes(b'synthetic dependency input')
    processes=[];ports=[];events=[]
    def identity(pid):
     if pid!=os.getpid() and not any(p.pid==pid and p.poll() is None for p in processes):return None
     return subprocess.check_output(['/bin/ps','-p',str(pid),'-o','lstart='],text=True).strip()
    def run(cmd,**kw):
     if cmd[0]=='/usr/bin/systemctl':
      action=cmd[1];unit=cmd[2] if len(cmd)>2 else ''
      if action=='start':
       p=subprocess.Popen([sys.executable,'-B',str(Path(__file__).with_name('migration_listener_fixture.py')),str(root/'listener.json')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);processes.append(p)
       deadline=time.monotonic()+5
       while not (root/'listener.json').exists() and time.monotonic()<deadline:
        if p.poll() is not None:raise RuntimeError('fixture listener failed')
        time.sleep(.01)
       info=json.loads((root/'listener.json').read_text());ports.append(info['port']);events.append('started')
       with socket.create_connection(('127.0.0.1',ports[0]),timeout=1):pass
       return ''
      if action=='stop':
       for p in processes:
        if p.poll() is None:p.terminate();p.wait(5)
       events.append('stopped');return ''
      if '--property=MainPID,ControlGroup' in cmd:return 'MainPID='+str(processes[0].pid if processes and processes[0].poll() is None else 0)+'\nControlGroup=/fixture'
      if '--property=MainPID,ActiveState,Result' in cmd:return 'MainPID=0\nActiveState=inactive\nResult=success'
      if '--property=LoadState' in cmd:return 'loaded' if any(p.poll() is None for p in processes) else 'not-found'
      return ''
     if cmd[0]=='/usr/bin/systemd-run':
      events.append('worker')
      if fault=='cancel':raise KeyboardInterrupt('synthetic cancellation')
      if fault=='worker':raise OSError('injected worker failure')
      # Deliberately incomplete failed report: cannot become a receipt or matrix pass.
      (work/'execution.json').write_text(json.dumps({'exit':1,'cases':[]}));return ''
     return ''
    def write_new(path,data,*a,**kw):
     path=Path(path)
     if output in path.parents and fault=='artifact':raise OSError('injected artifact write failure')
     path.write_text(data)
    install=types.SimpleNamespace(DESTINATIONS=(str(dest),),UNITS=('fixture.service',),FILES=('relay-release.json','relay-release.attestation.json','relay-linux-x64.tar.gz','relay-updater-linux-x64.tar.gz'),
      run=run,regular=lambda *a:None,write_new=write_new,prepare=lambda args:contextlib.nullcontext((root,{})),apply_install=lambda *a:dest.mkdir(),
      deployment_network=lambda lan:{'hostname':'127.0.0.1'})
    helper=types.SimpleNamespace(install=install,base=types.SimpleNamespace(NETWORK={'hostname':'127.0.0.1'}))
    source=q.Path(q.__file__).resolve().parents[2];n='deploy/migration_069/qualification_worker.py';p=source/n
    inventory={n:dict(mode=p.stat().st_mode&0o777,size=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())}
    args=types.SimpleNamespace(source_commit='c'*40,ack=q.ACK,mode='loopback',old_release_dir=str(old),candidate_dir=str(candidate),output=str(output))
    try:
     with patch.object(q,'ROOT',work),patch.object(q,'MIGRATIONS',migration),patch.object(q,'workflow_guard'),patch.object(q,'fresh_host'),patch.object(q,'helper',return_value=helper),patch.object(q,'git_inventory',return_value=inventory),patch.object(q,'process_identity',side_effect=identity,create=True),patch.dict(os.environ,dict(GITHUB_REF='refs/heads/main',GITHUB_SHA='c'*40,GITHUB_RUN_ID='1',GITHUB_RUN_ATTEMPT='1')):
      with self.assertRaises((q.c.Refused,OSError,KeyboardInterrupt)):q.run(args)
     if fault=='upload':
      with self.assertRaises(OSError):raise OSError('injected upload failure after supervisor return')
     self.assertEqual(len(processes),1);self.assertEqual(processes[0].returncode,0)
     self.assertFalse(dest.exists());self.assertFalse(work.exists());self.assertIn('stopped',events)
     with self.assertRaises(OSError):socket.create_connection(('127.0.0.1',ports[0]),timeout=.2)
    finally:
     for p in processes:
      if p.poll() is None:p.terminate();p.wait(5)

if __name__=='__main__':unittest.main(verbosity=2)
