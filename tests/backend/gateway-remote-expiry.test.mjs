import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';
import {remotePKI,remoteReference,shortCertificate} from '../remote-tls-helper.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {validateGatewayReference} from '../../server/experimental-gateway-config.mjs';
import {authenticate,client} from '../auth-helper.mjs';
async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
for(const kind of ['client-intermediate','server-intermediate','client-leaf','client-root','server-root','server-leaf'])test(`mTLS ${kind==='client-intermediate'?'rejects intermediate-issued client identity upfront':kind+' expiry retires already established real HTTP and WebSocket traffic'}`,{timeout:25000},async()=>{
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-tls-expiry-'));let relay,ws,response;const sockets=new Set();
 const up=http.createServer((q,r)=>{r.writeHead(200);r.write('active');const timer=setInterval(()=>r.write('tick'),20);r.on('close',()=>clearInterval(timer));});
 const wss=new WebSocketServer({server:up});wss.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('message',m=>s.send(m));});await new Promise(r=>up.listen(0,'127.0.0.1',r));
 try{
  const pki=await remotePKI(dir),port=await freePort(),expires=Date.now()+6500;let identity=pki.client;
  if(kind==='client-intermediate'){
   const intermediate=await shortCertificate(dir,'intermediate','client-ca','Client intermediate',null,{ca:true,expires});
   const leaf=await shortCertificate(dir,'chained-client','intermediate','caddy.example.test','clientAuth',{expires:Date.now()+86400000});identity={key:leaf.key,cert:Buffer.concat([leaf.cert,intermediate.cert])};
  }else if(kind==='server-intermediate'){
   const intermediate=await shortCertificate(dir,'intermediate','server-ca','Server intermediate',null,{ca:true,expires});
   const leaf=await shortCertificate(dir,'chained-server','intermediate','backend.example.test','serverAuth',{expires:Date.now()+86400000});await writeFile(dir+'/server.pem',Buffer.concat([leaf.cert,intermediate.cert,pki['server-ca'].cert]));await writeFile(dir+'/server.key',leaf.key);
  }else if(kind==='client-root'||kind==='server-root'){
   const side=kind.split('-')[0],root=await shortCertificate(dir,'short-root',side+'-ca','Short root',null,{ca:true,selfSigned:true,expires});
   const leaf=await shortCertificate(dir,'root-leaf','short-root',side==='client'?'caddy.example.test':'backend.example.test',side==='client'?'clientAuth':'serverAuth',{expires:Date.now()+86400000});
   if(side==='client'){await writeFile(dir+'/client-ca.pem',root.cert);identity=leaf;}
   else{pki['server-ca'].cert=root.cert;await writeFile(dir+'/server.pem',Buffer.concat([leaf.cert,root.cert]));await writeFile(dir+'/server.key',leaf.key);}
  }else if(kind==='server-leaf'){
   const leaf=await shortCertificate(dir,'short-server','server-ca','backend.example.test','serverAuth',{expires});await writeFile(dir+'/server.pem',Buffer.concat([leaf.cert,pki['server-ca'].cert]));await writeFile(dir+'/server.key',leaf.key);
  }else identity=await shortCertificate(dir,'short-client','client-ca','caddy.example.test','clientAuth',{expires});
  const ref=remoteReference(dir,port);ref.targets[0].upstream=`http://127.0.0.1:${up.address().port}`;ref.targets[0].webSocketPaths=['/socket'];
  relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone',experimentalGateway:await validateGatewayReference(ref)});
  const api=client(relay.origin,await authenticate(relay.origin,dir+'/state'));
  const app=await (await api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Files',gateway:{target:'files'},userIds:[]})).json();
  assert.equal((await api('/windows','POST',{appId:app.id})).status,200);const launch=await (await api('/gateway/launch','POST',{appId:app.id})).json();const u=new URL(launch.origin);
  const options={hostname:'127.0.0.1',port,servername:'backend.example.test',ca:pki['server-ca'].cert,...identity,agent:false,headers:{host:u.host,origin:launch.origin,'x-forwarded-host':u.host,'x-forwarded-proto':'https','sec-fetch-site':'same-origin'}};
  const redemption=await new Promise((resolve,reject)=>{const q=https.request({...options,path:'/.relay/redeem',method:'POST'},r=>{r.resume();r.on('end',()=>resolve({status:r.statusCode,cookie:r.headers['set-cookie']?.[0].split(';')[0]}));});q.on('error',reject);q.end(JSON.stringify({ticket:launch.ticket}));});
  if(kind==='client-intermediate'){assert.equal(redemption.status,400);return;}
  assert.equal(redemption.status,200);const cap=redemption.cookie;
  response=await new Promise((resolve,reject)=>{const q=https.get({...options,path:'/slow',headers:{...options.headers,cookie:cap}},r=>r.once('data',()=>resolve(r)));q.on('error',reject);});assert.equal(response.statusCode,200);assert.equal(response.complete,false);response.on('error',()=>{});let httpClosed=false;response.once('close',()=>httpClosed=true);
  ws=new WebSocket(`wss://127.0.0.1:${port}/socket`,{...options,headers:{...options.headers,cookie:cap}});await once(ws,'open');const echoed=once(ws,'message');ws.send('before expiry');assert.equal((await echoed)[0].toString(),'before expiry');let wsClosed=false;ws.once('close',()=>wsClosed=true);
  await new Promise(r=>setTimeout(r,Math.max(0,expires-Date.now())+600));
  assert.equal(httpClosed,true,'active HTTP must close when any chain certificate expires');assert.equal(wsClosed,true,'active WebSocket must close when any chain certificate expires');assert.equal(response.complete,false);
 }finally{ws?.terminate();response?.destroy();await relay?.close();for(const s of sockets)s.terminate();wss.close();up.closeAllConnections();await new Promise(r=>up.close(r));await rm(dir,{recursive:true,force:true});}
});
for(const version of ['TLSv1.2','TLSv1.3'])test(`mTLS ${version} refuses resumed identity without a freshly verified chain`,async()=>{
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-tls-resume-'));let relay;
 try{
  const pki=await remotePKI(dir),port=await freePort();relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone',experimentalGateway:await validateGatewayReference(remoteReference(dir,port))});
  async function connect(session){return new Promise((resolve,reject)=>{let reused;const s=tls.connect({host:'127.0.0.1',port,servername:'backend.example.test',ca:pki['server-ca'].cert,...pki.client,minVersion:version,maxVersion:version,session},()=>s.write('GET /api/auth HTTP/1.1\r\nHost: desktop.example.test\r\nX-Forwarded-Host: desktop.example.test\r\nX-Forwarded-Proto: https\r\nConnection: close\r\n\r\n'));let saved,text='';s.on('secureConnect',()=>reused=s.isSessionReused());s.on('session',b=>saved=b);s.on('data',b=>text+=b);s.on('error',reject);s.on('close',()=>resolve({session:saved,reused,text}));});}
  const first=await connect();assert.match(first.text,/^HTTP\/1.1 200/);assert.ok(Buffer.isBuffer(first.session),'capture an actual TLS session for the replay attempt');const second=await connect(first.session);assert.match(second.text,/^HTTP\/1.1 200/);assert.equal(second.reused,false,'fresh full client-chain verification required');
 }finally{await relay?.close();await rm(dir,{recursive:true,force:true});}
});
