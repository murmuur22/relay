"""Real SIGTERM and controlled launch contracts, not Linux qualification."""
import json,os,signal,socket,subprocess,sys,tempfile,time,unittest
from pathlib import Path

class SafetyTests(unittest.TestCase):
 def wait_file(self,path,process):
  deadline=time.monotonic()+8
  while not path.exists() and time.monotonic()<deadline:
   if process.poll() is not None:self.fail('fixture exited before readiness: '+str(process.returncode))
   time.sleep(.01)
  self.assertTrue(path.exists(),'fixture readiness deadline')
 def exercise(self,fault,check):
  with tempfile.TemporaryDirectory() as d:
   r=Path(d)
   for n in ('old','candidate','output'):(r/n).mkdir()
   for directory in ('old','candidate'):
    for n in ('relay-release.json','relay-linux-x64.tar.gz','relay-updater-linux-x64.tar.gz'):(r/directory/n).write_bytes(b'controlled test input')
   # Listener belongs to this test parent, NOT to the signalled supervisor.
   listener=subprocess.Popen([sys.executable,'-B',str(Path(__file__).with_name('migration_listener_fixture.py')),str(r/'listener.json')])
   worker=None
   try:
    self.wait_file(r/'listener.json',listener)
    info=json.loads((r/'listener.json').read_text());info['start']=subprocess.check_output(['/bin/ps','-p',str(listener.pid),'-o','lstart='],text=True).strip();(r/'listener.json').write_text(json.dumps(info))
    worker=subprocess.Popen([sys.executable,'-B',str(Path(__file__).with_name('migration_supervisor_fixture.py')),str(r),'--fault',fault],env=dict(os.environ,PYTHONPATH=str(Path(__file__).resolve().parents[2])))
    if fault in ('signal','repeat','cleanup-error'):
     self.wait_file(r/'ready',worker);os.kill(worker.pid,signal.SIGTERM)
     if fault=='repeat':
      deadline=time.monotonic()+2
      while worker.poll() is None and time.monotonic()<deadline:
       try:os.kill(worker.pid,signal.SIGTERM)
       except ProcessLookupError:break
       time.sleep(.01)
    status=worker.wait(timeout=10)
    check(r,listener,info,status)
   finally:
    for proc in (worker,listener):
     if proc is not None and proc.poll() is None:proc.terminate();proc.wait(timeout=5)
 def test_real_sigterm_unwinds_cleanup_and_persists_failed_record(self):
  def check(r,listener,info,status):
   self.assertEqual(status,1,'SIGTERM must unwind, not exit -15 or pass')
   self.assertEqual(listener.wait(3),0)
   self.assertFalse((r/'admitted').exists());self.assertFalse((r/'installed').exists())
   with self.assertRaises(OSError):socket.create_connection(('127.0.0.1',info['port']),timeout=.2)
   report=json.loads((r/'output/execution-loopback.json').read_text())
   self.assertEqual(report['exit'],1);self.assertTrue(report['cleanup']['acknowledged'])
   self.assertTrue(json.loads((r/'failed.json').read_text())['handlerRestored'])
  self.exercise('signal',check)

 def test_repeated_real_sigterm_does_not_interrupt_cleanup(self):
  def check(r,listener,info,status):
   self.assertEqual(status,1);self.assertEqual(listener.wait(3),0)
   self.assertFalse((r/'admitted').exists());self.assertFalse((r/'migrations').exists())
   self.assertTrue(json.loads((r/'output/execution-loopback.json').read_text())['cleanup']['acknowledged'])
   self.assertTrue(json.loads((r/'failed.json').read_text())['handlerRestored'])
  self.exercise('repeat',check)

 def test_required_mount_root_exists_before_first_systemd_launch(self):
  def check(r,listener,info,status):
   self.assertEqual(status,1)
   events=[json.loads(x) for x in (r/'events.jsonl').read_text().splitlines()]
   first=next(x for x in events if x['event']=='first-systemd-launch')
   self.assertTrue(first['migrationExists'],'required ReadWritePaths root missing at launch')
   self.assertEqual(first['mode'],0o700)
   self.assertFalse((r/'migrations').exists());self.assertFalse((r/'admitted').exists())
   journal=json.loads((r/'output/ownership-loopback.json').read_text())
   self.assertIn(str(r/'migrations'),journal['paths'])
   self.assertEqual(journal['unitIntents'],['relay-migration-qualification.service'])
   self.assertTrue(journal['context']['start'])
   self.assertNotEqual(journal['context']['pid'],os.getpid())
  self.exercise('worker-failure',check)

class IndependentCleanupTests(unittest.TestCase):
 def exercise(self,fault):
  import contextlib,types,stat
  from unittest.mock import patch
  from deploy.migration_069 import qualify as q
  with tempfile.TemporaryDirectory() as d,contextlib.ExitStack() as stack:
   r=Path(d);owned=r/'owned';owned.mkdir();migration=r/'migration';output=r/'output';output.mkdir()
   args=types.SimpleNamespace(source_commit='c'*40,ack=q.ACK,mode='loopback',output=str(output))
   stack.enter_context(patch.dict(os.environ,dict(GITHUB_REF='refs/heads/main',GITHUB_RUN_ID='1',GITHUB_RUN_ATTEMPT='1')))
   ctx=dict(q.run_context(args),pid=123456,start='10')
   s=owned.lstat();binding=[s.st_dev,s.st_ino,s.st_uid,stat.S_IFMT(s.st_mode)]
   value=dict(schema=1,context=ctx,paths={str(owned):binding},users={},groups={},processes=[],intents=[str(owned)],units={},unitIntents=[q.UNIT])
   if fault=='stale':ctx['attempt']='2'
   if fault=='foreign-uid':binding[2]+=1
   if fault=='unbound-intent':value['paths']={}
   if fault=='extra-schema':value['extra']=True
   if fault=='replaced':binding[1]+=1
   if fault=='foreign-identity':value['users']={'relay':12}
   if fault in ('absent','absent-private'):
    owned.rmdir()
    if fault=='absent-private':args.mode='private-lan';ctx.update(mode=args.mode,privateLan='10.1.2.3')
   record=output/('ownership-'+args.mode+'.json');record.write_text(json.dumps(value));record.chmod(0o600)
   if fault=='missing':record.unlink()
   operations=[];loaded=fault in ('unit','foreign-unit','foreign-cgroup','stop-failure');hosts=[]
   def run(cmd,**kw):
    nonlocal loaded
    if cmd[1]=='show':
     if '--property=MainPID,ActiveState,Result' in cmd:return 'MainPID=0\nActiveState=inactive\nResult=success'
     return 'LoadState='+('loaded' if loaded else 'not-found')+'\nMainPID=0\nControlGroup='+('/foreign' if fault=='foreign-cgroup' else '/system.slice/'+q.UNIT)+'\nInvocationID='+'a'*32+'\nDescription='+('foreign' if fault=='foreign-unit' else q.unit_description(ctx))
    operations.append(cmd[1])
    if cmd[1]=='stop':
     if fault=='stop-failure':raise OSError('controlled failure')
     loaded=False
    return ''
   helper=types.SimpleNamespace(install=types.SimpleNamespace(DESTINATIONS=(),UNITS=(),run=run))
   original_stat=Path.lstat;original_read=q.c.bounded_read;original_write=q.c.write_json
   def lstat(path,*a,**kw):
    s=original_stat(path,*a,**kw)
    if path==record:return types.SimpleNamespace(st_uid=0,st_mode=s.st_mode,st_nlink=s.st_nlink)
    return s
   def absent(name):raise KeyError(name)
   def user(name):
    if fault=='foreign-identity' and name=='relay':return types.SimpleNamespace(pw_uid=13)
    return absent(name)
   for target,name,replacement in ((q,'ROOT',owned),(q,'MIGRATIONS',migration),(q,'OUTPUT',output),(q,'workflow_guard',lambda *a:None),(q,'git_inventory',lambda *a:{}),(q,'helper',lambda:helper),(q,'process_identity',lambda pid:'10' if fault=='live' else None),(q,'listener_open',lambda host,port:hosts.append(host) or fault=='listener')):
    stack.enter_context(patch.object(target,name,replacement))
   stack.enter_context(patch('pwd.getpwnam',side_effect=user));stack.enter_context(patch('grp.getgrnam',side_effect=absent))
   # Controlled non-root filesystem seam; no test claims Linux/root execution.
   stack.enter_context(patch.object(q.c,'bounded_read',side_effect=lambda p,n,owner:original_read(p,n,os.geteuid())))
   stack.enter_context(patch.object(q.c,'write_json',side_effect=lambda p,v,parent_fd=None,owner=None:original_write(p,v,parent_fd=parent_fd,owner=os.geteuid())))
   stack.enter_context(patch.object(Path,'lstat',lstat))
   success=fault in ('success','unit','absent','absent-private')
   if success:
    self.assertTrue(q.independent_cleanup(args)['acknowledged'])
    self.assertTrue(q.independent_cleanup(args)['acknowledged'],'Exact owned absence is idempotent')
    self.assertFalse(owned.exists())
    if fault=='absent-private':self.assertEqual(set(hosts),{'10.1.2.3'})
   else:
    with self.assertRaises(q.c.Refused):q.independent_cleanup(args)
    self.assertFalse(json.loads((output/('cleanup-'+args.mode+'.json')).read_text())['acknowledged'])
    self.assertTrue(owned.exists())
    if fault not in ('stop-failure','listener'):self.assertEqual(operations,[],'Validation refusal must do no cleanup operations')
 def test_exact_owned_cleanup_and_idempotent_absence(self):
  for fault in ('success','unit','absent','absent-private'):
   with self.subTest(fault=fault):self.exercise(fault)
 def test_fail_closed_stale_live_foreign_unbound_and_failure(self):
  for fault in ('stale','live','foreign-uid','replaced','unbound-intent','missing','extra-schema','foreign-identity','foreign-unit','foreign-cgroup','stop-failure','listener'):
   with self.subTest(fault=fault):self.exercise(fault)
 def test_cli_cleanup_has_actual_workflow_root_guard(self):
  from deploy.migration_069 import qualify as q
  p=subprocess.run([sys.executable,'-B','-m','deploy.migration_069.qualify','cleanup','--source-commit','c'*40,'--mode','loopback','--output',str(q.OUTPUT),'--ack',q.ACK],capture_output=True,env={'PATH':os.environ['PATH']},timeout=10)
  self.assertNotEqual(p.returncode,0);self.assertIn(b'REFUSED',p.stderr)

if __name__=='__main__':unittest.main(verbosity=2)
