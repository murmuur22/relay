// Compiled UI + genuine HTTPS logins and managed hostname replacement.
// Exact process-local SPKI/name mapping only; no OS trust or DNS changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import {mkdtemp,realpath,chmod,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {X509Certificate,createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
import {edgeRequest} from '../gateway-helper.mjs';

async function fixture(t){
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-native-preview-'));
 let relay,browser,observer;
 t.after(async()=>{await browser?.close();await relay?.close();if(observer){observer.closeAllConnections();await new Promise(r=>observer.close(r));}await rm(dir,{recursive:true,force:true});});
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-subj','/CN=desktop-a.example.test','-addext','subjectAltName=DNS:desktop-a.example.test,DNS:desktop-b.example.test,DNS:unrelated.example.test,DNS:*.apps.example.test'],{stdio:'ignore'});
 await chmod(dir+'/key.pem',0o600);await chmod(dir+'/cert.pem',0o600);
 const key=await readFile(dir+'/key.pem'),cert=await readFile(dir+'/cert.pem');
 const spki=createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
 const hits=[];
 observer=https.createServer({key,cert},(req,res)=>{hits.push({host:req.headers.host,path:req.url,hasCookie:!!req.headers.cookie?.includes('__Host-relay_session=')});res.setHeader('Content-Type','text/html');res.end('<h1>Synthetic native preview</h1>');});
 await new Promise(r=>observer.listen(0,'127.0.0.1',r));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone'});
 const api=client(relay.origin,await authenticate(relay.origin,dir+'/state'));
 assert.equal((await api('/onboarding/complete','POST',{})).status,200);
 assert.equal((await api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false,showAppStatus:false})).status,200);
 const config={version:1,bind:'127.0.0.1',port,desktopHostname:'desktop-a.example.test',appBaseDomain:'apps.example.test',keyPath:dir+'/key.pem',certPath:dir+'/cert.pem',targets:[{id:'files',label:'Files',upstream:'http://127.0.0.1:9'}]};
 assert.equal((await api('/admin/gateway','PUT',{config,password})).status,200);
 browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${spki}`,'--host-resolver-rules=MAP *.example.test 127.0.0.1','--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(5000);
 async function login(){
  await page.goto(relay.experimentalGateway.desktopOrigin);await page.keyboard.press('Escape');
  await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open Control Panel',exact:true})).toBeVisible();
 }
 await login();
 const old=(await context.cookies()).find(c=>c.name==='__Host-relay_session'&&c.domain==='desktop-a.example.test');
 assert.ok(old?.httpOnly&&old.secure,'genuine old HTTPS login issued protected cookie');
 assert.equal((await api('/admin/gateway','PUT',{config:{...config,desktopHostname:'desktop-b.example.test'},password})).status,200);
 await login();
 assert.ok((await context.cookies()).some(c=>c.domain===old.domain&&c.value===old.value),'old host cookie survives replacement');
 assert.equal((await fetch(relay.origin+'/api/session',{headers:{cookie:'relay_session='+old.value}})).status,200,'old cookie still identifies live Relay session');
 const retired=`https://desktop-a.example.test:${observer.address().port}/`,safe=`https://unrelated.example.test:${observer.address().port}/`;
 // Harness positive control: the same-site top-level destination really can receive the old cookie.
 const control=await context.newPage();await control.goto(retired+'control');await expect(control.getByRole('heading')).toHaveText('Synthetic native preview');await control.close();
 assert.ok(hits.some(h=>h.path==='/control'&&h.hasCookie));hits.length=0;
 const requests=[];context.on('request',r=>{if(r.url().startsWith(retired))requests.push(r.url());});
 await page.getByRole('button',{name:'Open Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Apps',exact:true}).click();
 async function wizard(address,mode='window'){
  await page.getByRole('button',{name:'Add app',exact:true}).click();await page.getByLabel('Native',{exact:true}).check();
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByLabel('App name',{exact:true}).fill('Synthetic native');await page.getByLabel('Address',{exact:true}).fill(address);await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByLabel(mode==='tab'?'New tab':'Desktop window',{exact:true}).check();
 }
 return {page,context,api,relay,cert,retired,safe,hits,requests,wizard};
}
const frame=p=>p.locator('iframe[title="Native preview"]');
const link=p=>p.getByRole('link',{name:'Open preview in new tab',exact:true});
async function absent(f){await expect(frame(f.page)).toHaveCount(0);await expect(link(f.page)).toHaveCount(0);assert.deepEqual(f.requests,[],'Preview must not initiate any retired-host browser request');assert.equal(f.hits.filter(h=>h.host.startsWith('desktop-a.')).length,0);}

test('compiled Native Preview denies retired HTTPS auth host before frame, request or new-tab link; unrelated preview works',{timeout:45000},async t=>{
 const f=await fixture(t),{page}=f;
 for(const mode of ['window','tab']){
  await f.wizard(f.retired,mode);await page.getByRole('button',{name:'Preview',exact:true}).click();
  await expect.poll(async()=>await frame(page).count()+await page.getByRole('alert').count()).toBeGreaterThan(0);
  await absent(f);await expect(page.getByRole('alert')).toContainText('different hostname');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
 }
 await f.wizard(f.safe);await page.getByRole('button',{name:'Preview',exact:true}).click();
 await expect(page.frameLocator('iframe[title="Native preview"]').getByRole('heading')).toHaveText('Synthetic native preview');
 await expect(link(page)).toHaveAttribute('href',f.safe);
 const popup=f.context.waitForEvent('page');await link(page).click();const opened=await popup;await expect(opened.getByRole('heading')).toHaveText('Synthetic native preview');await opened.close();
 assert.ok(f.hits.some(h=>h.host.startsWith('unrelated.')));assert.deepEqual(f.requests,[]);
});

test('Native Preview fails closed on unavailable or invalid validation, including after an earlier success',{timeout:45000},async t=>{
 const f=await fixture(t),{page}=f;await f.wizard(f.safe);
 await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(frame(page)).toHaveCount(1);await expect(link(page)).toHaveCount(1);
 let behavior='unavailable';
 await page.route('**/api/admin/apps/validate',route=>behavior==='network'?route.abort('failed'):route.fulfill({status:behavior==='unavailable'?503:200,json:behavior==='unavailable'?{error:'Validation unavailable'}:{}}));
 for(behavior of ['unavailable','invalid','network']){
  const hits=f.hits.length;await page.getByRole('button',{name:'Preview',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Preview',exact:true})).toBeEnabled();await absent(f);
  assert.equal(f.hits.length,hits,'unavailable validation must not initiate another upstream request');
 }
});

for(const interruption of ['cancel','logout'])test(`late successful Native validation cannot render after ${interruption}`,{timeout:45000},async t=>{
 const f=await fixture(t),{page}=f;await f.wizard(f.safe);
 let release,arrived;const held=new Promise(r=>release=r),ready=new Promise(r=>arrived=r);
 let finished;const done=new Promise(r=>finished=r);
 await page.route('**/api/admin/apps/validate',async route=>{
  try{
   // Forward the actual browser credentials through verified fixture TLS; Node does not use Chromium's resolver rules.
   const headers=await route.request().allHeaders();
   const response=await edgeRequest(f,f.relay.experimentalGateway.desktopOrigin,'/api/admin/apps/validate',{method:'POST',headers:{origin:headers.origin,cookie:headers.cookie,'x-csrf-token':headers['x-csrf-token'],'content-type':'application/json'},body:route.request().postDataJSON()});
   assert.equal(response.status,200);arrived();await held;await route.fulfill({status:response.status,contentType:'application/json',body:response.text});
  }finally{finished();}
 });
 try{
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  await Promise.race([ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Validation did not arrive')),5000);timer.unref();})]);
  await absent(f);assert.equal(f.hits.length,0,'await validation before rendering');
  if(interruption==='cancel')await page.getByRole('button',{name:'Cancel',exact:true}).click();
  else{await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByLabel('username',{exact:true})).toBeVisible();}
  release();await done;
  if(interruption==='cancel')await expect(page.getByRole('button',{name:'Add app',exact:true})).toBeVisible();
  else{await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await expect(page.getByRole('button',{name:'Open Control Panel',exact:true})).toBeVisible();}
  await absent(f);assert.equal(f.hits.length,0,'late success must not initiate a native request');
 }finally{release();await page.unrouteAll({behavior:'wait'});}
});
