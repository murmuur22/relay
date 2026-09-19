import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

test('touch/keyboard actions, folder nesting, snapped swap and new-session persistence',{timeout:45000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-desktop-organize-'),g=await createGateway({port:0,runtime}),browser=await chromium.launch({headless:true,chromiumSandbox:true}),page=await browser.newPage({viewport:{width:1000,height:850},hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(4000);const button=name=>page.getByRole('button',{name,exact:true});
 const read=()=>page.evaluate(async()=>await(await fetch('/api/desktop')).json());
 const create=async name=>{await button('Navigation').click();await button('New folder').click();await page.getByLabel('Folder name').fill(name);await button('Create folder').click();await expect(button('Open '+name)).toBeVisible();};
 const drag=async(from,to)=>{const a=await button('Open '+from).boundingBox(),b=await button('Open '+to).boundingBox();await page.mouse.move(a.x+50,a.y+45);await page.mouse.down();await page.mouse.move(b.x+50,b.y+45,{steps:8});await page.mouse.up();};
 try{await browserLogin(page,g.origin,runtime);await expect(button('Open Parcels')).toBeVisible();
  await button('Actions for Parcels').tap();await page.getByRole('menuitem',{name:'Rename',exact:true}).tap();await page.getByLabel('Name',{exact:true}).fill('Personal delivery');await button('Save').tap();await expect(button('Open Personal delivery')).toBeVisible();
  await create('One');await create('Two');await drag('Two','One');await expect(button('Open Two')).toHaveCount(0);await button('Open One').click();await expect(button('Open Two')).toBeVisible();await page.getByRole('link',{name:'Desktop',exact:true}).click();
  const before=await read();const a=before.items.find(i=>i.appId==='parcels'),b=before.items.find(i=>i.appId==='keepsakes');await drag('Personal delivery','Keepsakes');await expect.poll(async()=>(await read()).items.find(i=>i.id===a.id).slot).toBe(b.slot);assert.equal((await read()).items.find(i=>i.id===b.id).slot,a.slot);
  await button('Actions for Personal delivery').tap();await page.getByRole('menuitem',{name:'Move to…',exact:true}).tap();await page.getByLabel('Destination').selectOption({label:'One / Two'});await button('Save').tap();await expect(button('Open Personal delivery')).toHaveCount(0);
  await button('Open One').click();await button('Actions for Two').tap();await page.getByRole('menuitem',{name:'Remove folder',exact:true}).tap();await expect(page.getByText(/Contents move up one level/)).toBeVisible();await button('Cancel').tap();await expect(button('Open Two')).toBeVisible();await button('Actions for Two').tap();await page.getByRole('menuitem',{name:'Remove folder',exact:true}).tap();await button('Remove folder').tap();await expect(button('Open Personal delivery')).toBeVisible();await expect(button('Open Two')).toHaveCount(0);
  const one=page.url();await page.reload();await expect(button('Open Personal delivery')).toBeVisible();await button('Navigation').click();await button('Sign out').click();await browserLogin(page,g.origin,runtime);await page.goto(one);await expect(button('Open Personal delivery')).toBeVisible();
  await button('Actions for Personal delivery').click();await page.getByRole('menuitem',{name:'Reset appearance',exact:true}).click();await expect(button('Open Parcels')).toBeVisible();
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
