"""Synthetic filesystem tests only; never Linux/systemd qualification."""
import importlib.util,json,os,stat,tempfile,unittest
from pathlib import Path
import control_plane_upgrade_069 as c
HERE=Path(os.environ['TMPDIR'])
class InventoryTests(unittest.TestCase):
 def test_complete_inventory_rejects_link_without_reading_target(self):
  script=c.HERE/'control_plane_upgrade_069.py'
  self.assertTrue(script.exists(),'Missing bounded control-plane inspector')
  spec=importlib.util.spec_from_file_location('cp069',script); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
  with tempfile.TemporaryDirectory(dir=HERE) as tmp:
   root=Path(tmp); (root/'code').mkdir(); (root/'code/a').write_bytes(b'actual code')
   entries=m.inventory(root,owner=os.getuid())
   self.assertEqual(set(entries),{'.','code','code/a'})
   self.assertEqual(entries['code/a']['kind'],'file'); self.assertEqual(entries['code/a']['size'],11)
   (root/'link').symlink_to('/etc/passwd')
   with self.assertRaises(m.Refused): m.inventory(root,owner=os.getuid())
 def test_idle_journal_rejects_ready_active_recovery_and_malformed(self):
  spec=importlib.util.spec_from_file_location('cp069',c.HERE/'control_plane_upgrade_069.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
  idle=dict(currentVersion='v0.6.9',job=None,history=[],previous=None,checkpoint=None)
  self.assertTrue(hasattr(m,'admit_idle'),'Missing exact journal admission')
  m.admit_idle(idle,'v0.6.9')
  for change in [dict(job={'phase':'ready'}),dict(job={'phase':'downloading'}),dict(job={'phase':'interrupted'}),dict(job={'phase':'rollback-failed'}),dict(checkpoint={}),dict(prepared={}),dict(currentVersion='v0.6.8')]:
   with self.subTest(change=change),self.assertRaises(m.Refused): m.admit_idle(dict(idle,**change),'v0.6.9')
  for v in [None,[],{'job':None},dict(idle,extra='unadmitted')]:
   with self.assertRaises(m.Refused): m.admit_idle(v,'v0.6.9')
 def test_attestation_exact_source_pins_and_credential_free_environment(self):
  spec=importlib.util.spec_from_file_location('cp069',c.HERE/'control_plane_upgrade_069.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
  self.assertTrue(hasattr(m,'attest'),'Missing exact attestation verification')
  calls=[]
  def run(argv,**kw): calls.append((argv,kw)); return ''
  with tempfile.TemporaryDirectory(dir=HERE) as tmp: m.attest(Path(tmp),'v0.6.9','a'*40,'/usr/bin/gh',run)
  args,kw=calls[0]
  for flag,value in [('--repo','murmuur22/relay'),('--signer-workflow','murmuur22/relay/.github/workflows/release.yml'),('--source-ref','refs/tags/v0.6.9'),('--source-digest','a'*40),('--signer-digest','a'*40)]: self.assertEqual(args[args.index(flag)+1],value)
  self.assertIn('--deny-self-hosted-runners',args)
  self.assertNotIn('GH_TOKEN',kw['env']); self.assertEqual(kw['env']['GH_CONFIG_DIR'],'/nonexistent')
  with self.assertRaises(m.Refused): m.attest(Path('/x'),'v069','a'*40,'/usr/bin/gh',run)
 def test_transaction_switch_and_failed_readiness_restores_exact_tree(self):
  spec=importlib.util.spec_from_file_location('cp069',c.HERE/'control_plane_upgrade_069.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
  self.assertTrue(hasattr(m,'TreeTransaction'),'Missing real protected tree transaction')
  with tempfile.TemporaryDirectory(dir=HERE) as tmp:
   root=Path(tmp); live=root/'live'; new=root/'candidate'; tx=root/'transaction'
   live.mkdir(); new.mkdir(); tx.mkdir(mode=0o700)
   (live/'engine.py').write_text('old engine'); (new/'engine.py').write_text('new engine')
   before=m.inventory(live,owner=os.getuid()); events=[]
   t=m.TreeTransaction(live,tx,owner=os.getuid())
   t.prepare(new)
   t.switch()
   self.assertEqual((live/'engine.py').read_text(),'new engine')
   self.assertEqual(m.inventory(tx/'old',owner=os.getuid()),before)
   t.restore()
   self.assertEqual(m.inventory(live,owner=os.getuid()),before)
   self.assertEqual((tx/'rejected'/'engine.py').read_text(),'new engine')
 def test_transaction_refuses_overwriting_local_repair(self):
  spec=importlib.util.spec_from_file_location('cp069',c.HERE/'control_plane_upgrade_069.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
  self.assertTrue(hasattr(m,'TreeTransaction'),'Missing drift refusal')
  with tempfile.TemporaryDirectory(dir=HERE) as tmp:
   root=Path(tmp); live=root/'live'; new=root/'candidate'; tx=root/'transaction'
   live.mkdir(); new.mkdir(); tx.mkdir(mode=0o700)
   (live/'engine.py').write_text('old'); (new/'engine.py').write_text('new')
   t=m.TreeTransaction(live,tx,owner=os.getuid()); t.prepare(new); t.switch()
   (live/'engine.py').write_text('operator repair')
   with self.assertRaises(m.Refused): t.restore()
   self.assertEqual((live/'engine.py').read_text(),'operator repair')
 def test_readback_has_no_bridge_key_or_raw_journal_content(self):
  spec=importlib.util.spec_from_file_location('cp069',c.HERE/'control_plane_upgrade_069.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
  self.assertTrue(hasattr(m,'journal_summary'),'Missing redacted operator readback')
  s=m.journal_summary({'currentVersion':'v0.6.8','job':{'phase':'ready','userId':'SECRET-OWNER','error':'SECRET-COOKIE'},'checkpoint':{'secret':'SECRET-KEY'},'prepared':{'secret':'SECRET-TOKEN'}})
  self.assertNotIn('SECRET',json.dumps(s)); self.assertEqual(s['phase'],'ready'); self.assertTrue(s['checkpointHold'])
 def test_signed_inventory_requires_complete_paths_not_version_label(self):
  spec=importlib.util.spec_from_file_location('cp069',c.HERE/'control_plane_upgrade_069.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
  self.assertTrue(hasattr(m,'signed_match'),'Missing complete signed-baseline comparison')
  e={'.':{'kind':'directory','uid':0,'gid':0,'mode':493,'nlink':3},'engine.py':{'kind':'file','uid':0,'gid':0,'mode':420,'nlink':1,'size':3,'sha256':'a'*64,'mtimeNs':1}}
  self.assertTrue(m.signed_match(e,e))
  changed=json.loads(json.dumps(e)); changed['engine.py']['sha256']='b'*64
  self.assertFalse(m.signed_match(changed,e)); changed=dict(e,repair=e['engine.py']); self.assertFalse(m.signed_match(changed,e))
  changed=json.loads(json.dumps(e)); changed['engine.py']['uid']=501; self.assertFalse(m.signed_match(changed,e))
 def test_coordinator_failed_candidate_health_restores_and_keeps_gate(self):
  import control_plane_upgrade_069 as m
  self.assertTrue(hasattr(m,'activate'),'Missing service-bound activation and recovery')
  with tempfile.TemporaryDirectory(dir=HERE) as tmp:
   root=Path(tmp); live=root/'live'; candidate=root/'candidate'; tx=root/'transaction'
   live.mkdir(); candidate.mkdir(); tx.mkdir(mode=0o700)
   (live/'engine.py').write_text('old'); (candidate/'engine.py').write_text('new')
   t=m.TreeTransaction(live,tx,owner=os.getuid()); t.prepare(candidate)
   class Host:
    gated=False
    def gate(self): self.gated=True
    def stop(self): pass
    def stopped_idle(self): pass
    def preserved(self): pass
    def start(self): pass
    def health(self,kind):
     if kind=='new': raise m.Refused('synthetic startup failure')
   h=Host()
   with self.assertRaises(m.Refused): m.activate(t,h)
   self.assertTrue(h.gated); self.assertEqual((live/'engine.py').read_text(),'old')
   self.assertEqual(t.load('phase.json')['phase'],'restored-healthy-maintenance-held')
if __name__=='__main__': unittest.main(verbosity=2)
