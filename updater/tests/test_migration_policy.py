"""Synthetic parser inputs only. No test receipt is an actual Linux pass."""
import copy, hashlib, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from deploy.migration_069 import policy

class ReceiptTests(unittest.TestCase):
    def sample(self, mode='loopback'):
        closure={'deploy/migration_069/example.py':{'size':9,'sha256':hashlib.sha256(b'synthetic').hexdigest()}}
        producer=dict(workflow=policy.WORKFLOW,sourceRef=policy.PREPARATION_REF,sourceCommit='c'*40,runId=1,jobId=2,artifactId=3)
        return dict(schema=1,kind='relay-migration-systemd-receipt',tier='real-linux-systemd',mode=mode,producer=producer,
            target=dict(version='v0.6.9',sourceCommit='c'*40),baseline=policy.BASELINE,closure=closure,
            exit=0,success=True,counts=dict(tests=12,passed=12,failed=0,errors=0,skipped=0),checks={k:True for k in policy.CHECKS},cleanup=True)
    def test_shape_validation_does_not_confer_authority(self):
        r=self.sample()
        self.assertEqual(policy.validate_receipt(r,'loopback',r['closure'],'c'*40),r)
        self.assertFalse(hasattr(policy,'QUALIFIED'))
    def test_rejects_missing_skipped_nonzero_wrong_mode_source_baseline_tool_hash(self):
        r=self.sample()
        changes=[('exit',1),('success',False),('mode','private-lan'),('tier','synthetic'),('schema',True),
            ('target',dict(version='v0.6.9',sourceCommit='d'*40)),('baseline',dict(policy.BASELINE,sourceCommit='d'*40)),
            ('closure',{}),('counts',dict(tests=12,passed=11,failed=0,errors=0,skipped=1)),('checks',{}),
            ('producer',dict(r['producer'],workflow='evil/repo/.github/workflows/release.yml')),
            ('producer',dict(r['producer'],sourceRef='refs/heads/other'))]
        for field,value in changes:
            with self.subTest(field=field,value=value),self.assertRaises(policy.Refused):
                policy.validate_receipt(dict(r,**{field:value}),'loopback',r['closure'],'c'*40)
        for field in r:
            bad=dict(r); del bad[field]
            with self.subTest(missing=field),self.assertRaises(policy.Refused): policy.validate_receipt(bad,'loopback',r['closure'],'c'*40)
    def test_old_client_accepts_optional_tool_descriptor_without_changing_runtime_keys(self):
        from updater.broker.releases import manifest_valid
        a=dict(name='relay-linux-x64.tar.gz',size=1,sha256='0'*64)
        m=dict(protocol=1,repository='murmuur22/relay',version='v0.6.9',platform='linux-x64',stateSchema=1,rollbackCompatible=True,minimumNode='26.8.1',artifact=a)
        extra=dict(m,migrationArtifact=dict(name=policy.ARTIFACT,size=1,sha256='1'*64))
        self.assertEqual(manifest_valid(extra,'v0.6.9')['artifact'],a)

    def test_official_stock_only_admission_requires_fixed_inventory_and_target_runtime(self):
        from deploy.migration_069 import coordinator_069 as m
        baseline=policy.c.decode(policy.read(policy.ROOT/'deploy/migration_069/supported-baseline.json'))
        snap=dict(control=copy.deepcopy(baseline['inventory']),units=copy.deepcopy(baseline['units']),
            config={'relay-release.json':{'sha256':policy.BASELINE['manifestSha256']}},runtime={'receipt':{'sha256':'e'*64}})
        qualified=dict(runtimeArtifact={'sha256':'e'*64})
        with patch.object(m,'qualification',return_value=qualified):
            fake=type('LayoutStub',(),{'synthetic':False})()
            self.assertEqual(m.reviewed(fake,None,None,snap)['inventory'],baseline['inventory'])
            with self.assertRaises(policy.Refused): m.reviewed(fake,'operator.json','a'*64,snap)
            snap['control']['extra']={}
            with self.assertRaises(policy.Refused): m.reviewed(fake,None,None,snap)
    def evidence(self, root):
        r=self.sample(); inventory=r['closure']; receipts={}
        for mode,index in (('loopback',3),('private-lan',4)):
            r=self.sample(mode); r['producer']['artifactId']=index
            raw=policy.c.canonical(r); name='migration-'+mode+'.json'; (root/name).write_bytes(raw)
            receipts[mode]=dict(artifact=dict(name=name,size=len(raw),sha256=policy.c.sha(raw)),producer=r['producer'])
        a=dict(schema=1,kind='relay-migration-acceptance',target=r['target'],baseline=policy.BASELINE,closure=inventory,receipts=receipts)
        (root/'migration-acceptance.json').write_bytes(policy.c.canonical(a))
        return a
    def test_local_acceptance_cannot_bypass_official_verifier(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); a=self.evidence(root)
            with patch.object(policy,'verify_official',side_effect=policy.Refused('untrusted official evidence')) as verify:
                with self.assertRaises(policy.Refused): policy.acceptance(root,'c'*40,a['closure'])
                verify.assert_called_once_with(root,'migration-acceptance.json','migration-acceptance.attestation.json','c'*40,policy.PREPARATION_REF)
    def test_exact_receipt_raw_read_pins_and_identity_are_enforced(self):
        # Mocked signature result exercises parser ONLY, not a qualified build.
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); a=self.evidence(root)
            with patch.object(policy,'verify_official'):
                p=policy.acceptance(root,'c'*40,a['closure'])
                self.assertEqual(p['receipts'],a['receipts'])
                (root/'migration-loopback.json').write_bytes(b'{}')
                with self.assertRaisesRegex(policy.Refused,'read pins'): policy.acceptance(root,'c'*40,a['closure'])
    def test_mutable_acceptance_is_not_authority(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); a=self.evidence(root)
            def mutate(*args): (root/'migration-acceptance.json').write_bytes(b'{}')
            with patch.object(policy,'verify_official',side_effect=mutate):
                with self.assertRaisesRegex(policy.Refused,'changed'): policy.acceptance(root,'c'*40,a['closure'])
    def test_official_verifier_pins_identity_and_strips_credentials(self):
        calls=[]
        with tempfile.TemporaryDirectory() as tmp, patch.object(policy.c,'command',side_effect=lambda *a,**kw:calls.append((a,kw))):
            policy.verify_official(Path(tmp),'migration-acceptance.json','migration-acceptance.attestation.json','c'*40,policy.PREPARATION_REF)
        argv=calls[0][0][0]; env=calls[0][1]['env']
        for flag,value in (('--repo','murmuur22/relay'),('--signer-workflow',policy.WORKFLOW),('--source-ref',policy.PREPARATION_REF),('--source-digest','c'*40),('--signer-digest','c'*40)):
            self.assertEqual(argv[argv.index(flag)+1],value)
        self.assertIn('--deny-self-hosted-runners',argv); self.assertNotIn('GH_TOKEN',env); self.assertNotIn('GITHUB_TOKEN',env)
    def test_generated_policy_without_official_distribution_cannot_enable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'migration-policy.json').write_bytes(b'{}')
            with patch.object(policy.sys,'platform','linux'),patch.object(policy.os,'geteuid',return_value=os.getuid()):
                with self.assertRaises((policy.Refused,FileNotFoundError)): policy.qualified(root)

if __name__=='__main__': unittest.main(verbosity=2)
