"""Local admission/producer negatives only; never real Linux qualification."""
import copy,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from deploy.migration_069 import policy

class LinuxHarnessTests(unittest.TestCase):
 def module(self):
  from deploy.migration_069 import qualify
  return qualify
 def test_entrypoint_refuses_before_creating_any_path(self):
  p=subprocess.run([sys.executable,'-B','-m','deploy.migration_069.qualify','run',
    '--source-commit','c'*40,'--mode','loopback','--old-release-dir','/nonexistent',
    '--candidate-dir','/nonexistent','--output','/nonexistent',
    '--ack','I_ACCEPT_FRESH_DISPOSABLE_MIGRATION_QUALIFICATION'],capture_output=True,env={'PATH':os.environ['PATH']},timeout=10)
  self.assertNotEqual(p.returncode,0)
  self.assertIn(b'REFUSED',p.stderr)
 def test_producer_is_missing_until_implemented(self):
  self.assertTrue(hasattr(self.module(),'produce_receipt'),'Missing real-output receipt reducer')
 def report(self):
  q=self.module()
  return dict(schema=1,kind='relay-migration-prepolicy-execution',sourceCommit='c'*40,sourceRef=policy.PREPARATION_REF,
   mode='loopback',baseline=copy.deepcopy(policy.BASELINE),closure={'a':{'size':1,'sha256':'e'*64}},
   sourceInventory={'a':{'size':1,'sha256':'e'*64,'mode':420}},
   cases=[dict(code=k,exit=0) for k in q.CASES],exit=0,
   cleanup=dict(acknowledged=True,forced=False,remainingUnits=[],remainingPids=[],remainingPaths=[],remainingIdentities=[]))
 def produce(self,r):
  return self.module().produce_receipt(r,mode='loopback',source='c'*40,inventory=r['closure'],
    source_inventory={'a':{'size':1,'sha256':'e'*64,'mode':420}},
    producer=dict(workflow=policy.WORKFLOW,sourceRef=policy.PREPARATION_REF,sourceCommit='c'*40,runId=1,jobId=2,artifactId=3))
 def test_reducer_accepts_only_complete_execution_shape_not_authority(self):
  r=self.report(); value=self.produce(r)
  self.assertEqual(set(value['checks']),set(policy.CHECKS))
  policy.validate_receipt(value,'loopback',r['closure'],'c'*40)
 def test_failure_missing_duplicate_mode_source_baseline_core_and_cleanup_refuse(self):
  r=self.report()
  bad=[]
  for key,value in [('mode','private-lan'),('exit',1),('sourceCommit','d'*40),('baseline',{}),('cases',r['cases'][:-1]),
    ('sourceRef','refs/heads/main'),('sourceRef','refs/heads/other'),
    ('sourceInventory',{}),('cleanup',dict(r['cleanup'],forced=True)),
    ('cleanup',dict(r['cleanup'],remainingPids=[1])),('closure',{})]:
   x=copy.deepcopy(r);x[key]=value;bad.append(x)
  x=copy.deepcopy(r);x['cases'].append(x['cases'][0]);bad.append(x)
  x=copy.deepcopy(r);x['cases'][0]['exit']=1;bad.append(x)
  x=copy.deepcopy(r);x['cases'][0]['exit']=True;bad.append(x)
  x=copy.deepcopy(r);del x['mode'];bad.append(x)
  for x in bad:
   with self.subTest(value=x),self.assertRaises((policy.Refused,KeyError)):
    self.produce(x)
 def test_worker_and_unsigned_adapter_cannot_run_from_local_checkout(self):
  p=subprocess.run([sys.executable,'-B','-m','deploy.migration_069.qualification_worker','matrix'],capture_output=True,timeout=10)
  self.assertNotEqual(p.returncode,0)
  self.assertIn(b'REFUSED',p.stderr)
 def test_source_inventory_detects_real_byte_mode_and_path_mutation(self):
  import hashlib
  q=self.module()
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=root/'source.py';p.write_bytes(b'first');p.chmod(0o644)
   pin={'source.py':dict(size=5,sha256=hashlib.sha256(b'first').hexdigest(),mode=0o644)}
   q.check_inventory(root,pin)
   p.write_bytes(b'other')
   with self.assertRaises(policy.Refused):q.check_inventory(root,pin)
   p.write_bytes(b'first');p.chmod(0o600)
   with self.assertRaises(policy.Refused):q.check_inventory(root,pin)
   p.unlink();p.symlink_to(root/'missing')
   with self.assertRaises(policy.Refused):q.check_inventory(root,pin)
 def test_official_job_artifact_reducer_requires_both_successful_exact_source_jobs(self):
  from deploy.migration_069 import receipt_producer as rp
  self.assertTrue(hasattr(rp,'validate_remote'),'Official job/artifact readback reducer missing')
  run=dict(id=10,head_sha='c'*40,event='workflow_dispatch',path='.github/workflows/release.yml',head_branch=policy.PREPARATION_REF.removeprefix('refs/heads/'),run_attempt=1)
  jobs=[dict(id=i+1,name='migration-systemd-'+mode,head_sha='c'*40,run_id=10,run_attempt=1,status='completed',conclusion='success') for i,mode in enumerate(('loopback','private-lan'))]
  artifacts=[dict(id=i+30,name='migration-execution-'+mode+'-attempt-1',expired=False,workflow_run=dict(id=10,head_sha='c'*40),digest='sha256:'+'d'*64) for i,mode in enumerate(('loopback','private-lan'))]
  self.assertEqual(set(rp.validate_remote(run,jobs,artifacts,'c'*40,10,1)),{'loopback','private-lan'})
  for j,a in ((jobs[:-1],artifacts),(jobs,artifacts[:-1]),(jobs+[jobs[0]],artifacts)):
   with self.assertRaises(policy.Refused):rp.validate_remote(run,j,a,'c'*40,10,1)
  for field,value in (('conclusion','failure'),('head_sha','d'*40),('run_attempt',2)):
   bad=copy.deepcopy(jobs);bad[0][field]=value
   with self.assertRaises(policy.Refused):rp.validate_remote(run,bad,artifacts,'c'*40,10,1)
  for field,value in (('head_branch','main'),('head_branch','other'),('head_sha','d'*40),('path','.github/workflows/other.yml'),('run_attempt',2),('id',11),('event','push')):
   with self.subTest(run=(field,value)),self.assertRaises(policy.Refused):
    rp.validate_remote(dict(run,**{field:value}),jobs,artifacts,'c'*40,10,1)
  for field,value in (('workflow_run',dict(id=11,head_sha='c'*40)),('workflow_run',dict(id=10,head_sha='d'*40)),('expired',True),('digest','sha256:bad'),('id',False)):
   bad=copy.deepcopy(artifacts);bad[0][field]=value
   with self.subTest(artifact=(field,value)),self.assertRaises(policy.Refused):rp.validate_remote(run,jobs,bad,'c'*40,10,1)
 def test_prepare_workflow_is_manual_nonpublishing_exact_sha_and_mandatory_cleanup(self):
  workflow=(policy.ROOT/'.github/workflows/release.yml').read_text()
  self.assertIn('migration-prepare:',workflow)
  self.assertIn('name: migration-systemd-${{ matrix.mode }}',workflow)
  self.assertIn('ref: ${{ github.sha }}',workflow)
  self.assertIn('deploy.migration_069.qualify admit',workflow)
  self.assertIn('deploy.migration_069.receipt_producer',workflow)
  self.assertIn('migration-execution-${{ matrix.mode }}-attempt-${{ github.run_attempt }}',workflow)
  prepare=workflow.split('  migration-systemd:',1)[1]
  self.assertNotIn('contents: write',prepare)
  self.assertNotIn('id-token: write',prepare)
  self.assertNotIn('gh release ',prepare)
  self.assertNotIn('journalctl',prepare)
  self.assertIn('if: always()',prepare)
  for job in ('migration-systemd','migration-receipts'):
   gate=workflow.split('  '+job+':',1)[1].split('    strategy:',1)[0].split('    runs-on:',1)[0]
   self.assertIn("github.ref == '"+policy.PREPARATION_REF+"'",gate)
 def test_workflow_identity_guard_rejects_local_or_other_repo(self):
  q=self.module()
  from deploy.migration_069 import receipt_producer as rp
  self.assertEqual(policy.PREPARATION_REF,'refs/heads/feat/relay-069-staged-foundation')
  with patch.dict(os.environ,{},clear=True),self.assertRaises(policy.Refused):
   q.workflow_guard('c'*40,q.ACK)
  with patch.dict(os.environ,dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='evil/relay',GITHUB_SHA='c'*40),clear=True),self.assertRaises(policy.Refused):
   q.workflow_guard('c'*40,q.ACK)
  env=dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='murmuur22/relay',GITHUB_SHA='c'*40,GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_REF=policy.PREPARATION_REF,GITHUB_WORKFLOW_REF=policy.WORKFLOW+'@'+policy.PREPARATION_REF)
  # OS seams only: this proves identity admission, NOT a Linux qualification pass.
  with patch.object(q.sys,'platform','linux'),patch.object(q.os,'geteuid',return_value=0),patch.object(Path,'is_dir',return_value=True):
   with patch.dict(os.environ,env,clear=True):q.workflow_guard('c'*40,q.ACK)
   bads=[dict(env,GITHUB_REF=ref,GITHUB_WORKFLOW_REF=policy.WORKFLOW+'@'+ref) for ref in ('refs/heads/main','refs/heads/other')]
   bads += [dict(env,**{key:value}) for key,value in (('GITHUB_SHA','d'*40),('GITHUB_REPOSITORY','evil/relay'),('GITHUB_WORKFLOW_REF',policy.WORKFLOW+'@refs/heads/main'),('GITHUB_EVENT_NAME','push'),('RUNNER_ENVIRONMENT','self-hosted'))]
   for bad in bads:
    with self.subTest(identity=bad),patch.dict(os.environ,bad,clear=True):
     with self.assertRaises(policy.Refused):q.workflow_guard('c'*40,q.ACK)
     with patch.object(q,'git_inventory') as inventory,self.assertRaises(policy.Refused):rp.produce('c'*40,Path('/nonexistent'))
     inventory.assert_not_called()
  receipt=self.produce(self.report())
  for ref in ('refs/heads/main','refs/heads/other'):
   bad=copy.deepcopy(receipt);bad['producer']['sourceRef']=ref
   with self.subTest(receiptRef=ref),self.assertRaises(policy.Refused):policy.validate_receipt(bad,'loopback',bad['closure'],'c'*40)
  with tempfile.TemporaryDirectory() as tmp,patch.object(policy.c,'command') as command:
   for ref in ('refs/heads/main','refs/heads/other'):
    with self.subTest(verifierRef=ref),self.assertRaises(policy.Refused):policy.verify_official(Path(tmp),'a','b','c'*40,ref)
   command.assert_not_called()
   policy.verify_official(Path(tmp),'a','b','c'*40,'refs/tags/'+policy.c.TARGET)
   argv=command.call_args.args[0]
   for flag,value in (('--source-ref','refs/tags/'+policy.c.TARGET),('--source-digest','c'*40),('--signer-digest','c'*40),('--signer-workflow',policy.WORKFLOW)):
    self.assertEqual(argv[argv.index(flag)+1],value)

if __name__=='__main__':unittest.main(verbosity=2)
