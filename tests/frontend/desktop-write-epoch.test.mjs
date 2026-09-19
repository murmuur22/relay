import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {browserLogin,authenticate,client,password} from '../auth-helper.mjs';

for(const action of ['Minimize','Close'])test(`queued ${action.toLowerCase()} writes retain their auth epoch, never acquire a later account CSRF`,{timeout:25000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-desktop-write-'),g=await createGateway({port:0,runtime}),browser=await chromium.launch({headless:true,chromiumSandbox:true}),page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(4000);let release,arrive;const barrier=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);const button=name=>page.getByRole('button',{name,exact:true});
 try{await browserLogin(page,g.origin,runtime);const api=client(g.origin,await authenticate(g.origin,runtime));assert.equal((await api('/admin/users','POST',{username:'fresh',password,role:'user',grants:['parcels']})).status,200);await button('Open Parcels').click();
  await page.route('**/api/windows/parcels',async route=>{const response=await route.fetch();arrive();await barrier;await route.fulfill({response});},{times:1});
  await button('Maximize Parcels').click();await arrived;await button(action+' Parcels').click();if(action==='Minimize')await expect(page.locator('[data-app="parcels"]')).toBeHidden();await button('Navigation').click();await button('Sign out').click();await page.getByLabel('username',{exact:true}).fill('fresh');await page.getByLabel('password',{exact:true}).fill(password);await button('Enter →').click();await page.getByRole('link',{name:'Desktop',exact:true}).click();await button('Open Parcels').click();await expect(page.locator('[data-app="parcels"]')).toBeVisible();
  const requests=[];page.on('request',r=>{if(r.method()==='PATCH'&&r.url().endsWith('/api/windows/parcels'))requests.push(r.postDataJSON());});const received=page.waitForResponse(r=>r.url().endsWith('/api/windows/parcels'));release();await received;
  // A real later session poll is a bounded synchronization point after queued jobs drain.
  await page.waitForResponse(r=>r.url()===g.origin+'/api/session');assert.equal(requests.some(p=>p.visible===false),false,'old minimize must not be sent as the new user');const session=await page.evaluate(async()=>await(await fetch('/api/session')).json());assert.equal(session.windows.find(w=>w.appId==='parcels').visible,true);
 }finally{release();await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
