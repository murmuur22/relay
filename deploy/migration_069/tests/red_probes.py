"""Minimal security-contract red probes, unchanged candidate code in reviewer copy."""
import argparse,contextlib,json,os,shutil,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
R=Path(os.environ['TMPDIR'])
# Honor the caller's canonical scratch TMPDIR; do not reset the test harness.
tempfile.tempdir=os.environ.get('TMPDIR',str(R))
sys.path.insert(0,str(R))
import control_plane_upgrade_069 as c
import coordinator_069 as m
from test_control_plane_cli_069 import Fixture
OWNED=[]
class RedProbes(unittest.TestCase):
 def setUp(self):
  self.root=Path(tempfile.mkdtemp(prefix='owned-red-',dir=R)); self.ident=(self.root.stat().st_dev,self.root.stat().st_ino)
  OWNED.append({'path':str(self.root),'identity':list(self.ident)})
  self.addCleanup(self.cleanup_owned)
 def cleanup_owned(self):
  self.assertEqual((self.root.lstat().st_dev,self.root.lstat().st_ino),self.ident)
  shutil.rmtree(self.root)
 def test_self_asserted_baseline_must_not_admit_arbitrary_old_code(self):
  f=Fixture(self.root); f.put('opt/relay-updater/unreviewed-root-code.py',b'arbitrary extra root code')
  snap=m.snapshot(f.l,f.s)
  v=dict(schema=1,kind='explicit-reviewed-complete-inventory',reviewId='0'*64,**{k:snap[k] for k in ('control','config','units','systemd')})
  f.put('reviewed-baseline.json',c.canonical(v),0o600); f.baseline_sha=c.sha(c.canonical(v))
  with self.assertRaises(c.Refused,msg='Self-authored inventory and arbitrary reviewId are not independent review authority'):
   f.plan()
 def test_invented_qualification_evidence_must_be_refused(self):
  f=Fixture(self.root)
  f.put('invented.json',c.canonical(dict(schema=1,kind='PARENT-REVIEWED-LINUX-SYSTEMD-MIGRATION',source=m.source_digests(),loopbackEvidenceSha256='0'*64,privateLanEvidenceSha256='0'*64,reviewSha256='0'*64)),0o600)
  l=argparse.Namespace(synthetic=False,owner=os.getuid(),read=f.l.read)
  with patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=0):
   with self.assertRaises(c.Refused,msg='Simulated production predicate must not turn invented evidence into qualification'):
    m.qualification(l,self.root/'invented.json')
 def test_final_release_readiness_failure_must_restore_old_code(self):
  f=Fixture(self.root); original=m.Host.health
  def fail_final(host,kind,maintenance=True):
   if not maintenance: raise c.Refused('injected final release readiness failure')
   return original(host,kind,maintenance)
  with patch.object(m.Host,'health',fail_final),self.assertRaises(c.Refused): m.apply(f.l,f.s,f.args())
  self.assertTrue(f.l.marker.exists())
  self.assertEqual(c.inventory(f.l.live,owner=os.getuid()),f.old,'Admitted old tree must be restored after final restart readiness fails')
 def test_replaced_ancestor_must_not_redirect_persistence(self):
  parent=self.root/'parent'; parent.mkdir(); other=self.root/'redirected'; other.mkdir()
  with c.pinned(parent,os.getuid()):
   parent.rename(self.root/'original-parent'); parent.symlink_to(other,target_is_directory=True)
   try: c.write_json(parent/'phase.json',dict(schema=1,phase='probe'))
   except (OSError,c.Refused): pass
  self.assertFalse((other/'phase.json').exists(),'Late fsync rejection does not undo redirected write')
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RedProbes))
 receipt=dict(tier='synthetic-source-only; qualification predicate simulation explicitly marked',tests=result.testsRun,failures=len(result.failures),errors=len(result.errors),skipped=len(result.skipped),success=result.wasSuccessful(),cleanupVerified=all(not Path(x['path']).exists() for x in OWNED),ownedFixtures=OWNED)
 (R/'red-probe-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps({k:v for k,v in receipt.items() if k!='ownedFixtures'}))
 sys.exit(0 if result.wasSuccessful() else 1)
