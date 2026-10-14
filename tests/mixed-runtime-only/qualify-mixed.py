"""TEST ONLY: exact mixed tree overlay + original signed runtime harness, no engine changes."""
import hashlib, importlib.util, inspect, json, os, pathlib, shutil, stat, sys, tarfile, tempfile
sys.dont_write_bytecode=True
HERE=pathlib.Path(__file__).resolve().parent
DEPLOY=HERE if HERE==pathlib.Path('/opt/relay-qualification') else HERE.parents[1]/'deploy'
for name,pin in json.loads((HERE/'helper-pins.json').read_text()).items():
 assert hashlib.sha256((DEPLOY/name).read_bytes()).hexdigest()==pin, 'Harness source differs'
spec=importlib.util.spec_from_file_location('original_signed_qualification',DEPLOY/'qualify-upgrade.py')
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
ROOT=pathlib.Path('/opt/relay-updater')
EXPECTED=json.loads((HERE/'expected-inventory.json').read_text())
RECON=json.loads((HERE/'reconstruction.json').read_text())
assert RECON['passed'] and RECON['entirePathSetMatched']
assert {x['path'] for x in RECON['files']}=={x['path'] for x in EXPECTED if x['kind']=='file'}
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(65536),b''):h.update(b)
 return h.hexdigest()
def inventory(root):
 assert {p.relative_to(root).as_posix() for p in root.rglob('*')}=={e['path'] for e in EXPECTED},'Mixed path set differs'
 actual=[]
 for e in EXPECTED:
  p=root/e['path'];s=p.lstat()
  a=dict(path=e['path'],kind='dir' if stat.S_ISDIR(s.st_mode) else 'file',uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,size=s.st_size,sha256=sha(p) if stat.S_ISREG(s.st_mode) else None)
  assert a==e,'Mixed bytes/metadata differ: '+e['path']
  actual.append(a)
 return actual
original_load=q.load_installed
loaded=[]
def load_mixed(old):
 assert old=='v0.6.4'
 inventory(ROOT)
 Engine,Broker=original_load('v0.4.2') # metadata really is 0.4.2; runtime stays 0.6.4
 for cls in (Engine,Broker):
  p=pathlib.Path(inspect.getfile(cls)).resolve(strict=True)
  expected=next(e for e in EXPECTED if e['path']==p.relative_to(ROOT).as_posix())
  assert sha(p)==expected['sha256']
  methods=[v for v in cls.__dict__.values() if inspect.isfunction(v)]
  assert methods and all(pathlib.Path(v.__code__.co_filename).resolve(strict=True)==p for v in methods)
  loaded.append(dict(className=cls.__name__,resolvedFile=str(p),sha256=sha(p),codeObjectOriginsVerified=True))
 for name,module in tuple(sys.modules.items()):
  if name.startswith('updater.') and getattr(module,'__file__',None):
   p=pathlib.Path(module.__file__).resolve(strict=True)
   e=next(e for e in EXPECTED if e['path']==p.relative_to(ROOT).as_posix())
   assert sha(p)==e['sha256']
 return Engine,Broker
q.load_installed=load_mixed
original_apply=q.install.apply_install
def apply_mixed(work,manifest,version,private_lan=None):
 assert version=='v0.6.4' and not ROOT.exists()
 # All signed source manifests and payload hashes checked BEFORE host mutation.
 public=pathlib.Path(os.environ['MIXED_PUBLIC'])
 archives={}
 records=json.loads((HERE/'historical-verification-commands.json').read_text())
 for tag in ('v0.4.2','v0.6.3','v0.6.4'):
  directory=public/tag
  with tempfile.TemporaryDirectory(dir=public) as home:
   # Exact source digest taken from retained original accepted command record.
   record=records[tag]
   argv=record.get('argv',record.get('command'))
   if isinstance(argv,str):
    import shlex
    argv=shlex.split(argv)
   assert isinstance(argv,list) and '--source-digest' in argv
   source=argv[argv.index('--source-digest')+1]
   q.install.run(['/usr/bin/gh','attestation','verify',str(directory/'relay-release.json'),'--bundle',str(directory/'relay-release.attestation.json'),'--repo','murmuur22/relay','--signer-workflow','murmuur22/relay/.github/workflows/release.yml','--source-ref','refs/tags/'+tag,'--source-digest',source,'--signer-digest',source,'--deny-self-hosted-runners'],timeout=90,home=home)
  m=json.loads((directory/'relay-release.json').read_text());a=m['updaterArtifact'];p=directory/a['name']
  assert m['version']==tag and p.stat().st_size==a['size'] and sha(p)==a['sha256']
  archives[tag]=tarfile.open(p,'r:gz')
 mixed=work/'mixed-control';mixed.mkdir(mode=0o755)
 try:
  for e in sorted(EXPECTED,key=lambda x:(len(pathlib.PurePosixPath(x['path']).parts),x['kind']!='dir',x['path'])):
   relative=pathlib.PurePosixPath(e['path']);assert not relative.is_absolute() and '..' not in relative.parts
   p=mixed/e['path']
   if e['kind']=='dir':p.mkdir(mode=e['mode']);continue
   record=next(x for x in RECON['files'] if x['path']==e['path']);source=record['source'];archive=archives[source['tag']]
   members=[m for m in archive.getmembers() if m.name.removeprefix('./')==source['archivePath']]
   assert len(members)==1 and members[0].isfile() and members[0].mode==source['mode']
   raw=archive.extractfile(members[0]).read()
   assert len(raw)==e['size'] and hashlib.sha256(raw).hexdigest()==e['sha256']
   q.install.write_new(p,raw,e['mode'])
 finally:
  for a in archives.values():a.close()
 inventory(mixed)
 shutil.rmtree(work/'control');mixed.rename(work/'control')
 original_apply(work,manifest,version,private_lan)
 inventory(ROOT)
original_command=q.worker_command
def worker_command(*args,**kwargs):
 assert not kwargs.get('delivery',False)
 for name in ('qualify-mixed.py','expected-inventory.json','reconstruction.json','helper-pins.json','historical-verification-commands.json'):
  q.install.write_new(q.HARNESS/name,(HERE/name).read_bytes())
 command=original_command(*args,**kwargs)
 return [str(q.HARNESS/'qualify-mixed.py') if v==str(q.HARNESS/'qualify-upgrade.py') else v for v in command]
q.worker_command=worker_command
q.install.apply_install=apply_mixed
original_worker=q.installed_worker
def worker(*args,**kwargs):
 result=original_worker(*args,**kwargs)
 actual=inventory(ROOT)
 assert result['passed'] and result['webBootstrap'] is None and not result['deliveryCycle']
 result.update(controlPlane='EXACT_MIXED_042_METADATA_063PLUS_BROKER_064_WEB',loadedCode=loaded,mixedInventory=actual,profileAccepted=True,liveTargetAdmitted=False,productionTouched=False,operatorReady=False,configuration='synthetic disposable original schema; not production-exact',historicalPreviousRuntime='v0.6.3 history NOT reconstructed as a matching-state checkpoint',webBootstrap=None,runtimePresentationDelivery=False)
 return result
q.installed_worker=worker
original_select=q.select_target
def select_pinned_target(engine,target):
 manifest=original_select(engine,target)
 assert target=='v0.6.6' and manifest['artifact']['sha256']=='1fd753cd29189bcaa859de43f4bd379315d9e14b0354a64785a04249e5aa647b'
 return manifest
q.select_target=select_pinned_target
if __name__=='__main__':
 assert '--version' in sys.argv and sys.argv[sys.argv.index('--version')+1]=='v0.6.6'
 q.main()
