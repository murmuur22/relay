// Compiled UI contract: synthetic validation/mutation responses, genuine Relay login.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';
test('gateway consent is keyboard focused, invalidated by edits, and fail-closed after a lost apply response',{timeout:30000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-consent-'),g=await createGateway({port:0,runtime,profile:'standalone'}),browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});page.setDefaultTimeout(4000);let mutations=0;
  await browserLogin(page,g.origin,runtime);
  await page.route('**/api/admin/gateway/validate',r=>r.fulfill({json:{valid:true}}));
  await page.route('**/api/admin/gateway',r=>r.request().method()==='GET'?r.fulfill({json:{source:'disabled',enabled:false,config:null}}):(mutations++,r.abort('failed')));
  const b=name=>page.getByRole('button',{name,exact:true});
  await b('Open Control Panel').click();await page.getByRole('tab',{name:'Gateway',exact:true}).click();
  await page.getByLabel('Service address',{exact:true}).fill('http://127.0.0.1:8096');
  await b('Check configuration').click();await b('Enable gateway').click();
  const password=page.getByLabel('Current password for gateway changes',{exact:true});await expect(password).toBeFocused();
  await expect(b('Confirm gateway settings')).toBeDisabled();await password.fill('Synthetic-consent-password');await expect(b('Confirm gateway settings')).toBeDisabled();
  await page.getByRole('checkbox',{name:'I have configured DNS and HTTPS trust for the intended clients.',exact:true}).check();await expect(b('Confirm gateway settings')).toBeEnabled();
  await page.getByLabel('Target name',{exact:true}).fill('Changed synthetic target');await expect(password).toHaveCount(0);await expect(b('Enable gateway')).toBeDisabled();assert.equal(mutations,0);
  await b('Check configuration').click();await b('Enable gateway').click();await password.fill('Synthetic-consent-password');await page.getByRole('checkbox').check();await b('Confirm gateway settings').click();
  await expect(page.getByText('Refresh gateway status before trying again.',{exact:true})).toBeVisible();await expect(b('Enable gateway')).toBeDisabled();assert.equal(mutations,1);await expect(password).toHaveCount(0);
  await b('Refresh gateway status').click();await expect(b('Check configuration')).toBeEnabled();await expect(b('Enable gateway')).toBeDisabled();
  const win=page.locator('[data-window-id="system-control-panel"]'),handle=await b('Resize Control Panel').boundingBox();await page.mouse.move(handle.x+4,handle.y+4);await page.mouse.down();await page.mouse.move(handle.x-490,handle.y);await page.mouse.up();
  assert.equal(await win.locator('.settings-body').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await expect(page.getByText('Advanced target options',{exact:true})).toBeVisible();assert.equal(await page.locator('.target details').getAttribute('open'),null);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
