"""One-time migration coordinator. No installer, enrollment, config edits or fetching.
Synthetic CLI is scratch-only. Production apply/rollback are disabled; only a
separate reviewed release-only option A build may eventually carry authority.
"""
import argparse
import contextlib
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import sys
import tempfile
import time
import types
import urllib.request
from urllib.parse import urlsplit
from . import control_plane_upgrade_069 as c

UNITS=('relay.service','relay-updater-broker.service','relay-updater-web.service')
EXEC={UNITS[0]:('/usr/bin/node','/usr/bin/node /opt/relay/current/server/index.mjs','relay','relay','/opt/relay/current'),
 UNITS[1]:('/usr/bin/python3','/usr/bin/python3 -m updater.broker.server --config /etc/relay-updater/broker.json','root','root','/opt/relay-updater'),
 UNITS[2]:('/usr/bin/node','/usr/bin/node /opt/relay-updater/updater/web/index.mjs --config /etc/relay-updater/web.json','relay-updater-web','relay-updater-web','/opt/relay-updater')}
PROPS=('Id','Names','LoadState','FragmentPath','SourcePath','DropInPaths','Transient','User','Group','WorkingDirectory','ExecStart','ActiveState','SubState','MainPID')
CONFIG_FILES={'.','bridge.key','broker.json','web.json','relay.env','relay-release.json','relay-release.attestation.json'}
FIXED=dict(installRoot='/opt/relay',stateRoot='/var/lib/relay',controlRoot='/var/lib/relay-updater',
 maintenance='/var/lib/relay-updater-control/maintenance',socketPath='/run/relay-updater-control/broker.sock',bridgeKeyFile='/etc/relay-updater/bridge.key',
 node='/usr/bin/node',python='/usr/bin/python3',gh='/usr/bin/gh')
MIGRATIONS='/var/lib/relay-control-plane-migrations'
FIXTURE_MARK=b'SYNTHETIC CONTROL PLANE MIGRATION ONLY\n'

class Layout:
 def __init__(self,root='/',synthetic=False):
  self.root=Path(root); self.synthetic=synthetic; self.owner=os.getuid() if synthetic else 0
  c.require(self.root.is_absolute() and '..' not in self.root.parts,'Absolute normalized root required')
  if synthetic:
   scratch=Path(os.environ.get('TMPDIR',str(c.HERE.parent))).resolve()
   c.require(self.root != Path('/') and scratch in self.root.parents,'Synthetic root must be below scratch')
   with c.pinned(self.root,self.owner) as fd:
    c.require(stat.S_IMODE(os.fstat(fd).st_mode)==0o700,'Synthetic root must be private')
   c.require(c.bounded_read(self.root/'.synthetic-migration',256,self.owner)==FIXTURE_MARK,'Synthetic marker required')
  else:
   c.require(self.root==Path('/'),'Nonproduction roots require explicit synthetic mode')
 def p(self,path): return self.root/path.lstrip('/')
 @property
 def live(self): return self.p('/opt/relay-updater')
 @property
 def marker(self): return self.p(FIXED['maintenance'])
 def inv(self,path,**kw): return c.inventory(path,owner=kw.pop('owner',self.owner),**kw)
 def read(self,path,limit=1024**2): return c.bounded_read(path,limit,self.owner)

class Systemd:
 def __init__(self,layout,executable='/usr/bin/systemctl',runner=c.command):
  self.l,self.exe,self.runner=layout,str(executable),runner
  if layout.synthetic:
   c.require(layout.root in Path(self.exe).parents,'Synthetic systemctl must be inside fixture')
  else: c.require(self.exe=='/usr/bin/systemctl','Fixed systemctl required')
  # Distro executable symlinks are allowed only with a root-trusted final target.
  target=Path(self.exe).resolve(strict=True)
  with c.pinned(target,layout.owner,directory=False): pass
 def call(self,*args):
  return self.runner([self.exe,*args],timeout=190,env=c.ENV)
 def show(self,unit):
  c.require(unit in UNITS,'Unapproved service')
  raw=self.call('show',unit,'--no-pager','--property='+','.join(PROPS))
  result={}
  for line in raw.splitlines():
   key,sep,value=line.partition('=')
   c.require(sep and key in PROPS and key not in result,'Unsupported systemd readback')
   result[key]=value
  c.require(set(result)==set(PROPS),'Incomplete systemd identity')
  c.require(result['Id']==unit and result['Names']==unit and result['LoadState']=='loaded' and result['Transient']=='no'
   and result['FragmentPath']=='/etc/systemd/system/'+unit and result['DropInPaths']=='' and result['SourcePath']=='',
   'Generated, aliased, dropped-in or unknown unit refused')
  path,argv,user,group,wd=EXEC[unit]
  command=re.fullmatch(r'\{ path=([^;]+?) ; argv\[\]=([^;]+?) ; ignore_errors=no ;[^{}]*\}',result['ExecStart'])
  c.require(command is not None and command.group(1)==path and command.group(2)==argv and
   (result['User'],result['Group'],result['WorkingDirectory'])==(user,group,wd),'Unexpected systemd executable or identity')
  result['ExecStart']=dict(path=path,argv=argv)
  c.require(result['MainPID'].isdigit(),'Invalid systemd process identity')
  return result
 def identities(self):
  return {u:{k:v for k,v in self.show(u).items() if k not in ('ActiveState','SubState','MainPID')} for u in UNITS}
 def state(self,unit,running):
  v=self.show(unit)
  c.require((v['ActiveState'],v['SubState'])==(('active','running') if running else ('inactive','dead')) and
    (int(v['MainPID'])>0 if running else v['MainPID']=='0'),'Service state not acknowledged')
  return int(v['MainPID'])
 def stop(self):
  for unit in reversed(UNITS[1:]):
   self.call('stop',unit); self.state(unit,False)
 def start(self):
  for unit in UNITS[1:]:
   self.call('start',unit); self.state(unit,True)


def file_entry(layout,path):
 with c.pinned(path,layout.owner,directory=False) as fd:
  s=os.fstat(fd)
  raw=layout.read(path,4*1024**2)
  c.require(c.identity(s)==c.identity(os.fstat(fd)),'File changed during readback')
  return dict(uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,size=len(raw),sha256=c.sha(raw))


def validate_configuration(l):
 entries=l.inv(l.p('/etc/relay-updater'))
 c.require(set(entries)==CONFIG_FILES,'Unknown configuration entries; explicit unsupported mixed installation')
 for name in ('broker.json','bridge.key','relay.env','relay-release.json','relay-release.attestation.json'):
  c.require(entries[name]['mode'] in ((0o600,0o640) if name in ('bridge.key','relay.env') else (0o600,)), 'Protected configuration permissions refused')
 b=c.decode(l.read(l.p('/etc/relay-updater/broker.json')))
 w=c.decode(l.read(l.p('/etc/relay-updater/web.json')))
 c.require(isinstance(b,dict) and set(b)==set(FIXED)|{'mode','networkMode','uiOrigin','readinessUrl','relayUid','socketGid'} and
   b['mode']=='production' and all(b[k]==v for k,v in FIXED.items()),'Unsupported broker configuration; no adoption')
 c.require(type(b['relayUid']) is int and b['relayUid']>0 and type(b['socketGid']) is int and b['socketGid']>0,'Missing service identity')
 c.require(isinstance(w,dict) and set(w)=={'uiOrigin','relayOrigin','networkMode','socketPath','bind'} and
   w['uiOrigin']==b['uiOrigin'] and w['networkMode']==b['networkMode'] and w['socketPath']==FIXED['socketPath'],'Unsupported web configuration')
 origin=urlsplit(w['relayOrigin']); ui=urlsplit(b['uiOrigin'])
 c.require(origin.scheme=='http' and ui.scheme=='http' and origin.hostname==ui.hostname and origin.port==4180 and ui.port==4191 and
   w['relayOrigin']==f'http://{origin.hostname}:4180' and b['uiOrigin']==f'http://{origin.hostname}:4191' and
   b['readinessUrl']==w['relayOrigin']+'/health/ready','Unsupported configured origin')
 if b['networkMode']=='loopback': c.require(origin.hostname=='localhost' and w['bind']=='127.0.0.1','Unsupported loopback mode')
 elif b['networkMode']=='private-lan':
  import ipaddress
  ip=ipaddress.IPv4Address(origin.hostname)
  c.require(str(ip)==origin.hostname and any(ip in ipaddress.IPv4Network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')) and w['bind']==str(ip),'Unsupported private-LAN mode')
 else: raise c.Refused('Unsupported network mode')
 if not l.synthetic:
  import pwd,grp
  c.require(pwd.getpwnam('relay').pw_uid==b['relayUid'] and grp.getgrnam('relay-updater-socket').gr_gid==b['socketGid'],'Service accounts differ')
  web=pwd.getpwnam('relay-updater-web')
  c.require(web.pw_uid!=b['relayUid'] and web.pw_uid!=0,'Unexpected web identity')
  c.require(entries['bridge.key']['gid']==pwd.getpwnam('relay').pw_gid,'Bridge key group differs')
 c.require(len(l.read(l.p('/etc/relay-updater/bridge.key'),4096))>=32,'Invalid bridge key length')
 return entries,b,w


def unit_files(l):
 entries={}
 # Refuse every alternate unit or drop-in, including generated/transient paths.
 for unit in UNITS:
  entries[unit]=file_entry(l,l.p('/etc/systemd/system/'+unit))
  c.require(entries[unit]['mode']==0o644,'Unexpected unit permissions')
  for directory in ('/etc/systemd/system','/run/systemd/system','/run/systemd/transient','/run/systemd/generator','/run/systemd/generator.early','/run/systemd/generator.late','/usr/local/lib/systemd/system','/usr/lib/systemd/system','/lib/systemd/system'):
   for suffix in ('','.d'):
    if directory=='/etc/systemd/system' and suffix=='': continue
    c.require(not os.path.lexists(l.p(directory+'/'+unit+suffix)),'Alternate unit/drop-in refused')
 return entries


def runtime(l):
 install=l.p('/opt/relay')
 with c.pinned(install,l.owner) as fd:
  s=os.stat('current',dir_fd=fd,follow_symlinks=False)
  c.require(stat.S_ISLNK(s.st_mode) and s.st_uid==l.owner,'Managed runtime symlink required')
  link=os.readlink('current',dir_fd=fd); target=Path(link)
  c.require(target.parent in (Path('releases'),Path('/opt/relay/releases')) and re.fullmatch(r'v0\.6\.9-[0-9a-f]{16}',target.name),
   'First perform normal v0.6.9 runtime update through unchanged old control plane')
  release=install/'releases'/target.name
  receipt=c.decode(l.read(release/'.relay-verified.json',4096))
  c.require(isinstance(receipt,dict) and set(receipt)=={'mode','version','sha256'} and receipt['mode']=='production' and
   receipt['version']==c.TARGET and isinstance(receipt['sha256'],str) and c.HEX.fullmatch(receipt['sha256']) and target.name.endswith(receipt['sha256'][:16]),'Runtime verified receipt differs')
  package=c.decode(l.read(release/'package.json'))
  c.require(isinstance(package,dict) and package.get('version')=='0.6.9','Runtime package/version differs')
  # Full bounded code identity, not only a version label/receipt.
  tree=l.inv(release,max_entries=100000,max_bytes=3*1024**3,timeout=120)
  c.require(c.identity(s)==c.identity(os.stat('current',dir_fd=fd,follow_symlinks=False)) and os.readlink('current',dir_fd=fd)==link,'Runtime changed while inspecting')
 return dict(link=link,tree=tree,receipt=receipt)


def broker_state(l):
 root=l.p('/var/lib/relay-updater')
 with c.pinned(root,l.owner) as fd:
  c.require(stat.S_IMODE(os.fstat(fd).st_mode)==0o700,'Broker durable directory must be private')
 c.require(os.path.lexists(root/'broker.lock'),'Existing enrolled broker lock required; no adoption')
 entries=l.inv(root,max_entries=100000,max_bytes=3*1024**3,timeout=120)
 c.require(entries['broker.lock']['kind']=='file' and entries['broker.lock']['mode']==0o600,'Broker lock permissions refused')
 # Engine atomically rewrites an idle journal on startup, without changing bytes.
 entries['journal.json'].pop('mtimeNs',None)
 return entries


def snapshot(l,system,include_control=True):
 config,b,w=validate_configuration(l)
 journal=l.p('/var/lib/relay-updater/journal.json')
 j=file_entry(l,journal)
 c.require(j['mode']==0o600,'Journal must be protected 0600')
 value=c.decode(l.read(journal,4*1024**2)); c.admit_idle(value,c.TARGET)
 uid=l.owner if l.synthetic else b['relayUid']
 return dict(control=l.inv(l.live) if include_control else None,config=config,units=unit_files(l),systemd=system.identities(),runtime=runtime(l),
   state=l.inv(l.p('/var/lib/relay'),owner=uid,max_entries=100000,max_bytes=3*1024**3,timeout=120),journal=j,brokerState=broker_state(l),runtimePID=system.state(UNITS[0],True))


def reviewed(l,path,digest,snap):
 if not l.synthetic:
  c.require(path is None and digest is None,'Operator baseline JSON is not authority')
  admitted=qualification(l)
  from .policy import stock_control, BASELINE
  baseline=stock_control(snap)
  c.require(snap['config']['relay-release.json']['sha256']==BASELINE['manifestSha256'],
   'Installed old provenance manifest differs; mixed baseline inspect-only')
  c.require(snap['runtime']['receipt']['sha256']==admitted['runtimeArtifact']['sha256'],
   'Exact qualified target runtime differs; use normal old-UI update first')
  return baseline
 c.require(path is not None and isinstance(digest,str) and c.HEX.fullmatch(digest),'Synthetic baseline digest required')
 raw=l.read(Path(path),8*1024**2)
 c.require(c.sha(raw)==digest,'Synthetic baseline digest differs')
 value=c.decode(raw)
 c.require(isinstance(value,dict) and set(value)=={'schema','kind','control','config','units','systemd'} and value['schema']==1 and
  value['kind']=='SYNTHETIC-COMPLETE-INVENTORY-NOT-AUTHORITY','Synthetic manifest required; caller reviewId is not authority')
 control=snap['control']
 c.require(set(control)=={'.','engine.py'} and control['engine.py']['sha256']==c.sha(b'actual old installed control code'),
  'Unsupported mixed synthetic baseline; fixed fixture bytes only')
 c.require(all(value[k]==snap[k] for k in ('control','config','units','systemd')),'Unsupported mixed baseline differs from synthetic inventory')
 return value


def inspect(l,system,baseline=None,baseline_sha=None):
 snap=snapshot(l,system)
 for u in UNITS: system.state(u,True)
 c.require(not os.path.lexists(l.marker),'Existing maintenance/recovery hold; do not clear')
 admitted=False; reason='unknown mixed baseline: fixed official stock archive required'
 if l.synthetic:
  if baseline is not None: reviewed(l,baseline,baseline_sha,snap); admitted=True
 else:
  try: reviewed(l,baseline,baseline_sha,snap); admitted=True
  except c.Refused as error: reason=str(error)
 plan=dict(schema=1,target=c.TARGET,root=str(l.root),synthetic=l.synthetic,baselineSha256=baseline_sha,snapshot=snap)
 return dict(scope='synthetic-scratch-only' if l.synthetic else 'read-only-operator-inspection-NOT-production-qualification',
  admitted=admitted,reason=None if admitted else reason,
  plan=plan,planSha256=c.sha(c.canonical(plan)))


@contextlib.contextmanager
def exclusive(l,path,create=True):
 # Existing files are validated, never truncated or replaced; locks remain durable.
 parent=Path(path).parent
 with c.pinned(parent,l.owner) as pfd:
  c.check_binding(parent,pfd,l.owner)
  fd=os.open(Path(path).name,os.O_RDWR|(os.O_CREAT if create else 0)|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=pfd)
  try:
   s=os.fstat(fd)
   c.require(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==l.owner and stat.S_IMODE(s.st_mode)==0o600,'Unprotected lock refused')
   os.fsync(pfd)
   try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except OSError: raise c.Refused('Migration or broker lock busy') from None
   c.check_binding(parent,pfd,l.owner)
   c.require(c.identity(s)==c.identity(os.stat(Path(path).name,dir_fd=pfd,follow_symlinks=False)),'Lock binding changed')
   yield fd
  finally: os.close(fd)


def protected_receipt(l,path):
 value=c.decode(l.read(path,16*1024**2))
 with c.pinned(path,l.owner,directory=False) as fd:
  c.require(stat.S_IMODE(os.fstat(fd).st_mode)==0o600,'Receipt must be protected 0600')
 return value


class Host:
 def __init__(self,l,system,baseline,tx):
  self.l,self.s,self.before,self.tx=l,system,baseline,tx
  self.lock=None; self.mark=tx.name.encode()+b'\n'
 def gate(self):
  if os.path.lexists(self.l.marker):
   c.require(self.l.read(self.l.marker,256)==self.mark,'Existing foreign maintenance hold')
   return
  with c.pinned(self.l.marker.parent,self.l.owner) as fd:
   c.check_binding(self.l.marker.parent,fd,self.l.owner)
   f=os.open(self.l.marker.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644,dir_fd=fd)
   with os.fdopen(f,'wb') as out:
    c.check_binding(self.l.marker.parent,fd,self.l.owner)
    os.fchmod(out.fileno(),0o644); out.write(self.mark); out.flush(); os.fsync(out.fileno())
   os.fsync(fd)
 def stop(self):
  self.unlock()
  self.s.stop()
 def stopped_idle(self):
  for u in UNITS[1:]: self.s.state(u,False)
  self.s.state(UNITS[0],True)
  if self.lock is None:
   self.lock=exclusive(self.l,self.l.p('/var/lib/relay-updater/broker.lock'),create=False); self.lock.__enter__()
  c.admit_idle(c.decode(self.l.read(self.l.p('/var/lib/relay-updater/journal.json'),4*1024**2)),c.TARGET)
 def unlock(self):
  if self.lock is not None:
   lock,self.lock=self.lock,None; lock.__exit__(None,None,None)
 def preserved(self):
  now=snapshot(self.l,self.s,include_control=False)
  c.require(all(now[k]==self.before[k] for k in ('config','units','systemd','runtime','state','journal','brokerState','runtimePID')),
   'Protected configuration, keys, units, journal, state or runtime changed; recovery held')
 def start(self):
  self.unlock(); self.s.start()
 def health(self,kind,maintenance=True):
  deadline=time.monotonic()+15
  while True:
   try:
    self._health(maintenance)
    return
   except (OSError,ValueError,c.Refused):
    if time.monotonic()>=deadline: raise c.Refused('Bounded readiness failed; private output suppressed') from None
    time.sleep(0.1)
 def _health(self,maintenance):
  for u in UNITS: self.s.state(u,True)
  if self.l.synthetic:
   value=c.decode(self.l.read(self.l.root/'fixture-health.json',4096))
   expected='new' if c.inventory(self.l.live,owner=self.l.owner)==c.decode(self.l.read(self.tx/'new.json',4*1024**2)) else 'old'
   c.require(value.get(expected) is True,'SYNTHETIC fixture readiness rejected')
   return
  _,b,w=validate_configuration(self.l)
  # Validate the Unix peer as the actual root systemd broker, not just a live socket.
  path=self.l.p(FIXED['socketPath'])
  with c.pinned(path.parent,self.l.owner) as pfd:
   s=os.stat(path.name,dir_fd=pfd,follow_symlinks=False)
   c.require(stat.S_ISSOCK(s.st_mode) and s.st_uid==0 and s.st_gid==b['socketGid'] and stat.S_IMODE(s.st_mode)==0o660,'Broker socket identity differs')
   with socket.socket(socket.AF_UNIX) as peer:
    import struct
    peer.settimeout(1); peer.connect(str(path))
    pid,uid,_=struct.unpack('3i',peer.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
    c.require(uid==0 and pid==self.s.state(UNITS[1],True),'Broker process peer differs')
  class NoRedirect(urllib.request.HTTPRedirectHandler):
   def redirect_request(self,*args): raise c.Refused('Readiness redirect refused')
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
  with opener.open(b['readinessUrl'],timeout=1) as response:
   raw=response.read(4097)
   c.require(response.status==200 and len(raw)<=4096,'Runtime readiness bound')
   value=c.decode(raw)
   c.require(isinstance(value,dict) and value.get('status')=='ready' and value.get('version')=='0.6.9' and value.get('maintenance') is maintenance,'Runtime readiness differs')
  with opener.open(w['uiOrigin']+'/updater/',timeout=1) as response:
   raw=response.read(1024**2+1)
   c.require(response.status==200 and len(raw)<=1024**2 and b'<html' in raw.lower(),'Independent web readiness failed')
 def release(self,kind):
  # Broker's startup maintenance reason is sticky: restart AFTER releasing our marker.
  self.stop(); self.stopped_idle(); self.preserved()
  with c.pinned(self.l.marker.parent,self.l.owner) as fd:
   before=os.stat(self.l.marker.name,dir_fd=fd,follow_symlinks=False)
   c.require(self.l.read(self.l.marker,256)==self.mark,'Maintenance identity changed')
   c.check_binding(self.l.marker.parent,fd,self.l.owner)
   c.require(c.identity(before)==c.identity(os.stat(self.l.marker.name,dir_fd=fd,follow_symlinks=False)), 'Maintenance replaced before unlink')
   os.unlink(self.l.marker.name,dir_fd=fd); os.fsync(fd)
  try:
   self.start(); self.health(kind,maintenance=False); self.preserved()
  except Exception:
   self.gate()
   try: self.stop()
   finally: self.unlock()
   raise c.Refused('Final release readiness uncertain; maintenance held; operator recovery required') from None


def verifier_module():
 # Current canonical dependencies equal the accepted verifier bytes. No private copy.
 from updater.broker import releases
 from . import policy
 expected={'updater/broker/auth.py':'7e68aef43dc722eca611397adfa75b171588a226099513c92a7daabf53dbb400',
  'updater/broker/releases.py':'92121bb3a137eab4b329bbbef2c272dc8bd9335487be015ba76ba0a347955dec'}
 for name,digest in expected.items():
  c.require(c.sha(policy.read(policy.ROOT/name))==digest,'Canonical verifier dependency differs')
 return releases


def copy_protected(l,source,destination,limit):
 destination=Path(destination)
 with c.pinned(source,l.owner,directory=False) as fd, c.pinned(destination.parent,l.owner) as pfd:
  before=os.fstat(fd); c.require(before.st_size<=limit,'Release input exceeds bound')
  total=0; deadline=time.monotonic()+120
  c.check_binding(destination.parent,pfd,l.owner)
  outfd=os.open(destination.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=pfd)
  with os.fdopen(outfd,'wb') as out:
   os.fchmod(out.fileno(),0o600)
   while True:
    raw=os.read(fd,65536)
    if not raw: break
    total+=len(raw)
    c.require(total<=limit and total<=before.st_size and time.monotonic()<deadline,'Release input changed or bound exceeded')
    c.check_binding(destination.parent,pfd,l.owner)
    out.write(raw)
   out.flush(); os.fsync(out.fileno())
  c.require(total==before.st_size and c.identity(before)==c.identity(os.fstat(fd)),'Release input changed')
  os.fsync(pfd)


from .archive_069 import bounded_gzip, verify_archive, extract_archive


def verified_candidate(l,release_dir,work,manifest_sha,source):
 work=Path(work)
 with c.pinned(work,l.owner) as workfd:
  c.require(stat.S_IMODE(os.fstat(workfd).st_mode)==0o700,'Private verification workspace required')
  return _verified_candidate(l,release_dir,work,manifest_sha,source,workfd)


def _verified_candidate(l,release_dir,work,manifest_sha,source,workfd):
 c.require(isinstance(manifest_sha,str) and c.HEX.fullmatch(manifest_sha),'Exact pinned manifest digest required')
 c.require(isinstance(source,str) and re.fullmatch('[0-9a-f]{40}',source),'Exact reviewed publication commit required')
 for name in ('relay-release.json','relay-release.attestation.json','relay-updater-linux-x64.tar.gz'):
  c.check_binding(work,workfd,l.owner)
  copy_protected(l,Path(release_dir)/name,work/name,1024**3 if name.endswith('.gz') else 4*1024**2)
 c.check_binding(work,workfd,l.owner)
 raw=l.read(work/'relay-release.json')
 c.require(c.sha(raw)==manifest_sha,'Pinned target manifest differs')
 if l.synthetic:
  proof=c.decode(l.read(work/'relay-release.attestation.json'))
  c.require(proof==dict(kind='SYNTHETIC-FIXED-FIXTURE-NOT-GITHUB',manifestSha256=manifest_sha,source=source), 'Synthetic fixed proof differs; NOT GitHub provenance')
 else: c.attest(work,c.TARGET,source)
 mod=verifier_module()
 try:
  import tarfile
  value=mod.manifest_valid(c.decode(raw),c.TARGET)
  c.check_binding(work,workfd,l.owner)
  expected=verify_archive(l,work/'relay-updater-linux-x64.tar.gz',value.get('updaterArtifact'),mod.artifact_valid)
  # Same fixed manifest/artifact rules and no-link/path intent as frozen verifier;
  # extraction writes are now exclusively relative to held trusted descriptors.
  bounded_gzip(work/'relay-updater-linux-x64.tar.gz',owner=l.owner)
  c.check_binding(work,workfd,l.owner)
  extract_archive(l,work/'relay-updater-linux-x64.tar.gz',work/'candidate',workfd,expected)
 except (mod.Denied,OSError,ValueError,KeyError,TypeError,EOFError,tarfile.TarError):
  raise c.Refused('Manifest or archive verifier refused target') from None
 candidate=work/'candidate'
 c.check_binding(work,workfd,l.owner)
 entries=l.inv(candidate)
 required=('package.json','updater/broker/server.py','updater/broker/engine.py','updater/broker/auth.py','updater/broker/releases.py','updater/web/index.mjs','updater/ui/dist/index.html')
 c.require(all(name in entries and entries[name]['kind']=='file' for name in required),'Incomplete verified control plane')
 package=c.decode(l.read(candidate/'package.json'))
 c.require(isinstance(package,dict) and package.get('version')=='0.6.9','Target control package version differs')
 return candidate


def source_digests():
 from .policy import closure
 return closure()


def qualification(l,path=None):
 # Deliberately no operator-loadable qualification policy in this distribution.
 # path is retained only for old in-process callers; its contents are NEVER read.
 c.require(type(l) is Layout,'Production apply disabled: no release-qualified policy')
 if l.synthetic:
  Layout(l.root,True)  # Revalidate scratch confinement, not just a boolean predicate.
  return
 from .policy import qualified
 return qualified()


def migration_root(l):
 root=l.p(MIGRATIONS)
 with c.pinned(root.parent,l.owner) as pfd:
  c.check_binding(root.parent,pfd,l.owner)
  if not c.exists_at(pfd,root.name):
   os.mkdir(root.name,0o700,dir_fd=pfd); os.fsync(pfd)
  # Never chmod/adopt an existing public root, link or untrusted directory.
  with c.pinned(root,l.owner) as fd:
   c.require(stat.S_IMODE(os.fstat(fd).st_mode)==0o700,'Private migration root required')
 return root


def apply(l,system,args):
 admitted=qualification(l)
 if not l.synthetic:
  c.require(admitted is not None and args.source_commit==admitted['target']['sourceCommit'] and
   args.manifest_sha256==admitted['manifestSha256'],'Exact qualified target source/manifest differs')
 # Read-only plan/baseline validation before creating any transaction directory.
 report=inspect(l,system,args.reviewed_baseline,args.reviewed_baseline_sha256)
 c.require(report['admitted'] and report['planSha256']==args.plan_sha256,'Exact admitted old plan digest differs; inspect and review again')
 root=migration_root(l)
 with exclusive(l,root/'migration.lock'), c.pinned(root,l.owner) as rfd:
  tx=root/secrets.token_hex(16)
  c.check_binding(root,rfd,l.owner)
  os.mkdir(tx.name,0o700,dir_fd=rfd); os.fsync(rfd)
  host=None
  try:
   candidate=verified_candidate(l,args.release_dir,tx,args.manifest_sha256,args.source_commit)
   c.require(inspect(l,system,args.reviewed_baseline,args.reviewed_baseline_sha256)['planSha256']==args.plan_sha256,'Baseline changed during verification')
   transaction=c.TreeTransaction(l.live,tx,owner=l.owner); transaction.prepare(candidate)
   receipt=dict(schema=1,kind='SYNTHETIC-NOT-QUALIFIED' if l.synthetic else 'CONTROL-PLANE-MIGRATION',root=str(l.root),
    tx=tx.name,source=source_digests(),planSha256=args.plan_sha256,targetManifestSha256=args.manifest_sha256,
    targetSource=args.source_commit,baseline=report['plan']['snapshot'],
    oldInventorySha256=c.sha(c.canonical(transaction.load('old.json'))),newInventorySha256=c.sha(c.canonical(transaction.load('new.json'))))
   transaction.guard(); c.write_json(tx/'receipt.json',receipt,transaction.rfd,l.owner)
   host=Host(l,system,receipt['baseline'],tx)
   c.activate(transaction,host)
   # Final restart, health and durable completion are INSIDE activate recovery.
   return dict(status='activated',synthetic=l.synthetic,receipt=str(tx/'receipt.json'),qualification=False)
  except c.Refused as error:
   location=tx/'receipt.json' if (tx/'receipt.json').exists() else tx
   raise c.Refused(str(error)+'; protected transaction: '+str(location)) from None
  finally:
   if host is not None: host.unlock()


def rollback(l,system,args):
 qualification(l)
 path=Path(args.receipt); root=l.p(MIGRATIONS)
 c.require(path.is_absolute() and path.name=='receipt.json' and path.parent.parent==root and re.fullmatch('[0-9a-f]{32}',path.parent.name),'Receipt must be a fixed protected migration transaction')
 with exclusive(l,root/'migration.lock'):
  receipt=protected_receipt(l,path)
  expected_kind='SYNTHETIC-NOT-QUALIFIED' if l.synthetic else 'CONTROL-PLANE-MIGRATION'
  c.require(isinstance(receipt,dict) and set(receipt)=={'schema','kind','root','tx','source','planSha256','targetManifestSha256','targetSource','baseline','oldInventorySha256','newInventorySha256'} and
   receipt['schema']==1 and receipt['kind']==expected_kind and receipt['root']==str(l.root) and receipt['tx']==path.parent.name and receipt['source']==source_digests(),'Receipt identity differs')
  transaction=c.TreeTransaction(l.live,path.parent,owner=l.owner)
  old,new=transaction.load('old.json'),transaction.load('new.json')
  c.require(c.sha(c.canonical(old))==receipt['oldInventorySha256'] and c.sha(c.canonical(new))==receipt['newInventorySha256'] and old==receipt['baseline']['control'],'Receipt inventory binding differs')
  phase_state=transaction.load('phase.json'); phase=phase_state['phase']
  rename_phases=('moving-old','publishing-new','removing-candidate','restoring-old')
  c.require(phase in ('activated','healthy-maintenance-held','published',*rename_phases,'restored','rolled-back',
   'recovery-uncertain-maintenance-held','recovery-uncertain-maintenance-unconfirmed','restored-healthy-maintenance-held',
   'rollback-stopping-maintenance-unverified','rollback-starting-maintenance-held','rollback-releasing-maintenance'), 'Unsupported rollback phase')
  checkpoint=phase_state.get('checkpoint',phase)
  if os.path.lexists(path.parent/'old'):
   c.require(transaction.inv(path.parent/'old')==old,'Old backup differs; rollback refused before service mutation')
  else:
   c.require(os.path.lexists(l.live) and transaction.inv(l.live)==old,'Missing exact old backup; rollback refused')
  if os.path.lexists(path.parent/'rejected'):
   c.require(transaction.inv(path.parent/'rejected')==new,'Retained rejected candidate differs; rollback refused before service mutation')
  host=Host(l,system,receipt['baseline'],path.parent)
  mutation_started=False
  try:
   # A completion replace followed by failed fsync/uncertainty persistence can
   # leave rolled-back on disk under our recovery hold. Retry only that case;
   # ordinary already-completed rollback is not an invitation to mutate again.
   if phase=='rolled-back':
    c.require(checkpoint in rename_phases and os.path.lexists(l.marker) and
     l.read(l.marker,256)==host.mark and transaction.inv(l.live)==old,'Completed rollback has no owned held recovery checkpoint')
   # Refuse drift BEFORE any service or maintenance mutation. Missing live is
   # admitted only for the recorded two-rename interruption, with exact backup.
   if os.path.lexists(l.live):
    inv=transaction.inv(l.live)
    c.require(inv in (new,old),'New changes/local repair: rollback refused')
   else: c.require(checkpoint in rename_phases and transaction.inv(path.parent/'old')==old,'Missing code without exact recovery checkpoint')
   # A preflight refusal must not stop services, even under an existing hold.
   host.preserved()
   if os.path.lexists(l.marker):
    c.require(l.read(l.marker,256)==host.mark,'Existing foreign maintenance hold')
   transaction.phase('rollback-stopping-maintenance-unverified')
   mutation_started=True
   host.gate(); host.stop(); host.stopped_idle()
   host.preserved()
   transaction.restore(); host.preserved()
   # A failed uncertainty write must leave an unverified stage, not fake health.
   transaction.phase('rollback-starting-maintenance-held')
   host.start(); host.health('old'); host.preserved()
   transaction.phase('rollback-releasing-maintenance')
   host.release('old'); transaction.phase('rolled-back')
   return dict(status='rolled-back',synthetic=l.synthetic,receipt=str(path))
  except Exception as error:
   if not mutation_started: raise
   # Final release may have removed the marker before completion persistence
   # failed. Reacquire our hold BEFORE any further service effect. Never take
   # over a foreign hold, nor call stop if ownership cannot be acknowledged.
   held=False
   services={u:'not-attempted-hold-unconfirmed' for u in UNITS[1:]}
   try:
    host.gate()
    held=l.read(l.marker,256)==host.mark
   except Exception: pass
   if held:
    host.unlock()
    for unit in reversed(UNITS[1:]):
     try:
      c.require(l.read(l.marker,256)==host.mark,'Maintenance ownership unconfirmed')
      system.call('stop',unit); system.state(unit,False)
      services[unit]='stopped-acknowledged'
     except Exception: services[unit]='stop-unconfirmed'
    try: held=l.read(l.marker,256)==host.mark
    except Exception: held=False
   persisted=False
   try:
    transaction.guard()
    c.write_json(path.parent/'rollback-recovery.json',dict(schema=1,maintenanceHeld=held,
     services=services,health='unverified'),transaction.rfd,l.owner)
    transaction.phase('recovery-uncertain-maintenance-held' if held else 'recovery-uncertain-maintenance-unconfirmed')
    persisted=True
   except Exception: pass  # Atomic persistence retains the prior durable checkpoint.
   message='Rollback failed; recovery uncertain; '+('maintenance held' if held else 'maintenance unconfirmed')
   message+='; service stop acknowledgement recorded' if persisted else '; uncertainty persistence failed; retain previous durable checkpoint'
   raise (OSError if isinstance(error,OSError) else c.Refused)(message) from None
  finally: host.unlock()


def main(argv=None):
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--root',default='/')
 parser.add_argument('--synthetic-fixture',action='store_true',help='Explicit scratch-only fixture, never production provenance')
 parser.add_argument('--systemctl',default='/usr/bin/systemctl')
 sub=parser.add_subparsers(dest='operation')
 ip=sub.add_parser('inspect',help='Read-only; no download/install/lock/marker writes')
 ap=sub.add_parser('apply',help='Explicit exact-plan activation; parent qualification required on Linux')
 rp=sub.add_parser('rollback',help='Protected receipt only; changed state/code refused')
 for p in (ip,ap):
  p.add_argument('--reviewed-baseline'); p.add_argument('--reviewed-baseline-sha256')
 ap.add_argument('--plan-sha256',required=True)
 ap.add_argument('--release-dir',required=True)
 ap.add_argument('--manifest-sha256',required=True)
 ap.add_argument('--source-commit',required=True)
 rp.add_argument('--receipt',required=True)
 args=parser.parse_args(argv)
 # Default inspect uses identical read-only options even without a subcommand.
 if args.operation is None: args.operation='inspect'; args.reviewed_baseline=None; args.reviewed_baseline_sha256=None
 l=Layout(args.root,args.synthetic_fixture)
 if args.operation!='inspect': qualification(l)
 system=Systemd(l,args.systemctl)
 if args.operation=='inspect': value=inspect(l,system,args.reviewed_baseline,args.reviewed_baseline_sha256)
 elif args.operation=='apply': value=apply(l,system,args)
 else: value=rollback(l,system,args)
 print(json.dumps(value,sort_keys=True,separators=(',',':')))
 return 0 if args.operation!='inspect' or value['admitted'] else 2
