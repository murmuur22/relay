"""Descriptor-only local archive reads/extraction; no network or authority policy.
Frozen manifest/artifact validators remain unchanged. Extraction retains their
no-link/name/case checks and adds held-directory writes and smaller bounds.
"""
import contextlib, gzip, hashlib, os, stat, tarfile, time
from pathlib import Path, PurePosixPath
from . import control_plane_upgrade_069 as c

MAX_BYTES=128*1024**2
MAX_ENTRIES=4096

def verify_archive(l,path,artifact,validator):
 validator(artifact,'relay-updater-linux-x64.tar.gz')
 with c.pinned(path,l.owner,directory=False) as fd:
  before=os.fstat(fd)
  c.require(before.st_size==artifact['size'],'Artifact size/type mismatch')
  digest=hashlib.sha256(); count=0; deadline=time.monotonic()+120
  while True:
   raw=os.read(fd,65536)
   if not raw: break
   count+=len(raw)
   c.require(count<=artifact['size'] and time.monotonic()<deadline,'Artifact read bound exceeded')
   digest.update(raw)
  c.require(count==artifact['size'] and digest.hexdigest()==artifact['sha256'] and c.identity(before)==c.identity(os.fstat(fd)),'Artifact digest/identity mismatch')
  return c.identity(before)

def bounded_gzip(path,max_bytes=MAX_BYTES,owner=None):
 owner=os.getuid() if owner is None else owner
 total=0; deadline=time.monotonic()+30
 with c.pinned(path,owner,directory=False) as fd:
  before=os.fstat(fd)
  with os.fdopen(os.dup(fd),'rb') as source, gzip.GzipFile(fileobj=source,mode='rb') as stream:
   while True:
    raw=stream.read(65536)
    if not raw: break
    total+=len(raw)
    c.require(total<=max_bytes and time.monotonic()<deadline,'Control archive decompression envelope exceeded')
  c.require(c.identity(before)==c.identity(os.fstat(fd)),'Archive changed while decompressing')

def extract_archive(l,archive,destination,workfd,expected):
 destination=Path(destination); work=destination.parent
 c.check_binding(work,workfd,l.owner)
 with contextlib.ExitStack() as stack:
  sourcefd=stack.enter_context(c.pinned(archive,l.owner,directory=False))
  c.require(c.identity(os.fstat(sourcefd))==expected,'Archive changed after verification')
  source=stack.enter_context(os.fdopen(os.dup(sourcefd),'rb'))
  tar=stack.enter_context(tarfile.open(fileobj=source,mode='r:gz'))
  c.check_binding(work,workfd,l.owner)
  os.mkdir(destination.name,0o700,dir_fd=workfd)
  rootfd=os.open(destination.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=workfd); stack.callback(os.close,rootfd)
  dirs={():rootfd}; spellings={}; seen=set(); expanded=0; deadline=time.monotonic()+30; count=0
  def guard(parts):
   c.require(time.monotonic()<deadline,'Archive extraction deadline exceeded')
   c.check_binding(work,workfd,l.owner)
   c.check_binding(destination.joinpath(*parts),dirs[parts],l.owner)
   c.require(c.identity(os.fstat(sourcefd))==expected,'Archive changed during extraction')
  def directory(parts):
   if parts in dirs: guard(parts); return dirs[parts]
   parent=directory(parts[:-1]); guard(parts[:-1])
   c.require(len(dirs)<MAX_ENTRIES,'Archive directory bound exceeded')
   os.mkdir(parts[-1],0o755,dir_fd=parent)
   fd=os.open(parts[-1],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent); stack.callback(os.close,fd)
   dirs[parts]=fd
   return fd
  for member in tar:
   count+=1; name=member.name; parts=PurePosixPath(name).parts
   c.require(parts and not name.startswith('/') and '\\' not in name and
    not any(p in ('..','.') for p in name.split('/')) and not any(ord(ch)<32 for ch in name) and len(parts)<=32 and len(name)<=4096,'Unsafe archive path')
   c.require(name.casefold() not in seen and count<=MAX_ENTRIES and not member.mode & 0o7000 and
    (member.isfile() or member.isdir()),'Unsafe archive entry')
   for index in range(1,len(parts)+1):
    prefix='/'.join(parts[:index]); folded=prefix.casefold()
    c.require(folded not in spellings or spellings[folded]==prefix,'Case-colliding archive paths')
    spellings[folded]=prefix
   seen.add(name.casefold()); expanded+=member.size
   c.require(0<=member.size<=64*1024**2 and expanded<=MAX_BYTES,'Expanded archive too large')
   if member.isdir(): directory(parts); continue
   parent=directory(parts[:-1]); guard(parts[:-1])
   fd=os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
   with os.fdopen(fd,'wb') as out, tar.extractfile(member) as src:
    count_bytes=0
    while True:
     raw=src.read(65536)
     if not raw: break
     count_bytes+=len(raw); c.require(count_bytes<=member.size,'Archive file grew')
     guard(parts[:-1]); out.write(raw)
    c.require(count_bytes==member.size,'Archive file shortened')
    guard(parts[:-1]); out.flush(); os.fchmod(out.fileno(),0o755 if member.mode & 0o111 else 0o644); os.fsync(out.fileno())
  for parts,fd in reversed(list(dirs.items())):
   guard(parts); os.fchmod(fd,0o755); os.fsync(fd)
  guard(()); os.fsync(workfd)
