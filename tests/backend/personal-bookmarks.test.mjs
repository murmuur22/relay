import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {writeFile,readdir} from 'node:fs/promises';
import {Desktop} from '../../server/desktop.mjs';
import {normalizeIcon} from '../../server/icons.mjs';
import {ROOT} from '../../server/gateway.mjs';
import {execFileSync} from 'node:child_process';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const json=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json();};
async function fixture(fn){const runtime=await mkdtemp(tmpdir()+'/relay-bookmarks-');let g;try{g=await createGateway({port:0,runtime,profile:'standalone'});const admin=client(g.origin,await authenticate(g.origin,runtime));await json(await admin('/admin/users','POST',{username:'viewer',password}));await fn(g,runtime,admin,client(g.origin,await authenticate(g.origin,runtime,'viewer')));}finally{await g?.close();await rm(runtime,{recursive:true,force:true});}}
test('regular user creates a private native bookmark, not a registry entry or grant',()=>fixture(async(g,runtime,admin,api)=>{
 const before=await json(await admin('/admin/apps'));
 const d=await json(await api('/desktop/bookmarks','POST',{url:'https://example.invalid/path',label:'My site',icon:'globe',parentId:null}));
 const own=d.personalApps.find(a=>a.label==='My site');assert.ok(own);assert.equal(own.mode,'native');assert.equal(own.openMode,'window');assert.match(own.id,/^personal-[a-f0-9-]{36}$/);
 const item=d.items.find(i=>i.appId===own.id);assert.ok(item);assert.equal(item.parentId,null);
 const session=await json(await api('/session'));assert.ok(session.apps.some(a=>a.id===own.id));assert.deepEqual(session.user.grants,[]);
 const w=await json(await api('/windows','POST',{appId:own.id}));assert.equal(w.url,own.url);assert.equal(w.external,true);
 assert.deepEqual(await json(await admin('/admin/apps')),before);
 assert.ok(!(await json(await admin('/session'))).apps.some(a=>a.id===own.id));
 assert.equal((await admin('/windows','POST',{appId:own.id})).status,403);
 assert.equal((await admin('/desktop/items/'+item.id,'PATCH',{label:'Foreign'})).status,404);
 const stored=runtime+'/users/'+d.ownerId+'/desktop.json';assert.equal((await stat(stored)).mode&0o777,0o600);assert.ok((await readFile(stored,'utf8')).includes(own.id));
 const saved=await json(await api('/desktop/items/'+item.id,'PATCH',{label:'Alias',icon:{type:'builtin',name:'star'}}));assert.equal(saved.items.find(i=>i.id===item.id).key,item.key);
 await json(await api('/desktop/items/'+item.id,'DELETE'));assert.ok(!(await json(await api('/session'))).apps.some(a=>a.id===own.id));assert.equal((await api('/windows','POST',{appId:own.id})).status,403);
}));
test('personal URL syntax is strict and refused before any server contact',()=>fixture(async(g,runtime,admin,api)=>{
 let contacts=0;const site=http.createServer((req,res)=>{contacts++;res.end('synthetic');});await new Promise(r=>site.listen(0,'127.0.0.1',r));
 try{const url='http://localhost:'+site.address().port+'/';
 for(const value of [url+'\n','http://local\thost:'+site.address().port+'/',g.origin.replace(/:\d+$/,':9999')+'/',g.origin.replace('127.0.0.1','127.0.0.1.')+'/', 'http://169.254.169.254/','http://100.100.100.200/','http://[fd00:ec2::254]/','javascript:alert(1)','file:///etc/passwd','https://u:p@example.test/','https://example.test/#secret','https://example.test/#','//example.test/'])assert.equal((await api('/desktop/bookmarks','POST',{url:value,label:'Denied',parentId:null})).status,400,value);
 for(const extra of [{mode:'gateway'},{mode:'stream'},{id:'system-updater'},{gateway:{target:'files'}},{userIds:[]},{icon:{type:'upload',id:'a'.repeat(32)}}])assert.equal((await api('/desktop/bookmarks','POST',{url,label:'Denied',parentId:null,...extra})).status,400);
 await json(await api('/desktop/bookmarks','POST',{url,label:'Offline is saveable',parentId:null}));assert.equal(contacts,0);await json(await api('/status'));assert.equal(contacts,0,'personal URLs must never be Relay-side probed');
 assert.equal((await api('/admin/apps','POST',{kind:'web',mode:'gateway'})).status,403);
 }finally{await new Promise(r=>site.close(r));}
}));
test('private bookmark uploads normalize and are denied after removal, to other users and after logout',()=>fixture(async(g,runtime,admin,api)=>{
 const d=await json(await api('/desktop/bookmarks','POST',{url:'https://images.invalid/',label:'Private icon',parentId:null})),item=d.items.find(i=>i.appId?.startsWith('personal-'));
 const auth=await authenticate(g.origin,runtime,'viewer');const bytes=execFileSync(ROOT+'integrations/keepsakes/.venv/bin/python',['-c',"from PIL import Image; import sys; Image.new('RGB',(200,200)).save(sys.stdout.buffer,format='PNG')"]);
 const upload=await fetch(g.origin+'/api/desktop/items/'+item.id+'/icon',{method:'POST',headers:{cookie:auth.cookie,Origin:g.origin,'X-CSRF-Token':auth.s.csrf,'Content-Type':'image/png'},body:bytes});
 const result=await json(upload),url=result.items.find(i=>i.id===item.id).icon.url;
 const fetched=await fetch(g.origin+url,{headers:{cookie:auth.cookie}});assert.equal(fetched.status,200);assert.equal(Buffer.from(await fetched.arrayBuffer()).readUInt32BE(16),128);
 assert.equal((await admin(url.replace('/api',''))).status,404);assert.equal((await fetch(g.origin+url)).status,401);
 await json(await api('/desktop/items/'+item.id,'DELETE'));assert.equal((await fetch(g.origin+url,{headers:{cookie:auth.cookie}})).status,404);
 await json(await client(g.origin,auth)('/logout','POST',{}));assert.equal((await fetch(g.origin+url,{headers:{cookie:auth.cookie}})).status,401);
}));
test('personal mutation queue is bounded and rechecks authority after a held edit',()=>fixture(async(g,runtime,admin,api)=>{
 const d=await json(await api('/desktop')),store=new Desktop(runtime,null,v=>new URL(v).href);let release,entered;const ready=new Promise(r=>entered=r),barrier=new Promise(r=>release=r);let live=true;
 const authority=()=>{if(!live)throw Error('Expired');return [];};
 const held=store.run(d.ownerId,authority,async()=>{entered();await barrier;});await ready;
 const queued=Array.from({length:32},()=>store.run(d.ownerId,authority));for(const job of queued)job.catch(()=>{});
 try{await assert.rejects(Promise.race([store.run(d.ownerId,authority),new Promise((_,reject)=>setTimeout(()=>reject(Error('Queue not bounded')),100))]),e=>e.status===429);live=false;}finally{release();await Promise.allSettled([held,...queued]);}
 assert.equal((await json(await api('/desktop'))).items.length,0);
}));
test('Gateway activation refuses another owners conflicting private bookmark, and retains retired cookie namespaces',()=>fixture(async(g,runtime,admin,api)=>{
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const config={version:2,mode:'reverse-proxy',bind:'127.0.0.1',port,desktopOrigin:'https://desktop.example.test',appBaseDomain:'apps.example.test',trustedProxy:'127.0.0.1',targets:[{id:'files',label:'Files',upstream:'http://127.0.0.1:18302'}]};
 const d=await json(await api('/desktop/bookmarks','POST',{url:'https://desktop.example.test:9443/',label:'Private conflicting site',parentId:null}));const before=await readFile(runtime+'/users/'+d.ownerId+'/desktop.json','utf8');
 const denied=await admin('/admin/gateway','PUT',{config,password});assert.equal(denied.status,409);assert.ok(!(await denied.text()).includes('Private conflicting site'));assert.equal(g.experimentalGateway,undefined);assert.equal(await readFile(runtime+'/users/'+d.ownerId+'/desktop.json','utf8'),before);
 await json(await api('/desktop/items/'+d.items.find(i=>i.appId?.startsWith('personal-')).id,'DELETE'));await json(await admin('/admin/gateway','PUT',{config,password}));await json(await admin('/admin/gateway','DELETE',{password}));
 for(const url of ['https://desktop.example.test:9443/','https://old.apps.example.test:9443/'])assert.equal((await api('/desktop/bookmarks','POST',{url,label:'Denied retired host',parentId:null})).status,400);
}));
test('64 private bookmark quota is enforced without blocking removal or altering shared accounts',()=>fixture(async(g,runtime,admin,api)=>{
 let last;for(let n=0;n<64;n++)last=await json(await api('/desktop/bookmarks','POST',{url:'https://quota.invalid/'+n,label:'Private '+n,parentId:null}));
 assert.equal(last.personalApps.length,64);assert.equal((await api('/desktop/bookmarks','POST',{url:'https://quota.invalid/overflow',label:'Overflow',parentId:null})).status,400);const item=last.items.find(i=>i.appId===last.personalApps[0].id);await json(await api('/desktop/items/'+item.id,'DELETE'));assert.equal((await api('/desktop/bookmarks','POST',{url:'https://quota.invalid/recovered',label:'Recovered',parentId:null})).status,200);assert.deepEqual(await json(await admin('/admin/apps')),[]);
}));
test('admin managed registry accepts audited Pixelarticons while personal shortcuts remain separate',()=>fixture(async(g,runtime,admin,api)=>{
 const response=await admin('/admin/apps','POST',{kind:'web',mode:'native',label:'Shared pixel site',address:'https://shared.invalid/',icon:'pixel-code'});const app=await json(response);assert.equal(app.icon,'pixel-code');assert.equal((await api('/admin/apps','POST',{kind:'web',mode:'native',label:'Denied',address:'https://shared.invalid/',icon:'pixel-code'})).status,403);
}));
test('version-1 migration preserves Desktop-named folders, placements, overrides and stable private keys',()=>fixture(async(g,runtime,admin,api)=>{
 let d=await json(await api('/desktop/folders','POST',{label:'Desktop',parentId:null}));const folder=d.itemId;d=await json(await api('/desktop/folders','POST',{label:'Nested',parentId:folder}));const path=runtime+'/users/'+d.ownerId+'/desktop.json',saved=JSON.parse(await readFile(path,'utf8'));saved.version=1;delete saved.bookmarks;await writeFile(path,JSON.stringify(saved));
 const migrated=await json(await api('/desktop'));assert.equal(migrated.items.find(i=>i.id===folder).label,'Desktop');const raw=JSON.parse(await readFile(path,'utf8'));assert.equal(raw.version,2);assert.deepEqual(raw.items,saved.items);assert.deepEqual(raw.bookmarks,[]);assert.equal(raw.revision,saved.revision+1);
 d=await json(await api('/desktop/bookmarks','POST',{url:'https://offline.invalid/',label:'Nested bookmark',icon:'pixel-book',parentId:folder}));const own=d.personalApps[0];assert.equal(d.items.find(i=>i.appId===own.id).parentId,folder);
 const relog=client(g.origin,await authenticate(g.origin,runtime,'viewer'));assert.equal((await json(await relog('/desktop'))).items.find(i=>i.appId===own.id).key,d.items.find(i=>i.appId===own.id).key);
 const snapshot=await readFile(path,'utf8'),corrupt={...JSON.parse(snapshot),bookmarks:[{...JSON.parse(snapshot).bookmarks[0],id:'system-updater'}]};await writeFile(path,JSON.stringify(corrupt));assert.equal((await relog('/desktop')).status,500);assert.equal(await readFile(path,'utf8'),JSON.stringify(corrupt));await writeFile(path,snapshot);
}));
test('genuine logout while bookmark mutation is awaiting disk denies queued commit and account-switch response',()=>fixture(async(g,runtime,admin,api)=>{
 const auth=await authenticate(g.origin,runtime,'viewer'),viewer=client(g.origin,auth);await json(await viewer('/desktop'));let release,entered;const ready=new Promise(r=>entered=r),barrier=new Promise(r=>release=r);const original=Desktop.prototype.load;
 Desktop.prototype.load=async function(owner){const s=await original.call(this,owner);if(owner===auth.s.user.id&&s.bookmarks?.length===0){entered();await barrier;}return s;};
 const pending=viewer('/desktop/bookmarks','POST',{url:'https://race.invalid/',label:'Race',parentId:null});await ready;
 try{await json(await viewer('/logout','POST',{}));}finally{Desktop.prototype.load=original;release();}
 assert.equal((await pending).status,401);const fresh=client(g.origin,await authenticate(g.origin,runtime,'viewer'));assert.deepEqual((await json(await fresh('/desktop'))).personalApps,[]);
}));



