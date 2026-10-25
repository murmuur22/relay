// Real compiled UI, genuine owner authority, held successful production responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';

async function fixture(fn){
 const runtime=await mkdtemp(tmpdir()+'/personal-race-');let g,browser,release;const requests=[],traffic=[],errors=[];let routeDone=Promise.resolve();let serverEventsForTrace=()=>[];const boundary=[];const mark=(event,extra={})=>boundary.push({event,at:Date.now(),...extra});
 const site=http.createServer((req,res)=>{requests.push(req.url);res.setHeader('Content-Type','text/html');res.end('<h1>Personal race fixture</h1><input aria-label="Retained text">');});
 await new Promise(r=>site.listen(0,'127.0.0.1',r));
 try{
  g=await createGateway({port:0,runtime,profile:'standalone'});const serverEvents=[];serverEventsForTrace=()=>serverEvents.flatMap(r=>[{event:'server-arrival',at:r.at,url:r.url,method:r.method,remotePort:r.remotePort},...(r.finished?[{event:'server-response-finish',at:r.finished,url:r.url,method:r.method,status:r.status,remotePort:r.remotePort}]:[])]);g.server.on('request',(req,res)=>{const row={url:req.originalUrl||req.url,method:req.method,at:Date.now(),ended:false,remotePort:req.socket.remotePort};serverEvents.push(row);res.on('finish',()=>{row.ended=true;row.status=res.statusCode;row.finished=Date.now();});});
  const admin=client(g.origin,await authenticate(g.origin,runtime));await admin('/onboarding/complete','POST',{});await admin('/admin/users','POST',{username:'owner',password});
  const auth=await authenticate(g.origin,runtime,'owner'),api=client(g.origin,auth);await api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false,showAppStatus:false});
  const address='http://localhost:'+site.address().port;
  const created=await(await api('/desktop/bookmarks','POST',{parentId:null,label:'Race app',url:address+'/before',openMode:'window'})).json();const item=created.items.find(i=>i.appId===created.createdAppId);
  browser=await chromium.launch({headless:true,chromiumSandbox:true});const context=await browser.newContext({reducedMotion:'reduce'});const [name,value]=auth.cookie.split('=');await context.addCookies([{name,value,url:g.origin,httpOnly:true,sameSite:'Strict'}]);const page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>traffic.push({url:r.url(),method:r.method()}));
 const inflight=new Set(),events=[];page.on('request',r=>{if(r.url().includes('/api/'))inflight.add(r);});page.on('requestfinished',r=>inflight.delete(r));page.on('requestfailed',r=>{inflight.delete(r);events.push({kind:'requestfailed',url:r.url(),error:r.failure()});});page.on('console',m=>events.push({kind:'console',type:m.type(),text:m.text()}));page.on('pageerror',e=>events.push({kind:'pageerror',text:e.message}));page.on('framenavigated',f=>events.push({kind:'framenavigated',url:f.url()}));
 const originalWait=page.waitForFunction.bind(page);page.waitForFunction=async(...args)=>{try{const value=await originalWait(...args);console.log('DIAG-SETTLED '+JSON.stringify({serverEvents,fetches:await page.evaluate(()=>window.__diagRequests),frames:await page.locator('iframe').count()}));return value;}catch(e){console.log('DIAG-TIMEOUT '+JSON.stringify({predicate:String(args[0]),protocol:globalThis.__relayProtocol,serverEvents,fetches:await page.evaluate(()=>window.__diagRequests),inflight:[...inflight].map(r=>({url:r.url(),method:r.method()})),events,errors,dom:await page.evaluate(()=>({url:location.href,ready:document.readyState,visibility:document.visibilityState,buttons:[...document.querySelectorAll('button')].map(b=>({label:b.getAttribute('aria-label'),disabled:b.disabled})),frames:[...document.querySelectorAll('iframe')].map(f=>({title:f.title,src:f.src})),alerts:[...document.querySelectorAll('[role=alert]')].map(x=>x.textContent)})),session:await(await api('/session')).json().then(s=>({apps:s.apps,windows:s.windows})),server:[...g.sessions.values()].map(s=>({windows:[...s.manager.windows.values()]}))}));throw e;}};

 await page.addInitScript(()=>{const original=window.fetch;window.__diagRequests=[];window.fetch=async(...args)=>{const path=String(args[0]);const entry={path,started:performance.now(),at:Date.now(),history:[{event:'client-fetch-start',at:Date.now()}],state:'fetch'};window.__diagRequests.push(entry);const response=await original(...args);entry.state='headers';entry.history.push({event:'client-fetch-headers',at:Date.now()});const json=response.json.bind(response);response.json=async()=>{entry.state='json';const result=await json();const schedule=window.__diagSchedule;if(schedule&&path===schedule.path&&!schedule.used){schedule.used=true;entry.state='held-json';entry.history.push({event:'client-json-barrier',at:Date.now()});await new Promise(r=>setTimeout(r,schedule.delay));}entry.state='consumed';entry.history.push({event:'client-json-consumed',at:Date.now()});return result;};return response;};});
await page.goto(g.origin);await expect(page.getByRole('button',{name:'Open Race app',exact:true})).toBeVisible();
  async function hold(){let observed;const ready=new Promise(r=>observed=r),held=new Promise(r=>release=r);let done;routeDone=new Promise(r=>done=r);let once=false;
   mark('route-start');await page.route('**/api/windows',async route=>{if(once||route.request().method()!=='POST'){await route.continue();return;}once=true;try{const response=await route.fetch();assert.equal(response.status(),200);const body=await response.json();assert.equal(body.url,address+'/before');observed(body);await held;mark('fulfill-start');await route.fulfill({response});mark('fulfill-ack');}finally{done();}});mark('route-ack');
   await page.getByRole('button',{name:'Open Race app',exact:true}).dblclick();const old=await ready;await page.evaluate(schedule=>window.__diagSchedule=schedule,{path:process.env.DIAG_PATH||'/api/desktop',delay:Number(process.env.DIAG_DELAY||100)});return old;
  }
  async function settle(){const next=process.env.DIAG_UNROUTE==='request-boundary'?page.waitForRequest(r=>r.url()===g.origin+'/api/session'):Promise.resolve();mark('release');release();await routeDone;mark('route-handler-done');await next;if(process.env.DIAG_UNROUTE!=='retain'){mark('unroute-start');await page.unroute('**/api/windows');mark('unroute-ack');}else mark('unroute-retained');
   // Browser-side fetch consumption plus a bounded negative observation window.
   await page.waitForFunction(()=>document.querySelector('iframe[title="Race app"]')||!document.querySelector('[aria-label="Open Race app"]:disabled'));
   console.log(JSON.stringify({observation:'parallel-ABA-settlement',oldRequests:requests.filter(x=>x==='/before').length,oldFrames:await page.locator('iframe[src="'+address+'/before"]').count()}));
   await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,300)));
  }
  async function edit(changes){await page.getByRole('button',{name:'Actions for Race app',exact:true}).click();await page.getByRole('menuitem',{name:'Edit',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit personal app',exact:true});if(changes.url)await dialog.getByLabel('URL',{exact:true}).fill(changes.url);if(changes.openMode)await dialog.getByRole('combobox',{name:'Open in',exact:true}).selectOption(changes.openMode);await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);}
  async function noOld(){await expect(page.locator('iframe[src="'+address+'/before"]'),'retired old URL must not reappear').toHaveCount(0);assert.equal(traffic.some(r=>r.url===address+'/before'),false,'no old URL browser request');assert.equal(requests.includes('/before'),false,'no old URL upstream traffic');}
  await fn({g,runtime,admin,auth,api,item,page,context,address,requests,traffic,hold,settle,edit,noOld});assert.deepEqual(errors,[]);
 }finally{if(browser){const pages=browser.contexts().flatMap(c=>c.pages());const page=pages[0];try{const fetches=await page.evaluate(()=>window.__diagRequests);const trace=[...boundary,...(globalThis.__relayProtocol||[]),...serverEventsForTrace(),...fetches.flatMap(f=>f.history.map(h=>({...h,path:f.path})))].sort((a,b)=>a.at-b.at);console.log('BOUNDARY-TRACE '+JSON.stringify({mode:process.env.DIAG_UNROUTE,trace,fetches,frames:await page.locator('iframe').count(),errors}));}catch(e){console.log('BOUNDARY-TRACE-ERROR '+e.message);}}release?.();await routeDone.catch(()=>{});await browser?.close();await g?.close();site.closeAllConnections();await new Promise(r=>site.close(r));await rm(runtime,{recursive:true,force:true});}
}

for(const kind of ['url','mode','both'])test('unobserved parallel-owner '+kind+' ABA cannot admit the retired original launch',{timeout:25000},()=>fixture(async({g,runtime,api,item,page,context,address,hold,settle,noOld})=>{
 const old=await hold();const parallel=client(g.origin,await authenticate(g.origin,runtime,'owner'));
 const away={...(kind!=='mode'?{url:address+'/after'}:{}),...(kind!=='url'?{openMode:'tab'}:{})};
 const back={...(kind!=='mode'?{url:address+'/before'}:{}),...(kind!=='url'?{openMode:'window'}:{})};
 assert.equal((await parallel('/desktop/items/'+item.id,'PATCH',away)).status,200);
 assert.equal((await parallel('/desktop/items/'+item.id,'PATCH',back)).status,200);
 assert.equal((await(await api('/session')).json()).windows.some(w=>w.appId===item.appId),false,'original server window retired across both edits');
 await settle();await noOld();assert.equal(context.pages().length,1);
 await page.getByRole('button',{name:'Open Race app',exact:true}).dblclick();
 await expect(page.frameLocator('iframe[title="Race app"]').getByRole('heading',{name:'Personal race fixture'})).toBeVisible();
 const fresh=(await(await api('/session')).json()).windows.find(w=>w.appId===item.appId);assert.notEqual(fresh.personalLaunchId,old.personalLaunchId,'fresh reopen uses new server window identity');
}));

test('final server observation catches an ABA after refresh session observation but before desktop delivery',{timeout:25000},()=>fixture(async({g,runtime,api,item,page,address,hold,settle,noOld})=>{
 await hold();const parallel=client(g.origin,await authenticate(g.origin,runtime,'owner'));let once=false;
 await page.route('**/api/desktop',async route=>{if(once){await route.continue();return;}once=true;const response=await route.fetch();assert.equal(response.status(),200);
  assert.equal((await parallel('/desktop/items/'+item.id,'PATCH',{url:address+'/after'})).status,200);
  assert.equal((await parallel('/desktop/items/'+item.id,'PATCH',{url:address+'/before'})).status,200);
  await route.fulfill({response});
 });
 await settle();await noOld();assert.equal(once,true);assert.equal((await(await api('/session')).json()).windows.some(w=>w.appId===item.appId),false);
}));

test('remove and recreate at the same URL never adopts the removed personal identity',{timeout:25000},()=>fixture(async({api,item,page,address,hold,settle,noOld})=>{
 await hold();assert.equal((await api('/desktop/items/'+item.id,'DELETE')).status,200);
 const replacement=await(await api('/desktop/bookmarks','POST',{parentId:null,label:'Replacement',url:address+'/before',openMode:'window'})).json();assert.notEqual(replacement.createdAppId,item.appId);
 await settle();await noOld();await page.getByRole('button',{name:'Open Replacement',exact:true}).dblclick();
 await expect(page.frameLocator('iframe[title="Replacement"]').getByRole('heading',{name:'Personal race fixture'})).toBeVisible();
 const current=(await(await api('/session')).json()).windows;assert.equal(current.some(w=>w.appId===item.appId),false);assert.equal(current.some(w=>w.appId===replacement.createdAppId),true);
}));

test('write saturation refuses stale admission without losing cleanup ownership',{timeout:25000},()=>fixture(async({g,api,auth,item,page,address,hold,settle,noOld})=>{
 await hold();assert.equal((await api('/desktop/items/'+item.id,'PATCH',{url:address+'/after'})).status,200);
 let unblock,entered;const started=new Promise(r=>entered=r),block=new Promise(r=>unblock=r),original=g.accounts.preferences.bind(g.accounts);let once=false;
 g.accounts.preferences=async(...args)=>{if(!once){once=true;entered();await block;}return original(...args);};
 let count=0,arrived,timer;const ready=new Promise((resolve,reject)=>{arrived=resolve;timer=setTimeout(()=>reject(Error('saturation request-arrival timeout')),4000);}),listener=req=>{if((req.originalUrl||req.url)==='/api/preferences'&&req.method==='PATCH'&&++count===32)arrived();};g.server.on('request',listener);
 const pending=[];
 try{
  pending.push(api('/preferences','PATCH',{showAppStatus:false}));await started;
  for(let n=0;n<31;n++)pending.push(api('/preferences','PATCH',{showAppStatus:false}));await ready;
  assert.equal((await api('/preferences','PATCH',{showAppStatus:false})).status,429,'real bounded write queue saturated');
  const failedCleanup=page.waitForResponse(r=>r.url().endsWith('/retire-personal-launch')&&r.status()===429);
  await settle();await failedCleanup;await noOld();
  const manager=[...g.sessions.values()].find(s=>s.csrf===auth.s.csrf).manager;assert.equal(manager.windows.has(item.appId),false);
 }finally{clearTimeout(timer);g.server.off('request',listener);unblock();await Promise.all(pending);}
 await page.getByRole('button',{name:'Open Race app',exact:true}).dblclick();await expect(page.locator('iframe[title="Race app"]')).toHaveAttribute('src',address+'/after');
}));
