"""Real disposable filesystem/subprocess tests; never GitHub/Linux qualification."""
import argparse,contextlib,hashlib,io,json,os,subprocess,sys,tarfile,tempfile,unittest
from pathlib import Path
import control_plane_upgrade_069 as c
import coordinator_069 as m
HERE=Path(os.environ['TMPDIR'])

class Fixture:
 def __init__(self,root):
  self.root=Path(root); self.root.chmod(0o700)
  self.put('.synthetic-migration',m.FIXTURE_MARK)
  for name in ('opt/relay-updater','etc/relay-updater','etc/systemd/system','var/lib/relay','var/lib/relay-updater','var/lib/relay-updater-control','run/relay-updater-control'):
   (self.root/name).mkdir(parents=True,exist_ok=True)
  (self.root/'var/lib/relay-updater').chmod(0o700)
  self.put('opt/relay-updater/engine.py',b'actual old installed control code')
  self.old=c.inventory(self.root/'opt/relay-updater',owner=os.getuid())
  b=dict(m.FIXED,mode='production',networkMode='loopback',uiOrigin='http://localhost:4191',readinessUrl='http://localhost:4180/health/ready',relayUid=501,socketGid=502)
  self.put('etc/relay-updater/broker.json',c.canonical(b),0o600)
  self.put('etc/relay-updater/web.json',c.canonical(dict(uiOrigin=b['uiOrigin'],relayOrigin='http://localhost:4180',networkMode='loopback',socketPath=m.FIXED['socketPath'],bind='127.0.0.1')),0o644)
  self.put('etc/relay-updater/bridge.key',b'PRIVATE-SYNTHETIC-KEY-DO-NOT-PRINT'*2,0o640)
  self.put('etc/relay-updater/relay.env',b'PRIVATE-SYNTHETIC-CONFIG',0o640)
  self.put('etc/relay-updater/relay-release.json',b'{}',0o600)
  self.put('etc/relay-updater/relay-release.attestation.json',b'{}',0o600)
  self.put('var/lib/relay/private.json',b'PRIVATE-SYNTHETIC-USER-STATE',0o600)
  self.idle=dict(currentVersion='v0.6.9',job=None,history=[],previous=None,checkpoint=None)
  self.put('var/lib/relay-updater/journal.json',c.canonical(self.idle),0o600)
  self.put('var/lib/relay-updater/broker.lock',b'',0o600)
  digest='a'*64; release='opt/relay/releases/v0.6.9-'+digest[:16]
  self.put(release+'/.relay-verified.json',c.canonical(dict(mode='production',version='v0.6.9',sha256=digest)),0o600)
  self.put(release+'/package.json',b'{"version":"0.6.9"}')
  self.put(release+'/server/index.mjs',b'// synthetic runtime NOT executed')
  (self.root/'opt/relay/current').symlink_to('releases/v0.6.9-'+digest[:16])
  states={}
  for i,u in enumerate(m.UNITS):
   self.put('etc/systemd/system/'+u,('SYNTHETIC UNIT '+u).encode(),0o644)
   path,argv,user,group,wd=m.EXEC[u]
   states[u]=dict(Id=u,Names=u,LoadState='loaded',FragmentPath='/etc/systemd/system/'+u,SourcePath='',DropInPaths='',Transient='no',User=user,Group=group,WorkingDirectory=wd,
     ExecStart='{ path='+path+' ; argv[]='+argv+' ; ignore_errors=no ; pid=0 ; }',ActiveState='active',SubState='running',MainPID=str(100+i))
  self.put('systemctl-state.json',c.canonical(states),0o600)
  self.put('fixture-health.json',b'{"old":true,"new":true}',0o600)
  script='#!'+sys.executable+'\n'+'''import json,os,sys
from pathlib import Path
root=Path(__file__).parent
args=sys.argv[1:]
with (root/'systemctl-calls.jsonl').open('a') as f: f.write(json.dumps(args)+'\\n')
fail=root/'fail-systemctl.json'
if fail.exists() and json.loads(fail.read_text())==args[:2]:
 print('PRIVATE-SYNTHETIC-SERVICE-ERROR',file=sys.stderr); sys.exit(9)
p=root/'systemctl-state.json'; data=json.loads(p.read_text()); op,u=args[:2]
if op=='show':
 for k,v in data[u].items(): print(k+'='+v)
elif op in ('start','stop'):
 data[u].update(ActiveState='active' if op=='start' else 'inactive',SubState='running' if op=='start' else 'dead',MainPID='201' if op=='start' else '0')
 p.write_text(json.dumps(data))
else: sys.exit(4)
'''
  self.put('systemctl-fixture',script.encode(),0o700)
  self.l=m.Layout(self.root,True); self.s=m.Systemd(self.l,self.root/'systemctl-fixture')
  self.baseline=self.root/'reviewed-baseline.json'
  snap=m.snapshot(self.l,self.s)
  review=dict(schema=1,kind='SYNTHETIC-COMPLETE-INVENTORY-NOT-AUTHORITY',**{k:snap[k] for k in ('control','config','units','systemd')})
  self.put('reviewed-baseline.json',c.canonical(review),0o600)
  self.baseline_sha=c.sha(c.canonical(review))
  self.release=self.root/'release'; self.release.mkdir(mode=0o700)
  self.archive=self.release/'relay-updater-linux-x64.tar.gz'
  self.payload={'package.json':b'{"version":"0.6.9"}',
    'updater/broker/server.py':b'# SYNTHETIC server', 'updater/broker/engine.py':b'# SYNTHETIC engine',
    'updater/broker/auth.py':b'# SYNTHETIC auth','updater/broker/releases.py':b'# SYNTHETIC verifier',
    'updater/web/index.mjs':b'// SYNTHETIC web','updater/ui/dist/index.html':b'<html>SYNTHETIC</html>'}
  self.make_release()
 def put(self,name,raw,mode=0o644):
  path=self.root/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(raw); path.chmod(mode)
 def make_release(self,extra=None):
  with tarfile.open(self.archive,'w:gz') as tar:
   for name,raw in self.payload.items():
    entry=tarfile.TarInfo(name); entry.mode=0o644; entry.size=len(raw); tar.addfile(entry,io.BytesIO(raw))
   if extra:
    tar.addfile(extra,io.BytesIO(b''))
  art=dict(name=self.archive.name,size=self.archive.stat().st_size,sha256=c.sha(self.archive.read_bytes()))
  manifest=dict(protocol=1,repository='murmuur22/relay',version='v0.6.9',platform='linux-x64',stateSchema=1,rollbackCompatible=True,minimumNode='26.8.1',
   artifact=dict(name='relay-linux-x64.tar.gz',size=1,sha256='0'*64),updaterArtifact=art)
  raw=c.canonical(manifest); self.manifest_sha=c.sha(raw); self.source='c'*40
  (self.release/'relay-release.json').write_bytes(raw)
  (self.release/'relay-release.attestation.json').write_bytes(c.canonical(dict(kind='SYNTHETIC-FIXED-FIXTURE-NOT-GITHUB',manifestSha256=self.manifest_sha,source=self.source)))
 def plan(self): return m.inspect(self.l,self.s,self.baseline,self.baseline_sha)
 def args(self):
  return argparse.Namespace(qualification=None,reviewed_baseline=str(self.baseline),reviewed_baseline_sha256=self.baseline_sha,
   plan_sha256=self.plan()['planSha256'],release_dir=str(self.release),manifest_sha256=self.manifest_sha,source_commit=self.source)
 def cli(self,*args):
  return subprocess.run([sys.executable,'-B',str(c.HERE/'control_plane_upgrade_069.py'),'--root',str(self.root),'--synthetic-fixture','--systemctl',str(self.root/'systemctl-fixture'),*args],
   env=dict(c.ENV,PATH=os.environ['PATH'],TMPDIR=os.environ.get('TMPDIR',str(HERE))),stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
 def calls(self):
  p=self.root/'systemctl-calls.jsonl'
  return [] if not p.exists() else [json.loads(line) for line in p.read_text().splitlines()]
 def mutations(self): return [x[:2] for x in self.calls() if x[0] in ('start','stop')]

class CoordinatorTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(self.tmp.cleanup); self.f=Fixture(self.tmp.name)
 def test_cli_default_inspect_is_read_only_and_redacted(self):
  f=self.f; p=f.cli()
  self.assertEqual(p.returncode,2,p.stderr.decode())
  value=json.loads(p.stdout); self.assertFalse(value['admitted'])
  self.assertNotIn('PRIVATE-',p.stdout.decode()+p.stderr.decode())
  self.assertFalse(f.l.marker.exists()); self.assertFalse(f.l.p(m.MIGRATIONS).exists()); self.assertEqual(f.mutations(),[])
 def test_reviewed_inspect_matches_complete_snapshot_and_no_fresh_adoption(self):
  f=self.f; report=f.plan(); self.assertTrue(report['admitted'])
  self.assertEqual(report['planSha256'],c.sha(c.canonical(report['plan'])))
  (f.l.live/'local-repair').write_bytes(b'extra')
  with self.assertRaisesRegex(c.Refused,'mixed'): f.plan()
 def test_apply_real_subprocess_activation_and_protected_rollback(self):
  f=self.f; a=f.args()
  p=f.cli('apply','--reviewed-baseline',a.reviewed_baseline,'--reviewed-baseline-sha256',a.reviewed_baseline_sha256,
   '--plan-sha256',a.plan_sha256,'--release-dir',a.release_dir,'--manifest-sha256',a.manifest_sha256,'--source-commit',a.source_commit)
  self.assertEqual(p.returncode,0,p.stderr.decode()); result=json.loads(p.stdout)
  self.assertEqual(result['status'],'activated'); receipt=Path(result['receipt'])
  self.assertEqual(statmode(receipt),0o600); self.assertEqual(statmode(receipt.parent),0o700)
  self.assertEqual((f.l.live/'updater/broker/engine.py').read_bytes(),f.payload['updater/broker/engine.py'])
  self.assertEqual(c.inventory(receipt.parent/'old',owner=os.getuid()),f.old)
  self.assertFalse(f.l.marker.exists())
  self.assertEqual(f.mutations()[:4],[['stop',m.UNITS[2]],['stop',m.UNITS[1]],['start',m.UNITS[1]],['start',m.UNITS[2]]])
  self.assertFalse(any(x[1]==m.UNITS[0] for x in f.mutations()))
  p=f.cli('rollback','--receipt',str(receipt))
  self.assertEqual(p.returncode,0,p.stderr.decode()); self.assertEqual(json.loads(p.stdout)['status'],'rolled-back')
  self.assertEqual(c.inventory(f.l.live,owner=os.getuid()),f.old); self.assertFalse(f.l.marker.exists())
 def test_systemctl_nonzero_and_spoofed_identity_are_truthful(self):
  f=self.f
  f.put('fail-systemctl.json',json.dumps(['stop',m.UNITS[2]]).encode())
  with self.assertRaises(c.Refused) as ctx: f.s.stop()
  self.assertNotIn('PRIVATE-',str(ctx.exception)); self.assertEqual(f.mutations(),[['stop',m.UNITS[2]]])
  data=json.loads((f.root/'systemctl-state.json').read_bytes()); data[m.UNITS[1]]['DropInPaths']='/evil.conf'
  f.put('systemctl-state.json',c.canonical(data),0o600)
  with self.assertRaises(c.Refused): f.s.identities()
 def test_active_journal_wrong_runtime_permissions_and_extras_refused(self):
  f=self.f
  for phase in ('ready','downloading','interrupted','rollback-failed'):
   f.put('var/lib/relay-updater/journal.json',c.canonical(dict(f.idle,job={'phase':phase})),0o600)
   with self.assertRaises(c.Refused): f.plan()
  f.put('var/lib/relay-updater/journal.json',c.canonical(f.idle),0o644)
  with self.assertRaises(c.Refused): f.plan()
  f.put('var/lib/relay-updater/journal.json',c.canonical(f.idle),0o600)
  f.put('etc/relay-updater/unknown',b'unsupported')
  with self.assertRaises(c.Refused): f.plan()
 def test_target_pins_and_archive_links_refused_before_services(self):
  f=self.f; a=f.args(); a.manifest_sha256='d'*64
  with self.assertRaises(c.Refused): m.apply(f.l,f.s,a)
  self.assertEqual(f.mutations(),[]); self.assertFalse(f.l.marker.exists())
  entry=tarfile.TarInfo('escape'); entry.type=tarfile.SYMTYPE; entry.linkname='/etc/passwd'
  f.make_release(entry); a=f.args()
  with self.assertRaises(c.Refused): m.apply(f.l,f.s,a)
  self.assertEqual(f.mutations(),[]); self.assertFalse(f.l.marker.exists())
 def test_stale_plan_no_services_and_rollback_refuses_new_private_state(self):
  f=self.f; a=f.args(); f.put('var/lib/relay/private.json',b'new user changes',0o600)
  with self.assertRaises(c.Refused): m.apply(f.l,f.s,a)
  self.assertEqual(f.mutations(),[])
  a=f.args(); result=m.apply(f.l,f.s,a); before=len(f.mutations())
  f.put('var/lib/relay/private.json',b'changes after activation',0o600)
  with self.assertRaises(c.Refused): m.rollback(f.l,f.s,argparse.Namespace(receipt=result['receipt'],qualification=None))
  self.assertEqual(len(f.mutations()),before); self.assertFalse(f.l.marker.exists())
 def test_real_atomic_interruption_and_restore(self):
  f=self.f; live=f.l.live; new=f.root/'new'; new.mkdir(); (new/'engine.py').write_bytes(b'new bytes')
  tx=f.root/'transaction'; tx.mkdir(mode=0o700); t=c.TreeTransaction(live,tx,owner=os.getuid()); t.prepare(new)
  def interrupt(point):
   if point=='old-moved': raise RuntimeError('synthetic interruption')
  with self.assertRaises(RuntimeError): t.switch(interrupt)
  self.assertFalse(live.exists()); self.assertEqual(t.load('phase.json')['phase'],'moving-old')
  t=c.TreeTransaction(live,tx,owner=os.getuid()); t.restore()
  self.assertEqual(c.inventory(live,owner=os.getuid()),f.old)
  self.assertEqual(t.load('phase.json')['phase'],'restored')
 def test_broker_and_migration_lock_conflicts_preserve_held_gate(self):
  f=self.f; a=f.args()
  with m.exclusive(f.l,f.l.p('/var/lib/relay-updater/broker.lock')):
   with self.assertRaises(c.Refused): m.apply(f.l,f.s,a)
  self.assertTrue(f.l.marker.exists()); self.assertEqual(c.inventory(f.l.live,owner=os.getuid()),f.old)
 def test_rollback_refuses_changed_broker_private_state_and_runtime_process(self):
  f=self.f; result=m.apply(f.l,f.s,f.args()); before=len(f.mutations())
  f.put('var/lib/relay-updater/authority.json',b'{"private":"new authority"}',0o600)
  with self.assertRaises(c.Refused): m.rollback(f.l,f.s,argparse.Namespace(receipt=result['receipt'],qualification=None))
  self.assertEqual(len(f.mutations()),before)
  (f.root/'var/lib/relay-updater/authority.json').unlink()
  data=json.loads((f.root/'systemctl-state.json').read_bytes()); data[m.UNITS[0]]['MainPID']='987'
  f.put('systemctl-state.json',c.canonical(data),0o600)
  with self.assertRaises(c.Refused): m.rollback(f.l,f.s,argparse.Namespace(receipt=result['receipt'],qualification=None))
  self.assertEqual(len(f.mutations()),before)
 def test_missing_existing_broker_lock_is_not_adopted(self):
  f=self.f; (f.root/'var/lib/relay-updater/broker.lock').unlink()
  with self.assertRaises(c.Refused): f.plan()
  self.assertFalse((f.root/'var/lib/relay-updater/broker.lock').exists())
 def test_subprocess_output_timeout_and_nonzero_fail_closed_without_private_output(self):
  f=self.f
  for name,body in [('nonzero','import sys; print("PRIVATE-COMMAND"); sys.exit(7)'),
    ('oversize','import sys; sys.stderr.write("X"*(2*1024**2))'),('timeout','import time; time.sleep(3)')]:
   f.put(name,('#!'+sys.executable+'\n'+body+'\n').encode(),0o700)
   with self.subTest(name=name):
    with self.assertRaises(c.Refused) as ctx:
     c.command([str(f.root/name)],timeout=0.1 if name=='timeout' else 5)
    self.assertNotIn('PRIVATE-COMMAND',str(ctx.exception))
 def test_gzip_envelope_is_bounded_before_shipped_tar_verifier(self):
  import gzip
  f=self.f; path=f.root/'oversized.gz'
  path.write_bytes(gzip.compress(b'x'*4096))
  self.assertTrue(hasattr(m,'bounded_gzip'),'Missing bounded decompression envelope around shipped verifier')
  with self.assertRaises(c.Refused): m.bounded_gzip(path,max_bytes=1024)
 def test_failed_candidate_readiness_restores_actual_old_tree_and_receipt_can_rollback(self):
  f=self.f; a=f.args(); f.put('fixture-health.json',b'{"old":true,"new":false}',0o600)
  with self.assertRaisesRegex(c.Refused,'old control restored'): m.apply(f.l,f.s,a)
  self.assertEqual(c.inventory(f.l.live,owner=os.getuid()),f.old); self.assertTrue(f.l.marker.exists())
  txs=[p for p in f.l.p(m.MIGRATIONS).iterdir() if p.is_dir()]; self.assertEqual(len(txs),1)
  tx=txs[0]; self.assertEqual(c.decode((tx/'phase.json').read_bytes())['phase'],'restored-healthy-maintenance-held')
  result=m.rollback(f.l,f.s,argparse.Namespace(qualification=None,receipt=str(tx/'receipt.json')))
  self.assertEqual(result['status'],'rolled-back'); self.assertFalse(f.l.marker.exists())
 def test_coordinator_recovers_actual_between_rename_interruption_without_restarting_runtime(self):
  from unittest.mock import patch
  f=self.f; original=c.TreeTransaction.switch
  def crash(transaction):
   def checkpoint(point):
    if point=='old-moved': raise RuntimeError('actual rename interruption')
   return original(transaction,checkpoint)
  with patch.object(c.TreeTransaction,'switch',crash),self.assertRaises(c.Refused): m.apply(f.l,f.s,f.args())
  self.assertEqual(c.inventory(f.l.live,owner=os.getuid()),f.old); self.assertTrue(f.l.marker.exists())
  self.assertFalse(any(call[1]==m.UNITS[0] for call in f.mutations()))
 def test_recovery_uncertain_stays_held_when_start_fails(self):
  f=self.f; a=f.args(); f.put('fail-systemctl.json',json.dumps(['start',m.UNITS[1]]).encode())
  with self.assertRaisesRegex(c.Refused,'Recovery uncertain'): m.apply(f.l,f.s,a)
  self.assertTrue(f.l.marker.exists()); self.assertEqual(c.inventory(f.l.live,owner=os.getuid()),f.old)
 def test_metadata_receipt_substitution_and_changed_backup_refused(self):
  f=self.f; result=m.apply(f.l,f.s,f.args()); receipt=Path(result['receipt']); before=len(f.mutations())
  receipt.chmod(0o644)
  with self.assertRaises(c.Refused): m.rollback(f.l,f.s,argparse.Namespace(qualification=None,receipt=str(receipt)))
  receipt.chmod(0o600); (receipt.parent/'old/engine.py').write_bytes(b'changed old backup')
  with self.assertRaises(c.Refused): m.rollback(f.l,f.s,argparse.Namespace(qualification=None,receipt=str(receipt)))
  # Backup integrity must be checked before stopping healthy services.
  self.assertEqual(len(f.mutations()),before)
 def test_production_cannot_use_synthetic_qualification_or_nonfixed_roots(self):
  with self.assertRaises(c.Refused): m.Layout(self.f.root,False)
  with self.assertRaises(c.Refused): m.qualification(m.Layout('/'),None)


def statmode(path): return path.stat().st_mode & 0o777
if __name__=='__main__': unittest.main(verbosity=2)
