import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {chromium,expect} from '@playwright/test';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import {browserLogin,password} from '../auth-helper.mjs';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('compiled independent maintenance tab exchanges real broker ticket, installs real fixture and survives Relay loss',{timeout:60000},async t=>{
 const uiOrigin=`http://127.0.0.1:${await freePort()}`;
 const script="from updater.fixtures.harness import Sandbox\nfrom updater.broker.auth import atomic_json\nimport sys,json\nbox=Sandbox()\ntry:\n box.config['uiOrigin']=sys.argv[1]\n atomic_json(box.config_path,box.config)\n box.start()\n print(json.dumps({'root':str(box.root),'config':box.config}),flush=True)\n sys.stdin.readline()\nfinally:\n box.close()";
 const child=spawn('python3',['-u','-c',script,uiOrigin],{cwd:ROOT,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',g,web,browser;child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 t.after(async()=>{await browser?.close();await web?.close();await g?.close();child.stdin.end('\n');if(child.exitCode===null){const timer=setTimeout(()=>child.kill('SIGKILL'),22000);await once(child,'exit');clearTimeout(timer);}});
 await expect.poll(()=>{if(child.exitCode!==null)throw Error(stderr);return stdout.includes('\n');},{timeout:15000}).toBe(true);const {root,config}=JSON.parse(stdout.split('\n')[0]);
 g=await createGateway({port:0,runtime:root+'/browser-relay',profile:'standalone',updater:{socketPath:config.socketPath,keyFile:config.bridgeKeyFile,uiOrigin},maintenanceFile:config.maintenance});
 web=await createUpdaterWeb({uiOrigin,relayOrigin:g.origin,socketPath:config.socketPath});browser=await chromium.launch({headless:true,chromiumSandbox:true});const context=await browser.newContext(),desktop=await context.newPage();await browserLogin(desktop,g.origin,root+'/browser-relay');
 await desktop.getByRole('button',{name:'Open Updater',exact:true}).click();
 const browse=desktop.locator('[data-window-id="system-updater"]');await expect(browse.getByLabel('Available release')).toHaveValue('v0.3.1');assert.equal(context.pages().length,1);
 // A narrow floating window on a wide desktop must stack actual release controls.
 const initial=await browse.boundingBox(),handle=await desktop.getByRole('button',{name:'Resize Updater',exact:true}).boundingBox();
 await desktop.mouse.move(handle.x+4,handle.y+4);await desktop.mouse.down();await desktop.mouse.move(handle.x-500,handle.y+4);await desktop.mouse.up();
 assert.ok(await desktop.evaluate(()=>innerWidth>1000));
 const transfer=await browse.locator('.transfer').boundingBox(),releasePanel=await browse.locator('aside').boundingBox();
 assert.ok(releasePanel.y>=transfer.y+transfer.height-1,'Release controls must stack below transfer in a narrow floating window');
 await browse.getByLabel('Available release').selectOption('v0.3.2');await expect(browse.getByRole('button',{name:'Start update',exact:true})).toBeEnabled();
 await browse.getByRole('button',{name:'Start update',exact:true}).scrollIntoViewIfNeeded();
 assert.equal(await browse.locator('.updater-browser').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 const narrow=await browse.boundingBox(),resize=await desktop.getByRole('button',{name:'Resize Updater',exact:true}).boundingBox();
 await desktop.mouse.move(resize.x+4,resize.y+4);await desktop.mouse.down();await desktop.mouse.move(resize.x+4+initial.width-narrow.width,resize.y+4);await desktop.mouse.up();
 await browse.locator('.updater-browser').evaluate(el=>el.scrollTop=0);
 await expect(browse.getByTestId('release-notes')).not.toBeEmpty();
 // Select the fixture's successful release on the desktop, not in the independent tab.
 const reviewedVersion='v0.3.1';await browse.getByLabel('Available release').selectOption(reviewedVersion);
 const installTargets=[];let installs=0;context.on('request',r=>{if(r.url().endsWith('/api/install')){installs++;installTargets.push(r.postDataJSON().version);}});
 await desktop.evaluate(()=>{window.realOpen=window.open;window.open=()=>null;});await browse.getByRole('button',{name:'Start update',exact:true}).click();await expect(browse.getByRole('alert')).toContainText('Allow a new tab');assert.equal(installs,0);await desktop.evaluate(()=>window.open=window.realOpen);
 await expect(browse.locator('.chamber canvas')).toBeVisible();
 for(const reply of [{status:403,json:{error:'Launch denied'}},{status:200,json:{}}]){
  await desktop.route('**/api/updater/launch',route=>route.fulfill(reply));const opening=context.waitForEvent('page');await browse.getByRole('button',{name:'Start update',exact:true}).click();const rejected=await opening;await expect.poll(()=>rejected.isClosed()).toBe(true);assert.equal(installs,0);await desktop.unroute('**/api/updater/launch');
 }
 let resume;const gate=new Promise(r=>resume=r);let intercepted;const arrived=new Promise(r=>intercepted=r);
 await desktop.route('**/api/updater/launch',async route=>{intercepted();await gate;await route.continue();});
 const closing=context.waitForEvent('page');await browse.getByRole('button',{name:'Start update',exact:true}).click();const closed=await closing;await arrived;await closed.close();resume();await expect(browse.getByRole('alert')).toContainText('tab closed');await desktop.unroute('**/api/updater/launch');assert.equal(installs,0);
 await browse.getByRole('button',{name:'Check releases',exact:true}).click();await expect(browse.getByRole('alert')).toHaveCount(0);
 await desktop.screenshot({path:ROOT+'screenshots/updater-desktop-browse-fixture.png'});
 const opened=context.waitForEvent('page');await browse.getByRole('button',{name:'Start update',exact:true}).click();const page=await opened;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.locator('#release-select')).toHaveValue(reviewedVersion);assert.equal(installs,0);
 await page.screenshot({path:ROOT+'screenshots/updater-independent-handoff-fixture.png',fullPage:true});
 // Browsing again must not rotate or invalidate the independent monitoring cookie.
 await browse.getByRole('button',{name:'Check releases',exact:true}).click();await page.reload();await expect(page.locator('#mode')).toHaveText('FIXTURE SANDBOX');
 await expect(page.locator('#mode')).toHaveText('FIXTURE SANDBOX');assert.equal(await page.evaluate(()=>opener),null);assert.equal(new URL(page.url()).hash,'');assert.equal(new URL(page.url()).search,'');await expect(page.locator('#motion-label')).toHaveText('MOTION OFF');
 await page.getByRole('button',{name:'Check releases'}).click();await expect(page.locator('#release-select')).toHaveValue(reviewedVersion);assert.deepEqual(await page.evaluate(()=>history.state),{reviewedVersion});
 await page.getByRole('button',{name:'Review installation'}).click();await page.locator('#confirmed').check();await page.getByLabel('Current Relay password').fill(password);await page.getByRole('button',{name:'Authorize installation',exact:true}).click();await expect(page.locator('#confirm')).not.toBeVisible();await expect(page.locator('#current-version')).toHaveText('v0.3.1',{timeout:30000});
 assert.deepEqual(installTargets,[reviewedVersion]);
 await expect(page.locator('#phase')).toContainText(/complete|succeed/i);await expect(page.locator('#bytes')).toContainText('bytes');assert.equal(await page.locator('#password').inputValue(),'');
 const staticPage=await context.newPage();await staticPage.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.includes('webgl')?null:original.call(this,type,...args);};});
 await staticPage.goto(g.origin);await staticPage.getByRole('button',{name:'Open Updater',exact:true}).click();const staticBrowse=staticPage.locator('[data-window-id="system-updater"]');await expect(staticBrowse.getByLabel('Available release')).not.toBeEmpty();await expect(staticBrowse.locator('.chamber svg')).toBeVisible();await expect(staticBrowse.locator('iframe')).toHaveCount(0);
 await staticPage.setViewportSize({width:390,height:844});assert.equal(await staticBrowse.locator('.updater-browser').evaluate(el=>el.scrollWidth<=el.clientWidth),true);await staticPage.screenshot({path:ROOT+'screenshots/updater-desktop-static-narrow-fixture.png'});
 await staticPage.getByRole('button',{name:'Navigation',exact:true}).click();await staticPage.getByRole('button',{name:'Sign out',exact:true}).click();await expect(staticBrowse).toHaveCount(0);await expect(browse).toHaveCount(0,{timeout:7000});await expect(page.locator('#current-version')).toHaveText('v0.3.1');await staticPage.close();
 await desktop.close();await g.close();g=null;await page.reload();await expect(page.locator('#mode')).toHaveText('FIXTURE SANDBOX');await expect(page.locator('#current-version')).toHaveText('v0.3.1');
 await page.locator('#release-select').selectOption('v0.3.2');await page.getByRole('button',{name:'Review installation'}).click();await page.locator('#confirmed').check();await page.getByLabel('Current Relay password').fill(password);await page.getByRole('button',{name:'Authorize installation',exact:true}).click();await expect(page.locator('#confirm-error')).toContainText('Read-only monitoring remains available');assert.equal(await page.locator('#password').inputValue(),'');assert.deepEqual(errors,[]);
});
