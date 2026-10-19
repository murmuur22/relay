"""Sanitized first-failure evidence only; no Linux qualification authority."""
import json,subprocess,tempfile,unittest
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
   p.write_bytes(b'x'*4097);self.assertIsNone(q.worker_diagnostic(owner=p.stat().st_uid))
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

if __name__=='__main__':unittest.main(verbosity=2)
