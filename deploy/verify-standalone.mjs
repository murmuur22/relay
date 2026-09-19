import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import {privateIPv4} from '../updater/web/broker-client.mjs';
import {join,isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import {WebSocket} from 'ws';
import {chromium} from 'playwright';
import {createGateway} from '../server/gateway.mjs';

// Runtime-only qualification. Never use RELAY_STATE_DIR or an existing account store.
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--private-lan'),'Usage: node deploy/verify-standalone.mjs [--private-lan]');
const networkMode=process.argv[2]?'private-lan':'loopback';
const hostname=networkMode==='loopback'?'localhost':Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal&&privateIPv4(n.address))?.address;
assert.ok(hostname,'No assigned RFC1918 IPv4: private-LAN qualification unavailable');
const base=process.env.RELAY_QUALIFY_DIR ?? tmpdir();
assert.ok(isAbsolute(base),'RELAY_QUALIFY_DIR must be absolute');
const runtime=await mkdtemp(join(base,'relay-qualify-'));
const password=randomBytes(24).toString('hex');
let gateway,browser,fixture,auth;
let cleaning;
function cleanup(){return cleaning??=(async()=>{
 try{await browser?.close();}finally{try{await gateway?.close();}finally{try{if(fixture){fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}}finally{await rm(runtime,{recursive:true,force:true});}}}
})();}
const deadline=setTimeout(async()=>{console.error('FAIL standalone qualification exceeded 120 seconds');await cleanup();process.exit(1);},120000);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{clearTimeout(deadline);await cleanup();process.exit(1);});
async function json(response){assert.equal(response.status,200,'Qualification HTTP request failed');return response.json();}
async function login(){
 const info=await json(await fetch(gateway.origin+'/api/auth'));
 const setup=info.setup?new URL(await readFile(join(runtime,'setup-url.txt'),'utf8')).hash.slice(1):undefined;
 const response=await fetch(gateway.origin+(setup?'/api/enroll':'/api/login'),{method:'POST',headers:{Origin:gateway.origin,'Content-Type':'application/json','X-CSRF-Token':info.csrf},body:JSON.stringify({username:'admin',password,setup})});
 await json(response);const cookie=response.headers.get('set-cookie').split(';')[0];
 const session=await json(await fetch(gateway.origin+'/api/session',{headers:{cookie}}));
 auth={cookie,session};return session;
}
async function api(path,method='GET',body){return json(await fetch(gateway.origin+'/api'+path,{method,headers:{cookie:auth.cookie,Origin:gateway.origin,'X-CSRF-Token':auth.session.csrf,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));}
async function until(check,message){const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await delay(50);}throw Error(message);}
async function sandbox(browser){
 const cdp=await browser.newBrowserCDPSession();
 try{
  const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');
  const pid=processInfo.find(p=>p.type==='browser')?.id;assert.ok(Number.isInteger(pid));
  const {stdout}=await promisify(execFile)('ps',['-ww','-p',String(pid),'-o','args='],{timeout:5000,maxBuffer:65536});
  assert.ok(stdout.trim(),'Browser command line unavailable');assert.ok(!stdout.includes('--no-sandbox'),'Chromium sandbox must remain enabled');
 }finally{await cdp.detach();}
}
try{
 fixture=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Qualification fixture</title><style>body{margin:0}textarea{position:absolute;left:20px;top:20px;width:350px;height:180px}</style><textarea aria-label="Synthetic text"></textarea>');});
 await new Promise((resolve,reject)=>{fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
 gateway=await createGateway({port:0,runtime,profile:'standalone',hostname,networkMode});
 assert.equal(gateway.server.address().address,networkMode==='loopback'?'127.0.0.1':hostname);assert.equal(gateway.nativeService,undefined);assert.deepEqual(gateway.accounts.templates,[]);
 console.log(`PASS ${networkMode} exact interface binding and origin`);
 const initial=await login();assert.deepEqual(initial.apps.filter(a=>a.kind!=='system'),[]);assert.deepEqual(initial.apps.map(a=>a.id),['system-updater']);assert.deepEqual(gateway.accounts.state.services,[]);
 for(const id of ['parcels','keepsakes','notes-lab','signal-lab']){
  assert.equal((await fetch(gateway.origin+'/native/'+id+'/',{headers:{cookie:auth.cookie}})).status,404);
  assert.equal((await fetch(gateway.origin+'/api/admin/services',{method:'POST',headers:{cookie:auth.cookie,Origin:gateway.origin,'X-CSRF-Token':auth.session.csrf,'Content-Type':'application/json'},body:JSON.stringify({template:id})})).status,400);
 }
 console.log('PASS standalone enrollment: empty catalog, no builtin routes or native subprocess');
 await api('/preferences','PATCH',{showAppStatus:false,introAnimation:false,interfaceAnimations:false});
 const folder=(await api('/desktop/folders','POST',{label:'Qualification folder',parentId:null})).itemId;
 const draft={kind:'web',mode:'stream',label:'Qualification stream',address:`http://127.0.0.1:${fixture.address().port}/`,icon:'globe'};
 const app=await api('/onboarding/app','POST',draft);
 assert.equal((await api('/onboarding/app','POST',draft)).id,app.id);
 await api('/onboarding/complete','POST',{});
 await api('/windows','POST',{appId:app.id});
 // A valid owned stream must still reject hostile Host/Origin and missing auth.
 for(const headers of [{Origin:'http://wrong.invalid',Cookie:auth.cookie},{Origin:gateway.origin},{Origin:gateway.origin,Cookie:auth.cookie,Host:'wrong.invalid'}]){
  const status=await new Promise((resolve,reject)=>{
   const ws=new WebSocket(gateway.origin.replace('http:','ws:')+'/ws/stream/'+app.id,{headers});
   const timer=setTimeout(()=>{ws.terminate();reject(Error('WS denial deadline exceeded'));},5000);
   ws.on('unexpected-response',(_,res)=>{clearTimeout(timer);res.resume();ws.terminate();resolve(res.statusCode);});
   ws.on('open',()=>{clearTimeout(timer);ws.terminate();reject(Error('Hostile WS admitted'));});ws.on('error',()=>{});
  });assert.equal(status,403);
 }
 await api('/windows/'+app.id,'DELETE');
 browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:15000});await sandbox(browser);
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',()=>errors.push('client page error'));
 const [name,value]=auth.cookie.split('=');await page.context().addCookies([{name,value,url:gateway.origin,httpOnly:true,sameSite:'Strict'}]);
 let frames=0;page.on('websocket',ws=>ws.on('framereceived',event=>{try{const message=JSON.parse(event.payload.toString());if(message.type==='frame'&&Buffer.from(message.data,'base64').length>100)frames++;}catch{}}));
 await page.goto(gateway.origin);await page.getByRole('button',{name:'Open Qualification stream',exact:true}).click();
 await until(async()=>frames>0&&(await page.locator('.stream-status').textContent()).includes('live'),'No live streamed frame');
 const resource=gateway.manager.resources.get(app.id);assert.ok(resource);await sandbox(resource.context.browser());
 const surface=page.getByLabel('Qualification stream remote input');await surface.click({position:{x:80,y:80}});
 await resource.page.waitForFunction(()=>document.activeElement?.tagName==='TEXTAREA',{},{timeout:10000});
 await page.keyboard.type('Synthetic standalone input');
 await until(async()=>await resource.page.locator('textarea').inputValue()==='Synthetic standalone input','Client input did not reach remote textarea');
 assert.ok(await page.locator('canvas').evaluate(canvas=>canvas.width>1&&canvas.height>1));assert.deepEqual(errors,[]);
 console.log('PASS sandboxed client/server Chromium: real frames and client-to-remote typed text');
 const desktop=await api('/desktop'),item=desktop.items.find(i=>i.appId===app.id);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
 const uploaded=await json(await fetch(gateway.origin+'/api/desktop/items/'+item.id+'/icon',{method:'POST',headers:{cookie:auth.cookie,Origin:gateway.origin,'X-CSRF-Token':auth.session.csrf,'Content-Type':'image/png'},body:png}));
 const icon=uploaded.items.find(i=>i.id===item.id).icon;
 const image=await fetch(gateway.origin+icon.url,{headers:{cookie:auth.cookie}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('cache-control'),'no-store');
 const bytes=Buffer.from(await image.arrayBuffer());assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));assert.equal((await fetch(gateway.origin+icon.url)).status,401);
 console.log('PASS configured Pillow decoder: private normalized PNG upload/read');
 await page.getByRole('button',{name:'Close Qualification stream',exact:true}).click();await browser.close();browser=null;
 const userId=auth.session.user.id,oldCookie=auth.cookie;
 await gateway.close();gateway=null;
 gateway=await createGateway({port:0,runtime,profile:'standalone',hostname,networkMode});
 assert.equal((await fetch(gateway.origin+'/api/session',{headers:{cookie:oldCookie}})).status,401);
 const restored=await login();assert.equal(restored.user.id,userId);assert.deepEqual(restored.apps.filter(a=>a.kind!=='system').map(a=>a.id),[app.id]);assert.equal(restored.apps.filter(a=>a.id==='system-updater').length,1);assert.equal(restored.user.onboardingComplete,true);assert.equal(restored.user.preferences.showAppStatus,false);
 const saved=await api('/desktop');assert.ok(saved.items.some(i=>i.id===folder));assert.equal(saved.items.find(i=>i.id===item.id).icon.url,icon.url);assert.equal((await fetch(gateway.origin+icon.url,{headers:{cookie:auth.cookie}})).status,200);assert.equal(gateway.nativeService,undefined);
 console.log('PASS restart: login, user, web app, preferences, folder and private icon preserved; old session rejected');
}finally{
 try{await cleanup();}finally{clearTimeout(deadline);}
}
console.log('PASS standalone qualification complete; temporary state and owned processes cleaned');
