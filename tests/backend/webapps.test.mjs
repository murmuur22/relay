import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
import {WebSocket} from 'ws';
import {Manager} from '../../server/streams.mjs';
import {chromium} from 'playwright';

test('restored layouts use registry authority, never saved navigation metadata',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-web-layout-');
 const apps=[{id:'web-native',kind:'web',mode:'native',label:'Safe',address:'http://127.0.0.1:12340/',openMode:'tab'},{id:'web-stream',kind:'web',mode:'stream',label:'Stream',address:'http://127.0.0.1:12341/'}];
 const m=new Manager(runtime,apps);
 try{await writeFile(runtime+'/layout.json',JSON.stringify(apps.map(a=>({id:a.id,appId:a.id,title:'stale',mode:'native',url:'javascript:alert(1)',address:'secret',external:false,width:900,height:500,x:23,y:30,visible:false,focused:true}))));await m.init();assert.equal(m.windows.get('web-native').url,apps[0].address);assert.equal(m.windows.get('web-native').external,true);assert.equal(m.windows.get('web-stream').url,undefined);assert.equal(m.windows.get('web-stream').address,undefined);assert.equal(m.windows.get('web-stream').mode,'stream');assert.equal(m.windows.get('web-native').x,23);}finally{await m.close();await rm(runtime,{recursive:true,force:true});}
});

test('real web stream transport, isolated login cookies, blocked origins, probe, preview and revocation',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-stream-web-');let g;let forbiddenHits=0;
 const forbidden=http.createServer((req,res)=>{forbiddenHits++;res.end('forbidden');});await new Promise(r=>forbidden.listen(0,'127.0.0.1',r));const blocked=`http://127.0.0.1:${forbidden.address().port}`;
 const upstream=http.createServer((req,res)=>{
  if(req.url==='/login'){res.setHeader('Set-Cookie',['fixture=one; HttpOnly; SameSite=Lax; Path=/','other=two; Path=/']);res.end('logged in');}
  else if(req.url==='/who')res.end(req.headers.cookie||'anonymous');
  else if(req.url==='/redirect'){res.writeHead(302,{location:blocked});res.end();}
  else {res.setHeader('Content-Type','text/html');res.end(`<h1>Real fixture</h1><input aria-label="Editor"><img src="${blocked}/asset"><script>fetch('${blocked}/fetch').catch(()=>{});new WebSocket('ws://127.0.0.1:${forbidden.address().port}/socket');</script>`);}
 });await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const address=`http://127.0.0.1:${upstream.address().port}/`;
 try{g=await createGateway({port:0,runtime});const auth=await authenticate(g.origin,runtime),admin=client(g.origin,auth);
 const draft={kind:'web',mode:'stream',label:'Fixture',address,icon:'notes',openMode:'window',allowedOrigins:[]};
 const authDiag=await (await admin('/admin/diagnostics')).json();assert.match(authDiag.externalConnections,/WebSockets.*unsupported/);
 const check=await admin('/admin/apps/check','POST',draft);assert.equal(check.status,200);assert.equal((await check.json()).state,'Online');
 assert.equal((await admin('/admin/apps/check','POST',{...draft,address:g.origin})).status,400);
 const preview=await admin('/admin/apps/preview','POST',draft);assert.equal(preview.status,200);assert.match((await preview.json()).image,/^data:image\/jpeg;base64,\/9j/);
 const entry=await (await admin('/admin/apps','POST',draft)).json();const w=await (await admin('/windows','POST',{appId:entry.id})).json();assert.equal(w.url,undefined);assert.equal(w.address,undefined);
 const s=await (await admin('/session')).json();assert.equal(s.apps.find(a=>a.id===entry.id).address,undefined);
 const manager=g.manager;const resource=await manager.ensure(manager.windows.get(entry.id));assert.match(await resource.page.textContent('h1'),/Real fixture/);
 await resource.page.locator('input').focus();await manager.input(resource,w,{type:'text',text:'typed via CDP'});assert.equal(await resource.page.inputValue('input'),'typed via CDP');
 const ws=new WebSocket(g.origin.replace('http','ws')+'/ws/stream/'+entry.id,{headers:{Cookie:auth.cookie,Origin:g.origin}});
 const frame=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No real frame')),8000);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='frame'){clearTimeout(timer);resolve(m);}});ws.on('error',reject);});assert.ok(Buffer.from(frame.data,'base64').length>100);
 await resource.page.evaluate(()=>fetch('/login'));assert.match(await resource.page.evaluate(()=>fetch('/who').then(r=>r.text())),/fixture=one/);
 await admin('/admin/users','POST',{username:'streamer',password,grants:[entry.id]});
 const second=client(g.origin,await authenticate(g.origin,runtime,'streamer'));await second('/windows','POST',{appId:entry.id});const other=[...g.sessions.values()].at(-1).manager;const r2=await other.ensure(other.windows.get(entry.id));assert.equal(await r2.page.evaluate(()=>fetch('/who').then(r=>r.text())),'anonymous');
 await resource.page.goto(address+'redirect').catch(()=>{});assert.equal(forbiddenHits,0);
 assert.equal((await (await admin('/status')).json())[entry.id].source,'relay');
 await admin('/admin/apps/'+entry.id,'PATCH',{enabled:false});assert.equal(resource.page.isClosed(),true);assert.equal(r2.page.isClosed(),true);ws.terminate();
 }finally{await g?.close();await new Promise(r=>upstream.close(r));await new Promise(r=>forbidden.close(r));await rm(runtime,{recursive:true,force:true});}
});

test('web registry, private/public metadata, grants, preferences and migration',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-web-');let g,browser;
 let nativeCookie;const fixture=http.createServer((req,res)=>{nativeCookie=req.headers.cookie;res.setHeader('Content-Type','text/html');res.end('<h1>Native external fixture</h1>');});await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
 try {g=await createGateway({port:0,runtime});const admin=client(g.origin,await authenticate(g.origin,runtime));
 const u=await (await admin('/admin/users','POST',{username:'viewer',password})).json();
 const draft={kind:'web',mode:'native',label:'Fixture',address:`http://localhost:${fixture.address().port}/path`,icon:'globe',openMode:'tab',allowedOrigins:[],userIds:[u.id]};
 for(const invalid of [{...draft,enabled:null},{...draft,allowedOrigins:null},{...draft,openMode:'popup'},{...draft,address:'http://169.254.169.254/'},{...draft,address:g.origin}])assert.equal((await admin('/admin/apps','POST',invalid)).status,400);
 assert.equal((await admin('/admin/apps?unused=1')).status,200);
 const response=await admin('/admin/apps','POST',draft);assert.equal(response.status,200);const app=await response.json();
 const viewer=client(g.origin,await authenticate(g.origin,runtime,'viewer'));const session=await (await viewer('/session')).json();assert.equal(session.user.preferences.showAppStatus,true);assert.equal(session.apps[0].url,draft.address);assert.equal(session.apps[0].address,undefined);
 const w=await (await viewer('/windows','POST',{appId:app.id,url:'http://bad.invalid'})).json();assert.equal(w.url,draft.address);assert.equal(w.external,true);assert.equal(w.openMode,'tab');
 browser=await chromium.launch({headless:true,chromiumSandbox:true,args:['--disable-background-networking']});const page=await browser.newPage();const auth=await authenticate(g.origin,runtime);await page.context().addCookies([{name:'relay_session',value:auth.cookie.slice(14),url:g.origin,httpOnly:true,sameSite:'Strict'}]);await page.goto(w.url);assert.equal(await page.textContent('h1'),'Native external fixture');assert.equal(nativeCookie,undefined);assert.equal(g.manager.resources.has(app.id),false);
 assert.equal((await viewer('/admin/apps/check','POST',draft)).status,403);assert.equal((await viewer('/admin/apps/preview','POST',{...draft,mode:'stream'})).status,403);
 const another=client(g.origin,await authenticate(g.origin,runtime,'viewer'));
 assert.equal((await viewer('/preferences','PATCH',{showAppStatus:false})).status,200);assert.equal((await viewer('/session')).status,200);assert.equal((await viewer('/preferences','PATCH',{showAppStatus:'no'})).status,400);
 assert.equal((await (await another('/session')).json()).user.preferences.showAppStatus,false);
 assert.equal((await admin('/admin/apps','POST',{...draft,mode:'stream',userIds:['missing']})).status,400);
 assert.equal((await admin('/admin/apps','PATCH',draft)).status,404);
 assert.equal((await admin('/admin/apps/'+app.id,'PATCH',{label:'Edited'})).status,200);assert.equal((await viewer('/session')).status,401);
 await g.close();g=null;
 const saved=JSON.parse(await readFile(runtime+'/accounts.json','utf8'));assert.deepEqual(saved.users[0].preferences,{showAppStatus:true,introAnimation:true,interfaceAnimations:true});delete saved.users[0].preferences;await writeFile(runtime+'/accounts.json',JSON.stringify(saved));
 g=await createGateway({port:0,runtime});const again=client(g.origin,await authenticate(g.origin,runtime,'viewer'));assert.equal((await (await again('/session')).json()).user.preferences.showAppStatus,false);
 const a=client(g.origin,await authenticate(g.origin,runtime));assert.equal((await (await a('/session')).json()).user.preferences.showAppStatus,true);
 }finally{await browser?.close();await g?.close();await new Promise(r=>fixture.close(r));await rm(runtime,{recursive:true,force:true});}
});
