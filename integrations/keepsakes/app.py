"""Keepsakes: loopback-only, folder-backed image collection. No remote fetching."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlsplit
import argparse
import io
import os
import re
import secrets
import shutil
import threading
import uuid
import warnings

import yaml
from PIL import Image
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from starlette.formparsers import MultiPartParser

MAX_FILE = 15 * 1024 * 1024
MAX_REQUEST = MAX_FILE + 256 * 1024
MultiPartParser.spool_max_size = MAX_REQUEST
ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
ASSETS = {'source.png': 'image/png', 'source.jpg': 'image/jpeg', 'source.webp': 'image/webp'}


def safe_path(path):
    """Reject symlinks at every component, including the collection root."""
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Symlinks are not supported in collection paths')
    return path


def atomic(path, content):
    safe_path(path)
    temporary = path.with_name('.write-' + secrets.token_hex(12))
    try:
        with temporary.open('xb') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validate(fields):
    limits = {'title': 300, 'source': 2048, 'creator': 300, 'notes': 100000}
    if set(fields) - set(limits):
        raise HTTPException(422, 'Unknown editable field')
    for key, value in fields.items():
        if not isinstance(value, str) or len(value) > limits[key] or '\x00' in value:
            raise HTTPException(422, f'Invalid or too long {key}')
    if 'title' in fields and not fields['title'].strip():
        raise HTTPException(422, 'A title is required')
    source = fields.get('source', '')
    if source:
        try:
            u = urlsplit(source)
            if (u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password
                    or any(ord(c) < 33 for c in source) or '\\' in source):
                raise ValueError()
            _ = u.port
        except ValueError:
            raise HTTPException(422, 'Source must be an http(s) URL without credentials')


def markdown(meta):
    body = f"# {meta['title']}\n\nSource: {meta['source'] or 'Not provided'}\nCreator: {meta['creator'] or 'Not provided'}\nSaved: {meta['created']}\nOriginal: {meta['asset']}\n"
    return ('---\n' + yaml.safe_dump(meta, allow_unicode=True, sort_keys=False) + '---\n\n' + body).encode()


class LocalGuard:
    def __init__(self, app, csrf, port):
        self.app, self.csrf = app, csrf
        self.hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope['headers']}
        host = headers.get('host', '')
        error = None
        if host not in self.hosts:
            error = (400, 'Invalid loopback Host')
        elif headers.get('origin') and headers['origin'] != 'http://' + host:
            error = (403, 'Cross-origin requests are forbidden')
        elif scope['method'] not in ('GET', 'HEAD', 'OPTIONS') and (
            headers.get('origin') != 'http://' + host or
            not secrets.compare_digest(headers.get('x-csrf-token', ''), self.csrf)):
            error = (403, 'Missing or invalid Origin / CSRF token; reload this page')
        if error:
            return await JSONResponse({'detail': error[1]}, status_code=error[0])(scope, receive, send)
        # Bound the actual stream before multipart parsing, including chunked requests.
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > MAX_REQUEST:
                return await JSONResponse({'detail': 'Request exceeds 15 MiB upload limit'}, status_code=413)(scope, receive, send)
            if not message.get('more_body'):
                break
        async def bounded_receive():
            return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
        async def secure_send(message):
            if message['type'] == 'http.response.start':
                message['headers'] += [(b'x-content-type-options', b'nosniff'),
                    (b'referrer-policy', b'no-referrer'), (b'cache-control', b'no-store'),
                    (b'content-security-policy', b"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")]
            await send(message)
        await self.app(scope, bounded_receive, secure_send)


def create_app(data_dir, port=4177):
    root = safe_path(Path(data_dir).absolute())
    clips = safe_path(root / 'clips')
    clips.mkdir(parents=True, exist_ok=True)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    csrf = secrets.token_urlsafe(32)
    app.add_middleware(LocalGuard, csrf=csrf, port=port)
    lock = threading.RLock()

    def folder_for(identifier):
        if not ID.fullmatch(identifier):
            raise HTTPException(404, 'Clipping not found')
        try:
            folder = safe_path(clips / identifier)
            if not folder.is_dir():
                raise ValueError()
            return folder
        except ValueError:
            raise HTTPException(404, 'Clipping not found')

    def read(identifier):
        try:
            folder = folder_for(identifier)
            meta_file = safe_path(folder / 'clipping.md')
            notes_file = safe_path(folder / 'notes.md')
            if meta_file.stat().st_size > 20000 or notes_file.stat().st_size > 400000:
                raise ValueError()
            text = meta_file.read_text()
            if not text.startswith('---\n'):
                raise ValueError()
            frontmatter = re.split(r'^---$', text, maxsplit=2, flags=re.MULTILINE)
            if len(frontmatter) != 3:
                raise ValueError()
            meta = yaml.safe_load(frontmatter[1])
            if not isinstance(meta, dict):
                raise ValueError()
            meta = {k: meta[k] for k in ('id', 'title', 'source', 'creator', 'created', 'asset')}
            if not all(isinstance(value, str) for value in meta.values()):
                raise ValueError()
            if meta['id'] != identifier or meta['asset'] not in ASSETS:
                raise ValueError()
            validate({k: meta[k] for k in ('title', 'source', 'creator')})
            datetime.fromisoformat(meta['created'])
            asset_path = safe_path(folder / meta['asset'])
            if not asset_path.is_file():
                raise ValueError()
            return {**meta, 'notes': notes_file.read_text()}
        except (OSError, ValueError, KeyError, IndexError, TypeError, yaml.YAMLError, HTTPException):
            raise HTTPException(404, 'Clipping missing, unsafe, or unreadable')

    @app.get('/api/session')
    def session():
        return {'csrf': csrf}

    @app.get('/api/clips')
    def listing():
        with lock:
            items = []
            safe_path(clips)
            for p in clips.iterdir():
                try:
                    items.append(read(p.name))
                except HTTPException:
                    continue
            return sorted(items, key=lambda c: c['created'], reverse=True)

    @app.post('/api/clips', status_code=201)
    async def upload(file: UploadFile = File(), title: str = Form(), source: str = Form(''), creator: str = Form('')):
        validate({'title': title, 'source': source, 'creator': creator})
        raw = await file.read(MAX_FILE + 1)
        await file.close()
        if len(raw) > MAX_FILE:
            raise HTTPException(413, 'Image exceeds 15 MiB')
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(raw)) as img:
                    if img.format not in ('PNG', 'JPEG', 'WEBP'):
                        raise ValueError()
                    if max(img.size) > 8192 or img.width * img.height > 24000000 or getattr(img, 'n_frames', 1) != 1:
                        raise ValueError()
                    extension = {'PNG': 'png', 'JPEG': 'jpg', 'WEBP': 'webp'}[img.format]
                    img.verify()
                with Image.open(io.BytesIO(raw)) as img:
                    img.load()
        except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise HTTPException(422, 'Use a valid, still PNG, JPEG or WebP (up to 8192px per side and 24 megapixels)')
        with lock:
            identifier = str(uuid.uuid4())
            folder = safe_path(clips / identifier)
            if folder.exists():
                raise HTTPException(409, 'ID collision; try again')
            staging = safe_path(clips / ('.pending-' + secrets.token_hex(12)))
            staging.mkdir()
            meta = {'id': identifier, 'title': title, 'source': source, 'creator': creator,
                    'created': datetime.now(timezone.utc).isoformat(), 'asset': f'source.{extension}'}
            try:
                atomic(staging / meta['asset'], raw)
                atomic(staging / 'clipping.md', markdown(meta))
                atomic(staging / 'notes.md', b'')
                # One writer per server; existing non-empty folders cannot be replaced.
                staging.rename(folder)
            finally:
                if staging.exists():
                    shutil.rmtree(staging)
            return read(identifier)

    @app.get('/api/clips/{identifier}/asset')
    def asset(identifier: str):
        with lock:
            meta = read(identifier)
            return FileResponse(folder_for(identifier) / meta['asset'], media_type=ASSETS[meta['asset']])

    @app.patch('/api/clips/{identifier}')
    def edit(identifier: str, changes: dict):
        validate(changes)
        with lock:
            meta = read(identifier)
            folder = folder_for(identifier)
            old_notes = meta.pop('notes')
            notes = changes.get('notes', old_notes)
            meta.update({k: changes[k] for k in ('title', 'source', 'creator') if k in changes})
            atomic(folder / 'clipping.md', markdown(meta))
            atomic(folder / 'notes.md', notes.encode())
            return read(identifier)

    @app.delete('/api/clips/{identifier}')
    def delete(identifier: str):
        with lock:
            read(identifier)
            trash = safe_path(root / '.trash')
            trash.mkdir(exist_ok=True)
            target = safe_path(trash / identifier)
            if target.exists():
                raise HTTPException(409, 'Trash already contains this ID; restore or move it first')
            folder_for(identifier).rename(target)
            return {'trashed': identifier}

    from fastapi.staticfiles import StaticFiles
    static = Path(__file__).resolve().parent / 'static'

    @app.get('/')
    def home():
        return FileResponse(static / 'index.html')

    app.mount('/static', StaticFiles(directory=static), name='static')
    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', default=os.environ.get('KEEPSAKES_DATA_DIR', str(Path(__file__).resolve().parent / 'data')))
    parser.add_argument('--port', type=int, default=4177)
    args = parser.parse_args()
    import uvicorn
    uvicorn.run(create_app(args.data_dir, args.port), host='127.0.0.1', port=args.port)
