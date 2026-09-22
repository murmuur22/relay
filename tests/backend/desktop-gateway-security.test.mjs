import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {WebSocket} from 'ws';
import {gatewayLab,addGateway,launchGateway,redeemGateway,edgeRequest,password} from '../gateway-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';
import {experimentalConfig} from '../../server/experimental-gateway.mjs';
import {webConfig} from '../../server/webapps.mjs';
const call=(l,t,c,path,method='GET',headers={})=>edgeRequest(l,t.origin,path,{method,headers:{cookie:c.cookie,origin:t.origin,...headers}});

test('operator configuration rejects missing TLS material; corrupt gateway fields never default',()=>{
 assert.throws(()=>experimentalConfig({targets:[{id:'files',label:'Files',upstream:'http://127.0.0.1:1234'}]}));
 for(const extra of [{enabled:null},{icon:null},{secret:'bad'}])assert.throws(()=>webConfig({kind:'web',mode:'gateway',label:'Files',gateway:{target:'files'},...extra}));
});

for(const action of ['end','saturated-end','close','logout','grant','disable'])test('real '+action+' destroys active HTTP/WS and rejects old app capability',{timeout:15000},async()=>{
 const l=await gatewayLab();let stream,ws;
 try{
  const u=await(await l.api('/admin/users','POST',{username:'alice',password})).json(),app=await addGateway(l,[u.id]);
  const auth=await authenticate(l.relay.origin,l.dir+'/state','alice'),userApi=client(l.relay.origin,auth),api=action==='saturated-end'?l.api:userApi,t=await launchGateway(l,app,api),cap=await redeemGateway(l,t),url=new URL(t.origin);
  assert.equal((await call(l,t,cap,'/login','POST')).status,200);
  assert.equal((await call(l,t,cap,'/set')).status,200);
  assert.equal((await call(l,t,cap,'/private')).status,200);
  assert.equal((await call(l,t,cap,'/echo')).json().cookie,'sid=synthetic-jar');
  stream=await new Promise((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port:url.port,servername:url.hostname,ca:l.cert,path:'/slow',headers:{host:url.host,cookie:cap.cookie,'sec-fetch-site':'same-origin'}},res=>{res.once('data',()=>resolve(res));});req.on('error',reject);});
  const closed=new Promise(resolve=>stream.once('close',resolve));stream.on('error',()=>{});
  ws=new WebSocket(t.origin.replace('https:','wss:')+'/socket',{ca:l.cert,lookup:(_host,_opts,cb)=>cb(null,[{address:'127.0.0.1',family:4}]),headers:{origin:t.origin,cookie:cap.cookie}});ws.on('error',()=>{});await once(ws,'open');const wsClosed=once(ws,'close');
  ws.send('real socket');assert.equal((await once(ws,'message'))[0].toString(),'real socket');
  if(action==='saturated-end')for(let i=0;i<512;i++)assert.equal((await userApi('/gateway/end','POST',{appId:app.id,launchId:randomBytes(32).toString('hex')})).status,200);
  const response=['end','saturated-end'].includes(action)?await api('/gateway/end','POST',{appId:app.id,launchId:t.launchId}):action==='close'?await api('/windows/'+app.id,'DELETE'):action==='logout'?await api('/logout','POST'):await l.api('/admin/users/'+u.id,'PATCH',action==='grant'?{grants:[]}:{disabled:true});
  assert.equal(response.status,200);await Promise.all([closed,wsClosed]);assert.equal(stream.complete,false);assert.equal((await call(l,t,cap,'/private')).status,403);assert.deepEqual(l.relay.experimentalGateway.stats(),{routes:0,tickets:0,caps:0,active:0});
  if(action==='saturated-end'){
   const fresh=await launchGateway(l,app,api),freshCap=await redeemGateway(l,fresh);
   assert.notEqual(fresh.origin,t.origin);assert.equal((await call(l,fresh,freshCap,'/private')).status,401);
   const echo=(await call(l,fresh,freshCap,'/echo')).json();assert.equal(echo.cookie,'');assert.equal(echo.auth,'');
   assert.equal((await api('/gateway/end','POST',{appId:app.id,launchId:t.launchId})).status,200);
   assert.equal((await call(l,fresh,freshCap,'/echo')).status,200,'Late End cannot retire a new generation');
  }
 }finally{stream?.destroy();ws?.terminate();await l.close();}
});

test('own-session capacity keeps pending cancellations fail-closed and active cleanup unconditional',{timeout:20000},async context=>{
 const l=await gatewayLab();try{
  const user=await(await l.api('/admin/users','POST',{username:'alice',password})).json(),app=await addGateway(l,[user.id]);
  const auth=await authenticate(l.relay.origin,l.dir+'/state','alice'),api=client(l.relay.origin,auth);
  const target=await launchGateway(l,app,api),cap=await redeemGateway(l,target);
  assert.equal((await call(l,target,cap,'/login','POST')).status,200);
  const other=await launchGateway(l,app),otherCap=await redeemGateway(l,other);
  // Only the clock is controlled: authority, sessions, registration and all requests are real.
  let now=Date.now();context.mock.method(Date,'now',()=>now);
  const end=id=>api('/gateway/end','POST',{appId:app.id,launchId:id});
  const launch=id=>api('/gateway/launch','POST',{appId:app.id,launchId:id});
  const first=randomBytes(32).toString('hex');assert.equal((await end(first)).status,200);
  for(let i=1;i<511;i++)assert.equal((await end(randomBytes(32).toString('hex'))).status,200);
  assert.equal((await launch(first)).status,409,'End before delayed launch near capacity');
  const atCap=randomBytes(32).toString('hex');assert.equal((await end(atCap)).status,200);
  assert.equal((await launch(first)).status,409,'Oldest required marker is retained');
  assert.equal((await launch(atCap)).status,409,'End before delayed launch at capacity');
  assert.equal((await end(target.launchId)).status,200,'Owned active route cleanup must succeed at own capacity');
  assert.equal((await call(l,target,cap,'/private')).status,403);
  now+=1000; // An additional overflow End must renew the full cancellation horizon.
  const overflow=randomBytes(32).toString('hex');assert.equal((await end(overflow)).status,200);
  assert.equal((await launch(overflow)).status,429,'Overflow End cancels delayed launch via session cooldown');
  assert.equal((await launch(randomBytes(32).toString('hex'))).status,429,'No new launch during fail-closed cooldown');
  assert.equal((await call(l,other,otherCap,'/echo')).status,200,'Other session route is untouched');
  // Another real login for the SAME account has independent cancellation admission.
  const secondAuth=await authenticate(l.relay.origin,l.dir+'/state','alice'),secondApi=client(l.relay.origin,secondAuth);
  const second=await launchGateway(l,app,secondApi),secondCap=await redeemGateway(l,second);
  assert.equal((await call(l,second,secondCap,'/echo')).status,200);
  now+=59999;assert.equal((await launch(overflow)).status,429);
  now+=1;const fresh=await launchGateway(l,app,api),freshCap=await redeemGateway(l,fresh);
  assert.equal((await call(l,fresh,freshCap,'/private')).status,401,'Fresh generation has no retired credential');
  assert.equal((await end(target.launchId)).status,200);
  assert.equal((await call(l,fresh,freshCap,'/echo')).status,200,'Late old End cannot retire fresh generation');
 }finally{context.mock.restoreAll();await l.close();}
});

test('exact Origin/CSRF/grants, fixed destination, pending End and stale End cannot end a newer launch',async()=>{
 const l=await gatewayLab();try{
  const app=await addGateway(l),t=await launchGateway(l,app);
  const auth=l.admin,origin=l.relay.origin;
  for(const headers of [{},{Origin:'null','X-CSRF-Token':auth.s.csrf},{Origin:'http://evil.test','X-CSRF-Token':auth.s.csrf},{Origin:origin,'X-CSRF-Token':'bad'}]){
   const r=await fetch(origin+'/api/gateway/end',{method:'POST',headers:{cookie:auth.cookie,'Content-Type':'application/json',...headers},body:JSON.stringify({appId:app.id,launchId:t.launchId})});assert.equal(r.status,403);
  }
  assert.equal((await l.api('/gateway/launch','POST',{appId:app.id,destination:'http://evil.test'})).status,400);
  const u=await(await l.api('/admin/users','POST',{username:'alice',password})).json(),a=await authenticate(origin,l.dir+'/state','alice'),userApi=client(origin,a);
  assert.equal((await userApi('/gateway/launch','POST',{appId:app.id})).status,403);
  const pendingId=randomBytes(32).toString('hex');assert.equal((await l.api('/gateway/end','POST',{appId:app.id,launchId:pendingId})).status,200);
  assert.equal((await l.api('/gateway/launch','POST',{appId:app.id,launchId:pendingId})).status,409);
  const fresh=await launchGateway(l,app),cap=await redeemGateway(l,fresh);assert.equal((await l.api('/gateway/end','POST',{appId:app.id,launchId:t.launchId})).status,200);assert.equal((await call(l,fresh,cap,'/echo')).status,200);
  assert.equal((await edgeRequest(l,fresh.origin,'/echo',{headers:{cookie:cap.cookie,origin:l.relay.experimentalGateway.desktopOrigin}})).status,403);
  assert.equal((await edgeRequest(l,l.relay.experimentalGateway.desktopOrigin,'/api/session',{headers:{cookie:l.admin.cookie}})).status,401,'Only __Host desktop cookie is translated');
  const wrongHost=await new Promise((resolve,reject)=>{const req=http.get(origin+'/api/session',{headers:{host:'desktop.relay.test',cookie:l.admin.cookie}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(wrongHost,403,'Main auth Host remains exact');
 }finally{await l.close();}
});

for(const action of ['forget','new-login'])test('held ordinary Set-Cookie remains generation bound after '+action,{timeout:15000},async()=>{
 const l=await gatewayLab();let release;
 try{
  let arrived;const arrival=new Promise(r=>arrived=r);l.upstream.removeAllListeners('request');
  l.upstream.on('request',(req,res)=>{req.resume();res.setHeader('Content-Type','text/plain');if(req.url==='/hold'){release=()=>{if(res.writableEnded||res.destroyed)return;res.setHeader('Set-Cookie','sid=old; Path=/; HttpOnly');res.end('late');};arrived();return;}if(req.url==='/login')return res.end('new-token');res.end(req.headers.cookie||'empty');});
  const app=await addGateway(l),t=await launchGateway(l,app),cap=await redeemGateway(l,t);
  const pending=call(l,t,cap,'/hold');await arrival;
  assert.equal((await call(l,t,cap,action==='forget'?'/.relay/forget':'/login','POST')).status,action==='forget'?204:200);release();assert.equal((await pending).status,200);assert.equal((await call(l,t,cap,'/echo')).text,'empty');
 }finally{release?.();await l.close();}
});

test('only exact bounded successful upstream login responses can supply profile identity',async()=>{
 const l=await gatewayLab();try{
  let mode='ok';l.upstream.removeAllListeners('request');l.upstream.on('request',(req,res)=>{req.resume();if(req.url.startsWith('/login')){res.statusCode=mode==='failure'?401:200;res.setHeader('Content-Type',mode==='type'?'application/json':'text/plain');if(mode==='encoding')res.setHeader('Content-Encoding','gzip');return res.end(mode==='large'?'x'.repeat(129):mode==='invalid'?'two tokens':mode==='empty'?'':'upstream-only');}res.end(req.headers.authorization||'empty');});
  const app=await addGateway(l),t=await launchGateway(l,app),cap=await redeemGateway(l,t);
  const request=(p,m='GET')=>call(l,t,cap,p,m,{cookie:cap.cookie+'; sid=ambient',authorization:'Bearer browser'});
  assert.equal((await request('/echo')).text,'empty');await request('/login?other=1','POST');assert.equal((await request('/echo')).text,'empty');
  for(mode of ['type','encoding','large','invalid','empty','failure']){assert.equal((await request('/login','POST')).status,mode==='failure'?401:502);assert.equal((await request('/echo')).text,'empty');}
  mode='ok';await request('/login','POST');assert.equal((await request('/echo')).text,'Bearer upstream-only');
 }finally{await l.close();}
});
