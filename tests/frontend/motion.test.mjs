import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {createServer} from 'node:http';
import {password,browserLogin} from '../auth-helper.mjs';

test('setup fragment is cleared before a slow session response',{timeout:15000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-fragment-'),g=await createGateway({port:0,runtime}),browser=await chromium.launch({headless:true,chromiumSandbox:true}),page=await browser.newPage();let release;const wait=new Promise(r=>release=r);
 try{await page.route('**/api/session',async route=>{await wait;await route.continue();});await page.goto(await readFile(runtime+'/setup-url.txt','utf8'));await expect.poll(()=>page.evaluate(()=>location.hash==='')).toBe(true);release();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Create admin',exact:true})).toBeEnabled();}
 finally{release();await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});

test('protected enrollment to real first app retries completion without duplicate and clears on logout',{timeout:30000},async()=>{
 const fixture=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<label>Fixture note<input value="Synthetic first app"></label>');});await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
 const runtime=await mkdtemp(ROOT+'.test-first-app-'),g=await createGateway({port:0,runtime}),browser=await chromium.launch({headless:true,chromiumSandbox:true}),page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(5000);
 const button=name=>page.getByRole('button',{name,exact:true});
 try{
  await mkdir(ROOT+'screenshots',{recursive:true});
  await page.goto(g.origin+'/#invalid-owner-credential');await page.getByLabel('password',{exact:true}).fill(password);await button('Create admin').click();await expect(page.getByRole('alert')).toBeVisible();assert.equal((await page.request.get(g.origin+'/api/session')).status(),401);
  await page.goto(await readFile(runtime+'/setup-url.txt','utf8'));await expect(page.getByText('Step 1 of 2')).toBeVisible();await expect.poll(()=>page.evaluate(()=>location.hash==='')).toBe(true);await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.locator('.login-message')).toHaveCount(0);await page.getByLabel('password',{exact:true}).fill('');await page.screenshot({path:ROOT+'screenshots/motion-enrollment.png'});
  await page.getByLabel('password',{exact:true}).fill(password);await button('Create admin').click();await button('Add app').click();await button('Next').click();await page.getByLabel('App name',{exact:true}).fill('First synthetic app');await page.getByLabel('Address',{exact:true}).fill(`http://localhost:${fixture.address().port}/`);await button('Next').click();
  const backBox=await button('Back').boundingBox(),nextBox=await button('Next').boundingBox();assert.ok(nextBox.x-backBox.x-backBox.width>=4,'wizard buttons need separated targets');
  await page.screenshot({path:ROOT+'screenshots/motion-first-app-narrow.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await button('Next').click();await button('Next').click();let saves=0;page.on('request',req=>{if(req.url()===g.origin+'/api/onboarding/app'&&req.method()==='POST')saves++;});
  await page.route('**/api/onboarding/complete',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic completion interruption'})}),{times:1});
  await button('Save app').click();await expect(page.getByRole('alert')).toHaveText('Synthetic completion interruption');await expect(button('Save app')).toHaveCount(0);await page.reload();await expect(button('Enter desktop')).toBeVisible();await button('Enter desktop').click();await expect(button('Open First synthetic app')).toBeVisible();assert.equal(saves,1);
  await button('Open First synthetic app').click();const frame=page.frameLocator('iframe[title="First synthetic app"]');await expect(frame.getByLabel('Fixture note')).toHaveValue('Synthetic first app');await frame.getByLabel('Fixture note').fill('Retained form');await button('Minimize First synthetic app').click();await button('Restore First synthetic app').click();await expect(frame.getByLabel('Fixture note')).toHaveValue('Retained form');
  await button('Navigation').click();await button('Sign out').click();await expect(page.locator('iframe,.onboarding,.shortcut')).toHaveCount(0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});await new Promise(r=>fixture.close(r));}
});

test('real window and navigation motion respects live reduced motion and preserves native frames',{timeout:30000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-motion-window-'),g=await createGateway({port:0,runtime}),browser=await chromium.launch({headless:true,chromiumSandbox:true}),page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await browserLogin(page,g.origin,runtime);
  await page.evaluate(async()=>{const s=await(await fetch('/api/session')).json();await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({interfaceAnimations:true})});});await page.reload();
  await page.evaluate(()=>{window.motionEvents=[];const animate=Element.prototype.animate;Element.prototype.animate=function(...args){window.motionEvents.push({className:this.className,frames:args[0]});return animate.apply(this,args);};});
  await page.getByRole('button',{name:'Open Parcels',exact:true}).click();
  const win=page.locator('.desktop-window');await expect(win).toBeVisible();
  assert.ok(await page.evaluate(()=>motionEvents.some(e=>e.className.includes('desktop-window'))),'window has actual animation');
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().length)).toBe(0);await page.evaluate(()=>motionEvents=[]);await page.waitForResponse(r=>r.url()===g.origin+'/api/session');assert.equal(await page.evaluate(()=>motionEvents.length),0,'session polling must not replay motion');
  await win.locator('iframe').evaluate(el=>el.dataset.identity='preserved');
  await page.getByRole('button',{name:'Minimize Parcels',exact:true}).click();await expect(win).toBeHidden();
  await page.getByRole('button',{name:'Restore Parcels',exact:true}).click();await expect(win).toBeVisible();await expect(win.locator('iframe')).toHaveAttribute('data-identity','preserved');
  await page.getByRole('button',{name:'Navigation',exact:true}).click();assert.ok(await page.evaluate(()=>motionEvents.some(e=>e.className.includes('quick-nav'))));
  await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>page.evaluate(()=>document.getAnimations().length)).toBe(0);
  await page.getByRole('button',{name:'Close navigation',exact:true}).click();await page.evaluate(()=>motionEvents=[]);await page.getByRole('button',{name:'Minimize Parcels',exact:true}).click();await page.getByRole('button',{name:'Restore Parcels',exact:true}).click();assert.equal(await page.evaluate(()=>motionEvents.length),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});

test('initial password commits independently and pending setup resumes until explicit defer',{timeout:30000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-onboarding-'),g=await createGateway({port:0,runtime}),browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1280,height:1000}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(await readFile(runtime+'/setup-url.txt','utf8'));
  await page.evaluate(()=>{window.loginMotion=[];const animate=Element.prototype.animate;Element.prototype.animate=function(...args){window.loginMotion.push(this.className);return animate.apply(this,args);};});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect(page.getByText('Step 1 of 2')).toBeVisible();await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create admin',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>loginMotion.some(c=>c.includes('login-panel')))).toBe(true);
  await expect(page.getByRole('heading',{name:'Add your first app',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Add your first app',exact:true})).toBeVisible();
  await page.evaluate(async()=>{const s=await(await fetch('/api/session')).json();await fetch('/api/logout',{method:'POST',headers:{'X-CSRF-Token':s.csrf}});});
  await page.getByRole('button',{name:'Set up later',exact:true}).click();await expect(page.getByRole('heading',{name:'login',exact:true})).toBeVisible();await expect(page.locator('.onboarding')).toHaveCount(0);
  await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await expect(page.getByRole('heading',{name:'Add your first app',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add app',exact:true}).click();await expect(page.getByRole('region',{name:'Add app wizard'})).toBeVisible();await expect(page.getByRole('radio',{name:'Native',exact:true})).toBeFocused();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.evaluate(()=>{window.desktopMotion=[];const animate=Element.prototype.animate;Element.prototype.animate=function(...args){window.desktopMotion.push(this.className);return animate.apply(this,args);};});
  await page.getByRole('button',{name:'Set up later',exact:true}).click();await expect(page.getByRole('button',{name:'Navigation',exact:true})).toBeVisible();
  assert.ok(await page.evaluate(()=>desktopMotion.some(c=>c.includes('shortcut'))),'desktop icons resolve with real motion');
  await page.reload();await expect(page.getByRole('heading',{name:'Add your first app',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Profile settings',exact:true}).click();
  await page.getByLabel('Intro animation',{exact:true}).uncheck();await expect(page.getByLabel('Intro animation',{exact:true})).toBeEnabled();
  await page.getByLabel('Interface animations',{exact:true}).uncheck();await expect(page.getByLabel('Interface animations',{exact:true})).toBeEnabled();
  await page.reload();await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Profile settings',exact:true}).click();
  await expect(page.getByLabel('Intro animation',{exact:true})).not.toBeChecked();await expect(page.getByLabel('Interface animations',{exact:true})).not.toBeChecked();
  await mkdir(ROOT+'screenshots',{recursive:true});await page.getByLabel('Interface animations',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'screenshots/motion-profile.png'});
  await page.getByRole('button',{name:'Close settings',exact:true}).click();await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
  await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Profile settings',exact:true}).click();await expect(page.getByLabel('Intro animation',{exact:true})).not.toBeChecked();await expect(page.getByLabel('Interface animations',{exact:true})).not.toBeChecked();assert.deepEqual(errors,[]);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});

test('decorative intro bypass is immediate, session scoped, and never enrolls',{timeout:30000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-motion-'),g=await createGateway({port:0,runtime}),browser=await chromium.launch({headless:true,chromiumSandbox:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(g.origin);await expect(page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true})).toBeVisible();
  await mkdir(ROOT+'screenshots',{recursive:true});await page.screenshot({path:ROOT+'screenshots/motion-intro.png'});
  await page.keyboard.press('Escape');await expect(page.locator('.signal-intro')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Create admin',exact:true})).toBeDisabled();
  await page.reload();await expect(page.locator('.signal-intro')).toHaveCount(0);
  assert.equal((await(await page.request.get(g.origin+'/api/session')).status()),401);
  const second=await browser.newPage();await second.goto(g.origin);await second.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true}).click();await expect(second.locator('.signal-intro')).toHaveCount(0);
  await second.close();
  const reduced=await browser.newPage({reducedMotion:'reduce',viewport:{width:1280,height:1000}});await reduced.goto(g.origin);await expect(reduced.locator('.signal-intro')).toHaveCount(0);await reduced.emulateMedia({reducedMotion:'no-preference'});await expect(reduced.locator('.signal-intro')).toHaveCount(0);await reduced.close();
  const live=await browser.newPage();await live.goto(g.origin);await expect(live.locator('.signal-intro')).toBeVisible();await live.emulateMedia({reducedMotion:'reduce'});await expect(live.locator('.signal-intro')).toHaveCount(0);await live.close();
  const blocked=await browser.newPage();await blocked.addInitScript(()=>{Object.defineProperty(window,'sessionStorage',{get(){throw Error('Storage disabled');}});Object.defineProperty(window,'localStorage',{get(){throw Error('Storage disabled');}});});await blocked.goto(g.origin);await blocked.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true}).click();await expect(blocked.getByRole('button',{name:'Create admin',exact:true})).toBeDisabled();
  await blocked.evaluate(()=>{window.escPrevented=null;window.addEventListener('keydown',e=>{if(e.key==='Escape')window.escPrevented=e.defaultPrevented;});});await blocked.keyboard.press('Escape');assert.equal(await blocked.evaluate(()=>window.escPrevented),false);await blocked.close();assert.deepEqual(errors,[]);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
