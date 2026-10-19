import {writeFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {chromium,expect} from '@playwright/test';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import {browserLogin,password} from '../auth-helper.mjs';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('real admin embedded launch has no popup, survives stop/restart/sign-in and completes actual fixture install/rollback',{timeout:120000},async t=>{
 const uiOrigin=`http://127.0.0.1:${await freePort()}`;
 const script="from updater.fixtures.harness import Sandbox\nfrom updater.broker.auth import atomic_json\nimport sys,json\nbox=Sandbox()\ntry:\n box.config['uiOrigin']=sys.argv[1]\n atomic_json(box.config_path,box.config)\n box.start()\n print(json.dumps({'root':str(box.root),'config':box.config}),flush=True)\n sys.stdin.readline()\nfinally:\n box.close()";
 const child=spawn('python3',['-u','-c',script,uiOrigin],{cwd:ROOT,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',g,web,browser;
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 t.after(async()=>{await browser?.close();await web?.close();await g?.close();child.stdin.end('\n');if(child.exitCode===null){const timer=setTimeout(()=>child.kill('SIGKILL'),22000);await once(child,'exit');clearTimeout(timer);}});
 await expect.poll(()=>{if(child.exitCode!==null)throw Error(stderr);return stdout.includes('\n');},{timeout:15000}).toBe(true);
 const {root,config}=JSON.parse(stdout.split('\n')[0]);const port=await freePort();
 const options={port,runtime:root+'/embedded-relay',profile:'standalone',updater:{socketPath:config.socketPath,keyFile:config.bridgeKeyFile,uiOrigin},maintenanceFile:config.maintenance};
 g=await createGateway(options);web=await createUpdaterWeb({uiOrigin,relayOrigin:g.origin,socketPath:config.socketPath});
 browser=await chromium.launch({headless:true,chromiumSandbox:true});const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();let installs=0;context.on('request',r=>{if(new URL(r.url()).pathname==='/updater/api/apply')installs++;assert.notEqual(new URL(r.url()).pathname,'/updater/api/install','No immediate-install fallback');});const errors=[];page.on('pageerror',e=>errors.push(e.message));await browserLogin(page,g.origin,options.runtime);
 await page.evaluate(async()=>{const s=await(await fetch('/api/session')).json();await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({interfaceAnimations:true})});});
 await page.getByRole('button',{name:'Open Updater',exact:true}).dblclick();const browse=page.locator('[data-window-id="system-updater"]');
 await expect(browse.getByLabel('Available release')).toHaveValue('v0.3.1');await browse.getByRole('button',{name:'Start update',exact:true}).click();
 const iframe=page.locator('iframe[title="Independent Relay updater"]');await expect(iframe).toBeVisible();assert.equal(context.pages().length,1);
 const app=page.frameLocator('iframe[title="Independent Relay updater"]');await expect(app.locator('#current-version')).not.toHaveText('—');assert.equal((await iframe.getAttribute('src'))===null,true,'A consumed ticket must not remain in the host DOM');
 await expect(app.locator('#release-select')).toHaveValue('v0.3.1');await expect.poll(()=>iframe.evaluate(el=>el.contentWindow!==null)).toBe(true);
 const identity=await iframe.elementHandle();
 // Exercise the independent monitor itself, not the original read-only browser window.
 const monitor=page.getByRole('region',{name:'Independent maintenance',exact:true}),initial=await monitor.boundingBox(),bar=await page.locator('.maintenance-bar').boundingBox();
 await page.mouse.move(bar.x+100,bar.y+bar.height/2);await page.mouse.down();await page.mouse.move(bar.x+200,bar.y+bar.height/2+60,{steps:10});await page.mouse.up();const moved=await monitor.boundingBox();assert.ok(moved.x>initial.x+20&&moved.y>initial.y+20,JSON.stringify({initial,moved}));
 const grip=await page.getByRole('button',{name:'Resize maintenance monitor',exact:true}).boundingBox();await page.mouse.move(grip.x+8,grip.y+8);await page.mouse.down();await page.mouse.move(grip.x-80,grip.y-60,{steps:10});await page.mouse.up();const resized=await monitor.boundingBox();assert.ok(resized.width<moved.width-50&&resized.height<moved.height-40);
 await page.getByRole('button',{name:'Maximize maintenance monitor',exact:true}).click();await page.getByRole('button',{name:'Restore size maintenance monitor',exact:true}).click();assert.deepEqual(await monitor.boundingBox(),resized);assert.equal(await iframe.evaluate((el,old)=>el===old,identity),true);
 await expect(app.locator('#chamber')).toHaveAttribute('data-motion','on');await page.getByRole('button',{name:'Close maintenance',exact:true}).click();await expect(app.locator('#chamber')).toHaveAttribute('data-motion','off');const paused=await app.locator('#chamber').getAttribute('data-frames');await page.waitForTimeout(200);assert.equal(await app.locator('#chamber').getAttribute('data-frames'),paused);await page.getByRole('button',{name:'Return to maintenance monitor'}).click();await expect(app.locator('#chamber')).toHaveAttribute('data-motion','on');
 // Wrong source and wrong origin cannot request account actions or destroy monitoring.
 await page.evaluate(()=>{window.postMessage({type:'relay-updater-sign-in'},location.origin);window.postMessage({type:'relay-updater-ended'},location.origin);});
 await app.locator('body').evaluate((el,origin)=>{parent.postMessage({type:'relay-updater-ended',extra:true},origin);window.dispatchEvent(new MessageEvent('message',{source:parent,origin:'http://evil.test',data:{type:'relay-updater-end'}}));},g.origin);
 await page.evaluate(origin=>{const sibling=document.createElement('iframe');document.body.append(sibling);sibling.contentWindow.eval(`parent.document.querySelector('iframe[title="Independent Relay updater"]').contentWindow.postMessage({type:'relay-updater-end'},'${origin}')`);sibling.remove();},uiOrigin);
 await expect(iframe).toBeVisible();await expect(app.locator('#console')).toBeVisible();
 async function prepareApply(version,finalPhase){
  await app.locator('#release-select').selectOption(version);await app.getByRole('button',{name:'Download & prepare',exact:true}).click();await expect(app.locator('#password')).toHaveValue('');await expect(app.locator('#confirmed')).not.toBeChecked();await app.locator('#confirmed').check();await app.getByLabel('Current Relay password').fill(password);await app.getByRole('button',{name:'Authorize preparation',exact:true}).click();
  await page.getByRole('button',{name:'Close maintenance',exact:true}).click();
  await expect(app.locator('#phase')).toHaveText('Ready to apply',{timeout:30000});
  await expect(page.getByRole('button',{name:'Update ready: '+version,exact:true})).toBeVisible();
  assert.equal(installs,version==='v0.3.1'?0:1,'Ready must never automatically Apply');
  await page.setViewportSize({width:390,height:760});
  await page.getByRole('button',{name:'Return to maintenance monitor',exact:true}).click();
  const decision=page.getByRole('dialog',{name:'Update ready',exact:true});await expect(decision).toBeVisible();
  const narrowMonitor=await monitor.boundingBox(),narrowDecision=await decision.boundingBox();assert.ok(narrowMonitor.x>=0&&narrowMonitor.x+narrowMonitor.width<=390&&narrowMonitor.y+narrowMonitor.height<=760);assert.ok(narrowDecision.x>=0&&narrowDecision.x+narrowDecision.width<=390);
  const health=await(await fetch('http://127.0.0.1:'+config.fixturePort+'/health/ready')).json();assert.equal(health.status,'ready');assert.equal(health.maintenance,false);assert.equal(await page.evaluate(async()=> (await fetch('/api/session')).status),200);assert.equal(installs,version==='v0.3.1'?0:1,'Narrow monitor and Ready modal must not stop Relay or Apply');assert.equal(await iframe.evaluate((el,old)=>el===old,identity),true);
  await page.setViewportSize({width:1440,height:1050});
  if(version==='v0.3.2'){
   await decision.getByRole('button',{name:'Later',exact:true}).click();await expect(decision).toHaveCount(0);
   await app.getByRole('button',{name:'Check releases ↻',exact:true}).click();await expect(app.locator('#phase')).toHaveText('Ready to apply');await expect(decision).toHaveCount(0);
   await app.getByRole('button',{name:'Apply '+version,exact:true}).click();
  }else await decision.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(app.locator('#confirm')).toBeVisible();await expect(app.locator('#password')).toHaveValue('');await expect(app.locator('#confirmed')).not.toBeChecked();await expect(app.locator('#authorize')).toBeDisabled();await app.locator('#confirmed').check();await app.getByLabel('Current Relay password').fill(password);await app.getByRole('button',{name:'Authorize Apply',exact:true}).click();await expect(app.locator('#phase')).toHaveText(finalPhase,{timeout:30000});
 }
 await prepareApply('v0.3.1','Installed');await expect(app.locator('#current-version')).toHaveText('v0.3.1');
 await g.close();g=null;await expect(app.locator('#connection')).toHaveText('Connected to updater');
 // Keep the inherited obstruction reproducible: genuine downtime, visible host toast,
 // exact center hit-test, then the ordinary unchanged 30000ms browser click.
 await expect(page.locator('.error-toast')).toBeVisible();
 const sign=await app.getByRole('button',{name:'Sign in to Relay',exact:true}).boundingBox();
 const hit=await page.evaluate(({x,y,width,height})=>{const el=document.elementFromPoint(x+width/2,y+height/2);return {tag:el?.tagName,text:el?.textContent,toast:!!el?.closest('.error-toast'),frame:el?.getAttribute('title')==='Independent Relay updater'};},sign);
 if(process.env.RELAY_C_UI_EVIDENCE){await writeFile(process.env.RELAY_C_UI_EVIDENCE+'/recovery-hit.json',JSON.stringify({sign,hit,toast:await page.locator('.error-toast').boundingBox(),frame:await iframe.boundingBox()},null,2));await page.screenshot({path:process.env.RELAY_C_UI_EVIDENCE+'/recovery-hit.png'});}
 await app.getByRole('button',{name:'Sign in to Relay',exact:true}).click();await expect(page.getByLabel('username',{exact:true})).toBeVisible();
 assert.equal(hit.frame,true,'Sign in center must hit independent frame, not a host toast');assert.equal(hit.toast,false);
 assert.equal(await iframe.evaluate((el,old)=>el===old,identity),true,'Independent iframe must stay mounted through auth loss');
 g=await createGateway(options);await page.getByRole('button',{name:'Retry Relay connection',exact:true}).click();await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
 await expect(page.getByLabel('username',{exact:true})).toHaveCount(0);await expect(iframe).toBeVisible();assert.equal(context.pages().length,1);assert.equal(installs,1,'Reconnecting must never retry the accepted installation');
 // A successful Login discovery can also become stale while the same Login stays mounted.
 const oldAuthResponse=page.waitForResponse(r=>r.url()===g.origin+'/api/auth'&&r.status()===200);
 await app.getByRole('button',{name:'Sign in to Relay',exact:true}).click();const oldAuth=await (await oldAuthResponse).json();
 await expect(page.getByRole('button',{name:'Enter →',exact:true})).toBeEnabled();
 await g.close();g=await createGateway(options);
 await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);
 const staleLogin=page.waitForResponse(r=>r.url()===g.origin+'/api/login');await page.getByRole('button',{name:'Enter →',exact:true}).click();assert.equal((await staleLogin).status(),403,'Old runtime auth CSRF must remain invalid');
 await expect(page.getByRole('button',{name:'Retry Relay connection',exact:true})).toBeVisible();
 const freshAuthResponse=page.waitForResponse(r=>r.url()===g.origin+'/api/auth'&&r.status()===200);await page.getByRole('button',{name:'Retry Relay connection',exact:true}).click();const freshAuth=await(await freshAuthResponse).json();assert.notEqual(freshAuth.csrf,oldAuth.csrf);
 await expect(page.getByRole('button',{name:'Enter →',exact:true})).toBeEnabled();assert.equal(installs,1,'Metadata refresh cannot retry an updater mutation');
 await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
 await expect(page.getByLabel('username',{exact:true})).toHaveCount(0);await expect(iframe).toBeVisible();assert.equal(await iframe.evaluate((el,old)=>el===old,identity),true,'Refreshing stale Login metadata must preserve the original independent iframe');assert.equal(installs,1);assert.equal(context.pages().length,1);
 await prepareApply('v0.3.2','Rolled back');await expect(app.locator('#current-version')).toHaveText('v0.3.1');
 await page.screenshot({path:ROOT+'screenshots/updater-embedded-actual-rollback.png'});
 const pacing=await app.locator('#chamber').evaluate(el=>{const samples=(el.dataset.frameIntervals||'').split(',').map(Number).filter(Boolean).sort((a,b)=>a-b);return {tier:'actual disposable HMAC broker install/readiness-rollback browser flow, final bounded rendered-frame sample; not production',samples:samples.length,medianMs:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)],meanRenderMs:Number(el.dataset.renderMs),cells:Number(el.dataset.cells)};});await writeFile(ROOT+'screenshots/updater-embedded-performance.json',JSON.stringify({...pacing,browser:browser.version(),platform:process.platform,arch:process.arch},null,2));
 await expect(page.getByRole('button',{name:'Standalone recovery (new tab)',exact:true})).toBeVisible();const recoveryOpened=context.waitForEvent('page');await page.getByRole('button',{name:'Standalone recovery (new tab)',exact:true}).click();const recovery=await recoveryOpened;await expect(recovery.locator('#mode')).toHaveText('FIXTURE SANDBOX');assert.equal(await recovery.evaluate(()=>opener),null);await recovery.close();
 assert.equal(installs,2);const created=await page.evaluate(async password=>{const s=await(await fetch('/api/session')).json();return(await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({username:'other-account',password,role:'user',grants:[]})})).status;},password);assert.equal(created,200);
 await page.getByRole('button',{name:'Close maintenance',exact:true}).click();if(await page.getByRole('button',{name:'Dismiss error'}).count())await page.getByRole('button',{name:'Dismiss error'}).click();await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(iframe).toHaveCount(0);
 await page.getByLabel('username',{exact:true}).fill('other-account');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await expect(page.getByLabel('username',{exact:true})).toHaveCount(0);await expect(iframe).toHaveCount(0);
 const retained=await context.newPage();await retained.goto(uiOrigin+'/updater/');await expect(retained.locator('#console')).toBeHidden();await expect(retained.locator('#current-version')).toHaveText('—');assert.equal(installs,2);assert.deepEqual(errors,[]);
});
