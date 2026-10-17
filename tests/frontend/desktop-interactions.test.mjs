import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

test('compiled desktop selects without launching; Profile is a scrim-contained dialog',{timeout:40000},async()=>{
 const runtime=await mkdtemp(process.env.TMPDIR+'/r67f-'),g=await createGateway({port:0,runtime,profile:'standalone'}),browser=await chromium.launch({headless:true,chromiumSandbox:true}),page=await browser.newPage({viewport:{width:1100,height:850},reducedMotion:'reduce'});page.setDefaultTimeout(3000);
 const button=name=>page.getByRole('button',{name,exact:true});
 try{await browserLogin(page,g.origin,runtime);
  await expect(button('Open Control Panel').locator('svg')).toHaveAttribute('data-icon','pixel-monitor');await expect(button('Open Updater').locator('svg')).toHaveAttribute('data-icon','pixel-git-branch');
  await button('Open Control Panel').click();
  await expect(button('Open Control Panel')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-window-id="system-control-panel"]')).toHaveCount(0);
  await button('Open Updater').click({modifiers:['Shift']});
  await expect(button('Open Updater')).toHaveAttribute('aria-pressed','true');
  await expect(button('Open Control Panel')).toHaveAttribute('aria-pressed','true');
  await button('Navigation').click();await button('Navigation Hotkeys').click();
  await expect(page.getByRole('dialog',{name:'Navigation Hotkeys'})).toBeVisible();await expect(page.getByText('Current screen: Desktop',{exact:true})).toBeVisible();await expect(page.getByText('Select all visible items',{exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await button('Navigation').click();await button('Profile settings').click();
  const dialog=page.getByRole('dialog',{name:'Profile settings'});await expect(dialog).toBeVisible();
  assert.equal(await page.locator('.settings-scrim').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0.6)');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(button('Navigation')).toBeFocused();
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
