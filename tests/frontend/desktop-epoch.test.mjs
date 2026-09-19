import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {browserLogin,authenticate,client,password} from '../auth-helper.mjs';

for(const expired of [false,true])test(`delayed real desktop ${expired?'401':'owner response'} cannot replace or lock a newer account`,{timeout:25000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-desktop-epoch-'),g=await createGateway({port:0,runtime}),browser=await chromium.launch({headless:true,chromiumSandbox:true}),page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(4000);let release;const barrier=new Promise(r=>release=r);let capturedResolve;const captured=new Promise(r=>capturedResolve=r);let oldCookie='',response;const errors=[];page.on('pageerror',e=>errors.push(e.message));const button=name=>page.getByRole('button',{name,exact:true});
 try{await browserLogin(page,g.origin,runtime);const admin=await authenticate(g.origin,runtime),api=client(g.origin,admin);assert.equal((await api('/admin/users','POST',{username:'nextuser',password,role:'user',grants:['parcels']})).status,200);assert.equal((await api('/desktop/folders','POST',{label:'Old private folder',parentId:null})).status,200);await page.reload();await expect(button('Open Old private folder')).toBeVisible();
  await page.route('**/api/desktop',async route=>{oldCookie=(await route.request().allHeaders()).cookie;response=await route.fetch();capturedResolve();await barrier;if(expired){const denied=await fetch(g.origin+'/api/desktop',{headers:{cookie:oldCookie}});assert.equal(denied.status,401);await route.fulfill({status:denied.status,contentType:'application/json',body:await denied.text()});}else await route.fulfill({response});},{times:1});
  await captured;await button('Navigation').click();await button('Sign out').click();await page.getByLabel('username',{exact:true}).fill('nextuser');await page.getByLabel('password',{exact:true}).fill(password);await button('Enter →').click();await expect(button('Open Parcels')).toBeVisible();await expect(button('Open Old private folder')).toHaveCount(0);const finished=page.waitForResponse(r=>r.url()===g.origin+'/api/desktop'&&r.status()===(expired?401:200));release();await finished;await expect(button('Navigation')).toBeVisible();await expect(button('Open Old private folder')).toHaveCount(0);await expect(page.getByRole('heading',{name:'login',exact:true})).toHaveCount(0);assert.deepEqual(errors,[]);
 }finally{release();await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
