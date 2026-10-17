import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
import http from 'node:http';
test('regular user home, keyboard Add app, native frame and explicit gesture new-tab fallback',{timeout:60000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-personal-home-');let g,browser,site;try{
 site=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('X-Frame-Options','DENY');res.end('<!doctype html><title>Synthetic fallback</title><p>New tab fixture</p>');});await new Promise(r=>site.listen(0,'127.0.0.1',r));
 g=await createGateway({port:0,runtime,profile:'standalone'});const api=client(g.origin,await authenticate(g.origin,runtime));await api('/onboarding/complete','POST',{});await api('/admin/users','POST',{username:'viewer',password});
 browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage({viewport:{width:1100,height:800},reducedMotion:'reduce'});page.setDefaultTimeout(4000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(g.origin);await page.getByLabel('username',{exact:true}).fill('viewer');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
 await expect(page.getByRole('link',{name:'Home',exact:true})).toHaveText('~');assert.equal(await page.locator('.path a').count(),1);
 await page.locator('.desktop-grid').focus();await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'Add app',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('My native site');await page.getByLabel('URL',{exact:true}).fill('http://localhost:'+site.address().port+'/');await page.getByRole('button',{name:'Add app',exact:true}).click();
 const shortcut=page.getByRole('button',{name:'Open My native site',exact:true});await expect(shortcut).toBeVisible();await shortcut.dblclick();const win=page.getByRole('region',{name:'My native site window',exact:true});await expect(win.locator('iframe')).toBeVisible();
 const popupPromise=page.waitForEvent('popup');await win.getByRole('link',{name:'Open in new tab',exact:true}).click();const popup=await popupPromise;await popup.waitForLoadState();assert.equal(await popup.title(),'Synthetic fallback');assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();
 await win.locator('iframe').evaluate(el=>el.dataset.identity='same');await page.getByRole('button',{name:'Minimize My native site'}).click();await page.getByRole('button',{name:'Restore My native site',exact:true}).click();await expect(win.locator('iframe')).toHaveAttribute('data-identity','same');
 await mkdir(ROOT+'screenshots',{recursive:true});await page.screenshot({path:ROOT+'screenshots/personal-home-native-fallback.png'});
 await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.locator('.desktop-window iframe')).toHaveCount(0);await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await expect(shortcut).toHaveCount(0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await g?.close();if(site)await new Promise(r=>site.close(r));await rm(runtime,{recursive:true,force:true});}
});
