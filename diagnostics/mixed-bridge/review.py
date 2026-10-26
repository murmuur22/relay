"""Nonproducing source/payload final acceptance; failure can never mean success."""
import os,sys,json,hashlib,re,subprocess,ast,copy
from pathlib import Path
from test_controls import accepted
BASE='f477a9d8f227d42e83308d45c37e689d085649b7'
REQUIRED={'anonymousSourceAndPayloadVerification','exactMixedBaseline','partialOperationRestore','unprivilegedStartupFailureRestore','protectedBackupAndApply','presentationAndHardening','separateBrowserService','signedLifecycle','finalExactBaselineRestore','ownedCleanup'}
def final_ok(r):
 return (r.get('passed') is True and r.get('supervisorExit')==0 and r.get('supervisorCancelled') is False and r.get('workflowCleanupExit')==0 and REQUIRED<=set(r.get('gates',{})) and all(r['gates'][g].get('passed') is True for g in REQUIRED) and accepted(dict(functional=r.get('passed'),childExit=r.get('supervisorExit'),signal='SIGTERM' if r.get('supervisorCancelled') else None,cleanup=r.get('gates',{}).get('ownedCleanup',{}).get('passed'),evidenceWritten=True)))
def scan(raw):
 for pattern in (rb'192\.168\.0\.114',rb'/Users/[A-Za-z][A-Za-z0-9_-]*/',rb'gh[opusr]_[A-Za-z0-9]{20,}',rb'AKIA[0-9A-Z]{16}',rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'):
  if re.search(pattern,raw):raise RuntimeError('private-publication-content-refused')
def source(path):
 path=Path(path).resolve();kit=path/'diagnostics/mixed-bridge'
 def git(*args):return subprocess.check_output(['git','-C',str(path),*args])
 names=git('ls-files','-z').decode().split('\0');n=0
 for name in filter(None,names):
  b=git('show',':'+name)
  try:scan(b)
  except RuntimeError:raise RuntimeError('private-publication-content-refused-in:'+name) from None
  n+=1
 changes=sorted(filter(None,names))
 assert changes and all(x=='.github/workflows/ui-delivery-compatibility.yml' or x.startswith('diagnostics/mixed-bridge/') for x in changes)
 for name,digest in json.loads((kit/'recipe-pins.json').read_text()).items():
  assert hashlib.sha256((kit/name).read_bytes()).hexdigest()==digest
 for f in kit.glob('*.py'):ast.parse(f.read_text(),filename=f.name)
 workflow=(path/'.github/workflows/ui-delivery-compatibility.yml').read_text();blocks=[];lines=workflow.splitlines();i=0
 while i<len(lines):
  if lines[i].strip()=='run: |':
   i+=1;block=[]
   while i<len(lines) and (not lines[i].strip() or lines[i].startswith('          ')):
    block.append(lines[i][10:]);i+=1
   blocks.append('\n'.join(block)+'\n')
  else:i+=1
 for b in blocks:assert subprocess.run(['/bin/bash','-n'],input=b.encode(),capture_output=True).returncode==0
 admission=(kit/'admit.sh').read_text().splitlines()[2:]
 assert all(line.strip() in blocks[0] for line in admission)
 assert 'persist-credentials: false' in workflow and 'contents: write' not in workflow and 'id-token:' not in workflow and 'attestations:' not in workflow
 assert re.findall(r'uses: ([^\n]+)',workflow)==['actions/checkout@11d5960a326750d5838078e36cf38b85af677262','actions/checkout@11d5960a326750d5838078e36cf38b85af677262','actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020','actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02']
 for item in json.loads((kit/'baseline.json').read_text()):
  assert not item['path'].startswith('/') and '..' not in item['path'].split('/')
  assert set(item)<=set(('path','kind','uid','gid','mode','nlink','size','sha256','sourceTag','sourcePath'))
  if item['kind']=='file':assert re.fullmatch('[0-9a-f]{64}',item['sha256'])
 good=dict(passed=True,supervisorExit=0,supervisorCancelled=False,workflowCleanupExit=0,gates={g:dict(passed=True) for g in REQUIRED});assert final_ok(good)
 for k,v in dict(supervisorExit=1,supervisorCancelled=True,workflowCleanupExit=1,passed=False).items():assert not final_ok({**good,k:v})
 for g in REQUIRED:
  bad=copy.deepcopy(good);del bad['gates'][g];assert not final_ok(bad)
 try:scan(b'/Users/'+b'fixture/private')
 except RuntimeError:pass
 else:raise AssertionError('scan-negative-not-rejected')
 print(json.dumps(dict(passed=True,stagedTreeScannedFiles=n,diagnosticChangedPaths=changes,shellBlocksSyntaxChecked=len(blocks),stockGuardsUnchanged=True,finalizerMissingGateAndNonzeroNegatives=True),indent=2))
def final(path):
 path=Path(path)
 for p in path.glob('*.json'):scan(p.read_bytes())
 r=json.loads((path/'result.json').read_text());ok=final_ok(r)
 (path/'acceptance.json').write_text(json.dumps(dict(passed=ok,requiredGates=sorted(REQUIRED),noProductionAuthority=True,distroLimit='Ubuntu 24.04 systemd only; operator Debian 13 not executed'),indent=2)+'\n')
 return 0 if ok else 1
if __name__=='__main__':
 if sys.argv[1]=='--source':source(sys.argv[2])
 elif sys.argv[1]=='--final':sys.exit(final(sys.argv[2]))
