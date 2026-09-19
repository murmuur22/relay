import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

test('expired settings load unmounts cleanly and restores interactive login',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-settings-expiry-');
 const g=await createGateway({port:0,runtime});
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await browserLogin(page,g.origin,runtime);
  await page.route('**/api/admin/users',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Authentication required'})}));
  await page.getByRole('button',{name:'Navigation',exact:true}).click();
  await page.getByRole('button',{name:'Control Panel',exact:true}).click();
  await expect(page.getByRole('heading',{name:'login',exact:true})).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.getByLabel('username',{exact:true}).fill('another-user');
  assert.deepEqual(errors,[]);
  assert.equal(await page.locator('.desktop').evaluate(el=>el.inert),false);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
