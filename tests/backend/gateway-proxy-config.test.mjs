import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGatewayReference} from '../../server/experimental-gateway-config.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
const reference=()=>({version:2,mode:'reverse-proxy',bind:'127.0.0.1',port:18444,desktopOrigin:'https://desktop.example.test',appBaseDomain:'apps.example.test',trustedProxy:'127.0.0.1',targets:[{id:'files',label:'Files',upstream:'http://127.0.0.1:18302'}]});
test('version 2 proxy config separates canonical HTTPS origin from loopback HTTP port without TLS files',async()=>{
 const c=await validateGatewayReference(reference());
 assert.equal(c.proxy.desktopOrigin,'https://desktop.example.test');assert.equal(c.port,18444);assert.equal(c.key,undefined);
 const v=reference();v.desktopOrigin='https://desktop.example.test:9443';assert.equal((await validateGatewayReference(v)).proxy.desktopOrigin,v.desktopOrigin);
});
test('proxy reference validates explicit snippet source ranges and refuses invalid networks',async()=>{
 const v=reference();v.sourceRanges=['192.168.40.0/24'];assert.deepEqual((await validateGatewayReference(v)).proxy.sourceRanges,v.sourceRanges);
 for(const sourceRanges of [null,{},['0.0.0.0/0'],['192.168.40.1/24'],['127.0.0.1/32\nrespond ok']])await assert.rejects(validateGatewayReference({...v,sourceRanges}));
});
test('proxy reference retains protected upstream TLS options independently of edge TLS',async()=>{
 const v=reference();v.targets[0].upstream='https://127.0.0.1:18302';v.targets[0].upstreamTLS={serverName:'upstream.example.test'};
 const c=await validateGatewayReference(v);assert.deepEqual(c.targets[0].tls,{serverName:'upstream.example.test'});assert.equal(c.targets[0].upstreamTLS,undefined);
});
test('proxy listener retains configured HTTPS origin independent of internal port',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-proxy-');let relay;
 try{
  const config=await validateGatewayReference(reference());config.port=0;
  relay=await createGateway({port:0,runtime,profile:'standalone',experimentalGateway:config});
  assert.equal(relay.experimentalGateway.desktopOrigin,reference().desktopOrigin);
 }finally{await relay?.close();await rm(runtime,{recursive:true,force:true});}
});
test('proxy HTTP listener rejects missing and forged metadata before bridging',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-proxy-http-');let relay;
 const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 try{
  const v=reference();v.port=port;relay=await createGateway({port:0,runtime,profile:'standalone',experimentalGateway:await validateGatewayReference(v)});
  const request=(headers,localAddress)=>new Promise((resolve,reject)=>{const q=http.get({hostname:'127.0.0.1',port,path:'/api/auth',headers,localAddress},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.on('error',reject);});
  const headers={host:'desktop.example.test','x-forwarded-host':'desktop.example.test','x-forwarded-proto':'https'};
  assert.equal(await request(headers),200);
  const peer=Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal)?.address;assert.ok(peer,'fixture requires one assigned non-loopback IPv4 source');
  assert.equal(await request(headers,peer),400,'actual nontrusted socket peer is refused even with correct metadata');
  assert.equal(await request(['Host',headers.host,'X-Forwarded-Host',headers.host,'X-Forwarded-Proto','https','X-Forwarded-Proto','https']),400,'raw duplicate protocol rejected');
  assert.equal(await request({host:headers.host}),400);
  assert.equal(await request({...headers,'x-forwarded-proto':'http'}),400);
  assert.equal(await request({...headers,forwarded:'proto=https'}),400);
  assert.equal(await request({...headers,origin:'https://evil.example.test'}),403);
 }finally{await relay?.close();await rm(runtime,{recursive:true,force:true});}
});
test('proxy config refuses remote plaintext, unknown fields and ambiguous origins',async()=>{
 for(const edit of [v=>v.bind='0.0.0.0',v=>v.trustedProxy='192.0.2.1',v=>v.port=443,v=>v.mode='auto',v=>v.keyPath='/tmp/key',v=>v.version=3,...['http://desktop.example.test','https://desktop.example.test/','https://desktop.example.test:0','https://desktop.example.test:443','https://u@desktop.example.test','https://desktop.other.test','https://desktop.example.test?q=x'].map(x=>v=>v.desktopOrigin=x)]){const v=reference();edit(v);await assert.rejects(validateGatewayReference(v));}
});
