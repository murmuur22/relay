import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {chmod,realpath} from 'node:fs/promises';
import {createGateway} from '../../server/gateway.mjs';
import {gatewayLab,password} from '../gateway-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
test('gateway reconfiguration blocks launches while retiring old windows',{timeout:20000},async()=>{
 const l=await gatewayLab({gatewayConfig:{desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test'}});let g,release,applying;
 try{
  const dir=await realpath(l.dir);await chmod(dir+'/cert.pem',0o600);await chmod(dir+'/key.pem',0o600);
  g=await createGateway({port:0,runtime:dir+'/managed',profile:'standalone'});const api=client(g.origin,await authenticate(g.origin,dir+'/managed'));
  const config={version:1,bind:'127.0.0.1',port:await port(),desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test',keyPath:dir+'/key.pem',certPath:dir+'/cert.pem',targets:[{id:'files',label:'Files',upstream:`http://127.0.0.1:${l.upstream.address().port}`} ]};
  assert.equal((await api('/admin/gateway','PUT',{config,password})).status,200);
  const app=await(await api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Files',gateway:{target:'files'},userIds:[]})).json();
  assert.equal((await api('/windows','POST',{appId:app.id})).status,200);
  let arrived;const arrival=new Promise(r=>arrived=r),barrier=new Promise(r=>release=r),manager=g.manager,remove=manager.remove.bind(manager);
  manager.remove=async id=>{arrived();await barrier;return remove(id);};
  applying=api('/admin/gateway','PUT',{config:{...config,port:await port()},password});
  let timer;await Promise.race([arrival,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Window cleanup not reached')),5000);})]).finally(()=>clearTimeout(timer));
  const launch=await api('/gateway/launch','POST',{appId:app.id,launchId:'a'.repeat(64)});
  assert.equal(launch.status,503,'no route may be created while old windows are being retired');
  release();assert.equal((await applying).status,200);
 }finally{release?.();await applying?.catch(()=>{});await g?.close();await l.close();}
});
