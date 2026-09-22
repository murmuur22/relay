// Opt-in experimental normal-desktop gateway; explicit deployment config only.
// Real authority is the owning Relay's Accounts and live sessions, never an auth callback.
import https from 'node:https';
import http from 'node:http';
import {createSecureContext} from 'node:tls';
import {randomBytes} from 'node:crypto';
import {createTransport,validateApp} from './experimental-gateway-transport.mjs';
import {forgetCredential} from './experimental-gateway-profile.mjs';
import {fail} from './accounts.mjs';
import {isIP} from 'node:net';
import {safeIP} from './transport.mjs';
import {validateDeployment} from './experimental-gateway-config.mjs';
const secret=()=>randomBytes(32).toString('hex');
const denied=()=>fail(403,'Gateway access denied');
const cookie=(req,name)=>{const matches=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));return matches.length===1?matches[0].slice(name.length+1):null;};
const send=(res,status,data)=>{if(status>=400){res.shouldKeepAlive=false;res.setHeader('Connection','close');}res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
export function experimentalConfig(value){
 if(value===undefined)return null;
 if(!value?.key||!value?.cert)throw Error('Experimental gateway requires explicit TLS key and certificate');
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['key','cert','targets','port','deployment'].includes(k))||!Array.isArray(value.targets)||!value.targets.length||value.targets.length>8||!Number.isInteger(value.port??0)||(value.port??0)<0||(value.port??0)>65535)throw Error('Invalid experimental gateway configuration');
 const deployment=value.deployment===undefined?undefined:validateDeployment(value.deployment);
 createSecureContext({key:value.key,cert:value.cert});
 const targets=value.targets.map(raw=>{
  const allowed=['id','label','upstream','entryPath','cookieNames','requestHeaders','responseHeaders','webSocketPaths','allowDownloads','allowPopups','authProfile','maxResponseBytes',...(deployment?['tls']:[])];
  if(!raw||Object.keys(raw).some(k=>!allowed.includes(k))||! /^[a-z][a-z0-9-]{0,31}$/.test(raw.id)||typeof raw.label!=='string'||!raw.label.trim()||raw.label.length>64)throw Error('Invalid experimental gateway target');
  const u=new URL(raw.upstream);if(u.origin!==raw.upstream||(deployment?(!['http:','https:'].includes(u.protocol)||isIP(u.hostname)!==4||!safeIP(u.hostname)):(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port)))throw Error('Experimental gateway requires fixed approved literal upstream origins');
  if(raw.tls!==undefined&&(u.protocol!=='https:'||!raw.tls||typeof raw.tls!=='object'||Object.keys(raw.tls).some(k=>!['ca','serverName'].includes(k))||(raw.tls.ca!==undefined&&typeof raw.tls.ca!=='string')||(raw.tls.serverName!==undefined&&(typeof raw.tls.serverName!=='string'||raw.tls.serverName.length>253||!raw.tls.serverName.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))))))throw Error('Invalid upstream TLS configuration');
  const target=structuredClone(raw);validateApp(target);return target;
 });
 if(new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('Duplicate experimental gateway target');
 return {key:value.key,cert:value.cert,port:value.port??0,targets,...(deployment?{deployment}:{})};
}
export async function startExperimentalGateway({config,relayOrigin,accounts,sessions,admit}){
 const relay=new URL(relayOrigin);if(relay.protocol!=='http:'||(!config.deployment&&relay.hostname!=='127.0.0.1'))throw Error('Experimental gateway requires private management HTTP');
 const routes=new Map(),tickets=new Map(),caps=new Map(),active=new Set(),ended=new WeakMap(),bridgeSockets=new Set();
 let desktopOrigin,transport;
 const available=()=>({enabled:true,desktopOrigin,appBaseDomain:config.deployment?.appBaseDomain??'relay.test',targets:config.targets.map(({id,label})=>({id,label}))});
 function validateDefinition(app){if(!config.targets.some(t=>t.id===app.gateway?.target))throw fail(400,'Unknown configured gateway target');}
 function authority(session,appId){
  admit();const user=accounts.state.users.find(u=>u.id===session?.userId),app=accounts.state.services.find(a=>a.id===appId);
  if(!session||sessions.get(session.id)!==session||session.revoked||session.expires<=Date.now()||!user||!accounts.allowed(user,app)||app.mode!=='gateway')throw denied();
  validateDefinition(app);return app;
 }
 function current(route){const app=authority(route.session,route.appId);if(routes.get(new URL(route.origin).host)!==route||JSON.stringify(app)!==route.definition)throw denied();return route;}
 function retire(route){routes.delete(new URL(route.origin).host);forgetCredential(route);for(const [id,t] of tickets)if(t.route===route)tickets.delete(id);for(const [id,c] of caps)if(c.route===route)caps.delete(id);for(const op of [...active])if(op.cap.route===route)op.cancel();}
 function endSession(session){for(const route of [...routes.values()])if(route.session===session)retire(route);ended.delete(session);}
 function endApp(appId){for(const route of [...routes.values()])if(route.appId===appId)retire(route);}
 function validLaunchId(id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw fail(400,'Invalid launch identity');}
 function cancellations(session){
  let state=ended.get(session);if(!state){state={ids:new Map(),cooldownUntil:0};ended.set(session,state);}
  for(const [id,expires] of state.ids)if(expires<=Date.now())state.ids.delete(id);
  return state;
 }
 function launch(session,data){
  if(!data||Object.keys(data).some(k=>!['appId','launchId'].includes(k)))throw fail(400,'Expected registered app and launch identity');
  const app=authority(session,data.appId);if(!session.manager.windows.has(app.id))throw fail(409,'Open the desktop window first');
  const launchId=data.launchId??secret();validLaunchId(launchId);
  const state=cancellations(session);
  if(state.cooldownUntil>Date.now())throw fail(429,'Gateway launch cooldown; retry after 60 seconds');
  if(state.ids.has(launchId))throw fail(409,'App session already ended');
  for(const route of [...routes.values()])if(route.session===session&&route.appId===app.id)retire(route);
  if(routes.size>=32||tickets.size>=64)throw fail(429,'Gateway route limit');
  const target=config.targets.find(t=>t.id===app.gateway.target),origin=`https://${randomBytes(16).toString('hex')}.${config.deployment?.appBaseDomain??'relay.test'}:${new URL(desktopOrigin).port}`;
  const route={origin,session,appId:app.id,app:target,definition:JSON.stringify(app),launchId,expires:Math.min(session.expires,Date.now()+3600000)};
  routes.set(new URL(origin).host,route);const ticket=secret();tickets.set(ticket,{route,expires:Date.now()+10000});
  return {origin,ticket,launchId,allowDownloads:target.allowDownloads,allowPopups:target.allowPopups};
 }
 function end(session,data){
  if(!data||Object.keys(data).some(k=>!['appId','launchId'].includes(k))||typeof data.appId!=='string')throw fail(400,'Invalid end request');
  authority(session,data.appId);validLaunchId(data.launchId);
  const state=cancellations(session);
  // Keep at most 512 cancellation identities per actual session, never globally.
  // Overflow cannot deny cleanup or evict a required marker: fail closed for all
  // launches in ONLY this session for the same 60s cancellation horizon. Further
  // overflow Ends renew that horizon; existing unrelated routes remain usable.
  if(state.ids.size>=512&&!state.ids.has(data.launchId))state.cooldownUntil=Date.now()+60000;
  else state.ids.set(data.launchId,Date.now()+60000);
  for(const route of [...routes.values()])if(route.session===session&&route.appId===data.appId&&route.launchId===data.launchId)retire(route);
  return {ended:true};
 }
 function closeWindow(session,appId){for(const route of [...routes.values()])if(route.session===session&&route.appId===appId)retire(route);}
 function getCap(req,route){const c=caps.get(cookie(req,'__Host-relay_cap'));if(!c||c.route!==route||c.expires<=Date.now())throw denied();current(route);return c;}
 function bridgeHeaders(req){
  const h={};for(const k of ['content-type','content-length','x-csrf-token','range','accept','sec-websocket-key','sec-websocket-version','upgrade','connection'])if(req.headers[k])h[k]=req.headers[k];
  const id=cookie(req,'__Host-relay_session');if(id)h.cookie='relay_session='+id;if(req.headers.origin)h.origin=relayOrigin;return h;
 }
 function bridge(req,res){
  const path=req.url.split('?')[0];
  if(!(path==='/'||/^\/(?:desktop(?:\/|$)|assets\/|fonts\/|api\/|native\/)/.test(path))||!['GET','HEAD','POST','PATCH','PUT','DELETE'].includes(req.method))throw denied();
  const up=http.request(relayOrigin+req.url,{method:req.method,headers:bridgeHeaders(req)},remote=>{
   const headers={...remote.headers};delete headers.connection;delete headers['transfer-encoding'];
   if(headers['set-cookie'])headers['set-cookie']=headers['set-cookie'].filter(c=>c.startsWith('relay_session=')).map(c=>c.replace(/^relay_session=/,'__Host-relay_session=')+'; Secure');
   res.writeHead(remote.statusCode,headers);remote.pipe(res);
  });up.on('error',()=>res.destroy());up.setTimeout(30000,()=>up.destroy());res.on('close',()=>up.destroy());req.on('error',()=>up.destroy());req.pipe(up);
 }
 async function handle(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const main=req.headers.host===new URL(desktopOrigin).host,route=routes.get(req.headers.host);
  if(!main&&!route)throw denied();const origin=main?desktopOrigin:route.origin;
  if((req.headers.origin&&req.headers.origin!==origin)||(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin))throw denied();
  if(main)return bridge(req,res);
  current(route);
  if(req.url==='/.relay/bootstrap'&&req.method==='GET'){
   const nonce=secret();res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors ${desktopOrigin}; base-uri 'none'; form-action 'none'`);
   res.end(`<!doctype html><p>Opening app…</p><script nonce="${nonce}">let used=false;addEventListener('message',e=>{if(used||e.origin!==${JSON.stringify(desktopOrigin)}||e.source!==parent||e.data?.type!=='relay-gateway-ticket'||typeof e.data.ticket!=='string')return;used=true;fetch('/.relay/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:e.data.ticket})}).then(r=>{if(r.ok)location.replace(${JSON.stringify(route.app.entryPath)});else document.body.textContent='Access denied';});});parent.postMessage({type:'relay-gateway-ready'},${JSON.stringify(desktopOrigin)});</script>`);return;
  }
  if(req.url==='/.relay/redeem'&&req.method==='POST'){
   let text='';for await(const chunk of req){text+=chunk;if(text.length>512)throw fail(413,'Ticket request too large');}
   let data;try{data=JSON.parse(text);}catch{throw denied();}
   if(!data||Object.keys(data).length!==1)throw denied();const t=tickets.get(data.ticket);
   if(!t||t.route!==route||t.expires<=Date.now())throw denied();tickets.delete(data.ticket);current(route);
   const id=secret();caps.set(id,{route,app:route.app,expires:route.expires});
   res.setHeader('Set-Cookie',`__Host-relay_cap=${id}; Path=/; HttpOnly; Secure; SameSite=Strict`);send(res,200,{ok:true});return;
  }
  return transport.proxy(req,res,getCap(req,route));
 }
 const server=https.createServer({key:config.key,cert:config.cert},(req,res)=>void handle(req,res).catch(e=>res.headersSent?res.destroy():send(res,e.status||400,{error:'Gateway request denied'})));
 server.on('connection',socket=>{bridgeSockets.add(socket);socket.on('close',()=>bridgeSockets.delete(socket));});
 server.on('upgrade',(req,socket,head)=>{
  socket.on('error',()=>{});
  try{
   if(req.headers.host===new URL(desktopOrigin).host){
    if(req.headers.origin!==desktopOrigin||!/^\/ws\/stream\/[a-z0-9-]+$/.test(req.url))throw denied();
    const up=http.request(relayOrigin+req.url,{headers:bridgeHeaders(req)});up.on('upgrade',(response,remote,remoteHead)=>{socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());remote.pipe(socket).pipe(remote);});up.on('response',()=>socket.destroy());up.on('error',()=>socket.destroy());up.setTimeout(5000,()=>up.destroy());socket.on('close',()=>up.destroy());up.end();return;
   }
   const route=routes.get(req.headers.host);if(!route||req.headers.origin!==route.origin)throw denied();transport.upgrade(req,socket,head,getCap(req,route));
  }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
 });
 server.maxConnections=64;server.headersTimeout=5000;server.requestTimeout=30000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.deployment?.bind??'127.0.0.1',resolve);});
 desktopOrigin=`https://${config.deployment?.desktopHostname??'desktop.relay.test'}:${server.address().port}`;
 transport=createTransport({active,desktopOrigin,stillAuthorized:async c=>{current(c.route);if(![...caps.values()].includes(c)||c.expires<=Date.now())throw denied();}});
 const timer=setInterval(()=>{
  for(const [id,t] of tickets)if(t.expires<=Date.now())tickets.delete(id);
  for(const r of [...routes.values()])try{current(r);if(r.expires<=Date.now()||![...tickets.values(),...caps.values()].some(v=>v.route===r))retire(r);}catch{retire(r);}
 },100).unref();
 return {desktopOrigin,available,validateDefinition,launch,end,endSession,endApp,closeWindow,stats:()=>({routes:routes.size,tickets:tickets.size,caps:caps.size,active:active.size}),async close(){clearInterval(timer);for(const r of [...routes.values()])retire(r);transport.close();for(const socket of bridgeSockets)socket.destroy();await new Promise(r=>server.close(r));}};
}
