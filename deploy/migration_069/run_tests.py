"""Run exact accepted IDs against canonical package; stdlib unittest only.
All mutations are confined to a private directory under caller's TMPDIR.
"""
import importlib, json, os, sys, tempfile, unittest
from pathlib import Path
from . import control_plane_upgrade_069 as c, coordinator_069 as m, archive_069 as a

def suite():
    # Compatibility aliases retain actual accepted unittest IDs, not production imports.
    for name,mod in (('control_plane_upgrade_069',c),('coordinator_069',m),('archive_069',a)):
        sys.modules[name]=mod
    directory=Path(__file__).parent/'tests'
    sys.path.insert(0,str(directory))
    ids=json.loads((directory/'accepted-ids.json').read_text())
    result=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(n) for n in ids)
    return result,ids

def main():
    scratch=Path(os.environ['TMPDIR']).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix='relay-migration-tests-',dir=scratch) as tmp:
        old=os.environ['TMPDIR']; os.environ['TMPDIR']=tmp
        try:
            tests,ids=suite()
            result=unittest.TextTestRunner(verbosity=2).run(tests)
            print(json.dumps(dict(tier='synthetic-filesystem-subprocess-NOT-linux',tests=result.testsRun,passed=result.testsRun-len(result.failures)-len(result.errors)-len(result.skipped),failures=len(result.failures),errors=len(result.errors),skipped=len(result.skipped),ids=ids,success=result.wasSuccessful())))
            return 0 if result.wasSuccessful() else 1
        finally: os.environ['TMPDIR']=old

if __name__=='__main__': sys.exit(main())
