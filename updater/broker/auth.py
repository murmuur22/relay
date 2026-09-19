"""Durable, bounded, one-use issuance. This module never logs credentials."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time

VERSION = re.compile(r'v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z')


class Denied(ValueError):
    pass


def fsync_dir(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + '.' + secrets.token_hex(8))
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, separators=(',', ':'), allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        fsync_dir(path.parent)
    finally:
        tmp.unlink(missing_ok=True)


def digest(value):
    if not isinstance(value, str) or not 16 <= len(value) <= 256:
        raise Denied('Invalid capability')
    return hashlib.sha256(value.encode()).hexdigest()


class Authority:
    def __init__(self, path, key, origin):
        self.path, self.key, self.origin = Path(path), key, origin
        if len(key) < 32:
            raise Denied('Bridge key must contain at least 32 bytes')
        self.lock = threading.RLock()
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {'nonces': {}, 'caps': {}}

    def save(self):
        now = time.time()
        self.data['nonces'] = {k: v for k, v in self.data['nonces'].items() if v > now}
        self.data['caps'] = {k: v for k, v in self.data['caps'].items() if v['expiresAt'] > now}
        atomic_json(self.path, self.data)

    def mint(self, kind, payload, lifetime):
        self.save()
        if len(self.data['caps']) >= 2048:
            raise Denied('Capability capacity reached')
        token = secrets.token_urlsafe(32)
        expiry = int(time.time()) + lifetime
        self.data['caps'][digest(token)] = dict(payload, kind=kind, expiresAt=expiry)
        self.save()
        return token, expiry

    def issue(self, envelope):
        with self.lock:
            action = envelope.get('action')
            ts, nonce, body, mac = (envelope.get(k) for k in ('timestamp', 'nonce', 'payload', 'mac'))
            if action not in ('issue-ui', 'issue-action') or type(ts) is not int or abs(time.time() - ts) > 60:
                raise Denied('Invalid issuance')
            if not isinstance(nonce, str) or not re.fullmatch('[0-9a-f]{32}', nonce):
                raise Denied('Invalid issuance')
            if not isinstance(body, str) or len(body) > 8192 or not isinstance(mac, str):
                raise Denied('Invalid issuance')
            expected = hmac.new(self.key, f'{ts}\n{nonce}\n{action}\n{body}'.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, mac):
                raise Denied('Invalid issuance')
            self.save()
            if nonce in self.data['nonces'] or len(self.data['nonces']) >= 4096:
                raise Denied('Replayed or excessive issuance')
            self.data['nonces'][nonce] = int(time.time()) + 121
            self.save()
            try:
                payload = json.loads(base64.b64decode(body, validate=True))
            except (ValueError, TypeError):
                raise Denied('Invalid issuance')
            if not isinstance(payload, dict) or not isinstance(payload.get('userId'), str) or not 1 <= len(payload['userId']) <= 128:
                raise Denied('Invalid user')
            if action == 'issue-ui':
                if type(payload.get('interfaceAnimations')) is not bool:
                    raise Denied('Invalid preferences')
                cap = {'userId': payload['userId'], 'interfaceAnimations': payload['interfaceAnimations']}
                token, expiry = self.mint('ticket', cap, 60)
                return dict(ticket=token, expiresAt=expiry)
            operation = payload.get('action')
            if operation not in ('install', 'cancel', 'rollback'):
                raise Denied('Invalid operation')
            cap = dict(userId=payload['userId'], action=operation)
            if operation == 'install':
                if not isinstance(payload.get('version'), str) or not VERSION.fullmatch(payload['version']):
                    raise Denied('Invalid version')
                cap['version'] = payload['version']
            if operation == 'cancel':
                if not isinstance(payload.get('jobId'), str) or not re.fullmatch('[0-9a-f]{32}', payload['jobId']):
                    raise Denied('Invalid job')
                cap['jobId'] = payload['jobId']
            token, expiry = self.mint('action', cap, 60)
            return dict(authorization=token, expiresAt=expiry)

    def get(self, token, kind):
        cap = self.data['caps'].get(digest(token))
        if not cap or cap['kind'] != kind or cap['expiresAt'] <= time.time():
            raise Denied('Expired or invalid capability')
        return cap

    def redeem(self, ticket, origin):
        with self.lock:
            if origin != self.origin:
                raise Denied('Invalid origin')
            cap = self.get(ticket, 'ticket')
            del self.data['caps'][digest(ticket)]
            self.save()
            token, expiry = self.mint('token', {k: cap[k] for k in ('userId', 'interfaceAnimations')}, 8 * 3600)
            return dict(token=token, expiresAt=expiry, userId=cap['userId'], interfaceAnimations=cap['interfaceAnimations'])

    def read(self, token):
        with self.lock:
            return dict(self.get(token, 'token'))

    def consume(self, token, authorization, action, **target):
        with self.lock:
            user = self.get(token, 'token')
            cap = self.get(authorization, 'action')
            if cap['userId'] != user['userId'] or cap['action'] != action or any(cap.get(k) != v for k, v in target.items()):
                raise Denied('Capability target mismatch')
            del self.data['caps'][digest(authorization)]
            self.save()
