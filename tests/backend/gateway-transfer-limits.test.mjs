import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {createHash} from 'node:crypto';
import {gatewayLab,addGateway,launchGateway,redeemGateway} from '../gateway-helper.mjs';
test('operator-configured response bound streams a larger file exactly without buffering it in the gateway',{timeout:30000},async()=>{
 const size=65*1024*1024+123,chunk=Buffer.alloc(65536,97);let lab;
 const upstream=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/octet-stream','content-length':size});let left=size;function pump(){while(left){const b=chunk.subarray(0,Math.min(left,chunk.length));left-=b.length;if(!res.write(b)){res.once('drain',pump);return;}}res.end();}pump();});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 try{
  lab=await gatewayLab({targets:[{id:'files',label:'Large synthetic file',upstream:`http://127.0.0.1:${upstream.address().port}`,maxResponseBytes:128*1024*1024}]});
  const target=await launchGateway(lab,await addGateway(lab)),cap=await redeemGateway(lab,target),u=new URL(target.origin);
  const result=await new Promise((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port:u.port,servername:u.hostname,ca:lab.cert,path:'/',headers:{host:u.host,cookie:cap.cookie,'sec-fetch-site':'same-origin'}},res=>{let bytes=0;const hash=createHash('sha256');res.on('data',b=>{bytes+=b.length;hash.update(b);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,bytes,hash:hash.digest('hex')}));});req.on('error',reject);});
  const expected=createHash('sha256');for(let left=size;left>0;left-=Math.min(left,chunk.length))expected.update(chunk.subarray(0,Math.min(left,chunk.length)));
  assert.equal(result.status,200);assert.equal(result.bytes,size);assert.equal(result.hash,expected.digest('hex'));
 }finally{await lab?.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});
