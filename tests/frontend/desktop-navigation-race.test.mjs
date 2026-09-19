import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

for(const target of ['folder','app'])test(`new ${target} navigation cancels an older maximize reconciliation waiting on focus`,{timeout:20000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-navigation-race-');const g=await createGateway({port:0,runtime});const browser=await chromium.launch({headless:true,chromiumSandbox:true});let release,timer;
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});await browserLogin(page,g.origin,runtime);const button=name=>page.getByRole('button',{name,exact:true});
  await button('Open Parcels').click();await expect.poll(()=>new URL(page.url()).search).toContain('app=parcels--');await button('Maximize Parcels').click();const restored=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/windows/parcels'&&r.request().method()==='PATCH'&&r.request().postDataJSON()?.maximized===false);await button('Restore size Parcels').click();await restored;await button('Navigation').click();await page.locator('.quick-nav').getByRole('button').filter({hasText:'Keepsakes'}).click();await expect.poll(()=>new URL(page.url()).search).toContain('app=keepsakes--');
  let entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let held=false;
  await page.route('**/api/windows/parcels',async route=>{const body=route.request().postDataJSON();if(!held&&route.request().method()==='PATCH'&&body?.focused===true&&body.maximized===undefined){held=true;const response=await route.fetch();entered();await gate;await route.fulfill({response}).catch(()=>{});}else await route.continue();});
  await page.evaluate(()=>history.go(-2));await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Expected delayed focus PATCH was not issued')),3000);})]);clearTimeout(timer);
  if(target==='folder'){await page.getByRole('link',{name:'Desktop',exact:true}).click();await expect.poll(()=>new URL(page.url()).search).toBe('');}
  else{await button('Navigation').click();await page.locator('.quick-nav').getByRole('button').filter({hasText:'Keepsakes'}).click();await expect.poll(()=>new URL(page.url()).search).toContain('app=keepsakes--');}
  let detected;const obsolete=new Promise(r=>detected=r);page.on('request',req=>{if(req.url()===g.origin+'/api/windows/parcels'&&req.method()==='PATCH'&&req.postDataJSON()?.maximized===true)detected(true);});
  release();const bad=await Promise.race([obsolete,new Promise(r=>{timer=setTimeout(()=>r(false),1000);})]);clearTimeout(timer);
  assert.equal(bad,false,'Obsolete history operation must not issue maximize after newer navigation');
  await expect(button('Maximize Parcels')).toBeVisible();assert.equal(g.manager.windows.get('parcels').maximized,false);
 }finally{release?.();clearTimeout(timer);await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
