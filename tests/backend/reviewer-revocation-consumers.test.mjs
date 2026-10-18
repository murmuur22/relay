import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {launchBrowser} from '../../server/web-browser.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('independent consumer deadline: '+label)),4000))]);}finally{clearTimeout(timer);}}
async function login(g,username='admin',cookie){const info=await(await fetch(g.origin+'/api/auth')).json();return fetch(g.origin+'/api/login',{method:'POST',headers:{Origin:g.origin,'Content-Type':'application/json','X-CSRF-Token':info.csrf,...(cookie?{cookie}:{})},body:JSON.stringify({username,password})});}

for(const action of ['login-replacement','disable','password-reset'])test('independent truthful failure and acknowledged retry for '+action,{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/ind-consumer-'),g=await createGateway({port:0,runtime:root});let b,realClose;const gate=deferred();
 try{
  const auth=await authenticate(g.origin,root),api=client(g.origin,auth);await api('/admin/users','POST',{username:'operator',role:'admin',password});const operator=client(g.origin,await authenticate(g.origin,root,'operator'));
  const s=[...g.sessions.values()].find(x=>x.userId===auth.s.user.id),m=s.manager;b=await launchBrowser();m.browserPromise=Promise.resolve(b);await api('/windows','POST',{appId:'notes-lab'});const resource=await m.ensure(m.windows.get('notes-lab'));realClose=b.close.bind(b);resource.context.close=async()=>{throw Error('independent context rejection');};b.close=async()=>{throw Error('independent browser rejection');};
  const response=await bounded(action==='login-replacement'?login(g,'admin',auth.cookie):operator('/admin/users/'+s.userId,'PATCH',action==='disable'?{disabled:true}:{password:password+'-new'}),'applied mutation');
  assert.equal(response.status,503);assert.equal((await api('/session')).status,401);assert.equal((await operator('/session')).status,200);assert.equal(g.sessions.has(s.id),false);assert.equal(g.retiringSessions.get(s.id),s);assert.equal(m.pendingRetirement.get('notes-lab'),resource);assert.equal(resource.page.isClosed(),false);
  if(action==='login-replacement')assert.equal(response.headers.get('set-cookie'),null,'failed replacement must not mint credentials');
  const failed=await Promise.allSettled([g.close(),g.close()]);assert.ok(failed.every(x=>x.status==='rejected'&&x.reason.status===503));assert.equal(g.retiringSessions.get(s.id),s);
  const entered=deferred();b.close=async()=>{entered.resolve();await gate.promise;return realClose();};const one=g.close(),two=g.close();assert.equal(one,two,'concurrent gateway shutdown coalesces');await bounded(entered.promise,'retry entry');assert.equal(g.retiringSessions.get(s.id),s);assert.equal(resource.page.isClosed(),false);gate.resolve();await bounded(Promise.all([one,two]),'actual ack');assert.equal(g.retiringSessions.size,0);assert.equal(resource.page.isClosed(),true);assert.equal(b.contexts().length,0);assert.equal(b.isConnected(),false);
  console.log('INDEPENDENT consumer',JSON.stringify({action,status:response.status,revoked:true,acknowledged:true}));
 }finally{gate.resolve();if(realClose){b.close=realClose;await realClose();}await g.close();await rm(root,{recursive:true,force:true});}
});

test('global admission includes sixteen real authenticated failed retirements',{timeout:30000},async()=>{
 const root=await mkdtemp(tmpdir()+'/ind-globalbound-'),g=await createGateway({port:0,runtime:root});const restores=[];
 try{
  const adminAuth=await authenticate(g.origin,root),admin=client(g.origin,adminAuth);for(const username of ['one','two','three','overflow'])assert.equal((await admin('/admin/users','POST',{username,password})).status,200);
  const retire=async(auth)=>{const s=[...g.sessions.values()].find(x=>x.userId===auth.s.user.id),old=s.manager.close.bind(s.manager);restores.push(()=>s.manager.close=old);s.manager.close=async()=>{throw Error('independent admission cleanup failure');};assert.equal((await client(g.origin,auth)('/logout','POST',{})).status,503);assert.equal(g.retiringSessions.get(s.id),s);};
  await retire(adminAuth);
  for(const username of ['admin','one','two','three'])for(let n=username==='admin'?1:0;n<4;n++)await retire(await authenticate(g.origin,root,username));
  assert.equal(g.retiringSessions.size,16);assert.equal(g.sessions.size,0);const denied=await login(g,'overflow');assert.equal(denied.status,429);assert.equal(g.retiringSessions.size,16);assert.equal(g.sessions.size,0);
  for(const restore of restores)restore();await g.close();assert.equal(g.retiringSessions.size,0);console.log('INDEPENDENT global bound',JSON.stringify({retained:16,overflowStatus:denied.status,afterAcknowledgement:0}));
 }finally{for(const restore of restores)restore();await g.close();await rm(root,{recursive:true,force:true});}
});

test('disconnection is not substituted for rejected browser.close acknowledgement',{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/ind-disconnect-'),g=await createGateway({port:0,runtime:root});let b,realClose;
 try{
  const auth=await authenticate(g.origin,root),api=client(g.origin,auth),s=[...g.sessions.values()][0];b=await launchBrowser();s.manager.browserPromise=Promise.resolve(b);await api('/windows','POST',{appId:'notes-lab'});const resource=await s.manager.ensure(s.manager.windows.get('notes-lab'));realClose=b.close.bind(b);resource.context.close=async()=>{throw Error('independent context close rejection');};b.close=async()=>{await realClose();throw Error('independent rejected acknowledgement after disconnection');};
  assert.equal((await api('/logout','POST',{})).status,503);assert.equal(b.isConnected(),false);assert.equal(resource.page.isClosed(),true);assert.equal(g.retiringSessions.get(s.id),s);b.close=realClose;await g.close();assert.equal(g.retiringSessions.size,0);
 }finally{if(realClose){b.close=realClose;await realClose();}await g.close();await rm(root,{recursive:true,force:true});}
});

test('shutdown cannot report success while a newly admitted generation keeps a real browser alive',{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/ind-shutdown-generation-'),g=await createGateway({port:0,runtime:root});const browsers=[];const gate=deferred(),entered=deferred();let shutdown,realOldClose;
 try{
  const auth=await authenticate(g.origin,root),api=client(g.origin,auth),old=[...g.sessions.values()][0];const b=await launchBrowser();browsers.push(b);old.manager.browserPromise=Promise.resolve(b);await api('/windows','POST',{appId:'notes-lab'});const oldResource=await old.manager.ensure(old.manager.windows.get('notes-lab'));realOldClose=b.close.bind(b);oldResource.context.close=async()=>{throw Error('independent force browser fallback');};b.close=async()=>{entered.resolve();await gate.promise;return realOldClose();};
  shutdown=g.close();await bounded(entered.promise,'old shutdown pending actual browser ack');assert.equal(g.sessions.size,0);assert.equal(g.retiringSessions.get(old.id),old);
  const replacement=await bounded(login(g),'login during shutdown');let freshResource,freshBrowser;
  if(replacement.status===200){
   const cookie=replacement.headers.get('set-cookie').split(';')[0];const session=await(await fetch(g.origin+'/api/session',{headers:{cookie}})).json();const fresh=[...g.sessions.values()].find(x=>x.id!==old.id);const freshApi=client(g.origin,{cookie,s:session});assert.ok(fresh);assert.equal((await freshApi('/windows','POST',{appId:'notes-lab'})).status,200);freshBrowser=await launchBrowser();browsers.push(freshBrowser);fresh.manager.browserPromise=Promise.resolve(freshBrowser);freshResource=await bounded(fresh.manager.ensure(fresh.manager.windows.get('notes-lab')),'new generation real page');
  }
  gate.resolve();await bounded(shutdown,'shutdown result');console.log('INDEPENDENT shutdown generation',JSON.stringify({loginStatus:replacement.status,activeSessions:g.sessions.size,retiringSessions:g.retiringSessions.size,newPageClosed:freshResource?.page.isClosed(),newBrowserConnected:freshBrowser?.isConnected(),gatewayListening:g.server.listening}));
  assert.notEqual(replacement.status,200,'new authority must not be admitted after shutdown revocation snapshot');assert.equal(g.sessions.size,0);assert.equal(freshBrowser?.isConnected()||false,false,'successful shutdown must not leave a new generation live');
 }finally{gate.resolve();if(shutdown)await shutdown.catch(()=>{});if(realOldClose)browsers[0].close=realOldClose;for(const b of browsers)await b.close();await g.close();await rm(root,{recursive:true,force:true});}
});
