#!/usr/bin/env python3
"""Copy only pinned tracked application files, never any collection or upstream venv."""
import subprocess, pathlib, shutil, json, hashlib
root=pathlib.Path(__file__).resolve().parents[1]
upstream=root.parent
pins={'keepsakes':'a496aa84252bf61082b5e001a1f88be965200edc','parcels':'0d1f87a63bd9bd63b7b15fd3c94b8c80b76060c3'}
manifest={}
for app,pin in pins.items():
 source=upstream/app; target=root/'integrations'/app
 files=subprocess.check_output(['git','-C',str(source),'ls-tree','-r','--name-only',pin],text=True).splitlines()
 for name in files:
  allowed=(name in ('app.py','pyproject.toml','uv.lock') or name.startswith('static/')) if app=='keepsakes' else (name in ('index.html','package.json','package-lock.json') or name.startswith(('src/','public/')))
  if not allowed:continue
  data=subprocess.check_output(['git','-C',str(source),'show',f'{pin}:{name}']); p=target/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 if app=='keepsakes':
  p=target/'static/index.html';text=p.read_text().replace('"/static/','"/native/keepsakes/static/').replace('href="/"','href="/native/keepsakes/"');p.write_text(text)
  p=target/'static/app.js';p.write_text(p.read_text().replace('/api/','/native/keepsakes/api/'))
 else:
  subprocess.run(['npm','ci','--ignore-scripts'],cwd=target,check=True)
  subprocess.run(['npm','run','build'],cwd=target,check=True)
 manifest[app]={'commit':pin,'origin':str(pathlib.Path('..')/app),'source':'pinned tracked files','dist':'rebuilt from the copied pinned source' if app=='parcels' else None}
(root/'integrations'/'provenance.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Pinned tracked sources copied; no libraries or credentials copied.')
