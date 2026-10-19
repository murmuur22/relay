"""Release-only policy builder. This module cannot sign or publish anything.
A local pack/producer result is not authority. build requires an exact clean Linux
checkout and official attested acceptance; no --fixture/--qualified switch exists.
"""
import argparse, io, json, os, platform, subprocess, sys, tarfile
from pathlib import Path
from . import control_plane_upgrade_069 as c, policy

def produce_acceptance(directory, source, inventory):
    """Schema producer for future official CI. Output must be officially attested."""
    policy.commit(source); directory=Path(directory); receipts={}
    for mode in ('loopback','private-lan'):
        name='migration-'+mode+'.json'; raw=policy.read(directory/name)
        r=policy.validate_receipt(c.decode(raw),mode,inventory,source)
        receipts[mode]=dict(artifact=dict(name=name,size=len(raw),sha256=c.sha(raw)),producer=r['producer'])
    c.require(receipts['loopback']['producer']['artifactId']!=receipts['private-lan']['producer']['artifactId'],'Receipt artifacts must be distinct')
    return dict(schema=1,kind='relay-migration-acceptance',target=dict(version=c.TARGET,sourceCommit=source),
                baseline=policy.BASELINE,closure=inventory,receipts=receipts)

def verify_old(directory):
    """Actual old provenance, not an operator-supplied complete inventory."""
    directory=Path(directory); b=policy.BASELINE; raw=policy.read(directory/'relay-release.json')
    c.require(c.sha(raw)==b['manifestSha256'],'Supported old manifest differs')
    c.attest(directory,b['version'],b['sourceCommit'])
    c.require(policy.read(directory/'relay-release.json')==raw,'Old manifest changed during verification')
    from updater.broker.releases import manifest_valid
    m=manifest_valid(c.decode(raw),b['version'])
    c.require(m['updaterArtifact']==b['archive'],'Supported old archive descriptor differs')
    archive=policy.read(directory/b['archive']['name'],128*1024**2)
    c.require(len(archive)==b['archive']['size'] and c.sha(archive)==b['archive']['sha256'],'Supported official old archive differs')

def pack(source, output, generated):
    """Pure packaging primitive; even well-formed output has NO attestation."""
    source,output=Path(source),Path(output)
    snapshot={n:policy.read(source/n) for n in policy.FILES}
    snapshot['migration-policy.json']=c.canonical(generated)
    # Create once; never silently replace an earlier candidate.
    fd=os.open(output/policy.ARTIFACT,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream, tarfile.open(fileobj=stream,mode='w:gz') as archive:
        for name,raw in sorted(snapshot.items()):
            entry=tarfile.TarInfo(name); entry.mode=0o644; entry.size=len(raw)
            archive.addfile(entry,io.BytesIO(raw))
    raw=policy.read(output/policy.ARTIFACT,128*1024**2)
    artifact=dict(name=policy.ARTIFACT,size=len(raw),sha256=c.sha(raw))
    c.require(policy.archive_files(output/policy.ARTIFACT,artifact)==snapshot,'Packaged distribution readback differs')
    c.require(all(policy.read(source/n)==raw for n,raw in snapshot.items() if n!='migration-policy.json'),'Source changed while packaging')
    return artifact

def build(source, acceptance_dir, source_commit, output, old_release_dir=None):
    source,output=Path(source).resolve(),Path(output).absolute()
    c.require(platform.system()=='Linux' and platform.machine() in ('x86_64','AMD64'),'Release-only Linux x64 builder required')
    policy.commit(source_commit)
    c.require(source==policy.ROOT,'Builder must run from its exact reviewed checkout')
    c.require(subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=source,env=c.ENV).decode().strip()==source_commit,
              'Build source commit differs')
    c.require(not subprocess.check_output(['/usr/bin/git','status','--porcelain','--untracked-files=all'],cwd=source,env=c.ENV),
              'Clean exact source checkout required')
    c.require(c.decode(policy.read(source/'package.json'))['version']=='0.6.9','Target runtime source version differs')
    c.require(old_release_dir is not None,'Genuine official old release inputs required')
    inventory=policy.closure(source)
    verify_old(old_release_dir)
    generated=policy.acceptance(acceptance_dir,source_commit,inventory)
    c.require(policy.closure(source)==inventory,'Source closure changed during qualification')
    c.require(output!=source and source not in output.parents,'Output must be outside source')
    with c.pinned(output.parent,os.geteuid()) as fd:
        c.check_binding(output.parent,fd,os.geteuid()); os.mkdir(output.name,0o700,dir_fd=fd); os.fsync(fd)
    try:
        artifact=pack(source,output,generated)
        # These are build outputs only; official release workflow must bind descriptor
        # into relay-release.json and attest that manifest AFTER packaging.
        c.write_json(output/'migration-artifact.json',artifact)
        return artifact
    except Exception:
        # Retain failed output for inspection. Never label it qualified.
        raise

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='command',required=True)
    for name in ('inventory','produce-acceptance','build'):
        q=sub.add_parser(name)
        if name!='inventory':
            q.add_argument('--receipts-dir',required=True); q.add_argument('--source-commit',required=True)
        if name=='build': q.add_argument('--old-release-dir',required=True); q.add_argument('--output',required=True)
    a=p.parse_args(argv)
    if a.command=='inventory': value=policy.closure()
    elif a.command=='produce-acceptance': value=produce_acceptance(a.receipts_dir,a.source_commit,policy.closure())
    else: value=build(policy.ROOT,a.receipts_dir,a.source_commit,a.output,a.old_release_dir)
    print(json.dumps(value,sort_keys=True)); return 0

if __name__=='__main__':
    try: sys.exit(main())
    except (c.Refused,OSError,ValueError,KeyError,subprocess.SubprocessError):
        print('REFUSED: unqualified build inputs or official provenance missing; no release authority conferred.',file=sys.stderr); sys.exit(1)
