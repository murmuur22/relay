// Child-local scheduling/observation only; production HTTP parsers and binds run.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {Manager} from '../../server/streams.mjs';
import {HealthProbes} from '../../server/health.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const mode=process.argv[2];
const partial=mode!=='edge-no-partial',native=mode==='native-partial';
const events=[],started=performance.now();
const record=(stage,extra={})=>{const event={stage,ms:Math.round(performance.now()-started),...extra};events.push(event);console.log(JSON.stringify(event));};
async function bound(p,label,ms=2000){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(label)),ms))]);}finally{clearTimeout(timer);}}
const runtime=await mkdtemp(tmpdir()+'/startup-cleanup-');
const originalListen=http.Server.prototype.listen,netListen=net.Server.prototype.listen,originalClose=http.Server.prototype.close;
const init=Manager.prototype.init,healthClose=HealthProbes.prototype.close,managers=[];
const cleanupFailure=mode==='edge-cleanup-failure';
let server,serverSocket,socket,blocker,gateway,pending,port,occupied,auth,settled=false,ack=false,failure;
let dataResolve,closeResolve;
const received=new Promise(r=>dataResolve=r),closing=new Promise(r=>closeResolve=r);
const fixtureSockets=new Set();
try{
 // Genuine disposable enrollment; reused synthetic owner, no seeded credentials.
 const seed=await createGateway({port:0,runtime});
 try{await authenticate(seed.origin,runtime);}finally{await seed.close();}
 Manager.prototype.init=async function(...args){await init.apply(this,args);managers.push(this);};
 if(cleanupFailure)HealthProbes.prototype.close=async function(){await healthClose.call(this);throw Error('Synthetic rejected cleanup acknowledgement');};
 blocker=net.createServer(s=>{fixtureSockets.add(s);s.once('close',()=>fixtureSockets.delete(s));});
 await new Promise(r=>blocker.listen(0,'127.0.0.1',r));
 occupied=blocker.address().port;record('occupied',{port:occupied});
 async function acceptedPartial(){
  socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});await once(socket,'connect');
  socket.write('GET /health/ready HTTP/1.1\r\nHost: 127.0.0.1:'+port+'\r\n');
  await received;assert.equal(serverSocket.destroyed,false);
  record('partial-received',{bytes:serverSocket.bytesRead,destroyed:serverSocket.destroyed});
 }
 async function beforeFailure(){
  if(partial)await acceptedPartial();
  if(mode==='edge-live'||native||cleanupFailure){
   auth=await authenticate('http://127.0.0.1:'+port,runtime);
   assert.equal(managers.length,1);
   if(mode==='edge-live'){
    const api=client('http://127.0.0.1:'+port,auth);
    assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);
    const manager=managers[0],resource=await manager.ensure(manager.windows.get('notes-lab'));
    assert.ok(resource&&!resource.page.isClosed());record('real-page-ready');
   }
  }
 }
 http.Server.prototype.listen=function(...args){
  if(!server){
   server=this;this.on('connection',s=>{s.on('error',()=>{});s.once('data',chunk=>{if(chunk.toString().startsWith('GET /health/ready')){serverSocket=s;dataResolve();}});});
   this.once('listening',()=>{port=this.address().port;record('management-listening',{port,headersTimeout:this.headersTimeout,requestTimeout:this.requestTimeout});});
   return originalListen.apply(this,args);
  }
  if(args[0]!==occupied)return originalListen.apply(this,args);
  const edge=this;
  void beforeFailure().then(()=>{edge.once('error',e=>record('bind-error',{code:e.code}));originalListen.apply(edge,args);}).catch(e=>{failure=e;originalListen.apply(edge,args);});
  return edge;
 };
 if(native)net.Server.prototype.listen=function(...args){
  if(this instanceof http.Server||this===blocker)return netListen.apply(this,args);
  const probe=this;
  void beforeFailure().then(()=>netListen.apply(probe,args)).catch(e=>{failure=e;dataResolve();closeResolve();});return probe;
 };
 http.Server.prototype.close=function(callback){
  if(this!==server)return originalClose.call(this,callback);
  record('management-close-entered',{partial:!!serverSocket,destroyed:serverSocket?.destroyed??null});closeResolve();
  return originalClose.call(this,(...args)=>{ack=true;record('management-close-ack');callback?.(...args);});
 };
 const config={port:occupied,deployment:{bind:'127.0.0.1',desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test'},proxy:{desktopOrigin:'https://desktop.example.test',trustedProxy:'127.0.0.1'},targets:[{id:'synthetic',label:'Synthetic',upstream:'http://127.0.0.1:18302'}]};
 if(mode==='normal-partial'){
  gateway=await createGateway({port:0,runtime});await acceptedPartial();
  await bound(gateway.close(),'normal close blocked');settled=true;
 }else{
  pending=createGateway({port:0,runtime,native,keepsakesPort:occupied,data:runtime+'/synthetic-library',...(!native?{experimentalGateway:config}:{})}).then(g=>{gateway=g;settled=true;throw Error('unexpected startup success');},e=>{settled=true;record('startup-rejected',{code:e.code??null,message:e.message});return e;});
  await bound(closing,'cleanup not entered',8000);if(failure)throw failure;
  const result=await bound(pending,'startup cleanup blocked by accepted partial HTTP headers');
  if(cleanupFailure){assert.ok(result instanceof AggregateError);assert.equal(result.cause.code,'EADDRINUSE');assert.equal(result.errors[0],result.cause);assert.equal(result.errors[1].status,503);assert.match(result.message,/cleanup incomplete/);record('cleanup-failure-reported');}
  else if(native)assert.match(result.message,/Dedicated Keepsakes port occupied/);else assert.equal(result.code,'EADDRINUSE');
 }
 assert.equal(ack,true);assert.equal(server.listening,false);
 if(partial)assert.equal(serverSocket.destroyed,true);
 for(const m of managers){assert.equal(m.closed,true);assert.equal(m.resources.size,0);assert.equal(m.pendingCleanup.size,0);if(m.browserPromise){const b=await m.browserPromise;assert.equal(b.isConnected(),false);assert.equal(b.contexts().length,0);}}
 // The captured production handlers stay irreversibly closed if this owned
 // listener is reopened for observation. A fresh real request must return 503.
 if(auth){
  await new Promise(r=>originalListen.call(server,port,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+port;
  // Do not reuse authentication's pooled sockets: startup cleanup destroyed them.
  // This observation must reach the reopened listener on a fresh connection.
  let request,csrf;
  try{
   csrf=await bound(new Promise((resolve,reject)=>{
    request=http.get(origin+'/api/auth',{agent:false},res=>{
     let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
     res.on('error',reject);res.once('aborted',()=>reject(Error('fresh auth response aborted')));
     res.once('end',()=>{try{resolve(JSON.parse(body).csrf);}catch(error){reject(error);}});
    });request.on('error',reject);
   }),'fresh auth deadline');
  }finally{request?.destroy();}
  const status=await new Promise((resolve,reject)=>{const q=http.request(origin+'/api/login',{agent:false,method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}},r=>{r.resume();r.once('end',()=>resolve({status:r.statusCode,cookie:r.headers['set-cookie']}));});q.on('error',reject);q.setTimeout(2000,()=>q.destroy(Error('fresh login deadline')));q.end(JSON.stringify({username:'admin',password}));});
  assert.equal(status.status,503);assert.equal(status.cookie,undefined);record('fresh-admission-denied',{status:status.status});
 }
 record('assertions-passed',{mode,managers:managers.length});
}catch(error){failure=error;record('assertion-failed',{message:error.message,settled,ack,socketDestroyed:serverSocket?.destroyed??null});}
finally{
 socket?.destroy();serverSocket?.destroy();
 // Releasing fixture client is diagnostic teardown, never candidate success.
 if(pending)await bound(pending.catch(()=>{}),'pending teardown',4000);
 await gateway?.close();
 for(const m of managers)await m.close();
 if(server?.listening)await new Promise(r=>originalClose.call(server,r));
 for(const s of fixtureSockets)s.destroy();
 if(blocker?.listening)await new Promise(r=>blocker.close(r));
 http.Server.prototype.listen=originalListen;http.Server.prototype.close=originalClose;net.Server.prototype.listen=netListen;Manager.prototype.init=init;HealthProbes.prototype.close=healthClose;
 for(const p of [port,occupied].filter(Boolean)){
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(p,'127.0.0.1',resolve);});await new Promise(r=>probe.close(r));record('port-rebound',{port:p});
 }
 await rm(runtime,{recursive:true,force:true});record('fixtures-removed',{managementListening:server?.listening??false,socketDestroyed:serverSocket?.destroyed??null});
}
if(failure)throw failure;
