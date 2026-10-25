"""Bounded interception lifetime continuation, exact source plus two-file test patch."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,sys,time,re
K=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path);p.add_argument('--check-only',action='store_true');a=p.parse_args()
def digest(f):return hashlib.sha256(f.read_bytes()).hexdigest()
m=json.loads((K/'INPUTS.json').read_text())
assert m['sourceSHA']=='abe681a2837fa4b9b5236ea34970019c0b8934d1'
assert m['mode']=='interception-lifetime'
for name,h in m['kit'].items():assert digest(K/name)==h,name
for name,h in m['source'].items():assert digest(a.source/name)==h,name
assert subprocess.check_output(['node','--version'],text=True).strip()=='v26.8.1'
assert json.loads((a.source/'node_modules/playwright-core/package.json').read_text())['version']=='1.63.0'
for name in ['fixture-observer.mjs','protocol-buffered.mjs']:subprocess.run(['node','--check',str(K/name)],check=True)
subprocess.run(['git','-C',str(a.source),'apply','--check',str(K/'interception-lifetime.patch')],check=True)
if a.check_only:
 print(json.dumps({'inputCheck':'PASS','sourceFiles':len(m['source']),'patchSHA256':digest(K/'interception-lifetime.patch'),'browserStarted':False,'LinuxExecution':False}));sys.exit(0)
assert sys.platform=='linux' and a.output is not None and not a.output.exists()
assert os.environ.get('PLAYWRIGHT_BROWSERS_PATH') and os.environ.get('RELAY_ICON_PYTHON')
a.output.mkdir(parents=True,mode=0o700);o=a.output.resolve();s=o/'source'
shutil.copytree(a.source,s,ignore=shutil.ignore_patterns('.git','node_modules','dist','__pycache__'))
for n in ['node_modules','dist']:(s/n).symlink_to((a.source/n).resolve(),target_is_directory=True)
(o/'tmp').mkdir(mode=0o700)
receipts=[]
cases=[('01-original','personal-parallel-aba',True,False),('02-fixed','personal-parallel-aba',True,True),('03-launch-fixed','personal-launch-race',False,True),('04-aba-fixed','personal-parallel-aba',False,True)]
for name,fixture,observe,fixed in cases:
 if name=='02-fixed':
  subprocess.run(['git','apply',str(K/'interception-lifetime.patch')],cwd=s,check=True)
  for n,h in m['correctedSource'].items():assert digest(s/n)==h,n
  assert {n for n,h in m['source'].items() if digest(s/n)!=h}==set(m['changedTests'])
 env=dict(os.environ,TMPDIR=str(o/'tmp'),DIAG_MODE=name,DIAG_DISABLE_DELAY='0')
 argv=['node']+(['--import',str(K/'fixture-observer.mjs')] if observe else [])+['--test','--test-concurrency=1']+(['--test-name-pattern=parallel-owner both ABA'] if observe else [])+['tests/frontend/'+fixture+'.test.mjs']
 start=time.time();outer=False
 with (o/(name+'.log')).open('wb') as out:
  child=subprocess.Popen(argv,cwd=s,env=env,stdout=out,stderr=subprocess.STDOUT)
  try:code=child.wait(timeout=45 if observe else 120)
  except subprocess.TimeoutExpired:
   outer=True;child.terminate();code=child.wait(timeout=10)
 text=(o/(name+'.log')).read_text();counts={k:int(v) for k,v in re.findall(r'(?:#|ℹ) (tests|pass|fail|cancelled|skipped|todo) (\d+)',text)}
 rec={'name':name,'exit':code,'outerTimeout':outer,'counts':counts,'duration':time.time()-start,'logSHA256':digest(o/(name+'.log')),'argv':argv,'instrumented':observe,'fixed':fixed,'executedTestSHA256':digest(s/('tests/frontend/'+fixture+'.test.mjs'))}
 receipts.append(rec);(o/'EXPERIMENT.json').write_text(json.dumps(receipts,indent=2)+'\n');print(json.dumps(rec),flush=True)
 if outer:break
# An original control failure is evidence, not a failed correction gate; do not hide it.
ok=len(receipts)==4 and all(not r['outerTimeout'] and set(r['counts'])=={'tests','pass','fail','cancelled','skipped','todo'} for r in receipts) and all(r['exit']==0 and r['counts']['fail']==r['counts']['cancelled']==r['counts']['skipped']==r['counts']['todo']==0 for r in receipts[1:])
sys.exit(0 if ok else 1)
