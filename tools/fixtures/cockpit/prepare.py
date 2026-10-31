#!/usr/bin/env python3
"""Prepare credentials only for an explicitly local, isolated Cockpit test container."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', required=True, type=Path)
args = parser.parse_args()
root = args.output_dir.resolve()
root.mkdir(mode=0o700, parents=True, exist_ok=True)
state_path = root / 'cockpit-private.json'
if state_path.exists():
    raise SystemExit('Private fixture state exists; reuse it explicitly instead of overwriting.')
cmd = ['docker', '--context', 'desktop-linux']
endpoint = subprocess.check_output(cmd + ['context', 'inspect', 'desktop-linux', '--format', '{{.Endpoints.docker.Host}}'], text=True).strip()
if not endpoint.startswith('unix:///'):
    raise SystemExit('An explicitly reviewed local Unix-socket Docker context is required.')
inspection = json.loads(subprocess.check_output(cmd + ['inspect', 'relay-mgmt2-cockpit'], text=True))[0]
if inspection['Config'].get('Labels', {}).get('io.relay.fixture') != 'management-cockpit-m2':
    raise SystemExit('Refusing a container without the expected disposable-fixture label.')
if inspection['HostConfig']['Privileged'] or inspection['Mounts'] or inspection['HostConfig']['NetworkMode'] != 'bridge' or inspection['HostConfig']['CapAdd']:
    raise SystemExit('Refusing a fixture with privileges, mounts, extra capabilities or a non-bridge network.')
port = subprocess.check_output(cmd + ['port', 'relay-mgmt2-cockpit', '9090'], text=True).strip()
if not port.startswith('127.0.0.1:') or '\n' in port:
    raise SystemExit('Fixture port must be published exclusively on host loopback.')
# Require the known unprivileged synthetic user; do not create or reset a host account.
subprocess.run(cmd + ['exec', 'relay-mgmt2-cockpit', 'id', 'learner'], check=True, capture_output=True)
password = secrets.token_hex(24)
state = {'upstream': 'https://' + port, 'serverName': 'cockpit.fixture.test', 'caPath': str(root / 'cockpit-ca.pem'), 'username': 'learner', 'password': password}
# Exclusive creation prevents overwriting an existing credential file.
with os.fdopen(os.open(state_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
    json.dump(state, stream)
subprocess.run(cmd + ['exec', '-i', 'relay-mgmt2-cockpit', 'chpasswd'], input='learner:' + password + '\n', text=True, check=True, capture_output=True)
subprocess.run(cmd + ['cp', 'relay-mgmt2-cockpit:/etc/cockpit/ws-certs.d/fixture.cert', str(root / 'cockpit-ca.pem')], check=True, capture_output=True)
version = subprocess.check_output(cmd + ['exec', 'relay-mgmt2-cockpit', 'dpkg-query', '-W', '-f=${Package} ${Version}\n', 'cockpit-ws', 'cockpit-bridge', 'cockpit-system'], text=True)
public = {'upstream': state['upstream'], 'packages': version.splitlines(), 'imageId': inspection['Image'], 'privileged': False, 'mounts': [], 'networkMode': 'bridge', 'capAdd': None}
(root / 'cockpit-fixture.json').write_text(json.dumps(public, indent=2))
print(json.dumps(public, indent=2))
