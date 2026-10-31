// L1: real enrollment/grants and loopback observations; no Cockpit/container dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {gatewayLab,addGateway,launchGateway,redeemGateway,edgeRequest,password} from '../gateway-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';

async function fixture(t,{hold=false}={}){
 let l,release=()=>{},entered;
 const ready=new Promise(resolve=>entered=resolve),hits=[];
 const site=http.createServer((req,res)=>{
  hits.push({method:req.method,path:req.url});
  if(hold&&req.url==='/permitted'){release=()=>res.end('Permitted service');entered();return;}
  res.end('Loopback service');
 });
 t.after(async()=>{
  release();
  try{await l?.close();}finally{site.closeAllConnections();await new Promise(resolve=>site.close(resolve));}
 });
 await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
 const upstream=`http://127.0.0.1:${site.address().port}`;
 l=await gatewayLab({targets:[
  {id:'files',label:'Admin target',upstream,entryPath:'/admin',accessPolicy:'admin-only'},
  {id:'permitted',label:'Permitted service',upstream,entryPath:'/permitted'}
 ]});
 const created=await l.api('/admin/users','POST',{username:'alice',password});
 assert.equal(created.status,200);const user=await created.json();
 const restricted=await addGateway(l,[user.id]);
 const response=await l.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Permitted service',gateway:{target:'permitted'},userIds:[user.id]});
 assert.equal(response.status,200);const permitted=await response.json();
 const auth=await authenticate(l.relay.origin,l.dir+'/state','alice'),api=client(l.relay.origin,auth);
 const session=[...l.relay.sessions.values()].find(s=>s.userId===user.id);
 return {...l,user,restricted,permitted,auth,apiUser:api,session,hits,ready,release:()=>release()};
}

function online(observation){
 assert.equal(observation.state,'Online');assert.equal(observation.httpStatus,200);
 assert.equal(observation.reachability,'responding');assert.equal(observation.source,'relay');
}
async function arrived(l){
 let timer;
 try{await Promise.race([l.ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Permitted service HEAD did not arrive')),3000))]);}
 finally{clearTimeout(timer);}
}
function openSocket(l,launch,cookie){
 const ws=new WebSocket(launch.origin.replace('https:','wss:')+'/socket',{
  ca:l.cert,handshakeTimeout:2000,
  lookup:(_host,_options,cb)=>cb(null,[{address:'127.0.0.1',family:4}]),
  headers:{origin:launch.origin,cookie}
 });
 ws.on('error',()=>{});return ws;
}

test('ordinary granted admin-only status preserves an unrelated observation and administrator status',{timeout:15000},async t=>{
 const l=await fixture(t);
 const visible=await(await l.apiUser('/session')).json();
 assert.equal(visible.user.preferences.showAppStatus,true);
 assert.ok(visible.apps.some(a=>a.id===l.restricted.id));
 assert.ok(visible.apps.some(a=>a.id===l.permitted.id));
 assert.deepEqual(new Set(visible.user.grants),new Set([l.restricted.id,l.permitted.id]));
 const response=await l.apiUser('/status');
 assert.equal(response.status,200,'one admin-only target must not fail the aggregate');
 const status=await response.json();online(status[l.permitted.id]);
 assert.equal(status[l.restricted.id].state,'Unknown');
 assert.equal(status[l.restricted.id].reason,'not-authorized');
 assert.equal(status[l.restricted.id].reachability,'not-monitored');
 assert.equal(status[l.restricted.id].checkedAt,0);
 assert.deepEqual(l.hits,[{method:'HEAD',path:'/permitted'}],'no admin-only upstream observation for ordinary user');
 assert.equal((await l.apiUser('/windows','POST',{appId:l.restricted.id})).status,200);
 assert.equal((await l.apiUser('/gateway/launch','POST',{appId:l.restricted.id})).status,403);
 assert.equal((await l.api('/preferences','PATCH',{showAppStatus:true})).status,200);
 const adminResponse=await l.api('/status');assert.equal(adminResponse.status,200);
 const adminStatus=await adminResponse.json();online(adminStatus[l.restricted.id]);online(adminStatus[l.permitted.id]);
 assert.ok(l.hits.some(h=>h.method==='HEAD'&&h.path==='/admin'));
 const launch=await launchGateway(l,l.restricted),cap=await redeemGateway(l,launch);
 assert.equal(cap.status,200);
 assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie}})).status,200);
 assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:l.auth.cookie}})).status,403,'Relay user cookie is not a capability');
 assert.equal((await edgeRequest(l,launch.origin,'/.relay/redeem',{method:'POST',headers:{origin:launch.origin},body:{ticket:'not-a-ticket'}})).status,403);
 const ws=openSocket(l,launch,l.auth.cookie);t.after(()=>ws.terminate());
 const denied=new Promise(resolve=>ws.once('unexpected-response',(_req,res)=>{res.resume();ws.terminate();resolve(res.statusCode);}));
 assert.equal(await denied,403,'ordinary session cookie cannot authorize a gateway WebSocket');
});

for(const action of ['logout','disable','grant','expire'])test('held aggregate status stops after observer '+action,{timeout:15000},async t=>{
 const l=await fixture(t,{hold:true});
 const pending=l.apiUser('/status');t.after(async()=>{l.release();await pending;});
 await arrived(l);
 if(action==='logout')assert.equal((await l.apiUser('/logout','POST')).status,200);
 else if(action==='expire')t.mock.method(Date,'now',()=>l.session.expires);
 else assert.equal((await l.api('/admin/users/'+l.user.id,'PATCH',action==='disable'?{disabled:true}:{grants:[l.permitted.id]})).status,200);
 l.release();
 assert.equal((await pending).status,401,'invalidated observer cannot receive aggregate observations');
 assert.equal((await l.apiUser('/status')).status,401);
 await assert.rejects(l.relay.experimentalGateway.status(l.session,l.restricted.id),{status:403},'stale session must not become a target-unavailable result');
 if(action==='grant'){
  const auth=await authenticate(l.relay.origin,l.dir+'/state','alice'),api=client(l.relay.origin,auth);
  const result=await api('/status');assert.equal(result.status,200);
  const status=await result.json();assert.equal(Object.hasOwn(status,l.restricted.id),false);online(status[l.permitted.id]);
  const session=[...l.relay.sessions.values()].find(s=>s.userId===l.user.id);
  await assert.rejects(l.relay.experimentalGateway.status(session,l.restricted.id),{status:403},'current observer without grant must still be denied');
 }
});

test('status does not convert infrastructure or unrelated authorization errors to policy observations',{timeout:15000},async t=>{
 const l=await fixture(t);
 // Inject only an Accounts failure; enrollment, grants, sessions and HTTP remain real.
 for(const status of [403,503]){
  const error=Object.assign(new Error('Injected authority failure'),{status});
  const original=l.relay.accounts.allowed;
  l.relay.accounts.allowed=()=>{throw error;};
  try{await assert.rejects(l.relay.experimentalGateway.status(l.session,l.restricted.id),e=>e===error);}
  finally{l.relay.accounts.allowed=original;}
 }
 const edge=l.relay.experimentalGateway;
 await l.relay.close();
 await assert.rejects(edge.status(l.session,l.restricted.id),{status:503},'shutdown admission failure remains an error');
});

test('administrator demotion retains admin-only capability and WebSocket denial',{timeout:15000},async t=>{
 const l=await gatewayLab({targetOptions:{accessPolicy:'admin-only'}});t.after(()=>l.close());
 const response=await l.api('/admin/users','POST',{username:'operator',password,role:'admin'});assert.equal(response.status,200);
 const user=await response.json(),app=await addGateway(l,[user.id]);
 const api=client(l.relay.origin,await authenticate(l.relay.origin,l.dir+'/state','operator'));
 const launch=await launchGateway(l,app,api),cap=await redeemGateway(l,launch);
 assert.equal(cap.status,200);
 const ws=openSocket(l,launch,cap.cookie);t.after(()=>ws.terminate());await once(ws,'open');
 const message=once(ws,'message');ws.send('live administrator');assert.equal((await message)[0].toString(),'live administrator');
 const closed=once(ws,'close');
 assert.equal((await l.api('/admin/users/'+user.id,'PATCH',{role:'user'})).status,200);await closed;
 assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie}})).status,403);
 const retained=openSocket(l,launch,cap.cookie);t.after(()=>retained.terminate());
 const denied=new Promise(resolve=>retained.once('unexpected-response',(_req,res)=>{res.resume();retained.terminate();resolve(res.statusCode);}));
 assert.equal(await denied,403);
 const ordinary=client(l.relay.origin,await authenticate(l.relay.origin,l.dir+'/state','operator'));
 assert.ok((await(await ordinary('/session')).json()).apps.some(a=>a.id===app.id));
 assert.equal((await ordinary('/gateway/launch','POST',{appId:app.id})).status,403);
 assert.deepEqual(l.relay.experimentalGateway.stats(),{routes:0,tickets:0,caps:0,active:0});
});
