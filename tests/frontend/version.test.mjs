import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

test('package, visible site version, diagnostics and changelog stay in sync',async()=>{
 const pkg=JSON.parse(await readFile(ROOT+'package.json','utf8'));
 const lock=JSON.parse(await readFile(ROOT+'package-lock.json','utf8'));
 assert.match(pkg.version,/^\d+\.\d+\.\d+$/);assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
 const changelog=await readFile(ROOT+'CHANGELOG.md','utf8');assert.ok(changelog.includes(`## [${pkg.version}]`));assert.ok(changelog.includes('## [Unreleased]'));assert.ok(changelog.includes('## [0.1.0]'));
 const runtime=await mkdtemp(tmpdir()+'/relay-version-');const g=await createGateway({port:0,runtime});const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(g.origin);
  await expect(page.locator('footer .app-version')).toHaveText('v'+pkg.version);await expect(page.locator('footer .app-version')).toBeVisible();
  await browserLogin(page,g.origin,runtime);await expect(page.getByRole('button',{name:'Open Parcels',exact:true})).toBeVisible();
  await expect(page.locator('footer .app-version')).toHaveText('v'+pkg.version);await expect(page.locator('footer .app-version')).toBeVisible();
  const diagnostics=await(await page.request.get(g.origin+'/api/admin/diagnostics')).json();assert.equal(diagnostics.version,pkg.version);
  await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Profile settings',exact:true}).click();
  await expect(page.locator('.profile-version')).toHaveText('Version '+pkg.version);
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.profile-version')).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();await page.getByRole('tab',{name:'System',exact:true}).click();
  await expect(page.locator('.diagnostic-grid > div').filter({has:page.getByText('Version',{exact:true})}).locator('dd')).toHaveText(pkg.version);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
