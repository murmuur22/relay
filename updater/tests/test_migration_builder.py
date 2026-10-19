"""Release-only construction tests; synthetic parser inputs are not receipts."""
import os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from deploy.migration_069 import build, policy

class BuilderTests(unittest.TestCase):
    def test_builder_refuses_unverified_inputs_without_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'output'
            with self.assertRaises((policy.Refused,FileNotFoundError)):
                build.build(Path(tmp),Path(tmp),'c'*40,output)
            self.assertFalse(output.exists())
    def test_emitted_acceptance_pins_both_raw_receipts_but_is_not_authority(self):
        from updater.tests.test_migration_policy import ReceiptTests
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); a=ReceiptTests().evidence(root)
            result=build.produce_acceptance(root,'c'*40,a['closure'])
            self.assertEqual(result,a)
            self.assertEqual(result['kind'],'relay-migration-acceptance')
            self.assertNotIn('qualified',result)
    def test_pack_round_trip_binds_policy_without_self_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)
            inventory=policy.closure()
            generated=dict(schema=1,kind='SYNTHETIC-PACKAGING-NOT-QUALIFICATION',closure=inventory)
            artifact=build.pack(policy.ROOT,out,generated)
            entries=policy.archive_files(out/policy.ARTIFACT,artifact)
            self.assertEqual(set(entries),set(policy.FILES)|{'migration-policy.json'})
            self.assertNotIn('migration-policy.json',inventory)
            self.assertEqual(policy.c.decode(entries['migration-policy.json']),generated)
    def test_archive_substitution_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp); artifact=build.pack(policy.ROOT,out,{'kind':'SYNTHETIC-NOT-AUTHORITY'})
            (out/policy.ARTIFACT).write_bytes(b'untrusted replacement')
            with self.assertRaises(policy.Refused): policy.archive_files(out/policy.ARTIFACT,artifact)

if __name__=='__main__': unittest.main(verbosity=2)
