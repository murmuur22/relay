import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';

test('held managed Native status drops a hidden observer but preserves another live observer',{timeout:15000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/status-owner-');
 let relay,release=()=>{},entered;
 const ready=new Promise(resolve=>entered=resolve);
 let hits=0;
 const site=http.createServer((req,res)=>{
  hits++;assert.equal(req.method,'HEAD');
  release=()=>res.end();entered();
 });
 let adminPending,viewerPending;
 try{
  await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
  relay=await createGateway({port:0,runtime,profile:'standalone',hostname:'localhost'});
  const admin=client(relay.origin,await authenticate(relay.origin,runtime));
  const appResponse=await admin('/admin/apps','POST',{kind:'web',mode:'native',label:'Managed fixture',address:'http://127.0.0.1:'+site.address().port,icon:'globe'});
  assert.equal(appResponse.status,200);const app=await appResponse.json();
  assert.equal((await admin('/admin/users','POST',{username:'viewer',password,grants:[app.id]})).status,200);
  const viewer=client(relay.origin,await authenticate(relay.origin,runtime,'viewer'));
  adminPending=admin('/status');
  let timer;try{await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Fixture HEAD did not arrive')),3000))]);}finally{clearTimeout(timer);}
  viewerPending=viewer('/status');
  assert.equal((await admin('/preferences','PATCH',{showAppStatus:false})).status,200);
  release();
  assert.deepEqual(await(await adminPending).json(),{});
  const viewerResult=await viewerPending;assert.equal(viewerResult.status,200);
  const observation=(await viewerResult.json())[app.id];
  assert.equal(observation.httpStatus,200);assert.equal(observation.source,'relay');
  assert.equal(hits,1,'another live observer shares the bounded observation');
  assert.deepEqual(await(await admin('/status')).json(),{});
  assert.equal(hits,1,'hidden status does not generate another upstream request');
 }finally{
  release();await Promise.allSettled([adminPending,viewerPending]);
  await relay?.close();site.closeAllConnections();await new Promise(resolve=>site.close(resolve));
  await rm(runtime,{recursive:true,force:true});
 }
});
