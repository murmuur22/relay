import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {launchBrowser} from '../../server/web-browser.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));
async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('closure regression deadline: '+label)),4000))]);}finally{clearTimeout(timer);}}

for(const late of ['fulfill','reject'])test('genuine DELETE retains rejected closure ownership and retries acknowledged cleanup; late page '+late,{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/cancel-retry-'),g=await createGateway({port:0,runtime:root});let browser,restore,opening,context;
 const pageReady=deferred(),delivery=deferred(),lateDelivered=deferred(),closeEntered=deferred(),closeAck=deferred();let allowClose=false,contextCalls=0;
 try{
  const api=client(g.origin,await authenticate(g.origin,root)),m=g.manager;browser=await launchBrowser();m.browserPromise=Promise.resolve(browser);
  const nc=browser.newContext.bind(browser);
  // Inject only into the cancelled creation, not the fresh same-ID reopen.
  browser.newContext=async(...args)=>{const c=await nc(...args);if(++contextCalls!==1)return c;context=c;restore=context.close.bind(context);context.close=async()=>{if(!allowClose)throw Error('injected rejected close; real context remains live');closeEntered.resolve();await closeAck.promise;return restore();};const np=context.newPage.bind(context);context.newPage=async(...args)=>{const page=await np(...args);pageReady.resolve(page);await delivery.promise;lateDelivered.resolve(late);if(late==='reject')throw Error('late page rejection');return page;};return context;};
  assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);
  opening=m.ensure(m.windows.get('notes-lab'));const rejected=assert.rejects(opening);const page=await bounded(pageReady.promise,'real page');
  const response=await bounded(api('/windows/notes-lab','DELETE'),'failed DELETE');await bounded(rejected,'creation rejection');
  assert.notEqual(response.status,200,'failed closure cannot be acknowledged');
  assert.equal(response.status,503,'cleanup failure has a retryable server result');
  assert.equal(m.windows.size,0,'authority is retired immediately');assert.equal(m.resources.size,0,'failed creation is never published');
  assert.equal(m.pendingCleanup.size,1,'manager retains context ownership');assert.equal(browser.contexts().length,1);assert.equal(page.isClosed(),false);
  assert.notEqual((await api('/windows','POST',{appId:'notes-lab'})).status,200,'reopen must not bypass pending cleanup');
  delivery.resolve();assert.equal(await bounded(lateDelivered.promise,'late page outcome'),late);await turn();await turn();assert.equal(m.resources.size,0);assert.equal(m.pendingCleanup.size,1);
  allowClose=true;let completed=false;const retry=api('/windows/notes-lab','DELETE').then(r=>{completed=true;return r;});
  await bounded(closeEntered.promise,'retry close');await turn();assert.equal(completed,false,'retry waits for actual close acknowledgement');assert.equal(page.isClosed(),false);assert.equal(m.pendingCleanup.size,1);
  closeAck.resolve();assert.equal((await bounded(retry,'retry receipt')).status,200);
  assert.equal(page.isClosed(),true);assert.equal(browser.contexts().length,0);assert.equal(m.pendingCleanup.size,0);assert.equal(m.opening.size,0);assert.equal(m.creations.size,0);
  assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);const fresh=await bounded(m.ensure(m.windows.get('notes-lab')),'fresh creation');assert.ok(fresh);assert.equal(fresh.page.isClosed(),false);assert.equal((await api('/windows/notes-lab','DELETE')).status,200);
  console.log('CLOSURE retry verified',JSON.stringify({late,initialStatus:response.status,retryStatus:200,contexts:browser.contexts().length,pending:m.pendingCleanup.size}));
 }finally{delivery.resolve();closeAck.resolve();if(restore)await restore();if(browser)await browser.close();if(opening)await opening.catch(()=>{});await bounded(g.close(),'gateway finalizer');await rm(root,{recursive:true,force:true});}
});

for(const action of ['demotion','logout'])test('genuine '+action+' revokes authority before fallible context cleanup and browser fallback acknowledgement',{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/cancel-revoke-'),g=await createGateway({port:0,runtime:root});let browser,restoreBrowser,restoreContext,opening,mutation;
 const pageReady=deferred(),delivery=deferred(),fallbackEntered=deferred(),fallbackAck=deferred();
 try{
  const auth=await authenticate(g.origin,root),api=client(g.origin,auth),m=g.manager;
  let operator;if(action==='demotion'){assert.equal((await api('/admin/users','POST',{username:'operator',role:'admin',password})).status,200);operator=client(g.origin,await authenticate(g.origin,root,'operator'));}
  browser=await launchBrowser();m.browserPromise=Promise.resolve(browser);restoreBrowser=browser.close.bind(browser);browser.close=async()=>{fallbackEntered.resolve();await fallbackAck.promise;return restoreBrowser();};const nc=browser.newContext.bind(browser);
  browser.newContext=async(...args)=>{const c=await nc(...args);restoreContext=c.close.bind(c);c.close=async()=>{throw Error('injected context close rejection');};const np=c.newPage.bind(c);c.newPage=async(...args)=>{const page=await np(...args);pageReady.resolve(page);await delivery.promise;return page;};return c;};
  assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);opening=m.ensure(m.windows.get('notes-lab'));const rejected=assert.rejects(opening);const page=await bounded(pageReady.promise,'real page');
  mutation=action==='demotion'?operator('/admin/users/'+auth.s.user.id,'PATCH',{role:'user'}):api('/logout','POST',{});
  await bounded(fallbackEntered.promise,'browser fallback entry');assert.equal((await api('/session')).status,401,'original authority is already revoked');assert.equal(m.closed,true);assert.equal(m.windows.size,0);assert.equal(m.resources.size,0);assert.equal(m.pendingCleanup.size,1);assert.equal(page.isClosed(),false);
  fallbackAck.resolve();assert.equal((await bounded(mutation,'revocation receipt')).status,200);await rejected;
  assert.equal(page.isClosed(),true);assert.equal(browser.contexts().length,0);assert.equal(m.pendingCleanup.size,0);delivery.resolve();await turn();assert.equal(m.resources.size,0);
  console.log('CLOSURE revocation verified',JSON.stringify({action,revokedBeforeAck:true,contexts:browser.contexts().length,pending:m.pendingCleanup.size}));
 }finally{delivery.resolve();fallbackAck.resolve();if(mutation)await bounded(mutation.catch(()=>{}),'pending mutation finalizer');if(restoreBrowser)await bounded(restoreBrowser(),'browser finalizer');if(opening)await bounded(opening.catch(()=>{}),'opening finalizer');await bounded(g.close(),'gateway finalizer');await rm(root,{recursive:true,force:true});}
});
