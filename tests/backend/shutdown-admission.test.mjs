import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {WebSocket} from 'ws';
// Hold only delivery of a genuine scrypt result, never substitute auth success.
let holdVerification;
const scrypt=crypto.scrypt;
crypto.scrypt=(...args)=>{const callback=args.pop(),hold=holdVerification;holdVerification=null;return scrypt(...args,(...result)=>{if(hold){hold.entered.resolve();void hold.release.promise.then(()=>callback(...result));}else callback(...result);});};
syncBuiltinESMExports();
const {createGateway}=await import('../../server/gateway.mjs');
const {Manager}=await import('../../server/streams.mjs');
const {launchBrowser}=await import('../../server/web-browser.mjs');
const {authenticate,client,password}=await import('../auth-helper.mjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('shutdown admission deadline: '+label)),4000))]);}finally{clearTimeout(timer);}}
const turn=()=>new Promise(r=>setImmediate(r));
async function fixture(){const root=await mkdtemp(tmpdir()+'/shutdown-admit-');return {root,g:await createGateway({port:0,runtime:root})};}
async function credentials(g){return (await(await fetch(g.origin+'/api/auth')).json()).csrf;}
function login(g,csrf){return fetch(g.origin+'/api/login',{method:'POST',headers:{Origin:g.origin,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({username:'admin',password})});}
function empty(g,b){assert.equal(g.sessions.size,0);assert.equal(g.retiringSessions.size,0);assert.equal(g.server.listening,false);if(b){assert.equal(b.contexts().length,0);assert.equal(b.isConnected(),false);}}
async function live(g,root){const auth=await authenticate(g.origin,root),api=client(g.origin,auth),s=g.manager? [...g.sessions.values()][0]:null,b=await launchBrowser();s.manager.browserPromise=Promise.resolve(b);assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);const resource=await s.manager.ensure(s.manager.windows.get('notes-lab'));return {auth,api,s,b,resource};}
for(const phase of ['verification','manager-init','enrollment'])test('in-flight '+phase+' cannot publish credentials after shutdown intent',{timeout:15000},async()=>{
 const {root,g}=await fixture(),entered=deferred(),release=deferred(),handled=deferred();let request,shutdown,restore;
 const route=g.app.router.stack.find(layer=>layer.route?.path===(phase==='enrollment'?'/api/enroll':'/api/login')).route.stack.at(-1),handle=route.handle;
 route.handle=async(...args)=>{try{return await handle(...args);}finally{handled.resolve();}};
 try{
  if(phase!=='enrollment')await authenticate(g.origin,root);
  const csrf=await credentials(g);
  if(phase==='verification'){holdVerification={entered,release};request=login(g,csrf);}
  if(phase==='manager-init'){const init=Manager.prototype.init;restore=()=>Manager.prototype.init=init;Manager.prototype.init=async function(){await init.call(this);entered.resolve();await release.promise;};request=login(g,csrf);}
  if(phase==='enrollment'){const enroll=g.accounts.enroll.bind(g.accounts);g.accounts.enroll=async(...args)=>{const user=await enroll(...args);entered.resolve();await release.promise;return user;};const setup=new URL(await readFile(root+'/setup-url.txt','utf8')).hash.slice(1);request=fetch(g.origin+'/api/enroll',{method:'POST',headers:{Origin:g.origin,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({password,setup})});}
  await bounded(entered.promise,'real '+phase+' completion held');shutdown=g.close();assert.equal(g.sessions.size,0,'authority invalidated synchronously');release.resolve();
  // Socket destruction on shutdown is also a safe rejection; never accept a minted cookie.
  const response=await bounded(request.catch(()=>null),'held auth result');if(response){assert.notEqual(response.status,200);assert.equal(response.headers.get('set-cookie'),null);}
  await bounded(handled.promise,'actual auth handler completion');await bounded(shutdown,'shutdown');empty(g);console.log('ADMISSION auth',phase,'no active or retired generation');
 }finally{holdVerification=null;release.resolve();restore?.();if(request)await request.catch(()=>{});if(shutdown)await shutdown.catch(()=>{});await g.close();await rm(root,{recursive:true,force:true});}
});
test('already accepted real page launch is cancelled before late delivery and cannot reopen',{timeout:15000},async()=>{
 const {root,g}=await fixture(),ready=deferred(),delivery=deferred();let b,opening,shutdown;
 try{
  const auth=await authenticate(g.origin,root),api=client(g.origin,auth),s=[...g.sessions.values()][0],m=s.manager;b=await launchBrowser();m.browserPromise=Promise.resolve(b);assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);
  const nc=b.newContext.bind(b);b.newContext=async(...args)=>{const c=await nc(...args),np=c.newPage.bind(c);c.newPage=async(...a)=>{const p=await np(...a);ready.resolve(p);await delivery.promise;return p;};return c;};
  let attachDone;const attach=m.attach.bind(m);m.attach=(...args)=>attachDone=attach(...args);const ws=new WebSocket(g.origin.replace('http','ws')+'/ws/stream/notes-lab',{headers:{cookie:auth.cookie,Origin:g.origin}});ws.on('error',()=>{});
  const page=await bounded(ready.promise,'genuine accepted WS page');opening=attachDone;shutdown=g.close();assert.equal(g.sessions.size,0);await bounded(shutdown,'cancel held page');assert.equal(page.isClosed(),true);empty(g,b);delivery.resolve();await bounded(opening,'late attach settlement');await turn();assert.equal(m.resources.size,0);assert.equal(m.pendingCleanup.size,0);assert.equal(m.opening.size,0);assert.equal(m.closed,true);assert.equal(await m.ensure({id:'notes-lab'}),null);ws.terminate();
 }finally{delivery.resolve();if(opening)await opening.catch(()=>{});if(shutdown)await shutdown.catch(()=>{});if(b)await b.close();await g.close();await rm(root,{recursive:true,force:true});}
});
test('login and upgrade after shutdown intent denied while concurrent closes await real acknowledgement',{timeout:15000},async()=>{
 const {root,g}=await fixture(),ack=deferred(),entered=deferred();let b,real,closing;
 try{
  const v=await live(g,root);b=v.b;const csrf=await credentials(g);real=b.close.bind(b);b.close=async()=>{entered.resolve();await ack.promise;return real();};closing=g.close();const two=g.close();assert.equal(two,closing);assert.equal(g.sessions.size,0);await bounded(entered.promise,'browser ack held');assert.equal(g.retiringSessions.get(v.s.id),v.s);assert.equal(v.resource.page.isClosed(),true);assert.equal(b.isConnected(),true);
  const denied=await login(g,csrf);assert.equal(denied.status,503);assert.equal(denied.headers.get('set-cookie'),null);assert.equal(g.sessions.size,0);
  const status=await bounded(new Promise((resolve,reject)=>{const ws=new WebSocket(g.origin.replace('http','ws')+'/ws/stream/notes-lab',{headers:{cookie:v.auth.cookie,Origin:g.origin}});ws.on('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode);});ws.on('open',()=>{ws.terminate();reject(Error('upgrade admitted after shutdown'));});ws.on('error',()=>{});}), 'upgrade refused');assert.equal(status,503);ack.resolve();await bounded(Promise.all([closing,two]),'coalesced close');empty(g,b);await g.close();empty(g,b);
 }finally{ack.resolve();if(closing)await closing.catch(()=>{});if(real){b.close=real;await real();}await g.close();await rm(root,{recursive:true,force:true});}
});
test('failed close retains live ownership and permanently denies admission through explicit retry',{timeout:15000},async()=>{
 const {root,g}=await fixture(),ack=deferred(),entered=deferred();let b,real,closing;
 try{
  const v=await live(g,root);b=v.b;real=b.close.bind(b);const csrf=await credentials(g);v.resource.context.close=async()=>{throw Error('held real context remains live');};b.close=async()=>{throw Error('rejected browser acknowledgement');};
  const one=g.close(),two=g.close();assert.equal(one,two);const failed=await Promise.allSettled([one,two]);assert.ok(failed.every(r=>r.status==='rejected'&&r.reason.status===503));assert.equal(g.server.listening,false);assert.equal(g.sessions.size,0);assert.equal(g.retiringSessions.get(v.s.id),v.s);assert.equal(v.resource.page.isClosed(),false);assert.equal(b.contexts().length,1);
  // In-process genuine HTTP handlers remain closed too, not just a stopped listener.
  // Temporarily listen on the same owned server solely to probe irreversible admission.
  const oldPort=new URL(g.origin).port;await new Promise(r=>g.server.listen(Number(oldPort),'127.0.0.1',r));const denied=await login(g,csrf);assert.equal(denied.status,503);assert.equal(denied.headers.get('set-cookie'),null);assert.equal(g.sessions.size,0);
  b.close=async()=>{entered.resolve();await ack.promise;return real();};closing=g.close();assert.equal(g.close(),closing);await bounded(entered.promise,'retry ack held');assert.equal(g.retiringSessions.get(v.s.id),v.s);assert.equal(v.resource.page.isClosed(),false);ack.resolve();await bounded(closing,'retry ack');assert.equal(v.resource.page.isClosed(),true);empty(g,b);await g.close();empty(g,b);
 }finally{ack.resolve();if(closing)await closing.catch(()=>{});if(real){b.close=real;await real();}await g.close();await rm(root,{recursive:true,force:true});}
});
test('ordinary shutdown closes actual contexts and repeated close stays closed',{timeout:15000},async()=>{
 const {root,g}=await fixture();let b;
 try{const v=await live(g,root);b=v.b;await g.close();assert.equal(v.resource.page.isClosed(),true);empty(g,b);await g.close();empty(g,b);}finally{if(b)await b.close();await g.close();await rm(root,{recursive:true,force:true});}
});
