import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,realpath,chmod,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
import {edgeRequest} from '../gateway-helper.mjs';

async function fixture(t){
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-retirement-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-subj','/CN=desktop-a.example.test','-addext','subjectAltName=DNS:desktop-a.example.test,DNS:desktop-b.example.test,DNS:*.apps.example.test'],{stdio:'ignore'});
 await chmod(dir+'/key.pem',0o600);await chmod(dir+'/cert.pem',0o600);
 const upstream=http.createServer((req,res)=>res.end('synthetic retirement fixture'));
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const config={version:1,bind:'127.0.0.1',port,desktopHostname:'desktop-a.example.test',appBaseDomain:'apps.example.test',keyPath:dir+'/key.pem',certPath:dir+'/cert.pem',targets:[{id:'files',label:'Files',upstream:`http://127.0.0.1:${upstream.address().port}`}]};
 const relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone'});
 let closing;
 const close=()=>closing??=(async()=>{await relay.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});})();
 t.after(close);
 const api=client(relay.origin,await authenticate(relay.origin,dir+'/state'));
 assert.equal((await api('/admin/gateway','PUT',{config,password})).status,200);
 return {dir,config,relay,api,cert:await readFile(dir+'/cert.pem'),close};
}
async function httpsLogin(f){
 const origin=f.relay.experimentalGateway.desktopOrigin;
 const auth=await edgeRequest(f,origin,'/api/auth');assert.equal(auth.status,200);
 const login=await edgeRequest(f,origin,'/api/login',{method:'POST',headers:{origin,'content-type':'application/json','x-csrf-token':auth.json().csrf},body:{username:'admin',password}});
 assert.equal(login.status,200);const cookie=login.headers['set-cookie'][0].split(';')[0];
 assert.ok(cookie.startsWith('__Host-relay_session='));
 const response=await edgeRequest(f,origin,'/api/session',{headers:{cookie}});assert.equal(response.status,200);
 return {cookie,s:response.json()};
}
for(const transition of ['replace','disable'])test(`retired authentication hostname stays denied to Native after ${transition} with live HTTPS session`,{timeout:20000},async t=>{
 const f=await fixture(t);
 try{
  const auth=await httpsLogin(f);
  const changed=transition==='replace'?await f.api('/admin/gateway','PUT',{config:{...f.config,desktopHostname:'desktop-b.example.test'},password}):await f.api('/admin/gateway','DELETE',{password});
  assert.equal(changed.status,200);
  const oldSession=client(f.relay.origin,{...auth,cookie:auth.cookie.replace('__Host-relay_session=','relay_session=')});
  assert.equal((await oldSession('/session')).status,200,'the retired host cookie still identifies a valid session');
  if(transition==='replace')assert.equal((await edgeRequest(f,f.relay.experimentalGateway.desktopOrigin,'/api/session',{headers:{cookie:auth.cookie}})).status,200);
  const draft={kind:'web',mode:'native',label:'Retired host',address:'https://desktop-a.example.test:9443/',openMode:'window',userIds:[]};
  const response=await oldSession('/admin/apps','POST',draft);
  assert.equal(response.status,400,'retired authentication host must not become a Native destination');
  assert.match((await response.json()).error,/different hostname/);
  assert.equal((await oldSession('/admin/apps/check','POST',draft)).status,400);
  assert.equal((await oldSession('/onboarding/app','POST',draft)).status,400);
  const safe=await oldSession('/admin/apps','POST',{...draft,address:'https://unrelated.example.test:9443/'});
  assert.equal(safe.status,200,'unrelated Native hosts remain supported');
  const app=await safe.json();
  assert.equal((await oldSession('/admin/apps/'+app.id,'PATCH',{address:draft.address})).status,400);
  assert.equal((await oldSession('/admin/apps','POST',{...draft,address:'http://127.0.0.1:9443/'})).status,400,'management hostname guard remains');
 }finally{await f.close();}
});

for(const method of ['PUT','DELETE'])test(`postcommit ${method} persistence failure retires every gateway window across sessions`,{timeout:20000},async t=>{
 const f=await fixture(t);let fault;
 try{
  const userResponse=await f.api('/admin/users','POST',{username:'reader',password});assert.equal(userResponse.status,200);const user=await userResponse.json();
  const readerAuth=await authenticate(f.relay.origin,f.dir+'/state','reader'),reader=client(f.relay.origin,readerAuth);
  const apps=[];
  for(const label of ['Files one','Files two']){
   const response=await f.api('/admin/apps','POST',{kind:'web',mode:'gateway',label,gateway:{target:'files'},userIds:[user.id]});assert.equal(response.status,200);apps.push(await response.json());
  }
  const nativeResponse=await f.api('/admin/apps','POST',{kind:'web',mode:'native',label:'Unrelated',address:'https://unrelated.example.test/',openMode:'window',userIds:[user.id]});assert.equal(nativeResponse.status,200);const native=await nativeResponse.json();
  for(const api of [f.api,reader])for(const app of [...apps,native])assert.equal((await api('/windows','POST',{appId:app.id})).status,200);
  for(const api of [f.api,reader])assert.equal((await api('/gateway/launch','POST',{appId:apps[0].id})).status,200);
  const old=f.relay.experimentalGateway;assert.equal(old.stats().routes,2);
  fault=f.relay.manager.runtime+'/layout.tmp';await mkdir(fault);
  const replacement={...f.config,desktopHostname:'desktop-b.example.test'};
  const response=await f.api('/admin/gateway',method,{config:replacement,password});
  assert.equal(response.status,503);assert.match((await response.json()).error,/configuration applied/i);
  assert.deepEqual(JSON.parse(await readFile(f.dir+'/state/gateway-managed.json','utf8')),method==='PUT'?replacement:{version:1,enabled:false});
  assert.deepEqual(old.stats(),{routes:0,tickets:0,caps:0,active:0});
  const status=await(await f.api('/admin/gateway')).json();assert.equal(status.enabled,method==='PUT');
  const launches=[];
  for(const api of [f.api,reader])for(const app of apps)launches.push((await api('/gateway/launch','POST',{appId:app.id,launchId:'b'.repeat(64)})).status);
  assert.deepEqual(launches,Array(4).fill(method==='PUT'?409:503),'no stale window can mint a route on the replacement');
  for(const api of [f.api,reader]){
   const session=await(await api('/session')).json();assert.deepEqual(session.windows.map(w=>w.id),[native.id],'all gateway windows retired, unrelated Native window retained');
  }
  const readerLayout=JSON.parse(await readFile(f.dir+'/state/users/'+user.id+'/layout.json','utf8'));
  assert.deepEqual(readerLayout.map(w=>w.id),[native.id],'later sessions still receive legitimate persistence cleanup');
  await rm(fault,{recursive:true});fault=null;
  if(method==='PUT'){
   assert.equal((await reader('/windows','POST',{appId:apps[0].id})).status,200);
   assert.equal((await reader('/gateway/launch','POST',{appId:apps[0].id,launchId:'c'.repeat(64)})).status,200,'explicit reopen can launch the replacement');
  }
 }finally{if(fault)await rm(fault,{recursive:true,force:true});await f.close();}
});
