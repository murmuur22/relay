import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {guidedLab,password} from '../guided-helper.mjs';
import {browserLogin} from '../auth-helper.mjs';
import {cockpitTarget} from '../../server/gateway-service-profiles.mjs';
async function panel(page,l){
 await browserLogin(page,l.relay.origin,l.dir+'/state');
 await page.getByRole('button',{name:'Navigation',exact:true}).click();
 await page.getByRole('button',{name:'Control Panel',exact:true}).click();
 await page.getByRole('tab',{name:'Gateway',exact:true}).click();
 await page.getByRole('button',{name:'Set up Cockpit',exact:true}).click();
}
async function review(page){for(let n=0;n<6;n++)await page.getByRole('button',{name:'Continue',exact:true}).click();}
async function check(page){
 await page.getByLabel('Current password for Cockpit setup',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Check destination now',exact:true}).click();
 await expect(page.getByText('HTTP response: passed',{exact:true})).toBeVisible();
}
for(const scenario of ['lost-response','saved-readback-failure','exit-refresh-failure'])test('workflow L1: direct Control Panel saved/uncertain return reconciles or refuses stale mutation · '+scenario,{timeout:30000},async()=>{
 const l=await guidedLab();let browser;
 try{
  browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(4000);let puts=0;
  await panel(page,l);await page.getByLabel('Cockpit service origin',{exact:true}).fill(l.origin);await review(page);await check(page);
  let saved=false;
  await page.route('**/api/admin/gateway',async route=>{
   if(route.request().method()==='PUT'){
    puts++;const response=await route.fetch();assert.equal(response.status(),200);saved=true;
    return scenario==='saved-readback-failure'?route.fulfill({response}):route.abort('failed');
   }
   if(saved&&scenario!=='lost-response')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture readback unavailable'})});
   return route.continue();
  });
  await page.getByLabel('I understand applying settings retires Gateway windows.',{exact:true}).check();
  await page.getByLabel('Current password for Cockpit setup',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Save Cockpit target separately',exact:true}).click();
  await expect(page.getByText(/Save outcome needs reconciliation/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Save Cockpit target separately',exact:true})).toBeDisabled();
  assert.equal((await (await l.api('/admin/gateway')).json()).config.targets.length,2);
  const recovery=await page.getByText(/Save outcome needs reconciliation/).innerText();
  await page.getByRole('button',{name:'Return without creating another target',exact:true}).click();
  const table=page.getByRole('table',{name:'Gateway targets',exact:true});
  if(scenario==='lost-response'){
   // Exact reviewer acceptance assertion against the real successfully saved target.
   await expect(table).toContainText('Cockpit',{timeout:1000});
  }else{
   await expect(page.getByRole('alert')).toContainText('stale/uncertain');
   await expect(page.getByRole('alert')).toContainText('Reconciliation failed');
   for(const name of ['Set up Cockpit','Add custom target','Check configuration','Apply gateway changes','Disable gateway','Edit target Existing target'])await expect(page.getByRole('button',{name,exact:true})).toBeDisabled();
   await expect(page.getByText(/saved separately/)).toHaveCount(0);
   // A second failed refresh must not clear the stale refusal.
   await page.getByRole('button',{name:'Refresh gateway status',exact:true}).click();
   await expect(page.getByRole('alert')).toContainText('stale/uncertain');
   await expect(page.getByRole('button',{name:'Set up Cockpit',exact:true})).toBeDisabled();
   await page.unroute('**/api/admin/gateway');
   await page.getByRole('button',{name:'Refresh gateway status',exact:true}).click();
   await expect(table).toContainText('Cockpit',{timeout:1000});
  }
  assert.doesNotMatch(recovery,/Cancel target/);
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Set up Cockpit',exact:true})).toBeEnabled();
  // The next setup derives a fresh base/ID, never an automatic repeat PUT.
  await page.getByRole('button',{name:'Set up Cockpit',exact:true}).click();
  await expect(page.getByLabel('Target ID',{exact:true})).toHaveValue('cockpit-2');
  assert.equal(puts,1);assert.equal(l.hits.length,1);
  assert.equal((await (await l.api('/admin/gateway')).json()).config.targets.length,2);
 }finally{await browser?.close();await l.close();}
});
for(const trust of ['system','custom'])test('workflow L2: HTTPS to HTTP explicitly removes hidden certificate settings · '+trust,{timeout:30000},async()=>{
 const l=await guidedLab();let browser;
 try{
  browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(4000);
  await panel(page,l);await page.getByLabel('Cockpit service origin',{exact:true}).fill(l.origin);await review(page);await check(page);
  await page.getByLabel('Current password for Cockpit setup',{exact:true}).fill(password);
  await page.getByLabel('I understand applying settings retires Gateway windows.',{exact:true}).check();
  await page.getByRole('button',{name:'Destination',exact:true}).click();
  await page.getByLabel('Cockpit service origin',{exact:true}).fill('https://127.0.0.1:9090');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Exact certificate DNS identity',{exact:true}).fill('cockpit.example.test');
  if(trust==='custom'){
   await page.getByRole('combobox',{name:/Service certificate trust/}).selectOption('custom');
   await page.getByLabel('Protected CA path on Relay server',{exact:true}).fill(l.dir+'/cert.pem');
  }
  const tls={id:'cockpit',label:'Cockpit',upstream:l.origin,trust,serverName:'cockpit.example.test',caPath:trust==='custom'?l.dir+'/cert.pem':''};
  assert.throws(()=>cockpitTarget(tls),/HTTP cannot use certificate settings/);
  await page.getByRole('button',{name:'Destination',exact:true}).click();await page.getByLabel('Cockpit service origin',{exact:true}).fill(l.origin);await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Certificate',exact:true})).toBeVisible();
  assert.equal(await page.getByLabel('Exact certificate DNS identity',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  // Exact reviewer acceptance assertion: supported scheme edit advances to Login.
  await expect(page.getByRole('heading',{name:'Login',exact:true})).toBeVisible({timeout:1000});
  await expect(page.getByText(/HTTP.*removed.*certificate/i)).toBeVisible();
  // Return to HTTPS to verify all TLS-only values were removed, not merely hidden.
  await page.getByRole('button',{name:'Destination',exact:true}).click();await page.getByLabel('Cockpit service origin',{exact:true}).fill('https://127.0.0.1:9090');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('combobox',{name:/Service certificate trust/})).toHaveValue('system');
  await expect(page.getByLabel('Exact certificate DNS identity',{exact:true})).toHaveValue('');
  await page.getByRole('combobox',{name:/Service certificate trust/}).selectOption('custom');
  await expect(page.getByLabel('Protected CA path on Relay server',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Destination',exact:true}).click();await page.getByLabel('Cockpit service origin',{exact:true}).fill(l.origin);await review(page);
  assert.equal(l.hits.length,1); // Only the earlier explicit check, no edit/navigation traffic.
  await expect(page.getByText('HTTP response: passed',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Current password for Cockpit setup',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('I understand applying settings retires Gateway windows.',{exact:true})).not.toBeChecked();
  await page.getByLabel('Current password for Cockpit setup',{exact:true}).fill(password);
  await page.getByLabel('I understand applying settings retires Gateway windows.',{exact:true}).check();
  await expect(page.getByRole('button',{name:'Save Cockpit target separately',exact:true})).toBeDisabled();
  await check(page);await page.getByLabel('Current password for Cockpit setup',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Save Cockpit target separately',exact:true}).click();
  await expect(page.getByRole('table',{name:'Gateway targets',exact:true})).toContainText('Cockpit');
  const current=await (await l.api('/admin/gateway')).json();assert.equal(current.config.targets.length,2);
  assert.equal(current.config.targets[1].upstream,l.origin);assert.equal(current.config.targets[1].upstreamTLS,undefined);assert.equal(l.hits.length,2);
 }finally{await browser?.close();await l.close();}
});
test('Control Panel Cockpit required fields, stale check invalidation and pre-save cancellation do not mutate or auto-probe',{timeout:30000},async()=>{
 const l=await guidedLab();let browser;try{
 browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(5000);await browserLogin(page,l.relay.origin,l.dir+'/state');await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Gateway',exact:true}).click();await page.getByRole('button',{name:'Set up Cockpit',exact:true}).click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Destination',exact:true})).toBeVisible();
 for(const value of ['http://127.1','http://169.254.169.254','http://8.8.8.8','http://name.test:9090']){await page.getByLabel('Cockpit service origin',{exact:true}).fill(value);await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Destination',exact:true})).toBeVisible();}
 assert.equal(l.hits.length,0);await page.getByLabel('Cockpit service origin',{exact:true}).fill(l.origin);for(let i=0;i<6;i++)await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByLabel('Current password for Cockpit setup',{exact:true}).fill('wrong');await page.getByRole('button',{name:'Check destination now',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Current password required');assert.equal(l.hits.length,0);
 await page.getByLabel('Current password for Cockpit setup',{exact:true}).fill(password);await page.getByRole('button',{name:'Check destination now',exact:true}).click();await expect(page.getByText('HTTP response: passed',{exact:true})).toBeVisible();await expect(page.getByLabel('Current password for Cockpit setup',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Destination',exact:true}).click();await page.getByLabel('Service name',{exact:true}).fill('New name');for(let i=0;i<6;i++)await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('HTTP response: passed',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Save Cockpit target separately',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Cancel Cockpit setup',exact:true}).click();
 assert.equal((await (await l.api('/admin/gateway')).json()).config.targets.length,1);assert.equal(l.hits.length,1);
 }finally{await browser?.close();await l.close();}
});
