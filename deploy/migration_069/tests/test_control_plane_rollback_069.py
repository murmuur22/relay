"""Permanent bounded rollback-boundary regressions; synthetic filesystem/systemctl only."""
import argparse, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import control_plane_upgrade_069 as c
import coordinator_069 as m
from test_control_plane_cli_069 import Fixture
HERE=Path(os.environ['TMPDIR'])

class RollbackTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(self.tmp.cleanup)
  self.f=Fixture(self.tmp.name)
  self.receipt=Path(m.apply(self.f.l,self.f.s,self.f.args())['receipt'])
  self.tx=self.receipt.parent
  self.backup_stat=(self.tx/'old/engine.py').stat()
  self.new=c.inventory(self.f.l.live,owner=os.getuid())
  self.live_inode=self.f.l.live.stat().st_ino
  self.before=len(self.f.mutations())
 def run_rollback(self): return m.rollback(self.f.l,self.f.s,argparse.Namespace(receipt=str(self.receipt)))
 def phase(self): return c.decode((self.tx/'phase.json').read_bytes())
 def observation(self): return c.decode((self.tx/'rollback-recovery.json').read_bytes())
 def held_stopped(self):
  self.assertEqual(self.f.l.read(self.f.l.marker,256),self.tx.name.encode()+b'\n')
  for u in m.UNITS[1:]: self.f.s.state(u,False)
  self.assertFalse(any(x[1]==m.UNITS[0] for x in self.f.mutations()))
 def exact_old(self):
  self.assertEqual(c.inventory(self.f.l.live,owner=os.getuid()),self.f.old)
  s=(self.f.l.live/'engine.py').stat(); b=self.backup_stat
  self.assertEqual((s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_mtime_ns),(b.st_dev,b.st_ino,b.st_uid,b.st_gid,b.st_mode,b.st_mtime_ns))
 def retry(self):
  self.assertEqual(self.run_rollback()['status'],'rolled-back'); self.exact_old()
  self.assertFalse(self.f.l.marker.exists()); self.assertEqual(self.phase()['phase'],'rolled-back')
  # Completion supersedes, but need not delete, the durable rename checkpoint.
  self.assertEqual(self.phase()['checkpoint'],'restoring-old')
 def fail_phase(self,names):
  original=c.TreeTransaction.phase
  def phase(t,name):
   if name in names: raise OSError('injected phase write failure')
   return original(t,name)
  return patch.object(c.TreeTransaction,'phase',phase)
 def fail_final_health(self):
  original=m.Host.health
  def health(h,kind,maintenance=True):
   if not maintenance: raise c.Refused('injected final readiness failure')
   return original(h,kind,maintenance)
  return patch.object(m.Host,'health',health)
 def test_completion_write_failure_reholds_before_stop_and_preserves_checkpoint(self):
  original=self.f.s.call; calls=[]
  def call(*args):
   if args[0]=='stop': calls.append((args[1],self.f.l.marker.exists()))
   return original(*args)
  with self.fail_phase({'rolled-back'}),patch.object(self.f.s,'call',call),self.assertRaises(OSError): self.run_rollback()
  self.held_stopped(); self.exact_old()
  self.assertTrue(all(held for _,held in calls),'every stop must occur under hold, including completion failure recovery')
  self.assertEqual(self.phase()['phase'],'recovery-uncertain-maintenance-held')
  self.assertEqual(self.phase()['checkpoint'],'restoring-old')
  self.assertEqual(self.observation()['health'],'unverified')
  self.retry()
 def test_final_readiness_failure_records_uncertainty_and_retry(self):
  with self.fail_final_health(),self.assertRaises(c.Refused): self.run_rollback()
  self.held_stopped(); self.exact_old()
  self.assertEqual(self.phase()['phase'],'recovery-uncertain-maintenance-held')
  self.assertEqual(self.phase()['checkpoint'],'restoring-old')
  self.retry()
 def partial_failure(self):
  original=c.TreeTransaction.rename
  def rename(t,src,sfd,dst,dfd):
   if src=='old': raise OSError('injected partial old restore failure')
   return original(t,src,sfd,dst,dfd)
  return patch.object(c.TreeTransaction,'rename',rename)
 def test_partial_restore_preserves_exact_backup_and_rejected_identity_for_retry(self):
  with self.partial_failure(),self.assertRaises(OSError): self.run_rollback()
  self.held_stopped(); self.assertFalse(self.f.l.live.exists())
  self.assertEqual(c.inventory(self.tx/'old',owner=os.getuid()),self.f.old)
  self.assertEqual(c.inventory(self.tx/'rejected',owner=os.getuid()),self.new)
  self.assertEqual((self.tx/'rejected').stat().st_ino,self.live_inode)
  self.assertEqual(self.phase()['phase'],'recovery-uncertain-maintenance-held')
  self.assertEqual(self.phase()['checkpoint'],'restoring-old')
  self.retry(); self.assertEqual((self.tx/'rejected').stat().st_ino,self.live_inode)
 def test_uncertainty_phase_write_failure_keeps_partial_checkpoint_and_reports_failure(self):
  with self.partial_failure(),self.fail_phase({'recovery-uncertain-maintenance-held'}),self.assertRaisesRegex(OSError,'uncertainty persistence failed'): self.run_rollback()
  self.held_stopped(); self.assertEqual(self.phase()['phase'],'restoring-old')
  self.assertEqual(self.phase()['checkpoint'],'restoring-old')
  self.assertEqual(self.observation()['health'],'unverified')
  self.retry()
 def test_completion_and_uncertainty_write_failure_no_fake_health(self):
  with self.fail_phase({'rolled-back','recovery-uncertain-maintenance-held'}),self.assertRaisesRegex(OSError,'uncertainty persistence failed'): self.run_rollback()
  self.held_stopped(); self.exact_old()
  self.assertEqual(self.phase()['phase'],'rollback-releasing-maintenance')
  self.assertEqual(self.phase()['checkpoint'],'restoring-old')
  self.retry()
 def test_uncertainty_observation_write_failure_retains_last_checkpoint(self):
  original=c.write_json
  def write(path,*a,**kw):
   if Path(path).name=='rollback-recovery.json': raise OSError('injected observation failure')
   return original(path,*a,**kw)
  with self.partial_failure(),patch.object(c,'write_json',write),self.assertRaisesRegex(OSError,'uncertainty persistence failed'): self.run_rollback()
  self.held_stopped(); self.assertEqual(self.phase()['phase'],'restoring-old'); self.retry()
 def test_final_restart_failure_stops_both_and_allows_retry(self):
  original=m.Host.start; calls=[]
  def start(h):
   calls.append(1)
   if len(calls)==2:
    h.s.call('start',m.UNITS[1]); raise c.Refused('injected partially started final restart')
   return original(h)
  with patch.object(m.Host,'start',start),self.assertRaises(c.Refused): self.run_rollback()
  self.held_stopped(); self.assertEqual(self.phase()['phase'],'recovery-uncertain-maintenance-held'); self.retry()
 def test_partial_stop_failure_attempts_both_and_records_acknowledgement_truth(self):
  self.f.put('fail-systemctl.json',json.dumps(['stop',m.UNITS[2]]).encode())
  with self.assertRaises(c.Refused): self.run_rollback()
  stops=self.f.mutations()[self.before:]
  self.assertIn(['stop',m.UNITS[1]],stops)
  obs=self.observation(); self.assertEqual(obs['services'][m.UNITS[1]],'stopped-acknowledged')
  self.assertEqual(obs['services'][m.UNITS[2]],'stop-unconfirmed')
  self.assertEqual(obs['health'],'unverified'); self.assertTrue(obs['maintenanceHeld'])
  self.assertEqual(self.phase()['phase'],'recovery-uncertain-maintenance-held')
  (self.f.root/'fail-systemctl.json').unlink(); self.retry()
 def test_rehold_failure_causes_no_continued_service_effects_or_false_hold_claim(self):
  original=m.Host.gate; calls=[]; count=[]
  def gate(h):
   count.append(1)
   if len(count)>1: raise c.Refused('injected rehold failure')
   return original(h)
  original_phase=c.TreeTransaction.phase
  def phase(t,name):
   if name=='rolled-back':
    calls.append(len(self.f.mutations())); raise OSError('injected completion write failure')
   return original_phase(t,name)
  with patch.object(m.Host,'gate',gate),patch.object(c.TreeTransaction,'phase',phase),self.assertRaisesRegex(OSError,'maintenance unconfirmed'): self.run_rollback()
  self.assertFalse(self.f.l.marker.exists()); self.assertEqual(len(self.f.mutations()),calls[-1])
  self.assertEqual(self.phase()['phase'],'recovery-uncertain-maintenance-unconfirmed')
  self.assertFalse(self.observation()['maintenanceHeld']); self.retry()
 def test_foreign_hold_refusal_before_service_or_phase_effect(self):
  self.f.put('var/lib/relay-updater-control/maintenance',b'foreign-hold\n',0o644)
  before=self.phase()
  with self.assertRaises(c.Refused): self.run_rollback()
  self.assertEqual(len(self.f.mutations()),self.before); self.assertEqual(self.phase(),before)
  self.assertEqual(self.f.l.marker.read_bytes(),b'foreign-hold\n')
 def test_preflight_drift_with_owned_hold_still_has_no_service_effect(self):
  self.f.put('var/lib/relay-updater-control/maintenance',self.tx.name.encode()+b'\n',0o644)
  self.f.put('var/lib/relay/private.json',b'changed-private-state',0o600); before=self.phase()
  with self.assertRaises(c.Refused): self.run_rollback()
  self.assertEqual(len(self.f.mutations()),self.before); self.assertEqual(self.phase(),before)
 def test_replaced_ancestor_refused_before_service_or_redirected_write(self):
  parent=self.f.l.live.parent; held=self.f.root/'opt-held'; redirect=self.f.root/'redirect'; redirect.mkdir()
  (redirect/'relay-updater').mkdir(); (redirect/'relay-updater/sentinel').write_bytes(b'foreign')
  parent.rename(held); parent.symlink_to(redirect,target_is_directory=True)
  with self.assertRaises((OSError,c.Refused)): self.run_rollback()
  self.assertEqual(len(self.f.mutations()),self.before); self.assertFalse(self.f.l.marker.exists())
  self.assertEqual(list((redirect/'relay-updater').iterdir()),[redirect/'relay-updater/sentinel'])
 def test_missing_live_uncertainty_without_rename_checkpoint_refused(self):
  with self.partial_failure(),self.assertRaises(OSError): self.run_rollback()
  value=self.phase(); value.pop('checkpoint',None); c.write_json(self.tx/'phase.json',value)
  before=len(self.f.mutations())
  with self.assertRaises(c.Refused): self.run_rollback()
  self.assertEqual(len(self.f.mutations()),before)
 def test_partial_retry_rejects_backup_or_rejected_drift_before_services(self):
  with self.partial_failure(),self.assertRaises(OSError): self.run_rollback()
  before=len(self.f.mutations())
  p=self.tx/'rejected/package.json'; old=p.read_bytes(); p.write_bytes(b'local repair')
  with self.assertRaises(c.Refused): self.run_rollback()
  self.assertEqual(len(self.f.mutations()),before)
  p.write_bytes(old)
  # Even restoring the bytes is not enough: changed mtime remains unadmitted.
  with self.assertRaises(c.Refused): self.run_rollback()
  self.assertEqual(len(self.f.mutations()),before)
 def test_completion_directory_sync_failure_keeps_checkpoint_for_uncertainty(self):
  original=os.fsync; fired=[]
  def fsync(fd):
   original(fd)
   if not fired and os.fstat(fd).st_ino==self.tx.stat().st_ino and self.phase()['phase']=='rolled-back':
    fired.append(True); raise OSError('injected completion directory sync failure after replace')
  with patch.object(os,'fsync',fsync),self.assertRaises(OSError): self.run_rollback()
  self.assertTrue(fired); self.held_stopped(); self.exact_old()
  self.assertEqual(self.phase()['phase'],'recovery-uncertain-maintenance-held')
  self.assertEqual(self.phase().get('checkpoint'),'restoring-old')
  self.retry()
 def test_completion_sync_and_uncertainty_write_failure_still_allows_owned_held_retry(self):
  original=os.fsync; fired=[]
  def fsync(fd):
   original(fd)
   if not fired and os.fstat(fd).st_ino==self.tx.stat().st_ino and self.phase()['phase']=='rolled-back':
    fired.append(True); raise OSError('injected sync failure after completion replace')
  with patch.object(os,'fsync',fsync),self.fail_phase({'recovery-uncertain-maintenance-held'}),self.assertRaisesRegex(OSError,'uncertainty persistence failed'): self.run_rollback()
  self.held_stopped(); self.exact_old()
  self.assertEqual(self.phase()['phase'],'rolled-back'); self.assertEqual(self.phase()['checkpoint'],'restoring-old')
  self.retry()
 def test_completed_rollback_without_owned_hold_refuses_repeated_service_effects(self):
  self.retry(); before=len(self.f.mutations()); phase=self.phase()
  with self.assertRaises(c.Refused): self.run_rollback()
  self.assertEqual(len(self.f.mutations()),before); self.assertEqual(self.phase(),phase)
  self.f.put('var/lib/relay-updater-control/maintenance',b'foreign-completed-hold\n',0o644)
  with self.assertRaises(c.Refused): self.run_rollback()
  self.assertEqual(len(self.f.mutations()),before)
  self.assertEqual(self.f.l.marker.read_bytes(),b'foreign-completed-hold\n')
 def test_initial_rollback_phase_write_failure_has_no_service_or_hold_effect(self):
  before=self.phase()
  with self.fail_phase({'rollback-stopping-maintenance-unverified'}),self.assertRaises(OSError): self.run_rollback()
  self.assertEqual(self.phase(),before); self.assertEqual(len(self.f.mutations()),self.before)
  self.assertFalse(self.f.l.marker.exists())
 def test_checkpoint_phase_write_failure_after_candidate_move_remains_retryable(self):
  with self.fail_phase({'restoring-old'}),self.assertRaises(OSError): self.run_rollback()
  self.held_stopped(); self.assertFalse(self.f.l.live.exists())
  self.assertEqual(self.phase()['checkpoint'],'removing-candidate'); self.retry()
 def test_candidate_rename_acknowledgement_failure_retains_exact_recovery(self):
  original=c.TreeTransaction.rename
  def rename(t,src,sfd,dst,dfd):
   original(t,src,sfd,dst,dfd)
   if dst=='rejected': raise OSError('injected failure after candidate rename')
  with patch.object(c.TreeTransaction,'rename',rename),self.assertRaises(OSError): self.run_rollback()
  self.held_stopped(); self.assertFalse(self.f.l.live.exists())
  self.assertEqual(self.phase()['checkpoint'],'removing-candidate'); self.retry()
 def test_old_rename_acknowledgement_failure_retains_exact_live_old_for_retry(self):
  original=c.TreeTransaction.rename
  def rename(t,src,sfd,dst,dfd):
   original(t,src,sfd,dst,dfd)
   if src=='old': raise OSError('injected failure after old rename')
  with patch.object(c.TreeTransaction,'rename',rename),self.assertRaises(OSError): self.run_rollback()
  self.held_stopped(); self.exact_old(); self.assertFalse((self.tx/'old').exists())
  self.assertEqual(self.phase()['checkpoint'],'restoring-old'); self.retry()
 def test_start_stage_and_uncertainty_write_failures_retain_unverified_checkpoint(self):
  with self.fail_phase({'rollback-starting-maintenance-held','recovery-uncertain-maintenance-held'}),self.assertRaisesRegex(OSError,'uncertainty persistence failed'): self.run_rollback()
  self.held_stopped(); self.exact_old()
  self.assertEqual(self.phase()['phase'],'restored'); self.assertEqual(self.phase()['checkpoint'],'restoring-old')
  self.retry()
 def test_baseexception_interruption_checkpoint_retained_and_recoverable(self):
  original=c.TreeTransaction.rename
  def rename(t,src,sfd,dst,dfd):
   if src=='old': raise KeyboardInterrupt('injected interruption between restore renames')
   return original(t,src,sfd,dst,dfd)
  with patch.object(c.TreeTransaction,'rename',rename),self.assertRaises(KeyboardInterrupt): self.run_rollback()
  self.held_stopped(); self.assertEqual(self.phase()['phase'],'restoring-old')
  self.assertEqual(self.phase()['checkpoint'],'restoring-old'); self.retry()

if __name__=='__main__': unittest.main(verbosity=2)
