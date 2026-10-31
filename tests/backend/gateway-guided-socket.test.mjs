import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';
import {guidedLab,password} from '../guided-helper.mjs';
import {cockpitTarget} from '../../server/gateway-service-profiles.mjs';
import {launchGateway,redeemGateway} from '../gateway-helper.mjs';
test('managed saved Cockpit defaults negotiate cockpit1 with server Origin and retire both real socket legs',async()=>{
 const l=await guidedLab();const server=http.createServer((_q,r)=>r.end('synthetic'));const wss=new WebSocketServer({server,handleProtocols:offered=>offered.has('cockpit1')?'cockpit1':false});let peer,request,ws;
 wss.on('connection',(p,q)=>{peer=p;request=q;p.on('message',d=>p.send(d));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
 const upstream=`http://127.0.0.1:${server.address().port}`,target=cockpitTarget({id:'cockpit',label:'Cockpit',upstream,trust:'system',serverName:'',caPath:''});const config={...l.config,targets:[...l.config.targets,target]};assert.equal((await l.api('/admin/gateway','PUT',{config,baseConfig:l.config,password})).status,200);
 const created=await l.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Cockpit socket fixture',gateway:{target:'cockpit'},userIds:[]});assert.equal(created.status,200);const app=await created.json(),launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);
 ws=new WebSocket(launch.origin.replace('https:','wss:')+'/cockpit/socket',['cockpit1'],{ca:l.cert,lookup:(_h,_o,cb)=>cb(null,[{address:'127.0.0.1',family:4}]),headers:{origin:launch.origin,cookie:cap.cookie},handshakeTimeout:2000});await once(ws,'open');assert.equal(ws.protocol,'cockpit1');assert.equal(request.url,'/cockpit/socket');assert.equal(request.headers.origin,upstream);const got=once(ws,'message');ws.send('synthetic live interaction');assert.equal(String((await got)[0]),'synthetic live interaction');
 const closed=once(ws,'close'),peerClosed=once(peer,'close');assert.equal((await l.api('/gateway/end','POST',{appId:app.id,launchId:launch.launchId})).status,200);await Promise.all([closed,peerClosed]);
 }finally{ws?.terminate();for(const p of wss.clients)p.terminate();await new Promise(r=>wss.close(r));server.closeAllConnections();await new Promise(r=>server.close(r));await l.close();}
});
