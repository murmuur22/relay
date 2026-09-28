import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {chmod,realpath,readFile} from 'node:fs/promises';
import {createGateway} from '../../server/gateway.mjs';
import {gatewayLab,password} from '../gateway-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
test('session expiry during same-port replacement cannot commit and restores protected configuration',{timeout:15000},async()=>{
 const l=await gatewayLab({gatewayConfig:{desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test'}});let g,release,applying;
 try{
  const dir=await realpath(l.dir);await chmod(dir+'/cert.pem',0o600);await chmod(dir+'/key.pem',0o600);
  g=await createGateway({port:0,runtime:dir+'/expiry',profile:'standalone',sessionMs:1200});const api=client(g.origin,await authenticate(g.origin,dir+'/expiry'));
  const config={version:1,bind:'127.0.0.1',port:await port(),desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test',keyPath:dir+'/key.pem',certPath:dir+'/cert.pem',targets:[{id:'files',label:'Original',upstream:`http://127.0.0.1:${l.upstream.address().port}`} ]};
  assert.equal((await api('/admin/gateway','PUT',{config,password})).status,200);const bytes=await readFile(dir+'/expiry/gateway-managed.json');
  let arrived;const arrival=new Promise(r=>arrived=r),barrier=new Promise(r=>release=r),old=g.experimentalGateway,close=old.close.bind(old);
  old.close=async options=>{await close(options);arrived();await barrier;};
  applying=api('/admin/gateway','PUT',{config:{...config,targets:[{...config.targets[0],label:'Must not commit'}]},password});
  let timer;await Promise.race([arrival,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Replacement not reached')),5000);})]).finally(()=>clearTimeout(timer));
  const deadline=Date.now()+5000;while((await api('/session')).status!==401){assert(Date.now()<deadline,'session must expire');await new Promise(r=>setTimeout(r,25));}
  release();assert.equal((await applying).status,403);assert.deepEqual(await readFile(dir+'/expiry/gateway-managed.json'),bytes);
  const fresh=client(g.origin,await authenticate(g.origin,dir+'/expiry'));const status=await(await fresh('/admin/gateway')).json();assert.equal(status.enabled,true);assert.equal(status.config.targets[0].label,'Original');
 }finally{release?.();await applying?.catch(()=>{});await g?.close();await l.close();}
});
