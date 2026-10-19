"""Source-integration tracer; no Linux or provenance qualification."""
import importlib, os, subprocess, sys, unittest

class PackageTests(unittest.TestCase):
    def test_canonical_cli_is_self_contained_and_disabled_before_services(self):
        p = subprocess.run([sys.executable,'-B','-m','deploy.migration_069','--systemctl','/DO-NOT-EXECUTE','rollback','--receipt','/PRIVATE-SENTINEL/receipt.json'],capture_output=True,timeout=10)
        self.assertEqual(p.returncode,1)
        self.assertIn(b'DISABLED',p.stderr)
        self.assertNotIn(b'PRIVATE-SENTINEL',p.stdout+p.stderr)
        self.assertNotIn(b'No module named',p.stderr)

if __name__=='__main__': unittest.main(verbosity=2)
