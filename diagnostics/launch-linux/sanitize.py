"""Explicit file allowlist, capability aliases and raw-evidence hashes; never runtime/source.
Synthetic IDs are retained unless they grant authentication or launch authority.
"""
from pathlib import Path
import os,json,re,hashlib,sys
T=Path(os.environ['RUNNER_TEMP']); P=T/'relay-launch-private'; O=T/'relay-launch-public'
aliases={}
def alias(s):
 if s not in aliases:aliases[s]='opaque-'+str(len(aliases)+1)
 return aliases[s]
def text(s):
 s=s.replace(str(T),'$RUNNER_TEMP').replace(os.environ.get('GITHUB_WORKSPACE','/__not_present__'),'$GITHUB_WORKSPACE')
 s=re.sub(r'(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)',lambda m:alias(m[0]),s)
 s=re.sub(r'(?i)(?:Bearer\s+|relay_session=)[^\s;"\x27]+',lambda m:alias(m[0]),s)
 s=re.sub(r'\b[A-Za-z0-9_-]{32,}\b',lambda m:alias(m[0]),s)
 s=re.sub(r'(?i)((?:password|csrf|ticket|authorization|capability|secret|token)["\x27]?\s*[:=]\s*["\x27]?)[^\s,"\x27}]+',lambda m:m[1]+alias(m[0]),s)
 s=re.sub(r'(https?://[^\s"\x27<>]+)[#?][^\s"\x27<>]+',lambda m:m[1].split('?')[0].split('#')[0]+'#'+alias(m[0]),s)
 return s
sensitive=re.compile(r'cookie|password|csrf|ticket|authorization|capability|secret|token|nonce|personalLaunchId|sessionId',re.I)
def clean(v,key=''):
 if sensitive.search(key) and v is not None:return alias(json.dumps(v,sort_keys=True))
 if isinstance(v,dict):return {k:clean(x,k) for k,x in v.items()}
 if isinstance(v,list):return [clean(x,key) for x in v]
 if isinstance(v,str):return text(v)
 return v
def clean_log(raw):
 lines=[]
 for line in raw.splitlines():
  for prefix in ['BOUNDARY-TRACE ','DIAG-TIMEOUT ','DIAG-SETTLED ']:
   if line.startswith(prefix):
    try:line=prefix+json.dumps(clean(json.loads(line[len(prefix):])),separators=(',',':'))
    except json.JSONDecodeError:line=text(line)
    break
  else:line=text(line)
  lines.append(line)
 return '\n'.join(lines)+'\n'
def main():
 assert not O.exists(),'public output must be new'
 O.mkdir(mode=0o700)
 names=['npm-ci.log','build.log','pillow.log','chromium.log','input-check.log','namespaces.log','runner.log','prelaunch.json','supervisor.json','cleanup.json']
 files=[P/n for n in names if (P/n).is_file()]
 E=P/'experiment'
 files += [E/'EXPERIMENT.json'] if (E/'EXPERIMENT.json').is_file() else []
 for name in ['01-original','02-fixed','03-launch-fixed','04-aba-fixed']:
  f=E/(name+'.log')
  if f.is_file():files.append(f)
 records=[]
 for f in files:
  assert not f.is_symlink()
  raw=f.read_bytes();s=raw.decode('utf8',errors='replace')
  out=json.dumps(clean(json.loads(s)),indent=2)+'\n' if f.suffix=='.json' else clean_log(s)
  assert not re.search(r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|relay_session=[A-Za-z0-9_-]{20,}|-----BEGIN .*PRIVATE KEY',out)
  assert '/Users/' not in out
  (O/f.name).write_text(out)
  records.append({'name':f.name,'rawSHA256':hashlib.sha256(raw).hexdigest(),'sanitizedSHA256':hashlib.sha256(out.encode()).hexdigest(),'bytes':len(out.encode())})
  if f.name in ['01-original.log','02-fixed.log']:
   traces=[json.loads(x[len('BOUNDARY-TRACE '):]) for x in out.splitlines() if x.startswith('BOUNDARY-TRACE ')]
   (O/(f.stem+'.trace.json')).write_text(json.dumps(traces,indent=2)+'\n')
 (O/'INPUTS.json').write_bytes((Path(__file__).parent/'INPUTS.json').read_bytes())
 info: dict={k:os.environ.get(k) for k in ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA','GITHUB_REF','GITHUB_EVENT_NAME','GITHUB_REPOSITORY','RUNNER_KIND','RUNNER_OS','RUNNER_ARCH','ImageOS','ImageVersion']}
 info.update(sourceSHA='abe681a2837fa4b9b5236ea34970019c0b8934d1',sandbox=True,contentsPermission='read',kitUnmodified=False,mode='interception-lifetime',patchSHA256=hashlib.sha256((Path(__file__).parent/'interception-lifetime.patch').read_bytes()).hexdigest(),supervisionDelta='durable prelaunch journal; systemd owned control-group; 360s runtime / 10s cleanup; independent always cleanup',thirdPartyRouteReview=False)
 (O/'runner-info.json').write_text(json.dumps(info,indent=2)+'\n')
 (O/'payload-inspection.json').write_text(json.dumps({'allowlistInspected':True,'rawPrivateEvidenceUploaded':False,'opaqueAliases':len(aliases),'files':records},indent=2)+'\n')
 print('Inspected sanitized payload: '+str(len(list(O.iterdir())))+' allowlisted files; no runtime or checkout archive.')
if __name__=='__main__':main()
