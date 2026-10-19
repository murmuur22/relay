"""Synthetic fixed dependencies exercise worker logic, NOT Linux qualification."""
import contextlib,json,os,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
from deploy.migration_069 import qualification_worker as w

class WorkerTests(unittest.TestCase):
 def test_old_cycle_compares_same_private_shape_and_detects_real_drift(self):
  for drift in (False,True):
   with self.subTest(drift=drift),tempfile.TemporaryDirectory() as d:
    root=Path(d)
    def mapped(p):
     p=Path(p)
     return root/str(p).lstrip('/') if p.is_absolute() and root not in p.parents else p
    paths=('/opt/relay-updater/updater/ui/dist/index.html','/etc/relay-updater/broker.json',
      '/var/lib/relay/accounts.json','/var/lib/relay/users/u/desktop.json',
      *('/etc/systemd/system/'+u for u in w.m.UNITS))
    for n in paths:
     p=mapped(n);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'synthetic');p.chmod(0o600)
    receipt=mapped('/runtime/.relay-verified.json');receipt.parent.mkdir();receipt.write_text(json.dumps(dict(mode='production',version=w.c.TARGET,sha256='a'*64)))
    helper=w.ql.helper();calls=[];observed=[]
    def fingerprint(p):
     p=mapped(p);before=p.stat();value=helper.fingerprint(p);after=p.stat()
     self.assertEqual((before.st_dev,before.st_ino,before.st_mode,before.st_uid,before.st_gid,before.st_mtime_ns,before.st_ctime_ns),
       (after.st_dev,after.st_ino,after.st_mode,after.st_uid,after.st_gid,after.st_mtime_ns,after.st_ctime_ns))
     observed.append(str(p.relative_to(root)));return value
    def mutate(action,*args,**kw):
     calls.append(action)
     if drift:mapped('/var/lib/relay/users/u/desktop.json').write_bytes(b'changed')
     return str(len(calls))
    engine=types.SimpleNamespace(thread=types.SimpleNamespace(join=lambda n:None,is_alive=lambda:False),prune=lambda:None,current_release=lambda:receipt.parent)
    base=types.SimpleNamespace(service_identity=lambda u:(123,'original'),raw_http=lambda *a:(200,b'synthetic',{}),
      ready=lambda *a:None,authenticate=lambda p:('cookie','csrf'))
    q=types.SimpleNamespace(load_installed=lambda old:(object,object),fingerprint=fingerprint,base=base,mutate=mutate,
      wait_job=lambda monitor,job,phase,**kw:dict(currentVersion='v0.6.4' if phase=='rolled-back' else w.c.TARGET))
    def serve(q,Engine,Broker,password,action):return action(engine,'cookie','csrf','monitor')
    with patch.object(w,'Path',side_effect=mapped),patch.object(w,'serve_engine',side_effect=serve),patch.object(w,'unsigned_manifest',return_value=({'artifact':{'sha256':'a'*64}},'b'*64)):
     if drift:
      with self.assertRaisesRegex(w.c.Refused,'private state'):w.old_cycle(q,'not-a-real-password')
     else:
      w.old_cycle(q,'not-a-real-password');self.assertEqual(calls,['install','rollback','install'])
    self.assertIn('var/lib/relay/accounts.json',observed);self.assertIn('var/lib/relay/users',observed)
    self.assertEqual(mapped('/var/lib/relay/accounts.json').read_bytes(),b'synthetic')

if __name__=='__main__':unittest.main(verbosity=2)
