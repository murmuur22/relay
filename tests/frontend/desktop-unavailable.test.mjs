import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

test('unavailable private locations are visible without destroying existing windows',{timeout:15000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-desktop-unavailable-');const g=await createGateway({port:0,runtime});const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});await browserLogin(page,g.origin,runtime);await page.getByRole('button',{name:'Open Parcels',exact:true}).click();await page.getByRole('button',{name:'Maximize Parcels',exact:true}).click();await expect.poll(()=>new URL(page.url()).search).toContain('view=maximized');
  const frame=await page.locator('[data-app="parcels"] iframe').elementHandle();
  await page.evaluate(()=>{history.pushState(null,'','/desktop/missing--deadbeef');dispatchEvent(new PopStateEvent('popstate'));});
  const message=page.getByText('This location is unavailable.',{exact:true});await expect(message).toBeVisible();
  assert.equal(await message.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'An old maximized window must not cover the unavailable route');
  await expect(page.locator('[data-app="parcels"] iframe')).toHaveCount(1);await expect(page.locator('[data-app="parcels"] iframe')).not.toBeVisible();
  await page.getByRole('link',{name:'Desktop',exact:true}).click();await expect(page.getByRole('button',{name:'Maximize Parcels',exact:true})).toBeVisible();
  assert.equal(await page.locator('[data-app="parcels"] iframe').evaluate((el,previous)=>el===previous,frame),true);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
