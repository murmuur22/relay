"""Official read-only receipt producer. No signing, publication or policy enablement.

producer.artifactId identifies the immutable RAW execution artifact. Receipts
cannot contain their own future upload ID. A later official acceptance attestation
binds receipt bytes AND those raw-artifact/run/job IDs without a circular hash.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile
from . import policy, qualify as q, build
from . import control_plane_upgrade_069 as c

MODES=('loopback','private-lan')

def validate_remote(run,jobs,artifacts,source,run_id,attempt):
 policy.commit(source)
 c.require(run.get('id')==run_id and run.get('head_sha')==source and run.get('event')=='workflow_dispatch' and
  run.get('path')=='.github/workflows/release.yml' and run.get('head_branch')==policy.PREPARATION_REF.removeprefix('refs/heads/') and run.get('run_attempt')==attempt,
  'Official exact preparation source/ref/run/attempt differs')
 selected={}
 for mode in MODES:
  js=[j for j in jobs if j.get('name')=='migration-systemd-'+mode]
  aa=[a for a in artifacts if a.get('name')=='migration-execution-'+mode+'-attempt-'+str(attempt)]
  c.require(len(js)==len(aa)==1,'Missing/duplicate matrix job or immutable execution artifact')
  j,a=js[0],aa[0]
  c.require(j.get('head_sha')==source and j.get('run_id')==run_id and j.get('run_attempt')==attempt and
   j.get('status')=='completed' and j.get('conclusion')=='success' and type(j.get('id')) is int and j['id']>0,'Matrix job missing/failed/wrong-source')
  c.require(a.get('expired') is False and type(a.get('id')) is int and a['id']>0 and
   a.get('workflow_run',{}).get('id')==run_id and a['workflow_run'].get('head_sha')==source and
   isinstance(a.get('digest'),str) and a['digest'].startswith('sha256:') and c.HEX.fullmatch(a['digest'][7:]),
   'Execution artifact identity/digest differs')
  selected[mode]=(j,a)
 c.require(selected['loopback'][1]['id']!=selected['private-lan'][1]['id'],'Mode artifacts must be distinct')
 return selected

def api(path):
 c.require(path.startswith('repos/murmuur22/relay/actions/'),'Fixed official API only')
 raw=subprocess.check_output(['/usr/bin/gh','api','--method','GET',path],timeout=60)
 c.require(len(raw)<=16*1024**2,'API response bound');return c.decode(raw)

def pages(path,key):
 values=[];expected=None
 for page in range(1,101):
  data=api(path+('&' if '?' in path else '?')+'per_page=100&page='+str(page))
  c.require(type(data.get('total_count')) is int and type(data.get(key)) is list,'Incomplete GitHub page')
  if expected is None:expected=data['total_count']
  c.require(expected==data['total_count'],'GitHub enumeration changed')
  values.extend(data[key]);c.require(len(values)<=expected,'Declared GitHub count differs')
  if len(values)==expected:return values
  c.require(bool(data[key]),'GitHub enumeration truncated')
 raise c.Refused('GitHub pagination bound exceeded')

def read_artifact(artifact,mode):
 c.require(type(artifact.get('size_in_bytes')) is int and 0<artifact['size_in_bytes']<=8*1024**2,'Artifact download bound')
 raw=subprocess.check_output(['/usr/bin/gh','api','--method','GET',
  'repos/murmuur22/relay/actions/artifacts/'+str(artifact['id'])+'/zip'],timeout=90)
 c.require(len(raw)<=8*1024**2 and hashlib.sha256(raw).hexdigest()==artifact['digest'][7:],'Raw execution artifact digest differs')
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  name='execution-'+mode+'.json';items=z.infolist()
  c.require(len(items)==1 and items[0].filename==name and items[0].file_size<=4*1024**2 and not items[0].flag_bits&1,'Unexpected execution artifact entries')
  return c.decode(z.read(name))

def produce(source,output):
 policy.commit(source)
 c.require(os.environ.get('GITHUB_REPOSITORY')=='murmuur22/relay' and os.environ.get('GITHUB_ACTIONS')=='true' and
  os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted' and os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch' and
  os.environ.get('GITHUB_SHA')==source and os.environ.get('GITHUB_REF')==policy.PREPARATION_REF and
  os.environ.get('GITHUB_WORKFLOW_REF')==policy.WORKFLOW+'@'+policy.PREPARATION_REF,'Official exact preparation-ref producer required')
 run_id=int(os.environ['GITHUB_RUN_ID']);attempt=int(os.environ['GITHUB_RUN_ATTEMPT'])
 inventory=q.git_inventory(policy.ROOT,source);closure=policy.closure()
 run=api('repos/murmuur22/relay/actions/runs/'+str(run_id))
 jobs=pages('repos/murmuur22/relay/actions/runs/'+str(run_id)+'/attempts/'+str(attempt)+'/jobs','jobs')
 artifacts=pages('repos/murmuur22/relay/actions/runs/'+str(run_id)+'/artifacts','artifacts')
 selected=validate_remote(run,jobs,artifacts,source,run_id,attempt)
 output=Path(output);c.require(not output.exists() and output.parent.is_dir(),'Fresh private output directory required');output.mkdir(mode=0o700)
 for mode,(job,artifact) in selected.items():
  report=read_artifact(artifact,mode)
  receipt=q.produce_receipt(report,mode=mode,source=source,inventory=closure,source_inventory=inventory,
   producer=dict(workflow=policy.WORKFLOW,sourceRef=policy.PREPARATION_REF,sourceCommit=source,runId=run_id,jobId=job['id'],artifactId=artifact['id']))
  c.write_json(output/('migration-'+mode+'.json'),receipt)
 q.check_inventory(policy.ROOT,inventory)
 # Still untrusted JSON. A future separately reviewed acceptance-attestation job
 # and the final tagged artifact are mandatory before build/production admission.
 c.write_json(output/'migration-acceptance.json',build.produce_acceptance(output,source,closure))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-commit',required=True);p.add_argument('--output',required=True)
 try:
  a=p.parse_args();produce(a.source_commit,a.output)
 except Exception:
  print('REFUSED: official raw execution/source/cleanup/remote identities incomplete. No acceptance authority created.',file=sys.stderr);sys.exit(1)
