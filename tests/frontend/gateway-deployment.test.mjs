import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {gatewayLab,password,addGateway} from '../gateway-helper.mjs';
test('compiled desktop launches gateway on configured names and refuses launch from management HTTP',{timeout:45000},async()=>{
 const lab=await gatewayLab({gatewayConfig:{desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test'}});let browser;
 try{
  assert.equal(new URL(lab.relay.experimentalGateway.desktopOrigin).hostname,'desktop.example.test');
  await addGateway(lab);
  browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${lab.spki}`,'--host-resolver-rules=MAP *.example.test 127.0.0.1','--no-proxy-server']});
  const page=await browser.newPage();
  async function login(origin){
   await page.goto(origin);const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.count())await bypass.click();
   await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await expect(page.getByRole('button',{name:'Navigation',exact:true})).toBeVisible();
  }
  await login(lab.relay.experimentalGateway.desktopOrigin);
  await page.getByRole('button',{name:'Open Files',exact:true}).click();
  const frame=page.frameLocator('iframe[title="Files"]');
  await expect(frame.getByRole('heading',{name:'Synthetic Files'})).toBeVisible();
  assert.match(await frame.locator('body').evaluate(()=>location.hostname),/^[a-f0-9]{32}\.apps\.example\.test$/);
  await page.getByRole('button',{name:'End app session',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(0);
  await login(lab.relay.origin); // The persisted open window restores on login.
  await expect(page.getByRole('region',{name:'Files window',exact:true})).toBeVisible();
  await expect(page.getByText('Open the administrator-configured HTTPS desktop to use Gateway apps.',{exact:true})).toBeVisible();
  assert.equal(lab.relay.experimentalGateway.stats().routes,0);
 }finally{await browser?.close();await lab.close();}
});
