"""Disposable official pre-policy qualification, NEVER an operator enable switch.

The unsigned target and in-process pre-policy adapter are intentionally not in
policy.FILES. Only this fresh-host supervisor may invoke the worker. A successful
JSON reduction is not attestation, publication, or final-distribution authority.
"""
import argparse
import contextlib
import signal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
from . import policy
from . import control_plane_upgrade_069 as c

ACK='I_ACCEPT_FRESH_DISPOSABLE_MIGRATION_QUALIFICATION'
ROOT=Path('/opt/relay-migration-qualification')
UNIT='relay-migration-qualification.service'
MIGRATIONS=Path('/var/lib/relay-control-plane-migrations')
OUTPUT=Path('/var/lib/relay-migration-qualification-output')

# Diagnostic vocabulary is not acceptance evidence. Never serialize exceptions,
# argv, stderr, service configuration, journal entries or private state.
PHASES=('source-copy','old-provenance','baseline-prepare','baseline-install','ownership-capture',
 'migration-root','baseline-service-start','baseline-service-observe','worker-launch','matrix-readback','source-readback',
 'worker-admission','worker-construction','worker-closure','worker-control-wait','worker-gated-ready',
 'worker-ungate','worker-broker-restart','worker-control-rewait','worker-ready','worker-enrollment','worker-matrix','worker-complete')
ERRORS=('None','Refused','InstallError','Cancelled','OSError','PermissionError','FileNotFoundError','FileExistsError',
 'RuntimeError','ValueError','TypeError','KeyError','AttributeError','JSONDecodeError','CalledProcessError','TimeoutExpired','OtherError')
UNIT_FIELDS=dict(ActiveState=('active','inactive','failed','activating','deactivating','reloading','maintenance'),
 SubState=('running','dead','failed','start','start-pre','start-post','auto-restart','stop','stop-sigterm','stop-sigkill','exited'),
 Result=('success','exit-code','signal','core-dump','timeout','resources','protocol','start-limit-hit','oom-kill'))
DIAG_UNITS=('relay.service','relay-updater-broker.service','relay-updater-web.service',UNIT)

REFUSAL_REASONS={'Untrusted ancestry or permissions':'untrusted-ancestry',
 'Path changed during acquisition':'acquisition-drift','Absolute normalized path required':'path-invalid',
 'Link or special entry refused':'link-special'}
DIAG_ERRNOS=(1,2,5,8,12,13,17,20,22,24,28,30,38,40,98,99,110,111)

def error_fields(exc):
 name=type(exc).__name__ if exc is not None else 'None'
 reason='exception' if exc is not None else 'none'
 if type(exc) is c.Refused and len(exc.args)==1 and type(exc.args[0]) is str:
  reason=REFUSAL_REASONS.get(exc.args[0],'exception')
 value=dict(errorClass=name if name in ERRORS else 'OtherError',reasonCode=reason,errno=None)
 status=None
 for _ in range(4):
  if exc is None:break
  if isinstance(exc,OSError) and type(exc.errno) is int and exc.errno in DIAG_ERRNOS:value['errno']=exc.errno
  if isinstance(exc,subprocess.CalledProcessError) and type(exc.returncode) is int and -127<=exc.returncode<=255:status=exc.returncode
  exc=exc.__context__  # install.run suppresses display, not the typed cause.
 return value,status

def public_source_components():
 # Stable ordinals only: fixed copied SOURCE, its ancestors and policy.FILES.
 # No caller path, directory enumeration, symlink target or file contents.
 paths=[]
 for name in policy.FILES:
  target=ROOT/'source'/name
  for p in (*reversed(target.parents),target):
   if p not in paths:paths.append(p)
 c.require(len(paths)<=64,'Public source diagnostic bound')
 return paths

def source_boundary():
 paths=public_source_components();entries=[]
 with contextlib.ExitStack() as stack:
  fds={}
  for index,p in enumerate(paths):
   item=dict(component=index,kind='unknown',mode=None,uid=None,gid=None,nlink=None,errno=None)
   try:
    if p==Path('/'):
     fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);stack.callback(os.close,fd);fds[p]=fd
     s=os.fstat(fd)
    else:
     if p.parent not in fds:entries.append(item);continue
     s=os.stat(p.name,dir_fd=fds[p.parent],follow_symlinks=False)
    item.update(kind='directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else 'link' if stat.S_ISLNK(s.st_mode) else 'other',
     mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink)
    if p!=Path('/') and stat.S_ISDIR(s.st_mode):
     fd=os.open(p.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fds[p.parent])
     stack.callback(os.close,fd);fds[p]=fd
   except OSError as exc:item['errno']=exc.errno if type(exc.errno) is int and exc.errno in DIAG_ERRNOS else None
   entries.append(item)
 return dict(rootRelation='fixed-source' if policy.ROOT==ROOT/'source' else 'other',
  defaultRootRelation='fixed-source' if policy.closure.__defaults__==(ROOT/'source',) else 'other',
  owner=os.geteuid(),components=entries)

def validate_source_boundary(value):
 policy.exact(value,('rootRelation','defaultRootRelation','owner','components'),'Invalid public source boundary')
 c.require(value['rootRelation'] in ('fixed-source','other') and value['defaultRootRelation'] in ('fixed-source','other') and
  type(value['owner']) is int and 0<=value['owner']<=4294967295 and type(value['components']) is list and
  len(value['components'])==len(public_source_components())<=64,'Invalid public source boundary values')
 for index,item in enumerate(value['components']):
  policy.exact(item,('component','kind','mode','uid','gid','nlink','errno'),'Invalid public component')
  c.require(type(item['component']) is int and item['component']==index and item['kind'] in ('unknown','directory','file','link','other') and
   all(item[k] is None or type(item[k]) is int and 0<=item[k]<=(4095 if k=='mode' else 4294967295) for k in ('mode','uid','gid','nlink')) and
   (item['errno'] is None or type(item['errno']) is int and item['errno'] in DIAG_ERRNOS),'Invalid public component values')
 return value

def validate_worker_diagnostic(value):
 keys=('schema','phase','errorClass','reasonCode','errno')
 policy.exact(value,(*keys,'sourceBoundary') if type(value) is dict and 'sourceBoundary' in value else keys,'Invalid diagnostic')
 c.require(type(value['schema']) is int and value['schema']==1 and value['phase'] in PHASES and
  value['phase'].startswith('worker-') and value['errorClass'] in ERRORS and value['reasonCode'] in ('none','exception',*REFUSAL_REASONS.values()) and
  (value['reasonCode'] not in REFUSAL_REASONS.values() or value['errorClass']=='Refused') and
  (value['errno'] is None or type(value['errno']) is int and value['errno'] in DIAG_ERRNOS), 'Invalid diagnostic values')
 if 'sourceBoundary' in value:
  c.require(value['phase']=='worker-closure' and value['errorClass']!='None','Invalid public source boundary phase')
  validate_source_boundary(value['sourceBoundary'])
 return value

def worker_diagnostic(owner=0):
 try:return validate_worker_diagnostic(c.decode(c.bounded_read(ROOT/'worker-diagnostic.json',16384,owner)))
 except Exception:return None

def diagnostic(q,phase,exc,worker):
 c.require(phase in PHASES,'Invalid diagnostic phase')
 fields,status=error_fields(exc);units={}
 for unit in DIAG_UNITS:
  values={k:'unknown' for k in UNIT_FIELDS};values.update(ExecMainStatus=None,MainPID=None)
  try:
   raw=q.install.run(['/usr/bin/systemctl','show',unit,'--property=ActiveState,SubState,Result,ExecMainStatus,MainPID'],timeout=5)
   c.require(len(raw)<=4096,'Diagnostic readback bound')
   seen=set()
   for line in raw.splitlines():
    key,sep,value=line.partition('=')
    c.require(sep and key in values and key not in seen,'Invalid diagnostic readback');seen.add(key)
    if key in UNIT_FIELDS:values[key]=value if value in UNIT_FIELDS[key] else 'unknown'
    elif value.isascii() and value.isdigit() and len(value)<=10 and int(value)<=(255 if key=='ExecMainStatus' else 4194304):values[key]=int(value)
  except Exception:values={k:'unknown' for k in UNIT_FIELDS};values.update(ExecMainStatus=None,MainPID=None)
  units[unit]=values
 return dict(schema=1,kind='relay-migration-diagnostic-not-acceptance',phase=phase,**fields,commandStatus=status,
  worker=validate_worker_diagnostic(worker) if worker is not None else None,units=units)

def run_context(args,private_lan=None):
 for key in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'):
  c.require(os.environ.get(key,'').isascii() and os.environ[key].isdigit() and int(os.environ[key])>0,'Invalid workflow run identity')
 return dict(source=args.source_commit,ref=os.environ['GITHUB_REF'],runId=os.environ['GITHUB_RUN_ID'],
  attempt=os.environ['GITHUB_RUN_ATTEMPT'],mode=args.mode,privateLan=private_lan)

def unit_description(context):
 return 'relay-migration:'+':'.join(str(context[k]) for k in ('source','runId','attempt','mode'))

def unit_state(q,unit):
 return dict(x.split('=',1) for x in q.install.run(['/usr/bin/systemctl','show',unit,
  '--property=LoadState,MainPID,ControlGroup,InvocationID,Description']).splitlines())

def independent_cleanup(args):
 """Bounded workflow-only recovery. Unbound or replaced resources never become ours."""
 workflow_guard(args.source_commit,args.ack)
 c.require(Path(args.output)==OUTPUT,'Fixed workflow output required')
 git_inventory(Path(__file__).resolve().parents[2],args.source_commit)
 clean=dict(acknowledged=False,forced=False,remainingUnits=['unconfirmed-cleanup'],remainingPids=[],remainingPaths=[],remainingIdentities=[])
 try:
  import pwd,grp,re,ipaddress
  q=helper();record=OUTPUT/('ownership-'+args.mode+'.json')
  s=record.lstat();c.require(s.st_uid==0 and stat.S_ISREG(s.st_mode) and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'Root private record required')
  value=c.decode(c.bounded_read(record,65536,0))
  policy.exact(value,('schema','context','paths','users','groups','processes','intents','units','unitIntents'),'Invalid ownership schema')
  c.require(type(value['schema']) is int and value['schema']==1,'Invalid ownership version')
  ctx=value['context'];policy.exact(ctx,(*run_context(args),'pid','start'),'Invalid ownership context')
  lan=ctx['privateLan']
  if args.mode=='loopback':c.require(lan is None,'Invalid loopback network')
  else:c.require(type(lan) is str and any(ipaddress.IPv4Address(lan) in ipaddress.IPv4Network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')),'Invalid private network')
  c.require({k:ctx[k] for k in run_context(args,lan)}==run_context(args,lan),'Stale or foreign run context')
  c.require(type(ctx['pid']) is int and ctx['pid']>1 and type(ctx['start']) is str and ctx['start'].isdigit(),'Invalid supervisor binding')
  c.require(process_identity(ctx['pid'])!=ctx['start'],'Original supervisor still live; no competing cleanup')
  paths=set(map(str,(ROOT,MIGRATIONS)))|set(q.install.DESTINATIONS)|{'/etc/systemd/system/'+u for u in q.install.UNITS}
  units=set(q.install.UNITS)|{UNIT};users={'relay','relay-updater-web'};groups=users|{'relay-updater-socket'}
  for key,allowed in (('paths',paths),('users',users),('groups',groups),('units',units)):
   c.require(type(value[key]) is dict and set(value[key])<=allowed,'Undeclared ownership key')
  c.require(type(value['intents']) is list and len(value['intents'])<=2 and set(value['intents'])<=set(map(str,(ROOT,MIGRATIONS))),'Invalid path intents')
  c.require(type(value['unitIntents']) is list and value['unitIntents'] in ([],[UNIT]),'Invalid unit intent')
  c.require(type(value['processes']) is list and len(value['processes'])<=64,'Invalid process bound')
  for item in value['processes']:
   policy.exact(item,('pid','start','unit'),'Invalid process schema')
   c.require(type(item['pid']) is int and item['pid']>1 and type(item['start']) is str and item['start'].isdigit() and item['unit'] in units,'Invalid process identity')
  for key in ('users','groups'):
   c.require(all(type(v) is int and v>=0 for v in value[key].values()),'Invalid identity binding')
  for n,b in value['paths'].items():
   c.require(type(b) is list and len(b)==4 and all(type(x) is int and x>=0 for x in b) and b[3] in (stat.S_IFDIR,stat.S_IFREG),'Invalid inode binding')
   if os.path.lexists(n):
    s=Path(n).lstat();c.require([s.st_dev,s.st_ino,s.st_uid,stat.S_IFMT(s.st_mode)]==b,'Replaced path; no adoption')
  c.require(all(not os.path.lexists(n) or n in value['paths'] for n in paths),'Unbound resource or mkdir intent; no adoption')
  for key,lookup,attr in (('users',pwd.getpwnam,'pw_uid'),('groups',grp.getgrnam,'gr_gid')):
   for n in users if key=='users' else groups:
    try:actual=getattr(lookup(n),attr)
    except KeyError:continue
    c.require(value[key].get(n)==actual,'Unbound or foreign identity')
  states={u:unit_state(q,u) for u in units}
  for u,state in states.items():
   c.require(state.get('LoadState') in ('not-found','loaded'),'Unconfirmed unit load state')
   if state['LoadState']=='not-found':continue
   c.require(state.get('ControlGroup') in ('','/system.slice/'+u) and re.fullmatch('[0-9a-f]{32}',state.get('InvocationID','')),'Unconfirmed unit invocation')
   if u==UNIT:
    c.require(u in value['unitIntents'] and state.get('Description')==unit_description(ctx),'Foreign transient unit')
   else:c.require(value['units'].get(u)=={k:state.get(k,'') for k in ('InvocationID','ControlGroup','Description')},'Foreign installed unit')
  for u,b in value['units'].items():
   policy.exact(b,('InvocationID','ControlGroup','Description'),'Invalid unit binding')
   c.require(all(type(v) is str for v in b.values()),'Invalid unit values')
  # All prevalidation completes before the first operation. Recheck invocations at stop.
  for u in (UNIT,*reversed(q.install.UNITS)):
   if states[u]['LoadState']=='not-found':continue
   c.require(unit_state(q,u)==states[u],'Unit changed before stop')
   q.install.run(['/usr/bin/systemctl','stop',u],timeout=200)
   fields=dict(x.split('=',1) for x in q.install.run(['/usr/bin/systemctl','show',u,'--property=MainPID,ActiveState,Result']).splitlines())
   c.require(unit_state(q,u).get('LoadState')=='not-found' or (fields.get('MainPID')=='0' and fields.get('ActiveState') in ('inactive','failed') and fields.get('Result') in ('success','exit-code')),'Unconfirmed or forced stop')
  c.require(all(process_identity(p['pid'])!=p['start'] for p in value['processes']),'Owned process remains')
  host=lan or '127.0.0.1'
  c.require(not any(listener_open(host,p) for p in (4180,4191)),'Listener remains')
  for n,b in sorted(value['paths'].items(),key=lambda x:len(Path(x[0]).parts),reverse=True):
   if not os.path.lexists(n):continue
   p=Path(n);s=p.lstat();c.require([s.st_dev,s.st_ino,s.st_uid,stat.S_IFMT(s.st_mode)]==b,'Path changed before removal')
   if stat.S_ISDIR(s.st_mode):shutil.rmtree(p)
   else:p.unlink()
  q.install.run(['/usr/bin/systemctl','daemon-reload'])
  for key,lookup,attr,command in (('users',pwd.getpwnam,'pw_uid','userdel'),('groups',grp.getgrnam,'gr_gid','groupdel')):
   for n,ident in value[key].items():
    try:actual=getattr(lookup(n),attr)
    except KeyError:continue
    c.require(actual==ident,'Identity changed before removal');q.install.run(['/usr/sbin/'+command,n])
  c.require(all(unit_state(q,u).get('LoadState')=='not-found' for u in units) and not any(os.path.lexists(n) for n in paths),'Resources remain')
  for lookup,names in ((pwd.getpwnam,users),(grp.getgrnam,groups)):
   for n in names:
    try:lookup(n)
    except KeyError:continue
    raise c.Refused('Identity remains')
  clean.update(acknowledged=True,remainingUnits=[])
 except Exception:pass  # Sanitized failure only; never disclose record/private state.
 c.write_json(OUTPUT/('cleanup-'+args.mode+'.json'),clean,owner=0)
 c.require(clean['acknowledged'],'Independent cleanup unconfirmed; no qualification')
 return clean
CASES=policy.CHECKS+('active-job-refusal','foreign-hold-refusal','corrupt-metadata-refusal','private-state-drift-refusal','staged-prepare-apply')
UNIT_DIRS=('/etc/systemd/system','/run/systemd/system','/run/systemd/transient','/run/systemd/generator',
 '/run/systemd/generator.early','/run/systemd/generator.late','/usr/local/lib/systemd/system','/usr/lib/systemd/system','/lib/systemd/system')

def workflow_guard(source,ack):
 policy.commit(source)
 c.require(ack==ACK and os.environ.get('GITHUB_ACTIONS')=='true' and
  os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted' and os.environ.get('GITHUB_REPOSITORY')=='murmuur22/relay' and
  os.environ.get('GITHUB_SHA')==source and os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch' and
  os.environ.get('GITHUB_REF')==policy.PREPARATION_REF and
  os.environ.get('GITHUB_WORKFLOW_REF')==policy.WORKFLOW+'@'+policy.PREPARATION_REF,
  'Official exact-source disposable workflow acknowledgment required')
 c.require(sys.platform=='linux' and os.geteuid()==0 and Path('/run/systemd/system').is_dir(),
  'Actual Linux root/systemd required; local simulation cannot qualify')

def helper():
 path=Path(__file__).resolve().parents[1]/'qualify-upgrade.py'
 spec=importlib.util.spec_from_file_location('migration_existing_lifecycle',path)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module

def git_inventory(root,source):
 root=Path(root)
 c.require(subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=root).decode().strip()==source,'Wrong immutable checkout')
 c.require(not subprocess.check_output(['/usr/bin/git','diff','HEAD','--'],cwd=root),'Tracked source changed')
 c.require(not subprocess.check_output(['/usr/bin/git','ls-files','--others','--exclude-standard'],cwd=root),'Uncommitted source files')
 names=subprocess.check_output(['/usr/bin/git','ls-files','-z'],cwd=root).decode().split('\0')[:-1]
 result={}
 for n in names:
  p=root/n;s=p.lstat()
  c.require(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'Nonregular source input')
  result[n]=dict(size=s.st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),mode=stat.S_IMODE(s.st_mode))
 return result

def check_inventory(root,expected):
 for n,pin in expected.items():
  path=Path(root)/n;s=path.lstat()
  c.require(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and
   dict(size=s.st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),mode=stat.S_IMODE(s.st_mode))==pin,'Source inventory drift')

def produce_receipt(report,*,mode,source,inventory,source_inventory,producer):
 """Pure fail-closed reducer; official caller must authenticate raw artifact IDs.
 No fabricated defaults. Unit tests of this function confer no Linux authority.
 """
 policy.exact(report,('schema','kind','sourceCommit','sourceRef','mode','baseline','closure','sourceInventory','cases','exit','cleanup'),'Incomplete execution report')
 c.require(type(report['schema']) is int and report['schema']==1 and report['kind']=='relay-migration-prepolicy-execution' and
  report['sourceCommit']==source and report['sourceRef']==policy.PREPARATION_REF and report['mode']==mode and
  mode in ('loopback','private-lan') and report['baseline']==policy.BASELINE and inventory and
  report['closure']==inventory and source_inventory and report['sourceInventory']==source_inventory,'Execution source/mode/baseline/closure drift')
 cases=report['cases']
 c.require(type(cases) is list and len(cases)==len(CASES),'Missing or duplicate executed case')
 for case in cases:
  policy.exact(case,('code','exit'),'Invalid case record')
  c.require(type(case['exit']) is int and case['exit']==0,'Failed or unexecuted case')
 c.require({v['code'] for v in cases}==set(CASES),'Missing required executed case')
 clean=report['cleanup']
 policy.exact(clean,('acknowledged','forced','remainingUnits','remainingPids','remainingPaths','remainingIdentities'),'Missing cleanup readback')
 c.require(clean['acknowledged'] is True and clean['forced'] is False and
  all(clean[k]==[] for k in ('remainingUnits','remainingPids','remainingPaths','remainingIdentities')) and
  type(report['exit']) is int and report['exit']==0,'Nonzero execution or incomplete/forced cleanup')
 receipt=dict(schema=1,kind='relay-migration-systemd-receipt',tier='real-linux-systemd',mode=mode,producer=producer,
  target=dict(version=c.TARGET,sourceCommit=source),baseline=policy.BASELINE,closure=inventory,
  exit=report['exit'],success=True,counts=dict(tests=len(cases),passed=len(cases),failed=0,errors=0,skipped=0),
  checks={k:next(v['exit'] for v in cases if v['code']==k)==0 for k in policy.CHECKS},cleanup=clean['acknowledged'])
 return policy.validate_receipt(receipt,mode,inventory,source)

def fresh_host(q,private_lan,prerequisites=True):
 """Read-only admission BEFORE even the qualification directory is created."""
 if prerequisites:q.base.install.preflight_host(private_lan)
 else:
  import pwd,grp
  for lookup,names in ((pwd.getpwnam,('relay','relay-updater-web')),(grp.getgrnam,('relay','relay-updater-web','relay-updater-socket'))):
   for name in names:
    try:lookup(name)
    except KeyError:continue
    raise c.Refused('Existing Relay identity refused before provisioning')
  for path in (*q.install.DESTINATIONS,'/var/lib/relay.updater-discard'):
   q.install.require_absent(path)
 for path in (ROOT,MIGRATIONS):
  q.install.require_absent(path)
 for unit in (*q.install.UNITS,UNIT,'relay-qualification-restore.service','relay-qualification-upgrade.service'):
  c.require(q.install.run(['/usr/bin/systemctl','show',unit,'--property=LoadState','--value'])=='not-found','Existing loaded qualification/Relay unit refused')
  for d in UNIT_DIRS:
   for suffix in ('','.d'):
    c.require(not os.path.lexists(Path(d)/(unit+suffix)),'Existing unit/drop-in/generator refused')
 c.require(not Path('/migration-policy.json').exists(),'Existing policy marker refused')

def process_identity(pid):
 """Kernel start identity, not a recyclable PID. Missing process is not an error."""
 try:return Path('/proc',str(pid),'stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError:return None

def listener_open(host,port):
 import socket
 try:
  with socket.create_connection((host,port),timeout=1):return True
 except ConnectionRefusedError:return False

class Ownership:
 """Bound to this admitted VM/run. No adoption, broad glob deletion or KILL pass."""
 def __init__(self,q):
  self.q=q;self.paths={};self.users={};self.groups={};self.original={};self.forced=False
  self.record=None;self.context=None;self.intents=[];self.units={};self.unit_intents=[]
 def save(self):
  if self.record is not None:
   c.write_json(self.record,dict(schema=1,context=self.context,paths=self.paths,users=self.users,groups=self.groups,
    processes=[dict(pid=p,start=s,unit=u) for (p,s),u in self.original.items()],intents=self.intents,
    units=self.units,unitIntents=self.unit_intents),owner=os.geteuid())
 def begin(self,args,private_lan=None):
  self.record=Path(args.output)/('ownership-'+args.mode+'.json')
  c.require(not os.path.lexists(self.record),'Existing ownership record refused')
  self.context=dict(run_context(args,private_lan),pid=os.getpid(),start=process_identity(os.getpid()))
  c.require(self.context['start'] is not None,'Missing supervisor process identity')
  self.save()  # Durable run/source/PID-start binding BEFORE the first owned effect.
 def create_private(self,path):
  path=Path(path);c.require(not os.path.lexists(path),'Existing root refused; no adoption')
  self.intents.append(str(path));self.save()
  # TERM cannot land between mkdir and durable inode binding. SIGKILL can: an
  # unbound intent is never adopted by the independent cleanup; it stays false.
  mask=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGTERM})
  try:
   path.mkdir(mode=0o700)
   s=path.lstat();self.paths[str(path)]=(s.st_dev,s.st_ino,s.st_uid,stat.S_IFMT(s.st_mode));self.save()
   c.require(s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==0o700,'Private owned root required')
  finally:signal.pthread_sigmask(signal.SIG_SETMASK,mask)
 def capture(self):
  import pwd,grp
  for n in (*self.q.install.DESTINATIONS,*('/etc/systemd/system/'+u for u in self.q.install.UNITS)):
   p=Path(n)
   if os.path.lexists(p) and n not in self.paths:
    s=p.lstat();self.paths[n]=(s.st_dev,s.st_ino,s.st_uid,stat.S_IFMT(s.st_mode))
  for n in ('relay','relay-updater-web'):
   try:self.users.setdefault(n,pwd.getpwnam(n).pw_uid)
   except KeyError:pass
  for n in ('relay','relay-updater-web','relay-updater-socket'):
   try:self.groups.setdefault(n,grp.getgrnam(n).gr_gid)
   except KeyError:pass
  self.save()
 def observe(self):
  for u in (*self.q.install.UNITS,UNIT):
   fields=dict(x.split('=',1) for x in self.q.install.run(['/usr/bin/systemctl','show',u,'--property=MainPID,ControlGroup']).splitlines())
   pid=int(fields.get('MainPID','0'))
   started=process_identity(pid) if pid else None
   if started is not None:self.original[(pid,started)]=u
   state=unit_state(self.q,u)
   if state.get('LoadState')=='loaded' and u not in self.units:
    self.units[u]={k:state.get(k,'') for k in ('InvocationID','ControlGroup','Description')}
  self.save()
 def cleanup(self):
  import pwd,grp
  run=self.q.install.run;errors=[];unconfirmed=[]
  def attempt(label,fn):
   try:return fn()
   except Exception:errors.append(label);return None
  attempt('observe',self.observe)
  # A failed acknowledgment must not prevent stopping the other declared units.
  # Never signal a numeric PID or delete a live service's files to hide a failure.
  for u in (UNIT,*reversed(self.q.install.UNITS)):
   def stop():
    if run(['/usr/bin/systemctl','show',u,'--property=LoadState','--value'])!='not-found':
     run(['/usr/bin/systemctl','stop',u],timeout=200)
     fields=dict(x.split('=',1) for x in run(['/usr/bin/systemctl','show',u,'--property=MainPID,ActiveState,Result']).splitlines())
     # --collect may remove the transient supervisor immediately after stop.
     gone=u==UNIT and run(['/usr/bin/systemctl','show',u,'--property=LoadState','--value'])=='not-found'
     c.require(gone or (fields.get('MainPID')=='0' and fields.get('ActiveState') in ('inactive','failed') and fields.get('Result') in ('success','exit-code')), 'Unit stop unacknowledged or forced')
   attempt(u,stop)
  alive=[]
  for (pid,start),u in self.original.items():
   try:
    if process_identity(pid)==start:alive.append(pid)
   except Exception:alive.append(pid)
  # Port admission preceded provisioning. Both actual configured listeners must
  # refuse connections, not merely have disappeared from systemctl output.
  for port in (4180,4191):
   try:
    if listener_open(self.q.base.NETWORK['hostname'],port):unconfirmed.append('listener-'+str(port))
   except Exception:unconfirmed.append('listener-'+str(port))
  # Acknowledge the one intentional Coordinator root replacement BEFORE removing
  # protected transaction evidence. Every other cleanup path stays inode-bound.
  def acknowledge_control():
   n='/opt/relay-updater';p=Path(n)
   if n in self.paths and p.exists():
    s=p.lstat();actual=(s.st_dev,s.st_ino,s.st_uid,stat.S_IFMT(s.st_mode))
    if actual!=self.paths[n]:
     current=c.inventory(p,owner=0);admitted=False
     for tx in Path('/var/lib/relay-control-plane-migrations').iterdir():
      if not tx.is_dir() or len(tx.name)!=32:continue
      receipt=c.decode(c.bounded_read(tx/'receipt.json',16*1024**2,0))
      new=c.decode(c.bounded_read(tx/'new.json',16*1024**2,0))
      if receipt.get('targetSource')==os.environ['GITHUB_SHA'] and receipt.get('source')==policy.closure(ROOT/'source') and current==new and receipt.get('newInventorySha256')==c.sha(c.canonical(new)):
       admitted=True;break
     c.require(admitted,'Replaced control root has no matching owned transaction');self.paths[n]=actual
  attempt('control-binding',acknowledge_control)
  # Root ownership and original inode must still match before removing exact roots.
  # A live PID/listener retains its recovery files; unrelated cleanup errors do not
  # skip other independently bound paths or identities.
  if not alive and not unconfirmed:
   for n,binding in sorted(self.paths.items(),key=lambda x:len(Path(x[0]).parts),reverse=True):
    def remove():
     p=Path(n)
     if not os.path.lexists(p):return
     s=p.lstat();actual=(s.st_dev,s.st_ino,s.st_uid,stat.S_IFMT(s.st_mode))
     c.require(actual==binding,'Owned path was substituted; refusing cleanup')
     if p.is_dir() and not p.is_symlink():shutil.rmtree(p)
     else:p.unlink()
    attempt('path',remove)
  attempt('reload',lambda:run(['/usr/bin/systemctl','daemon-reload']))
  if not alive and not unconfirmed:
   for n,uid in self.users.items():
    def remove_user():
     c.require(pwd.getpwnam(n).pw_uid==uid,'Service user substituted');run(['/usr/sbin/userdel',n])
    attempt('user',remove_user)
   for n,gid in self.groups.items():
    def remove_group():
     try:g=grp.getgrnam(n)
     except KeyError:return  # userdel may remove its private primary group
     c.require(g.gr_gid==gid,'Service group substituted');run(['/usr/sbin/groupdel',n])
    attempt('group',remove_group)
  remaining_units=list(unconfirmed)
  for u in (*self.q.install.UNITS,UNIT):
   try:
    if run(['/usr/bin/systemctl','show',u,'--property=LoadState','--value'])!='not-found':remaining_units.append(u)
   except Exception:remaining_units.append(u)
  if errors:remaining_units.append('unconfirmed-cleanup')
  declared=set(self.paths)|set(map(str,(ROOT,MIGRATIONS)))|set(self.q.install.DESTINATIONS)|{'/etc/systemd/system/'+u for u in self.q.install.UNITS}
  paths=[n for n in declared if os.path.lexists(n)]
  identities=[]
  for n in ('relay','relay-updater-web'):
   try:pwd.getpwnam(n);identities.append(n)
   except KeyError:pass
  for n in ('relay','relay-updater-web','relay-updater-socket'):
   try:grp.getgrnam(n);identities.append(n)
   except KeyError:pass
  return dict(acknowledged=not any((remaining_units,paths,identities,alive)),forced=self.forced,
   remainingUnits=remaining_units,remainingPids=alive,remainingPaths=paths,remainingIdentities=identities)

class Cancelled(Exception):pass

@contextlib.contextmanager
def termination_guard():
 """TERM unwinds once. Further TERM cannot interrupt bounded cleanup/persistence.
 SIGKILL and parent loss cannot run finally: the workflow cleanup must acknowledge.
 """
 state=dict(cancelled=False,cleaning=False)
 def terminate(signum,frame):
  first=not state['cancelled'];state['cancelled']=True
  if first and not state['cleaning']:raise Cancelled('SIGTERM')
 previous=signal.signal(signal.SIGTERM,terminate)
 try:yield state
 finally:signal.signal(signal.SIGTERM,previous)

def run(args):
 with termination_guard() as termination:return run_owned(args,termination)

def run_owned(args,termination):
 workflow_guard(args.source_commit,args.ack)
 q=helper();private_lan=None
 if args.mode=='private-lan':
  import ipaddress
  interfaces=json.loads(q.install.run(['/usr/sbin/ip','-j','-4','address','show']))
  options=[a['local'] for i in interfaces for a in i.get('addr_info',[]) if 'local' in a and
   any(ipaddress.IPv4Address(a['local']) in ipaddress.IPv4Network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'))]
  c.require(bool(options),'No actual assigned private-LAN interface');private_lan=options[0]
 fresh_host(q,private_lan)
 source=Path(__file__).resolve().parents[2];inventory=git_inventory(source,args.source_commit)
 c.require('deploy/migration_069/qualification_worker.py' in inventory,'Worker must belong to immutable source')
 # All published old inputs verify before any identities/state/units are created.
 # verify_old uses exact source/ref/signer and fixed manifest/archive pins.
 # Inputs are copied only AFTER fresh-host admission, never imported as authority.
 owner=Ownership(q);result=None;error=None;failure=None;phase='source-copy'
 output=Path(args.output)
 c.require(output.is_dir() and not output.is_symlink(),'Precreated workflow-private output directory required')
 owner.begin(args,private_lan)
 try:
  owner.create_private(ROOT)
  for n in inventory:
   p=ROOT/'source'/n;p.parent.mkdir(mode=0o755,parents=True,exist_ok=True);shutil.copyfile(source/n,p);p.chmod(inventory[n]['mode'])
  for label,src in (('old',args.old_release_dir),('candidate',args.candidate_dir)):
   dst=ROOT/label;dst.mkdir(mode=0o700)
   names=q.install.FILES if label=='old' else ('relay-release.json','relay-linux-x64.tar.gz','relay-updater-linux-x64.tar.gz')
   for n in names:
    p=Path(src)/n;q.install.regular(p,1024**3);shutil.copyfile(p,dst/n);(dst/n).chmod(0o600)
  check_inventory(ROOT/'source',inventory)
  marker=dict(sourceCommit=args.source_commit,sourceRef=os.environ['GITHUB_REF'],mode=args.mode,privateLan=private_lan,
   sourceInventory=inventory,runId=int(os.environ['GITHUB_RUN_ID']),runAttempt=int(os.environ['GITHUB_RUN_ATTEMPT']))
  q.install.write_new(ROOT/'admission.json',json.dumps(marker))
  # Separate fresh preflight still occurs inside the reviewed installer prepare.
  # Its verification/enrollment uses real old GitHub provenance, never this target adapter.
  baseline=argparse.Namespace(release_dir=str(ROOT/'old'),version='v0.6.4',private_lan=private_lan,apply=True)
  # Invoke exact old-provenance binding in the root-owned copied package first.
  phase='old-provenance'
  q.install.run(['/usr/bin/python3','-B','-m','deploy.migration_069.qualification_worker','verify-old'],cwd=ROOT/'source',timeout=150)
  phase='baseline-prepare'
  with q.install.prepare(baseline) as (work,manifest):
   phase='baseline-install';q.install.apply_install(work,manifest,'v0.6.4',private_lan)
  phase='ownership-capture';owner.capture()
  phase='migration-root';owner.create_private(MIGRATIONS)  # Required writable root before namespace setup.
  q.base.NETWORK=q.install.deployment_network(private_lan)
  phase='baseline-service-start';q.install.run(['/usr/bin/systemctl','start',*q.install.UNITS])
  phase='baseline-service-observe';owner.observe()
  props=('User=root','Group=root','WorkingDirectory='+str(ROOT/'source'),'UMask=0077','NoNewPrivileges=true',
   'ProtectHome=true','ProtectSystem=strict','ReadWritePaths=/opt /var/lib/relay /var/lib/relay-updater /var/lib/relay-updater-control /var/lib/relay-control-plane-migrations /run/relay-updater-control',
   'PrivateTmp=true','ProtectKernelTunables=true','ProtectKernelModules=true','ProtectControlGroups=true','RestrictSUIDSGID=true',
   'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK','LockPersonality=true','RuntimeMaxSec=1500','TimeoutStopSec=45')
  owner.unit_intents.append(UNIT);owner.save()  # Durable launch intent precedes systemd-run, including loss before MainPID observation.
  command=['/usr/bin/systemd-run','--unit='+UNIT,'--description='+unit_description(owner.context),'--wait','--pipe','--collect',
   *('--property='+v for v in props),'/usr/bin/python3','-B','-m','deploy.migration_069.qualification_worker','matrix']
  # No raw private worker stdout/stderr leaves the protected boundary.
  phase='worker-launch';q.install.run(command,timeout=1560)
  phase='matrix-readback';result=json.loads((ROOT/'execution.json').read_text())
  phase='source-readback';check_inventory(ROOT/'source',inventory);git_inventory(source,args.source_commit)
 except Exception as exc:
  error=type(exc).__name__;failure=exc
 finally:
  termination['cleaning']=True
  # Exact protected checkpoint + fixed unit fields BEFORE any cleanup removes them.
  # Diagnostic persistence failure still cleans up, and cannot yield acceptance.
  try:
   evidence=diagnostic(q,phase,failure,worker_diagnostic())
   c.write_json(output/('diagnostic-'+args.mode+'.json'),evidence,owner=os.geteuid())
   c.require(c.decode(c.bounded_read(output/('diagnostic-'+args.mode+'.json'),16384,os.geteuid()))==evidence,'Diagnostic readback differs')
  except Exception:error=error or 'diagnostic-failure'
  if result is None and (ROOT/'execution.json').is_file():
   try:result=c.decode(c.bounded_read(ROOT/'execution.json',4*1024**2,0))
   except Exception:pass
  # Worker completion and cleanup are independent gates; cleanup failures cannot be hidden.
  try:clean=owner.cleanup()
  except Exception:clean=dict(acknowledged=False,forced=False,remainingUnits=['unconfirmed'],remainingPids=[],remainingPaths=[],remainingIdentities=[])
 if result is None:
  result=dict(schema=1,kind='relay-migration-prepolicy-execution',sourceCommit=args.source_commit,sourceRef=os.environ['GITHUB_REF'],
   mode=args.mode,baseline=policy.BASELINE,closure={},sourceInventory=inventory,cases=[],exit=1,cleanup=clean)
 else:
  result['cleanup']=clean
  result['exit']=0 if not error and not termination['cancelled'] and clean['acknowledged'] and type(result.get('exit')) is int and result['exit']==0 else 1
 # Sanitized execution codes/inventories only: no state hashes, cookies or credentials.
 q.install.write_new(output/('execution-'+args.mode+'.json'),json.dumps(result,sort_keys=True))
 c.require(result['exit']==0,'Matrix or cleanup failed; inspect sanitized execution artifact; no qualification receipt')

def main(argv=None):
 p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
 for name in ('run','admit','cleanup'):
  r=sub.add_parser(name)
  for key in ('source-commit','ack'):r.add_argument('--'+key,required=True)
  if name in ('run','cleanup'):
   r.add_argument('--output',required=True)
   r.add_argument('--mode',choices=('loopback','private-lan'),required=True)
  if name=='run':
   for key in ('old-release-dir','candidate-dir'):r.add_argument('--'+key,required=True)
 a=p.parse_args(argv)
 if a.command=='admit':
  workflow_guard(a.source_commit,a.ack);fresh_host(helper(),None,prerequisites=False)
 elif a.command=='cleanup':independent_cleanup(a)
 else:run(a)
 return 0

if __name__=='__main__':
 try:sys.exit(main())
 except Exception:
  print('REFUSED: disposable qualification admission/execution incomplete; no Linux or production authority conferred.',file=sys.stderr);sys.exit(1)
