import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,writeFile,readFile} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import {remotePKI,remoteReference} from '../remote-tls-helper.mjs';
import {validateGatewayReference} from '../../server/experimental-gateway-config.mjs';
import {authenticate,client as apiClient,password} from '../auth-helper.mjs';
import {createGateway} from '../../server/gateway.mjs';

test('v3 authenticates backend TLS server and exact CA-bound client identity before forwarding',async()=>{
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-remote-'));let relay;
 try{
  const pki=await remotePKI(dir),probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const ref=remoteReference(dir,port);await validateGatewayReference(ref);
  await writeFile(dir+'/gateway.json',JSON.stringify(ref),{mode:0o600});
  relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone',gatewayConfigPath:dir+'/gateway.json'});
  const api=apiClient(relay.origin,await authenticate(relay.origin,dir+'/state'));
  const status=await (await api('/admin/gateway')).json();assert.equal(status.source,'operator');assert.equal(status.config,null);
  for(const method of ['PUT','DELETE'])assert.equal((await api('/admin/gateway',method,{config:ref,password})).status,409);
  assert.equal((await api('/admin/gateway/validate','POST',{config:ref})).status,409);
  assert.equal((await (await api('/gateway/config')).text()).includes(dir),false,'public topology metadata excludes TLS paths');
  const request=(client='client',extra={})=>new Promise((resolve,reject)=>{const q=https.get({hostname:'127.0.0.1',port,servername:'backend.example.test',ca:pki['server-ca'].cert,...(client?pki[client]:{}),agent:false,path:'/api/auth',headers:{host:'desktop.example.test','x-forwarded-host':'desktop.example.test','x-forwarded-proto':'https'},...extra},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.on('error',reject);});
  assert.equal(await request(),200);
  for(const client of [null,'wrong-ca','wrong-usage','expired-client'])await assert.rejects(request(client));
  assert.equal(await request('wrong-name'),400);
  await assert.rejects(request('client',{servername:'wrong.example.test'}));
  await assert.rejects(request('client',{ca:pki['other-ca'].cert}));
  assert.equal(await request('client',{headers:{host:'desktop.example.test'}}),400);
  const peer=Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal)?.address;assert.ok(peer,'assigned non-loopback source');
  assert.equal(await request('client',{localAddress:peer}),400);
  const headers={host:'desktop.example.test','x-forwarded-host':'desktop.example.test','x-forwarded-proto':'https'};
  assert.equal(await request('client',{headers:{...headers,origin:'https://evil.example.test'}}),403);
  assert.equal(await request('client',{headers:{...headers,host:'evil.example.test','x-forwarded-host':'evil.example.test'}}),403);
  const expired={...ref,backendTLS:{...ref.backendTLS,keyPath:dir+'/expired-server.key',certPath:dir+'/expired-server.pem'}};
  await assert.rejects(validateGatewayReference(expired));
  await writeFile(dir+'/leaf-only.pem',pki.server.cert.toString().match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)[0],{mode:0o600});
  await assert.rejects(validateGatewayReference({...ref,backendTLS:{...ref.backendTLS,certPath:dir+'/leaf-only.pem'}}),'complete server chain must include root lifetime');
  for(const content of [Buffer.concat([pki['server-ca'].cert,pki.server.cert]),Buffer.concat([await readFile(dir+'/leaf-only.pem'),pki['other-ca'].cert])]){
   await writeFile(dir+'/bad-chain.pem',content,{mode:0o600});await assert.rejects(validateGatewayReference({...ref,backendTLS:{...ref.backendTLS,certPath:dir+'/bad-chain.pem'}}));
  }
  const expiredServer=https.createServer(pki['expired-server'],(q,r)=>r.end('must not trust'));await new Promise(r=>expiredServer.listen(0,'127.0.0.1',r));
  try{await assert.rejects(request('client',{port:expiredServer.address().port}),{code:'CERT_HAS_EXPIRED'});}finally{await new Promise(r=>expiredServer.close(r));}
  // Real raw TLS HTTP/WS requests: no merged-header mock can hide duplicates.
  for(const upgrade of [false,true])for(const extra of ['X-Forwarded-Proto: https','X-Forwarded-Host: desktop.example.test','Forwarded: proto=https','X-Real-IP: 127.0.0.1','X-Forwarded-For: 127.0.0.1','Origin: https://desktop.example.test\r\nOrigin: https://desktop.example.test']){
   const result=await new Promise((resolve,reject)=>{let text='';const s=tls.connect({host:'127.0.0.1',port,servername:'backend.example.test',ca:pki['server-ca'].cert,...pki.client},()=>s.write(`GET ${upgrade?'/ws/stream/test':'/api/auth'} HTTP/1.1\r\nHost: desktop.example.test\r\nX-Forwarded-Host: desktop.example.test\r\nX-Forwarded-Proto: https\r\n${upgrade?'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: c3ludGhldGljMTIzNDU2Nw==\r\n':'Connection: close\r\n'}${extra}\r\n\r\n`));s.on('data',b=>text+=b);s.on('error',reject);s.on('close',()=>resolve(text));s.setTimeout(5000,()=>s.destroy(Error('raw request timeout')));});assert.match(result,upgrade?/^HTTP\/1.1 403/:/^HTTP\/1.1 (400|403)/);
  }
  for(const edit of [v=>v.extra=true,v=>v.sourceRanges=null,v=>v.backendTLS.extra=true,v=>v.caddyTLS.extra=true,v=>v.trustedProxy='0.0.0.0',v=>v.bind='0.0.0.0',v=>v.trustedProxy='8.8.8.8',v=>v.backendTLS.clientName='*.example.test',v=>v.backendTLS.serverName='wrong.example.test',v=>v.backendTLS.clientCAPath=dir+'/client.pem']){const v=structuredClone(ref);edit(v);await assert.rejects(validateGatewayReference(v));}
 }finally{await relay?.close();await rm(dir,{recursive:true,force:true});}
});
