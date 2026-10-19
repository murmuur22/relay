"""Internal fixed-root pre-policy worker. Not distributed in the operator tool.

Only a fresh admission made by qualify.run plus actual systemd MainPID may enter
matrix. Old provenance remains real. The candidate target transport is explicitly
UNSIGNED source-built qualification, never described as published or attested.
"""
import contextlib
import json
import os
from pathlib import Path
import shutil
import sys
import threading
import types
from unittest.mock import patch
from . import qualify as ql, policy, build
from updater.release import presentation as fixture_presentation
import tarfile
from . import coordinator_069 as m, control_plane_upgrade_069 as c

R=ql.ROOT
FUTURE='v0.6.10'
FIXTURE_KIND='UNSIGNED-SYNTHETIC-FUTURE-NOT-A-RELEASE'
_phase='worker-admission'

def checkpoint(phase,exc=None):
 global _phase
 fields,_=ql.error_fields(exc)
 value=ql.validate_worker_diagnostic(dict(schema=1,phase=phase,**fields))
 c.write_json(R/'worker-diagnostic.json',value)
 _phase=phase

def admission(systemd=True):
 c.require(sys.platform=='linux' and os.geteuid()==0 and Path(__file__).resolve().parents[2]==R/'source',
  'Only copied root-owned disposable qualification code may run')
 raw=c.bounded_read(R/'admission.json',4*1024**2,0);mark=c.decode(raw)
 c.require(set(mark)=={'sourceCommit','sourceRef','mode','privateLan','sourceInventory','runId','runAttempt'} and
  type(mark['runId']) is int and mark['runId']>0 and type(mark['runAttempt']) is int and mark['runAttempt']>0,
  'Missing fixed fresh-workflow admission')
 policy.commit(mark['sourceCommit']);ql.check_inventory(R/'source',mark['sourceInventory'])
 c.require(not (R/'source/migration-policy.json').exists(),'Qualification must precede generated release policy')
 if systemd:
  fields=dict(x.split(':',1) for x in Path('/proc/self/status').read_text().splitlines() if ':' in x)
  c.require(fields['NoNewPrivs'].strip()=='1','Actual hardened systemd worker required')
  out=c.command(['/usr/bin/systemctl','show',ql.UNIT,'--property=MainPID,User,Group,ProtectSystem,NoNewPrivileges,ControlGroup'],env=c.ENV)
  props=dict(x.split('=',1) for x in out.splitlines())
  c.require(props['MainPID']==str(os.getpid()) and props['User']==props['Group']=='root' and
   props['ProtectSystem']=='strict' and props['NoNewPrivileges']=='yes' and props['ControlGroup'] in Path('/proc/self/cgroup').read_text(),
   'Worker process/unit hardening identity mismatch')
 return mark

def unsigned_manifest(target=c.TARGET,fixture=None):
 fixture=R/'candidate' if fixture is None else Path(fixture)
 c.require((target,fixture) in ((c.TARGET,R/'candidate'),(FUTURE,R/'future-fixture')),
  'Only fixed migration candidate or internal future fixture admitted')
 raw=c.bounded_read(fixture/'relay-release.json',1024**2,0)
 from updater.broker.releases import manifest_valid,verify_artifact
 value=manifest_valid(c.decode(raw),target)
 for key in (('artifact','updaterArtifact') if target==c.TARGET else ('artifact',)):
  verify_artifact(fixture/value[key]['name'],value[key],updater=key=='updaterArtifact')
 if target==FUTURE:
  mark=admission();_,digest=unsigned_manifest()
  metadata=c.decode(c.bounded_read(fixture/'build-metadata.json',1024**2,0))
  c.require(metadata==dict(kind=FIXTURE_KIND,version=FUTURE,baseline=c.TARGET,sourceCommit=mark['sourceCommit'],
   candidateManifestSha256=digest,artifact=value['artifact']), 'Future fixture source/case binding differs')
 return value, c.sha(raw)

def build_future_fixture():
 """Repack the exact current candidate; only canonical version/build metadata
 and the inert presentation version prefix change. Never sign or publish it.
 Reuse real extraction, presentation descriptor and tar-builder conventions.
 """
 mark=admission();manifest,digest=unsigned_manifest()
 from updater.broker.releases import extract,verify_artifact,MAX_ARCHIVE
 describe,validate=fixture_presentation.describe,fixture_presentation.validate
 output=R/'future-fixture';output.mkdir(mode=0o700)
 payload=output/'payload';extract(R/'candidate'/manifest['artifact']['name'],payload)
 package=c.decode((payload/'package.json').read_bytes())
 c.require(package['version']==c.TARGET[1:],'Fixture baseline must be the current candidate')
 # Bind executable runtime source to the admitted checkout, not a broad patch.
 code=[n for n in mark['sourceInventory'] if n.startswith('server/') or n in
  ('version.js','updater/web/broker-client.mjs','tools/icon-normalize.py')]
 c.require('server/index.mjs' in code and 'version.js' in code,'Runtime source inventory missing')
 for n in code:
  pin=mark['sourceInventory'][n];raw=(payload/n).read_bytes()
  c.require(len(raw)==pin['size'] and c.sha(raw)==pin['sha256'],'Candidate runtime source differs from admitted code')
 presentation=payload/'updater-presentation';validate(presentation,c.TARGET)
 package['version']=FUTURE[1:]
 package['qualificationFixture']=dict(kind=FIXTURE_KIND,baseline=c.TARGET,sourceCommit=mark['sourceCommit'])
 (payload/'package.json').write_bytes(c.canonical(package))
 index=presentation/'index.html';raw=index.read_bytes();prefix=('/updater/presentation/'+c.TARGET+'/').encode()
 c.require(prefix in raw,'Candidate presentation prefix missing')
 index.write_bytes(raw.replace(prefix,('/updater/presentation/'+FUTURE+'/').encode()))
 describe(presentation,FUTURE);validate(presentation,FUTURE)
 archive=output/manifest['artifact']['name']
 with archive.open('xb') as stream,tarfile.open(fileobj=stream,mode='w:gz',compresslevel=6) as bundle:
  for p in sorted(payload.rglob('*')):
   if p.is_dir():continue
   c.require(p.is_file() and not p.is_symlink(),'Unsafe synthetic build input')
   entry=tarfile.TarInfo(p.relative_to(payload).as_posix());entry.size=p.stat().st_size
   entry.mode=0o755 if p.stat().st_mode&0o111 else 0o644
   with p.open('rb') as src:bundle.addfile(entry,src)
  stream.flush();os.fsync(stream.fileno())
 c.require(archive.stat().st_size<=MAX_ARCHIVE,'Synthetic archive too large')
 import hashlib
 with archive.open('rb') as stream:
  h=hashlib.sha256()
  for chunk in iter(lambda:stream.read(65536),b''):h.update(chunk)
 artifact=dict(name=archive.name,size=archive.stat().st_size,sha256=h.hexdigest())
 value={k:v for k,v in manifest.items() if k!='updaterArtifact'};value.update(version=FUTURE,artifact=artifact)
 c.write_json(output/'relay-release.json',value)
 c.write_json(output/'build-metadata.json',dict(kind=FIXTURE_KIND,version=FUTURE,baseline=c.TARGET,
  sourceCommit=mark['sourceCommit'],candidateManifestSha256=digest,artifact=artifact))
 verify_artifact(archive,artifact);admission();c.require(unsigned_manifest()[1]==digest,'Candidate changed during fixture build')
 unsigned_manifest(FUTURE,output)
 return output

@contextlib.contextmanager
def unsigned_transport(engine,*,target=c.TARGET,fixture=None):
 """Only this in-memory engine sees the reviewed unsigned target bytes.
 The installed modules, configuration, verifier and normal discovery remain
 unchanged. Normal engine transfer/hash/extraction/service/state logic runs.
 """
 admission();fixture=R/'candidate' if fixture is None else Path(fixture)
 manifest,_=unsigned_manifest(target,fixture);module=sys.modules[type(engine).__module__]
 original=module.transfer;releases=engine.releases
 old_manifest,old_base,old_check=releases.verified_manifest,releases.base,releases.check
 old_entries,old_available=releases.entries,engine.available
 url='https://github.com/murmuur22/relay/releases/download/'+target
 def verify(version,directory,**kw):
  c.require(version==target,'Only explicit unsigned qualification target admitted')
  value,_=unsigned_manifest(target,fixture);return value
 def base(version):
  c.require(version==target,'Only unsigned qualification target transport admitted');return url
 def transfer(source,destination=None,limit=0,progress=None,cancelled=None,**kw):
  c.require(source==url+'/relay-linux-x64.tar.gz' and destination is not None and limit==manifest['artifact']['size'],
   'Unsigned qualification transport escaped fixed artifact')
  unsigned_manifest(target,fixture);total=0
  with (fixture/'relay-linux-x64.tar.gz').open('rb') as src,Path(destination).open('xb') as dst:
   while chunk:=src.read(65536):
    c.require(not cancelled or not cancelled(),'Qualification transfer cancelled');total+=len(chunk)
    c.require(total<=limit,'Target grew');dst.write(chunk)
    if progress:progress(total)
   dst.flush();os.fsync(dst.fileno())
  c.require(total==limit,'Target shortened');return b''
 entry=dict(version=target,notes=FIXTURE_KIND if target==FUTURE else 'UNSIGNED SOURCE-BUILT PRE-POLICY QUALIFICATION ONLY',size=manifest['artifact']['size'],verified=True)
 releases.entries={target:entry};engine.available=[entry]
 releases.verified_manifest=verify;releases.base=base;releases.check=lambda work:[entry]
 module.transfer=transfer
 try:yield manifest
 finally:
  module.transfer=original;releases.verified_manifest=old_manifest;releases.base=old_base;releases.check=old_check
  releases.entries=old_entries;engine.available=old_available

@contextlib.contextmanager
def coordinator_adapter(layout,source):
 """Not policy admission: exact fixed-root Coordinator in guarded test context.
 No operator CLI/environment flag reaches this path. No policy file is created.
 """
 mark=admission();manifest,digest=unsigned_manifest()
 c.require(source==mark['sourceCommit'] and type(layout) is m.Layout and not layout.synthetic and layout.root==Path('/'),
  'Pre-policy Coordinator adapter confined to admitted disposable fixed root')
 def qualified(l,*unused):
  admission();c.require(l is layout,'Wrong qualification layout')
  return dict(target=dict(version=c.TARGET,sourceCommit=source),runtimeArtifact=manifest['artifact'],manifestSha256=digest)
 def candidate(l,release_dir,work,manifest_sha,target_source):
  qualified(l);c.require(Path(release_dir)==R/'candidate' and manifest_sha==digest and target_source==source,'Wrong unsigned source binding')
  value,current=unsigned_manifest();c.require(current==digest,'Unsigned input changed')
  mod=m.verifier_module();archive=R/'candidate/relay-updater-linux-x64.tar.gz'
  expected=m.verify_archive(l,archive,value['updaterArtifact'],mod.artifact_valid)
  m.bounded_gzip(archive,owner=0)
  with c.pinned(Path(work),0) as fd:m.extract_archive(l,archive,Path(work)/'candidate',fd,expected)
  return Path(work)/'candidate'
 with patch.object(m,'qualification',side_effect=qualified),patch.object(m,'verified_candidate',side_effect=candidate):
  yield digest

def serve_engine(q,Engine,Broker,password,action,*,target=c.TARGET,fixture=None):
 """Reuse the existing lifecycle/HTTP producer, retaining installed module imports."""
 admission() # Refuse before stopping even the broker, not just before transfer.
 unsigned_manifest(target,fixture) # Reject wrong fixture/version before any service mutation.
 q.install.run(['/usr/bin/systemctl','stop',m.UNITS[1]])
 engine=broker=thread=None
 try:
  engine=Engine(json.loads(Path('/etc/relay-updater/broker.json').read_text()))
  with unsigned_transport(engine,target=target,fixture=fixture):
   broker=Broker(engine);thread=threading.Thread(target=broker.serve_forever,kwargs={'poll_interval':0.1},daemon=True);thread.start()
   q.base.wait_control();cookie,csrf=q.base.authenticate(password);monitor=q.base.launch_monitor(cookie,csrf)
   return action(engine,cookie,csrf,monitor)
 finally:
  # A failed helper cleanup must not skip restoration of the installed broker.
  # Any cleanup/readiness error still propagates; never report healthy success.
  try:
   try:
    if broker:
     try:
      broker.shutdown();thread.join(10);c.require(not thread.is_alive(),'Broker helper did not acknowledge exit')
     finally:broker.server_close()
   finally:
    if engine:
     engine.close();c.require(not engine.thread or not engine.thread.is_alive(),'Engine helper did not exit')
  finally:
   q.install.run(['/usr/bin/systemctl','start',m.UNITS[1]]);q.base.wait_control()

def old_cycle(q,password):
 Engine,Broker=q.load_installed('v0.6.4')
 protected=[Path('/opt/relay-updater'),Path('/etc/relay-updater'),*(Path('/etc/systemd/system')/u for u in m.UNITS)]
 before={str(p):q.fingerprint(p) for p in protected};web=q.base.service_identity(m.UNITS[2])
 state_paths=(Path('/var/lib/relay/accounts.json'),Path('/var/lib/relay/users'))
 def private_state():return {str(p):q.fingerprint(p) for p in state_paths}
 state=private_state()
 def action(engine,cookie,csrf,monitor):
  status,index,_=q.base.raw_http(4191,'/updater/')
  c.require(status==200 and index==Path('/opt/relay-updater/updater/ui/dist/index.html').read_bytes(),'Actual archived stock old UI not served')
  for expected in (c.TARGET,'v0.6.4',c.TARGET):
   if expected==c.TARGET:
    job=q.mutate('install',cookie,monitor,password,version=c.TARGET);phase='succeeded'
   else:
    # Real normal HTTP rollback through the archived old API, then prune only
    # obsolete candidate using the unchanged old engine before repeat install.
    job=q.mutate('rollback',cookie,monitor,password);phase='rolled-back'
   result=q.wait_job(monitor,job,phase,cookie=cookie)
   engine.thread.join(30);c.require(not engine.thread.is_alive(),'Old engine worker exit not acknowledged')
   q.base.ready(expected,False);c.require(result['currentVersion']==expected,'Old engine runtime result differs')
   c.require(private_state()==state,'Old runtime update/recovery changed matching private state')
   cookie,csrf=q.base.authenticate(password)
   if expected=='v0.6.4':engine.prune()
  # Genuine production-mode receipt generated by the real engine. Target is
  # explicitly unsigned in this harness; this file is NOT publication provenance.
  manifest,_=unsigned_manifest()
  c.require(json.loads((engine.current_release()/'.relay-verified.json').read_text())==
   dict(mode='production',version=c.TARGET,sha256=manifest['artifact']['sha256']),'Engine target receipt differs')
 serve_engine(q,Engine,Broker,password,action)
 c.require({str(p):q.fingerprint(p) for p in protected}==before and q.base.service_identity(m.UNITS[2])==web,
  'Old upgrade/recovery changed control-plane/config/units/web process')

class Matrix:
 def __init__(self,mark):
  self.mark=mark;self.q=ql.helper();self.q.base.NETWORK=self.q.install.deployment_network(mark['privateLan'])
  self.layout=m.Layout();self.system=m.Systemd(self.layout);self.cases=[];self.last_receipt=None
 def case(self,code,fn):
  c.require(code in ql.CASES and code not in {x['code'] for x in self.cases},'Unknown/duplicate scenario code')
  try:fn()
  except Exception:self.cases.append(dict(code=code,exit=1));raise
  self.cases.append(dict(code=code,exit=0))
 def inspect(self):return m.inspect(self.layout,self.system)
 def args(self):
  report=self.inspect();c.require(report['admitted'],'Stock old control not admitted in qualification')
  _,digest=unsigned_manifest()
  return types.SimpleNamespace(reviewed_baseline=None,reviewed_baseline_sha256=None,plan_sha256=report['planSha256'],
   source_commit=self.mark['sourceCommit'],manifest_sha256=digest,release_dir=str(R/'candidate'))
 def apply(self):
  value=m.apply(self.layout,self.system,self.args());self.last_receipt=Path(value['receipt'])
  c.require(value['status']=='activated' and not self.layout.marker.exists(),'Actual control activation incomplete')
 def rollback(self):
  c.require(self.last_receipt is not None,'No protected transaction to roll back')
  value=m.rollback(self.layout,self.system,types.SimpleNamespace(receipt=str(self.last_receipt)))
  c.require(value['status']=='rolled-back' and not self.layout.marker.exists(),'Matching control restore incomplete')
 def refuse(self,fn):
  try:fn()
  except (c.Refused,OSError,ValueError):return
  raise c.Refused('Required refusal did not occur')
 def no_write_inspect(self):
  before=m.snapshot(self.layout,self.system);marker=self.layout.marker.exists();r=self.inspect()
  c.require(r['admitted'] and before==m.snapshot(self.layout,self.system) and marker==self.layout.marker.exists(),'Inspect wrote or drifted')
 def failure_restore(self,completion=False):
  args=self.args();before=m.snapshot(self.layout,self.system);root=m.migration_root(self.layout);prior=set(root.iterdir())
  if completion:
   real=c.TreeTransaction.phase;fired=[]
   def phase(tx,value,**kw):
    if value=='activated' and not fired:fired.append(True);raise OSError('injected final completion persistence failure')
    return real(tx,value,**kw)
   ctx=patch.object(c.TreeTransaction,'phase',phase)
  else:
   real=m.Host.health;fired=[]
   def health(host,kind,maintenance=True):
    if kind=='new' and not fired:
     fired.append(True);host.s.call('stop',m.UNITS[2]) # actual candidate service health failure
    return real(host,kind,maintenance)
   ctx=patch.object(m.Host,'health',health)
  with ctx:self.refuse(lambda:m.apply(self.layout,self.system,args))
  c.require(bool(fired),'Failure hook did not execute')
  added=[p for p in root.iterdir() if p not in prior and p.is_dir()]
  c.require(len(added)==1,'Failure transaction identity missing');self.last_receipt=added[0]/'receipt.json'
  c.require(c.inventory(self.layout.live,owner=0)==before['control'] and self.layout.marker.read_bytes()==added[0].name.encode()+b'\n',
   'Failure did not retain exact old control under owned maintenance')
  m.Host(self.layout,self.system,before,added[0]).preserved()
  self.rollback()
 def rollback_uncertainty(self):
  self.apply();real=c.TreeTransaction.phase;fired=[]
  def phase(tx,value,**kw):
   if value=='rolled-back' and not fired:fired.append(True);raise OSError('injected rollback completion persistence failure')
   return real(tx,value,**kw)
  with patch.object(c.TreeTransaction,'phase',phase):self.refuse(self.rollback)
  c.require(fired and self.layout.marker.read_bytes()==self.last_receipt.parent.name.encode()+b'\n','Rollback uncertainty lost owned hold')
  self.rollback()
 def drift(self,private=False):
  self.apply();p=Path('/var/lib/relay')/'qualification-state-drift' if private else self.layout.live/'qualification-code-drift'
  uid=self.q.base.pwd.getpwnam('relay').pw_uid if private else 0
  p.write_bytes(b'disposable drift\n');os.chown(p,uid,uid);p.chmod(0o600)
  before={u:self.q.base.service_identity(u) for u in m.UNITS}
  try:
   self.refuse(self.rollback)
   c.require(p.exists() and before=={u:self.q.base.service_identity(u) for u in m.UNITS} and not self.layout.marker.exists(),'Drift refusal mutated services/state')
  finally:p.unlink()
  self.rollback()
 def corrupt(self):
  self.apply();p=self.last_receipt.parent/'old.json';raw=p.read_bytes();before={u:self.q.base.service_identity(u) for u in m.UNITS}
  p.write_bytes(b'{}')
  try:
   self.refuse(self.rollback);c.require(before=={u:self.q.base.service_identity(u) for u in m.UNITS},'Corrupt-metadata refusal restarted service')
  finally:p.write_bytes(raw)
  self.rollback()
 def foreign(self):
  before={u:self.q.base.service_identity(u) for u in m.UNITS};self.layout.marker.write_bytes(b'foreign-hold\n');self.layout.marker.chmod(0o644)
  try:
   self.refuse(self.args);c.require(self.layout.marker.read_bytes()==b'foreign-hold\n' and before=={u:self.q.base.service_identity(u) for u in m.UNITS},'Foreign hold adopted')
  finally:self.layout.marker.unlink()
 def active_job(self):
  # Stop broker for a bounded private journal perturbation; never race live writes.
  self.q.install.run(['/usr/bin/systemctl','stop',m.UNITS[1]])
  p=Path('/var/lib/relay-updater/journal.json');raw=p.read_bytes();value=json.loads(raw)
  value['job']=dict(id='e'*32,phase='downloading');p.write_text(json.dumps(value));p.chmod(0o600)
  try:self.refuse(lambda:m.snapshot(self.layout,self.system))
  finally:p.write_bytes(raw);self.q.install.run(['/usr/bin/systemctl','start',m.UNITS[1]]);self.q.base.wait_control()
 def protected(self):
  before=m.snapshot(self.layout,self.system);runtime=self.q.base.service_identity(m.UNITS[0]);self.apply()
  now=m.snapshot(self.layout,self.system,include_control=False)
  c.require(all(before[k]==now[k] for k in ('config','units','systemd','runtime','state','journal','brokerState','runtimePID')) and
   runtime==self.q.base.service_identity(m.UNITS[0]),'Migration changed protected state/config/keys/journal/runtime/unit identity')
  self.rollback()
 def staged_http(self,engine,cookie,csrf,monitor,password):
  """Real HTTP only: the live 069 Relay signs prepare AND explicit Apply.
  Engine journal/checkpoint changes here are intentional. This is the last case:
  never attempt Coordinator restore against its pre-stage private inventory.
  """
  import time
  q=self.q;q.base.ready(c.TARGET,False)
  c.require(engine.data['currentVersion']==c.TARGET,'Staging requires live current candidate, never old authority')
  baseline=engine.current_release();runtime=q.base.service_identity(m.UNITS[0]);web=q.base.service_identity(m.UNITS[2])
  state=q.fingerprint('/var/lib/relay');self.lifecycle=[]
  def checkpoint(label):
   # Private fixed-root evidence; supervisor never uploads hashes/state/credentials.
   self.lifecycle.append(dict(phase=label,runtime=q.base.service_identity(m.UNITS[0]),
    state=q.fingerprint('/var/lib/relay'),brokerState=q.fingerprint('/var/lib/relay-updater'),journal=json.loads(json.dumps(engine.data))))
   c.write_json(R/'private-lifecycle.json',self.lifecycle)
  def auth():
   status,value,_=q.base.http(4191,'/updater/api/auth',cookie=cookie+'; '+monitor)
   c.require(status==200 and value.get('authenticated') is True and value.get('csrf'),'Staged HTTP authentication lost')
   return value['csrf']
  checkpoint('live-069-before-prepare')
  status,index,_=q.base.raw_http(4191,'/updater/')
  c.require(status==200 and b'<html' in index.lower(),'Actual migrated UI route unavailable')
  status,result,_=q.base.http(4191,'/updater/api/prepare','POST',dict(version=FUTURE,confirmed=True,password=password),cookie+'; '+monitor,auth())
  c.require(status==200 and result.get('job',{}).get('id'),'Genuine HTTP prepare rejected');job=result['job']['id']
  deadline=time.monotonic()+420
  while time.monotonic()<deadline:
   status,result,_=q.base.monitor_state(cookie,monitor);c.require(status==200,'Staged monitoring failed')
   current=result.get('job') or {};c.require(current.get('id')==job,'Staged job identity drift')
   if current.get('phase')=='ready':break
   c.require(current.get('phase') not in ('failed','cancelled','rollback-failed','interrupted'),'Preparation failed');time.sleep(0.25)
  else:raise c.Refused('Preparation timed out')
  engine.thread.join(30)
  c.require(not engine.thread.is_alive() and runtime==q.base.service_identity(m.UNITS[0]) and state==q.fingerprint('/var/lib/relay') and
   not self.layout.marker.exists() and engine.data['currentVersion']==c.TARGET and not engine.data.get('checkpoint'),
   'Prepare changed runtime/private state or activated automatically')
  q.base.ready(c.TARGET,False);checkpoint('ready-with-live-069')
  status,result,_=q.base.http(4191,'/updater/api/apply','POST',dict(jobId=job,version=FUTURE,confirmed=True,password=password),cookie+'; '+monitor,auth())
  c.require(status==200,'Fresh-password/CSRF Apply rejected');result=q.wait_job(monitor,job,'succeeded',cookie=cookie)
  engine.thread.join(30);c.require(not engine.thread.is_alive(),'Apply worker exit not acknowledged');q.base.ready(FUTURE,False)
  c.require(result['currentVersion']==FUTURE and state==q.fingerprint('/var/lib/relay') and
   runtime!=q.base.service_identity(m.UNITS[0]) and web==q.base.service_identity(m.UNITS[2]),'Apply runtime/state/service identity mismatch')
  checkpoint('synthetic-future-applied')
  # Runtime restart invalidates Relay sessions, not the independent monitor.
  c.require(q.base.http(4180,'/api/session',cookie=cookie)[0]==401,'Old runtime session survived Apply')
  cookie,csrf=q.base.authenticate(password)
  job=q.mutate('rollback',cookie,monitor,password);result=q.wait_job(monitor,job,'rolled-back',cookie=cookie)
  engine.thread.join(30);c.require(not engine.thread.is_alive(),'Rollback worker exit not acknowledged');q.base.ready(c.TARGET,False)
  c.require(result['currentVersion']==c.TARGET and engine.current_release()==baseline and state==q.fingerprint('/var/lib/relay') and
   web==q.base.service_identity(m.UNITS[2]) and not self.layout.marker.exists(),'Rollback did not restore matching 069 runtime/state')
  cookie,csrf=q.base.authenticate(password);checkpoint('matching-069-restored')
 def staged(self,password):
  self.apply();self.q.base.ready(c.TARGET,False)
  fixture=build_future_fixture()
  # Resolve the genuinely migrated installation, never checkout engine aliases.
  root=Path('/opt/relay-updater')
  c.require(c.decode((root/'package.json').read_bytes())['version']==c.TARGET[1:],'Wrong migrated control plane')
  for name in tuple(sys.modules):
   if name=='updater' or name.startswith('updater.'):del sys.modules[name]
  sys.path.insert(0,str(root))
  from updater.broker.engine import Engine
  from updater.broker.server import Broker
  for name,module in tuple(sys.modules.items()):
   if name.startswith('updater.') and getattr(module,'__file__',None):
    c.require(root in Path(module.__file__).resolve().parents,'Checkout updater import refused')
  serve_engine(self.q,Engine,Broker,password,lambda *args:self.staged_http(*args,password),target=FUTURE,fixture=fixture)
 def execute(self):
  import secrets
  q=self.q
  checkpoint('worker-control-wait');q.base.wait_control()
  checkpoint('worker-gated-ready');q.base.ready('v0.6.4',True)
  checkpoint('worker-ungate');q.base.ungate()
  checkpoint('worker-broker-restart');q.install.run(['/usr/bin/systemctl','restart',m.UNITS[1]])
  checkpoint('worker-control-rewait');q.base.wait_control()
  checkpoint('worker-ready');q.base.ready('v0.6.4',False)
  checkpoint('worker-enrollment')
  password=secrets.token_urlsafe(40);secret=R/'password';q.install.write_new(secret,password)
  cookie,csrf=q.base.authenticate(password)
  checkpoint('worker-matrix')
  self.case('stock-old-provenance',lambda:build.verify_old(R/'old'))
  self.case('ordinary-old-ui-runtime-upgrade',lambda:old_cycle(q,password))
  # old_cycle includes actual old-HTTP rollback then target re-install; no staged
  # UI on old backend. Assert the archived UI is still the retained old bytes.
  def archived():
   status,index,_=q.base.raw_http(4191,'/updater/')
   c.require(status==200 and index==Path('/opt/relay-updater/updater/ui/dist/index.html').read_bytes(),'Archived old UI unavailable after recovery')
   q.base.ready(c.TARGET,False)
  self.case('archived-old-ui-recovery',archived)
  with coordinator_adapter(self.layout,self.mark['sourceCommit']):
   self.case('inspect-no-write',self.no_write_inspect)
   self.case('apply',self.apply);self.case('rollback',self.rollback)
   self.case('activation-failure-restore',self.failure_restore)
   self.case('final-release-failure-restore',lambda:self.failure_restore(True))
   self.case('rollback-uncertainty-retry',self.rollback_uncertainty)
   self.case('drift-refusal',self.drift)
   self.case('protected-state-preserved',self.protected)
   self.case('service-identities',q.base.isolation)
   self.case('active-job-refusal',self.active_job)
   self.case('foreign-hold-refusal',self.foreign)
   self.case('corrupt-metadata-refusal',self.corrupt)
   self.case('private-state-drift-refusal',lambda:self.drift(True))
   self.case('staged-prepare-apply',lambda:self.staged(password))
  secret.unlink()

def main():
 c.require(len(sys.argv)==2 and sys.argv[1] in ('verify-old','matrix'),'Internal fixed worker command required')
 if sys.argv[1]=='verify-old':
  admission(False);build.verify_old(R/'old');return
 # Fixed copied-root guard precedes diagnostic writes, too. No local opt-in.
 c.require(sys.platform=='linux' and os.geteuid()==0 and Path(__file__).resolve().parents[2]==R/'source','Fixed copied worker required')
 try:
  checkpoint('worker-admission');mark=admission()
  checkpoint('worker-construction');matrix=Matrix(mark)
  checkpoint('worker-closure')
  report=dict(schema=1,kind='relay-migration-prepolicy-execution',sourceCommit=mark['sourceCommit'],sourceRef=mark['sourceRef'],
   mode=mark['mode'],baseline=policy.BASELINE,closure=policy.closure(),sourceInventory=mark['sourceInventory'],cases=matrix.cases,exit=1,
   cleanup=dict(acknowledged=False,forced=False,remainingUnits=[],remainingPids=[],remainingPaths=[],remainingIdentities=[]))
  try:matrix.execute();checkpoint('worker-complete');report['exit']=0
  finally:c.write_json(R/'execution.json',report)
 except Exception as exc:
  checkpoint(_phase,exc);raise

if __name__=='__main__':
 try:main()
 except Exception:
  print('REFUSED: internal pre-policy qualification failed; private details suppressed; no Linux pass claimed.',file=sys.stderr);sys.exit(1)
