import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Accounts} from '../../server/accounts.mjs';
import {APPS,createGateway} from '../../server/gateway.mjs';
import {Manager} from '../../server/streams.mjs';
import {Transport} from '../../server/transport.mjs';
import {HealthProbes} from '../../server/health.mjs';
import {previewWeb} from '../../server/web-browser.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function promptly(p,ms=800){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Cleanup did not complete promptly')),ms);})]);}finally{clearTimeout(timer);}}
async function fixture(handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {address:`http://127.0.0.1:${server.address().port}/`,close:()=>{server.closeAllConnections();return new Promise(r=>server.close(r));}};}

test('already aborted transport never starts DNS or consumes capacity',async()=>{
 let lookups=0;const transport=new Transport({lookup:async()=>{lookups++;return [{address:'127.0.0.1',family:4}];}});const controller=new AbortController();controller.abort();
 try{await assert.rejects(transport.request('http://fixture.invalid/',undefined,{signal:controller.signal}));assert.equal(lookups,0);assert.equal(transport.pending,0);}finally{await transport.close();}
});

test('admin revocation cancels a real stream still waiting for its first document',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-stream-revoke-');let started,ended;const hit=new Promise(r=>started=r),aborted=new Promise(r=>ended=r);const f=await fixture((req,res)=>{started();res.on('close',ended);});const g=await createGateway({port:0,runtime});
 try{const admin=client(g.origin,await authenticate(g.origin,runtime));const entry=await (await admin('/admin/apps','POST',{kind:'web',mode:'stream',label:'Slow',address:f.address})).json();const user=await (await admin('/admin/users','POST',{username:'streamer',password,grants:[entry.id]})).json();const viewer=client(g.origin,await authenticate(g.origin,runtime,'streamer'));await viewer('/windows','POST',{appId:entry.id});const manager=[...g.sessions.values()].at(-1).manager;const opening=manager.ensure(manager.windows.get(entry.id)).catch(()=>null);await promptly(hit,3000);const browser=await manager.browserPromise;
 assert.equal((await promptly(admin('/admin/users/'+user.id,'PATCH',{disabled:true}))).status,200);await promptly(aborted);await opening;assert.equal(browser.contexts().length,0);assert.equal(manager.resources.size,0);assert.equal(manager.creations.size,0);assert.equal((await viewer('/session')).status,401);
 }finally{await g.close();await f.close();await rm(runtime,{recursive:true,force:true});}
});

test('checks reject excess concurrency immediately while retaining CSRF and exact Origin',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-check-limit-');let started,hits=0;const hit=new Promise(r=>started=r);const f=await fixture(()=>{if(++hits===4)started();});const g=await createGateway({port:0,runtime});
 try{const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);const draft={kind:'web',mode:'stream',label:'Slow',address:f.address};
 for(const endpoint of ['check','preview'])for(const headers of [{Origin:g.origin},{Origin:'http://localhost:'+new URL(g.origin).port,'X-CSRF-Token':auth.s.csrf}]){const r=await fetch(g.origin+'/api/admin/apps/'+endpoint,{method:'POST',headers:{cookie:auth.cookie,'Content-Type':'application/json',...headers},body:JSON.stringify(draft)});assert.equal(r.status,403);}
 const pending=Array.from({length:4},()=>api('/admin/apps/check','POST',draft));await promptly(hit);assert.equal((await promptly(api('/admin/apps/check','POST',draft))).status,429);assert.equal((await promptly(api('/logout','POST'))).status,200);for(const r of await Promise.all(pending))assert.equal(r.status,401);assert.equal(hits,4);
 }finally{await g.close();await f.close();await rm(runtime,{recursive:true,force:true});}
});

test('gateway close drains its background health queue',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-health-close-');let started,hits=0;const hit=new Promise(r=>started=r);const f=await fixture(()=>{hits++;started();});const g=await createGateway({port:0,runtime});let closed=false;
 try{const api=client(g.origin,await authenticate(g.origin,runtime));for(let n=0;n<30;n++)assert.equal((await api('/admin/apps','POST',{kind:'web',mode:'stream',label:'Slow',address:f.address+n})).status,200);const pending=api('/status');await hit;await promptly(g.close(),1500);closed=true;await pending;assert.ok(hits<=4);}finally{if(!closed)await g.close();await f.close();await rm(runtime,{recursive:true,force:true});}
});

for(const endpoint of ['preview','check'])for(const cause of ['expiry','disconnect','disable'])test(`${endpoint} ${cause} aborts real upstream and releases session operation`,async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-operation-');let started,ended;const hit=new Promise(r=>started=r),aborted=new Promise(r=>ended=r);const f=await fixture((req,res)=>{started();res.on('close',ended);});const g=await createGateway({port:0,runtime,sessionMs:cause==='expiry'?1500:60000});
 try{const admin=client(g.origin,await authenticate(g.origin,runtime));await admin('/admin/users','POST',{username:'operator',role:'admin',password});const auth=await authenticate(g.origin,runtime,'operator');const s=[...g.sessions.values()].at(-1);const controller=new AbortController();
 const pending=fetch(g.origin+'/api/admin/apps/'+endpoint,{method:'POST',headers:{cookie:auth.cookie,Origin:g.origin,'X-CSRF-Token':auth.s.csrf,'Content-Type':'application/json'},body:JSON.stringify({kind:'web',mode:'stream',label:'Slow',address:f.address}),signal:controller.signal}).catch(e=>e);
 await promptly(hit,3000);assert.equal(s.operations.size,1);
 if(cause==='disconnect')controller.abort();else if(cause==='disable')assert.equal((await promptly(admin('/admin/users/'+s.userId,'PATCH',{disabled:true}))).status,200);
 await promptly(aborted,cause==='expiry'?2000:800);const response=await promptly(pending);if(cause!=='disconnect')assert.equal(response.status,401);
 await promptly((async()=>{while(s.operations.size)await sleep(10);})());assert.equal(s.operations.size,0);
 }finally{await g.close();await f.close();await rm(runtime,{recursive:true,force:true});}
});

test('preview aborted during launch never sends an upstream request',async()=>{
 let hits=0;const f=await fixture((req,res)=>{hits++;res.end('<h1>Fixture</h1>');});const transport=new Transport(),controller=new AbortController();
 try{const pending=previewWeb({address:f.address},transport,controller.signal);controller.abort();await promptly(assert.rejects(pending,/Preview unavailable/),3000);assert.equal(hits,0);assert.equal(transport.pending,0);}finally{await transport.close();await f.close();}
});

test('health shutdown cancels active probes and queued entries without new requests',async()=>{
 let started,hits=0;const hit=new Promise(r=>started=r);const f=await fixture(()=>{hits++;started();});const health=new HealthProbes();
 try{const pending=Array.from({length:30},(_,n)=>health.probe({address:f.address+n}));await hit;await promptly(health.close());await promptly(Promise.all(pending));assert.ok(hits<=4);assert.equal(health.queue.length,0);assert.equal(health.active.size,0);assert.equal(health.transport.pending,0);}finally{await health.close();await f.close();}
});

test('health deadlines settle and cache failed observations',async()=>{
 let hits=0;const f=await fixture(()=>hits++);const health=new HealthProbes();
 try{const config={address:f.address};const first=await promptly(health.probe(config),3200);const again=await health.probe({...config});assert.deepEqual(again,first);assert.notEqual(first.state,'Online');assert.equal(hits,1);}finally{await health.close();await f.close();}
});

test('background status fairly probes more than transport capacity and deduplicates across account writes',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-health-fair-');const hits=new Map();let active=0,maxActive=0,started;const hit=new Promise(r=>started=r);
 const f=await fixture((req,res)=>{if(req.url==='/interactive'){res.end();return;}hits.set(req.url,(hits.get(req.url)||0)+1);active++;maxActive=Math.max(maxActive,active);started();setTimeout(()=>{active--;res.end();},100);});const g=await createGateway({port:0,runtime});
 try{const api=client(g.origin,await authenticate(g.origin,runtime));const ids=[];for(let n=0;n<30;n++){const r=await api('/admin/apps','POST',{kind:'web',mode:'stream',label:'Fixture '+n,address:f.address+n});assert.equal(r.status,200);ids.push((await r.json()).id);}
 const first=api('/status');await hit;await api('/preferences','PATCH',{showAppStatus:false});const second=api('/status');
 const check=await api('/admin/apps/check','POST',{kind:'web',mode:'stream',label:'Interactive',address:f.address+'interactive'});assert.equal((await check.json()).state,'Online');
 for(const response of await Promise.all([first,second])){const status=await response.json();for(const id of ids)assert.equal(status[id].state,'Online',JSON.stringify(status[id]));}
 assert.equal(hits.size,30);assert.ok(maxActive<=4,`health concurrency ${maxActive}`);assert.ok([...hits.values()].every(n=>n===1),'pending cache survives immutable account writes');
 }finally{await g.close();await f.close();await rm(runtime,{recursive:true,force:true});}
});

test('slow preview is bounded outside writes and logout revokes pending browser work',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-preview-cancel-');let started,ended;const hit=new Promise(r=>started=r),aborted=new Promise(r=>ended=r);const f=await fixture((req,res)=>{started();res.on('close',ended);});const g=await createGateway({port:0,runtime});
 try{const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth),other=client(g.origin,await authenticate(g.origin,runtime));const draft={kind:'web',mode:'stream',label:'Slow',address:f.address};const preview=api('/admin/apps/preview','POST',draft);await promptly(hit,3000);
 assert.equal((await promptly(other('/logout','POST'))).status,200);
 assert.equal((await promptly(api('/admin/apps/preview','POST',draft))).status,429);
 assert.equal((await promptly(api('/windows','POST',{appId:'parcels'}))).status,200);
 assert.equal((await promptly(api('/logout','POST'))).status,200);await promptly(aborted);assert.equal((await promptly(preview)).status,401);
 }finally{await f.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});

for(const action of ['remove','close'])test(`pending real stream ${action} cancels upstream before delayed DOM arrives`,async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-pending-');let started,ended;const hit=new Promise(r=>started=r),aborted=new Promise(r=>ended=r);
 const f=await fixture((req,res)=>{started();res.on('close',ended);});const transport=new Transport();const app={id:'slow',kind:'web',mode:'stream',label:'Slow fixture',address:f.address};const m=new Manager(runtime,[app]);m.transport=transport;
 try{const w=await m.open(app.id);const opening=m.ensure(w).catch(()=>null);await promptly(hit,3000);const browser=await m.browserPromise;await promptly(action==='remove'?m.remove(w.id):m.close());await promptly(aborted);await opening;assert.equal(browser.contexts().length,0);assert.equal(transport.pending,0);}finally{await f.close();await m.close();await transport.close();await rm(runtime,{recursive:true,force:true});}
});

test('HTTP error responses indicate uncertain application health, not unreachable transport',async()=>{
 const f=await fixture((req,res)=>{res.statusCode=Number(req.url.slice(1));res.end();});const transport=new Transport();
 try{for(const code of [404,500]){const result=await transport.probe({address:f.address+code});assert.equal(result.state,'Unknown');assert.equal(result.httpStatus,code);assert.match(result.detail,new RegExp('HTTP '+code));}}finally{await transport.close();await f.close();}
});

test('persisted preference corruption refuses startup; absent legacy preference defaults true',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-pref-hardening-');
 try{const accounts=new Accounts(runtime,APPS);await accounts.init();await accounts.enroll(password);const saved=JSON.parse(await readFile(runtime+'/accounts.json','utf8'));
 for(const preferences of [null,[],false,{}, {showAppStatus:'false'},{showAppStatus:true,extra:1}]){saved.users[0].preferences=preferences;await writeFile(runtime+'/accounts.json',JSON.stringify(saved));await assert.rejects(new Accounts(runtime,APPS).init(),/refusing enrollment/);}
 delete saved.users[0].preferences;await writeFile(runtime+'/accounts.json',JSON.stringify(saved));const migrated=new Accounts(runtime,APPS);await migrated.init();assert.deepEqual(migrated.state.users[0].preferences,{showAppStatus:true});
 }finally{await rm(runtime,{recursive:true,force:true});}
});
