import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {gatewayLab,addGateway,password} from '../gateway-helper.mjs';

for(const action of ['end','close','logout'])test('protected app tab handoff preserves same-origin components and retires retained access on '+action,{timeout:20000},async t=>{
 const l=await gatewayLab({components:true,targetOptions:{presentation:'tab',allowDownloads:false}});let browser;
 try{
  await addGateway(l);
  browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${l.spki}`,'--host-resolver-rules=MAP *.relay.test 127.0.0.1','--no-proxy-server']});
  const page=await browser.newPage(),errors=[],urls=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));page.context().on('request',r=>urls.push(r.url()));
  await page.goto(l.relay.experimentalGateway.desktopOrigin);
  const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.count())await bypass.click();
  await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
  await page.getByRole('button',{name:'Open Files',exact:true}).dblclick();
  await expect(page.locator('iframe[title="Files"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Open protected app tab',exact:true})).toBeVisible();
  const before=Date.now();t.mock.method(Date,'now',()=>before+11000); // Old launch ticket is expired; the click must acquire a fresh one.
  const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'Open protected app tab',exact:true}).click()]);popup.setDefaultTimeout(5000);popup.on('pageerror',e=>errors.push(e.message));
  await expect(popup.getByRole('heading',{name:'Synthetic Files',exact:true})).toBeVisible();
  assert.equal(await popup.evaluate(()=>window.opener===null),true);
  assert.ok(popup.url().includes('.relay.test:'));assert.notEqual(new URL(popup.url()).origin,l.relay.experimentalGateway.desktopOrigin);
  assert.equal(urls.some(u=>/ticket=|#.*[a-f0-9]{64}/.test(u)),false);
  await popup.evaluate(()=>{const f=document.createElement('iframe');f.title='Component';f.src='/self-frame';document.body.append(f);});
  await expect(popup.frameLocator('iframe[title="Component"]').getByRole('heading',{name:'Same-origin component',exact:true})).toBeVisible();
  const denied=await popup.evaluate(async()=>{const r=await fetch('/deny-frame');return {policy:r.headers.get('content-security-policy'),xfo:r.headers.get('x-frame-options')};});
  assert.ok(denied.policy.includes("frame-ancestors 'none'"));assert.equal(denied.xfo,'DENY');
  assert.equal(await popup.evaluate(()=>window.open('/','_blank')===null),true,'CSP sandbox blocks unsolicited popup creation');
  await popup.getByRole('button',{name:'App login',exact:true}).click();await expect(popup.getByText('App signed in',{exact:true})).toBeVisible();
  if(action==='end')await page.getByRole('button',{name:'End app session',exact:true}).click();
  else if(action==='close')await page.getByRole('button',{name:'Close Files',exact:true}).click();
  else{await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();}
  await expect.poll(()=>l.relay.experimentalGateway.stats().routes).toBe(0);
  // Browsers may retain a disowned tab despite a close request. Authority must
  // still be revoked; closing a UI is not a substitute for server retirement.
  if(!popup.isClosed())assert.equal(await popup.evaluate(async()=> (await fetch('/private')).status),403);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await l.close();}
});
