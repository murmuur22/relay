import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {gatewayLab,password,addGateway,edgeRequest} from '../gateway-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';

export async function loginDesktop(page,l,username='admin'){
 await page.goto(l.relay.experimentalGateway.desktopOrigin);
 const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.count())await bypass.click();
 await page.getByLabel('username',{exact:true}).fill(username);await page.getByLabel('password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Enter →',exact:true}).click();await expect(page.getByRole('button',{name:'Navigation',exact:true})).toBeVisible();
}
export async function browserFor(l){return chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${l.spki}`,'--host-resolver-rules=MAP *.relay.test 127.0.0.1','--no-proxy-server']});}

test('another tab changing the Relay account removes old protected frames and invalidates the UI epoch',{timeout:20000},async()=>{
 const l=await gatewayLab(),browser=await browserFor(l),context=await browser.newContext(),page=await context.newPage();
 try{
  const user=await(await l.api('/admin/users','POST',{username:'alice',password})).json();await addGateway(l,[user.id]);await loginDesktop(page,l);
  await page.getByRole('button',{name:'Open Files',exact:true}).click();await expect(page.frameLocator('iframe[title="Files"]').getByRole('heading',{name:'Synthetic Files'})).toBeVisible();
  const other=await context.newPage();await other.goto(l.relay.experimentalGateway.desktopOrigin);
  assert.equal(await other.evaluate(async password=>{const auth=await(await fetch('/api/auth')).json();return (await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':auth.csrf},body:JSON.stringify({username:'alice',password})})).status;},password),200);
  await expect(page.locator('iframe[title="Files"]')).toHaveCount(0,{timeout:8000});await expect(page.getByLabel('username',{exact:true})).toBeVisible();
 }finally{await browser.close();await l.close();}
});
// Node's route.fetch does not use Chromium resolver rules. Forward the observed request
// over verifying local TLS instead, preserving actual cookie/CSRF and real server response.
async function forwardObserved(route,l){const req=route.request(),u=new URL(req.url()),headers=await req.allHeaders();delete headers['content-length'];const r=await edgeRequest(l,u.origin,u.pathname,{method:req.method(),headers,body:req.postDataJSON()});const out={...r.headers};delete out['transfer-encoding'];delete out.connection;return {status:r.status,headers:out,body:r.text};}

test('compiled normal desktop Add app, editor, shortcut, End, reopen and secure Close',{timeout:60000},async()=>{
 const l=await gatewayLab(),browser=await browserFor(l),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],urls=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>urls.push(r.url()));const button=name=>page.getByRole('button',{name,exact:true});
 try{
  await loginDesktop(page,l);await button('Navigation').click();await button('Control Panel').click();await page.getByRole('tab',{name:'Apps',exact:true}).click();await button('Add app').click();
  await expect(page.getByLabel('Gateway (experimental)',{exact:true})).toBeVisible({timeout:2000});await page.getByLabel('Gateway (experimental)',{exact:true}).check();await button('Next').click();
  await page.getByLabel('App name',{exact:true}).fill('Files');await page.getByRole('combobox',{name:'Gateway target',exact:true}).selectOption('files');
  await expect(page.getByLabel('Address',{exact:true})).toHaveCount(0);await button('Next').click();await expect(page.getByText(/app.*Logout may not clear/i)).toBeVisible();await button('Next').click();await button('Next').click();await button('Save app').click();
  await button('Edit app Files').click();await expect(page.getByRole('combobox',{name:'Gateway target',exact:true})).toHaveValue('files');await button('Save app').click();await expect(button('Edit app Files')).toBeVisible();await button('Close settings').click();
  await button('Open Files').click();const frame=page.frameLocator('iframe[title="Files"]');await expect(frame.getByRole('heading',{name:'Synthetic Files'})).toBeVisible();
  const origin=await frame.locator('body').evaluate(()=>location.origin);await frame.getByRole('button',{name:'App login',exact:true}).click();await expect(frame.getByText('App signed in',{exact:true})).toBeVisible();
  await frame.getByLabel('Private text').fill('retained while minimized');await button('Minimize Files').click();await button('Restore Files').click();await expect(frame.getByLabel('Private text')).toHaveValue('retained while minimized');
  await frame.getByRole('button',{name:'App Logout',exact:true}).click();assert.equal(await frame.locator('body').evaluate(async()=> (await fetch('/private')).status),200,'App-only Logout is deliberately not gateway forget');
  await button('End app session').click();await expect(page.locator('iframe[title="Files"]')).toHaveCount(0);await expect.poll(()=>l.relay.experimentalGateway.stats().routes).toBe(0);
  await button('Reopen app').click();await expect(frame.getByRole('heading',{name:'Synthetic Files'})).toBeVisible();assert.notEqual(await frame.locator('body').evaluate(()=>location.origin),origin);assert.equal(await frame.locator('body').evaluate(async()=> (await fetch('/private')).status),401);
  await button('Close Files').click();await expect(page.locator('iframe[title="Files"]')).toHaveCount(0);await expect.poll(()=>l.relay.experimentalGateway.stats().routes).toBe(0);
  await button('Open Files').click();await expect(frame.getByRole('heading',{name:'Synthetic Files'})).toBeVisible();
  assert.ok(urls.every(url=>!url.includes('ticket=')&&!url.includes('127.0.0.1')));assert.deepEqual(errors,[]);
 }finally{await browser.close();await l.close();}
});

for(const action of ['end','close','logout'])test('compiled pending launch is discarded after '+action,{timeout:30000},async()=>{
 const l=await gatewayLab(),browser=await browserFor(l),page=await browser.newPage();let release,held;
 try{
  await addGateway(l);await loginDesktop(page,l);const button=name=>page.getByRole('button',{name,exact:true});
  let arrived;const arrival=new Promise(r=>arrived=r),barrier=new Promise(r=>release=r);
  await page.route('**/api/gateway/launch',async route=>{held=await forwardObserved(route,l);arrived();await barrier;await route.fulfill(held).catch(()=>{});});
  await button('Open Files').click();await arrival;
  if(action==='end')await button('End app session').click();
  else if(action==='close')await button('Close Files').click();
  else{await button('Navigation').click();await button('Sign out').click();await expect(page.getByLabel('username',{exact:true})).toBeVisible();}
  await expect.poll(()=>l.relay.experimentalGateway.stats().routes).toBe(0);release();await page.unrouteAll({behavior:'wait'});await expect(page.locator('iframe[title="Files"]')).toHaveCount(0);
  if(action==='end'){await button('Reopen app').click();await expect(page.frameLocator('iframe[title="Files"]').getByRole('heading',{name:'Synthetic Files'})).toBeVisible();}
 }finally{release?.();await page.unrouteAll({behavior:'wait'});await browser.close();await l.close();}
});

test('gateway Close removes the window before held saves settle; queued old-account close cannot hit new account',{timeout:40000},async()=>{
 const l=await gatewayLab(),browser=await browserFor(l),page=await browser.newPage();let release;
 try{
  const user=await(await l.api('/admin/users','POST',{username:'alice',password})).json();await addGateway(l,[user.id]);
  const alice=await authenticate(l.relay.origin,l.dir+'/state','alice');await client(l.relay.origin,alice)('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false,showAppStatus:false});
  await loginDesktop(page,l);const button=name=>page.getByRole('button',{name,exact:true});await button('Open Files').click();await expect(page.frameLocator('iframe[title="Files"]').getByRole('heading',{name:'Synthetic Files'})).toBeVisible();
  let arrived;const arrival=new Promise(r=>arrived=r),barrier=new Promise(r=>release=r);let held=false;
  await page.route('**/api/windows/*',async route=>{if(!held&&route.request().method()==='PATCH'){held=true;const response=await forwardObserved(route,l);arrived();await barrier;await route.fulfill(response).catch(()=>{});}else await route.continue();});
  await button('Minimize Files').click();await arrival;await button('Restore Files').click();await button('Close Files').click();
  await expect(page.getByRole('region',{name:'Files window',exact:true})).toHaveCount(0,{timeout:1000});await expect.poll(()=>l.relay.experimentalGateway.stats().routes).toBe(0);
  await button('Navigation').click();await button('Sign out').click();await page.getByLabel('username',{exact:true}).fill('alice');await page.getByLabel('password',{exact:true}).fill(password);await button('Enter →').click();
  await button('Open Files').click();await expect(page.frameLocator('iframe[title="Files"]').getByRole('heading',{name:'Synthetic Files'})).toBeVisible();const fresh=await page.frameLocator('iframe[title="Files"]').locator('body').evaluate(()=>location.origin);
  release();await page.unrouteAll({behavior:'wait'});await expect(page.frameLocator('iframe[title="Files"]').getByRole('heading',{name:'Synthetic Files'})).toBeVisible();assert.equal(await page.frameLocator('iframe[title="Files"]').locator('body').evaluate(()=>location.origin),fresh);assert.equal(l.relay.experimentalGateway.stats().routes,1);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});await browser.close();await l.close();}
});
