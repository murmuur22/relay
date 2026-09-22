// Disposable experimental gateway fixture: real Relay enrollment and real HTTP/TLS.
import http from 'node:http';
import https from 'node:https';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {X509Certificate,createHash} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {createGateway} from '../server/gateway.mjs';
import {authenticate,client,password} from './auth-helper.mjs';
export {password};
export async function gatewayLab(options={}){
 const dir=await mkdtemp(tmpdir()+'/relay-desktop-gateway-');let relay;const seen=[],sockets=new Set();
 const upstream=http.createServer((req,res)=>{
  seen.push({path:req.url,cookie:req.headers.cookie||'',auth:req.headers.authorization||''});
  if(req.url==='/login'&&req.method==='POST'){req.resume();res.writeHead(200,{'Content-Type':'text/plain'});res.end('synthetic-token');return;}
  if(req.url==='/set'){res.setHeader('Set-Cookie','sid=synthetic-jar; Path=/; HttpOnly');res.end('set');return;}
  if(req.url==='/echo'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(seen.at(-1)));return;}
  if(req.url==='/slow'){res.writeHead(200);res.write('start');const t=setInterval(()=>res.write('tick'),30);res.on('close',()=>clearInterval(t));return;}
  if(req.url==='/private'){res.writeHead(req.headers.authorization==='Bearer synthetic-token'?200:401);res.end('private');return;}
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><h1>Synthetic Files</h1><input aria-label="Private text"><button id="login">App login</button><button id="logout">App Logout</button><p id="status">Fresh login</p><script>document.querySelector('#login').onclick=async()=>{await fetch('/login',{method:'POST'});document.querySelector('#status').textContent='App signed in';localStorage.setItem('app','yes')};document.querySelector('#logout').onclick=()=>{localStorage.clear();document.querySelector('#status').textContent='App signed out'};</script>`);
 });
 const wss=new WebSocketServer({server:upstream});wss.on('connection',ws=>{sockets.add(ws);ws.on('close',()=>sockets.delete(ws));ws.on('message',m=>ws.send(m));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 try{
  const desktopHostname=options.gatewayConfig?.desktopHostname??'desktop.relay.test',appBaseDomain=options.gatewayConfig?.appBaseDomain??'relay.test';
  await writeFile(dir+'/cert.cnf',`[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${desktopHostname}\n[ext]\nsubjectAltName=DNS:${desktopHostname},DNS:*.${appBaseDomain}\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n`);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-config',dir+'/cert.cnf'],{stdio:'ignore'});
  const cert=await readFile(dir+'/cert.pem'),key=await readFile(dir+'/key.pem');
  const experimentalGateway={key,cert,targets:[{id:'files',label:'Synthetic Files',upstream:`http://127.0.0.1:${upstream.address().port}`,cookieNames:['sid'],webSocketPaths:['/socket'],allowDownloads:true,authProfile:{login:{method:'POST',path:'/login',status:200,contentType:'text/plain'},maxBytes:128,ttlMs:60000,headers:[{name:'authorization',prefix:'Bearer '}],stripHeaders:[]}}]};
  if(options.targets)experimentalGateway.targets=options.targets;
  if(options.gatewayConfig)experimentalGateway.deployment={bind:'127.0.0.1',...options.gatewayConfig};
  relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone',experimentalGateway});
  const admin=await authenticate(relay.origin,dir+'/state'),api=client(relay.origin,admin);
  await api('/onboarding/complete','POST',{});await api('/preferences','PATCH',{showAppStatus:false,introAnimation:false,interfaceAnimations:false});
  return {dir,relay,api,admin,cert,seen,upstream,experimentalGateway,spki:createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64'),async close(){await relay.close();for(const s of sockets)s.terminate();wss.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});}};
 }catch(e){await relay?.close();wss.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});throw e;}
}
export function edgeRequest(l,origin,path,{method='GET',headers={},body}={}){
 const u=new URL(origin);return new Promise((resolve,reject)=>{
  const req=https.request({hostname:'127.0.0.1',port:u.port,servername:u.hostname,ca:l.cert,path,method,headers:{host:u.host,'sec-fetch-site':'same-origin',...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
}
export async function addGateway(l,userIds=[]){const r=await l.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Files',gateway:{target:'files'},userIds});if(r.status!==200)throw Error('Registration failed: '+r.status);return r.json();}
export async function launchGateway(l,app,api=l.api){await api('/windows','POST',{appId:app.id});const r=await api('/gateway/launch','POST',{appId:app.id});if(r.status!==200)throw Error('Launch failed: '+r.status);return r.json();}
export async function redeemGateway(l,target){const r=await edgeRequest(l,target.origin,'/.relay/redeem',{method:'POST',headers:{origin:target.origin},body:{ticket:target.ticket}});return {...r,cookie:r.headers['set-cookie']?.[0].split(';')[0]};}
