// Run only through tools/qualify-remote-containers.mjs in disposable namespaces.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {createGateway} from '../server/gateway.mjs';
import {validateGatewayReference} from '../server/experimental-gateway-config.mjs';
import {caddySnippet} from '../server/gateway-caddy.mjs';
import {remoteReference} from './remote-tls-helper.mjs';
const pause=()=>new Promise(r=>setTimeout(r,50));
async function waitFile(path){for(let i=0;i<400;i++){try{return await readFile(path,'utf8');}catch{}await pause();}throw Error('Fixture file readiness timeout');}
const role=process.env.RELAY_FIXTURE_ROLE;
const topology=JSON.parse(await waitFile('/fixture/topology.json'));
const origin='https://desktop.example.test',bytes=Buffer.from('synthetic separate namespace bytes');
const browserCA=await readFile('/fixture/browser.pem');
const headers={host:'desktop.example.test','x-forwarded-host':'desktop.example.test','x-forwarded-proto':'https'};
function request(path,{site=origin,method='GET',body,extra={},backend=false,clientCert=true}={}){
 const u=new URL(site);return new Promise(async(resolve,reject)=>{
  try{const tls=backend?{ca:await readFile('/fixture/server-ca.pem'),...(clientCert?{cert:await readFile('/fixture/client.pem'),key:await readFile('/fixture/client.key')}:{})}:{ca:browserCA};
   const q=https.request({hostname:backend?topology.relay:topology.caddy,port:backend?8444:8443,servername:backend?'backend.example.test':u.hostname,...tls,agent:false,path,method,headers:{host:u.host,'sec-fetch-site':'same-origin',...extra}},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,bytes:Buffer.concat(chunks),json:()=>JSON.parse(Buffer.concat(chunks))}));});q.on('error',reject);q.setTimeout(5000,()=>q.destroy(Error('Fixture request timeout')));q.end(body===undefined?undefined:JSON.stringify(body));
  }catch(e){reject(e);}
 });
}
async function ready(expected=200){for(let i=0;i<400;i++){try{if((await request('/api/auth')).status===expected)return;}catch{}await pause();}throw Error('Fixture Caddy readiness failed');}
if(role==='relay'){
 const upstream=http.createServer((q,r)=>{if(q.url==='/slow'){r.writeHead(200);r.write('active');const timer=setInterval(()=>r.write('data'),20);r.on('close',()=>clearInterval(timer));return;}if(q.url==='/redirect'){r.writeHead(302,{location:'/file'});r.end();return;}if(q.headers.range==='bytes=2-8'){r.writeHead(206,{'Content-Range':`bytes 2-8/${bytes.length}`});r.end(bytes.subarray(2,9));return;}r.end(bytes);});
 new WebSocketServer({server:upstream}).on('connection',ws=>ws.on('message',m=>ws.send(m)));
 await new Promise(r=>upstream.listen(18302,'127.0.0.1',r));
 const ref=remoteReference('/fixture',8444,topology.relay,topology.caddy);ref.targets[0].webSocketPaths=['/socket'];ref.targets[0].allowDownloads=true;
 const config=await validateGatewayReference(ref);
 await createGateway({port:0,runtime:'/fixture/state',profile:'standalone',experimentalGateway:config});
 const sites=caddySnippet(config,[topology.client+'/32']).replace(' {\n',' {\n tls /fixture/browser.pem /fixture/browser.key\n');
 await writeFile('/fixture/Caddyfile',`{\n admin off\n auto_https off\n https_port 8443\n}\n${sites}\nhttps://sibling.example.test {\n tls /fixture/browser.pem /fixture/browser.key\n respond "unrelated sibling"\n}\n`);
 console.log('Relay listening on assigned container IPv4; private management stays loopback');
}else if(role==='caddy'){
 await waitFile('/fixture/Caddyfile');
 let proxy;
 const start=()=>{proxy=spawn('/fixture/caddy',['run','--config','/fixture/Caddyfile','--adapter','caddyfile'],{stdio:'ignore',env:{...process.env,HOME:'/tmp',XDG_DATA_HOME:'/tmp/data',XDG_CONFIG_HOME:'/tmp/config'}});};start();
 for(let i=0;i<12000;i++){if(proxy.exitCode!==null)throw Error('Disposable Caddy exited');try{await access('/fixture/deny-request');break;}catch{}await pause();}
 proxy.kill('SIGTERM');await once(proxy,'exit');
 await writeFile('/fixture/Caddyfile',(await readFile('/fixture/Caddyfile','utf8')).replace(topology.client+'/32','192.0.2.0/24'));start();
 console.log('Caddy policy switched to deny fixture source');
}else if(role==='client'){
 await ready();assert.equal((await request('/',{site:'https://sibling.example.test'})).bytes.toString(),'unrelated sibling');
 // Direct access from a distinct namespace cannot forge proxy trust even with a valid client certificate.
 assert.equal((await request('/api/auth',{backend:true,extra:headers})).status,400);
 await assert.rejects(request('/api/auth',{backend:true,clientCert:false,extra:headers}));
 const password=randomBytes(24).toString('hex'),info=(await request('/api/auth')).json(),setup=new URL(await readFile('/fixture/state/setup-url.txt','utf8')).hash.slice(1);
 const enrolled=await request('/api/enroll',{method:'POST',body:{username:'admin',password,setup},extra:{origin,'content-type':'application/json','x-csrf-token':info.csrf}});assert.equal(enrolled.status,200);assert.match(enrolled.headers['set-cookie'][0],/Secure/);
 const cookie=enrolled.headers['set-cookie'][0].split(';')[0],session=(await request('/api/session',{extra:{cookie}})).json();
 const api=(path,method='GET',body)=>request('/api'+path,{method,body,extra:{cookie,origin,'content-type':'application/json','x-csrf-token':session.csrf}});
 const app=(await api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Files',gateway:{target:'files'},userIds:[]})).json();assert.ok(app.id);
 assert.equal((await api('/windows','POST',{appId:app.id})).status,200);const launch=(await api('/gateway/launch','POST',{appId:app.id})).json();assert.match(launch.origin,/^https:\/\/[a-f0-9]{32}\.apps\.example\.test$/);
 const redeemed=await request('/.relay/redeem',{site:launch.origin,method:'POST',body:{ticket:launch.ticket},extra:{origin:launch.origin,'content-type':'application/json'}});assert.equal(redeemed.status,200);const cap=redeemed.headers['set-cookie'][0].split(';')[0];
 assert.deepEqual((await request('/file',{site:launch.origin,extra:{cookie:cap}})).bytes,bytes);
 const range=await request('/file',{site:launch.origin,extra:{cookie:cap,range:'bytes=2-8'}});assert.equal(range.status,206);assert.deepEqual(range.bytes,bytes.subarray(2,9));assert.equal((await request('/redirect',{site:launch.origin,extra:{cookie:cap}})).status,302);
 const u=new URL(launch.origin),ws=new WebSocket(`wss://${topology.caddy}:8443/socket`,{ca:browserCA,servername:u.hostname,headers:{host:u.host,origin:launch.origin,cookie:cap}});await once(ws,'open');const msg=once(ws,'message');ws.send('namespaces');assert.equal((await msg)[0].toString(),'namespaces');
 const transfer=await new Promise((resolve,reject)=>{const q=https.get({hostname:topology.caddy,port:8443,servername:u.hostname,ca:browserCA,path:'/slow',headers:{host:u.host,cookie:cap,'sec-fetch-site':'same-origin'}},r=>r.once('data',()=>resolve(r)));q.on('error',reject);});assert.equal(transfer.statusCode,200);assert.equal(transfer.complete,false);transfer.on('error',()=>{});const closed=new Promise(r=>transfer.once('close',r)),wsClosed=once(ws,'close');
 assert.equal((await api('/logout','POST',{})).status,200);await closed;await wsClosed;assert.equal(transfer.complete,false);assert.equal((await request('/file',{site:launch.origin,extra:{cookie:cap}})).status,403);
 await writeFile('/fixture/deny-request','yes');await ready(403);assert.equal((await request('/api/auth',{extra:{'x-forwarded-for':topology.client}})).status,403);assert.equal((await request('/',{site:'https://sibling.example.test'})).bytes.toString(),'unrelated sibling');
 console.log('PASS isolated Linux namespaces: genuine enrollment, app capability, bytes/Range/redirect/WS, active logout, untrusted peer, source policy Host/SNI and sibling route');
}else throw Error('Unknown isolated fixture role');
