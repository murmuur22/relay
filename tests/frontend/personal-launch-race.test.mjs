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
 const runtime=await mkdtemp(tmpdir()+'/personal-race-');let g,browser,release;const requests=[],traffic=[],errors=[];let routeDone=Promise.resolve();
 const site=http.createServer((req,res)=>{requests.push(req.url);res.setHeader('Content-Type','text/html');res.end('<h1>Personal race fixture</h1><input aria-label="Retained text">');});
 await new Promise(r=>site.listen(0,'127.0.0.1',r));
 try{
  g=await createGateway({port:0,runtime,profile:'standalone'});
  const admin=client(g.origin,await authenticate(g.origin,runtime));await admin('/onboarding/complete','POST',{});await admin('/admin/users','POST',{username:'owner',password});
  const auth=await authenticate(g.origin,runtime,'owner'),api=client(g.origin,auth);await api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false,showAppStatus:false});
  const address='http://localhost:'+site.address().port;
  const created=await(await api('/desktop/bookmarks','POST',{parentId:null,label:'Race app',url:address+'/before',openMode:'window'})).json();const item=created.items.find(i=>i.appId===created.createdAppId);
  browser=await chromium.launch({headless:true,chromiumSandbox:true});const context=await browser.newContext({reducedMotion:'reduce'});const [name,value]=auth.cookie.split('=');await context.addCookies([{name,value,url:g.origin,httpOnly:true,sameSite:'Strict'}]);const page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>traffic.push({url:r.url(),method:r.method()}));await page.goto(g.origin);await expect(page.getByRole('button',{name:'Open Race app',exact:true})).toBeVisible();
  async function hold(){let observed;const ready=new Promise(r=>observed=r),held=new Promise(r=>release=r);let done;routeDone=new Promise(r=>done=r);let once=false;
   await page.route('**/api/windows',async route=>{if(once||route.request().method()!=='POST'){await route.continue();return;}once=true;try{const response=await route.fetch();assert.equal(response.status(),200);const body=await response.json();assert.equal(body.url,address+'/before');observed(body);await held;await route.fulfill({response});}finally{done();}});
   await page.getByRole('button',{name:'Open Race app',exact:true}).dblclick();return ready;
  }
  async function settle(){release();await routeDone;await page.unrouteAll({behavior:'wait'});
   // Browser-side fetch consumption plus a bounded negative observation window.
   await page.waitForFunction(()=>!document.querySelector('[aria-label="Open Race app"]:disabled'));
   await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,300)));
  }
  async function edit(changes){await page.getByRole('button',{name:'Actions for Race app',exact:true}).click();await page.getByRole('menuitem',{name:'Edit',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit personal app',exact:true});if(changes.url)await dialog.getByLabel('URL',{exact:true}).fill(changes.url);if(changes.openMode)await dialog.getByRole('combobox',{name:'Open in',exact:true}).selectOption(changes.openMode);await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);}
  async function noOld(){await expect(page.locator('iframe[src="'+address+'/before"]'),'retired old URL must not reappear').toHaveCount(0);assert.equal(traffic.some(r=>r.url===address+'/before'),false,'no old URL browser request');assert.equal(requests.includes('/before'),false,'no old URL upstream traffic');}
  await fn({g,runtime,admin,auth,api,item,page,context,address,requests,traffic,hold,settle,edit,noOld});assert.deepEqual(errors,[]);
 }finally{release?.();await routeDone.catch(()=>{});await browser?.close();await g?.close();site.closeAllConnections();await new Promise(r=>site.close(r));await rm(runtime,{recursive:true,force:true});}
}

test('held successful personal Native response cannot resurrect a URL retired by genuine UI save',{timeout:25000},()=>fixture(async({api,item,page,address,hold,edit,settle,noOld})=>{
 await hold();await edit({url:address+'/after'});const s=await(await api('/session')).json();assert.equal(s.windows.some(w=>w.appId===item.appId),false);assert.equal(s.apps.find(a=>a.id===item.appId).url,address+'/after');await settle();await noOld();
 await page.getByRole('button',{name:'Open Race app',exact:true}).dblclick();await expect(page.frameLocator('iframe[title="Race app"]').getByRole('heading',{name:'Personal race fixture'})).toBeVisible();await expect(page.locator('iframe[title="Race app"]')).toHaveAttribute('src',address+'/after');
}));

for(const change of ['mode','parallel-url','parallel-mode'])test('late personal launch validates current definition after '+change,{timeout:25000},()=>fixture(async({g,runtime,api,item,page,context,address,hold,edit,settle,noOld})=>{
 await hold();const mode=change.includes('mode');
 if(change==='mode')await edit({openMode:'tab'});
 else{const parallel=client(g.origin,await authenticate(g.origin,runtime,'owner'));assert.equal((await parallel('/desktop/items/'+item.id,'PATCH',mode?{openMode:'tab'}:{url:address+'/after'})).status,200);}
 const s=await(await api('/session')).json();assert.equal(s.windows.some(w=>w.appId===item.appId),false);assert.equal(s.apps.find(a=>a.id===item.appId)[mode?'openMode':'url'],mode?'tab':address+'/after');
 await settle();await noOld();assert.equal(context.pages().length,1,'neither save nor late response opens tabs');assert.equal((await(await api('/session')).json()).windows.some(w=>w.appId===item.appId),false);
 if(mode){const popupReady=page.waitForEvent('popup');await page.getByRole('button',{name:'Open Race app',exact:true}).dblclick();const popup=await popupReady;await expect(popup.getByRole('heading',{name:'Personal race fixture'})).toBeVisible();assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();}
}));

test('same-owner reopen of the new generation wins over the held old success',{timeout:25000},()=>fixture(async({api,item,page,address,hold,edit,settle,noOld})=>{
 await hold();await edit({url:address+'/after'});await page.getByRole('button',{name:'Open Race app',exact:true}).dblclick();const frame=page.frameLocator('iframe[title="Race app"]');await expect(frame.getByRole('heading',{name:'Personal race fixture'})).toBeVisible();await frame.getByLabel('Retained text').fill('new generation retained');await settle();await noOld();await expect(frame.getByLabel('Retained text')).toHaveValue('new generation retained');assert.equal((await(await api('/session')).json()).windows.find(w=>w.appId===item.appId).url,address+'/after');
}));

test('observed personal definition generation rejects a URL changed away and back',{timeout:25000},()=>fixture(async({api,item,address,hold,edit,settle,noOld})=>{
 await hold();await edit({url:address+'/after'});await edit({url:address+'/before'});assert.equal((await(await api('/session')).json()).windows.some(w=>w.appId===item.appId),false);await settle();await noOld();assert.equal((await(await api('/session')).json()).windows.some(w=>w.appId===item.appId),false);
}));

for(const change of ['folder','appearance','other-app'])test('unrelated '+change+' edit does not discard a legitimate pending Native launch',{timeout:25000},()=>fixture(async({api,page,address,hold,settle})=>{
 await hold();if(change==='folder'){await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'New folder',exact:true}).click();await page.getByLabel('Folder name',{exact:true}).fill('Unrelated folder');await page.getByRole('button',{name:'Create folder',exact:true}).click();await expect(page.getByRole('button',{name:'Open Unrelated folder',exact:true})).toBeVisible();}
 else{const d=await(await api('/desktop')).json(),item=d.items.find(i=>i.label==='Race app');if(change==='appearance')assert.equal((await api('/desktop/items/'+item.id,'PATCH',{label:'Race app',icon:{type:'builtin',name:'pixel-bookmark'}})).status,200);else{const other=await(await api('/desktop/bookmarks','POST',{parentId:null,label:'Other app',url:address+'/other'})).json();const target=other.items.find(i=>i.appId===other.createdAppId);assert.equal((await api('/desktop/items/'+target.id,'PATCH',{url:address+'/other-edited'})).status,200);}}
 await settle();await expect(page.frameLocator('iframe[title="Race app"]').getByRole('heading',{name:'Personal race fixture'})).toBeVisible();
}));

test('removed personal identity retires only the original late-created server window',{timeout:25000},()=>fixture(async({g,api,auth,item,page,hold,settle,noOld})=>{
 const launch=await hold();assert.match(launch.personalLaunchId,/^[a-f0-9]{64}$/);assert.equal((await api('/desktop/items/'+item.id,'DELETE')).status,200);const manager=[...g.sessions.values()].find(s=>s.csrf===auth.s.csrf).manager;assert.equal(manager.windows.has(item.appId),true);
 const cleaned=page.waitForResponse(r=>r.url().endsWith('/retire-personal-launch')&&r.request().method()==='POST');await settle();assert.deepEqual(await(await cleaned).json(),{retired:true});await noOld();assert.equal(manager.windows.has(item.appId),false);
}));

for(const action of ['logout','revocation','same-owner-cookie','other-owner-cookie'])test('held personal success stays retired after '+action,{timeout:25000},()=>fixture(async({g,runtime,admin,api,auth,item,page,context,traffic,hold,settle,noOld})=>{
 await hold();if(action==='logout'){await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByLabel('username',{exact:true})).toBeVisible();}
 else if(action==='revocation'){assert.equal((await admin('/admin/users/'+auth.s.user.id,'PATCH',{disabled:true})).status,200);}
 else{if(action==='other-owner-cookie')await admin('/admin/users','POST',{username:'other',password});const next=await authenticate(g.origin,runtime,action==='same-owner-cookie'?'owner':'other'),[name,value]=next.cookie.split('=');await context.addCookies([{name,value,url:g.origin,httpOnly:true,sameSite:'Strict'}]);}
 const marker=traffic.length;await settle();await expect(page.getByLabel('username',{exact:true})).toBeVisible();await noOld();assert.equal(traffic.slice(marker).some(r=>r.method==='DELETE'),false,'old completion must not acquire current-session cleanup authority');if(action==='logout'||action==='revocation')assert.equal((await api('/session')).status,401);
}));
