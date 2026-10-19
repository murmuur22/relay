"""Sanitized first-failure evidence only; no Linux qualification authority."""
import copy,json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from deploy.migration_069 import qualify as q, qualification_worker as w

class DiagnosticTests(unittest.TestCase):
 def test_fixed_fields_never_copy_exception_messages_output_or_unknown_enums(self):
  self.assertTrue(hasattr(q,'diagnostic'),'Missing separate sanitized diagnostic producer')
  secret='password cookie statehash setup-url PRIVATE'
  low=subprocess.CalledProcessError(7,['PRIVATE'],output=secret,stderr=secret)
  try:
   try:raise low
   except subprocess.CalledProcessError:raise RuntimeError(secret) from None
  except RuntimeError as exc:
   helper=type('Helper',(),{'install':type('Install',(),{'run':staticmethod(lambda *a,**k:'ActiveState=active\nSubState='+secret+'\nResult=exit-code\nExecMainStatus=203\nMainPID=123')})})()
   value=q.diagnostic(helper,'worker-launch',exc,None)
  raw=json.dumps(value)
  self.assertNotIn('PRIVATE',raw);self.assertNotIn('password',raw)
  self.assertEqual(value['commandStatus'],7)
  self.assertEqual(value['units'][q.UNIT],dict(ActiveState='active',SubState='unknown',Result='exit-code',ExecMainStatus=203,MainPID=123))
  self.assertEqual(value['errorClass'],'RuntimeError')
  self.assertEqual(value['phase'],'worker-launch')
 def test_worker_readback_strict_and_no_acceptance_fields(self):
  self.assertTrue(hasattr(q,'worker_diagnostic'),'Missing bounded checkpoint readback')
  with tempfile.TemporaryDirectory() as d,patch.object(q,'ROOT',Path(d)):
   p=Path(d)/'worker-diagnostic.json'
   good=dict(schema=1,phase='worker-admission',errorClass='Refused',reasonCode='exception',errno=None)
   for bad in (dict(good,password='PRIVATE'),dict(good,phase='PRIVATE'),dict(good,errno=True),dict(good,errorClass='PRIVATE'),dict(good,reasonCode='PRIVATE')):
    p.write_text(json.dumps(bad));p.chmod(0o600)
    self.assertIsNone(q.worker_diagnostic(owner=p.stat().st_uid))
   p.write_text(json.dumps(good));self.assertEqual(q.worker_diagnostic(owner=p.stat().st_uid),good)
   p.write_bytes(b'x'*16385);self.assertIsNone(q.worker_diagnostic(owner=p.stat().st_uid))
 def test_worker_checkpoint_is_private_fixed_phase_only(self):
  self.assertTrue(hasattr(w,'checkpoint'),'Missing internal worker checkpoint')
  with tempfile.TemporaryDirectory() as d,patch.object(w,'R',Path(d)):
   w.checkpoint('worker-admission',PermissionError(13,'PRIVATE password'))
   p=Path(d)/'worker-diagnostic.json';value=json.loads(p.read_text())
   self.assertEqual(value['errno'],13);self.assertNotIn('PRIVATE',p.read_text())
   self.assertEqual(p.stat().st_mode&0o777,0o600)
   with self.assertRaises(q.c.Refused):w.checkpoint('PRIVATE')
 def test_readback_failure_is_sanitized_not_a_cleanup_or_success_claim(self):
  self.assertTrue(hasattr(q,'diagnostic'),'Missing diagnostic producer')
  def fail(*a,**kw):raise OSError(13,'PRIVATE')
  helper=type('Helper',(),{'install':type('Install',(),{'run':staticmethod(fail)})})()
  value=q.diagnostic(helper,'baseline-service-start',PermissionError(13,'PRIVATE'),None)
  self.assertEqual(value['errno'],13)
  self.assertTrue(all(all(x=='unknown' or x is None for x in v.values()) for v in value['units'].values()))
  self.assertNotIn('PRIVATE',json.dumps(value));self.assertNotIn('success',value);self.assertNotIn('cleanup',value)

 def test_malformed_status_and_unknown_exception_cannot_leak(self):
  for raw in ('ActiveState=PRIVATE', 'MainPID=-1\nExecMainStatus=999', 'MainPID=True', 'Result=success\nResult=PRIVATE', 'PRIVATE='+('x'*5000)):
   helper=type('Helper',(),{'install':type('Install',(),{'run':staticmethod(lambda *a,**k:raw)})})()
   private=type('PRIVATE',(Exception,),{})('PRIVATE')
   value=q.diagnostic(helper,'worker-launch',private,None)
   self.assertEqual(value['errorClass'],'OtherError');self.assertNotIn('PRIVATE',json.dumps(value))
   for unit in value['units'].values():
    self.assertIsNone(unit['MainPID']);self.assertIsNone(unit['ExecMainStatus'])
 def test_workflow_upload_is_exact_sanitized_target_and_not_receipt_input(self):
  workflow=(q.policy.ROOT/'.github/workflows/release.yml').read_text()
  self.assertIn('for kind in execution cleanup diagnostic;',workflow)
  self.assertIn('path: ${{ runner.temp }}/migration-output/diagnostic-${{ matrix.mode }}.json',workflow)
  self.assertNotIn('worker-diagnostic.json',workflow)
  from deploy.migration_069 import receipt_producer
  self.assertNotIn('diagnostic-',Path(receipt_producer.__file__).read_text())

 def test_admission_exception_leaves_exact_private_checkpoint_without_trace(self):
  with tempfile.TemporaryDirectory() as d,patch.object(w,'R',Path(d)),patch.object(w,'__file__',str(Path(d)/'source/deploy/migration_069/qualification_worker.py')),patch.object(w.sys,'platform','linux'),patch.object(w.os,'geteuid',return_value=0),patch.object(w.sys,'argv',['worker','matrix']),patch.object(w,'admission',side_effect=AttributeError('PRIVATE password')):
   with self.assertRaises(AttributeError):w.main()
   value=json.loads((Path(d)/'worker-diagnostic.json').read_text())
   self.assertEqual(value['phase'],'worker-admission');self.assertEqual(value['errorClass'],'AttributeError')
   self.assertNotIn('PRIVATE',json.dumps(value));self.assertFalse((Path(d)/'execution.json').exists())

 def test_exact_refusal_literals_only_and_bounded_errno(self):
  for message,code in q.REFUSAL_REASONS.items():
   self.assertEqual(q.error_fields(q.c.Refused(message))[0]['reasonCode'],code)
   for exc in (RuntimeError(message),q.c.Refused(message+' PRIVATE'),q.c.Refused(message,'PRIVATE')):
    fields,_=q.error_fields(exc)
    self.assertEqual(fields['reasonCode'],'exception');self.assertNotIn('PRIVATE',json.dumps(fields))
  class Unsafe(q.c.Refused):
   def __str__(self):raise AssertionError('Never stringify')
  self.assertEqual(q.error_fields(Unsafe('PRIVATE'))[0]['reasonCode'],'exception')
  for number,expected in ((13,13),(40,40),(999999,None),(True,None)):
   self.assertEqual(q.error_fields(OSError(number,'PRIVATE'))[0]['errno'],expected)

 def test_public_boundary_no_symlink_follow_no_contents_and_strict_validator(self):
  with tempfile.TemporaryDirectory() as d,patch.object(q,'ROOT',Path(d)/'public'):
   source=q.ROOT/'source';source.mkdir(parents=True)
   private=Path(d)/'PRIVATE';private.mkdir();(private/'secret').write_text('PRIVATE password')
   (source/'deploy').symlink_to(private,target_is_directory=True)
   value=q.source_boundary();q.validate_source_boundary(value)
   paths=q.public_source_components();entries=value['components']
   self.assertEqual(entries[paths.index(source/'deploy')]['kind'],'link')
   self.assertEqual(entries[paths.index(source/'deploy/migration_069')]['kind'],'unknown')
   self.assertNotIn('PRIVATE',json.dumps(value));self.assertNotIn(str(Path(d)),json.dumps(value))
   self.assertLessEqual(len(entries),64)
   bads=[]
   for key,replacement in (('owner',True),('rootRelation','PRIVATE'),('components',entries*65)):
    bad=copy.deepcopy(value);bad[key]=replacement;bads.append(bad)
   for key,replacement in (('component',True),('kind','PRIVATE'),('uid',True),('gid',-1),('mode',4096),('nlink',2**32),('errno',True),('path','PRIVATE')):
    bad=copy.deepcopy(value);bad['components'][0][key]=replacement;bads.append(bad)
   for bad in bads:
    with self.assertRaises(q.c.Refused):q.validate_source_boundary(bad)
   fields=dict(schema=1,phase='worker-closure',errorClass='Refused',reasonCode='untrusted-ancestry',errno=None,sourceBoundary=value)
   q.validate_worker_diagnostic(fields)
   for bad in (dict(fields,phase='worker-admission'),dict(fields,errorClass='None'),dict(fields,errorClass='RuntimeError')):
    with self.assertRaises(q.c.Refused):q.validate_worker_diagnostic(bad)

 def test_real_permission_refusal_before_matrix_execution_and_mutation(self):
  # Controlled macOS fixture: real strict pinned reads, NOT Linux admission/pass.
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);source=root/'source';source.mkdir(mode=0o700)
   for name in q.policy.FILES:
    p=source/name;p.parent.mkdir(mode=0o700,parents=True,exist_ok=True);p.write_bytes(b'public fixture');p.chmod(0o600)
   real_closure=q.policy.closure
   before=real_closure(source)
   source.chmod(0o777)  # Only this newly owned fixture, never a system/source path.
   def closure(root=source):return real_closure(root)
   owner=os.geteuid()
   matrix=type('Matrix',(),{'cases':[],'execute':lambda self:None})()
   mark=dict(sourceCommit='6'*40,sourceRef=q.policy.PREPARATION_REF,mode='loopback',sourceInventory={})
   with patch.object(q,'ROOT',root),patch.object(w,'R',root),patch.object(q.policy,'ROOT',source),patch.object(q.policy,'closure',closure),patch.object(w,'__file__',str(source/'deploy/migration_069/qualification_worker.py')),patch.object(w.sys,'platform','linux'),patch.object(w.os,'geteuid',return_value=0),patch.object(w.sys,'argv',['worker','matrix']),patch.object(w,'admission',return_value=mark),patch.object(w,'Matrix',return_value=matrix),patch.object(matrix,'execute') as execute:
    # Actual reads use the real fixture uid; only the fixed guard is simulated.
    with patch.object(q.policy,'read',side_effect=lambda p:q.c.bounded_read(p,16*1024**2,owner)):
     with self.assertRaises(q.c.Refused):w.main()
    execute.assert_not_called()
    value=json.loads((root/'worker-diagnostic.json').read_text())
    self.assertEqual(value['phase'],'worker-closure');self.assertEqual(value['reasonCode'],'untrusted-ancestry')
    boundary=value['sourceBoundary'];self.assertEqual(boundary['rootRelation'],'fixed-source');self.assertEqual(boundary['defaultRootRelation'],'fixed-source')
    entry=boundary['components'][q.public_source_components().index(source)]
    self.assertEqual(entry['mode'],0o777);self.assertEqual(entry['uid'],owner)
    self.assertFalse((root/'execution.json').exists())
    self.assertEqual(q.worker_diagnostic(owner=owner),value)
    helper=type('Helper',(),{'install':type('Install',(),{'run':staticmethod(lambda *a,**k:'ActiveState=active\nSubState=running\nResult=success\nExecMainStatus=0\nMainPID=123')})})()
    outer=q.diagnostic(helper,'worker-launch',RuntimeError('PRIVATE'),value)
    self.assertEqual(outer['worker'],value)
    self.assertLess(len(q.c.canonical(outer)),16384);self.assertNotIn('PRIVATE',json.dumps(outer))
   source.chmod(0o700)
   self.assertEqual(real_closure(source),before)

 def test_probe_failure_keeps_original_sanitized_refusal(self):
  with tempfile.TemporaryDirectory() as d,patch.object(w,'R',Path(d)),patch.object(q,'source_boundary',side_effect=RuntimeError('PRIVATE')):
   w.checkpoint('worker-closure',q.c.Refused('Untrusted ancestry or permissions'))
   value=json.loads((Path(d)/'worker-diagnostic.json').read_text())
   self.assertEqual(value['reasonCode'],'untrusted-ancestry');self.assertNotIn('sourceBoundary',value)
   self.assertNotIn('PRIVATE',json.dumps(value))

if __name__=='__main__':unittest.main(verbosity=2)
