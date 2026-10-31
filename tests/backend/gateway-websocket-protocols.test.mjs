// Synthetic TLS/WSS transport qualification, not real Cockpit or browser evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm,chmod,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {createGateway} from '../../server/gateway.mjs';
import {loadGatewayConfig} from '../../server/experimental-gateway-config.mjs';
import {authenticate,client} from '../auth-helper.mjs';
import {addGateway,launchGateway,redeemGateway,edgeRequest} from '../gateway-helper.mjs';

async function fixture(t,{protocols=['cockpit1'],selection,trust='valid',originPolicy,accessPolicy}={}){
 // Canonicalize the fixture root; do not relax the protected loader's symlink policy.
 const dir=await mkdtemp((await realpath(tmpdir()))+'/relay-mgmt2-wss-');
 let relay,upstream,wss;const peers=new Set(),clients=new Set(),offers=[];
 t.after(async()=>{
  for(const ws of clients)ws.terminate();
  try{await relay?.close();}finally{
   for(const ws of peers)ws.terminate();
   if(wss)await new Promise(r=>wss.close(r));
   if(upstream?.listening){upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
   assert.equal(upstream?.listening??false,false,'owned upstream listener closed');
   await rm(dir,{recursive:true,force:true});
  }
 });
 await writeFile(dir+'/cert.cnf','[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=desktop.example.test\n[ext]\nsubjectAltName=DNS:desktop.example.test,DNS:*.apps.example.test,DNS:upstream.example.test\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-config',dir+'/cert.cnf'],{stdio:'ignore'});
 await chmod(dir+'/cert.pem',0o600);await chmod(dir+'/key.pem',0o600);
 const cert=await readFile(dir+'/cert.pem'),key=await readFile(dir+'/key.pem');
 upstream=https.createServer({cert,key},(_req,res)=>res.end('Synthetic upstream'));
 wss=new WebSocketServer({server:upstream,perMessageDeflate:false,handleProtocols:(offered,req)=>selection?selection(offered,req):[...offered].at(-1)});
 wss.on('connection',(ws,req)=>{
  offers.push({protocol:req.headers['sec-websocket-protocol']??'',origin:req.headers.origin,forwarded:req.headers['x-forwarded-host'],cookie:!!req.headers.cookie});
  peers.add(ws);ws.on('error',()=>{});ws.on('close',()=>peers.delete(ws));ws.on('message',(data,binary)=>ws.send(data,{binary}));
 });
 await new Promise((resolve,reject)=>{upstream.once('error',reject);upstream.listen(0,'127.0.0.1',resolve);});
 const target={id:'files',label:'Synthetic protocols',upstream:`https://127.0.0.1:${upstream.address().port}`,webSocketPaths:['/socket'],...(protocols==='absent'?{}:{webSocketProtocols:protocols}),...(originPolicy===undefined?{}:{webSocketOrigin:originPolicy}),...(accessPolicy===undefined?{}:{accessPolicy}),upstreamTLS:{...(trust==='untrusted'?{}:{caPath:dir+'/cert.pem'}),serverName:trust==='wrong-name'?'wrong.example.test':'upstream.example.test'}};
 const reference={version:1,bind:'127.0.0.1',port:18443,desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test',keyPath:dir+'/key.pem',certPath:dir+'/cert.pem',targets:[target]};
 async function config(){await writeFile(dir+'/gateway.json',JSON.stringify(reference),{mode:0o600});return loadGatewayConfig(dir+'/gateway.json');}
 relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone',experimentalGateway:await config()});
 const pass=randomBytes(24).toString('hex'),admin=await authenticate(relay.origin,dir+'/state','admin',pass),api=client(relay.origin,admin);
 const l={relay,api,cert,dir,reference,config,offers,peers,pass};
 l.open=async(launch,cap,offered=['cockpit1'],path='/socket',extra={})=>{
  const ws=new WebSocket(launch.origin.replace('https:','wss:')+path,offered,{ca:cert,handshakeTimeout:3000,lookup:(_host,_opts,cb)=>cb(null,[{address:'127.0.0.1',family:4}]),headers:{origin:launch.origin,cookie:cap.cookie,...extra}});
  clients.add(ws);ws.on('error',()=>{});
  return new Promise(resolve=>{
   let settled=false;
   const done=result=>{if(settled)return;settled=true;resolve({ws,...result});};
   ws.once('open',()=>done({open:true}));ws.once('error',()=>done({open:false}));ws.once('close',()=>done({open:false}));
  });
 };
 return l;
}
async function echo(ws,text='synthetic live channel'){
 const received=once(ws,'message');ws.send(text);assert.equal((await received)[0].toString(),text);
}

test('legacy absent protocol policy still permits a no-protocol TLS socket',{timeout:15000},async t=>{
 const l=await fixture(t,{protocols:'absent'});
 const app=await addGateway(l),launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);
 const result=await l.open(launch,cap,[]);assert.equal(result.open,true);assert.equal(result.ws.protocol,'');await echo(result.ws);
});

test('declared protocols negotiate the upstream choice identically on both TLS socket legs',{timeout:15000},async t=>{
 const l=await fixture(t,{protocols:['cockpit1','relay-test-v2']});
 const app=await addGateway(l),launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);
 const result=await l.open(launch,cap,['cockpit1','relay-test-v2']);
 assert.equal(result.open,true,'declared protocol connection opens');
 assert.equal(result.ws.protocol,'relay-test-v2','browser leg uses upstream choice, not first offered');
 assert.equal(l.offers[0].protocol,'cockpit1,relay-test-v2');
 await echo(result.ws);
});

test('admin-only target denies a genuinely granted ordinary user but permits an administrator',{timeout:15000},async t=>{
 const l=await fixture(t,{accessPolicy:'admin-only'});
 const user=await(await l.api('/admin/users','POST',{username:'alice',password:l.pass})).json(),app=await addGateway(l,[user.id]);
 const auth=await authenticate(l.relay.origin,l.dir+'/state','alice',l.pass),api=client(l.relay.origin,auth);
 await api('/windows','POST',{appId:app.id});
 assert.equal((await api('/gateway/launch','POST',{appId:app.id})).status,403);
 const launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);assert.equal((await l.open(launch,cap)).open,true);
 for(const value of [null,true,'everyone']){l.reference.targets[0].accessPolicy=value;await assert.rejects(l.config());}
});

test('opt-in upstream Origin is server-derived and never trusts client forwarding headers',{timeout:15000},async t=>{
 const l=await fixture(t,{originPolicy:'upstream'}),app=await addGateway(l),launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);
 const result=await l.open(launch,cap,['cockpit1'],'/socket',{'x-forwarded-host':'evil.example'});
 assert.equal(result.open,true);assert.equal(l.offers[0].origin,l.reference.targets[0].upstream);assert.equal(l.offers[0].forwarded,undefined);
 for(const value of [null,true,'https://evil.example','browser']){l.reference.targets[0].webSocketOrigin=value;await assert.rejects(l.config());}
});

test('protocol configuration is bounded and fails closed for malformed values',{timeout:15000},async t=>{
 const l=await fixture(t);
 for(const value of [null,'cockpit1',{},[''],['bad token'],['cockpit1','cockpit1'],['x'.repeat(65)],Array.from({length:9},(_,i)=>'p'+i)]){
  l.reference.targets[0].webSocketProtocols=value;
  await assert.rejects(l.config(),/Invalid gateway deployment configuration/);
 }
 delete l.reference.targets[0].webSocketProtocols;
 assert.deepEqual((await l.config()).targets[0].webSocketProtocols,[]);
});

test('undeclared offers, downgrade, wrong path and foreign Origins cannot reach upstream',{timeout:15000},async t=>{
 const l=await fixture(t),app=await addGateway(l),launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);
 for(const [protocols,path,headers] of [[['other'],'/socket',{}],[['cockpit1','other'],'/socket',{}],[[],'/socket',{}],[['cockpit1'],'/wrong',{}],[['cockpit1'],'/socket',{origin:'https://evil.example'}],[['cockpit1'],'/socket',{origin:'null'}]])assert.equal((await l.open(launch,cap,protocols,path,headers)).open,false);
 assert.equal(l.offers.length,0);
 assert.equal((await l.open(launch,cap)).open,true);
});

for(const trust of ['untrusted','wrong-name'])test('WSS rejects '+trust+' TLS without reaching an upstream session',{timeout:15000},async t=>{
 const l=await fixture(t,{trust}),app=await addGateway(l),launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);
 assert.equal((await l.open(launch,cap)).open,false);assert.equal(l.offers.length,0);
});

test('missing upstream protocol selection is rejected rather than downgraded',{timeout:15000},async t=>{
 const l=await fixture(t,{selection:()=>false}),app=await addGateway(l),launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);
 assert.equal((await l.open(launch,cap)).open,false);
});

for(const action of ['end','logout','grant','disable'])test('negotiated WSS '+action+' closes both legs and denies retained capability',{timeout:15000},async t=>{
 const l=await fixture(t);
 const user=await(await l.api('/admin/users','POST',{username:'alice',password:l.pass})).json();
 const app=await addGateway(l,[user.id]);
 const auth=await authenticate(l.relay.origin,l.dir+'/state','alice',l.pass),api=client(l.relay.origin,auth);
 const launch=await launchGateway(l,app,api),cap=await redeemGateway(l,launch),result=await l.open(launch,cap);
 assert.equal(result.open,true);await echo(result.ws);
 const closed=once(result.ws,'close'),peerClosed=once([...l.peers][0],'close');
 const response=action==='end'?await api('/gateway/end','POST',{appId:app.id,launchId:launch.launchId}):action==='logout'?await api('/logout','POST'):await l.api('/admin/users/'+user.id,'PATCH',action==='grant'?{grants:[]}:{disabled:true});
 assert.equal(response.status,200);await Promise.all([closed,peerClosed]);
 assert.equal(l.peers.size,0);
 assert.equal((await l.open(launch,cap)).open,false);
 assert.equal((await edgeRequest(l,launch.origin,'/',{headers:{cookie:cap.cookie}})).status,403);
 assert.deepEqual(l.relay.experimentalGateway.stats(),{routes:0,tickets:0,caps:0,active:0});
});

