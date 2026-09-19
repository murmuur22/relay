import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client} from '../auth-helper.mjs';

test('first-app retry after a committed response is lost does not duplicate registration',{timeout:20000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-first-app-retry-');const g=await createGateway({port:0,runtime});const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);await api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false});
  const page=await browser.newPage({reducedMotion:'reduce'});const [name,value]=auth.cookie.split('=');await page.context().addCookies([{name,value,url:g.origin}]);await page.goto(g.origin);
  const button=name=>page.getByRole('button',{name,exact:true});await expect(button('Add app')).toBeVisible();await expect(page.locator('footer')).toContainText('first-run setup');await button('Add app').click();await button('Next').click();await page.getByLabel('App name',{exact:true}).fill('Retry fixture');await page.getByLabel('Address',{exact:true}).fill('http://client-only.invalid/');await button('Next').click();await button('Next').click();await button('Next').click();
  let lose=true;await page.route(url=>['/api/admin/apps','/api/onboarding/app'].includes(url.pathname),async route=>{if(route.request().method()==='POST'&&lose){lose=false;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');}else await route.continue();});
  await button('Save app').click();await expect(page.getByRole('alert')).toContainText('Gateway unreachable');
  assert.equal((await(await api('/admin/apps')).json()).filter(a=>a.label==='Retry fixture').length,1);
  await button('Save app').click();await expect(button('Open Retry fixture').first()).toBeVisible();
  assert.equal((await(await api('/admin/apps')).json()).filter(a=>a.label==='Retry fixture').length,1);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
