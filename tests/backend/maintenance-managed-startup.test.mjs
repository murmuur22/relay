import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {createGateway} from '../../server/gateway.mjs';
import {Desktop} from '../../server/desktop.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const bounded=async(p,label)=>{let t;try{return await Promise.race([p,new Promise((_,reject)=>t=setTimeout(()=>reject(Error(label)),4000))]);}finally{clearTimeout(t);}};
async function free(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
for(const shutdown of [false,true])test('managed pending startup '+(shutdown?'cannot resurrect listener after shutdown':'restores previous listener under newly held maintenance'),{timeout:15000},async()=>{
 const dir=await mkdtemp(tmpdir()+'/held-managed-'),runtime=dir+'/state',marker=dir+'/maintenance';let g,applying,closing;const entered=defer(),release=defer();const load=Desktop.prototype.load;let armed=false,starts=0;const listen=http.Server.prototype.listen;
 try{
  g=await createGateway({port:0,runtime,profile:'standalone',maintenanceFile:marker});const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth),port=await free();
  const config={version:2,mode:'reverse-proxy',bind:'127.0.0.1',port,desktopOrigin:'https://desktop.example.test',appBaseDomain:'apps.example.test',trustedProxy:'127.0.0.1',targets:[{id:'files',label:'Synthetic',upstream:'http://127.0.0.1:18302'}]};
  assert.equal((await api('/admin/gateway','PUT',{config,password})).status,200);const bytes=await readFile(runtime+'/gateway-managed.json');
  http.Server.prototype.listen=function(...args){if(args[0]===port)starts++;return listen.apply(this,args);};
  Desktop.prototype.load=async function(...args){const state=await load.apply(this,args);if(armed){armed=false;entered.resolve();await release.promise;}return state;};
  armed=true;applying=api('/admin/gateway','PUT',{config,password});await bounded(entered.promise,'listener preflight not reached');
  if(shutdown)closing=g.close();else await writeFile(marker,'LOCAL TEST MAINTENANCE');release.resolve();
  const response=await bounded(applying.catch(()=>null),'managed result');if(response)assert.equal(response.status,503);
  assert.deepEqual(await readFile(runtime+'/gateway-managed.json'),bytes);
  if(shutdown){await bounded(closing,'shutdown barrier');assert.equal(starts,0,'no late new or restoration listener');assert.equal(g.experimentalGateway,undefined);assert.equal(g.server.listening,false);}
  else{assert.equal(starts,2,'replacement and restoration both start under maintenance');assert.ok(g.experimentalGateway);assert.equal((await fetch(g.origin+'/api/session',{headers:{cookie:auth.cookie}})).status,503);await rm(marker);assert.equal((await api('/session')).status,200);assert.equal((await api('/admin/gateway','PUT',{config,password})).status,200);}
 }finally{armed=false;release.resolve();Desktop.prototype.load=load;http.Server.prototype.listen=listen;await applying?.catch(()=>{});await closing?.catch(()=>{});await g?.close();await rm(dir,{recursive:true,force:true});}
});
