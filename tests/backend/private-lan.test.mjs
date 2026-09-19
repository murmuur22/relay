import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {WebSocket} from 'ws';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client} from '../auth-helper.mjs';
import {loopbackOrigin,networkHost} from '../../updater/web/broker-client.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
const privateHost=Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address))?.address;
test('private LAN actual interface: HTTP/WS Host, Origin, CSRF, user ACLs and native cookie-host guard',async t=>{
 assert.ok(privateHost,'No assigned RFC1918 interface: private-LAN execution unavailable');
 const dir=await mkdtemp(tmpdir()+'/relay-lan-');let g;t.after(async()=>{await g?.close();await rm(dir,{recursive:true,force:true});});
 g=await createGateway({port:0,runtime:dir,profile:'standalone',networkMode:'private-lan',hostname:privateHost});
 assert.equal(g.server.address().address,privateHost);
 assert.equal((await fetch(g.origin+'/health/ready')).status,200);
 assert.equal(await new Promise((resolve,reject)=>{http.get(g.origin+'/api/auth',{headers:{Host:'localhost:4190'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);}),403);
 assert.equal((await fetch(g.origin+'/api/auth',{headers:{Origin:'http://localhost:4190'}})).status,403);
 assert.equal((await fetch(g.origin+'/desktop/private?app=system-updater')).status,200);
 const auth=await authenticate(g.origin,dir),api=client(g.origin,auth);
 assert.equal((await api('/preferences','PATCH',{showAppStatus:false})).status,200);
 assert.equal((await fetch(g.origin+'/api/preferences',{method:'PATCH',headers:{Cookie:auth.cookie,Origin:g.origin,'Content-Type':'application/json'},body:'{}'})).status,403);
 for(const headers of [{Origin:'http://localhost:4190',Cookie:auth.cookie},{Origin:g.origin},{Origin:g.origin,Cookie:auth.cookie,Host:'localhost:4190'}]){
  assert.equal(await new Promise((resolve,reject)=>{const ws=new WebSocket(g.origin.replace('http:','ws:')+'/ws/stream/missing',{headers});ws.on('unexpected-response',(_,res)=>{res.resume();ws.terminate();resolve(res.statusCode);});ws.on('open',()=>{ws.terminate();reject(Error('Hostile WS admitted'));});ws.on('error',()=>{});}),403);
 }
 const created=await api('/admin/users','POST',{username:'ordinary',displayName:'Ordinary',password:'Synthetic-ordinary-password-42!',role:'user',grants:[]});assert.equal(created.status,200);
 const user=await authenticate(g.origin,dir,'ordinary','Synthetic-ordinary-password-42!'),ordinary=client(g.origin,user);
 assert.equal((await ordinary('/updater/launch','POST',{})).status,403);
 assert.equal((await ordinary('/updater/authorize','POST',{action:'rollback',password:'Synthetic-ordinary-password-42!',confirmed:true})).status,403);
 assert.equal((await ordinary('/admin/users','POST',{})).status,403);
 assert.equal((await api('/admin/services','POST',{kind:'web',mode:'native',label:'Cookie host forbidden',address:g.origin,icon:'globe'})).status,400);
});
test('invalid private-LAN configuration refuses before writing state',async()=>{
 const dir=await mkdtemp(tmpdir()+'/relay-lan-invalid-');
 const reject=async options=>{let g;try{await assert.rejects(async()=>{g=await createGateway({port:0,runtime:dir+'/state',profile:'standalone',...options});});await assert.rejects(access(dir+'/state'));}finally{await g?.close();}};
 try{
  for(const hostname of ['8.8.8.8','0.0.0.0','169.254.169.254','224.0.0.1','localhost','127.0.0.1','10.01.2.3','167772161','0x0a000001','10.1','10.0.0.1/','user@10.0.0.1','10.0.0.1?x','::1','172.15.0.1','172.32.0.1','192.169.0.1'])await reject({networkMode:'private-lan',hostname});
  for(const options of [{networkMode:'wrong'},{networkMode:'private-lan',hostname:'10.0.0.1',profile:'development'},{hostname:'10.0.0.1'},{networkMode:'private-lan',hostname:'10.254.253.252'},{port:-1},{networkMode:'private-lan',hostname:privateHost,updater:{uiOrigin:`http://${privateHost}:4191`}}])await reject(options);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('updater rejects unassigned private IP before attempting listen',async()=>{
 const host='10.254.253.252';
 assert.ok(!Object.values(networkInterfaces()).flat().some(n=>n.address===host));
 const original=http.Server.prototype.listen;
 let attempted=false;
 http.Server.prototype.listen=function(){attempted=true;throw Error('Unexpected listen attempt');};
 try{
  await assert.rejects(createUpdaterWeb({networkMode:'private-lan',bind:host,uiOrigin:`http://${host}:4191`,relayOrigin:`http://${host}:4190`,socketPath:'/unused'}),/assigned/);
  assert.equal(attempted,false);
 }finally{http.Server.prototype.listen=original;}
});
test('canonical address and updater origin matrix retains explicit opt-in and exact target',async()=>{
 for(const host of ['10.0.0.1','172.16.0.1','172.31.255.254','192.168.0.1']){
  assert.equal(networkHost(host,'private-lan'),host);assert.throws(()=>networkHost(host));
  assert.equal(loopbackOrigin(`http://${host}:4191`,'private-lan').hostname,host);
 }
 for(const value of ['http://10.01.2.3:4191','http://167772161:4191','http://user@10.0.0.1:4191','http://10.0.0.1:4191/','http://10.0.0.1:4191?x','http://10.0.0.1:4191#x','http://8.8.8.8:4191','http://[::1]:4191'])assert.throws(()=>loopbackOrigin(value,'private-lan'));
 const base={uiOrigin:'http://10.0.0.1:4191',relayOrigin:'http://10.0.0.1:4190',socketPath:'/unused',networkMode:'private-lan',bind:'10.0.0.1'};
 for(const override of [{bind:'0.0.0.0'},{bind:'127.0.0.1'},{relayOrigin:'http://10.0.0.2:4190'},{relayOrigin:base.uiOrigin},{networkMode:'loopback'}])await assert.rejects(createUpdaterWeb({...base,...override}));
});
