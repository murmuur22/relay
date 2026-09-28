// UI contract fixture only: deployment operations are mocked here; separate integration uses real APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';
async function lab(){const runtime=await mkdtemp(tmpdir()+'/relay-gateway-ui-');const gateway=await createGateway({port:0,runtime,profile:'standalone'});const browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(5000);return {page,gateway,runtime,async close(){await browser.close();await gateway.close();await rm(runtime,{recursive:true,force:true});}};}
async function open(page,l){await browserLogin(page,l.gateway.origin,l.runtime);await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Gateway',exact:true}).click();}
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
