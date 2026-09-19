import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import WebSocket from 'ws';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function socket(g,auth,id){return new Promise((resolve,reject)=>{const ws=new WebSocket(g.origin.replace('http','ws')+'/ws/stream/'+id,{headers:{cookie:auth.cookie,Origin:g.origin}});const timer=setTimeout(()=>{ws.terminate();reject(Error('No stream frame'));},10000);ws.on('error',reject);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='frame'){ws.send(JSON.stringify({type:'ack',seq:m.seq}));clearTimeout(timer);resolve(ws);}});});}
test('independent sessions and users, live revocation and bounded real stream contexts',{timeout:30000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-contexts-');const g=await createGateway({port:0,runtime});const sockets=[];
 try{
  const admin=await authenticate(g.origin,runtime),a=client(g.origin,admin);
  const alice=await a('/admin/users','POST',{username:'alice',password,grants:['notes-lab','signal-lab']}).then(r=>r.json());
  const auth=await authenticate(g.origin,runtime,'alice'),u=client(g.origin,auth);
  const second=await authenticate(g.origin,runtime,'alice'),v=client(g.origin,second);
  await u('/windows','POST',{appId:'notes-lab'});await v('/windows','POST',{appId:'notes-lab'});
  sockets.push(await socket(g,auth,'notes-lab'),await socket(g,second,'notes-lab'));
  const managers=[...g.sessions.values()].filter(s=>s.userId===alice.id).map(s=>s.manager);
  assert.notEqual(managers[0].resources.get('notes-lab').context,managers[1].resources.get('notes-lab').context);
  await managers[0].resources.get('notes-lab').page.locator('textarea').fill('private');assert.equal(await managers[1].resources.get('notes-lab').page.locator('textarea').inputValue(),'');
  assert.equal((await u('/windows','POST',{appId:'signal-lab'})).status,429);
  assert.equal((await a('/admin/users/'+alice.id,'PATCH',{grants:['signal-lab']})).status,200);
  await wait(100);assert.ok(sockets.every(ws=>ws.readyState===WebSocket.CLOSED));assert.ok(managers.every(m=>m.resources.size===0));assert.equal((await u('/session')).status,401);
  const fresh=await authenticate(g.origin,runtime,'alice'),f=client(g.origin,fresh);assert.equal((await f('/windows/notes-lab','PATCH',{focused:true})).status,403);assert.equal((await f('/windows/notes-lab/reload','POST')).status,403);
  const denied=await new Promise(resolve=>{const ws=new WebSocket(g.origin.replace('http','ws')+'/ws/stream/notes-lab',{headers:{cookie:fresh.cookie,Origin:g.origin}});ws.on('unexpected-response',(_,r)=>{r.resume();resolve(r.statusCode);});ws.on('error',()=>{});});assert.equal(denied,403);
  await f('/windows','POST',{appId:'signal-lab'});sockets.push(await socket(g,fresh,'signal-lab'));await a('/admin/users/'+alice.id,'PATCH',{disabled:true});await wait(100);assert.equal(sockets.at(-1).readyState,WebSocket.CLOSED);
 }finally{sockets.forEach(s=>s.terminate());await g.close();await rm(runtime,{recursive:true,force:true});}
});
test('logout and expiry terminate live sockets and release browser contexts',{timeout:15000},async()=>{
 for(const expire of [false,true]){
  const runtime=await mkdtemp(tmpdir()+'/relay-live-end-');const g=await createGateway({port:0,runtime,sessionMs:expire?1500:60000});let ws;
  try{const auth=await authenticate(g.origin,runtime),a=client(g.origin,auth);await a('/windows','POST',{appId:'notes-lab'});const manager=g.manager;ws=await socket(g,auth,'notes-lab');if(expire)await wait(1700);else assert.equal((await a('/logout','POST')).status,200);await wait(100);assert.equal(ws.readyState,WebSocket.CLOSED);assert.equal(manager.resources.size,0);assert.equal((await a('/session')).status,401);}finally{ws?.terminate();await g.close();await rm(runtime,{recursive:true,force:true});}
 }
});
test('service status is bounded, truthful and independent of stream page absence',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-status-');const g=await createGateway({port:0,runtime});try{const a=client(g.origin,await authenticate(g.origin,runtime));const r=await a('/status');assert.equal(r.status,200);const status=await r.json();assert.equal(status['notes-lab'].state,'Unknown');assert.equal(status.parcels.state,'Offline');assert.ok(status.parcels.checkedAt);assert.ok(!JSON.stringify(status).includes('setup'));}finally{await g.close();await rm(runtime,{recursive:true,force:true});}
});
