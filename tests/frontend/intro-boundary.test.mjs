import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate} from '../auth-helper.mjs';

test('opaque intro isolates input and restores login focus without authenticating',{timeout:15000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-intro-boundary-');const g=await createGateway({port:0,runtime});const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  await authenticate(g.origin,runtime);const page=await browser.newPage();await page.emulateMedia({reducedMotion:'no-preference'});
  await page.clock.install({time:new Date('2030-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2030-01-01T00:00:01Z'));await page.goto(g.origin);
  const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});await expect(bypass).toBeVisible();
  const input=page.locator('.login-panel input[autocomplete="username"]');await input.waitFor({state:'attached'});
  await expect(bypass).toBeFocused();
  assert.equal(await input.evaluate(el=>{el.focus();return document.activeElement===el;}),false,'Covered input must not accept focus');
  const box=await input.boundingBox();assert.ok(box);await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await expect(bypass).toBeFocused();
  await page.keyboard.press('Tab');await expect(bypass).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('.signal-intro')).toHaveCount(0);await expect(page.getByLabel('username',{exact:true})).toBeFocused();
  assert.equal((await page.request.get(g.origin+'/api/session')).status(),401);
  assert.equal(await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),false);
  await page.reload();await expect(page.locator('.signal-intro')).toHaveCount(0);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
