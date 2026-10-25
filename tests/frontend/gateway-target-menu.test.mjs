import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';
test('Gateway target menu removes only redundant Jellyfin button and preserves generic creation and existing drafts',{timeout:30000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-gateway-menu-');let g,browser;try{g=await createGateway({port:0,runtime,profile:'standalone'});browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(5000);await browserLogin(page,g.origin,runtime);await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Gateway',exact:true}).click();
 await expect(page.getByLabel('Service address',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Add Jellyfin target',exact:true})).toHaveCount(0);
 const first=page.locator('.target').first();await first.getByLabel('Target name',{exact:true}).fill('Configured media');await first.getByLabel('Service address',{exact:true}).fill('http://127.0.0.1:18888');await first.getByText('Advanced target options',{exact:true}).click();const options=await first.getByLabel('Target options JSON',{exact:true}).inputValue();
 await page.getByRole('button',{name:'Add custom target',exact:true}).click();await expect(page.locator('.target')).toHaveCount(1);await expect(page.getByRole('table',{name:'Gateway targets'}).getByRole('row')).toHaveCount(3);await expect(first.getByLabel('Target ID',{exact:true})).toHaveValue('app');
 await page.getByRole('button',{name:'Edit target Configured media',exact:true}).click();await expect(first.getByLabel('Target name',{exact:true})).toHaveValue('Configured media');await expect(first.getByLabel('Service address',{exact:true})).toHaveValue('http://127.0.0.1:18888');await first.getByText('Advanced target options',{exact:true}).click();assert.equal(await first.getByLabel('Target options JSON',{exact:true}).inputValue(),options);
 await page.getByRole('button',{name:'Remove target App',exact:true}).click();await expect(page.getByRole('table',{name:'Gateway targets'}).getByRole('row')).toHaveCount(2);await expect(page.locator('.target')).toHaveCount(0);await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.gateway-settings').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);assert.deepEqual(await(await fetch(g.origin+'/api/gateway/config')).json(),{error:'Authentication required'});
 }finally{await browser?.close();await g?.close();await rm(runtime,{recursive:true,force:true});}
});
