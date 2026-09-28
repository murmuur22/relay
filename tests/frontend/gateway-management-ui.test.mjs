// Actual managed-gateway API and compiled browser UI; no mocked deployment responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {chmod,realpath,mkdir,readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {gatewayLab,password,edgeRequest} from '../gateway-helper.mjs';
import {browserLogin} from '../auth-helper.mjs';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
test('real Control Panel enables managed gateway, adds a target app through UI, and disables it without deleting apps',{timeout:60000},async()=>{
 const l=await gatewayLab({gatewayConfig:{desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test'}});let gateway,browser;
 try{
  const dir=await realpath(l.dir),runtime=dir+'/managed-state',port=await freePort();await chmod(dir+'/cert.pem',0o600);await chmod(dir+'/key.pem',0o600);
  gateway=await createGateway({port:0,runtime,profile:'standalone'});
  browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${l.spki}`,'--host-resolver-rules=MAP *.example.test 127.0.0.1','--no-proxy-server']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  await browserLogin(page,gateway.origin,runtime);
  const button=name=>page.getByRole('button',{name,exact:true});
  await button('Open Control Panel').click();await page.getByRole('tab',{name:'Apps',exact:true}).click();await button('Add app').click();
  await button('Next').click();await page.getByLabel('App name',{exact:true}).fill('Preserved Files');await page.getByLabel('Address',{exact:true}).fill('https://draft.example.test');await page.getByRole('combobox',{name:/^Icon/}).selectOption('folder');await button('Back').click();
  await page.getByLabel('Gateway (experimental)',{exact:true}).check();await expect(button('Next')).toBeDisabled();
  await button('Set up Gateway').click();
  await expect(page.getByRole('tab',{name:'Gateway',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByText('Gateway is off',{exact:true})).toBeVisible();
  await button('Return to app draft').click();await expect(page.getByLabel('Gateway (experimental)',{exact:true})).toBeChecked();
  await button('Set up Gateway').click();
  for(const [label,value] of [['Desktop hostname','desktop.example.test'],['App hostname base','apps.example.test'],['HTTPS port',String(port)],['Certificate file on server',dir+'/cert.pem'],['Private key file on server',dir+'/key.pem'],['Target ID','files'],['Target name','UI Files'],['Service address',`http://127.0.0.1:${l.upstream.address().port}`]])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByText('Advanced target options',{exact:true}).click();await page.getByLabel('Target options JSON',{exact:true}).fill(JSON.stringify({entryPath:'/',cookieNames:['sid'],webSocketPaths:['/socket']}));
  await button('Check configuration').click();await expect(page.getByText('Server configuration valid. DNS and browser trust still need checking.',{exact:true})).toBeVisible();
  await button('Enable gateway').click();await page.getByRole('checkbox',{name:'I have configured DNS and HTTPS trust for the intended clients.',exact:true}).check();await page.getByLabel('Current password for gateway changes',{exact:true}).fill(password);await button('Confirm gateway settings').click();
  await expect(page.getByText('Gateway listener is running',{exact:true})).toBeVisible();
  const saved=JSON.parse(await readFile(runtime+'/gateway-managed.json','utf8'));assert.equal(saved.desktopHostname,'desktop.example.test');assert.equal(saved.targets[0].id,'files');assert(!('key' in saved));
  await mkdir('screenshots',{recursive:true});await page.locator('.settings-body').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'screenshots/gateway-settings-running.png'});
  await button('Add a gateway app').click();await button('Next').click();
  await expect(page.getByLabel('App name',{exact:true})).toHaveValue('Preserved Files');await expect(page.getByRole('combobox',{name:/^Icon/})).toHaveValue('folder');
  await page.getByRole('combobox',{name:'Gateway target',exact:true}).selectOption('files');
  await button('Next').click();await button('Next').click();await button('Next').click();await button('Save app').click();await expect(button('Edit app Preserved Files')).toBeVisible();
  await page.getByRole('tab',{name:'Gateway',exact:true}).click();
  const opened=context.waitForEvent('page');await page.getByRole('link',{name:'Open HTTPS desktop',exact:true}).click();const secure=await opened;
  await secure.waitForLoadState('networkidle');
  await secure.keyboard.press('Escape');await expect(secure.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true})).toHaveCount(0);
  await secure.getByLabel('username',{exact:true}).fill('admin');await secure.getByLabel('password',{exact:true}).fill(password);await secure.getByRole('button',{name:'Enter →',exact:true}).click();
  const sb=name=>secure.getByRole('button',{name,exact:true});await sb('Open Control Panel').click();await secure.getByRole('tab',{name:'Apps',exact:true}).click();await sb('Add app').click();
  await secure.getByLabel('Gateway (experimental)',{exact:true}).check();await sb('Next').click();await secure.getByLabel('App name',{exact:true}).fill('UI Files');await secure.getByRole('combobox',{name:'Gateway target',exact:true}).selectOption('files');
  await sb('Next').click();await sb('Next').click();await sb('Next').click();await sb('Save app').click();await expect(sb('Edit app UI Files')).toBeVisible();await sb('Close Control Panel').click();await sb('Open UI Files').click();
  const frame=secure.frameLocator('iframe[title="UI Files"]');await expect(frame.getByRole('heading',{name:'Synthetic Files'})).toBeVisible();const origin=await frame.locator('body').evaluate(()=>location.origin);assert.match(origin,/^https:\/\/[a-f0-9]{32}\.apps\.example\.test:/);
  await button('Disable gateway').click();await page.getByLabel('Current password for gateway changes',{exact:true}).fill(password);await button('Confirm disable').click();await expect(page.getByText('Gateway is off',{exact:true})).toBeVisible();
  assert.deepEqual(JSON.parse(await readFile(runtime+'/gateway-managed.json','utf8')),{version:1,enabled:false});
  await assert.rejects(edgeRequest(l,origin,'/'));
  await page.getByRole('tab',{name:'Apps',exact:true}).click();await expect(button('Edit app UI Files')).toBeVisible();
 }finally{await browser?.close();await gateway?.close();await l.close();}
});
