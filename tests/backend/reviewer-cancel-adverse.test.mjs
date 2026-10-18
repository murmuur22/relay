import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Manager} from '../../server/streams.mjs';
import {launchBrowser} from '../../server/web-browser.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client} from '../auth-helper.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const turn=()=>new Promise(r=>setImmediate(r));
async function bounded(p,label){let t;try{return await Promise.race([p,new Promise((_,rej)=>t=setTimeout(()=>rej(Error('review deadline: '+label)),4000))]);}finally{clearTimeout(t);}}
async function fixture(fn){const root=await mkdtemp(tmpdir()+'/review-adverse-'),browser=await launchBrowser(),m=new Manager(root,[{id:'notes-lab',label:'Notes',mode:'stream'}]);m.browserPromise=Promise.resolve(browser);try{await fn(m,browser);}finally{await browser.close();await m.close().catch(()=>{});await rm(root,{recursive:true,force:true});}}

for(const phase of ['acquisition','newContext','newPage','newCDPSession','Page.enable'])test('real Chromium rejection during '+phase+' leaves no context or publication',{timeout:15000},()=>fixture(async(m,b)=>{
 const gate=deferred(),entered=deferred(),error=Error('review injected '+phase+' rejection');let calls=0;
 if(phase==='acquisition'){m.browserPromise=gate.promise;entered.resolve();}else{
  const nc=b.newContext.bind(b);b.newContext=async(...a)=>{
   calls++;if(phase==='newContext'){entered.resolve();return gate.promise;}
   const c=await nc(...a);
   if(phase==='newPage')c.newPage=()=>{entered.resolve();return gate.promise;};
   else if(phase==='newCDPSession')c.newCDPSession=()=>{entered.resolve();return gate.promise;};
   else {const old=c.newCDPSession.bind(c);c.newCDPSession=async(...args)=>{const d=await old(...args),send=d.send.bind(d);d.send=(method,...args)=>method==='Page.enable'?(entered.resolve(),gate.promise):send(method,...args);return d;};}
   return c;
  };
 }
 const w=await m.open('notes-lab'),opening=m.ensure(w);const rejected=assert.rejects(opening,e=>e===error);await bounded(entered.promise,'phase entry');
 const removing=m.remove(w.id);gate.reject(error);await bounded(Promise.all([rejected,removing]),'rejection cleanup');
 assert.equal(m.resources.size,0);assert.equal(m.opening.size,0);assert.equal(b.contexts().length,0);
 if(phase==='acquisition'){assert.equal(calls,0);m.browserPromise=Promise.resolve(b);}
}));

for(const phase of ['acquisition','newContext'])test('cancel while real '+phase+' is delayed closes only after acquisition is owned',{timeout:15000},()=>fixture(async(m,b)=>{
 const gate=deferred(),entered=deferred();const nc=b.newContext.bind(b);let calls=0;
 if(phase==='acquisition')m.browserPromise=gate.promise;
 b.newContext=async(...a)=>{calls++;const c=await nc(...a);if(phase==='newContext'){entered.resolve();await gate.promise;}return c;};
 const w=await m.open('notes-lab'),opening=m.ensure(w),rejected=assert.rejects(opening);
 if(phase==='newContext')await bounded(entered.promise,'real context created');
 let done=false;const removing=m.remove(w.id).then(()=>done=true);await turn();assert.equal(done,false);
 gate.resolve(phase==='acquisition'?b:undefined);await bounded(Promise.all([rejected,removing]),'cancel acquisition');
 if(phase==='acquisition')assert.equal(calls,0);assert.equal(b.contexts().length,0);assert.equal(m.resources.size,0);
}));

test('delayed real context.close is not reported complete before acknowledgement',{timeout:15000},()=>fixture(async(m,b)=>{
 const began=deferred(),release=deferred(),closing=deferred();const nc=b.newContext.bind(b);let originalClose;
 b.newContext=async(...a)=>{const c=await nc(...a);originalClose=c.close.bind(c);c.close=async()=>{closing.resolve();await release.promise;await originalClose();console.log('REVIEW real context.close acknowledged');};const np=c.newPage.bind(c);c.newPage=(...args)=>{const p=np(...args);began.resolve();return p;};return c;};
 const w=await m.open('notes-lab'),opening=m.ensure(w),rejected=assert.rejects(opening);await bounded(began.promise,'page call');
 let done=false;const removing=m.remove(w.id).then(()=>done=true);await bounded(closing.promise,'close entered');await turn();assert.equal(done,false);assert.equal(b.contexts().length,1);
 release.resolve();await bounded(Promise.all([rejected,removing]),'ack cleanup');assert.equal(b.contexts().length,0);assert.equal(m.resources.size,0);
}));

for(const late of ['fulfill','reject'])test('late newPage '+late+' cannot publish into a same-ID reopened real stream',{timeout:15000},()=>fixture(async(m,b)=>{
 const pageReady=deferred(),release=deferred();const nc=b.newContext.bind(b);let first=true;
 b.newContext=async(...a)=>{const c=await nc(...a);if(first){first=false;const np=c.newPage.bind(c);c.newPage=async(...args)=>{const page=await np(...args);pageReady.resolve(page);await release.promise;if(late==='reject')throw Error('review late newPage rejection');return page;};}return c;};
 const w=await m.open('notes-lab'),opening=m.ensure(w),rejected=assert.rejects(opening);const oldPage=await bounded(pageReady.promise,'actual page ready');
 await bounded(m.remove(w.id),'cancel held delivery');await rejected;assert.equal(oldPage.isClosed(),true);assert.equal(b.contexts().length,0);
 const fresh=await m.open(w.id),r=await bounded(m.ensure(fresh),'fresh real creation');assert.ok(r);assert.notEqual(fresh,w);
 release.resolve();await turn();await turn();assert.equal(m.resources.get(w.id),r);assert.equal(b.contexts().length,1);assert.equal(r.page.isClosed(),false);await m.remove(w.id);
}));

test('genuine authenticated DELETE must not acknowledge cleanup when context.close rejects',{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/review-close-reject-'),g=await createGateway({port:0,runtime:root});let browser,restore,opening;
 try{
  const auth=await authenticate(g.origin,root),api=client(g.origin,auth),m=g.manager;browser=await launchBrowser();m.browserPromise=Promise.resolve(browser);
  const pageReady=deferred(),release=deferred(),nc=browser.newContext.bind(browser);let context;
  browser.newContext=async(...a)=>{context=await nc(...a);restore=context.close.bind(context);context.close=async()=>{console.log('REVIEW context.close rejected; no underlying close sent');throw Error('review injected context.close failure');};const np=context.newPage.bind(context);context.newPage=async(...args)=>{const page=await np(...args);pageReady.resolve(page);await release.promise;return page;};return context;};
  assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);opening=m.ensure(m.windows.get('notes-lab'));const rejected=assert.rejects(opening);await bounded(pageReady.promise,'actual page');
  const response=await bounded(api('/windows/notes-lab','DELETE'),'genuine DELETE response');await rejected;
  console.log('REVIEW rejected-close receipt',JSON.stringify({httpStatus:response.status,liveContexts:browser.contexts().length,pageClosed:context.pages()[0]?.isClosed(),resources:m.resources.size,opening:m.opening.size,creations:m.creations.size}));
  // Keep the expected invariant; this is a product-finding probe, not a green detector.
  assert.notEqual(response.status,200,'failed context closure must not be acknowledged as successful cleanup');
 }finally{if(restore)await restore();if(browser)await browser.close();if(opening)await opening.catch(()=>{});await g.close();await rm(root,{recursive:true,force:true});}
});
