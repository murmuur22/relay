import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';

test('settings retain drafts across pages and search the displayed user status',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-settings-drafts-');const g=await createGateway({port:0,runtime});const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
  const user=await (await api('/admin/users','POST',{username:'alice',password})).json();
  await api('/admin/users/'+user.id,'PATCH',{password:password+'reset'});
  const page=await browser.newPage();const [name,value]=auth.cookie.split('=');await page.context().addCookies([{name,value,url:g.origin}]);await page.goto(g.origin);
  await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();
  await page.getByLabel('Search users').fill('Password reset');await expect(page.getByRole('table',{name:'Users',exact:true}).getByRole('rowheader',{name:'alice',exact:true})).toBeVisible();
  await page.getByLabel('Search users').fill('active');await expect(page.getByRole('table',{name:'Users',exact:true}).getByRole('rowheader',{name:'alice',exact:true})).toHaveCount(0);
  await page.getByLabel('Search users').fill('');await page.getByRole('button',{name:'New user',exact:true}).click();await page.getByLabel('New username').fill('draftuser');
  await page.getByRole('tab',{name:'Users',exact:true}).click();await expect(page.getByLabel('New username')).toHaveValue('draftuser');
  await page.getByRole('tab',{name:'Services',exact:true}).click();await page.getByRole('tab',{name:'Users',exact:true}).click();await expect(page.getByLabel('New username')).toHaveValue('draftuser');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.getByLabel('New username').count(),0);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
