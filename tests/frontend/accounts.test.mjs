import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {password} from '../auth-helper.mjs';
test('real login, Navigation, Control Panel user/grant, profile and sign out',{timeout:45000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-accounts-ui-');const g=await createGateway({port:0,runtime});const browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await mkdir(ROOT+'screenshots',{recursive:true});
  await page.goto(await readFile(runtime+'/setup-url.txt','utf8'));
  await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create admin',exact:true}).click();
  await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'login',exact:true})).toBeVisible();await page.screenshot({path:ROOT+'screenshots/login.png'});
  await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
  await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.screenshot({path:ROOT+'screenshots/navigation.png'});await page.getByRole('button',{name:'Control Panel',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Control Panel',exact:true})).toBeVisible();
  await page.getByLabel('New username',{exact:true}).fill('alice');await page.getByLabel('Initial password',{exact:true}).fill(password);await page.getByLabel('Grant Parcels',{exact:true}).first().check();await page.getByRole('button',{name:'Create user',exact:true}).click();await expect(page.getByText('alice',{exact:true})).toBeVisible();
  await page.screenshot({path:ROOT+'screenshots/control-panel.png'});
  await page.getByLabel('Service label',{exact:true}).fill('Browser notes');await page.getByRole('button',{name:'Add service',exact:true}).click();
  const record=page.locator('form.control-record').filter({has:page.getByRole('button',{name:'Remove Browser notes',exact:true})});await expect(record).toBeVisible();
  await record.getByRole('checkbox').uncheck();await record.getByRole('textbox').fill('Renamed browser notes');await page.getByRole('button',{name:'Save service Renamed browser notes',exact:true}).click();
  await expect(page.getByText('Service saved.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Open Renamed browser notes',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Remove Renamed browser notes',exact:true}).click();await expect(page.getByText('Service removed.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByLabel('username',{exact:true}).fill('alice');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open Parcels',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Open Keepsakes',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Navigation',exact:true}).click();await expect(page.getByRole('button',{name:'Control Panel',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Profile settings',exact:true}).click();
  await page.getByLabel('Display name',{exact:true}).fill('Alice Example');await page.getByLabel('Current password',{exact:true}).fill(password);await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByText('Profile saved.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();await page.getByRole('button',{name:'Navigation',exact:true}).click();await expect(page.getByText('Alice Example',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
