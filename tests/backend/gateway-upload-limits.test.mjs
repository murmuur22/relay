// Genuine Relay authority and verified HTTPS; no upstream services or private files.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {createTransport,validateApp} from '../../server/experimental-gateway-transport.mjs';
import {once} from 'node:events';
import {gatewayLab,launchGateway,redeemGateway} from '../gateway-helper.mjs';
const MiB=1024*1024;
// Synthetic transport lifecycle probe, supplementing the real-authority/TLS
// integration fixture below. The upstream rejects on headers, not body EOF.
async function earlyCloseFixture(t,status=401,appOptions={}){
 const sockets=new Set(),active=new Set();let app,transport,client;
 const upstream=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  socket.once('data',()=>socket.end(status===0?'':`HTTP/1.1 ${status} Final\r\nContent-Length: ${status===402?12:6}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\ndenied`));
 });
 const edge=http.createServer((req,res)=>transport.proxy(req,res,{app,route:{origin:'http://app.example.test',authGeneration:0},expires:Date.now()+60000}));
 edge.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{
  client?.destroy();for(const op of [...active])op.cancel();transport?.close();
  for(const socket of sockets)socket.destroy();
  await Promise.all([edge,upstream].map(server=>new Promise(r=>server.close(r))));
 });
 await listen(upstream);app={upstream:`http://127.0.0.1:${upstream.address().port}`,...appOptions};validateApp(app);
 transport=createTransport({active,desktopOrigin:'https://desktop.example.test',stillAuthorized:async()=>{}});await listen(edge);
 function upload(size,{declared=false,finish=true,action,responseTimeout=2500}={}){
  return new Promise((resolve,reject)=>{
   let timer,done=false;
   const deadline=setTimeout(()=>settle(Error(`No final client response within ${responseTimeout} ms; active operations=${active.size}`)),responseTimeout);
   function settle(error,value){if(done)return;done=true;clearTimeout(timer);clearTimeout(deadline);if(error)reject(error);else resolve(value);}
   client=http.request({hostname:'127.0.0.1',port:edge.address().port,path:'/upload',method:'POST',headers:{origin:'http://app.example.test','sec-fetch-site':'same-origin',...(declared?{'content-length':size}:{})}},res=>{
    let text='';res.on('data',chunk=>{text+=chunk;assert(text.length<8192);});res.on('error',settle);
    res.on('end',()=>settle(null,{status:res.statusCode,text}));
   });
   client.on('error',error=>{if(action)settle(null,{cancelled:true});else settle(error);});
   client.write(Buffer.alloc(65536,97));
   timer=setTimeout(()=>{
    // A complete early response must not escape before byte validation/EOF.
    if(done)return;
    if(action){action(client,active);return;}
    client.write(Buffer.alloc(size-65536,97));if(finish)client.end();
   },200);
  });
 }
 return {active,upload};
}
for(const [status,overflow,declared] of [[401,false,false],[401,true,false],[200,false,false],[200,true,false],[401,false,true]])test(`early final-close ${status}, ${overflow?'overflow':'under-limit'}, ${declared?'declared':'chunked'} body settles`,{timeout:10000},async t=>{
 const f=await earlyCloseFixture(t,status);
 const r=await f.upload(overflow?MiB+65536:512*1024,{declared,finish:!overflow});
 assert.equal(r.status,overflow?413:status,'validate body before releasing the upstream final response');
 if(!overflow)assert.equal(r.text,'denied');
 assert.equal(f.active.size,0,'release operation ownership');
});
for(const action of ['disconnect','revoke'])test(`early final-close pending body ${action} releases operation`,{timeout:10000},async t=>{
 const f=await earlyCloseFixture(t);
 await f.upload(512*1024,{action:(client,active)=>{
  assert.equal(active.size,1);
  if(action==='disconnect')client.destroy(Error('Synthetic client disconnect'));
  else for(const op of [...active])op.cancel();
 }});
 // The peer close event can follow the local client destroy callback.
 await new Promise(r=>setTimeout(r,25));assert.equal(f.active.size,0);
});
for(const overflow of [false,true])test(`early final-close honors selected 2 MiB cap, overflow=${overflow}`,{timeout:10000},async t=>{
 const f=await earlyCloseFixture(t,401,{maxRequestBytes:2*MiB});
 const r=await f.upload(2*MiB+(overflow?65536:0),{finish:!overflow});
 assert.equal(r.status,overflow?413:401);assert.equal(f.active.size,0);
});
test('early final-close unfinished body keeps a finite 30 second deadline',{timeout:40000},async t=>{
 const f=await earlyCloseFixture(t);
 const r=await f.upload(65536,{responseTimeout:35000,action:(_client,active)=>assert.equal(active.size,1)});
 assert.equal(r.status,502);assert.equal(f.active.size,0);
});
for(const status of [0,402])test(`early upstream ${status?'truncated response':'close without response'} still fails closed`,{timeout:10000},async t=>{
 const f=await earlyCloseFixture(t,status);
 const r=await f.upload(512*1024);
 assert.equal(r.status,502);assert.equal(f.active.size,0);
});
async function fixture(t,options={}){
 const hits=[];let lab;
 const upstream=http.createServer((req,res)=>{
  const hit={path:req.url,bytes:0,ended:false,closed:false};hits.push(hit);
  req.on('data',b=>hit.bytes+=b.length);req.on('close',()=>hit.closed=true);
  if(req.url==='/early')res.end('early success');
  if(req.url==='/upstream-limit'){res.writeHead(413,{'content-type':'text/html','content-security-policy':"frame-ancestors 'none'",'x-frame-options':'DENY'});res.end('DO_NOT_REFLECT');}
  req.on('end',()=>{hit.ended=true;if(!res.writableEnded)res.end(String(hit.bytes));});
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 t.after(async()=>{try{await lab?.close();}finally{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}});
 lab=await gatewayLab({targets:[{id:'files',label:'Files',upstream:`http://127.0.0.1:${upstream.address().port}`,...options}]});
 const app=await(await lab.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Files',gateway:{target:'files'},userIds:[]})).json();
 const launch=await launchGateway(lab,app),cap=await redeemGateway(lab,launch);
 function upload(size,{chunked=false,headers={},path='/upload',finish=true}={}){
  const u=new URL(launch.origin);
  return new Promise((resolve,reject)=>{
   let received=false,stopped=false,pending;
   const req=https.request({hostname:'127.0.0.1',port:u.port,servername:u.hostname,ca:lab.cert,path,method:'POST',headers:{host:u.host,origin:launch.origin,cookie:cap.cookie,'sec-fetch-site':'same-origin','content-type':'application/octet-stream',...(!chunked?{'content-length':size}:{}),...headers}},res=>{
    received=true;stopped=true;clearImmediate(pending);let text='';
    res.on('data',b=>{text+=b;assert(text.length<8192,'bounded error response');});
    res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));
   });
   req.on('error',e=>{if(!received)reject(e);});req.setTimeout(5000,()=>req.destroy(Error('Upload response timeout')));
   let left=size;const chunk=Buffer.alloc(65536,97);
   function pump(){if(stopped||req.destroyed)return;if(!left){if(finish)req.end();return;}const b=chunk.subarray(0,Math.min(left,chunk.length));left-=b.length;if(req.write(b))pending=setImmediate(pump);else req.once('drain',()=>pending=setImmediate(pump));}
   pump();
  });
 }
 return {lab,hits,upload,launch,cap,upstream};
}
test('default 1 MiB exact boundary succeeds and declared overflow rejects before upstream',{timeout:20000},async t=>{
 const f=await fixture(t);
 assert.equal((await f.upload(MiB)).status,200);assert.equal(f.hits[0].bytes,MiB);
 const over=await f.upload(MiB+1);
 console.log(JSON.stringify({case:'default declared overflow',status:over.status,body:over.text,upstreamHits:f.hits.length,upstreamBytes:f.hits.map(h=>h.bytes)}));
 assert.equal(over.status,413);assert.equal(f.hits.length,1);
 assert.equal((await f.upload(7)).status,200);
});
test('only an opted-in target accepts >1 MiB through the exact 24 MiB boundary',{timeout:20000},async t=>{
 const f=await fixture(t,{maxRequestBytes:24*MiB});
 for(const size of [MiB+1,24*MiB]){const r=await f.upload(size);assert.equal(r.status,200);assert.equal(Number(r.text),size);}
 const over=await f.upload(24*MiB+1);assert.equal(over.status,413);assert.equal(f.hits.length,2);
 assert.equal((await f.upload(9)).status,200);
});
for(const options of [{},{maxRequestBytes:2*MiB}])test('streamed/chunked overflow returns bounded 413 and leaves the route healthy '+JSON.stringify(options),{timeout:20000},async t=>{
 const f=await fixture(t,options),limit=options.maxRequestBytes??MiB;
 assert.equal((await f.upload(limit,{chunked:true})).status,200);
 assert.equal(f.hits[0].bytes,limit);
 const response=await f.upload(limit+65536,{chunked:true,headers:{accept:'application/json'}});
 assert.equal(response.status,413);const data=JSON.parse(response.text);
 assert.equal(data.code,'request_too_large');assert.equal(data.maxRequestBytes,limit);
 assert.match(data.error,/too large/i);assert.equal(response.headers.connection,'close');
 assert(f.hits[1].bytes<=limit,'overflow bytes are never forwarded');
 assert.equal(f.hits[1].ended,false,'partial upstream request cannot claim success');
 assert.equal((await f.upload(11)).status,200);
 console.log(JSON.stringify({case:'chunked overflow',limit,status:response.status,upstreamBytes:f.hits[1].bytes,upstreamEnded:f.hits[1].ended,upstreamClosed:f.hits[1].closed}));
});
test('browser form overflow has safe static recovery guidance; unrelated denials stay generic',{timeout:20000},async t=>{
 const f=await fixture(t);
 const response=await f.upload(MiB+1,{headers:{accept:'text/html','sec-fetch-mode':'navigate','sec-fetch-dest':'iframe'},path:'/upload?untrusted=DO_NOT_REFLECT'});
 assert.equal(response.status,413);assert.match(response.headers['content-type'],/^text\/html/);
 assert.match(response.text,/Upload too large/);assert.match(response.text,/Back/);assert.match(response.text,/smaller/);assert.doesNotMatch(response.text,/DO_NOT_REFLECT|relay_cap|script/i);
 assert.match(response.headers['content-security-policy'],/default-src 'none'/);assert.match(response.headers['content-security-policy'],/frame-ancestors https:\/\/desktop\.relay\.test/);
 for(const headers of [{cookie:''},{origin:'https://attacker.example'},{'sec-fetch-site':'cross-site'}]){
  const r=await f.upload(MiB+1,{headers:{accept:'text/html',...headers}});assert.equal(r.status,403);assert.equal(JSON.parse(r.text).error,'Gateway request denied');
 }
 assert.equal(f.hits.length,0);assert.equal((await f.upload(3)).status,200);
});
test('an early upstream success cannot hide streamed overflow; upstream 413 preserves framing policy',{timeout:20000},async t=>{
 const f=await fixture(t);
 assert.equal((await f.upload(MiB+65536,{chunked:true,path:'/early'})).status,413);
 const upstream=await f.upload(5,{path:'/upstream-limit',headers:{accept:'text/html'}});
 assert.equal(upstream.status,413);assert.match(upstream.text,/upstream application/);assert.doesNotMatch(upstream.text,/DO_NOT_REFLECT/);
 assert.match(upstream.headers['content-security-policy'],/frame-ancestors 'none'/);assert.equal(upstream.headers['x-frame-options'],'DENY');
 const json=await f.upload(5,{path:'/upstream-limit',headers:{accept:'application/json'}});assert.equal(JSON.parse(json.text).code,'upstream_request_too_large');
 assert.equal((await f.upload(13)).status,200);
});
test('overflow does not wait for body end or exhaust operation slots',{timeout:20000},async t=>{
 const f=await fixture(t);
 for(let i=0;i<34;i++){
  const r=await f.upload(MiB+65536,{chunked:true,finish:false,headers:{accept:'application/json'}});assert.equal(r.status,413);
  assert.equal(f.lab.relay.experimentalGateway.stats().active,0);
 }
 assert.equal((await f.upload(17)).status,200);assert.equal(f.lab.relay.experimentalGateway.stats().active,0);
});
for(const action of ['disconnect','logout'])test('active chunked upload '+action+' closes upstream and releases operation',{timeout:20000},async t=>{
 const f=await fixture(t),u=new URL(f.launch.origin);
 const accepted=once(f.upstream,'request');
 const req=https.request({hostname:'127.0.0.1',port:u.port,servername:u.hostname,ca:f.lab.cert,path:'/held',method:'POST',headers:{host:u.host,origin:f.launch.origin,cookie:f.cap.cookie,'sec-fetch-site':'same-origin'}});
 req.on('error',()=>{});t.after(()=>req.destroy());req.write(Buffer.alloc(65536));
 const [remote]=await accepted;const closed=new Promise(r=>remote.once('close',r));
 assert.equal(f.lab.relay.experimentalGateway.stats().active,1);
 if(action==='disconnect')req.destroy();else assert.equal((await f.lab.api('/logout','POST',{})).status,200);
 await closed;assert.equal(f.lab.relay.experimentalGateway.stats().active,0);assert.equal(f.hits[0].ended,false);
 if(action==='disconnect')assert.equal((await f.upload(19)).status,200);else{const r=await f.upload(19);assert.equal(r.status,403);assert.equal(f.hits.length,1);}
});
