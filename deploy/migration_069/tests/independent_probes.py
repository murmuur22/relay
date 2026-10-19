"""Independent adverse contract probes. Exact-byte candidate copy; no repairs."""
import argparse,contextlib,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import control_plane_upgrade_069 as c
import coordinator_069 as m
from test_control_plane_cli_069 import Fixture
import archive_069 as a
HERE=Path(os.environ['TMPDIR'])
OBS=[]
class Independent(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='rereview-',dir=HERE); self.addCleanup(self.tmp.cleanup)
  self.f=Fixture(self.tmp.name)
 def activated(self):
  r=m.apply(self.f.l,self.f.s,self.f.args()); return Path(r['receipt'])
 def record(self,label,receipt,error):
  f=self.f; tx=receipt.parent
  states=c.decode((f.root/'systemctl-state.json').read_bytes())
  old= f.l.live.exists() and c.inventory(f.l.live,owner=os.getuid())==f.old
  value=dict(probe=label,error=str(error),phase=c.decode((tx/'phase.json').read_bytes())['phase'],marker=f.l.marker.exists(),oldExact=old,liveExists=f.l.live.exists(),backupExists=(tx/'old').exists(),services={u:{k:states[u][k] for k in ('ActiveState','SubState','MainPID')} for u in m.UNITS},mutations=f.mutations())
  OBS.append(value); return value
 def test_apply_final_restart_failure_restores_exact_old(self):
  original=m.Host.start; calls=[]; f=self.f
  def start(h):
   calls.append(1)
   if len(calls)==2: raise c.Refused('independent final restart failure')
   return original(h)
  with patch.object(m.Host,'start',start),self.assertRaises(c.Refused) as e: m.apply(f.l,f.s,f.args())
  receipt=next(f.l.p(m.MIGRATIONS).glob('*/receipt.json')); v=self.record('apply-final-restart',receipt,e.exception)
  self.assertTrue(v['oldExact'] and v['marker']); self.assertEqual(v['phase'],'restored-healthy-maintenance-held')
 def test_apply_final_readiness_failure_restores_exact_old(self):
  original=m.Host.health; f=self.f
  def health(h,k,maintenance=True):
   if not maintenance: raise c.Refused('independent final readiness failure')
   return original(h,k,maintenance)
  with patch.object(m.Host,'health',health),self.assertRaises(c.Refused) as e: m.apply(f.l,f.s,f.args())
  receipt=next(f.l.p(m.MIGRATIONS).glob('*/receipt.json')); v=self.record('apply-final-readiness',receipt,e.exception)
  self.assertTrue(v['oldExact'] and v['marker']); self.assertEqual(v['phase'],'restored-healthy-maintenance-held')
 def test_apply_completion_persistence_failure_is_inside_recovery(self):
  orig=c.TreeTransaction.phase; f=self.f
  def phase(t,name):
   if name=='activated': raise OSError('independent completion persistence failure')
   return orig(t,name)
  with patch.object(c.TreeTransaction,'phase',phase),self.assertRaises(c.Refused) as e: m.apply(f.l,f.s,f.args())
  receipt=next(f.l.p(m.MIGRATIONS).glob('*/receipt.json')); v=self.record('apply-completion-persist',receipt,e.exception)
  self.assertTrue(v['oldExact'] and v['marker']); self.assertEqual(v['phase'],'restored-healthy-maintenance-held')
 def test_rollback_final_readiness_failure_must_record_uncertainty(self):
  receipt=self.activated(); original=m.Host.health
  def health(h,k,maintenance=True):
   if not maintenance: raise c.Refused('independent rollback final readiness failure')
   return original(h,k,maintenance)
  with patch.object(m.Host,'health',health),self.assertRaises(c.Refused) as e: m.rollback(self.f.l,self.f.s,argparse.Namespace(receipt=str(receipt)))
  v=self.record('rollback-final-readiness',receipt,e.exception)
  self.assertTrue(v['oldExact'] and v['marker'])
  self.assertTrue(all(s['ActiveState']=='inactive' for u,s in v['services'].items() if u in m.UNITS[1:]))
  self.assertEqual(v['phase'],'recovery-uncertain-maintenance-held','must not claim healthy held phase after failed final readiness and stopping both updater services')
 def test_rollback_partial_restore_failure_must_record_uncertainty(self):
  receipt=self.activated(); orig=c.TreeTransaction.rename
  def rename(t,src,sfd,dst,dfd):
   if src=='old': raise OSError('independent old rename failure')
   return orig(t,src,sfd,dst,dfd)
  with patch.object(c.TreeTransaction,'rename',rename),self.assertRaises(OSError) as e: m.rollback(self.f.l,self.f.s,argparse.Namespace(receipt=str(receipt)))
  v=self.record('rollback-partial-restore',receipt,e.exception)
  self.assertFalse(v['liveExists']); self.assertTrue(v['backupExists'] and v['marker'])
  self.assertTrue(all(s['ActiveState']=='inactive' for u,s in v['services'].items() if u in m.UNITS[1:]))
  self.assertEqual(v['phase'],'recovery-uncertain-maintenance-held')
 def test_rollback_completion_persistence_failure_must_rehold_and_stop(self):
  receipt=self.activated(); orig=c.TreeTransaction.phase
  def phase(t,name):
   if name=='rolled-back': raise OSError('independent rollback completion persistence failure')
   return orig(t,name)
  with patch.object(c.TreeTransaction,'phase',phase),self.assertRaises(OSError) as e: m.rollback(self.f.l,self.f.s,argparse.Namespace(receipt=str(receipt)))
  v=self.record('rollback-completion-persist',receipt,e.exception)
  self.assertTrue(v['oldExact'])
  self.assertTrue(v['marker'],'rollback completion persistence failed AFTER release: must re-hold instead of leaving active services without durable completion')
  self.assertTrue(all(s['ActiveState']=='inactive' for u,s in v['services'].items() if u in m.UNITS[1:]))
 def test_restore_replaced_live_ancestor_no_redirected_rename(self):
  receipt=self.activated(); f=self.f; t=c.TreeTransaction(f.l.live,receipt.parent,owner=os.getuid())
  self.addCleanup(t.close); parent=f.l.live.parent; held=f.root/'opt-held'; redirect=f.root/'redirect'; redirect.mkdir(); (redirect/'relay-updater').mkdir(); (redirect/'relay-updater/sentinel').write_bytes(b'preserve')
  parent.rename(held); parent.symlink_to(redirect,target_is_directory=True)
  with self.assertRaises((OSError,c.Refused)): t.restore()
  self.assertEqual((redirect/'relay-updater/sentinel').read_bytes(),b'preserve'); self.assertEqual(sorted(p.name for p in redirect.iterdir()),['relay-updater'])
  self.assertFalse((receipt.parent/'rejected').exists()); self.assertTrue((held/'relay-updater/updater').exists())
 def test_extraction_archive_replacement_after_digest_refused_before_mkdir(self):
  f=self.f; work=f.root/'work'; work.mkdir(mode=0o700); original=m.bounded_gzip
  def replace(path,*args,**kw):
   original(path,*args,**kw)
   p=Path(path); p.rename(p.with_name('held-archive')); p.write_bytes(f.archive.read_bytes()); p.chmod(0o600)
  with patch.object(m,'bounded_gzip',replace),self.assertRaises(c.Refused): m.verified_candidate(f.l,f.release,work,f.manifest_sha,f.source)
  self.assertFalse((work/'candidate').exists())
 def test_production_cli_disabled_before_systemctl_and_no_private_output(self):
  import subprocess,sys
  p=subprocess.run([sys.executable,'-B',str(c.HERE/'control_plane_upgrade_069.py'),'--systemctl','/DO-NOT-EXECUTE','rollback','--receipt','/PRIVATE-SENTINEL/receipt.json'],capture_output=True,timeout=10,env=dict(c.ENV,TMPDIR=os.environ['TMPDIR']))
  self.assertEqual(p.returncode,1); self.assertIn(b'DISABLED',p.stderr); self.assertNotIn(b'PRIVATE-SENTINEL',p.stdout+p.stderr)
 def test_malformed_configuration_cli_suppresses_private_values(self):
  f=self.f; f.put('etc/relay-updater/broker.json',b'{"PRIVATE-CONFIG-SENTINEL": NaN}',0o600)
  p=f.cli(); self.assertEqual(p.returncode,1); self.assertNotIn(b'PRIVATE-CONFIG-SENTINEL',p.stdout+p.stderr); self.assertEqual(f.mutations(),[])
