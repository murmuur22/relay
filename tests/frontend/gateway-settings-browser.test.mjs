// UI contract fixture only: deployment operations are mocked here; separate integration uses real APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {remotePKI} from '../remote-tls-helper.mjs';
import {tmpdir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin,password} from '../auth-helper.mjs';
import http from 'node:http';
async function lab(){const runtime=await mkdtemp(tmpdir()+'/relay-gateway-ui-');const gateway=await createGateway({port:0,runtime,profile:'standalone'});const browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(5000);return {page,gateway,runtime,async close(){await browser.close();await gateway.close();await rm(runtime,{recursive:true,force:true});}};}
async function open(page,l){await browserLogin(page,l.gateway.origin,l.runtime);await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Gateway',exact:true}).click();}
test('proxy mode uses canonical browser origin, hides TLS files and invalidates consent on mode changes',{timeout:30000},async()=>{
 const l=await lab();try{
  await open(l.page,l);
  await l.page.getByLabel('Gateway connection mode',{exact:true}).selectOption('reverse-proxy');
  await expect(l.page.getByLabel('Certificate file on server',{exact:true})).toHaveCount(0);
  await l.page.getByLabel('Allowed source CIDRs for Caddy snippet',{exact:true}).fill('192.168.40.0/24');
  await l.page.getByLabel('Browser HTTPS desktop origin',{exact:true}).fill('https://desktop.example.test');
  await l.page.getByLabel('App hostname base',{exact:true}).fill('apps.example.test');
  await l.page.getByLabel('Service address',{exact:true}).fill('http://127.0.0.1:8096');
  await l.page.getByRole('button',{name:'Check configuration',exact:true}).click();
  await expect(l.page.getByRole('button',{name:'Enable gateway',exact:true})).toBeEnabled();
  await expect(l.page.getByLabel('Reviewable Caddy snippet',{exact:true})).toHaveValue(/reverse_proxy 127.0.0.1:/);
  await expect(l.page.getByText('External HTTPS: Not verified',{exact:true})).toBeVisible();
  await l.page.getByRole('button',{name:'Enable gateway',exact:true}).click();
  await expect(l.page.getByLabel('Current password for gateway changes',{exact:true})).toBeFocused();
  await l.page.screenshot({path:'screenshots/gateway-proxy-settings.png'});
  await l.page.getByLabel('Gateway connection mode',{exact:true}).selectOption('direct');
  await expect(l.page.getByLabel('Current password for gateway changes',{exact:true})).toHaveCount(0);
  await expect(l.page.getByRole('button',{name:'Enable gateway',exact:true})).toBeDisabled();
 }finally{await l.close();}
});
for(const remote of [false,true])test(`compiled ${remote?'remote mTLS':'proxy'} settings apply and disable through real password consent, with a narrow layout`,{timeout:30000},async()=>{
 const l=await lab();const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 try{
  await open(l.page,l);await l.page.getByLabel('Gateway connection mode',{exact:true}).selectOption(remote?'remote-proxy':'reverse-proxy');
  if(remote){const dir=await realpath(l.runtime);await remotePKI(dir);for(const [label,value] of Object.entries({'Trusted proxy peer':'127.0.0.1','Backend server DNS identity':'backend.example.test','Allowed client DNS identity':'caddy.example.test','Backend certificate on Relay':dir+'/server.pem','Backend private key on Relay':dir+'/server.key','Client CA on Relay':dir+'/client-ca.pem','Server CA on Caddy':dir+'/server-ca.pem','Client certificate on Caddy':dir+'/client.pem','Client private key on Caddy':dir+'/client.key'}))await l.page.getByLabel(label,{exact:true}).fill(value);}
  await l.page.getByLabel(remote?'Backend mTLS port':'Internal HTTP port',{exact:true}).fill(String(port));await l.page.getByLabel('Service address',{exact:true}).fill('http://127.0.0.1:8096');
  await l.page.getByRole('button',{name:'Check configuration',exact:true}).click();await l.page.getByRole('button',{name:'Enable gateway',exact:true}).click();
  await l.page.getByLabel('Current password for gateway changes',{exact:true}).fill(password);await l.page.getByLabel('I have configured DNS and HTTPS trust for the intended clients.',{exact:true}).check();await l.page.getByRole('button',{name:'Confirm gateway settings',exact:true}).click();
  await expect(l.page.getByText('Gateway listener is running',{exact:true})).toBeVisible();assert.equal(l.gateway.experimentalGateway.desktopOrigin,'https://desktop.relay.home.arpa');
  await l.page.getByLabel('Gateway connection mode',{exact:true}).scrollIntoViewIfNeeded();await l.page.screenshot({path:'screenshots/gateway-proxy-mode.png'});
  await l.page.setViewportSize({width:390,height:844});await l.page.getByLabel('Gateway connection mode',{exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await l.page.locator('.gateway-settings').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await l.page.screenshot({path:'screenshots/gateway-proxy-narrow.png'});
  await l.page.getByRole('button',{name:'Disable gateway',exact:true}).click();await l.page.getByLabel('Current password for gateway changes',{exact:true}).fill(password);await l.page.getByRole('button',{name:'Confirm disable',exact:true}).click();await expect(l.page.getByText('Gateway is off',{exact:true})).toBeVisible();assert.equal(l.gateway.experimentalGateway,undefined);
 }finally{await l.close();}
});
test('refresh discards a checked proxy snippet with its uncommitted draft',{timeout:30000},async()=>{
 const l=await lab();try{
  await open(l.page,l);await l.page.getByLabel('Gateway connection mode',{exact:true}).selectOption('reverse-proxy');
  await l.page.getByLabel('Service address',{exact:true}).fill('http://127.0.0.1:8096');
  await l.page.getByRole('button',{name:'Check configuration',exact:true}).click();
  await expect(l.page.getByLabel('Reviewable Caddy snippet',{exact:true})).toBeVisible();
  await l.page.getByRole('button',{name:'Refresh gateway status',exact:true}).click();
  await expect(l.page.getByLabel('Gateway connection mode',{exact:true})).toHaveValue('direct');
  await expect(l.page.getByLabel('Reviewable Caddy snippet',{exact:true})).toHaveCount(0);
 }finally{await l.close();}
});
test('gateway UI reports missing prerequisites and cannot enable after failed validation',{timeout:20000},async()=>{
 const l=await lab();let mutations=0;
 try{
  await l.page.route('**/api/admin/gateway',r=>{if(r.request().method()!=='GET')mutations++;return r.fulfill({json:{source:'disabled',enabled:false,desktopOrigin:null,appBaseDomain:null,config:null,limits:{maxTargets:8}}});});
  await l.page.route('**/api/admin/gateway/validate',r=>r.fulfill({status:400,json:{error:'Server certificate files are unavailable.'}}));
  await open(l.page,l);
  await expect(l.page.getByText('Gateway is off',{exact:true})).toBeVisible();
  await l.page.getByLabel('Service address',{exact:true}).fill('http://127.0.0.1:8096');
  await l.page.getByRole('button',{name:'Check configuration',exact:true}).click();
  await expect(l.page.getByRole('alert')).toContainText('Server certificate files are unavailable.');
  await expect(l.page.getByRole('button',{name:'Enable gateway',exact:true})).toBeDisabled();assert.equal(mutations,0);
 }finally{await l.close();}
});
test('operator-managed gateway is visibly read-only with an explicit HTTPS entry point',{timeout:20000},async()=>{
 const l=await lab();try{
  await l.page.route('**/api/admin/gateway',r=>r.fulfill({json:{source:'operator',enabled:true,desktopOrigin:'https://desktop.example.test:8443',appBaseDomain:'apps.example.test',config:null,limits:{maxTargets:8}}}));
  await open(l.page,l);await expect(l.page.getByText('Managed by the server operator',{exact:true})).toBeVisible();
  await expect(l.page.getByRole('link',{name:'Open HTTPS desktop',exact:true})).toHaveAttribute('href','https://desktop.example.test:8443');
  await expect(l.page.getByRole('button',{name:'Enable gateway',exact:true})).toHaveCount(0);await expect(l.page.getByRole('button',{name:'Disable gateway',exact:true})).toHaveCount(0);
 }finally{await l.close();}
});
