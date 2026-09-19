import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

test('desktop updater does not offer to install the current release', {timeout:20000}, async t => {
 const runtime=await mkdtemp(tmpdir()+'/relay-current-release-');
 const gateway=await createGateway({port:0,runtime,profile:'standalone'});
 const browser=await chromium.launch({chromiumSandbox:true});
 t.after(async()=>{await browser.close();await gateway.close();await rm(runtime,{recursive:true,force:true});});
 const context=await browser.newContext(),page=await context.newPage();
 const snapshot={mode:'fixture',currentVersion:'v1.2.3',canInstall:true,job:null,available:[{version:'v1.2.3',verified:true,size:100,notes:'Synthetic installed release'},{version:'v1.2.4',verified:true,size:110,notes:'Synthetic new release'}]};
 await page.route('**/api/updater/check',route=>route.fulfill({json:snapshot}));
 await page.route('**/api/updater/state',route=>route.fulfill({json:snapshot}));
 await browserLogin(page,gateway.origin,runtime);
 await page.getByRole('button',{name:'Open Updater',exact:true}).click();
 const win=page.locator('[data-window-id="system-updater"]');
 await expect(win.getByLabel('Available release')).toHaveValue('v1.2.3');
 await expect(win.getByRole('button',{name:'Start update',exact:true})).toBeDisabled();
 await expect(win.getByText('This release is already installed.',{exact:true})).toBeVisible();
 await win.getByLabel('Available release').selectOption('v1.2.4');
 await expect(win.getByRole('button',{name:'Start update',exact:true})).toBeEnabled();
 assert.equal(context.pages().length,1);
});
