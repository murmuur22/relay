import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {launchBrowser} from '../../server/web-browser.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));
async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('published retirement deadline: '+label)),4000))]);}finally{clearTimeout(timer);}}

test('genuine published DELETE retires active immediately, retains exact failed context, and retries only after acknowledgement',{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/published-retry-'),g=await createGateway({port:0,runtime:root});let browser,restore;
 const entered=deferred(),ack=deferred();let allowClose=false;
 try{
  const api=client(g.origin,await authenticate(g.origin,root)),m=g.manager;browser=await launchBrowser();m.browserPromise=Promise.resolve(browser);
  assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);const w=m.windows.get('notes-lab'),r=await bounded(m.ensure(w),'published resource');
  restore=r.context.close.bind(r.context);r.context.close=async()=>{if(!allowClose)throw Error('injected published context close failure');entered.resolve();await ack.promise;return restore();};
  const response=await bounded(api('/windows/notes-lab','DELETE'),'rejected close');assert.equal(response.status,503);
  assert.equal(m.resources.has(w.id),false,'retired resource is not active');assert.equal(r.disposed,true);assert.equal(m.windows.has(w.id),false);
  assert.equal(m.pendingRetirement.get(w.id),r,'exact resource and context remain owned');assert.equal(browser.contexts().includes(r.context),true);assert.equal(r.page.isClosed(),false);
  assert.equal((await api('/windows','POST',{appId:w.id})).status,503,'pending retirement blocks reopen');
  allowClose=true;let completed=false;const retry=api('/windows/'+w.id,'DELETE').then(x=>{completed=true;return x;});await bounded(entered.promise,'retry entry');await turn();assert.equal(completed,false);assert.equal(m.pendingRetirement.get(w.id),r);assert.equal(r.page.isClosed(),false);
  ack.resolve();assert.equal((await bounded(retry,'ack receipt')).status,200);assert.equal(r.page.isClosed(),true);assert.equal(browser.contexts().length,0);assert.equal(m.pendingRetirement.size,0);
  assert.equal((await api('/windows','POST',{appId:w.id})).status,200);const fresh=await bounded(m.ensure(m.windows.get(w.id)),'fresh resource');assert.notEqual(fresh,r);
  r.cdp.emit('Page.screencastFrame',{sessionId:1,data:'YQ=='});await m.dispose(w.id,r);await turn();assert.equal(m.resources.get(w.id),fresh);assert.equal(fresh.page.isClosed(),false);assert.equal(m.pendingRetirement.size,0);
  assert.equal((await api('/windows/'+w.id,'DELETE')).status,200);
 }finally{ack.resolve();if(restore)await restore();if(browser)await browser.close();await bounded(g.close(),'gateway close');await rm(root,{recursive:true,force:true});}
});

for(const action of ['demotion','logout'])test('published '+action+' retires active ownership before fallible cleanup and retains it until browser acknowledgement',{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/published-revoke-'),g=await createGateway({port:0,runtime:root});let browser,restoreBrowser,mutation;
 const entered=deferred(),ack=deferred();
 try{
  const auth=await authenticate(g.origin,root),api=client(g.origin,auth),m=g.manager;let operator;
  if(action==='demotion'){assert.equal((await api('/admin/users','POST',{username:'operator',role:'admin',password})).status,200);operator=client(g.origin,await authenticate(g.origin,root,'operator'));}
  browser=await launchBrowser();m.browserPromise=Promise.resolve(browser);restoreBrowser=browser.close.bind(browser);browser.close=async()=>{entered.resolve();await ack.promise;return restoreBrowser();};
  assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);const r=await bounded(m.ensure(m.windows.get('notes-lab')),'published resource');r.context.close=async()=>{throw Error('injected published close rejection');};
  mutation=action==='demotion'?operator('/admin/users/'+auth.s.user.id,'PATCH',{role:'user'}):api('/logout','POST',{});
  await bounded(entered.promise,'fallback entry');assert.equal((await api('/session')).status,401);assert.equal(m.closed,true);assert.equal(m.resources.size,0);assert.equal(r.disposed,true);assert.equal(m.pendingRetirement.get('notes-lab'),r);assert.equal(r.page.isClosed(),false);
  if(operator)assert.equal((await operator('/session')).status,200,'unrelated session remains usable');
  ack.resolve();assert.equal((await bounded(mutation,'mutation receipt')).status,200);assert.equal(m.pendingRetirement.size,0);assert.equal(r.page.isClosed(),true);assert.equal(browser.contexts().length,0);
 }finally{ack.resolve();if(mutation)await bounded(mutation.catch(()=>{}),'mutation finalizer');if(restoreBrowser)await restoreBrowser();await bounded(g.close(),'gateway close');await rm(root,{recursive:true,force:true});}
});

test('service removal settles every session even when one published context close fails',{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/published-sessions-'),g=await createGateway({port:0,runtime:root});const browsers=[];
 try{
  const api=client(g.origin,await authenticate(g.origin,root));assert.equal((await api('/admin/users','POST',{username:'operator',role:'admin',password})).status,200);const other=client(g.origin,await authenticate(g.origin,root,'operator'));
  const managers=[...g.sessions.values()].map(s=>s.manager),resources=[];
  for(const [i,request] of [api,other].entries()){const b=await launchBrowser();browsers.push(b);managers[i].browserPromise=Promise.resolve(b);assert.equal((await request('/windows','POST',{appId:'notes-lab'})).status,200);resources.push(await bounded(managers[i].ensure(managers[i].windows.get('notes-lab')),'published session'));}
  resources[0].context.close=async()=>{throw Error('injected first session cleanup failure');};
  assert.equal((await bounded(api('/admin/services/notes-lab','DELETE'),'service removal')).status,503,'incomplete cleanup is reported');
  assert.equal(managers[0].resources.size,0);assert.equal(managers[0].pendingRetirement.get('notes-lab'),resources[0]);assert.equal(resources[0].page.isClosed(),false);
  assert.equal(managers[1].resources.size,0);assert.equal(managers[1].windows.has('notes-lab'),false);assert.equal(resources[1].page.isClosed(),true,'failure must not prevent other-session cleanup');
  assert.equal((await other('/session')).status,200);assert.equal((await api('/logout','POST',{})).status,200);assert.equal(managers[0].pendingRetirement.size,0);assert.equal(resources[0].page.isClosed(),true);
 }finally{for(const b of browsers)await b.close();await bounded(g.close(),'gateway close');await rm(root,{recursive:true,force:true});}
});
