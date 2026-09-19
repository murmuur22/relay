import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import tempfile
import time
import unittest

from updater.broker.auth import Authority, Denied


def signed(key, action, payload):
    timestamp, nonce = int(time.time()), secrets.token_hex(16)
    body = base64.b64encode(json.dumps(payload).encode()).decode()
    mac = hmac.new(key, f'{timestamp}\n{nonce}\n{action}\n{body}'.encode(), hashlib.sha256).hexdigest()
    return dict(action=action, timestamp=timestamp, nonce=nonce, payload=body, mac=mac)


class AuthorityTests(unittest.TestCase):
    def test_durable_single_use_user_bound_capabilities(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, key = Path(tmp) / 'auth.json', secrets.token_bytes(32)
            auth = Authority(path, key, 'http://localhost:4190')
            envelope = signed(key, 'issue-ui', dict(userId='admin', interfaceAnimations=False, relayVersion='0.3.0'))
            ticket = auth.issue(envelope)['ticket']
            with self.assertRaises(Denied):
                auth.issue(envelope)
            with self.assertRaises(Denied):
                auth.redeem(ticket, 'http://evil.invalid')
            result = auth.redeem(ticket, 'http://localhost:4190')
            self.assertFalse(result['interfaceAnimations'])
            auth = Authority(path, key, 'http://localhost:4190')
            with self.assertRaises(Denied):
                auth.redeem(ticket, 'http://localhost:4190')
            self.assertEqual(auth.read(result['token'])['userId'], 'admin')
            action = auth.issue(signed(key, 'issue-action', dict(userId='other', action='install', version='v1.0.0')))['authorization']
            with self.assertRaises(Denied):
                auth.consume(result['token'], action, 'install', version='v1.0.0')
            action = auth.issue(signed(key, 'issue-action', dict(userId='admin', action='install', version='v1.0.0')))['authorization']
            auth.consume(result['token'], action, 'install', version='v1.0.0')
            with self.assertRaises(Denied):
                auth.consume(result['token'], action, 'install', version='v1.0.0')
            persisted = path.read_text()
            for secret in (ticket, result['token'], action):
                self.assertNotIn(secret, persisted)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
