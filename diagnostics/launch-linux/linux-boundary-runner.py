"""Parent-owned hosted diagnostic payload. No workflow/branch/dispatch side effects.
Use --check-only locally; execution requires Linux, pinned source, existing locked
Node dependencies, compiled dist, Pillow and sandbox-capable Chromium admission.
"""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,sys,time,re
K=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path);p.add_argument('--check-only',action='store_true');a=p.parse_args()
def digest(f):return hashlib.sha256(f.read_bytes()).hexdigest()
manifest=json.loads((K/'INPUTS.json').read_text())
for name,h in manifest['kit'].items():assert digest(K/name)==h,name
for name,h in manifest['source'].items():assert digest(a.source/name)==h,name
assert subprocess.check_output(['node','--version'],text=True).strip()=='v26.8.1'
assert json.loads((a.source/'node_modules/playwright-core/package.json').read_text())['version']=='1.63.0'
subprocess.run(['node','--check',str(K/'personal-parallel-aba.buffered.mjs')],check=True)
subprocess.run(['node','--check',str(K/'protocol-buffered.mjs')],check=True)
if a.check_only:
 print(json.dumps({'inputCheck':'PASS','sourceFiles':len(manifest['source']),'browserStarted':False,'LinuxExecution':False}));sys.exit(0)
assert sys.platform=='linux','Execute only on fresh parent-approved hosted Linux runner'
assert a.output is not None and not a.output.exists(),'Use new output root'
assert os.environ.get('PLAYWRIGHT_BROWSERS_PATH') and os.environ.get('RELAY_ICON_PYTHON')
a.output.mkdir(parents=True,mode=0o700);o=a.output.resolve();s=o/'source'
shutil.copytree(a.source,s,ignore=shutil.ignore_patterns('.git','node_modules','dist','__pycache__'))
for n in ['node_modules','dist']:(s/n).symlink_to((a.source/n).resolve(),target_is_directory=True)
shutil.copyfile(K/'personal-parallel-aba.buffered.mjs',s/'tests/frontend/personal-parallel-aba.buffered.mjs')
(o/'tmp').mkdir(mode=0o700)
receipts=[]
for n,mode in enumerate(['original','retain','retain','original','original','retain'],1):
 name=f'{n:02d}-{mode}';env=dict(os.environ,TMPDIR=str(o/'tmp'),DIAG_UNROUTE=mode,DIAG_PATH='/api/desktop',DIAG_DELAY='100',DIAG_DISABLE_DELAY='0')
 argv=['node','--import',str(K/'protocol-buffered.mjs'),'--test','--test-concurrency=1','--test-name-pattern=parallel-owner both ABA','tests/frontend/personal-parallel-aba.buffered.mjs']
 start=time.time();outer=False
 with (o/(name+'.log')).open('wb') as out:
  child=subprocess.Popen(argv,cwd=s,env=env,stdout=out,stderr=subprocess.STDOUT)
  try:code=child.wait(timeout=45)
  except subprocess.TimeoutExpired:
   outer=True;child.terminate();code=child.wait(timeout=10)
 text=(o/(name+'.log')).read_text();counts={k:int(v) for k,v in re.findall(r'(?:#|ℹ) (tests|pass|fail|cancelled|skipped|todo) (\d+)',text)}
 rec={'name':name,'exit':code,'outerTimeout':outer,'counts':counts,'duration':time.time()-start,'logSHA256':digest(o/(name+'.log')),'argv':argv}
 receipts.append(rec);(o/'EXPERIMENT.json').write_text(json.dumps(receipts,indent=2)+'\n');print(json.dumps(rec),flush=True)
 if outer:break
# Failure is retained; caller must upload output under always(), never rerun to erase it.
sys.exit(0 if len(receipts)==6 and all(r['exit']==0 and not r['outerTimeout'] for r in receipts) else 1)
