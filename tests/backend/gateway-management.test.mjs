import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,writeFile,readFile,chmod,stat} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';
import http from 'node:http';
import https from 'node:https';
import {edgeRequest,addGateway,launchGateway,redeemGateway} from '../gateway-helper.mjs';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
async function fixture(){
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-managed-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-subj','/CN=desktop.example.test','-addext','subjectAltName=DNS:desktop.example.test,DNS:*.apps.example.test'],{stdio:'ignore'});
 await chmod(dir+'/key.pem',0o600);await chmod(dir+'/cert.pem',0o600);
 const upstream=http.createServer((req,res)=>res.end('managed synthetic'));
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const config={version:1,bind:'127.0.0.1',port,desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test',keyPath:dir+'/key.pem',certPath:dir+'/cert.pem',targets:[{id:'files',label:'Files',upstream:`http://127.0.0.1:${upstream.address().port}`}]};
 return {dir,config,cert:await readFile(dir+'/cert.pem'),close:async()=>{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});}};
}
test('managed Direct HTTPS to proxy mode preserves apps, retires windows, persists and restores Direct HTTPS',async()=>{
 const f=await fixture();let relay;
 try{
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});
  let api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  assert.equal((await api('/admin/gateway','PUT',{config:f.config,password})).status,200);
  const l={relay,api,cert:f.cert},app=await addGateway(l),launch=await launchGateway(l,app);await redeemGateway(l,launch);const old=relay.experimentalGateway;
  const config={version:2,mode:'reverse-proxy',bind:'127.0.0.1',port:f.config.port,desktopOrigin:'https://proxy.example.test',appBaseDomain:'apps.example.test',trustedProxy:'127.0.0.1',targets:f.config.targets};
  const check=await api('/admin/gateway/validate','POST',{config});assert.equal(check.status,200);assert.equal((await check.json()).desktopOrigin,config.desktopOrigin);
  assert.equal((await api('/admin/gateway','PUT',{config,password})).status,200);
  assert.deepEqual(old.stats(),{routes:0,tickets:0,caps:0,active:0});assert.equal((await (await api('/session')).json()).windows.length,0);
  for(const hostname of ['desktop.example.test','proxy.example.test'])assert.equal((await api('/admin/apps','POST',{kind:'web',mode:'native',label:'Denied',address:`https://${hostname}:9443`,openMode:'window',userIds:[]})).status,400);
  assert.deepEqual(JSON.parse(await readFile(f.dir+'/state/gateway-managed.json','utf8')),config);
  await relay.close();relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  assert.equal(relay.experimentalGateway.desktopOrigin,config.desktopOrigin);
  assert.ok((await (await api('/admin/services')).json()).some(a=>a.id===app.id));
  assert.equal((await api('/admin/gateway','PUT',{config:f.config,password})).status,200);
  assert.equal((await edgeRequest({cert:f.cert},relay.experimentalGateway.desktopOrigin,'/api/auth')).status,200);
  assert.equal((await api('/admin/gateway','DELETE',{password})).status,200);
 }finally{await relay?.close();await f.close();}
});
test('managed configuration validates without activation, applies real TLS, persists, retires routes and disables durably',async()=>{
 const f=await fixture();let relay;
 try{
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});
  let api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  const validated=await api('/admin/gateway/validate','POST',{config:f.config});assert.equal(validated.status,200);assert.equal((await validated.json()).valid,true);
  assert.equal((await (await api('/gateway/config')).json()).enabled,false);
  await assert.rejects(stat(f.dir+'/state/gateway-managed.json'));
  assert.equal((await api('/admin/gateway','PUT',{config:f.config,password})).status,200);
  const status=await (await api('/admin/gateway')).json();assert.equal(status.source,'managed');assert.deepEqual(status.config,f.config);
  assert.equal((await stat(f.dir+'/state/gateway-managed.json')).mode&0o777,0o600);
  const l={relay,api,cert:f.cert};const app=await addGateway(l),launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);
  assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie}})).text,'managed synthetic');
  const old=relay.experimentalGateway;
  assert.equal((await api('/admin/gateway','PUT',{config:f.config,password})).status,200);
  assert.deepEqual(old.stats(),{routes:0,tickets:0,caps:0,active:0});
  assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie}})).status,403);
  assert.equal((await (await api('/session')).json()).windows.length,0);
  await relay.close();relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});
  api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  assert.equal((await (await api('/admin/gateway')).json()).source,'managed');
  assert.equal((await api('/admin/gateway','DELETE',{password})).status,200);
  await relay.close();relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});
  api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  assert.equal((await (await api('/admin/gateway')).json()).source,'disabled');
  assert.ok((await (await api('/admin/services')).json()).some(a=>a.id===app.id));
 }finally{await relay?.close();await f.close();}
});
test('HTTPS desktop administrator receives the actual committed disable response',async()=>{
 const f=await fixture();let relay;
 try{
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});
  const api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  assert.equal((await api('/admin/gateway','PUT',{config:f.config,password})).status,200);
  const l={cert:f.cert},origin=relay.experimentalGateway.desktopOrigin;
  const info=(await edgeRequest(l,origin,'/api/auth')).json();
  const login=await edgeRequest(l,origin,'/api/login',{method:'POST',headers:{origin,'content-type':'application/json','x-csrf-token':info.csrf},body:{username:'admin',password}});
  assert.equal(login.status,200);const cookie=login.headers['set-cookie'][0].split(';')[0];
  const session=(await edgeRequest(l,origin,'/api/session',{headers:{cookie}})).json();
  const response=await edgeRequest(l,origin,'/api/admin/gateway',{method:'DELETE',headers:{origin,cookie,'content-type':'application/json','x-csrf-token':session.csrf,'content-length':Buffer.byteLength(JSON.stringify({password}))},body:{password}});
  assert.equal(response.status,200);assert.equal(response.json().source,'disabled');
 }finally{await relay?.close();await f.close();}
});
test('configuration replacement rejects a retired launch identity even after window reopen',async()=>{
 const f=await fixture();let relay;
 try{
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});const api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  await api('/admin/gateway','PUT',{config:f.config,password});const l={relay,api,cert:f.cert},app=await addGateway(l),launch=await launchGateway(l,app);
  assert.equal((await api('/admin/gateway','PUT',{config:f.config,password})).status,200);
  await api('/windows','POST',{appId:app.id});
  assert.equal((await api('/gateway/launch','POST',{appId:app.id,launchId:launch.launchId})).status,409);
 }finally{await relay?.close();await f.close();}
});
test('invalid inputs, passwords, Origin/CSRF and occupied ports retain bytes and working edge without secret disclosure',async()=>{
 const f=await fixture();let relay;const blocker=http.createServer();
 try{
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});const auth=await authenticate(relay.origin,f.dir+'/state'),api=client(relay.origin,auth);
  assert.equal((await api('/admin/gateway','PUT',{config:f.config,password})).status,200);
  const bytes=await readFile(f.dir+'/state/gateway-managed.json'),edge=relay.experimentalGateway;
  for(const config of [{...f.config,key:'PRIVATE PEM'}, {...f.config,keyPath:f.dir+'/missing'}, {...f.config,port:443},{...f.config,port:Number(new URL(relay.origin).port)},{...f.config,targets:[{id:'files',label:'Files',upstream:'http://169.254.169.254'}]}]){
   const response=await api('/admin/gateway','PUT',{config,password});assert.ok(response.status>=400);assert.doesNotMatch(await response.text(),/PRIVATE PEM|BEGIN|\/private\/|169\.254/);
  }
  for(const method of ['PUT','DELETE'])assert.equal((await api('/admin/gateway',method,{config:f.config,password:'wrong'})).status,403);
  for(const headers of [{cookie:auth.cookie,Origin:relay.origin},{cookie:auth.cookie,Origin:'https://evil.example.test','X-CSRF-Token':auth.s.csrf},{cookie:auth.cookie,'X-CSRF-Token':auth.s.csrf}]){
   const response=await fetch(relay.origin+'/api/admin/gateway/validate',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({config:f.config})});assert.equal(response.status,403);
  }
  assert.equal((await api('/admin/gateway/validate','POST',{config:{...f.config,extra:'x'.repeat(17000)}})).status,413);
  await new Promise(r=>blocker.listen(0,'127.0.0.1',r));
  assert.equal((await api('/admin/gateway','PUT',{config:{...f.config,port:blocker.address().port},password})).status,503);
  assert.equal(relay.experimentalGateway,edge);assert.deepEqual(await readFile(f.dir+'/state/gateway-managed.json'),bytes);
  assert.equal((await edgeRequest({cert:f.cert},edge.desktopOrigin,'/api/auth')).status,200);
  assert.equal((await api('/admin/users','POST',{username:'reader',password})).status,200);
  const reader=client(relay.origin,await authenticate(relay.origin,f.dir+'/state','reader'));
  const publicConfig=await (await reader('/gateway/config')).text();assert.doesNotMatch(publicConfig,/keyPath|certPath|upstream|127\.0\.0\.1|BEGIN|authProfile/);
 }finally{await relay?.close();await new Promise(r=>blocker.close(r));await f.close();}
});
test('operator configuration is immutable and hides its paths; managed configuration cannot override it',async()=>{
 const f=await fixture();let relay;
 try{
  const path=f.dir+'/operator.json',bytes=JSON.stringify(f.config);await writeFile(path,bytes,{mode:0o600});
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone',gatewayConfigPath:path});
  const api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  const response=await api('/admin/gateway'),status=await response.json();assert.equal(status.source,'operator');assert.equal(status.config,null);assert.doesNotMatch(JSON.stringify(status),/keyPath|certPath|operator.json|127\.0\.0\.1/);
  for(const method of ['PUT','DELETE'])assert.equal((await api('/admin/gateway',method,{config:f.config,password})).status,409);
  assert.equal(await readFile(path,'utf8'),bytes);await assert.rejects(stat(f.dir+'/state/gateway-managed.json'));
 }finally{await relay?.close();await f.close();}
});
test('disabled persisted Native app cookie-host collision refuses enable without changing accounts',async()=>{
 const f=await fixture();let relay;
 try{
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});const api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  const response=await api('/admin/apps','POST',{kind:'web',mode:'native',label:'Collision',address:'https://desktop.example.test:9999',openMode:'window',userIds:[]});assert.equal(response.status,200);
  const app=await response.json();assert.equal((await api('/admin/apps/'+app.id,'PATCH',{enabled:false})).status,200);
  const bytes=await readFile(f.dir+'/state/accounts.json');
  assert.equal((await api('/admin/gateway','PUT',{config:f.config,password})).status,409);
  assert.deepEqual(await readFile(f.dir+'/state/accounts.json'),bytes);assert.equal(relay.experimentalGateway,undefined);
 }finally{await relay?.close();await f.close();}
});
test('same-port real bind failure restores prior listener/configuration and reports failure',async t=>{
 const f=await fixture();let relay;const blocker=http.createServer();
 try{
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});const api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  await api('/admin/gateway','PUT',{config:f.config,password});const bytes=await readFile(f.dir+'/state/gateway-managed.json'),old=relay.experimentalGateway;
  const l={relay,api,cert:f.cert},app=await addGateway(l);await launchGateway(l,app);
  const close=old.close.bind(old);let occupied=false;
  t.mock.method(old,'close',async options=>{await close(options);await new Promise(r=>blocker.listen(f.config.port,f.config.bind,r));occupied=true;});
  const listen=https.Server.prototype.listen;
  t.mock.method(https.Server.prototype,'listen',function(...args){if(occupied){occupied=false;this.once('error',()=>blocker.close());}return listen.apply(this,args);});
  const response=await api('/admin/gateway','PUT',{config:{...f.config,targets:[{...f.config.targets[0],label:'Changed'}]},password});
  assert.equal(response.status,503);assert.equal((await (await api('/session')).json()).windows.length,0,'reverted listener replacement retires gateway windows');assert.deepEqual(await readFile(f.dir+'/state/gateway-managed.json'),bytes);
  assert.deepEqual((await (await api('/admin/gateway')).json()).config,f.config);
  assert.equal((await edgeRequest({cert:f.cert},relay.experimentalGateway.desktopOrigin,'/api/auth')).status,200);
 }finally{t.mock.restoreAll();await relay?.close();await new Promise(r=>blocker.close(r));await f.close();}
});
test('startup refuses a persisted gateway port conflicting with the independent updater',async()=>{
 const f=await fixture();let relay;
 try{
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});const api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));await api('/admin/gateway','PUT',{config:f.config,password});await relay.close();relay=undefined;
  let unexpected;
  try{await assert.rejects(async()=>{unexpected=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone',updater:{socketPath:f.dir+'/broker.sock',keyFile:f.dir+'/bridge.key',uiOrigin:`http://127.0.0.1:${f.config.port}`}});},/gateway.*configuration/i);}finally{await unexpected?.close();}
 }finally{await relay?.close();await f.close();}
});
test('change and disable retire real active HTTP, WebSocket and private profile credentials',async()=>{
 const f=await fixture();let relay,ws,request;const upstream=http.createServer((req,res)=>{
  if(req.url==='/login'){req.resume();res.setHeader('Content-Type','text/plain');res.end('synthetic-token');}
  else if(req.url==='/private'){res.writeHead(req.headers.authorization==='Bearer synthetic-token'?200:401);res.end('private');}
  else if(req.url==='/slow'){res.writeHead(200);res.write('start');const timer=setInterval(()=>res.write('tick'),30);res.once('close',()=>clearInterval(timer));}
  else res.end('okay');
 });
 const wss=new WebSocketServer({server:upstream});wss.on('connection',peer=>peer.on('message',data=>peer.send(data)));
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 try{
  Object.assign(f.config.targets[0],{upstream:`http://127.0.0.1:${upstream.address().port}`,webSocketPaths:['/socket'],authProfile:{login:{method:'POST',path:'/login',status:200,contentType:'text/plain'},maxBytes:128,ttlMs:60000,headers:[{name:'authorization',prefix:'Bearer '}],stripHeaders:[]}});
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});const api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
  assert.equal((await api('/admin/gateway','PUT',{config:f.config,password})).status,200);
  const l={relay,api,cert:f.cert},app=await addGateway(l);
  for(const method of ['PUT','DELETE']){
   const launch=await launchGateway(l,app),cap=await redeemGateway(l,launch),u=new URL(launch.origin);
   assert.equal((await edgeRequest(l,launch.origin,'/private',{headers:{cookie:cap.cookie}})).status,401);
   assert.equal((await edgeRequest(l,launch.origin,'/login',{method:'POST',headers:{origin:launch.origin,cookie:cap.cookie}})).status,200);
   assert.equal((await edgeRequest(l,launch.origin,'/private',{headers:{cookie:cap.cookie}})).status,200);
   const response=await new Promise((resolve,reject)=>{request=https.get({hostname:'127.0.0.1',port:u.port,servername:u.hostname,ca:f.cert,path:'/slow',headers:{host:u.host,cookie:cap.cookie,'sec-fetch-site':'same-origin'}},res=>{res.once('data',()=>resolve(res));});request.on('error',reject);});
   assert.equal(response.statusCode,200,'revocation must start from an authorized live transfer');
   assert.equal(response.complete,false);
   response.on('error',()=>{});const httpClosed=new Promise(r=>response.once('close',r));
   ws=new WebSocket(`wss://127.0.0.1:${u.port}/socket`,{servername:u.hostname,ca:f.cert,headers:{host:u.host,origin:launch.origin,cookie:cap.cookie}});await once(ws,'open');
   ws.send('actual-echo');assert.equal(String((await once(ws,'message'))[0]),'actual-echo');const wsClosed=once(ws,'close');
   const old=relay.experimentalGateway;assert.equal((await api('/admin/gateway',method,{config:f.config,password})).status,200);
   await Promise.all([httpClosed,wsClosed]);assert.equal(response.complete,false);assert.deepEqual(old.stats(),{routes:0,tickets:0,caps:0,active:0});
  }
 }finally{request?.destroy();ws?.terminate();await relay?.close();for(const peer of wss.clients)peer.terminate();wss.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await f.close();}
});
test('ordinary index startup loads managed JSON and explicit disabled state without operator configuration',async()=>{
 const f=await fixture();let relay,child;
 const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}child=null;};
 try{
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'});let api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));await api('/admin/gateway','PUT',{config:f.config,password});await relay.close();relay=undefined;
  const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const origin=`http://127.0.0.1:${port}`;
  const start=async()=>{
   const env={...process.env,PORT:String(port),RELAY_PROFILE:'standalone',RELAY_HOSTNAME:'127.0.0.1',RELAY_NETWORK_MODE:'loopback',RELAY_STATE_DIR:f.dir+'/state'};delete env.RELAY_GATEWAY_CONFIG;
   child=spawn(process.execPath,['server/index.mjs'],{cwd:new URL('../../',import.meta.url),env,stdio:['ignore','pipe','pipe']});
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup deadline')),10000);child.stdout.on('data',data=>{if(String(data).includes('Relay listening')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Startup exited'));});});
   api=client(origin,await authenticate(origin,f.dir+'/state'));
  };
  await start();assert.equal((await (await api('/admin/gateway')).json()).source,'managed');assert.equal((await edgeRequest({cert:f.cert},`https://${f.config.desktopHostname}:${f.config.port}`,'/api/auth')).status,200);
  assert.equal((await api('/admin/gateway','DELETE',{password})).status,200);await stop();await start();assert.equal((await (await api('/admin/gateway')).json()).source,'disabled');await stop();
  const bytes=await readFile(f.dir+'/state/accounts.json');await writeFile(f.dir+'/state/gateway-managed.json','{broken',{mode:0o600});
  await assert.rejects(createGateway({port:0,runtime:f.dir+'/state',profile:'standalone'}),/Invalid managed gateway configuration/);assert.deepEqual(await readFile(f.dir+'/state/accounts.json'),bytes);
 }finally{await stop();await relay?.close();await f.close();}
});
test('admin gateway status is disabled without configuration; ordinary users cannot read management',async()=>{
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-managed-'));let relay;
 try{
  relay=await createGateway({port:0,runtime:dir,profile:'standalone'});
  const api=client(relay.origin,await authenticate(relay.origin,dir));
  const response=await api('/admin/gateway');assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{source:'disabled',enabled:false,desktopOrigin:null,appBaseDomain:null,config:null,limits:{maxTargets:8}});
  assert.equal((await api('/admin/users','POST',{username:'viewer',password})).status,200);
  const viewer=client(relay.origin,await authenticate(relay.origin,dir,'viewer'));
  for(const method of ['GET','POST','PUT','DELETE'])assert.equal((await viewer('/admin/gateway'+(method==='POST'?'/validate':''),method,method==='GET'?undefined:{})).status,403);
 }finally{await relay?.close();await rm(dir,{recursive:true,force:true});}
});
