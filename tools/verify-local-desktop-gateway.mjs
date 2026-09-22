// Opt-in local real-service check through the NORMAL Relay desktop (not /proof).
// Requires only the existing synthetic Docker fixtures on localhost18196/18302.
import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {homedir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {gatewayLab,password,edgeRequest} from '../tests/gateway-helper.mjs';import {authenticate,client} from '../tests/auth-helper.mjs';
for(const [port,path] of [[18196,'/health'],[18302,'/']]){const r=await fetch('http://127.0.0.1:'+port+path,{signal:AbortSignal.timeout(3000)});assert(r.ok,'Local fixture not ready');await r.body?.cancel();}
const targets=[
 {id:'files',label:'Local Files',upstream:'http://127.0.0.1:18302',entryPath:'/',cookieNames:['auth'],requestHeaders:['x-auth','x-encoding','tus-resumable','upload-length','upload-offset','upload-metadata'],responseHeaders:['tus-resumable','upload-offset','upload-length','upload-expires'],webSocketPaths:[],allowDownloads:true,allowPopups:true,authProfile:{login:{method:'POST',path:'/api/login',status:200,contentType:'text/plain'},maxBytes:8192,ttlMs:180000,cookie:'auth',headers:[{name:'x-auth',prefix:''}],stripHeaders:['authorization']}},
 {id:'jellyfin',label:'Local Jellyfin',upstream:'http://127.0.0.1:18196',entryPath:'/web/index.html',cookieNames:[],requestHeaders:['x-emby-authorization','x-mediabrowser-token','x-emby-token'],webSocketPaths:['/socket']}
];
const l=await gatewayLab({targets});let browser,stage='setup';
try{
 const filesCredentials=JSON.parse(await readFile(homedir()+'/.hermes/test-labs/service-matrix/file-viewer.json','utf8'));
 const jf=JSON.parse(await readFile(homedir()+'/.hermes/test-labs/jellyfin-gateway/credentials.json','utf8'));
 const user=await(await l.api('/admin/users','POST',{username:'alice',password})).json();assert(user.id);
 for(const target of targets){const r=await l.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:target.label,gateway:{target:target.id},userIds:[user.id]});assert.equal(r.status,200);}
 const a=await authenticate(l.relay.origin,l.dir+'/state','alice');const api=client(l.relay.origin,a);assert.equal((await api('/preferences','PATCH',{showAppStatus:false,introAnimation:false,interfaceAnimations:false})).status,200);await api('/logout','POST');
 browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${l.spki}`,'--host-resolver-rules=MAP *.relay.test 127.0.0.1','--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();const origins=new Set();context.on('request',r=>origins.add(new URL(r.url()).origin));
 const button=name=>page.getByRole('button',{name,exact:true});
 await page.goto(l.relay.experimentalGateway.desktopOrigin);const bypass=button('[ESC] BYPASS INITIALIZATION');if(await bypass.count())await bypass.click();
 await page.getByLabel('username',{exact:true}).fill('alice');await page.getByLabel('password',{exact:true}).fill(password);await button('Enter →').click();await expect(button('Navigation')).toBeVisible();
 stage='File Browser';await button('Open Local Files').click();const files=page.frameLocator('iframe[title="Local Files"]');await files.getByPlaceholder('Username',{exact:true}).fill(filesCredentials.username);await files.getByPlaceholder('Password',{exact:true}).fill(filesCredentials.password);await files.locator('input[type=submit]').click();await files.getByPlaceholder('Username',{exact:true}).waitFor({state:'hidden',timeout:15000});
 const old=await files.locator('body').evaluate(()=>location.origin),oldCap=(await context.cookies(old)).find(c=>c.name==='__Host-relay_cap');assert(oldCap);
 const content=Buffer.from('Normal desktop gateway synthetic file\n'.repeat(300)),name='relay-desktop-'+Date.now()+'.txt';
 const upload=context.waitForEvent('response',{predicate:r=>new URL(r.url()).pathname.endsWith('/'+name)&&r.request().method()==='PATCH'});await files.locator('input[type=file]').first().setInputFiles({name,mimeType:'text/plain',buffer:content});assert.equal((await upload).status(),204);await files.getByText(name,{exact:true}).first().click();
 const downloading=page.waitForEvent('download',{timeout:15000});downloading.catch(()=>{});await files.getByRole('button',{name:'Download',exact:true}).click();const download=await downloading;assert.deepEqual(await readFile(await download.path()),content);await download.delete();
 console.log('PASS normal desktop shortcut -> nonadmin File Browser login -> upload/download exact bytes');
 await button('Minimize Local Files').click();await button('Restore Local Files').click();assert.equal(await files.locator('body').evaluate(()=>location.origin),old);
 await button('End app session').click();await expect(page.locator('iframe[title="Local Files"]')).toHaveCount(0);await expect.poll(()=>l.relay.experimentalGateway.stats().routes).toBe(0);
 assert.equal((await edgeRequest(l,old,'/api/raw/'+name,{headers:{cookie:oldCap.name+'='+oldCap.value}})).status,403);
 await button('Reopen app').click();await files.getByPlaceholder('Username',{exact:true}).waitFor({timeout:15000});assert.notEqual(await files.locator('body').evaluate(()=>location.origin),old);
 await button('Close Local Files').click();await expect.poll(()=>l.relay.experimentalGateway.stats().routes).toBe(0);console.log('PASS minimize preserves; End clears old access; reopen requires fresh app login; Close clears route');
 stage='Jellyfin';await button('Open Local Jellyfin').click();const media=page.frameLocator('iframe[title="Local Jellyfin"]');await media.locator('#txtManualName').fill('proof-viewer');await media.locator('#txtManualPassword').fill(jf.viewerPassword);await media.getByRole('button',{name:'Sign In',exact:true}).click();await media.locator('#txtManualName').waitFor({state:'hidden',timeout:15000});
 await media.getByText('Synthetic Media',{exact:true}).filter({visible:true}).last().click();await media.getByText('Relay-Synthetic-Test',{exact:true}).filter({visible:true}).last().click();await media.getByRole('button',{name:'Play',exact:true}).filter({visible:true}).first().click();
 const video=media.locator('video').filter({visible:true}).first();await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:15000}).toBeGreaterThan(1);assert(await video.evaluate(v=>v.videoWidth>0&&v.webkitAudioDecodedByteCount>0&&!v.paused));
 await video.evaluate(v=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Seek timeout')),5000);v.addEventListener('seeked',()=>{clearTimeout(t);resolve();},{once:true});v.currentTime=10;}));
 await mkdir('screenshots',{recursive:true});await page.screenshot({path:'screenshots/local-normal-desktop-jellyfin.png'});
 await button('End app session').click();await expect(page.locator('iframe[title="Local Jellyfin"]')).toHaveCount(0);await expect.poll(()=>l.relay.experimentalGateway.stats().active).toBe(0);await expect.poll(()=>l.relay.experimentalGateway.stats().routes).toBe(0);
 console.log('PASS normal desktop Jellyfin viewer login, actual video/audio decode, seek and End cleanup');
 assert([...origins].every(o=>o===l.relay.experimentalGateway.desktopOrigin||/^https:\/\/[a-f0-9]{32}\.relay\.test:\d+$/.test(o)||o==='null'));
 console.log('PASS browser traffic stays on desktop/app gateway origins. LOCAL ONLY; Chromium SPKI exception, not Safari/public PKI qualification.');
}catch(e){console.error('FAIL local desktop real-service check at '+stage+': '+e.name+' '+e.message.split('\n')[0].replace(/https?:\/\/[^\s]+/g,'[URL]'));process.exitCode=1;}
finally{await browser?.close();await l.close();}
