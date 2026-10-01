import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {remotePKI,remoteReference} from '../remote-tls-helper.mjs';
import {tmpdir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
import {randomBytes,X509Certificate,createHash} from 'node:crypto';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';
import {caddySnippet} from '../../server/gateway-caddy.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {validateGatewayReference} from '../../server/experimental-gateway-config.mjs';
const caddy=process.env.RELAY_TEST_CADDY;
async function freePort(){const s=http.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
for(const remote of [false,true])for(const defaultPort of [true,false])test(`real Caddy ${remote?'mTLS':'loopback HTTP'} ${defaultPort?'port-free':'nondefault-port'} login, bytes, Range, WebSockets, retirement and browser download`, {timeout:90000},async()=>{
 assert.ok(caddy,'Set RELAY_TEST_CADDY to a checksummed real Caddy binary');
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-caddy-')),bytes=Buffer.from('synthetic-file-contents-0123456789'),password=randomBytes(24).toString('hex');let relay,proxy,browser;const sockets=new Set();
 const upstream=http.createServer((req,res)=>{
  if(req.url==='/slow'){res.writeHead(200);res.write('active');const timer=setInterval(()=>res.write('data'),20);res.on('close',()=>clearInterval(timer));return;}
  if(req.url==='/redirect'){res.writeHead(302,{location:'/file'});res.end();return;}
  if(req.url==='/file'){res.setHeader('Content-Type','application/octet-stream');if(req.headers.range==='bytes=2-8'){res.writeHead(206,{'Content-Range':`bytes 2-8/${bytes.length}`});res.end(bytes.subarray(2,9));return;}res.end(bytes);return;}
  res.setHeader('Content-Type','text/html');res.end('<h1>Synthetic app</h1><a href="/file" download>Download</a>');
 });
 const wss=new WebSocketServer({server:upstream});wss.on('connection',ws=>{sockets.add(ws);ws.on('message',m=>ws.send(m));ws.on('close',()=>sockets.delete(ws));});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 try{
  const internal=await freePort(),external=await freePort(),origin=`https://desktop.example.test${defaultPort?'':':'+external}`;
  await writeFile(dir+'/cert.cnf','[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=desktop.example.test\n[ext]\nsubjectAltName=DNS:desktop.example.test,DNS:*.apps.example.test,DNS:sibling.example.test\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-config',dir+'/cert.cnf'],{stdio:'ignore'});
  const cert=await readFile(dir+'/cert.pem');
  const ref={version:2,mode:'reverse-proxy',bind:'127.0.0.1',port:internal,desktopOrigin:origin,appBaseDomain:'apps.example.test',trustedProxy:'127.0.0.1',targets:[{id:'files',label:'Synthetic Files',upstream:`http://127.0.0.1:${upstream.address().port}`,webSocketPaths:['/socket'],allowDownloads:true}]};
  const pki=remote?await remotePKI(dir):null;
  if(remote)Object.assign(ref,{...remoteReference(dir,internal),desktopOrigin:origin,targets:ref.targets});
  relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone',experimentalGateway:await validateGatewayReference(ref)});
  const settings=await validateGatewayReference(ref);
  const fixtureConfig=ranges=>`{\n admin off\n auto_https off\n https_port ${external}\n}\n`+caddySnippet(settings,ranges).replace(' {\n',` {\n bind 127.0.0.1\n tls ${dir}/cert.pem ${dir}/key.pem\n`)+`\nhttps://sibling.example.test:${external} {\n bind 127.0.0.1\n tls ${dir}/cert.pem ${dir}/key.pem\n respond "unrelated sibling"\n}\n`;
  await writeFile(dir+'/Caddyfile',fixtureConfig(['127.0.0.1/32']));
  execFileSync(caddy,['validate','--config',dir+'/Caddyfile','--adapter','caddyfile'],{env:{...process.env,HOME:dir,XDG_DATA_HOME:dir+'/data',XDG_CONFIG_HOME:dir+'/config'},stdio:'ignore'});
  proxy=spawn(caddy,['run','--config',dir+'/Caddyfile','--adapter','caddyfile'],{env:{...process.env,HOME:dir,XDG_DATA_HOME:dir+'/data',XDG_CONFIG_HOME:dir+'/config'},stdio:'ignore'});
  function request(url,path,method='GET',body,headers={}){const u=new URL(url);return new Promise((resolve,reject)=>{const q=https.request({hostname:'127.0.0.1',port:external,servername:u.hostname,ca:cert,path,method,headers:{host:u.host,'sec-fetch-site':'same-origin',...headers}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,bytes:Buffer.concat(chunks),json:()=>JSON.parse(Buffer.concat(chunks))}));});q.on('error',reject);q.end(body===undefined?undefined:JSON.stringify(body));});}
  let ready=false,lastStatus='no response';for(let i=0;i<100;i++){try{lastStatus=(await request(origin,'/api/auth')).status;if(lastStatus===200){ready=true;break;}}catch(e){lastStatus=e.code;}await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'disposable Caddy ready: '+lastStatus);
  assert.equal((await request(`https://sibling.example.test:${external}`,'/')).bytes.toString(),'unrelated sibling');
  const info=(await request(origin,'/api/auth')).json(),setup=new URL(await readFile(dir+'/state/setup-url.txt','utf8')).hash.slice(1);
  const enrolled=await request(origin,'/api/enroll','POST',{username:'admin',password,setup},{origin,'content-type':'application/json','x-csrf-token':info.csrf});assert.equal(enrolled.status,200);
  const cookie=enrolled.headers['set-cookie'][0].split(';')[0];assert.match(enrolled.headers['set-cookie'][0],/Secure/);assert.doesNotMatch(enrolled.headers['set-cookie'][0],/Domain=/i);
  const session=(await request(origin,'/api/session','GET',undefined,{cookie})).json();
  const api=(path,method='GET',body)=>request(origin,'/api'+path,method,body,{cookie,origin,'content-type':'application/json','x-csrf-token':session.csrf});
  await api('/onboarding/complete','POST',{});await api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false,showAppStatus:false});
  const app=(await api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Files',gateway:{target:'files'},userIds:[]})).json();
  const reader=(await api('/admin/users','POST',{username:'reader',password,role:'user',grants:[app.id]})).json();assert.ok(reader.id);
  const loginInfo=(await request(origin,'/api/auth')).json();const readerLogin=await request(origin,'/api/login','POST',{username:'reader',password},{origin,'content-type':'application/json','x-csrf-token':loginInfo.csrf});assert.equal(readerLogin.status,200);
  const readerCookie=readerLogin.headers['set-cookie'][0].split(';')[0],readerSession=(await request(origin,'/api/session','GET',undefined,{cookie:readerCookie})).json();
  const readerAPI=(path,method='GET',body)=>request(origin,'/api'+path,method,body,{cookie:readerCookie,origin,'content-type':'application/json','x-csrf-token':readerSession.csrf});
  assert.equal((await readerAPI('/windows','POST',{appId:app.id})).status,200);const readerLaunch=(await readerAPI('/gateway/launch','POST',{appId:app.id})).json();
  const readerRedeem=await request(readerLaunch.origin,'/.relay/redeem','POST',{ticket:readerLaunch.ticket},{origin:readerLaunch.origin,'content-type':'application/json'});assert.equal(readerRedeem.status,200);const readerCap=readerRedeem.headers['set-cookie'][0].split(';')[0];
  const readerURL=new URL(readerLaunch.origin),readerWS=new WebSocket(`wss://127.0.0.1:${external}/socket`,{servername:readerURL.hostname,ca:cert,headers:{host:readerURL.host,origin:readerLaunch.origin,cookie:readerCap}});await once(readerWS,'open');const echoed=once(readerWS,'message');readerWS.send('grant-bound');await echoed;
  const readerTransfer=await new Promise((resolve,reject)=>{const q=https.get({hostname:'127.0.0.1',port:external,servername:readerURL.hostname,ca:cert,path:'/slow',headers:{host:readerURL.host,cookie:readerCap,'sec-fetch-site':'same-origin'}},r=>r.once('data',()=>resolve(r)));q.on('error',reject);});assert.equal(readerTransfer.statusCode,200);assert.equal(readerTransfer.complete,false);readerTransfer.on('error',()=>{});const readerClosed=new Promise(r=>readerTransfer.once('close',r)),readerWSClosed=once(readerWS,'close');
  assert.equal((await api('/admin/users/'+reader.id,'PATCH',{grants:[]})).status,200);await readerClosed;await readerWSClosed;assert.equal(readerTransfer.complete,false);assert.equal((await request(readerLaunch.origin,'/file','GET',undefined,{cookie:readerCap})).status,403);
  assert.equal((await api('/windows','POST',{appId:app.id})).status,200);
  const launch=(await api('/gateway/launch','POST',{appId:app.id})).json();assert.match(launch.origin,new RegExp('^https://[a-f0-9]{32}\\.apps\\.example\\.test'+(defaultPort?'':':'+external)+'$'));
  const redeemed=await request(launch.origin,'/.relay/redeem','POST',{ticket:launch.ticket},{origin:launch.origin,'content-type':'application/json'});assert.equal(redeemed.status,200);const cap=redeemed.headers['set-cookie'][0].split(';')[0];
  assert.deepEqual((await request(launch.origin,'/file','GET',undefined,{cookie:cap})).bytes,bytes);
  assert.deepEqual((await request(launch.origin,'/file','GET',undefined,{cookie:cap,range:'bytes=2-8'})).bytes,bytes.subarray(2,9));
  const redirect=await request(launch.origin,'/redirect','GET',undefined,{cookie:cap});assert.equal(redirect.status,302);assert.ok(redirect.headers.location.endsWith('/file'));
  assert.equal((await request(origin,'/api/session','GET',undefined,{cookie,'x-forwarded-host':'evil.test',forwarded:'proto=http','x-forwarded-for':'192.0.2.1'})).status,200,'Caddy overwrites spoofed metadata');
  const u=new URL(launch.origin),ws=new WebSocket(`wss://127.0.0.1:${external}/socket`,{servername:u.hostname,ca:cert,headers:{host:u.host,origin:launch.origin,cookie:cap}});await once(ws,'open');const msg=once(ws,'message');ws.send('synthetic');assert.equal((await msg)[0].toString(),'synthetic');
  // Raw backend upgrades with valid app authority must still require proxy metadata.
  const raw=new WebSocket(`${remote?'wss':'ws'}://127.0.0.1:${internal}/socket`,{...(remote?{...pki.client,ca:pki['server-ca'].cert,servername:'backend.example.test'}:{}),headers:{host:u.host,origin:launch.origin,cookie:cap}});
  const rawDenied=await new Promise(resolve=>{raw.on('open',()=>{raw.terminate();resolve(false);});raw.on('unexpected-response',(q,r)=>{r.resume();resolve(r.statusCode===403);});raw.on('error',()=>resolve(true));});assert.ok(rawDenied,'missing proxy metadata must reject websocket');
  const transfer=await new Promise((resolve,reject)=>{const q=https.get({hostname:'127.0.0.1',port:external,servername:u.hostname,ca:cert,path:'/slow',headers:{host:u.host,cookie:cap,'sec-fetch-site':'same-origin'}},r=>r.once('data',()=>resolve(r)));q.on('error',reject);});assert.equal(transfer.statusCode,200);assert.equal(transfer.complete,false);const closed=new Promise(resolve=>transfer.once('close',resolve));transfer.on('error',()=>{});const wsClosed=once(ws,'close');
  assert.equal((await api('/logout','POST',{})).status,200);await closed;await wsClosed;assert.equal(transfer.complete,false);
  assert.equal((await request(launch.origin,'/file','GET',undefined,{cookie:cap})).status,403);
  assert.equal((await request(`https://sibling.example.test:${external}`,'/')).bytes.toString(),'unrelated sibling');
  const spki=createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
  browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${spki}`,`--host-resolver-rules=MAP *.example.test 127.0.0.1${defaultPort?':'+external:''}`,'--no-proxy-server']});
  const page=await browser.newPage();page.setDefaultTimeout(10000);await page.goto(origin);
  const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.count())await bypass.click();
  await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
  await page.getByRole('button',{name:'Close Files',exact:true}).click();
  await page.getByRole('button',{name:'Open Files',exact:true}).click();const frame=page.frameLocator('iframe[title="Files"]');await expect(frame.getByRole('heading',{name:'Synthetic app',exact:true})).toBeVisible();
  const downloading=page.waitForEvent('download');await frame.getByRole('link',{name:'Download',exact:true}).click();const download=await downloading;assert.deepEqual(await readFile(await download.path()),bytes);
  await page.getByRole('button',{name:'End app session',exact:true}).click();await expect(page.locator('iframe[title="Files"]')).toHaveCount(0);
  await browser.close();browser=undefined;
  if(remote&&defaultPort){
   async function restartWith(text){
    proxy.kill('SIGTERM');await once(proxy,'exit');await writeFile(dir+'/Caddyfile',text);
    proxy=spawn(caddy,['run','--config',dir+'/Caddyfile','--adapter','caddyfile'],{env:{...process.env,HOME:dir,XDG_DATA_HOME:dir+'/data',XDG_CONFIG_HOME:dir+'/config'},stdio:'ignore'});
   }
   async function backendDenied(expected){
    for(let i=0;i<100;i++){try{const status=(await request(origin,'/api/auth')).status;if(expected.includes(status))return;}catch{}await new Promise(r=>setTimeout(r,30));}assert.fail('Caddy must reject invalid backend identity');
   }
   const good=fixtureConfig(['127.0.0.1/32']),authLine=`tls_client_auth ${dir}/client.pem ${dir}/client.key`;
   for(const credential of ['wrong-ca','wrong-name','wrong-usage','expired-client']){
    await restartWith(good.replace(authLine,`tls_client_auth ${dir}/${credential}.pem ${dir}/${credential}.key`));await backendDenied(credential==='wrong-name'?[400,502]:[502]);
   }
   await restartWith(good.replace(authLine,''));await backendDenied([502]);
   await restartWith(good.replace(`tls_trust_pool file ${dir}/server-ca.pem`,`tls_trust_pool file ${dir}/other-ca.pem`));await backendDenied([502]);
   await restartWith(good.replace('tls_server_name backend.example.test','tls_server_name wrong.example.test'));await backendDenied([502]);
   let expiredRequests=0;const expiredBackend=https.createServer(pki['expired-server'],(q,r)=>{expiredRequests++;r.end('must not reach an expired server');});await new Promise(r=>expiredBackend.listen(0,'127.0.0.1',r));
   try{await restartWith(good.replace(`reverse_proxy 127.0.0.1:${internal}`,`reverse_proxy 127.0.0.1:${expiredBackend.address().port}`));await backendDenied([502]);assert.equal(expiredRequests,0,'Caddy never sends HTTP credentials to an expired backend');}finally{expiredBackend.closeAllConnections();await new Promise(r=>expiredBackend.close(r));}
   await restartWith(good);let restored=false;for(let i=0;i<100;i++){try{if((await request(origin,'/api/auth')).status===200){restored=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}assert.ok(restored,'valid backend restored after negative cases');
  }
  proxy.kill('SIGTERM');await once(proxy,'exit');
  await writeFile(dir+'/Caddyfile',fixtureConfig(['192.0.2.0/24']));
  proxy=spawn(caddy,['run','--config',dir+'/Caddyfile','--adapter','caddyfile'],{env:{...process.env,HOME:dir,XDG_DATA_HOME:dir+'/data',XDG_CONFIG_HOME:dir+'/config'},stdio:'ignore'});
  let denied=false;for(let i=0;i<100;i++){try{if((await request(origin,'/api/auth')).status===403){denied=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(denied,'explicit source policy denies with intended Host/SNI, without public DNS');
  assert.equal((await request(origin,'/api/auth','GET',undefined,{'x-forwarded-for':'192.0.2.1'})).status,403);
  assert.equal((await request(`https://sibling.example.test:${external}`,'/')).bytes.toString(),'unrelated sibling');
 }finally{await browser?.close();if(proxy&&proxy.exitCode===null){proxy.kill('SIGTERM');await once(proxy,'exit');}await relay?.close();for(const s of sockets)s.terminate();wss.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});}
});
