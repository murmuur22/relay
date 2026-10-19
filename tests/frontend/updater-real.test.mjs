import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {networkInterfaces} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import {browserLogin,password} from '../auth-helper.mjs';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
for(const networkMode of ['loopback','private-lan'])test(`${networkMode}: compiled independent maintenance tab exchanges real broker ticket, installs real fixture and survives Relay loss`,{timeout:90000},async t=>{
 const hostname=networkMode==='loopback'?'127.0.0.1':Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address))?.address;
 assert.ok(hostname,'No assigned private IPv4 interface');
 const uiOrigin=`http://${hostname}:${await freePort()}`;
 const script="from updater.fixtures.harness import Sandbox\nfrom updater.broker.auth import atomic_json\nimport sys,json\nbox=Sandbox()\ntry:\n box.config['uiOrigin']=sys.argv[1]\n atomic_json(box.config_path,box.config)\n box.start()\n print(json.dumps({'root':str(box.root),'config':box.config}),flush=True)\n sys.stdin.readline()\nfinally:\n box.close()";
 const child=spawn('python3',['-u','-c',script.replace("box.config['uiOrigin']=sys.argv[1]","box.config['uiOrigin']=sys.argv[1]; box.config['networkMode']=sys.argv[2]"),uiOrigin,networkMode],{cwd:ROOT,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',g,web,browser;child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 t.after(async()=>{await browser?.close();await web?.close();await g?.close();child.stdin.end('\n');if(child.exitCode===null){const timer=setTimeout(()=>child.kill('SIGKILL'),22000);await once(child,'exit');clearTimeout(timer);}});
 await expect.poll(()=>{if(child.exitCode!==null)throw Error(stderr);return stdout.includes('\n');},{timeout:15000}).toBe(true);const {root,config}=JSON.parse(stdout.split('\n')[0]);
 g=await createGateway({port:0,runtime:root+'/browser-relay',profile:'standalone',hostname,networkMode,updater:{socketPath:config.socketPath,keyFile:config.bridgeKeyFile,uiOrigin},maintenanceFile:config.maintenance});
 web=await createUpdaterWeb({uiOrigin,relayOrigin:g.origin,socketPath:config.socketPath,networkMode,bind:hostname});browser=await chromium.launch({headless:true,chromiumSandbox:true});const context=await browser.newContext(),desktop=await context.newPage();await browserLogin(desktop,g.origin,root+'/browser-relay');
 await desktop.getByRole('button',{name:'Open Updater',exact:true}).dblclick();
 const browse=desktop.locator('[data-window-id="system-updater"]');await expect(browse.getByLabel('Available release')).toHaveValue('v0.3.1');assert.equal(context.pages().length,1);
 // A narrow floating window on a wide desktop must stack actual release controls.
 const initial=await browse.boundingBox(),handle=await desktop.getByRole('button',{name:'Resize Updater',exact:true}).boundingBox();
 await desktop.mouse.move(handle.x+4,handle.y+4);await desktop.mouse.down();await desktop.mouse.move(handle.x-500,handle.y+4);await desktop.mouse.up();
 assert.ok(await desktop.evaluate(()=>innerWidth>1000));
 const detail=await browse.locator('.release-detail').boundingBox(),releasePanel=await browse.locator('aside').boundingBox();
 assert.ok(detail.y>=releasePanel.y+releasePanel.height-1,'C release selection must stack above detail in a narrow floating window');
 await browse.getByLabel('Available release').selectOption('v0.3.2');await expect(browse.getByRole('button',{name:'Start update',exact:true})).toBeEnabled();
 await browse.getByRole('button',{name:'Start update',exact:true}).scrollIntoViewIfNeeded();
 assert.equal(await browse.locator('.updater-browser').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 const narrow=await browse.boundingBox(),resize=await desktop.getByRole('button',{name:'Resize Updater',exact:true}).boundingBox();
 await desktop.mouse.move(resize.x+4,resize.y+4);await desktop.mouse.down();await desktop.mouse.move(resize.x+4+initial.width-narrow.width,resize.y+4);await desktop.mouse.up();
 await browse.locator('.updater-browser').evaluate(el=>el.scrollTop=0);
 await expect(browse.getByTestId('release-notes')).not.toBeEmpty();
 // Select the fixture's successful release on the desktop, not in the independent tab.
 const reviewedVersion='v0.3.1';await browse.getByLabel('Available release').selectOption(reviewedVersion);
 const installTargets=[];let installs=0;context.on('request',r=>{if(r.url().endsWith('/api/apply')){installs++;installTargets.push(r.postDataJSON().version);}assert.ok(!r.url().endsWith('/api/install'),'No immediate-install fallback');});
 await desktop.addScriptTag({content:(await readFile(ROOT+'/src/updater.js','utf8')).replaceAll('export ','')});
 const standalone=()=>desktop.evaluate(()=>launchUpdater(async()=>{const session=await(await fetch('/api/session')).json();const response=await fetch('/api/updater/launch',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:'{}'});const body=await response.json();if(!response.ok)throw Error(body.error);return body;},()=>true,window,'v0.3.1').then(()=>'',e=>e.message));
 await desktop.evaluate(()=>{window.realOpen=window.open;window.open=()=>null;});assert.match(await standalone(),/Allow a new tab/);assert.equal(installs,0);await desktop.evaluate(()=>window.open=window.realOpen);
 await expect(browse.locator('.chamber canvas')).toBeVisible();
 for(const reply of [{status:403,json:{error:'Launch denied'}},{status:200,json:{}}]){
  await desktop.route('**/api/updater/launch',route=>route.fulfill(reply));const opening=context.waitForEvent('page');const result=standalone();const rejected=await opening;assert.ok(await result);await expect.poll(()=>rejected.isClosed()).toBe(true);assert.equal(installs,0);await desktop.unroute('**/api/updater/launch');
 }
 let resume;const gate=new Promise(r=>resume=r);let intercepted;const arrived=new Promise(r=>intercepted=r);
 await desktop.route('**/api/updater/launch',async route=>{intercepted();await gate;await route.continue();});
 const closing=context.waitForEvent('page');const result=standalone();const closed=await closing;await arrived;await closed.close();resume();assert.match(await result,/tab closed/);await desktop.unroute('**/api/updater/launch');assert.equal(installs,0);
 await browse.getByRole('button',{name:'Check releases',exact:true}).click();await expect(browse.getByRole('alert')).toHaveCount(0);
 await desktop.screenshot({path:ROOT+'screenshots/updater-desktop-browse-fixture.png'});
 const opened=context.waitForEvent('page');const launched=standalone();const page=await opened;assert.equal(await launched,'');const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.locator('#release-select')).toHaveValue(reviewedVersion);assert.equal(installs,0);
 await page.screenshot({path:ROOT+'screenshots/updater-independent-handoff-fixture.png',fullPage:true});
 // Browsing again must not rotate or invalidate the independent monitoring cookie.
 await browse.getByRole('button',{name:'Check releases',exact:true}).click();await page.reload();await expect(page.locator('#mode')).toHaveText('FIXTURE SANDBOX');
 await expect(page.locator('#mode')).toHaveText('FIXTURE SANDBOX');assert.equal(await page.evaluate(()=>opener),null);assert.equal(new URL(page.url()).hash,'');assert.equal(new URL(page.url()).search,'');await expect(page.locator('#motion-label')).toHaveText('MOTION OFF');
 await page.getByRole('button',{name:'Check releases'}).click();await expect(page.locator('#release-select')).toHaveValue(reviewedVersion);assert.deepEqual(await page.evaluate(()=>history.state),{reviewedVersion});
 await page.getByRole('button',{name:'Download & prepare',exact:true}).click();await page.locator('#confirmed').check();await page.getByLabel('Current Relay password').fill(password);await page.getByRole('button',{name:'Authorize preparation',exact:true}).click();await expect(page.locator('#phase')).toHaveText('Ready to apply',{timeout:30000});
 await page.getByRole('button',{name:'Apply v0.3.1',exact:true}).click();await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#confirmed')).not.toBeChecked();await page.locator('#confirmed').check();await page.getByLabel('Current Relay password').fill(password);await page.getByRole('button',{name:'Authorize Apply',exact:true}).click();await expect(page.locator('#confirm')).not.toBeVisible();await expect(page.locator('#current-version')).toHaveText('v0.3.1',{timeout:30000});
 assert.deepEqual(installTargets,[reviewedVersion]);
 await expect(page.locator('#phase')).toHaveText('Installed');await expect(page.locator('#bytes')).toContainText('bytes');assert.equal(await page.locator('#password').inputValue(),'');
 const staticPage=await context.newPage();await staticPage.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.includes('webgl')?null:original.call(this,type,...args);};});
 await staticPage.goto(g.origin);await staticPage.getByRole('button',{name:'Open Updater',exact:true}).dblclick();const staticBrowse=staticPage.locator('[data-window-id="system-updater"]');await expect(staticBrowse.getByLabel('Available release')).not.toBeEmpty();await expect(staticBrowse.locator('.static-view')).toBeVisible();await expect(staticBrowse.locator('iframe')).toHaveCount(0);
 await staticPage.setViewportSize({width:390,height:844});assert.equal(await staticBrowse.locator('.updater-browser').evaluate(el=>el.scrollWidth<=el.clientWidth),true);await staticPage.screenshot({path:ROOT+'screenshots/updater-desktop-static-narrow-fixture.png'});
 await staticPage.getByRole('button',{name:'Navigation',exact:true}).click();await staticPage.getByRole('button',{name:'Sign out',exact:true}).click();await expect(staticBrowse).toHaveCount(0);await expect(browse).toHaveCount(0,{timeout:7000});await expect(page.locator('#console')).toBeHidden({timeout:7000});await staticPage.close();
 await browserLogin(desktop,g.origin,root+'/browser-relay');const reissued=await desktop.evaluate(async()=>{const session=await(await fetch('/api/session')).json();return(await fetch('/api/updater/launch',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:'{}'})).json();});await page.goto('about:blank');await page.goto(reissued.url);await expect(page.locator('#current-version')).toHaveText('v0.3.1');
 await desktop.close();await g.close();g=null;await page.reload();await expect(page.locator('#mode')).toHaveText('FIXTURE SANDBOX');await expect(page.locator('#current-version')).toHaveText('v0.3.1');
 await page.locator('#release-select').selectOption('v0.3.2');await page.getByRole('button',{name:'Download & prepare'}).click();await page.locator('#confirmed').check();await page.getByLabel('Current Relay password').fill(password);await page.getByRole('button',{name:'Authorize preparation',exact:true}).click();await expect(page.locator('#confirm-error')).toContainText('Read-only monitoring remains available');assert.equal(await page.locator('#password').inputValue(),'');assert.deepEqual(errors,[]);
});
