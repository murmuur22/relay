import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import {createGateway} from '../../server/gateway.mjs';
import {gatewayLab} from '../gateway-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';
test('enabling an HTTPS gateway refuses preexisting native apps on its authentication hostname',{timeout:15000},async()=>{
 const lab=await gatewayLab();let gateway;const runtime=lab.dir+'/existing-install';
 try{
  gateway=await createGateway({port:0,runtime,profile:'standalone'});
  const api=client(gateway.origin,await authenticate(gateway.origin,runtime));
  const response=await api('/admin/apps','POST',{kind:'web',mode:'native',label:'Existing native app',address:'https://desktop.relay.test:9443/',openMode:'tab',userIds:[]});
  assert.equal(response.status,200);
  await gateway.close();gateway=undefined;
  const before=await readFile(runtime+'/accounts.json');
  await assert.rejects(async()=>{gateway=await createGateway({port:0,runtime,profile:'standalone',experimentalGateway:lab.experimentalGateway});},/Native.*hostname/i);
  assert.deepEqual(await readFile(runtime+'/accounts.json'),before,'refusal must not rewrite operator accounts');
 }finally{await gateway?.close();await lab.close();}
});

for(const scenario of ['renamed HTTPS edge','management hostname'])test(`${scenario} refuses persisted native collisions before binding or native startup`,{timeout:15000},async()=>{
 const lab=await gatewayLab(),occupied=http.createServer();let gateway;const runtime=lab.dir+'/existing-install';
 try{
  gateway=await createGateway({port:0,runtime,profile:'standalone',experimentalGateway:lab.experimentalGateway});
  const api=client(gateway.origin,await authenticate(gateway.origin,runtime));
  const draft={kind:'web',mode:'native',label:'Persisted native app',address:scenario==='management hostname'?'https://127.0.0.1:9443/':'https://renamed.example.test:9443/',openMode:'tab',userIds:[]};
  if(scenario==='management hostname'){
   // Model legacy registry state accepted by Accounts, without a modern API guard.
   await gateway.accounts.service(null,draft);
  }else assert.equal((await api('/admin/apps','POST',draft)).status,200);
  await gateway.close();gateway=undefined;
  const before=await readFile(runtime+'/accounts.json'),openBefore=await readFile(runtime+'/open-url.txt');
  await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
  const experimentalGateway=scenario==='management hostname'?undefined:{...lab.experimentalGateway,deployment:{bind:'127.0.0.1',desktopHostname:'renamed.example.test',appBaseDomain:'apps.example.test'}};
  const configBefore=JSON.stringify(experimentalGateway);
  // A hostname refusal, not EADDRINUSE, proves validation precedes listener creation.
  await assert.rejects(async()=>{gateway=await createGateway({port:occupied.address().port,runtime,profile:'development',native:true,experimentalGateway});},/Native.*hostname/i);
  assert.deepEqual(await readFile(runtime+'/accounts.json'),before);
  assert.deepEqual(await readFile(runtime+'/open-url.txt'),openBefore);
  assert.equal(JSON.stringify(experimentalGateway),configBefore);
 }finally{await gateway?.close();await new Promise(resolve=>occupied.close(resolve));await lab.close();}
});
