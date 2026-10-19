"""Option A schema and anonymous official-provenance boundary.
Parsing is never authority. No source checkout contains a generated policy.
"""
import hashlib, os, re, stat, sys, tarfile, tempfile
from pathlib import Path, PurePosixPath
from . import control_plane_upgrade_069 as c
Refused = c.Refused
WORKFLOW = 'murmuur22/relay/.github/workflows/release.yml'
PREPARATION_REF = 'refs/heads/feat/relay-069-staged-foundation'
ARTIFACT = 'relay-migration-linux-x64.tar.gz'
ROOT = Path(__file__).resolve().parents[2]
BASELINE = dict(version='v0.6.4',sourceCommit='0bf423eae6709b28fd5ace2a4b97e74924626fc8',sourceRef='refs/tags/v0.6.4',
    manifestSha256='83f63eac3b456b6569b626f1bf9683569d5aadce09e2289b2c8cb42c0ae9722b',
    archive=dict(name='relay-updater-linux-x64.tar.gz',size=193483,sha256='1cb69f20b7f4091a4e29c4eade6763606172ef254545c11fde5c24cedd83f687'))
CHECKS = ('stock-old-provenance','ordinary-old-ui-runtime-upgrade','archived-old-ui-recovery','inspect-no-write','apply','rollback',
    'activation-failure-restore','final-release-failure-restore','rollback-uncertainty-retry','drift-refusal','protected-state-preserved','service-identities')
FILES = tuple('deploy/migration_069/'+n for n in ('__init__.py','__main__.py','control_plane_upgrade_069.py','coordinator_069.py',
    'archive_069.py','policy.py','build.py','supported-baseline.json')) + ('updater/broker/auth.py','updater/broker/releases.py')

def exact(value, keys, message):
    c.require(type(value) is dict and set(value)==set(keys),message)

def commit(value):
    c.require(type(value) is str and re.fullmatch('[0-9a-f]{40}',value),'Exact source commit required')

def descriptor(value, name):
    exact(value,('name','sha256','size'),'Artifact descriptor schema differs')
    c.require(value['name']==name and type(value['sha256']) is str and c.HEX.fullmatch(value['sha256']) and
        type(value['size']) is int and 0<value['size']<=128*1024**2,'Invalid artifact descriptor')

def read(path, limit=16*1024**2):
    return c.bounded_read(Path(path),limit,os.geteuid())

def closure(root=ROOT):
    return {n:dict(size=len(raw),sha256=c.sha(raw)) for n in FILES for raw in (read(Path(root)/n),)}

def validate_receipt(r, mode, inventory, source):
    commit(source)
    c.require(mode in ('loopback','private-lan'),'Unsupported mode')
    exact(r,('schema','kind','tier','mode','producer','target','baseline','closure','exit','success','counts','checks','cleanup'),'Incomplete receipt schema')
    c.require(type(r['schema']) is int and r['schema']==1 and r['kind']=='relay-migration-systemd-receipt' and
        r['tier']=='real-linux-systemd' and r['mode']==mode,'Wrong receipt kind/tier/mode')
    c.require(r['target']==dict(version=c.TARGET,sourceCommit=source) and r['baseline']==BASELINE and r['closure']==inventory,
        'Receipt source/baseline/tool closure differs')
    p=r['producer']; exact(p,('workflow','sourceRef','sourceCommit','runId','jobId','artifactId'),'Receipt producer schema differs')
    c.require(p['workflow']==WORKFLOW and p['sourceRef']==PREPARATION_REF and p['sourceCommit']==source and
        all(type(p[k]) is int and p[k]>0 for k in ('runId','jobId','artifactId')),'Unexpected official CI producer identity')
    counts=r['counts']; exact(counts,('tests','passed','failed','errors','skipped'),'Missing receipt counts')
    c.require(all(type(v) is int for v in counts.values()) and counts['tests']==counts['passed']>0 and
        all(counts[k]==0 for k in ('failed','errors','skipped')) and type(r['exit']) is int and r['exit']==0 and
        r['success'] is True and r['cleanup'] is True,'Missing/skipped/nonzero/unclean Linux receipt')
    exact(r['checks'],CHECKS,'Missing required Linux scenario')
    c.require(all(v is True for v in r['checks'].values()),'Linux scenario not passed')
    return r

def verify_official(directory, subject, bundle, source, ref):
    """No caller verifier, fixture flag, environment admission or alternate publisher."""
    commit(source)
    c.require(ref in (PREPARATION_REF,'refs/tags/'+c.TARGET),'Unsupported official source ref')
    directory=Path(directory)
    with tempfile.TemporaryDirectory(prefix='anonymous-migration-',dir=directory) as home:
        c.command(['/usr/bin/gh','attestation','verify',str(directory/subject),'--bundle',str(directory/bundle),
            '--repo','murmuur22/relay','--signer-workflow',WORKFLOW,'--source-ref',ref,
            '--source-digest',source,'--signer-digest',source,'--deny-self-hosted-runners'],timeout=90,env=dict(c.ENV,HOME=home))

def acceptance(directory, source, inventory):
    """Official attestation authenticates raw receipt pins, not mutable labels."""
    directory=Path(directory)
    raw=read(directory/'migration-acceptance.json')
    # Verify before trusting any parsed input as qualification.
    verify_official(directory,'migration-acceptance.json','migration-acceptance.attestation.json',source,PREPARATION_REF)
    c.require(read(directory/'migration-acceptance.json')==raw,'Acceptance changed during provenance verification')
    a=c.decode(raw)
    exact(a,('schema','kind','target','baseline','closure','receipts'),'Acceptance schema differs')
    c.require(type(a['schema']) is int and a['schema']==1 and a['kind']=='relay-migration-acceptance' and
        a['target']==dict(version=c.TARGET,sourceCommit=source) and a['baseline']==BASELINE and a['closure']==inventory,
        'Acceptance source/baseline/tool closure differs')
    exact(a['receipts'],('loopback','private-lan'),'Both Linux receipt artifacts required')
    receipts={}
    for mode in ('loopback','private-lan'):
        pin=a['receipts'][mode]
        exact(pin,('artifact','producer'),'Receipt read pins missing')
        name='migration-'+mode+'.json'; descriptor(pin['artifact'],name)
        raw_receipt=read(directory/name)
        c.require(len(raw_receipt)==pin['artifact']['size'] and c.sha(raw_receipt)==pin['artifact']['sha256'],'Receipt read pins differ')
        r=validate_receipt(c.decode(raw_receipt),mode,inventory,source)
        c.require(r['producer']==pin['producer'],'Receipt identity differs from attested pin')
        receipts[mode]=pin
    c.require(receipts['loopback']['producer']['artifactId']!=receipts['private-lan']['producer']['artifactId'], 'Receipt artifacts must be distinct')
    return dict(schema=1,kind='relay-migration-policy',target=a['target'],baseline=BASELINE,closure=inventory,
                acceptanceSha256=c.sha(raw),receipts=receipts)

def archive_files(path, expected):
    """Bounded no-link manifest of final distribution, never execute tar content."""
    raw=read(path,128*1024**2); descriptor(expected,ARTIFACT)
    c.require(len(raw)==expected['size'] and c.sha(raw)==expected['sha256'],'Final distribution digest differs')
    import io
    entries={}; total=0
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
        for m in archive:
            parts=PurePosixPath(m.name).parts
            c.require(m.isfile() and m.mode==0o644 and parts and not m.name.startswith('/') and
                all(p not in ('','.','..') for p in m.name.split('/')) and '\\' not in m.name and
                m.name in (*FILES,'migration-policy.json') and m.name not in entries and len(entries)<len(FILES)+1 and
                0<=m.size<=16*1024**2,'Unsafe distribution entry')
            total+=m.size; c.require(total<=32*1024**2,'Distribution expanded bound exceeded')
            stream=archive.extractfile(m)
            if stream is None: raise Refused('Missing archive entry stream')
            with stream: data=stream.read(m.size+1)
            c.require(len(data)==m.size,'Distribution entry shortened')
            entries[m.name]=data
    c.require(set(entries)==set(FILES)|{'migration-policy.json'},'Incomplete final distribution')
    return entries

def qualified(root=ROOT):
    """Fixed bootstrap. Missing generated policy always refuses before gh/systemd."""
    root=Path(root)
    c.require(sys.platform=='linux' and os.geteuid()==0,'Production apply/rollback DISABLED: qualified Linux root distribution required')
    c.require((root/'migration-policy.json').is_file(),'Production apply/rollback DISABLED: no release-qualified policy')
    raw=read(root/'migration-policy.json'); p=c.decode(raw)
    exact(p,('schema','kind','target','baseline','closure','acceptanceSha256','receipts'),'Untrusted generated policy schema')
    c.require(type(p['schema']) is int and p['schema']==1 and p['kind']=='relay-migration-policy' and p['baseline']==BASELINE and
        p['target']['version']==c.TARGET and p['closure']==closure(root),'Generated policy closure differs')
    source=p['target']['sourceCommit']; commit(source)
    manifest_raw=read(root/'relay-release.json')
    verify_official(root,'relay-release.json','relay-release.attestation.json',source,'refs/tags/'+c.TARGET)
    c.require(read(root/'relay-release.json')==manifest_raw,'Official manifest changed during verification')
    from updater.broker.releases import manifest_valid
    manifest=manifest_valid(c.decode(manifest_raw),c.TARGET)
    entries=archive_files(root/ARTIFACT,manifest.get('migrationArtifact'))
    c.require(all(read(root/n)==v for n,v in entries.items()),'Extracted distribution differs from official archive')
    p['runtimeArtifact']=manifest['artifact']
    p['manifestSha256']=c.sha(manifest_raw)
    return p

def stock_control(snapshot):
    """Comparison only, not production admission or provenance verification."""
    b=c.decode(read(ROOT/'deploy/migration_069/supported-baseline.json'))
    c.require({k:b[k] for k in BASELINE}==BASELINE,'Fixed baseline metadata differs')
    c.require(c.signed_match(snapshot['control'],b['inventory']),'Unknown/modified control plane; inspect-only')
    for unit,expected in b['units'].items():
        actual=snapshot['units'][unit]
        c.require(all(actual[k]==expected[k] for k in ('uid','gid','mode','nlink','size','sha256')),'Unknown/modified unit; inspect-only')
    return b
