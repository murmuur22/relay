#!/usr/bin/env python3
"""Bounded, one-time v0.6.9 operator migration CANDIDATE. Default: read-only inspect.
No production apply is admitted by the unqualified development release policy.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
TARGET = 'v0.6.9'
HEX = re.compile('[0-9a-f]{64}\\Z')
class Refused(RuntimeError):
    pass

def require(value, message):
    if not value:
        raise Refused(message)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def identity(s):
    return (s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_nlink,
            s.st_size, s.st_mtime_ns, s.st_ctime_ns)

@contextlib.contextmanager
def pinned(path, owner=0, directory=True):
    """Open each absolute component relative to its already validated parent."""
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'Absolute normalized path required')
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with contextlib.ExitStack() as stack:
        fd = os.open('/', flags | os.O_DIRECTORY)
        stack.callback(os.close, fd)
        components = path.parts[1:]
        for i, name in enumerate(components):
            d = directory or i != len(components)-1
            old = os.stat(name, dir_fd=fd, follow_symlinks=False)
            child = os.open(name, flags | (os.O_DIRECTORY if d else 0), dir_fd=fd)
            stack.callback(os.close, child)
            s = os.fstat(child)
            require(identity(old) == identity(s), 'Path changed during acquisition')
            require(s.st_uid in (0, owner) and not s.st_mode & 0o7022,
                    'Untrusted ancestry or permissions')
            require(stat.S_ISDIR(s.st_mode) if d else stat.S_ISREG(s.st_mode) and s.st_nlink == 1,
                    'Link or special entry refused')
            fd = child
        yield fd

def inventory(path, owner=0, max_entries=4096, max_bytes=128*1024**2, timeout=15):
    result, total, deadline = {}, 0, time.monotonic()+timeout
    def bound(depth):
        require(len(result) < max_entries and total <= max_bytes and depth <= 32 and time.monotonic() < deadline,
                'Inventory bound exceeded')
    def walk(fd, name, depth):
        nonlocal total
        bound(depth)
        s = os.fstat(fd)
        directory = stat.S_ISDIR(s.st_mode)
        require(s.st_uid == owner and not s.st_mode & 0o7022 and
                (directory or stat.S_ISREG(s.st_mode) and s.st_nlink == 1), 'Untrusted inventory entry')
        entry = dict(kind='directory' if directory else 'file', uid=s.st_uid, gid=s.st_gid,
                     mode=stat.S_IMODE(s.st_mode), nlink=s.st_nlink)
        if directory:
            result[name] = entry
            with os.scandir(fd) as scan:
                names = []
                for e in scan:
                    require(len(names)+len(result) < max_entries, 'Inventory entry bound exceeded')
                    require(not any(ord(c)<32 for c in e.name), 'Control character in filename')
                    names.append(e.name)
            for child in sorted(names):
                old = os.stat(child, dir_fd=fd, follow_symlinks=False)
                d = stat.S_ISDIR(old.st_mode)
                require(d or stat.S_ISREG(old.st_mode), 'Link or special entry refused')
                cfd = os.open(child, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_DIRECTORY if d else 0), dir_fd=fd)
                try:
                    require(identity(old) == identity(os.fstat(cfd)), 'Inventory entry changed')
                    walk(cfd, child if name=='.' else name+'/'+child, depth+1)
                finally:
                    os.close(cfd)
        else:
            require(s.st_size <= 64*1024**2, 'Inventory file too large')
            digest, count = hashlib.sha256(), 0
            while True:
                raw = os.read(fd, 65536)
                if not raw: break
                count += len(raw); total += len(raw); bound(depth)
                require(count <= s.st_size, 'Inventory file grew')
                digest.update(raw)
            require(count == s.st_size, 'Inventory file shortened')
            entry.update(size=count, sha256=digest.hexdigest(), mtimeNs=s.st_mtime_ns)
            result[name] = entry
        require(identity(s) == identity(os.fstat(fd)), 'Inventory changed while reading')
    with pinned(path, owner) as fd:
        walk(fd, '.', 0)
    return result

def bounded_read(path, limit=1024*1024, owner=0):
    with pinned(path, owner, directory=False) as fd:
        s = os.fstat(fd)
        require(0 <= s.st_size <= limit, 'Protected file byte bound exceeded')
        raw = bytearray()
        while len(raw) <= limit:
            chunk = os.read(fd, min(65536, limit+1-len(raw)))
            if not chunk: break
            raw.extend(chunk)
        require(len(raw) == s.st_size and len(raw) <= limit and identity(s)==identity(os.fstat(fd)),
                'Protected file changed or exceeded bound')
        return bytes(raw)

def decode(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, 'Duplicate JSON key')
            value[key] = item
        return value
    try:
        return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(Refused('Nonfinite JSON')))
    except (ValueError, TypeError, RecursionError):
        raise Refused('Invalid bounded JSON') from None

def admit_idle(value, version):
    require(isinstance(value, dict) and set(value)=={'currentVersion','job','history','previous','checkpoint'},
            'Unsupported journal schema; inspect recovery before migration')
    require(value['currentVersion']==version and isinstance(value['history'],list), 'Journal/runtime identity differs')
    require(value['checkpoint'] is None, 'Rollback/recovery checkpoint holds admission')
    job = value['job']
    require(job is None or isinstance(job,dict) and job.get('phase') in ('succeeded','rolled-back','cancelled'),
            'Active/ready/failed/interrupted job holds admission')
    previous = value['previous']
    require(previous is None or isinstance(previous,dict) and previous.get('backupComplete') is True,
            'Unsupported previous rollback checkpoint')
    return value

ENV = {'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/nonexistent',
       'GH_CONFIG_DIR':'/nonexistent','GH_PROMPT_DISABLED':'1','PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1'}

def command(argv, *, timeout=60, env=None):
    import selectors
    import subprocess
    process = None
    try:
        process = subprocess.Popen(argv, env=ENV if env is None else env,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        output, total, deadline = bytearray(), 0, time.monotonic()+timeout
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, True)
            selector.register(process.stderr, selectors.EVENT_READ, False)
            while selector.get_map():
                remaining = deadline-time.monotonic()
                require(remaining>0, 'Required command deadline exceeded; private output suppressed')
                for key, _ in selector.select(min(remaining,0.25)):
                    raw = os.read(key.fileobj.fileno(),65536)
                    if not raw:
                        selector.unregister(key.fileobj)
                        continue
                    total += len(raw)
                    require(total<=1024*1024, 'Command output bound exceeded; private output suppressed')
                    if key.data: output.extend(raw)
        remaining = deadline-time.monotonic()
        require(remaining>0 and process.wait(timeout=remaining)==0,
                'Required command failed; private output suppressed')
        return output.decode().strip()
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise Refused('Required command failed; private output suppressed') from None
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill(); process.wait(timeout=5)
            process.stdout.close(); process.stderr.close()

def attest(directory, tag, source, gh='/usr/bin/gh', runner=command):
    import tempfile
    require(isinstance(tag,str) and re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)',tag), 'Exact release tag required')
    require(isinstance(source,str) and re.fullmatch('[0-9a-f]{40}',source), 'Exact reviewed source commit required')
    with tempfile.TemporaryDirectory(prefix='anonymous-gh-',dir=directory) as home:
        runner([gh,'attestation','verify',str(directory/'relay-release.json'),'--bundle',
                str(directory/'relay-release.attestation.json'),'--repo','murmuur22/relay',
                '--signer-workflow','murmuur22/relay/.github/workflows/release.yml',
                '--source-ref','refs/tags/'+tag,'--source-digest',source,'--signer-digest',source,
                '--deny-self-hosted-runners'],timeout=90,env=dict(ENV,HOME=home))

def syncdir(path):
    with pinned(path, owner=os.getuid()) as fd: os.fsync(fd)

def check_binding(path, fd, owner):
    # Directory timestamps/size/nlink change during our own writes. Binding and
    # security identity must not. Reacquire EVERY ancestor without following links.
    with pinned(path,owner) as current:
        a,b=os.fstat(fd),os.fstat(current)
        require((a.st_dev,a.st_ino,a.st_uid,a.st_gid,a.st_mode)==
                (b.st_dev,b.st_ino,b.st_uid,b.st_gid,b.st_mode),'Trusted directory binding changed')

def exists_at(fd,name):
    try: os.stat(name,dir_fd=fd,follow_symlinks=False); return True
    except FileNotFoundError: return False

def mkdir_private(path,owner):
    path=Path(path)
    with pinned(path.parent,owner) as fd:
        check_binding(path.parent,fd,owner)
        os.mkdir(path.name,0o700,dir_fd=fd); os.fsync(fd)
    with pinned(path,owner) as fd:
        require(stat.S_IMODE(os.fstat(fd).st_mode)==0o700,'Private directory required')

def write_json(path, value, parent_fd=None, owner=None):
    path=Path(path); owner=os.getuid() if owner is None else owner
    if parent_fd is None:
        with pinned(path.parent,owner) as fd:
            return write_json(path,value,fd,owner)
    temporary=path.name+'.next'; created=False
    try:
        check_binding(path.parent,parent_fd,owner)
        if exists_at(parent_fd,path.name):
            s=os.stat(path.name,dir_fd=parent_fd,follow_symlinks=False)
            require(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==owner,'Unsafe persistence target')
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent_fd)
        created=True
        with os.fdopen(fd,'wb') as f:
            f.write(canonical(value)); f.flush(); os.fsync(f.fileno())
        check_binding(path.parent,parent_fd,owner)
        os.replace(temporary,path.name,src_dir_fd=parent_fd,dst_dir_fd=parent_fd)
        created=False; os.fsync(parent_fd)
    finally:
        if created: os.unlink(temporary,dir_fd=parent_fd)

class TreeTransaction:
    """Offline two-rename publication; no service can execute between renames.
    Complete old code + metadata is retained, never deleted or merged.
    Only root-trusted fixed-tree callers may use the internal owner test seam.
    """
    def __init__(self, live, transaction, owner=0):
        self.live,self.root,self.owner=Path(live),Path(transaction),owner
        self._stack=contextlib.ExitStack()
        try:
            self.rfd=self._stack.enter_context(pinned(self.root,owner))
            self.lfd=self._stack.enter_context(pinned(self.live.parent,owner))
            require(stat.S_IMODE(os.fstat(self.rfd).st_mode)==0o700,'Transaction must be private')
            require(os.fstat(self.lfd).st_dev==os.fstat(self.rfd).st_dev,'Atomic same-filesystem transaction required')
        except Exception:
            self.close(); raise
    def close(self): self._stack.close()
    def __del__(self): self.close()
    def guard(self):
        check_binding(self.root,self.rfd,self.owner)
        check_binding(self.live.parent,self.lfd,self.owner)
    def inv(self,p):
        self.guard(); return inventory(p,owner=self.owner)
    def load(self,name):
        self.guard(); return decode(bounded_read(self.root/name,4*1024**2,self.owner))
    def phase(self,name):
        self.guard()
        previous=self.load('phase.json') if exists_at(self.rfd,'phase.json') else {}
        # Outcome/health labels must not erase the last two-rename checkpoint.
        # Keep it even in rolled-back: replace may succeed but directory fsync
        # may fail, so the caller cannot yet acknowledge durable completion.
        renames=('moving-old','publishing-new','removing-candidate','restoring-old')
        checkpoint=name if name in renames else previous.get('checkpoint')
        if name.startswith('rollback-') and checkpoint is None:
            checkpoint=previous.get('phase')
        value=dict(schema=1,phase=name)
        if checkpoint is not None and name!='activated':
            value['checkpoint']=checkpoint
        write_json(self.root/'phase.json',value,self.rfd,self.owner)
    def prepare(self,candidate):
        self.guard()
        old,new=self.inv(self.live),self.inv(candidate)
        require(not exists_at(self.rfd,'old.json') and not exists_at(self.rfd,'next'),'Existing transaction refused')
        deadline=time.monotonic()+30; total=0
        # Copy only the bounded inventoried entries, relative to held descriptors.
        # Neither source nor destination ancestors are followed by copytree/copy2.
        def copy(sfd,dfd,name):
            nonlocal total
            self.guard(); check_binding(candidate,source,self.owner)
            s=os.fstat(sfd); entry=new[name]
            if entry['kind']=='directory':
                prefix='' if name=='.' else name+'/'
                children=[p for p in new if p!='.' and p.startswith(prefix) and '/' not in p[len(prefix):]]
                for child in sorted(children):
                    base=child.rsplit('/',1)[-1]; directory=new[child]['kind']=='directory'
                    flags=os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|(os.O_DIRECTORY if directory else 0)
                    with contextlib.ExitStack() as stack:
                        before=os.stat(base,dir_fd=sfd,follow_symlinks=False)
                        sf=os.open(base,flags,dir_fd=sfd); stack.callback(os.close,sf)
                        require(identity(before)==identity(os.fstat(sf)),'Staging source changed')
                        self.guard(); check_binding(candidate,source,self.owner)
                        if directory:
                            os.mkdir(base,0o700,dir_fd=dfd)
                            df=os.open(base,os.O_RDONLY|os.O_NOFOLLOW|os.O_DIRECTORY,dir_fd=dfd)
                        else:
                            df=os.open(base,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=dfd)
                        stack.callback(os.close,df); copy(sf,df,child)
            else:
                require(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size==entry['size'],'Staging source differs')
                count=0
                while True:
                    raw=os.read(sfd,65536)
                    if not raw: break
                    count+=len(raw); total+=len(raw)
                    require(count<=s.st_size and total<=128*1024**2 and time.monotonic()<deadline,'Staging bound exceeded')
                    self.guard(); check_binding(candidate,source,self.owner)
                    view=memoryview(raw)
                    while view: view=view[os.write(dfd,view):]
                require(count==s.st_size,'Staging source shortened')
            require(identity(s)==identity(os.fstat(sfd)),'Staging source changed while copying')
            self.guard(); check_binding(candidate,source,self.owner)
            if os.geteuid()==0: os.fchown(dfd,entry['uid'],entry['gid'])
            os.fchmod(dfd,entry['mode'])
            if entry['kind']=='file': os.utime(dfd,ns=(s.st_atime_ns,s.st_mtime_ns))
            os.fsync(dfd)
        with pinned(candidate,self.owner) as source:
            self.guard(); check_binding(candidate,source,self.owner)
            os.mkdir('next',0o700,dir_fd=self.rfd)
            fd=os.open('next',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=self.rfd)
            try: copy(source,fd,'.')
            finally: os.close(fd)
        require(self.inv(self.root/'next')==new and self.inv(candidate)==new and self.inv(self.live)==old,'Tree changed before staging')
        write_json(self.root/'old.json',old,self.rfd,self.owner)
        write_json(self.root/'new.json',new,self.rfd,self.owner)
        self.phase('prepared')
    def rename(self,src,sfd,dst,dfd):
        self.guard()
        require(not exists_at(dfd,dst),'Rename destination already exists')
        os.rename(src,dst,src_dir_fd=sfd,dst_dir_fd=dfd)
        os.fsync(sfd); os.fsync(dfd)
    def switch(self, checkpoint=lambda _:None):
        require(self.inv(self.live)==self.load('old.json') and self.inv(self.root/'next')==self.load('new.json'),'Tree drift before publication')
        require(not exists_at(self.rfd,'old'),'Backup already exists')
        self.phase('moving-old'); checkpoint('moving-old')
        self.rename(self.live.name,self.lfd,'old',self.rfd)
        checkpoint('old-moved')
        self.phase('publishing-new')
        self.rename('next',self.rfd,self.live.name,self.lfd)
        checkpoint('new-published')
        require(self.inv(self.live)==self.load('new.json') and self.inv(self.root/'old')==self.load('old.json'),'Published byte/metadata readback failed')
        self.phase('published')
    def restore(self):
        self.guard(); old,new=self.load('old.json'),self.load('new.json')
        if not exists_at(self.rfd,'old'):
            require(exists_at(self.lfd,self.live.name) and self.inv(self.live)==old,'No exact old control backup')
            self.phase('restored'); return
        require(self.inv(self.root/'old')==old,'Old backup differs; refusing restore')
        if exists_at(self.lfd,self.live.name):
            require(self.inv(self.live)==new,'Local repair or unadmitted code; do not overwrite')
            require(not exists_at(self.rfd,'rejected'),'Rejected candidate already retained')
            self.phase('removing-candidate')
            self.rename(self.live.name,self.lfd,'rejected',self.rfd)
        self.phase('restoring-old')
        self.rename('old',self.rfd,self.live.name,self.lfd)
        require(self.inv(self.live)==old,'Restored tree readback failed')
        self.phase('restored')

def activate(transaction, host):
    """Maintenance is deliberately NOT released on any failed activation."""
    host.gate()
    try:
        host.stop()
        host.stopped_idle()
        host.preserved()
        transaction.switch()
        host.start()
        host.health('new')
        host.preserved()
        transaction.phase('healthy-maintenance-held')
        host.release('new')
        require(transaction.inv(transaction.live)==transaction.load('new.json'),'Final control readback differs')
        transaction.phase('activated')
    except Exception:
        try:
            host.gate()  # Final release may already have removed our hold.
            host.stop()
            host.stopped_idle()
            host.preserved()
            transaction.restore()
            host.start()
            host.health('old')
            host.preserved()
            transaction.phase('restored-healthy-maintenance-held')
        except Exception:
            # Readiness can fail after both services started; do not leave them
            # executing under an uncertain restore. Stop is best effort, never
            # represented as acknowledged success in this phase.
            try: host.gate(); host.stop()
            except Exception: pass
            transaction.phase('recovery-uncertain-maintenance-held')
            raise Refused('Recovery uncertain; maintenance held; inspect protected transaction') from None
        raise Refused('Activation failed; exact old control restored; maintenance held') from None


def signed_match(actual, signed):
    def normalized(value):
        return {name:{k:v for k,v in entry.items() if k not in ('mtimeNs','nlink') or entry['kind']=='file' and k=='nlink'}
                for name,entry in value.items()}
    # Extracted signed archives normalize to root:root, 0755 directories/0644 files.
    return normalized(actual)==normalized(signed)

def journal_summary(value):
    value=value if isinstance(value,dict) else {}
    job=value.get('job'); job=job if isinstance(job,dict) else {}
    phase=job.get('phase')
    known={'ready','downloading','verifying','staging','backing-up','activating','restarting','health-checking','succeeded','failed','rolled-back','rollback-failed','cancelled','interrupted'}
    version=value.get('currentVersion')
    return dict(currentVersion=version if isinstance(version,str) and re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+',version) else None,
                phase=phase if isinstance(phase,str) and phase in known else ('none' if not job else 'unknown'),
                checkpointHold=value.get('checkpoint') is not None, preparedHold='prepared' in value)

if __name__ == '__main__':
    # One module identity for CLI and coordinator exceptions.
    sys.path.insert(0, str(HERE.parents[1]))
    sys.modules['deploy.migration_069.control_plane_upgrade_069'] = sys.modules[__name__]
    try:
        from deploy.migration_069.coordinator_069 import main
        raise SystemExit(main())
    except Refused as error:
        print('REFUSED: '+str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print('REFUSED: bounded operation failed; private details suppressed. If activation began, retain maintenance and protected transaction.', file=sys.stderr)
        raise SystemExit(1)
