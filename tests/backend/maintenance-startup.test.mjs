import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import http from 'node:http';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {chmod,readFile} from 'node:fs/promises';
import {remotePKI,remoteReference} from '../remote-tls-helper.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {VERSION} from '../../version.js';
import {authenticate,client,password} from '../auth-helper.mjs';
const wsStatus=(origin,cookie)=>new Promise((resolve,reject)=>{const req=http.get(origin+'/ws/stream/notes-lab',{headers:{Connection:'Upgrade',Upgrade:'websocket',Origin:origin,cookie,'Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ==','Sec-WebSocket-Version':'13'}},res=>{res.resume();resolve(res.statusCode);});req.on('upgrade',(_res,socket)=>{socket.destroy();reject(Error('Maintenance admitted WebSocket'));});req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('WS deadline')));});
for(const mode of ['v2','Direct HTTPS','v3'])test('configured '+mode+' startup holds maintenance through expected-version readiness and preserves external admission',{timeout:15000},async()=>{
 const dir=await mkdtemp(tmpdir()+'/held-start-'),marker=dir+'/maintenance',runtime=dir+'/state';let g;
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 try{
  g=await createGateway({port:0,runtime,profile:'standalone'});await authenticate(g.origin,runtime);await g.close();g=null;
  const common={bind:'127.0.0.1',port,appBaseDomain:'apps.example.test',targets:[{id:'files',label:'Synthetic files',upstream:'http://127.0.0.1:18302'}]};
  let reference={...common,version:2,mode:'reverse-proxy',desktopOrigin:'https://desktop.example.test',trustedProxy:'127.0.0.1'},pki,cert;
  if(mode==='Direct HTTPS'){
   execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-subj','/CN=desktop.example.test','-addext','subjectAltName=DNS:desktop.example.test,DNS:*.apps.example.test'],{stdio:'ignore'});
   await chmod(dir+'/key.pem',0o600);await chmod(dir+'/cert.pem',0o600);cert=await readFile(dir+'/cert.pem');
   reference={...common,version:1,desktopHostname:'desktop.example.test',keyPath:dir+'/key.pem',certPath:dir+'/cert.pem'};
  }else if(mode==='v3'){pki=await remotePKI(dir);reference={...remoteReference(dir,port),targets:common.targets};}
  await writeFile(runtime+'/gateway-managed.json',JSON.stringify(reference),{mode:0o600});
  const edgeStatus=()=>new Promise((resolve,reject)=>{
   const proxy=mode!=='Direct HTTPS',tls=mode!=='v2';
   const req=(tls?https:http).get({hostname:'127.0.0.1',port,path:'/api/auth',agent:false,...(tls?{servername:mode==='v3'?'backend.example.test':'desktop.example.test',ca:mode==='v3'?pki['server-ca'].cert:cert,...(mode==='v3'?pki.client:{})}:{}),headers:{host:'desktop.example.test'+(proxy?'':':'+port),...(proxy?{'x-forwarded-host':'desktop.example.test','x-forwarded-proto':'https'}:{})}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('edge deadline')));
  });
  await writeFile(marker,'LOCAL TEST MAINTENANCE\n');
  g=await createGateway({port:0,runtime,profile:'standalone',maintenanceFile:marker});
  assert.ok(g.experimentalGateway);assert.deepEqual(await(await fetch(g.origin+'/health/ready')).json(),{status:'ready',version:VERSION,maintenance:true});await access(marker);
  const denied=async(cookie='')=>{
   for(const path of ['/api/auth','/api/session','/api/desktop'])assert.equal((await fetch(g.origin+path,{headers:{cookie}})).status,503,path);
   for(const path of ['/api/enroll','/api/login','/api/windows','/api/gateway/launch','/api/updater/launch']){const res=await fetch(g.origin+path,{method:'POST',headers:{cookie,Origin:g.origin,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});assert.equal(res.status,503,path);assert.equal(res.headers.get('set-cookie'),null);}
   assert.equal(await wsStatus(g.origin,cookie),503);assert.equal(await edgeStatus(),503);await access(marker);
  };
  await denied();assert.equal(g.sessions.size,0);
  await rm(marker);assert.equal((await fetch(g.origin+'/api/session')).status,401);
  const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);assert.equal((await api('/session')).status,200);
  await writeFile(marker,'LOCAL TEST MAINTENANCE\n');await denied(auth.cookie);assert.equal((await api('/session')).status,503);
  await rm(marker);assert.equal((await api('/session')).status,200);assert.equal((await fetch(g.origin+'/api/session')).status,401);
 }finally{await g?.close();await rm(dir,{recursive:true,force:true});}
});
