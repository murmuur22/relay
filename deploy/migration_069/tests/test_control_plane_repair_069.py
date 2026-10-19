"""Repair regressions; only owned synthetic files and subprocesses."""
import argparse, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import control_plane_upgrade_069 as c
import coordinator_069 as m
from test_control_plane_cli_069 import Fixture
HERE=Path(os.environ['TMPDIR'])

class RepairTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name); self.f=Fixture(self.root)
 def tx(self):
  return next(p for p in self.f.l.p(m.MIGRATIONS).iterdir() if p.is_dir())
 def test_final_restart_failure_restores_old_and_records_held_health(self):
  f=self.f; original=m.Host.start; calls=[]
  def start(h):
   calls.append(1)
   if len(calls)==2: raise c.Refused('final restart failed')
   return original(h)
  with patch.object(m.Host,'start',start),self.assertRaisesRegex(c.Refused,'old control restored'):
   m.apply(f.l,f.s,f.args())
  self.assertEqual(c.inventory(f.l.live,owner=os.getuid()),f.old)
  self.assertTrue(f.l.marker.exists())
  self.assertEqual(c.decode((self.tx()/'phase.json').read_bytes())['phase'],'restored-healthy-maintenance-held')
 def test_final_health_then_restore_failure_stops_and_records_uncertainty(self):
  f=self.f; original=m.Host.health
  def health(h,k,maintenance=True):
   if not maintenance: raise c.Refused('final health failed')
   return original(h,k,maintenance)
  with patch.object(m.Host,'health',health),patch.object(c.TreeTransaction,'restore',side_effect=c.Refused('restore failed')):
   with self.assertRaisesRegex(c.Refused,'Recovery uncertain'): m.apply(f.l,f.s,f.args())
  self.assertTrue(f.l.marker.exists())
  states=c.decode((self.root/'systemctl-state.json').read_bytes())
  self.assertTrue(all(states[u]['ActiveState']=='inactive' and states[u]['SubState']=='dead' for u in m.UNITS[1:]),'failed old readiness must stop both updater services')
  self.assertEqual(c.decode((self.tx()/'phase.json').read_bytes())['phase'],'recovery-uncertain-maintenance-held')
 def test_old_readiness_failure_stops_both_and_records_uncertainty(self):
  f=self.f
  with patch.object(m.Host,'health',side_effect=c.Refused('all health failed')):
   with self.assertRaisesRegex(c.Refused,'Recovery uncertain'): m.apply(f.l,f.s,f.args())
  self.assertEqual(c.inventory(f.l.live,owner=os.getuid()),f.old)
  self.assertTrue(f.l.marker.exists())
  states=c.decode((self.root/'systemctl-state.json').read_bytes())
  self.assertTrue(all(states[u]['ActiveState']=='inactive' and states[u]['SubState']=='dead' for u in m.UNITS[1:]),'failed old readiness must stop both updater services')
  self.assertEqual(c.decode((self.tx()/'phase.json').read_bytes())['phase'],'recovery-uncertain-maintenance-held')
 def test_phase_replaced_real_directory_binding_refuses_before_write(self):
  f=self.f; tx=self.root/'tx'; tx.mkdir(mode=0o700)
  t=c.TreeTransaction(f.l.live,tx,owner=os.getuid())
  tx.rename(self.root/'held-tx'); tx.mkdir(mode=0o700)
  try: t.phase('must-not-write')
  except (OSError,c.Refused): pass
  self.assertEqual(list(tx.iterdir()),[],'phase must use original held parent and refuse replacement')
  self.assertEqual(list((self.root/'held-tx').iterdir()),[])
 def test_publication_replaced_live_parent_cannot_mutate_redirect(self):
  f=self.f; tx=self.root/'tx'; tx.mkdir(mode=0o700); new=self.root/'new'; new.mkdir(); (new/'engine.py').write_bytes(b'new')
  t=c.TreeTransaction(f.l.live,tx,owner=os.getuid()); t.prepare(new)
  original=f.l.live.parent; redirected=self.root/'redirect'; redirected.mkdir(); (redirected/'relay-updater').mkdir()
  (redirected/'relay-updater/sentinel').write_bytes(b'must preserve')
  def swap(point):
   if point=='moving-old': original.rename(self.root/'held-opt'); original.symlink_to(redirected,target_is_directory=True)
  with self.assertRaises((OSError,c.Refused)): t.switch(swap)
  self.assertTrue((redirected/'relay-updater/sentinel').is_file(),'publication must not move the redirected tree')
  self.assertEqual((redirected/'relay-updater/sentinel').read_bytes(),b'must preserve')
  self.assertEqual(list(redirected.iterdir()),[redirected/'relay-updater'])
  self.assertFalse((tx/'old').exists())
 def test_staging_replaced_transaction_refuses_before_copy(self):
  f=self.f; tx=self.root/'tx'; tx.mkdir(mode=0o700); new=self.root/'new'; new.mkdir(); (new/'engine.py').write_bytes(b'new')
  t=c.TreeTransaction(f.l.live,tx,owner=os.getuid()); tx.rename(self.root/'held-tx')
  redirected=self.root/'redirect'; redirected.mkdir(); tx.symlink_to(redirected,target_is_directory=True)
  with self.assertRaises((OSError,c.Refused)): t.prepare(new)
  self.assertEqual(list(redirected.iterdir()),[])
 def test_copy_protected_replaced_destination_ancestor_refuses(self):
  f=self.f; parent=self.root/'dest'; parent.mkdir(); other=self.root/'redirect'; other.mkdir()
  with c.pinned(parent,os.getuid()):
   parent.rename(self.root/'held-dest'); parent.symlink_to(other,target_is_directory=True)
   with self.assertRaises((OSError,c.Refused)):
    m.copy_protected(f.l,f.root/'reviewed-baseline.json',parent/'input',1024**2)
  self.assertEqual(list(other.iterdir()),[])
 def test_production_policy_never_reads_local_qualification(self):
  with patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=0),patch.dict(os.environ,{'RELAY_MIGRATION_QUALIFIED':'1'}):
   with patch.object(m,'protected_receipt',side_effect=AssertionError('must not read')):
    with self.assertRaises(c.Refused): m.qualification(m.Layout('/'),self.root/'caller.json')
  with self.assertRaises(c.Refused): m.Layout('/',True)
 def test_production_baseline_refuses_even_exact_self_authored_snapshot(self):
  f=self.f; snap=m.snapshot(f.l,f.s)
  fake=argparse.Namespace(synthetic=False,read=f.l.read)
  with self.assertRaises(c.Refused): m.reviewed(fake,f.baseline,f.baseline_sha,snap)
 def test_cli_removed_qualification_flag(self):
  p=self.f.cli('apply','--help')
  self.assertEqual(p.returncode,0)
  self.assertNotIn('--qualification',p.stdout.decode())

if __name__=='__main__': unittest.main(verbosity=2)
