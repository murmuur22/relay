import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import {browserLogin,authenticate,client,password} from '../auth-helper.mjs';

// Genuine compiled host + child, Relay enrollment/owner authentication and HTTP.
// Broker snapshots are a controlled protocol double, not real preparation/install.
async function fixture(t){
 const root=await mkdtemp(tmpdir()+'/hr-');
 const portServer=net.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const uiOrigin=`http://127.0.0.1:${port}`;await writeFile(root+'/key',Buffer.alloc(32,7),{mode:0o600});
 let owner,reads=0;const mutations=[];
 let snapshot={mode:'fixture',currentVersion:'v0.6.3',available:[{version:'v0.6.4',verified:true,size:100,notes:'SYNTHETIC HOST READY PROTOCOL FIXTURE — not a real update'}],job:null,history:[],capabilities:{prepare:1,apply:1},canPrepare:true,canApply:true};
 const broker=net.createServer(socket=>{let text='';socket.on('data',b=>{text+=b;if(!text.includes('\n'))return;const request=JSON.parse(text);let result;
  if(request.action==='issue-ui'){owner=JSON.parse(Buffer.from(request.payload,'base64')).userId;result={ticket:'t'.repeat(64),expiresAt:Date.now()+60000};}
  else if(request.action==='redeem-ui')result={token:'r'.repeat(64),userId:owner,expiresAt:Date.now()+60000,interfaceAnimations:false};
  else {if(['prepare','apply','install','cancel','rollback'].includes(request.action))mutations.push(request);reads++;result=structuredClone(snapshot);}
  socket.end(JSON.stringify({ok:true,result})+'\n');
 });});await new Promise(r=>broker.listen(root+'/socket',r));
 const g=await createGateway({port:0,profile:'standalone',runtime:root+'/relay',updater:{socketPath:root+'/socket',keyFile:root+'/key',uiOrigin}});
 const web=await createUpdaterWeb({uiOrigin,relayOrigin:g.origin,socketPath:root+'/socket'});
 const browser=await chromium.launch({headless:true,chromiumSandbox:true}),context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(5000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let reviewReads=0;context.on('request',r=>{const path=new URL(r.url()).pathname;if(path==='/updater/api/state')reviewReads++;if(['/updater/api/apply','/updater/api/install'].includes(path))mutations.push(path);});
 const beforeClose=[];t.after(async()=>{try{for(const cleanup of beforeClose)await cleanup();}finally{await browser.close();await web.close();await g.close();await new Promise(r=>broker.close(r));await rm(root,{recursive:true,force:true});}assert.deepEqual(errors,[]);});
 await browserLogin(page,g.origin,root+'/relay');await page.bringToFront();await page.getByRole('button',{name:'Open Updater',exact:true}).dblclick();
 const browse=page.locator('[data-window-id="system-updater"]');await expect(browse.getByLabel('Available release')).toHaveValue('v0.6.4');await browse.getByRole('button',{name:'Start update',exact:true}).click();
 const iframe=page.locator('iframe[title="Independent Relay updater"]'),app=page.frameLocator('iframe[title="Independent Relay updater"]');await expect(app.locator('#console')).toBeVisible();const identity=await iframe.elementHandle(),child=await identity.contentFrame();
 const hint=(id='a'.repeat(32),phase='ready')=>({type:'relay-updater-observation',jobId:id,version:'v0.6.4',phase});
 const setReady=(id='a'.repeat(32))=>snapshot={...snapshot,job:{id,version:'v0.6.4',kind:'prepare',phase:'ready',events:[]}};
 const send=async data=>child.evaluate(({data,origin})=>parent.postMessage(data,origin),{data,origin:g.origin});
 const hide=()=>page.getByRole('button',{name:'Close maintenance',exact:true}).click();
 const badge=page.getByRole('button',{name:'Update ready: v0.6.4',exact:true}),dialog=page.getByRole('dialog',{name:'Update ready',exact:true});
 return {beforeClose,page,context,g,root,uiOrigin,app,iframe,identity,child,hint,setReady,send,hide,badge,dialog,mutations,reads:()=>reads,reviewReads:()=>reviewReads,setSnapshot:fn=>snapshot=fn(snapshot)};
}

test('independent monitor drag, resize, minimize and maximize retain the same authenticated iframe within viewport bounds',{timeout:35000},async t=>{
 const f=await fixture(t),{page,app}=f,surface=page.getByRole('region',{name:'Independent maintenance',exact:true});
 const cookies=await f.context.cookies(f.uiOrigin),before=await surface.boundingBox();
 await f.child.evaluate(()=>window.__monitorSession='retained');
 const bar=await page.locator('.maintenance-bar').boundingBox();await page.mouse.move(bar.x+100,bar.y+bar.height/2);await page.mouse.down();await page.mouse.move(bar.x+220,bar.y+bar.height/2+80,{steps:12});await page.mouse.up();
 const dragged=await surface.boundingBox();assert.ok(dragged.x-before.x>20&&dragged.y-before.y>20,JSON.stringify({before,dragged}));
 const handle=page.getByRole('button',{name:'Resize maintenance monitor',exact:true}),grip=await handle.boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(grip.x-100,grip.y-80,{steps:12});await page.mouse.up();
 const resized=await surface.boundingBox();assert.ok(resized.width<dragged.width-50&&resized.height<dragged.height-40,JSON.stringify({dragged,resized}));
 await page.getByRole('button',{name:'Maximize maintenance monitor',exact:true}).click();const maximized=await surface.boundingBox();assert.ok(maximized.width>resized.width);await page.getByRole('button',{name:'Restore size maintenance monitor',exact:true}).click();assert.deepEqual(await surface.boundingBox(),resized);
 await page.getByRole('button',{name:'Minimize maintenance monitor',exact:true}).click();await expect(surface).not.toBeVisible();await expect(app.locator('#chamber')).toHaveAttribute('data-motion','off');
 f.setSnapshot(s=>({...s,job:{id:'a'.repeat(32),version:'v0.6.4',kind:'prepare',phase:'staging',downloadedBytes:100,totalBytes:100}}));await expect(app.locator('#phase')).toHaveText('Staging');await expect(f.badge).toHaveCount(0);
 await page.getByRole('button',{name:'Return to maintenance monitor',exact:true}).click();assert.deepEqual(await surface.boundingBox(),resized);
 await page.setViewportSize({width:390,height:760});await expect.poll(async()=>{const b=await surface.boundingBox();return b.x>=0&&b.y>=0&&b.x+b.width<=390&&b.y+b.height<=760;}).toBe(true);
 await expect(app.getByRole('button',{name:'Check releases ↻',exact:true})).toBeVisible();assert.equal((await page.evaluate(async()=> (await fetch('/api/session')).status)),200);assert.deepEqual(f.mutations,[]);
 assert.equal(await f.iframe.evaluate((el,old)=>el===old,f.identity),true);assert.equal(await f.child.evaluate(()=>window.__monitorSession),'retained');assert.deepEqual(await f.context.cookies(f.uiOrigin),cookies);
 await page.getByRole('button',{name:'Minimize maintenance monitor',exact:true}).click();await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(f.iframe).toHaveCount(0);await expect(page.getByRole('button',{name:'Return to maintenance monitor',exact:true})).toHaveCount(0);
 // A later real owner login cannot resurrect the old frame or its geometry/session.
 await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await expect(page.getByLabel('username',{exact:true})).toHaveCount(0);await expect(f.iframe).toHaveCount(0);await expect(page.getByRole('button',{name:'Return to maintenance monitor',exact:true})).toHaveCount(0);assert.deepEqual(f.mutations,[]);
});

test('compiled host ready notice returns to centered Apply/Later and opens only fresh exact-job child consent',{timeout:35000},async t=>{
 const f=await fixture(t),{page,app,dialog,badge}=f;
 await f.hide();f.setReady();await expect(badge).toBeVisible();await expect(dialog).toHaveCount(0);assert.deepEqual(f.mutations,[]);
 await page.getByRole('button',{name:'Return to maintenance monitor',exact:true}).click();await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Later',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Apply',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'Later',exact:true})).toBeFocused();
 const bounds=await dialog.boundingBox(),viewport=page.viewportSize();assert.ok(Math.abs(bounds.x+bounds.width/2-viewport.width/2)<2);assert.ok(Math.abs(bounds.y+bounds.height/2-viewport.height/2)<2);
 if(process.env.RELAY_HOST_READY_EVIDENCE){await page.screenshot({path:process.env.RELAY_HOST_READY_EVIDENCE+'/synthetic-host-ready-desktop.png'});await page.setViewportSize({width:390,height:760});const narrow=await dialog.boundingBox();assert.ok(narrow.x>=0&&narrow.x+narrow.width<=390);await page.screenshot({path:process.env.RELAY_HOST_READY_EVIDENCE+'/synthetic-host-ready-narrow.png'});await page.setViewportSize({width:1440,height:1050});}
 const before=f.reviewReads();await dialog.getByRole('button',{name:'Apply',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(app.locator('#confirm')).toBeVisible();assert.ok(f.reviewReads()>before,'Child must perform a fresh independent read before opening consent');
 await expect(app.locator('#confirm-title')).toHaveText('Apply v0.6.4?');await expect(app.locator('#password')).toHaveValue('');await expect(app.locator('#confirmed')).not.toBeChecked();await expect(app.locator('#authorize')).toBeDisabled();assert.deepEqual(f.mutations,[]);
 assert.equal(await f.iframe.evaluate((el,old)=>el===old,f.identity),true);assert.equal(f.context.pages().length,1);
 await app.getByRole('button',{name:'Go back',exact:true}).click();await f.hide();await page.getByRole('button',{name:'Return to maintenance monitor',exact:true}).click();await expect(dialog).toHaveCount(0);assert.deepEqual(f.mutations,[]);
});

test('Apply during an in-flight child poll waits then performs a new fresh read before consent',{timeout:25000},async t=>{
 const f=await fixture(t),{page,dialog,app}=f;await f.hide();f.setReady();await expect(f.badge).toBeVisible();await page.getByRole('button',{name:'Return to maintenance monitor',exact:true}).click();await expect(dialog).toBeVisible();
 let release,arrived;const gate=new Promise(r=>release=r),held=new Promise(r=>arrived=r);let hold=true;
 await f.context.route(f.uiOrigin+'/updater/api/state',async route=>{if(hold){hold=false;arrived();await gate;}await route.continue();});
 f.beforeClose.push(async()=>{release();await f.context.unrouteAll({behavior:'wait'});});
 await f.child.evaluate(()=>{window.__reviewMessages=0;window.addEventListener('message',event=>{if(event.data?.type==='relay-updater-review')window.__reviewMessages++;});});
 await held;const before=f.reviewReads();await dialog.getByRole('button',{name:'Apply',exact:true}).click();await expect.poll(()=>f.child.evaluate(()=>window.__reviewMessages)).toBe(1);await expect(app.locator('#confirm')).not.toBeVisible();
 release();await expect(app.locator('#confirm')).toBeVisible();assert.ok(f.reviewReads()>before,'Review must initiate a new read after the pre-existing poll');await expect(app.locator('#password')).toHaveValue('');await expect(app.locator('#confirmed')).not.toBeChecked();assert.deepEqual(f.mutations,[]);
});

test('compiled host defers while typing, Later suppresses repeat per job and logout clears the owner notice',{timeout:35000},async t=>{
 const f=await fixture(t),{page,dialog,badge}=f;await f.hide();
 // Synthetic host editor to exercise normal focus policy without unrelated settings.
 await page.evaluate(()=>{const input=document.createElement('input');input.setAttribute('aria-label','Synthetic work draft');document.body.append(input);});
 const editor=page.getByRole('textbox',{name:'Synthetic work draft'});await editor.fill('keep my draft');f.setReady();await expect(badge).toBeVisible();await expect(editor).toBeFocused();await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Return to maintenance monitor',exact:true}).click();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Later',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Close maintenance',exact:true})).toBeFocused();
 for(let n=0;n<3;n++)await f.send(f.hint());await expect(dialog).toHaveCount(0);await expect(editor).toHaveValue('keep my draft');
 await f.hide();await page.getByRole('button',{name:'Return to maintenance monitor',exact:true}).click();await expect(dialog).toHaveCount(0);
 await f.hide();f.setReady('b'.repeat(32));await expect(page.getByLabel('Prepared update',{exact:true})).toHaveAttribute('data-job-id','b'.repeat(32));await page.getByRole('button',{name:'Return to maintenance monitor',exact:true}).click();await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await f.hide();await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(badge).toHaveCount(0);await expect(dialog).toHaveCount(0);await expect(f.iframe).toHaveCount(0);assert.deepEqual(f.mutations,[]);
});

test('compiled host ignores wrong source/origin/shape and stale identity; genuine demotion removes old-owner ready state',{timeout:35000},async t=>{
 const f=await fixture(t),{page,badge,dialog}=f;await f.hide();const hint=f.hint();
 await page.evaluate(({hint,origin})=>{const frame=document.querySelector('iframe[title="Independent Relay updater"]');window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,origin:'http://evil.test',data:hint}));window.dispatchEvent(new MessageEvent('message',{source:window,origin,data:hint}));},{hint,origin:f.uiOrigin});
 await f.send({...hint,extra:true});await f.send({...hint,jobId:'invalid'});await f.send({...hint,version:'v999'});await f.send(hint);
 await expect.poll(f.reads).toBeGreaterThan(0);await expect(badge).toHaveCount(0);await expect(dialog).toHaveCount(0);
 f.setReady();await expect(badge).toBeVisible();await f.send({...hint,phase:'succeeded'});await expect(badge).toHaveCount(0);await expect(dialog).toHaveCount(0);await f.send(hint);await expect(badge).toBeVisible();
 const a=client(f.g.origin,await authenticate(f.g.origin,f.root+'/relay'));assert.equal((await a('/admin/users','POST',{username:'ready-reviewer',password,role:'admin',grants:[]})).status,200);
 const other=client(f.g.origin,await authenticate(f.g.origin,f.root+'/relay','ready-reviewer'));const me=await page.evaluate(async()=> (await(await fetch('/api/session')).json()).user.id);assert.equal((await other('/admin/users/'+me,'PATCH',{role:'user'})).status,200);
 await expect(badge).toHaveCount(0,{timeout:8000});await expect(dialog).toHaveCount(0);await expect(f.iframe).toHaveCount(0,{timeout:8000});assert.deepEqual(f.mutations,[]);
});
