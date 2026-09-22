import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, access, realpath, writeFile, readFile, chmod, symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {loadGatewayConfig} from '../../server/experimental-gateway-config.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {edgeRequest,addGateway,launchGateway,redeemGateway} from '../gateway-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';
import http from 'node:http';
import https from 'node:https';
import {tmpdir,networkInterfaces} from 'node:os';
import {spawn} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
async function fixture(){
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-deployment-'));
 await writeFile(dir+'/cert.cnf','[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=desktop.example.test\n[ext]\nsubjectAltName=DNS:desktop.example.test,DNS:*.apps.example.test,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-config',dir+'/cert.cnf'],{stdio:'ignore'});
 await chmod(dir+'/cert.pem',0o600);await chmod(dir+'/key.pem',0o600);
 const config={version:1,bind:'127.0.0.1',port:18443,desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test',keyPath:dir+'/key.pem',certPath:dir+'/cert.pem',targets:[{id:'files',label:'Synthetic Files',upstream:'http://127.0.0.1:18302'}]};
 async function save(){await writeFile(dir+'/gateway.json',JSON.stringify(config),{mode:0o600});return loadGatewayConfig(dir+'/gateway.json');}
 return {dir,config,save,cert:await readFile(dir+'/cert.pem'),close:()=>rm(dir,{recursive:true,force:true})};
}

test('protected JSON config enables custom sibling HTTPS origins and genuine account launch/End/restart isolation',async()=>{
 const f=await fixture();let relay;
 const upstream=http.createServer((req,res)=>res.end('synthetic fixed destination'));
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 try{
  f.config.targets[0].upstream=`http://127.0.0.1:${upstream.address().port}`;
  const experimentalGateway=await f.save();
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone',experimentalGateway});
  assert.equal(relay.experimentalGateway.desktopOrigin,'https://desktop.example.test:18443');
  const admin=await authenticate(relay.origin,f.dir+'/state'),api=client(relay.origin,admin);
  const l={relay,api,cert:f.cert};
  assert.deepEqual(await (await api('/gateway/config')).json(),{enabled:true,desktopOrigin:relay.experimentalGateway.desktopOrigin,appBaseDomain:'apps.example.test',targets:[{id:'files',label:'Synthetic Files'}]});
  const native=await api('/admin/apps','POST',{kind:'web',mode:'native',label:'Bad native',address:'https://desktop.example.test:18444',openMode:'window',userIds:[]});
  assert.equal(native.status,400,'native apps cannot share configured desktop cookie hostname');
  const app=await addGateway(l),launch=await launchGateway(l,app);
  assert.match(launch.origin,/^https:\/\/[a-f0-9]{32}\.apps\.example\.test:18443$/);
  const cap=await redeemGateway(l,launch);assert.equal(cap.status,200);
  assert.match(cap.headers['set-cookie'][0],/Secure/);assert.doesNotMatch(cap.headers['set-cookie'][0],/Domain=/i);
  assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie}})).text,'synthetic fixed destination');
  assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie,origin:'https://evil.example.test:18443'}})).status,403);
  assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie,host:'evil.example.test:18443'}})).status,403);
  assert.equal((await api('/gateway/end','POST',{appId:app.id,launchId:launch.launchId})).status,200);
  assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie}})).status,403);
  const later=await launchGateway(l,app),laterCap=await redeemGateway(l,later);
  await relay.close();relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone',experimentalGateway});
  assert.equal((await fetch(relay.origin+'/api/session',{headers:{cookie:admin.cookie}})).status,401);
  assert.equal((await edgeRequest(l,later.origin,'/',{headers:{cookie:laterCap.cookie}})).status,403);
 }finally{await relay?.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await f.close();}
});

test('fixed HTTPS upstream validates explicit CA and hostname and refuses foreign redirects',async()=>{
 const f=await fixture();let relay;
 const upstream=https.createServer({cert:f.cert,key:await readFile(f.dir+'/key.pem')},(req,res)=>{
  if(req.url==='/redirect'){res.writeHead(302,{location:'https://example.com/'});res.end();}else res.end('verified TLS upstream');
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 try{
  f.config.targets[0].upstream=`https://127.0.0.1:${upstream.address().port}`;
  f.config.targets[0].upstreamTLS={caPath:f.dir+'/cert.pem',serverName:'desktop.example.test'};
  const experimentalGateway=await f.save();
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone',experimentalGateway});
  const api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state')),l={relay,api,cert:f.cert};
  const launch=await launchGateway(l,await addGateway(l)),cap=await redeemGateway(l,launch);
  assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie}})).text,'verified TLS upstream');
  assert.equal((await edgeRequest(l,launch.origin,'/redirect',{headers:{cookie:cap.cookie}})).status,502);
  await relay.close();relay=undefined;
  for(const tls of [{caPath:f.dir+'/cert.pem',serverName:'wrong.example.test'},undefined]){
   f.config.targets[0].upstreamTLS=tls;
   relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone',experimentalGateway:await f.save()});
   l.api=client(relay.origin,await authenticate(relay.origin,f.dir+'/state'));
   const apps=await (await l.api('/session')).json();const app=apps.apps.find(a=>a.mode==='gateway');
   const next=await launchGateway(l,app),nextCap=await redeemGateway(l,next);
   assert.equal((await edgeRequest(l,next.origin,'/',{headers:{cookie:nextCap.cookie}})).status,502);
   await relay.close();relay=undefined;
  }
 }finally{await relay?.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await f.close();}
});

test('malformed deployment inputs refuse before state writes; protected files and conservative same-site policy',async()=>{
 const f=await fixture();const original=structuredClone(f.config);
 try{
  const mutations=[
   v=>v.version=2,v=>v.extra='secret',v=>v.port=443,v=>v.bind='0.0.0.0',v=>v.bind='192.0.2.77',
   v=>v.desktopHostname=v.appBaseDomain,v=>v.appBaseDomain='apps.other.test',v=>v.appBaseDomain='apps.desktop.example.test',
   v=>{v.desktopHostname='desktop.co.uk';v.appBaseDomain='apps.co.uk';},
   v=>{v.desktopHostname='desktop.github.io';v.appBaseDomain='apps.github.io';},
   v=>{v.desktopHostname='desktop.s3.amazonaws.com';v.appBaseDomain='apps.s3.amazonaws.com';},
   v=>v.targets[0].upstream='http://169.254.169.254',v=>v.targets[0].upstream='http://100.100.100.200',
   v=>v.targets[0].upstream='http://224.0.0.1',v=>v.targets[0].upstream='http://0.0.0.0',
   v=>v.targets[0].upstream='http://localhost:8000',v=>v.targets[0].upstream='http://127.1:8000',
   v=>v.targets[0].upstream='http://user:secret@127.0.0.1:8000',
   v=>v.targets[0].upstream='http://127.0.0.1:8000/path',
   v=>v.targets[0].maxResponseBytes=1, v=>v.targets[0].maxResponseBytes=null,v=>v.targets[0].maxResponseBytes=0,v=>v.targets[0].maxResponseBytes=1024*1024*1024+1,v=>v.targets[0].maxResponseBytes='large',
   v=>v.keyPath='relative-key.pem',v=>v.certPath=f.dir+'/key.pem',
   v=>{v.desktopHostname='other.example.test';},v=>{v.appBaseDomain='other.example.test';},
  ];
  for(const mutate of mutations){Object.assign(f.config,structuredClone(original));delete f.config.extra;mutate(f.config);await assert.rejects(f.save(),{message:'Invalid gateway deployment configuration'});await assert.rejects(access(f.dir+'/state'));}
  Object.assign(f.config,structuredClone(original));delete f.config.extra;
  await f.save();await chmod(f.dir+'/gateway.json',0o644);
  await assert.rejects(loadGatewayConfig(f.dir+'/gateway.json'));await chmod(f.dir+'/gateway.json',0o600);
  await symlink(f.dir+'/gateway.json',f.dir+'/link.json');await assert.rejects(loadGatewayConfig(f.dir+'/link.json'));
  await symlink(f.dir,f.dir+'/alias');await assert.rejects(loadGatewayConfig(f.dir+'/alias/gateway.json'));
  await writeFile(f.dir+'/large.json',' '.repeat(65537),{mode:0o600});await assert.rejects(loadGatewayConfig(f.dir+'/large.json'));
  await assert.rejects(loadGatewayConfig('relative.json'));
  for(const upstream of ['http://192.168.10.2:8080','http://100.64.0.2:8080']){f.config.targets[0].upstream=upstream;await f.save();}
 }finally{await f.close();}
});

test('configured fixed TLS WebSockets and HTTP keep real per-account grants, bounds and revocation',async()=>{
 const f=await fixture();let relay,ws;
 const upstream=https.createServer({cert:f.cert,key:await readFile(f.dir+'/key.pem')},(req,res)=>{
  if(req.url==='/oversized'){res.writeHead(200,{'content-length':String(64*1024*1024+1)});res.end('x');}else res.end('bounded');
 });
 const wss=new WebSocketServer({server:upstream});wss.on('connection',peer=>peer.on('message',b=>peer.send(b)));
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 try{
  Object.assign(f.config.targets[0],{upstream:`https://127.0.0.1:${upstream.address().port}`,upstreamTLS:{caPath:f.dir+'/cert.pem',serverName:'desktop.example.test'},webSocketPaths:['/socket']});
  relay=await createGateway({port:0,runtime:f.dir+'/state',profile:'standalone',experimentalGateway:await f.save()});
  const l={relay,cert:f.cert,api:client(relay.origin,await authenticate(relay.origin,f.dir+'/state'))};
  const users=[];
  for(const username of ['alice','bob'])users.push(await(await l.api('/admin/users','POST',{username,password:'Synthetic-test-passphrase-42!'})).json());
  const app=await addGateway(l,users.map(u=>u.id));
  const alice=client(relay.origin,await authenticate(relay.origin,f.dir+'/state','alice'));
  const bob=client(relay.origin,await authenticate(relay.origin,f.dir+'/state','bob'));
  const a=await launchGateway(l,app,alice),b=await launchGateway(l,app,bob),ac=await redeemGateway(l,a),bc=await redeemGateway(l,b);
  assert.notEqual(a.origin,b.origin);
  assert.equal((await edgeRequest(l,a.origin,'/',{headers:{cookie:bc.cookie}})).status,403);
  assert.equal((await edgeRequest(l,a.origin,'/',{method:'POST',headers:{cookie:ac.cookie,origin:a.origin,'content-length':String(1024*1024+1)}})).status,413);
  assert.equal((await edgeRequest(l,a.origin,'/oversized',{headers:{cookie:ac.cookie}})).status,502);
  assert.equal((await edgeRequest(l,a.origin,'/',{headers:{cookie:ac.cookie}})).status,200);
  ws=new WebSocket(a.origin.replace('https:','wss:')+'/socket',{ca:f.cert,lookup:(_host,_opts,cb)=>cb(null,[{address:'127.0.0.1',family:4}]),headers:{origin:a.origin,cookie:ac.cookie}});
  ws.on('error',()=>{});await once(ws,'open');ws.send('synthetic verified WSS');assert.equal((await once(ws,'message'))[0].toString(),'synthetic verified WSS');
  const closed=once(ws,'close');assert.equal((await l.api('/admin/users/'+users[0].id,'PATCH',{grants:[]})).status,200);await closed;
  assert.equal((await edgeRequest(l,a.origin,'/',{headers:{cookie:ac.cookie}})).status,403);
  assert.equal((await edgeRequest(l,b.origin,'/',{headers:{cookie:bc.cookie}})).status,200);
 }finally{ws?.terminate();await relay?.close();for(const peer of wss.clients)peer.terminate();wss.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await f.close();}
});

test('certificate lifetime and key correspondence refuse under the pre-state loader',async context=>{
 const f=await fixture(),other=await fixture();
 try{
  const x=new X509Certificate(f.cert);
  context.mock.method(Date,'now',()=>Date.parse(x.validTo)+1);
  await assert.rejects(f.save(),{message:'Invalid gateway deployment configuration'});
  context.mock.restoreAll();context.mock.method(Date,'now',()=>Date.parse(x.validFrom)-1);
  await assert.rejects(f.save(),{message:'Invalid gateway deployment configuration'});
  context.mock.restoreAll();f.config.keyPath=other.dir+'/key.pem';
  await assert.rejects(f.save(),{message:'Invalid gateway deployment configuration'});
  await assert.rejects(access(f.dir+'/state'));
 }finally{context.mock.restoreAll();await f.close();await other.close();}
});

test('server/index installed entrypoint loads opt-in and exposes real HTTPS enrollment without changing operator files',async()=>{
 const f=await fixture();let child;
 try{
  await f.save();
  const before=await readFile(f.dir+'/gateway.json');
  child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,RELAY_PROFILE:'standalone',RELAY_STATE_DIR:f.dir+'/state',RELAY_GATEWAY_CONFIG:f.dir+'/gateway.json',RELAY_HOSTNAME:'localhost',RELAY_NETWORK_MODE:'loopback',PORT:'18764'}});
  let output='';child.stderr.on('data',b=>output+=b);
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Startup readiness deadline')),8000);
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Startup failed: '+output));});
   child.stdout.on('data',b=>{output+=b;if(output.includes('Relay listening on')){clearTimeout(timer);resolve();}});
  });
  const origin='https://desktop.example.test:18443',l={cert:f.cert};
  const info=(await edgeRequest(l,origin,'/api/auth')).json();assert.equal(info.setup,true);
  const setup=new URL(await readFile(f.dir+'/state/setup-url.txt','utf8')).hash.slice(1);
  const login=await edgeRequest(l,origin,'/api/enroll',{method:'POST',headers:{origin,'content-type':'application/json','x-csrf-token':info.csrf},body:{username:'admin',password:'Synthetic-test-passphrase-42!',setup}});
  assert.equal(login.status,200);const cookie=login.headers['set-cookie'][0];
  assert.match(cookie,/^__Host-relay_session=/);assert.match(cookie,/Secure/);assert.doesNotMatch(cookie,/Domain=/i);
  const session=await edgeRequest(l,origin,'/api/session',{headers:{cookie:cookie.split(';')[0]}});
  assert.equal(session.status,200);
  assert.equal(JSON.stringify(session.json()).includes('keyPath'),false);
  assert.equal(JSON.stringify(session.json()).includes('127.0.0.1:18302'),false);
  assert.equal((await edgeRequest(l,origin,'/api/session',{headers:{cookie:cookie.split(';')[0],origin:'null'}})).status,403);
  assert.deepEqual(await readFile(f.dir+'/gateway.json'),before);
  assert.equal(output.includes(f.dir),false);
 }finally{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await f.close();}
});

test('assigned private LAN management and fixed LAN destination work without changing network configuration',async context=>{
 const address=Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal&&/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(n.address))?.address;
 if(!address){context.skip('No assigned RFC1918 IPv4 on this host');return;}
 const f=await fixture();let relay;
 const upstream=http.createServer((req,res)=>res.end('synthetic assigned-interface upstream'));
 await new Promise(r=>upstream.listen(0,address,r));
 try{
  f.config.targets[0].upstream=`http://${address}:${upstream.address().port}`;
  relay=await createGateway({port:0,hostname:address,networkMode:'private-lan',profile:'standalone',runtime:f.dir+'/state',experimentalGateway:await f.save()});
  const l={relay,cert:f.cert,api:client(relay.origin,await authenticate(relay.origin,f.dir+'/state'))};
  const launch=await launchGateway(l,await addGateway(l)),cap=await redeemGateway(l,launch);
  assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie}})).text,'synthetic assigned-interface upstream');
  assert.equal((await edgeRequest(l,relay.experimentalGateway.desktopOrigin,'/api/auth')).status,200);
  await relay.close();relay=undefined;f.config.bind=address;
  relay=await createGateway({port:0,hostname:address,networkMode:'private-lan',profile:'standalone',runtime:f.dir+'/state',experimentalGateway:await f.save()});
  const status=await new Promise((resolve,reject)=>{
   const request=https.get({hostname:address,port:f.config.port,servername:f.config.desktopHostname,ca:f.cert,path:'/api/auth',headers:{host:`${f.config.desktopHostname}:${f.config.port}`}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);
  });
  assert.equal(status,200,'explicit assigned-interface TLS listener');
 }finally{await relay?.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await f.close();}
});

test('conflicting management and edge ports refuse before state initialization',async()=>{
 const f=await fixture();
 try{
  const experimentalGateway=await f.save();
  await assert.rejects(createGateway({port:f.config.port,runtime:f.dir+'/state',profile:'standalone',experimentalGateway}));
  await assert.rejects(access(f.dir+'/state'));
 }finally{await f.close();}
});

test('configured startup refuses missing config before creating state, with sanitized error',async()=>{
 const dir=await mkdtemp(tmpdir()+'/relay-deployment-');
 try{
  const result=await new Promise(resolve=>{
   const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,RELAY_PROFILE:'standalone',RELAY_STATE_DIR:dir+'/state',RELAY_GATEWAY_CONFIG:dir+'/private-missing.json',PORT:'18763'}});
   let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
   const timeout=setTimeout(()=>child.kill('SIGTERM'),2500);
   child.on('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal,output});});
  });
  assert.equal(result.code,1,'invalid opt-in config must refuse startup');
  assert.match(result.output,/Invalid gateway deployment configuration/);
  assert.equal(result.output.includes(dir),false);
  await assert.rejects(access(dir+'/state'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
