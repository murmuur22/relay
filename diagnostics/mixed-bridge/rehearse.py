#!/usr/bin/env python3
"""Independent exact-mixed disposable adapter. No production or alternate-host CLI.

The unchanged stock installer/bootstrap guards are recipes, never bypassed.
Only this fresh-host producer constructs synthetic configuration and signed mixed
code. All stdout, secrets, backups and state remain private to the owned VM.
"""
import os,sys,json,hashlib,shutil,stat,signal,subprocess,time,importlib.util,pwd,grp,socket,threading,traceback,re,resource
from pathlib import Path
sys.dont_write_bytecode=True
K=Path(__file__).resolve().parent
P=Path('/var/lib/relay-mixed-private');B=Path('/root/relay-mixed-backups')
C=Path('/opt/relay-updater');H=Path('/var/lib/relay-mixed-browser')
ROOTS=('/opt/relay','/opt/relay-updater','/etc/relay-updater','/var/lib/relay','/var/lib/relay-updater','/var/lib/relay-updater-control','/run/relay-updater-control',str(B),str(H))
UNITS=('relay.service','relay-updater-broker.service','relay-updater-web.service')
CHANGES=('updater/web/server.mjs','updater/web/presentation.mjs')
NEW={'updater/web/server.mjs':'d6869f62e239e0ff016287355c0f051624d3f4686e0208a8efb64dd18b7237a9','updater/web/presentation.mjs':'25d86a8a484a7d772f33a9b994fa2f72b5949a66f177a699b6b319a8f640f711'}
R=dict(passed=False,gates={},commands=[],downtimeSeconds=[],liveHostChanges='NONE',platform='Ubuntu 24.04 x64 native systemd hosted VM',operatorDistro='Debian 13 x64 (not executed)',productionEligible=False)
STAGE='initial-admission'
def save():
 P.mkdir(mode=0o700,exist_ok=True);tmp=P/'result.next';tmp.write_text(json.dumps(R,indent=2)+'\n');os.replace(tmp,P/'result.json')
def gate(n,**fields):
 R['gates'][n]=dict(fields,passed=True);save()
def require(value,message):
 if not value:raise RuntimeError(message)
def boundary_failure(stderr,exit_code):
 # Prefix observations only, not syscall tracing. No variable message text escapes.
 # Locale is fixed by cmd; an unfamiliar/localized/child message stays unknown.
 prefixes=(('pam','pam-open-session',b'cannot open session: '),
           ('pam','pam-establish-credentials',b'failed to establish user credentials: '),
           ('group','initgroups-or-setgroups',b'cannot set groups: '),
           ('group','setgid',b'cannot set group id: '),
           ('user','setuid',b'cannot set user id: '),
           ('fork','fork',b'cannot create child process: '),
           ('exec','exec',b'failed to execute '))
 # util-linux 2.39.3 sanitize_prlimits ignores setrlimit return values; there
 # is no reliable resource-limit prefix. Never infer it from EPERM alone.
 observed=[]
 lines=stderr[:65536].splitlines()
 for stage,operation,prefix in prefixes:
  if any(line.startswith(b'runuser: '+prefix) for line in lines):
   observed.append(dict(stage=stage,operation=operation))
 if any(re.fullmatch(rb'runuser: user [^\r\n]{1,256} does not exist or the user entry does not contain all the required fields',line) for line in lines):
  observed.append(dict(stage='user',operation='user-lookup'))
 if any(line==b'runuser: may not be used by non-root users' for line in lines):
  observed.append(dict(stage='user',operation='caller-not-root'))
 symptoms=[name for name,token in (('operation-not-permitted',b'Operation not permitted'),('permission-denied',b'Permission denied'),('resource-unavailable',b'Resource temporarily unavailable'),('not-found',b'No such file or directory')) if any(line.endswith(b': '+token) for line in lines)]
 return dict(schema=1,exit=exit_code,passed=exit_code==0,classification=observed[0]['stage'] if len(observed)==1 else 'unknown',prefixObservations=observed,symptoms=symptoms,attribution='fixed-prefix-observation-not-syscall-proof',resourceLimitCause='unknown',stderrTruncated=len(stderr)>65536)

def boundary_context():
 # Fixed proc fields only; never environment, raw PAM policy, logs or config.
 fields={}
 for line in Path('/proc/self/status').read_text().splitlines():
  key,_,value=line.partition(':');value=value.strip()
  if key in ('Uid','Gid','Groups') and re.fullmatch(r'[0-9\t ]*',value):fields[key]=[int(x) for x in value.split()][:256]
  elif key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb') and re.fullmatch(r'[0-9a-f]{16}',value):fields[key]=value
  elif key in ('NoNewPrivs','Seccomp') and re.fullmatch(r'[0-9]',value):fields[key]=int(value)
 target=None
 try:
  u=pwd.getpwnam('runner');target=dict(uid=u.pw_uid,gid=u.pw_gid,groups=sorted(os.getgrouplist('runner',u.pw_gid))[:256])
 except KeyError:pass
 limits={}
 for name in ('RLIMIT_NICE','RLIMIT_RTPRIO','RLIMIT_FSIZE','RLIMIT_AS','RLIMIT_NOFILE','RLIMIT_NPROC'):
  limits[name]=list(resource.getrlimit(getattr(resource,name))) if hasattr(resource,name) else None
 pam={}
 for name in ('runuser','common-session','common-session-noninteractive'):
  p=Path('/etc/pam.d')/name
  tokens=set()
  if p.is_file():
   for line in p.read_text()[:65536].splitlines():
    if not line.lstrip().startswith('#'):tokens.update(line.split())
  pam[name]=dict(present=p.is_file(),modules={module:module in tokens for module in ('pam_rootok.so','pam_keyinit.so','pam_limits.so','pam_unix.so','pam_systemd.so','pam_deny.so','pam_permit.so')},includes={inc:inc in tokens for inc in ('common-auth','common-account','common-session','common-session-noninteractive')})
 v=subprocess.run(['/usr/sbin/runuser','--version'],capture_output=True,timeout=5,env=dict(PATH='/usr/bin:/bin',LANG='C'))
 match=re.fullmatch(rb'runuser from util-linux ([0-9]+\.[0-9]+\.[0-9]+)\n',v.stdout)
 effective=int(fields.get('CapEff','0'),16)
 return dict(schema=1,stage='immediately-before-runuser',proc=fields,targetRunner=target,capabilities={name:bool(effective&(1<<bit)) for name,bit in (('SETGID',6),('SETUID',7),('SYS_RESOURCE',24),('AUDIT_WRITE',29))},limits=limits,pamPolicy=pam,runuserVersion=match.group(1).decode() if match else 'unknown',pamExecution='not-observed; prefix diagnostics follow',rawConfigurationExported=False)

def cmd(args,timeout=120,cwd=None,env=None):
 r=subprocess.run(args,cwd=cwd,env=env or dict(PATH='/usr/bin:/bin',LANG='C.UTF-8',HOME='/nonexistent',GH_CONFIG_DIR='/nonexistent',PYTHONDONTWRITEBYTECODE='1'),stdin=subprocess.DEVNULL,capture_output=True,timeout=timeout)
 record=dict(tool=Path(args[0]).name,argv=args,exit=r.returncode,stage=STAGE)
 if Path(args[0]).name=='runuser':
  record['boundaryFailure']=boundary_failure(r.stderr,r.returncode)
 if r.returncode and Path(args[0]).name=='runuser':
  # Fixed symptom vocabulary only: never publish raw child stderr/spec/secrets.
  record['browserBootstrapSymptoms']=[s for s in ('ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','EACCES','EPERM','ENOENT','Permission denied','Operation not permitted','cannot open session','failed to execute','SyntaxError','ERR_REQUIRE_ASYNC_MODULE') if s.encode() in r.stderr]
 R['commands'].append(record)
 if r.returncode:raise RuntimeError('command-failed')
 return r.stdout.decode().strip()
def load(name,file):
 s=importlib.util.spec_from_file_location(name,K/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
helper=load('mixed_stock_recipe','qualify-presentation-bootstrap.py');base=helper.base;install=base.install

def inventory(p):return helper.inventory(Path(p))
def identity(u):return base.service_identity(u)
def hashfile(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def exact(root):
 rows=json.loads((K/'baseline.json').read_text());observed={}
 for p in Path(root).rglob('*'):
  rel=p.relative_to(root).as_posix();s=p.lstat();r=dict(path=rel,kind='directory' if stat.S_ISDIR(s.st_mode) else 'file',uid=s.st_uid,gid=s.st_gid,mode=oct(stat.S_IMODE(s.st_mode)),nlink=s.st_nlink)
  require(not stat.S_ISLNK(s.st_mode) and (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)),'unsafe-entry')
  if stat.S_ISREG(s.st_mode):r.update(size=s.st_size,sha256=hashfile(p))
  observed[rel]=r
 expected={r['path']:{k:v for k,v in r.items() if k not in ('sourceTag','sourcePath')} for r in rows}
 require(observed==expected,'exact-path-byte-uid-gid-mode-link-mismatch')
 return observed

def sources():
 from updater.broker import releases as api
 pins=json.loads((K/'sources.json').read_text());dirs={};summary={}
 for tag,pin in pins.items():
  d=P/tag;d.mkdir(mode=0o700)
  for name,limit in [('relay-release.json',1024*1024),('relay-release.attestation.json',4*1024*1024)]:api.transfer('https://github.com/murmuur22/relay/releases/download/'+tag+'/'+name,d/name,limit=limit)
  require(hashfile(d/'relay-release.json')==pin['manifestSha256'],'manifest-pin-differs')
  actual=cmd(['/usr/bin/git','ls-remote','https://github.com/murmuur22/relay.git','refs/tags/'+tag])
  require(actual.split()[0]==pin['source'],'tag-source-differs')
  home=d/'anonymous-home';home.mkdir(mode=0o700)
  cmd(['/usr/bin/gh','attestation','verify',str(d/'relay-release.json'),'--bundle',str(d/'relay-release.attestation.json'),'--repo','murmuur22/relay','--signer-workflow','murmuur22/relay/.github/workflows/release.yml','--source-ref','refs/tags/'+tag,'--source-digest',pin['source'],'--signer-digest',pin['source'],'--deny-self-hosted-runners'],timeout=90,env=dict(PATH='/usr/bin:/bin',LANG='C.UTF-8',HOME=str(home),GH_CONFIG_DIR=str(d/'no-config'),GH_PROMPT_DISABLED='1'))
  m=api.manifest_valid(json.loads((d/'relay-release.json').read_text()),tag);require(m==pin['manifest'],'manifest-fields-differ')
  artifacts=['updaterArtifact']+(['artifact'] if tag in ('v0.6.11','v0.6.8') else [])
  for key in artifacts:
   desc=m[key];archive=d/desc['name'];api.transfer('https://github.com/murmuur22/relay/releases/download/'+tag+'/'+desc['name'],archive,limit=desc['size']);api.verify_artifact(archive,desc,updater=key=='updaterArtifact')
  api.extract(d/m['updaterArtifact']['name'],d/'control');(d/'control').chmod(0o755)
  dirs[tag]=d/'control';summary[tag]=dict(source=pin['source'],manifestSha256=pin['manifestSha256'],verifiedArtifacts=artifacts,anonymousAttestationExit=0)
 return dirs,summary

def reconstruct(dirs):
 C.mkdir(mode=0o755)
 rows=json.loads((K/'baseline.json').read_text())
 for r in sorted(rows,key=lambda r:(r['path'].count('/'),r['path'])):
  p=C/r['path']
  if r['kind']=='directory':p.mkdir(mode=int(r['mode'],8))
  else:
   src=dirs[r['sourceTag']]/r['sourcePath'];require(hashfile(src)==r['sha256'] and src.stat().st_size==r['size'],'source-byte-mismatch');shutil.copy2(src,p)
  p.chmod(int(r['mode'],8));os.chown(p,r['uid'],r['gid'])
 exact(C)

def fixture(dirs,ip):
 # Separate producer derived from public templates; no installed/private unit input.
 for n in ('relay','relay-updater-web','relay-updater-socket'):cmd(['/usr/sbin/groupadd','--system',n])
 for n in ('relay','relay-updater-web'):cmd(['/usr/sbin/useradd','--system','--gid',n,'--groups','relay-updater-socket','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',n])
 relay=pwd.getpwnam('relay')
 for n in ROOTS:
  if n in (str(C),str(B),str(H)):continue
  Path(n).mkdir(mode=0o755);Path(n).chmod(0o700 if n in ('/var/lib/relay','/var/lib/relay-updater') else 0o755)
 os.chown('/var/lib/relay',relay.pw_uid,relay.pw_gid)
 B.mkdir(mode=0o700);H.mkdir(mode=0o700);runner=pwd.getpwnam('runner');os.chown(H,runner.pw_uid,runner.pw_gid)
 net=install.deployment_network(ip);base.NETWORK=net
 write=install.write_new
 write('/etc/relay-updater/bridge.key',os.urandom(48),0o640,relay.pw_gid)
 conf=dict(mode='production',networkMode='private-lan',uiOrigin=net['uiOrigin'],readinessUrl=net['relayOrigin']+'/health/ready',relayUid=relay.pw_uid,socketGid=grp.getgrnam('relay-updater-socket').gr_gid,installRoot='/opt/relay',stateRoot='/var/lib/relay',controlRoot='/var/lib/relay-updater',maintenance=str(base.GATE),socketPath='/run/relay-updater-control/broker.sock',bridgeKeyFile='/etc/relay-updater/bridge.key',node='/usr/bin/node',python='/usr/bin/python3',gh='/usr/bin/gh')
 write('/etc/relay-updater/broker.json',json.dumps(conf))
 write('/etc/relay-updater/web.json',json.dumps(dict(uiOrigin=net['uiOrigin'],relayOrigin=net['relayOrigin'],networkMode='private-lan',socketPath=conf['socketPath'],bind=ip)),0o644)
 write('/etc/relay-updater/relay.env','PORT=4180\nRELAY_UPDATER_SOCKET='+conf['socketPath']+'\nRELAY_UPDATER_BRIDGE_KEY_FILE='+conf['bridgeKeyFile']+'\nRELAY_UPDATER_UI_ORIGIN='+net['uiOrigin']+'\nRELAY_NETWORK_MODE=private-lan\nRELAY_HOSTNAME='+ip+'\n',0o640,relay.pw_gid)
 write(base.GATE,b'',0o644)
 for unit,src in install.UNIT_SOURCES.items():write('/etc/systemd/system/'+unit,(dirs['v0.6.11']/src).read_bytes(),0o644)
 cmd(['/usr/bin/systemd-analyze','verify',*('/etc/systemd/system/'+u for u in UNITS)])
 cmd(['/usr/bin/systemctl','daemon-reload'])
 # Genuine installed mixed broker verifier/enrollment, no fixture HMAC/receipt injection.
 cmd(['/usr/bin/python3','-B','-m','updater.broker.enroll','--config','/etc/relay-updater/broker.json','--version','v0.6.11'],timeout=480,cwd=str(C))
 receipt=json.loads(Path('/opt/relay/current/.relay-verified.json').read_text())
 require(receipt==dict(mode='production',version='v0.6.11',sha256=json.loads((K/'sources.json').read_text())['v0.6.11']['manifest']['artifact']['sha256']),'baseline-receipt-differs')
 base.ungate();cmd(['/usr/bin/systemctl','start',*UNITS]);base.wait_control();base.ready('v0.6.11',False)
 return conf

def bootstrap(dirs,password):
 global STAGE
 STAGE='baseline-enrollment';cookie,csrf=base.authenticate(password)
 require(base.http(4180,'/api/onboarding/complete','POST',{},cookie,csrf)[0]==200,'onboarding-failed')
 require(base.http(4180,'/api/preferences','PATCH',dict(introAnimation=False,interfaceAnimations=False),cookie,csrf)[0]==200,'preferences-failed')
 exact(C);base.isolation();gate('exactMixedBaseline',entries=len(json.loads((K/'baseline.json').read_text())),runtime='v0.6.11',syntheticAdminEnrolled=True)
 journal=json.loads(Path('/var/lib/relay-updater/journal.json').read_text())
 require(journal.get('job') is None and journal.get('checkpoint') is None and not base.GATE.exists(),'active-update-before-bootstrap')
 protected={'config':Path('/etc/relay-updater'),**{u:Path('/etc/systemd/system')/u for u in UNITS}}
 protected_before={k:inventory(v) for k,v in protected.items()}
 state_before=helper.inventory(Path('/var/lib/relay'),uid=pwd.getpwnam('relay').pw_uid)
 ids={u:identity(u) for u in UNITS[:2]};runtime=Path('/opt/relay/current').resolve()
 def stable():
  require(all(identity(u)==v for u,v in ids.items()) and runtime==Path('/opt/relay/current').resolve(),'broker-relay-identity-changed')
  require(helper.inventory(Path('/var/lib/relay'),uid=pwd.getpwnam('relay').pw_uid)==state_before,'state-changed-during-bootstrap')
  require({k:inventory(v) for k,v in protected.items()}==protected_before,'config-unit-changed')
 downtime=[None]
 def stop():
  if downtime[0] is None:downtime[0]=time.monotonic()
  cmd(['/usr/bin/systemctl','stop','relay-updater-web.service']);require(cmd(['/usr/bin/systemctl','show','relay-updater-web.service','-p','MainPID','--value'])=='0','web-not-stopped')
  with socket.socket() as s:require(s.connect_ex((base.NETWORK['bind'],4191))!=0,'stopped-web-listener-live')
  stable()
 def start():
  if cmd(['/usr/bin/systemctl','show','relay-updater-web.service','-p','ActiveState','--value'])=='failed':
   cmd(['/usr/bin/systemctl','reset-failed','relay-updater-web.service'])
  cmd(['/usr/bin/systemctl','start','relay-updater-web.service']);base.wait_control();stable()
  status,_,_=base.raw_http(4191,'/updater/');require(status==200,'web-index-not-ready')
  R['downtimeSeconds'].append(round(time.monotonic()-downtime[0],6));downtime[0]=None
 def restore(backup):
  # Quarantine the exact owned reader rather than delete it during recovery.
  reader=C/CHANGES[1]
  if reader.exists():
   require(hashfile(reader)==NEW[CHANGES[1]],'foreign-reader-refused');shutil.copy2(reader,backup/'quarantined-presentation.mjs')
  helper.restore_web(C,dirs['v0.6.5'],backup,stop)
  exact(C);start();require(base.raw_http(4191,'/updater/')[1]==(C/'updater/ui/dist/index.html').read_bytes(),'restored-fallback-not-exact')
 def interrupt(phase):
  if phase=='server-replaced':raise InterruptedError('owned-partial-operation')
 STAGE='partial-restore';backup=B/'partial'
 try:helper.replace_web(C,dirs['v0.6.5'],backup,stop,checkpoint=interrupt,protected=protected)
 except InterruptedError:restore(backup)
 else:raise RuntimeError('interruption-not-exercised')
 gate('partialOperationRestore',backupRetained=True,identitiesPreserved=True)
 STAGE='startup-failure-restore';backup=B/'startup'
 helper.replace_web(C,dirs['v0.6.5'],backup,stop,protected=protected)
 server=C/CHANGES[0];server.chmod(0o000);denied=False
 try:
  cmd(['/usr/bin/systemctl','start','relay-updater-web.service'])
  deadline=time.monotonic()+8
  while time.monotonic()<deadline:
   state=cmd(['/usr/bin/systemctl','show','relay-updater-web.service','-p','ExecMainStatus','--value'])
   if state!='0':denied=True;break
   time.sleep(.1)
 finally:
  stop();server.chmod(0o644)
 require(denied,'unprivileged-DAC-fault-did-not-fail');restore(backup)
 gate('unprivilegedStartupFailureRestore',actualDACFailure=True,backupRetained=True,identitiesPreserved=True)
 STAGE='final-apply';backup=B/'final';expected=helper.replace_web(C,dirs['v0.6.5'],backup,stop,protected=protected)
 for name,digest in NEW.items():require(hashfile(C/name)==digest,'candidate-pin-mismatch')
 start();helper.admit_baseline(C,expected);stable();base.isolation()
 for headers in ({'Host':'wrong.invalid:4191'},{'Origin':'http://wrong.invalid:4191'}):require(base.raw_http(4191,'/updater/',headers=headers)[0]==403,'host-origin-denial-failed')
 require(base.http(4191,'/updater/api/state')[0]==401,'anonymous-state-admitted')
 status,index,headers=base.raw_http(4191,'/updater/')
 require(status==200 and headers.get('x-relay-updater-presentation')=='v0.6.11' and 'x-frame-options' not in headers,'bridge-index-failed')
 require([s.strip() for s in headers['content-security-policy'].split(';') if s.strip().startswith('frame-ancestors')]==['frame-ancestors '+base.NETWORK['relayOrigin']],'wrong-frame-ancestor')
 base.presentation_probe('v0.6.11')
 gate('protectedBackupAndApply',exactTwoFiles=True,backupReadback=True,brokerRelayPIDStartUnchanged=True,stateConfigUnitsUnchanged=True,webOnlyStopStart=True)
 gate('presentationAndHardening',version='v0.6.11',allDescriptorAssetsAndFontsExact=True,exactFrameAncestor=True,anonymousHostOriginDenied=True,actualUnprivilegedNoNewPrivsZeroCapEff=True)
 return expected

def private_json(path,uid,limit=65536):
 # Fixed owned parent; descriptor no-follow and a hard read bound before JSON.
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);require(stat.S_ISREG(s.st_mode) and s.st_uid==uid and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size<=limit,'unsafe-private-receipt')
  raw=os.read(fd,limit+1);require(len(raw)<=limit,'oversized-private-receipt')
  value=json.loads(raw);require(isinstance(value,dict),'invalid-private-receipt');return value
 finally:os.close(fd)
def private_write(path,value):
 tmp=path.with_suffix('.next')
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'w') as f:json.dump(value,f);f.flush();os.fsync(f.fileno())
  os.replace(tmp,path)
 finally:
  if tmp.exists():tmp.unlink()
def unit_snapshot(unit):
 fields=('LoadState','ActiveState','SubState','Result','ExecMainPID','MainPID','ExecMainCode','ExecMainStatus','InvocationID','ControlGroup','User','Group','NoNewPrivileges','CapabilityBoundingSet')
 raw=cmd(['/usr/bin/systemctl','show',unit,*('-p'+f for f in fields)])
 return dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
def stop_fixture_unit(unit):
 if cmd(['/usr/bin/systemctl','show',unit,'-p','LoadState','--value'])=='not-found':return
 cmd(['/usr/bin/systemctl','stop',unit],timeout=130)
 require(cmd(['/usr/bin/systemctl','show',unit,'-p','MainPID','--value'])=='0','fixture-process-live')
 if cmd(['/usr/bin/systemctl','show',unit,'-p','ActiveState','--value'])=='failed':cmd(['/usr/bin/systemctl','reset-failed',unit])
def browser_service():
 # Called only by the existing trusted fixture owner, never the hardened worker.
 runner=pwd.getpwnam('runner');require(runner.pw_uid>0 and runner.pw_gid>0,'root-browser-refused')
 properties=['User=runner','Group='+grp.getgrgid(runner.pw_gid).gr_name,'WorkingDirectory=/opt/relay-updater','UMask=0077','NoNewPrivileges=true','CapabilityBoundingSet=','ProtectSystem=strict','ProtectHome=true','ReadWritePaths='+str(H),'PrivateTmp=true','MemoryMax=2G','TasksMax=256','LimitNOFILE=8192','LimitFSIZE=8M','RuntimeMaxSec=420','TimeoutStopSec=30','SendSIGKILL=no','KillMode=control-group','Type=exec','RemainAfterExit=yes','BindsTo=relay-mixed-lifecycle.service','After=relay-mixed-lifecycle.service','PartOf=relay-mixed-owner.service']
 args=['/usr/bin/systemd-run','--unit=relay-mixed-browser',*('--property='+p for p in properties),'/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME='+str(H),'TMPDIR='+str(H),'PLAYWRIGHT_BROWSERS_PATH=/opt/relay/current/browsers','/usr/bin/node',str(K/'browser.mjs'),str(H/'input.json')]
 record=dict(passed=False,expectedUid=runner.pw_uid,expectedGid=runner.pw_gid)
 try:
  cmd(args,timeout=15)
  initial=unit_snapshot('relay-mixed-browser.service');record['initial']=initial
  require(initial['User']=='runner' and initial['NoNewPrivileges']=='yes' and initial['CapabilityBoundingSet']=='','browser-service-security-mismatch')
  invocation=initial['InvocationID'];require(re.fullmatch('[0-9a-f]{32}',invocation),'browser-invocation-missing')
  end=time.monotonic()+425
  while True:
   current=unit_snapshot('relay-mixed-browser.service');record['lastObserved']=current
   require(current['InvocationID']==invocation,'browser-invocation-changed')
   if current['SubState']=='exited' or current['ActiveState']=='failed':break
   require(time.monotonic()<end,'browser-service-deadline');time.sleep(.2)
  record['final']=current
  require(current['Result']=='success' and current['ExecMainCode']=='1' and current['ExecMainStatus']=='0','browser-service-failed')
  browser=private_json(H/'browser-result.json',runner.pw_uid)
  require(browser.get('passed') is True and browser.get('browserCloseAcknowledged') is True and browser.get('cancelled') is False,'browser-result-not-passed')
  evidence=browser['bootstrap'];require(evidence['uid']==runner.pw_uid and evidence['euid']==runner.pw_uid and evidence['gid']==runner.pw_gid and evidence['procStatus']['CapEff']=='0000000000000000' and evidence['procStatus']['NoNewPrivs']=='1','browser-process-security-mismatch')
  cg=Path('/sys/fs/cgroup')/current['ControlGroup'].lstrip('/')
  require((cg/'cgroup.events').exists() and 'populated 0' in (cg/'cgroup.events').read_text(),'browser-cgroup-not-empty')
  record.update(passed=True,cgroupEmpty=True)
 finally:
  stop_fixture_unit('relay-mixed-browser.service')
  record['stopped']=True
  R['browserService']=record;private_write(P/'browser-service.json',record);save()

def lifecycle(conf,password):
 global STAGE
 STAGE='signed-lifecycle'
 # This separately labelled phase stops the original broker and opens one exact
 # installed Engine/Broker in a broker-equivalent hardened worker. Not bootstrap.
 cmd(['/usr/bin/systemctl','stop','relay-updater-broker.service'])
 spec=H/'input.json';private_write(spec,dict(password=password,origin=base.NETWORK['relayOrigin'],uiOrigin=base.NETWORK['uiOrigin'],expectedUid=pwd.getpwnam('runner').pw_uid,expectedGid=pwd.getpwnam('runner').pw_gid));os.chown(spec,pwd.getpwnam('runner').pw_uid,pwd.getpwnam('runner').pw_gid)
 properties=['User=root','Group=root','WorkingDirectory=/opt/relay-updater','UMask=0077','NoNewPrivileges=true','ProtectHome=true','ProtectSystem=strict','ReadWritePaths=/opt/relay /var/lib/relay /var/lib/relay-updater /var/lib/relay-updater-control /run/relay-updater-control /var/lib/relay-mixed-private /var/lib/relay-mixed-browser','PrivateTmp=true','ProtectKernelTunables=true','ProtectKernelModules=true','ProtectControlGroups=true','RestrictSUIDSGID=true','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK','LockPersonality=true','MemoryMax=3G','TasksMax=512','LimitNOFILE=8192','RuntimeMaxSec=600','TimeoutStopSec=120','SendSIGKILL=no']
 args=['/usr/bin/systemd-run','--unit=relay-mixed-lifecycle','--wait','--pipe','--collect',*('--property='+p for p in properties),'/usr/bin/python3','-B',str(K/'rehearse.py'),'worker']
 child=None
 try:
  child=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=dict(PATH='/usr/bin:/bin',LANG='C.UTF-8',PYTHONDONTWRITEBYTECODE='1'))
  end=time.monotonic()+90
  while not (P/'browser-ready.json').exists():
   require(child.poll() is None,'worker-exited-before-browser-ready');require(time.monotonic()<end,'worker-ready-deadline');time.sleep(.1)
  ready=private_json(P/'browser-ready.json',0);require(ready.get('ready') is True,'worker-not-ready')
  worker_unit=unit_snapshot('relay-mixed-lifecycle.service');require(str(ready.get('pid'))==worker_unit['MainPID'] and worker_unit['User']=='root' and worker_unit['NoNewPrivileges']=='yes','worker-ready-identity-mismatch');R['workerService']=worker_unit
  browser_service()
  gate('separateBrowserService',**R['browserService'])
  code=child.wait(timeout=120);R['commands'].append(dict(tool='systemd-run',argv=args,exit=code,stage=STAGE));require(code==0,'worker-failed')
 finally:
  # Browser first: no synthetic user traffic may outlive its broker fixture.
  stop_fixture_unit('relay-mixed-browser.service')
  stop_fixture_unit('relay-mixed-lifecycle.service')
  if child:child.wait(timeout=15)
  if (P/'lifecycle.json').exists():R['lifecycleAttempt']=private_json(P/'lifecycle.json',0);save()
 result=json.loads((P/'lifecycle.json').read_text());require(result.get('passed') is True,'signed-lifecycle-failed')
 gate('signedLifecycle',**result)
 cmd(['/usr/bin/systemctl','start','relay-updater-broker.service']);base.wait_control()

def worker():
 global STAGE
 STAGE='signed-lifecycle'
 for name in tuple(sys.modules):
  if name=='updater' or name.startswith('updater.'):del sys.modules[name]
 sys.path.insert(0,str(C));from updater.broker.engine import Engine
 from updater.broker.server import Broker
 require(Path(sys.modules['updater.broker.engine'].__file__).resolve()==C/'updater/broker/engine.py','non-installed-engine-refused')
 conf=json.loads(Path('/etc/relay-updater/broker.json').read_text());base.NETWORK=install.deployment_network(conf['uiOrigin'].split('//')[1].split(':')[0])
 engine=Engine(conf);broker=None;t=None
 before={str(p):inventory(p) for p in [C,Path('/etc/relay-updater'),*(Path('/etc/systemd/system')/u for u in UNITS)]}
 web=identity('relay-updater-web.service');initial=engine.current_release();state={n:helper.inventory(Path('/var/lib/relay')/n,uid=pwd.getpwnam('relay').pw_uid) for n in ('accounts.json','users')}
 result:dict=dict(passed=False)
 def term(*_):
  signal.signal(signal.SIGTERM,signal.SIG_IGN);raise InterruptedError('owned-worker-cancellation')
 signal.signal(signal.SIGTERM,term)
 try:
  work=P/'runtime-selection';work.mkdir(mode=0o700)
  m=engine.releases.verified_manifest('v0.6.8',work)
  require(m==json.loads((K/'sources.json').read_text())['v0.6.8']['manifest'],'target-manifest-differs')
  entry=dict(version='v0.6.8',notes='Explicit signed disposable backward-version lifecycle fixture; not ordinary update discovery',size=m['artifact']['size'],verified=True)
  engine.releases.entries={'v0.6.8':entry};engine.available=[entry];engine.last_check=time.monotonic()
  # Cache only this already genuinely verified explicit fixture selection; do not
  # alter Releases.check or any installed implementation.
  broker=Broker(engine);t=threading.Thread(target=broker.serve_forever,kwargs={'poll_interval':.1},daemon=True);t.start();base.wait_control()
  # Browser drives real compiled native launcher, password denial, immediate install,
  # original monitor reads through shutdown, genuine re-login, and matching rollback.
  result['workerSecurity']=boundary_context();result['workerSecurity']['stage']='broker-worker-before-browser-ready'
  private_write(P/'browser-ready.json',dict(ready=True,pid=os.getpid()))
  private_write(P/'lifecycle.json',result)
  deadline=time.monotonic()+460
  while not (P/'browser-service.json').exists():
   require(time.monotonic()<deadline,'browser-service-result-deadline');time.sleep(.1)
  service=private_json(P/'browser-service.json',0);require(service.get('passed') is True and service.get('stopped') is True,'browser-service-not-passed')
  browser=private_json(H/'browser-result.json',pwd.getpwnam('runner').pw_uid);require(browser.get('passed') is True,'browser-not-passed')
  engine.thread.join(30);require(not engine.thread.is_alive(),'engine-thread-live')
  require(engine.data['currentVersion']=='v0.6.11' and engine.current_release()==initial,'matching-runtime-not-restored')
  successful=[j for j in engine.data['history'] if j.get('version')=='v0.6.8' and j.get('phase')=='succeeded'];require(len(successful)==1,'signed-install-history-missing')
  checkpoint=engine.root/('backup-'+successful[0]['id']);require(checkpoint.is_dir(),'matching-checkpoint-missing')
  state={n:helper.inventory(checkpoint/n,uid=pwd.getpwnam('relay').pw_uid) for n in ('accounts.json','users')}
  require({n:helper.inventory(Path('/var/lib/relay')/n,uid=pwd.getpwnam('relay').pw_uid) for n in state}==state,'accounts-users-differ-from-matching-checkpoint')
  mutation=json.loads((H/'mutation.json').read_text());require(mutation.get('itemId'),'post-install-mutation-not-exercised')
  require(all(mutation['itemId'] not in p.read_text() for p in Path('/var/lib/relay/users').rglob('desktop.json')),'post-install-folder-not-restored')
  require(identity('relay-updater-web.service')==web and {str(p):inventory(p) for p in map(Path,before)}==before,'control-or-web-changed')
  candidate=Path('/opt/relay/releases')/('v0.6.8-'+m['artifact']['sha256'][:16]);require(candidate.exists(),'signed-runtime-target-never-existed')
  engine.prune();require(not candidate.exists(),'obsolete-target-not-pruned')
  pin=json.loads((H/'retained-assets.json').read_text())
  for r in pin:
   status,raw,_=base.raw_http(4191,'/updater/presentation/v0.6.8/'+r['path']);require(status==200 and hashlib.sha256(raw).hexdigest()==r['sha256'],'lazy-pin-lost-after-prune')
  result.update(browser,passed=True,signedBaseline='v0.6.11',signedExplicitTarget='v0.6.8',matchingRollback='v0.6.11',notForwardUpgrade=True,originalEngineBytes=True,matchingAccountsAndState=True,prunedTargetLazyAssetsRetained=True,webConfigUnitsUnchanged=True)
 except BaseException as e:
  result['error']=dict(type=type(e).__name__,frames=[dict(file=Path(f.filename).name,line=f.lineno,function=f.name) for f in traceback.extract_tb(e.__traceback__)])
  result['commands']=R['commands']
  raise
 finally:
  if (H/'browser-result.json').exists():result['browserAttempt']=json.loads((H/'browser-result.json').read_text())
  if broker:broker.shutdown();t.join(10);broker.server_close();require(not t.is_alive(),'broker-thread-live')
  engine.close();(P/'lifecycle.json').write_text(json.dumps(result))
 return 0

def cleanup():
 if not (P/'ownership.json').exists():return 0
 own=json.loads((P/'ownership.json').read_text());require(own.get('admitted') is True,'ownership-not-admitted')
 errors=[]
 for unit in ('relay-mixed-browser.service','relay-mixed-lifecycle.service',*UNITS):
  try:
   if cmd(['/usr/bin/systemctl','show',unit,'-p','LoadState','--value'])=='not-found':continue
   cmd(['/usr/bin/systemctl','stop',unit],timeout=130)
   require(cmd(['/usr/bin/systemctl','show',unit,'-p','MainPID','--value'])=='0','cleanup-pid-live')
   code=cmd(['/usr/bin/systemctl','show',unit,'-p','ExecMainStatus','--value']);require(code!='9','SIGKILL-not-accepted')
  except Exception:errors.append('unit:'+unit)
 if errors:raise RuntimeError('unit-cleanup-failed')
 for unit in UNITS:
  p=Path('/etc/systemd/system')/unit
  if p.exists():p.unlink()
 cmd(['/usr/bin/systemctl','daemon-reload'])
 for n in ROOTS:
  p=Path(n)
  if p.exists():require(not p.is_symlink(),'foreign-root-link');shutil.rmtree(p)
 for user in ('relay-updater-web','relay'):
  try:pwd.getpwnam(user)
  except KeyError:continue
  cmd(['/usr/sbin/userdel',user])
 for group in ('relay-updater-web','relay','relay-updater-socket'):
  try:grp.getgrnam(group)
  except KeyError:continue
  cmd(['/usr/sbin/groupdel',group])
 require(all(not os.path.lexists(p) for p in ROOTS),'owned-paths-remain')
 for u in ('relay-mixed-browser.service','relay-mixed-lifecycle.service',*UNITS):require(cmd(['/usr/bin/systemctl','show',u,'-p','LoadState','--value'])=='not-found','owned-unit-remains')
 for port in (4180,4191):
  with socket.socket() as s:require(s.connect_ex((own['ip'],port))!=0,'owned-listener-remains')
 prior=json.loads((P/'result.json').read_text())
 final_restore=prior.get('gates',{}).get('finalExactBaselineRestore',{}).get('passed') is True
 (P/'cleanup.json').write_text(json.dumps(dict(passed=True,pathsRemoved=True,identitiesRemoved=True,unitsUnloaded=True,listenersClosed=True,privateBackupsDisposed=True,finalBaselineRestoreReached=final_restore,privateBackupsRetainedThroughFinalRestoreThenDisposed=True if final_restore else None)))
 return 0

def run():
 global STAGE
 require(sys.platform=='linux' and os.geteuid()==0 and os.uname().machine=='x86_64','not-linux-root-x64')
 for k,v in dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='murmuur22/relay',GITHUB_REF='refs/heads/diag/relay-mixed-presentation-bridge',RELAY_MIXED_ACK='MIXED_BRIDGE_DISPOSABLE_HOST_ONLY').items():require(os.environ.get(k)==v,'hosted-admission-failed')
 require(Path('/run/systemd/system').is_dir() and 'VERSION_ID="24.04"' in Path('/etc/os-release').read_text(),'not-ubuntu24-systemd')
 addresses=json.loads(cmd(['/usr/sbin/ip','-j','-4','address','show']))
 import ipaddress
 ip=next(a['local'] for i in addresses for a in i.get('addr_info',[]) if ipaddress.ip_address(a['local']).is_private and not ipaddress.ip_address(a['local']).is_loopback)
 base.guard(True,ip)
 for unit in ('relay-mixed-browser.service','relay-mixed-lifecycle.service'):
  require(cmd(['/usr/bin/systemctl','show',unit,'-p','LoadState','--value'])=='not-found','existing-fixture-unit-refused')
  for root in ('/etc/systemd/system','/run/systemd/system','/run/systemd/transient'):
   require(not os.path.lexists(Path(root)/unit) and not os.path.lexists(Path(root)/(unit+'.d')),'existing-fixture-unit-file-refused')
 for n in (*ROOTS,str(P)):require(not os.path.lexists(n),'existing-resource-refused')
 P.mkdir(mode=0o700);save()
 try:
  def term(*_):
   # Coalesce repeated TERM throughout recovery. Cancellation is non-success.
   signal.signal(signal.SIGTERM,signal.SIG_IGN)
   raise InterruptedError('owned-cancellation')
  signal.signal(signal.SIGTERM,term)
  STAGE='anonymous-provenance';dirs,summary=sources();gate('anonymousSourceAndPayloadVerification',sources=summary)
  # Fresh-host checks are repeated immediately before owning all fixture effects.
  base.guard(True,ip)
  (P/'ownership.json').write_text(json.dumps(dict(admitted=True,ip=ip,roots=ROOTS,units=UNITS)))
  STAGE='mixed-reconstruction';reconstruct(dirs);conf=fixture(dirs,ip)
  import secrets
  password=secrets.token_urlsafe(40)
  expected=bootstrap(dirs,password)
  lifecycle(conf,password)
  STAGE='final-baseline-restore'
  def stop():cmd(['/usr/bin/systemctl','stop','relay-updater-web.service'])
  helper.restore_web(C,dirs['v0.6.5'],B/'final',stop);exact(C)
  cmd(['/usr/bin/systemctl','start','relay-updater-web.service']);base.wait_control();base.ready('v0.6.11',False)
  require(base.raw_http(4191,'/updater/')[1]==(C/'updater/ui/dist/index.html').read_bytes(),'final-fallback-differs')
  gate('finalExactBaselineRestore',fallbackAndPreviousPreserved=True,backupsStillPresent=all((B/n/'control').exists() for n in ('partial','startup','final')))
  R['passed']=True
 except BaseException as e:
  R['error']=dict(stage=STAGE,type=type(e).__name__,frames=[dict(file=Path(f.filename).name,line=f.lineno,function=f.name) for f in traceback.extract_tb(e.__traceback__)])
  R['passed']=False
 finally:
  STAGE='owned-cleanup'
  try:cleanup();gate('ownedCleanup',**json.loads((P/'cleanup.json').read_text()))
  except BaseException as e:R['passed']=False;R['cleanupError']=type(e).__name__
  save()
 return 0 if R['passed'] else 1
def dispose():
 require(os.geteuid()==0 and K==Path('/opt/relay-mixed-kit'),'dispose-scope-refused')
 require(all(not os.path.lexists(p) for p in ROOTS),'fixture-resources-not-cleaned')
 if (P/'ownership.json').exists():require(json.loads((P/'cleanup.json').read_text()).get('passed') is True,'cleanup-not-acknowledged')
 admitted=(P/'ownership.json').exists()
 cleanup_receipt=json.loads((P/'cleanup.json').read_text()) if admitted else {}
 for p in (P,K):
  if p.exists():require(p.lstat().st_uid==0 and not p.is_symlink(),'dispose-ownership-refused');shutil.rmtree(p)
 require(not os.path.lexists(P) and not os.path.lexists(K) and not os.path.lexists(H),'private-inputs-retained')
 print(json.dumps(dict(schema=1,passed=True,ownedAdmission=admitted,privateKitAbsent=True,privateInputsAbsent=True,browserInputRootAbsent=True,fixtureRootsAbsent=True,finalBaselineRestoreReached=cleanup_receipt.get('finalBaselineRestoreReached'),backupRetentionThroughFinalRestore=cleanup_receipt.get('privateBackupsRetainedThroughFinalRestoreThenDisposed'))))
 return 0

if __name__=='__main__':
 try:sys.exit({'run':run,'worker':worker,'cleanup':cleanup,'dispose':dispose}[sys.argv[1]]())
 except Exception:
  print('Mixed rehearsal failed; inspect private receipt; no qualification claimed.',file=sys.stderr);sys.exit(1)
