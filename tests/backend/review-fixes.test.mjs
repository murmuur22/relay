import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../../server/streams.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise, resolve, reject}; };
const flush = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter {
  readyState=1; bufferedAmount=0; messages=[];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close(code) { if(this.readyState!==1)return; this.readyState=3; this.code=code; this.emit('close'); }
  message(value) { this.emit('message',JSON.stringify(value)); }
}
function fixture() {
  const manager=new Manager('/unused-synthetic', ['a','b'].map(id=>({id,label:id,mode:'stream'})));
  manager.persist=async()=>{};
  return manager;
}
function resource(send=async()=>{}) {
  const calls=[];
  const cdp=new EventEmitter(); cdp.send=async(method,params)=>{calls.push({method,params});return send(method,params);};
  return {cdp,calls,clients:new Set(),keys:new Map(),buttons:new Set(),capturing:false,inputDropped:0,
    page:{setViewportSize:async()=>{}},context:{close:async()=>{}}};
}

function browserDouble(manager, gate, send) {
  const created=[];
  let requests=0;
  manager.browserPromise=Promise.resolve({newContext:async()=>{
    if(requests++===0 && gate) await gate.promise;
    const r=resource(send); const page=new EventEmitter();
    Object.assign(page,{goto:async()=>{},setViewportSize:async()=>{}});
    const context=new EventEmitter();
    Object.assign(context,{route:async()=>{},routeWebSocket:async()=>{},newPage:async()=>page,
      newCDPSession:async()=>r.cdp,close:async()=>{r.closed=true;}});
    created.push(r);return context;
  }});
  return created;
}

for (const reopen of [false,true]) test(`close invalidates deferred creation${reopen?' across same-ID reopen':''}`, async()=>{
  const m=fixture(), old=await m.open('a'), gate=deferred();
  const created=browserDouble(m,gate), socket=new Socket();
  const attaching=m.attach('a',socket);await flush();
  const removing=m.remove('a');await flush();
  let current;
  if(reopen) current=await m.open('a');
  gate.resolve();await Promise.all([attaching,removing]);
  assert.equal(socket.readyState,3,'stale attachment must close');
  assert.equal(created[0].closed,true,'late context must be disposed');
  assert.equal(created[0].calls.some(c=>c.method==='Page.startScreencast'),false);
  assert.equal(m.resources.size,0);
  assert.equal(socket.listenerCount('message'),0);
  if(reopen) {
    assert.notEqual(current,old);assert.equal(m.windows.get('a'),current);
    const fresh=new Socket();await m.attach('a',fresh);
    assert.equal(m.resources.size,1);assert.equal(fresh.readyState,1);
    assert.equal(created[1].calls.some(c=>c.method==='Page.startScreencast'),true);
    await m.remove('a');
  } else assert.equal(m.windows.size,0);
});

test('failed initialization during close disposes its context',async()=>{
  const m=fixture();await m.open('a');const gate=deferred();
  const created=browserDouble(m,null,method=>method==='Page.enable'?gate.promise:undefined);
  const socket=new Socket(),attaching=m.attach('a',socket);await flush();
  const removing=m.remove('a');const removed=assert.doesNotReject(removing);
  gate.reject(Error('synthetic initialization failure'));
  await Promise.all([attaching,removed]);
  assert.equal(created[0].closed,true);assert.equal(m.resources.size,0);assert.equal(socket.readyState,3);
});

test('same-ID new attachment survives an older deferred creation completing',async()=>{
  const m=fixture();await m.open('a');const gate=deferred(),created=browserDouble(m,gate);
  const oldSocket=new Socket(),oldAttach=m.attach('a',oldSocket);await flush();
  const removing=m.remove('a');await m.open('a');
  const fresh=new Socket();await m.attach('a',fresh);const current=m.resources.get('a');
  gate.resolve();await Promise.all([oldAttach,removing]);
  assert.equal(m.resources.get('a'),current);assert.equal(fresh.readyState,1);
  assert.equal(oldSocket.readyState,3);assert.equal(created[1].closed,true);
  assert.notEqual(created[0].closed,true);await m.remove('a');
});

test('close serializes context disposal after an in-flight capture transition',async()=>{
  const m=fixture();await m.open('a');const gate=deferred();let closed=false;
  const r=resource(method=>method==='Page.startScreencast'?gate.promise:undefined);
  r.context.close=async()=>{closed=true;};m.resources.set('a',r);
  const socket=new Socket(),attaching=m.attach('a',socket);await flush();
  const removing=m.remove('a');await flush();
  assert.equal(closed,false,'context teardown must wait for capture transition');
  assert.equal(m.resources.size,0,'resource invalidates before waiting');
  gate.resolve();await Promise.all([removing,attaching]);
  assert.equal(closed,true);assert.equal(r.capturing,false);
  assert.equal(socket.messages.some(x=>x.state==='live'),false);
});

test('capture failure reports failed and restore retries the actual start command', async()=>{
  const m=fixture(), w=await m.open('a');let attempts=0;
  const r=resource(method=>{if(method==='Page.startScreencast'&&++attempts===1)throw Error('synthetic start failure');});
  m.resources.set('a',r);const socket=new Socket();r.clients.add({ws:socket});
  await assert.rejects(m.capture(w,r),/synthetic start failure/);
  assert.equal(r.capturing,false);
  assert.equal(socket.messages.at(-1).state,'failed');
  await m.patch('a',{visible:true});
  assert.equal(attempts,2);assert.equal(r.capturing,true);assert.equal(socket.messages.at(-1).state,'live');
});

test('capture transitions serialize start, resize, and hide without premature live', async()=>{
  const m=fixture(), w=await m.open('a'), gate=deferred();
  const r=resource(method=>method==='Page.startScreencast'?gate.promise:undefined);
  m.resources.set('a',r);const socket=new Socket();r.clients.add({ws:socket});
  const first=m.capture(w,r);await flush();
  const duplicate=m.capture(w,r);await flush();
  assert.equal(socket.messages.some(x=>x.state==='live'),false);
  const resize=m.patch('a',{width:1000}), hide=m.patch('a',{visible:false});await flush();
  assert.equal(r.calls.filter(c=>c.method==='Page.stopScreencast').length,0,'stop must wait for pending start');
  gate.resolve();await Promise.all([first,duplicate,resize,hide]);
  assert.equal(r.capturing,false);assert.equal(socket.messages.at(-1).state,'paused');
  assert.equal(r.calls.filter(c=>c.method==='Page.startScreencast').length,1);
});

test('static initial frame arriving before start resolves is delivered', async()=>{
  const m=fixture();await m.open('a');const created=browserDouble(m),gate=deferred();
  const r=await m.ensure(m.windows.get('a'));const send=r.cdp.send;
  r.cdp.send=async(method,params)=>{if(method==='Page.startScreencast'){
    r.cdp.emit('Page.screencastFrame',{sessionId:1,data:'YQ=='});await gate.promise;
  }return send(method,params);};
  const socket=new Socket(), attaching=m.attach('a',socket);await flush();
  assert.equal(socket.messages.filter(x=>x.type==='frame').length,1);
  assert.equal(socket.messages.some(x=>x.state==='live'),false);
  gate.resolve();await attaching;assert.equal(socket.messages.at(-1).state,'live');
  assert.equal(created.length,1);await m.remove('a');
});

for(const saturated of [false,true]) test(`out-of-band release invalidates blocked input with ${saturated?'saturated':'available'} tokens`,async()=>{
  const m=fixture(), w=await m.open('a'),gate=deferred();
  const r=resource(method=>method==='Input.insertText'?gate.promise:undefined);m.resources.set('a',r);
  const socket=new Socket();await m.attach('a',socket);const client=[...r.clients][0];
  r.keys.set('ShiftLeft','Shift');r.buttons.add('left');
  socket.message({type:'text',text:'already dispatched'});await flush();
  for(let i=0;i<40;i++)socket.message({type:'text',text:'stale queued'});
  if(saturated)client.tokens=0;
  const epoch=r.inputEpoch||0;socket.message({type:'release'});
  assert.equal(r.inputEpoch,epoch+1,'release must invalidate synchronously, outside queue');
  await flush();
  assert.ok(r.calls.some(c=>c.params?.type==='keyUp'));
  assert.ok(r.calls.some(c=>c.params?.type==='mouseReleased'));
  gate.resolve();await client.queue;
  assert.deepEqual(r.calls.filter(c=>c.method==='Input.insertText').map(c=>c.params.text),['already dispatched']);
  assert.equal(w.focused,true);assert.equal(r.keys.size,0);assert.equal(r.buttons.size,0);
  client.tokens=120;socket.message({type:'text',text:'fresh'});await client.queue;
  assert.equal(r.calls.at(-1).params.text,'fresh');
});

test('refocused input waits for held-key release without losing new key state',async()=>{
  const m=fixture();await m.open('a');const gate=deferred();
  const r=resource((method,params)=>params?.type==='keyUp'?gate.promise:undefined);m.resources.set('a',r);
  const socket=new Socket();await m.attach('a',socket);const client=[...r.clients][0];
  r.keys.set('ShiftLeft','Shift');
  const releasing=m.release(r);
  socket.message({type:'key',phase:'down',key:'Control',code:'ControlLeft'});await flush();
  assert.equal(r.calls.some(c=>c.params?.type==='rawKeyDown'),false);
  gate.resolve();await releasing;await client.queue;
  assert.equal(r.keys.get('ControlLeft'),'Control');
});

test('overlapping focus patches atomically select one input owner during delayed release', async()=>{
  const m=fixture(), a=await m.open('a'), b=await m.open('b');
  await m.patch('a',{focused:true});
  const gate=deferred();
  const ra=resource(method=>method==='Input.dispatchKeyEvent'?gate.promise:undefined), rb=resource();
  m.resources.set('a',ra);m.resources.set('b',rb);
  const sa=new Socket(), sb=new Socket();await m.attach('a',sa);await m.attach('b',sb);
  ra.keys.set('ShiftLeft','Shift');
  const first=m.patch('b',{focused:true});
  const second=m.patch('a',{focused:true});
  gate.resolve();await Promise.all([first,second]);
  assert.deepEqual([...m.windows.values()].filter(w=>w.focused).map(w=>w.id),['a']);
  sa.message({type:'text',text:'owner'});sb.message({type:'text',text:'stale'});await flush();
  assert.deepEqual(ra.calls.filter(c=>c.method==='Input.insertText').map(c=>c.params.text),['owner']);
  assert.deepEqual(rb.calls.filter(c=>c.method==='Input.insertText'),[]);
  assert.equal(a.focused,true);assert.equal(b.focused,false);
});
