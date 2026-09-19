import subprocess,tempfile,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='relay-diagnostic-') as d:
 p=subprocess.run([str(root/'integrations/keepsakes/.venv/bin/python'),str(root/'integrations/keepsakes/app.py'),'--data-dir',d,'--port','4189'],capture_output=True,text=True,timeout=8)
 print(p.stderr)
