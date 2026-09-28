import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';
test('unavailable Gateway metadata is not reported as disabled and can be retried without losing the app draft',{timeout:20000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-discovery-'),g=await createGateway({port:0,runtime,profile:'standalone'}),browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();await browserLogin(page,g.origin,runtime);
  const b=name=>page.getByRole('button',{name,exact:true});await b('Open Control Panel').click();await page.getByRole('tab',{name:'Apps',exact:true}).click();await expect(b('Add app')).toBeEnabled();
  await page.route('**/api/gateway/config',r=>r.fulfill({status:503,json:{error:'Synthetic metadata unavailable'}}));await b('Add app').click();await page.getByLabel('Gateway (experimental)',{exact:true}).check();
  await expect(page.getByRole('alert')).toContainText('Gateway status could not be read');await expect(page.getByText(/Gateway needs one-time setup/)).toHaveCount(0);await expect(b('Next')).toBeDisabled();
  await page.unroute('**/api/gateway/config');await b('Refresh Gateway options').click();await expect(page.getByText(/Gateway needs one-time setup/)).toBeVisible();await expect(page.getByLabel('Gateway (experimental)',{exact:true})).toBeChecked();await expect(b('Set up Gateway')).toBeVisible();
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
