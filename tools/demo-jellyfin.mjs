// Local synthetic professor-demo runner. Never connects to production services.
// Chromium's exact certificate exception and resolver mapping are process-local.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {gatewayLab,password,edgeRequest} from '../tests/gateway-helper.mjs';
import {authenticate,client} from '../tests/auth-helper.mjs';

const args=process.argv.slice(2);
if(args.some(a=>!['--verify','--headed'].includes(a)))throw Error('Usage: node tools/demo-jellyfin.mjs [--verify] [--headed]');
const verify=args.includes('--verify'),headed=!verify||args.includes('--headed');
let lab,browser,context,page,stage='preflight',stopping=false;
let resolveStop;
const stopped=new Promise(r=>{resolveStop=r;});
const stop=()=>{stopping=true;resolveStop();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 const health=await fetch('http://127.0.0.1:18196/health',{signal:AbortSignal.timeout(5000)});
 assert(health.ok,'Start the isolated relay-jellyfin-proof container first');await health.body?.cancel();
 const credentials=JSON.parse(await readFile(homedir()+'/.hermes/test-labs/jellyfin-gateway/credentials.json','utf8'));
 assert(typeof credentials.viewerPassword==='string','Missing synthetic viewer credentials');
 lab=await gatewayLab({targets:[{id:'jellyfin',label:'Jellyfin',upstream:'http://127.0.0.1:18196',entryPath:'/web/index.html',cookieNames:[],requestHeaders:['x-emby-authorization','x-mediabrowser-token','x-emby-token'],webSocketPaths:['/socket']}]});
 const user=await(await lab.api('/admin/users','POST',{username:'presenter',password})).json();assert(user.id);
 assert.equal((await lab.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Jellyfin',gateway:{target:'jellyfin'},userIds:[user.id]})).status,200);
 const auth=await authenticate(lab.relay.origin,lab.dir+'/state','presenter');
 const api=client(lab.relay.origin,auth);
 assert.equal((await api('/preferences','PATCH',{showAppStatus:false,introAnimation:false,interfaceAnimations:false})).status,200);
 await api('/logout','POST');
 await mkdir('screenshots/jellyfin-demo',{recursive:true});
 browser=await chromium.launch({headless:!headed,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${lab.spki}`,'--host-resolver-rules=MAP *.relay.test 127.0.0.1','--no-proxy-server']});
 browser.on('disconnected',stop);
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',...(verify?{recordVideo:{dir:'screenshots/jellyfin-demo',size:{width:1440,height:1000}}}:{})});
 page=await context.newPage();page.on('close',stop);
 const origins=new Set();context.on('request',r=>origins.add(new URL(r.url()).origin));
 const button=name=>page.getByRole('button',{name,exact:true});
 stage='Relay login';
 await page.goto(lab.relay.experimentalGateway.desktopOrigin);
 const bypass=button('[ESC] BYPASS INITIALIZATION');if(await bypass.count())await bypass.click();
 await page.getByLabel('username',{exact:true}).fill('presenter');
 await page.getByLabel('password',{exact:true}).fill(password);await button('Enter →').click();
 await expect(button('Navigation')).toBeVisible();
 await button('Open Jellyfin').click();
 const media=page.frameLocator('iframe[title="Jellyfin"]');
 async function login(){
  await media.locator('#txtManualName').fill('proof-viewer');
  await media.locator('#txtManualPassword').fill(credentials.viewerPassword);
  await media.getByRole('button',{name:'Sign In',exact:true}).click();
  await media.locator('#txtManualName').waitFor({state:'hidden',timeout:20000});
 }
 async function play(){
  await media.getByText('Synthetic Media',{exact:true}).filter({visible:true}).last().click();
  await media.getByText('Relay-Synthetic-Test',{exact:true}).filter({visible:true}).last().click();
  await media.getByRole('button',{name:'Play',exact:true}).filter({visible:true}).first().click();
  const video=media.locator('video').filter({visible:true}).first();
  await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:20000}).toBeGreaterThan(1);
  assert(await video.evaluate(v=>v.videoWidth>0&&v.webkitAudioDecodedByteCount>0&&!v.paused));
  return video;
 }
 stage='Jellyfin login/playback';await login();const video=await play();
 await video.evaluate(v=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Seek timeout')),5000);v.addEventListener('seeked',()=>{clearTimeout(t);resolve();},{once:true});v.currentTime=10;}));
 console.log('PASS playback/audio/seek');
 await page.screenshot({path:'screenshots/jellyfin-demo/playing.png'});
 const old=await media.locator('body').evaluate(()=>location.origin);
 const cap=(await context.cookies(old)).find(c=>c.name==='__Host-relay_cap');assert(cap);
 await button('Minimize Jellyfin').click();await button('Restore Jellyfin').click();
 assert.equal(await media.locator('body').evaluate(()=>location.origin),old);
 console.log('PASS minimize/restore');
 if(verify){
  stage='End/reopen/Close';
  await button('End app session').click();await expect(page.locator('iframe[title="Jellyfin"]')).toHaveCount(0);
  await expect.poll(()=>lab.relay.experimentalGateway.stats().routes).toBe(0);
  assert.equal((await edgeRequest(lab,old,'/System/Info/Public',{headers:{cookie:cap.name+'='+cap.value}})).status,403);
  await button('Reopen app').click();await media.locator('#txtManualName').waitFor({timeout:15000});
  assert.notEqual(await media.locator('body').evaluate(()=>location.origin),old);
  await login();await play();
  await button('Close Jellyfin').click();await expect.poll(()=>lab.relay.experimentalGateway.stats().routes).toBe(0);
  await expect.poll(()=>lab.relay.experimentalGateway.stats().active).toBe(0);
  console.log('PASS End/reopen/Close');
  assert([...origins].every(o=>o===lab.relay.experimentalGateway.desktopOrigin||/^https:\/\/[a-f0-9]{32}\.relay\.test:\d+$/.test(o)||o==='null'));
 }else{
  await video.evaluate(v=>{v.pause();v.currentTime=0;});
  console.log('READY: Jellyfin is open inside Relay. Press Play in the window. Close Chromium or Ctrl+C to stop.');
  console.log('Synthetic local demo only; process-local certificate exception, not production TLS.');
  if(!stopping)await stopped;
 }
}catch(error){
 if(!stopping){console.error('Demo failed at '+stage+' ('+error.name+'). Check fixture readiness; no production service was contacted.');process.exitCode=1;}
}finally{
 const recording=page?.video();
 await context?.close().catch(()=>{});
 if(verify&&recording)await recording.saveAs('screenshots/jellyfin-demo/fallback.webm');
 await browser?.close();await lab?.close();
 process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
 console.log('PASS demo cleanup');
}
