import {authenticate,client} from '../auth-helper.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createGateway} from '../../server/gateway.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),5000);})]);}finally{clearTimeout(timer);}}
async function emptied(manager,browser){const end=Date.now()+3000;while(manager.resources.size||browser.contexts().length){assert.ok(Date.now()<end,'disconnected resource and real browser context must expire');await sleep(20);}}
test('hidden initial socket reports paused and abandoned opens expire within grace',{timeout:20000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-life-'),g=await createGateway({port:0,runtime});let ws;
 try{const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);g.manager.graceMs=150;
 const opened=await api('/windows','POST',{appId:'notes-lab'});assert.equal(opened.status,200);const w=await opened.json();assert.equal((await api('/windows/'+w.id,'PATCH',{visible:false})).status,200);
 let paused;const pausedReady=new Promise(r=>paused=r),states=[];ws=new WebSocket(g.origin.replace('http','ws')+'/ws/stream/'+w.id,{headers:{cookie:auth.cookie,Origin:g.origin}});ws.on('message',raw=>{const state=JSON.parse(raw).state;states.push(state);if(state==='paused')paused();});
 // Chromium startup is not bounded by a 600 ms sleep. Require the actual state,
 // then the actual close/grace/context effects, under explicit failure deadlines.
 await bounded(pausedReady,'actual paused state not received');assert.ok(states.includes('paused'));const browser=await g.manager.browserPromise;const closed=once(ws,'close');ws.close();await bounded(closed,'socket did not close');await emptied(g.manager,browser);assert.equal(g.manager.resources.size,0,'disconnected grace expires');
 assert.equal((await api('/windows/'+w.id,'PATCH',{visible:true})).status,200);
 let attached;const attachDone=new Promise(r=>attached=r),attach=g.manager.attach.bind(g.manager);g.manager.attach=async(...args)=>{try{return await attach(...args);}finally{attached();}};
 ws=new WebSocket(g.origin.replace('http','ws')+'/ws/stream/'+w.id,{headers:{cookie:auth.cookie,Origin:g.origin}});const abandonedClose=once(ws,'close');ws.on('open',()=>ws.close());await bounded(abandonedClose,'abandoned socket did not close');await bounded(attachDone,'actual abandoned attach did not settle');await emptied(g.manager,browser);assert.equal(g.manager.resources.size,0,'abandoned opening also expires');
 }finally{ws?.terminate();await g.close();await rm(runtime,{recursive:true,force:true});}
});
