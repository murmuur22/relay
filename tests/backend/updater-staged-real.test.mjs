import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {watch} from 'node:fs';
import {readFile, readlink, access, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGateway, ROOT} from '../../server/gateway.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import {authenticate, client, password} from '../auth-helper.mjs';

// Acceptance uses the actual Sandbox -> broker.server -> Engine -> Driver path.
// The socket observer forwards original bytes unchanged. A race barrier can hold
// a REAL broker response, never synthesize authentication or broker success.
// Fixture HMAC releases and a disposable Node runtime are NOT GitHub/systemd.
const exec = promisify(execFile);
const version = 'v0.3.1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(25); }
  throw Error('Actual broker fixture deadline exceeded');
}
async function exists(path) { try { await access(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } }
async function closedPort(port) {
  return new Promise(resolve => {
    const socket = net.connect({host:'127.0.0.1', port});
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    socket.on('connect', () => { socket.destroy(); resolve(false); });
    socket.on('error', e => { socket.destroy(); resolve(e.code === 'ECONNREFUSED'); });
  });
}
async function freePort() { const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
async function children(pid) {
  const {stdout} = await exec('ps', ['-axo', 'pid=,ppid=,command=']);
  return stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(m => m && Number(m[2]) === pid).map(m => ({pid:Number(m[1]), command:m[3]}));
}
async function observer(path, actual) {
  const trace = [], sockets = new Set(); let gate;
  const server = net.createServer(client => {
    const upstream = net.createConnection(actual); sockets.add(client); sockets.add(upstream);
    let request = '', noted = false, held = false, ended = false, chunks = [];
    const flush = () => { held = false; for (const bytes of chunks) client.write(bytes); chunks = []; if (ended) client.end(); };
    client.on('data', bytes => {
      if (noted) return;
      request += bytes.toString('utf8'); if (!request.includes('\n')) return; noted = true;
      const message = JSON.parse(request.split('\n')[0]);
      const fields = message.payload ? JSON.parse(Buffer.from(message.payload, 'base64')) : message.params;
      trace.push({action:message.action, ...Object.fromEntries(['action','version','jobId','userId'].filter(k => fields?.[k] !== undefined).map(k => [k === 'action' ? 'operation' : k, fields[k]]))});
      if (gate && gate.match(message, fields)) { held = true; gate.flush = flush; }
    });
    client.pipe(upstream);
    upstream.on('data', bytes => { if (held) chunks.push(bytes); else client.write(bytes); });
    upstream.on('end', () => { ended = true; if (held) { assert.equal(JSON.parse(Buffer.concat(chunks)).ok, true, 'Barrier must hold an actual successful broker reply'); gate.arrive(); } else client.end(); });
    for (const socket of [client, upstream]) {
      socket.on('error', () => { client.destroy(); upstream.destroy(); });
      socket.on('close', () => sockets.delete(socket));
    }
    client.on('close', () => upstream.destroy());
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  return {
    trace,
    hold(match) { assert.ok(!gate); let arrive; const arrived = new Promise(r => arrive = r); gate = {match, arrive}; return arrived; },
    release() { const prior = gate; prior?.flush?.(); gate = null; },
    async close() { this.release(); for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); }
  };
}
const supervisor = `from updater.fixtures.harness import Sandbox
import sys,json,os
box=Sandbox(ui_origin=sys.argv[1])
try:
 box.start()
 print(json.dumps({'root':str(box.root),'config':box.config,'brokerPid':box.process.pid}),flush=True)
 sys.stdin.readline()
finally:
 box.close()
 print(json.dumps({'cleanup':True,'brokerExitCode':box.process.returncode if box.process else None,'rootAbsent':not box.root.exists()}),flush=True)
`;

async function fixture(t) {
  const uiOrigin = 'http://127.0.0.1:' + await freePort();
  const child = spawn('python3', ['-u', '-c', supervisor, uiOrigin], {cwd:ROOT, stdio:['pipe','pipe','pipe']});
  let stdout = '', stderr = '', g, web, proxy, root, config, brokerPid, runtimePid, watcher;
  let forced = false; const observations = [], requests = [], markerEvents = [];
  child.stdout.on('data', bytes => stdout += bytes); child.stderr.on('data', bytes => stderr += bytes);
  child.stdin.on('error', () => {});
  t.after(async () => {
    watcher?.close(); proxy?.release();
    const failures = [];
    for (const close of [() => web?.close(), () => g?.close(), () => proxy?.close()]) {
      try { await close(); } catch (e) { failures.push(e.message); }
    }
    const exit = child.exitCode === null && child.signalCode === null ? once(child, 'exit') : Promise.resolve([child.exitCode, child.signalCode]);
    child.stdin.end('\n');
    const timer = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 22000);
    const [exitCode, signal] = await exit; clearTimeout(timer);
    const cleanup = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(value => value.cleanup);
    const ports = config ? [Number(new URL(uiOrigin).port), config.fixturePort, Number(new URL(config.fixtureFeed).port), ...(g ? [Number(new URL(g.origin).port)] : [])] : [];
    const receipt = {test:t.name, root, supervisorPid:child.pid, brokerPid, runtimePid, exitCode, signal, forced, supervisorCleanup:cleanup, rootAbsent:root ? !await exists(root) : null, pidsGone:[child.pid, brokerPid, runtimePid].filter(Boolean).every(pid => !alive(pid)), portsClosed:(await Promise.all(ports.map(closedPort))).every(Boolean), failures, observations, markerEvents, requests, brokerTrace:proxy?.trace, stderr};
    if (process.env.RELAY_REAL_BROKER_EVIDENCE) await writeFile(join(process.env.RELAY_REAL_BROKER_EVIDENCE, t.name.replace(/[^a-zA-Z0-9-]/g,'-') + '.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({test:t.name, cleanup:{exitCode, signal, forced, rootAbsent:receipt.rootAbsent, pidsGone:receipt.pidsGone, portsClosed:receipt.portsClosed}}));
    assert.equal(forced, false); assert.equal(exitCode, 0, stderr); assert.equal(signal, null);
    assert.deepEqual(failures, []); assert.equal(cleanup?.brokerExitCode, 0); assert.equal(cleanup?.rootAbsent, true);
    assert.equal(receipt.rootAbsent, true); assert.equal(receipt.pidsGone, true); assert.equal(receipt.portsClosed, true);
  });
  const line = await waitFor(() => { if (child.exitCode !== null) throw Error('First failing prerequisite: Sandbox.start(): ' + stderr); return stdout.includes('\n') && stdout.split('\n')[0]; });
  ({root, config, brokerPid} = JSON.parse(line));
  const initialChildren = await children(brokerPid);
  assert.equal(initialChildren.length, 1, 'Actual broker must own one real Node service'); runtimePid = initialChildren[0].pid;
  proxy = await observer(root + '/p.sock', config.socketPath);
  g = await createGateway({port:0, runtime:root + '/relay-http', profile:'standalone', updater:{socketPath:root + '/p.sock', keyFile:config.bridgeKeyFile, uiOrigin}, maintenanceFile:config.maintenance});
  web = await createUpdaterWeb({uiOrigin, relayOrigin:g.origin, socketPath:root + '/p.sock'});
  const auth = await authenticate(g.origin, root + '/relay-http'), api = client(g.origin, auth);
  const request = async (path, method = 'GET', data, headers = monitorHeaders) => {
    const response = await fetch(uiOrigin + '/updater/api' + path, {method, headers:{Origin:uiOrigin, 'Content-Type':'application/json', ...headers}, ...(data ? {body:JSON.stringify(data)} : {}), signal:AbortSignal.timeout(20000)});
    requests.push({path, method, fields:data ? {...data, ...('password' in data ? {password:'[fresh password redacted]'} : {}), ...('ticket' in data ? {ticket:'[one-use ticket redacted]'} : {})} : undefined, status:response.status});
    return response;
  };
  const launched = await api('/updater/launch', 'POST', {}); assert.equal(launched.status, 200);
  const ticket = new URL((await launched.json()).url).hash.slice(1);
  // Initialization passes explicit headers, before monitorHeaders is assigned.
  const exchange = await request('/exchange', 'POST', {ticket}, {Cookie:auth.cookie}); assert.equal(exchange.status, 200);
  const monitor = exchange.headers.get('set-cookie').split(';')[0], {csrf} = await exchange.json();
  const monitorHeaders = {Cookie:monitor + '; ' + auth.cookie, 'X-CSRF-Token':csrf};
  watcher = watch(root, (event, filename) => { if (String(filename) === 'maintenance') markerEvents.push(event); });
  const ready = async () => { const response = await fetch('http://127.0.0.1:' + config.fixturePort + '/health/ready', {signal:AbortSignal.timeout(2000)}); assert.equal(response.status,200); return response.json(); };
  const state = async () => { const response = await request('/state'); assert.equal(response.status,200); return response.json(); };
  const mutate = (action, fields = {}) => request('/' + action, 'POST', {password, confirmed:true, ...fields});
  const baselineLink = await readlink(config.installRoot + '/current');
  const unchanged = async () => {
    assert.equal(await exists(config.maintenance), false);
    assert.deepEqual(await readlink(config.installRoot + '/current'), baselineLink);
    assert.equal(alive(runtimePid), true);
    assert.equal((await children(brokerPid))[0]?.pid, runtimePid);
    assert.deepEqual(await ready(), {status:'ready', version:'0.3.0', maintenance:false});
    assert.equal((await api('/session')).status,200, 'Genuine Relay session stays live');
    const journal = JSON.parse(await readFile(config.controlRoot + '/journal.json', 'utf8'));
    assert.equal(journal.checkpoint, null); assert.equal(journal.previous, null);
    return journal;
  };
  const prepare = async () => {
    assert.equal((await request('/check','POST',{})).status,200);
    assert.equal((await mutate('prepare',{version})).status,200);
    const snapshot = await waitFor(async () => { await unchanged(); const value = await state(); if (['failed','interrupted'].includes(value.job?.phase)) throw Error(JSON.stringify(value)); return value.job?.phase === 'ready' && value; });
    assert.equal(snapshot.job.kind,'prepare'); assert.equal(snapshot.job.version,version); assert.equal(snapshot.job.userId,auth.s.user.id);
    assert.equal(snapshot.currentVersion,'v0.3.0'); assert.equal(snapshot.canApply,true);
    assert.ok(snapshot.job.downloadedBytes > 500000); assert.equal(snapshot.job.downloadedBytes,snapshot.job.totalBytes);
    assert.deepEqual(markerEvents,[], 'Preparation must not enter maintenance');
    observations.push({prepare:snapshot, runtimePid, baselineLink, relaySessionAlive:true, maintenanceEvents:markerEvents.length});
    return snapshot.job;
  };
  return {root, config, g, auth, api, request, mutate, state, ready, prepare, unchanged, proxy, observations, markerEvents, headers:monitorHeaders};
}

test('actual-broker prepare stays live then fresh-password apply activates exact prepared runtime', {timeout:60000}, async t => {
  const f = await fixture(t), job = await f.prepare();
  assert.equal((await f.request('/apply','POST',{version,jobId:job.id,confirmed:true})).status,400);
  assert.equal((await f.mutate('apply',{version,jobId:job.id,password:'Incorrect-test-password-42!'})).status,403);
  assert.equal((await f.request('/apply','POST',{version,jobId:job.id,password,confirmed:true},{...f.headers,Origin:'http://invalid.test'})).status,403);
  assert.equal((await f.request('/apply','POST',{version,jobId:job.id,password,confirmed:true},{...f.headers,'X-CSRF-Token':'invalid'})).status,403);
  await f.unchanged(); assert.equal(f.proxy.trace.filter(value => value.action === 'apply').length,0);
  assert.equal((await f.mutate('apply',{version,jobId:job.id})).status,200);
  const done = await waitFor(async () => { const s = await f.state(); return ['succeeded','failed','rolled-back','rollback-failed'].includes(s.job?.phase) && s; },30000);
  assert.equal(done.job.phase,'succeeded'); assert.equal(done.job.id,job.id); assert.equal(done.job.version,version); assert.equal(done.currentVersion,version);
  assert.deepEqual(await f.ready(),{status:'ready',version:'0.3.1',maintenance:false});
  assert.equal(await exists(f.config.maintenance),false);
  const link = await readlink(f.config.installRoot + '/current'); assert.notEqual(link,job.baseline.currentLink);
  const journal = JSON.parse(await readFile(f.config.controlRoot + '/journal.json','utf8'));
  assert.equal(journal.checkpoint,null); assert.equal(journal.previous.backupComplete,true); assert.equal(journal.prepared,undefined);
  assert.equal(await readFile(f.config.stateRoot + '/fixture.txt','utf8'),'initial synthetic state');
  assert.equal((await f.mutate('apply',{version,jobId:job.id})).status,409,'Already consumed ready consent cannot apply again');
  const apply = f.proxy.trace.filter(value => value.action === 'apply'); assert.deepEqual(apply,[{action:'apply',version,jobId:job.id}]);
  assert.ok(f.proxy.trace.some(value => value.action === 'issue-action' && value.operation === 'apply' && value.version === version && value.jobId === job.id && value.userId === f.auth.s.user.id));
  assert.ok(!f.proxy.trace.some(value => value.action === 'start'),'Never fall back to immediate install');
  f.observations.push({applied:done, readiness:await f.ready(), activatedLink:link});
});

test('actual-broker Relay logout after prepare prevents apply with retained exact cookies', {timeout:60000}, async t => {
  const f = await fixture(t), job = await f.prepare();
  assert.equal((await f.api('/logout','POST',{})).status,200); assert.equal((await f.api('/session')).status,401);
  assert.equal((await f.mutate('apply',{version,jobId:job.id})).status,401);
  assert.equal(f.proxy.trace.filter(value => value.action === 'apply').length,0);
  assert.deepEqual(await f.ready(),{status:'ready',version:'0.3.0',maintenance:false});
  assert.equal(await exists(f.config.maintenance),false);
  assert.equal(JSON.parse(await readFile(f.config.controlRoot + '/journal.json','utf8')).job.phase,'ready');
});

test('actual-broker independent logout after prepare prevents apply while Relay remains live', {timeout:60000}, async t => {
  const f = await fixture(t), job = await f.prepare();
  assert.equal((await f.request('/logout','POST',{})).status,200);
  assert.equal((await f.mutate('apply',{version,jobId:job.id})).status,401);
  assert.equal((await f.api('/session')).status,200); await f.unchanged();
  assert.equal(f.proxy.trace.filter(value => value.action === 'apply').length,0);
});

test('actual-broker wrong job or version denies before apply issuance and runtime changes', {timeout:60000}, async t => {
  const f = await fixture(t), job = await f.prepare(), before = f.proxy.trace.length;
  for (const fields of [{version,jobId:job.id === 'd'.repeat(32) ? 'e'.repeat(32) : 'd'.repeat(32)},{version:'v0.3.2',jobId:job.id}]) {
    assert.equal((await f.mutate('apply',fields)).status,409);
    const response = await f.api('/updater/authorize','POST',{action:'apply',...fields,password,confirmed:true}); assert.equal(response.status,409);
  }
  assert.ok(!f.proxy.trace.slice(before).some(value => value.action === 'apply' || value.operation === 'apply'));
  await f.unchanged(); assert.equal((await f.state()).job.id,job.id);
});

test('actual-broker stale consent during real issued apply authority is denied after cancellation', {timeout:60000}, async t => {
  const f = await fixture(t), job = await f.prepare();
  const arrived = f.proxy.hold((message, fields) => message.action === 'issue-action' && fields.action === 'apply');
  const pending = f.mutate('apply',{version,jobId:job.id});
  await waitFor(async () => Promise.race([arrived.then(() => true),delay(20).then(() => false)]));
  try { assert.equal((await f.mutate('cancel',{jobId:job.id})).status,200); assert.equal((await f.state()).job.phase,'cancelled'); }
  finally { f.proxy.release(); }
  assert.equal((await pending).status,409);
  assert.equal(f.proxy.trace.filter(value => value.action === 'apply').length,0);
  await f.unchanged();
  const next = await f.prepare(); assert.notEqual(next.id,job.id);
  assert.equal((await f.mutate('apply',{version,jobId:job.id})).status,409,'Old consent cannot target a replacement preparation');
  await f.unchanged();
});

test('actual-broker demotion during real issued apply authority revokes pending HTTP apply', {timeout:60000}, async t => {
  const f = await fixture(t), job = await f.prepare();
  assert.equal((await f.api('/admin/users','POST',{username:'second-admin',role:'admin',password})).status,200);
  const second = client(f.g.origin,await authenticate(f.g.origin,f.root + '/relay-http','second-admin'));
  const arrived = f.proxy.hold((message, fields) => message.action === 'issue-action' && fields.action === 'apply');
  const pending = f.mutate('apply',{version,jobId:job.id});
  await waitFor(async () => Promise.race([arrived.then(() => true),delay(20).then(() => false)]));
  try { assert.equal((await second('/admin/users/' + f.auth.s.user.id,'PATCH',{role:'user'})).status,200); }
  finally { f.proxy.release(); }
  assert.equal((await pending).status,401); assert.equal((await f.api('/session')).status,401);
  assert.equal(f.proxy.trace.filter(value => value.action === 'apply').length,0);
  assert.equal((await f.request('/state')).status,401);
  assert.deepEqual(await f.ready(),{status:'ready',version:'0.3.0',maintenance:false});
  assert.equal(await exists(f.config.maintenance),false);
  assert.equal(JSON.parse(await readFile(f.config.controlRoot + '/journal.json','utf8')).job.phase,'ready');
});
