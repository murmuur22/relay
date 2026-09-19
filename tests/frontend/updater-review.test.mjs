import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

for(const outcome of ['held','rejected'])test(`local updater closes independently of ${outcome} unrelated window PATCH`,{timeout:30000},async t=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-updater-close-'),g=await createGateway({port:0,runtime,profile:'development'}),browser=await chromium.launch({headless:true,chromiumSandbox:true});
 let release=()=>{},releaseLaunch=()=>{};t.after(async()=>{release();releaseLaunch();await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});});
 const page=await browser.newPage();await browserLogin(page,g.origin,runtime);
 await page.route('**/api/updater/check',route=>route.fulfill({json:{mode:'fixture',available:[{version:'v0.3.1',verified:true,size:100,notes:'Synthetic close regression'}],canInstall:true,job:null}}));
 await page.getByRole('button',{name:'Open Updater',exact:true}).click();
 const win=page.locator('[data-window-id="system-updater"]');await expect(win).toBeVisible();
 await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:/^Notes Lab/}).click();
 let arrived;const arrival=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);
 await page.route('**/api/windows/notes-lab',async route=>{
  if(route.request().method()!=='PATCH')return route.continue();
  arrived();if(outcome==='held'){const response=await route.fetch();await gate;await route.fulfill({response});}
  else await route.fulfill({status:500,json:{error:'Synthetic unrelated persistence failure'}});
 });
 await page.getByRole('button',{name:'Minimize Notes Lab',exact:true}).click();await arrival;
 if(outcome==='rejected')await expect(page.getByText('Synthetic unrelated persistence failure',{exact:true})).toBeVisible();
 await win.getByRole('button',{name:'Check releases',exact:true}).click();await expect(win).toHaveClass(/focused/);await expect(page).toHaveURL(/app=updater/);
 await expect(win.locator('.chamber canvas')).toBeVisible();
 const launchGate=new Promise(r=>releaseLaunch=r);let launchArrived;const launchArrival=new Promise(r=>launchArrived=r);
 await page.route('**/api/updater/launch',async route=>{launchArrived();await launchGate;await route.fulfill({json:{url:'http://127.0.0.1:1/updater/#'+'a'.repeat(64)}});});
 const popupEvent=page.waitForEvent('popup');await win.getByRole('button',{name:'Start update',exact:true}).click();const popup=await popupEvent;await launchArrival;
 await page.getByRole('button',{name:'Close Updater',exact:true}).click();
 await expect(win).toHaveCount(0,{timeout:1500});assert.equal(new URL(page.url()).search,'');
 releaseLaunch();await expect.poll(()=>popup.isClosed()).toBe(true);
 await expect(page.locator('.updater-browser canvas')).toHaveCount(0);
 release();
});
