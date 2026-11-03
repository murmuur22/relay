// Experimental fixed-destination gateway transport with bounded HTTP(S)/WS(S).
import http from 'node:http';
import https from 'node:https';
import {randomBytes} from 'node:crypto';
import {Transform,pipeline} from 'node:stream';
import {WebSocket,WebSocketServer} from 'ws';
import {FORGET_PATH,forgetCredential,profileHeaders,loginMatch,captureCredential,validateProfile} from './experimental-gateway-profile.mjs';
const fail=status=>Object.assign(Error('Request denied'),{status});
const REQUEST_LIMIT=1024*1024,RESPONSE_LIMIT=64*1024*1024,WS_LIMIT=65536;
const protocolToken=value=>typeof value==='string'&&value.length>=1&&value.length<=64&&/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value);
const selectedProtocol=Symbol('verified upstream protocol');
export function validateApp(app){
 if(app.maxRequestBytes===undefined)app.maxRequestBytes=REQUEST_LIMIT;
 if(!Number.isSafeInteger(app.maxRequestBytes)||app.maxRequestBytes<REQUEST_LIMIT||app.maxRequestBytes>64*1024*1024)throw Error('Invalid request bound');
 if(app.maxResponseBytes===undefined)app.maxResponseBytes=RESPONSE_LIMIT;
 if(!Number.isSafeInteger(app.maxResponseBytes)||app.maxResponseBytes<1024*1024||app.maxResponseBytes>1024*1024*1024)throw Error('Invalid response bound');
 app.authProfile=validateProfile(app.authProfile);
 const safeHeader=n=>typeof n==='string'&&/^(?:x-[a-z0-9-]+|tus-resumable|upload-(?:length|offset|metadata|expires))$/.test(n)&&!/^x-(forwarded|real-|relay-|proof-|remote-|auth-request|original-)/.test(n);
 for(const key of ['requestHeaders','responseHeaders']){app[key]??=[];if(!Array.isArray(app[key])||app[key].length>16||app[key].some(n=>!safeHeader(n)))throw Error('Unsafe configured header');}
 app.cookieNames??=[];if(!Array.isArray(app.cookieNames)||app.cookieNames.length>16||app.cookieNames.some(n=>! /^[a-zA-Z0-9_-]+$/.test(n)||/^(?:proof_|relay|__Host-|__Secure-)/i.test(n)))throw Error('Unsafe cookie name');
 app.webSocketPaths??=[];if(!Array.isArray(app.webSocketPaths)||app.webSocketPaths.length>16||app.webSocketPaths.some(p=>!/^\/[a-zA-Z0-9/_.-]+$/.test(p)))throw Error('Unsafe WebSocket paths');
 if(app.accessPolicy===undefined)app.accessPolicy='granted';
 if(!['granted','admin-only'].includes(app.accessPolicy))throw Error('Unsafe gateway access policy');
 if(app.presentation===undefined)app.presentation='frame';
 if(!['frame','tab'].includes(app.presentation))throw Error('Unsafe gateway presentation');
 if(app.httpOrigin===undefined)app.httpOrigin='omit';
 if(!['omit','upstream'].includes(app.httpOrigin))throw Error('Unsafe HTTP Origin policy');
 if(app.webSocketOrigin===undefined)app.webSocketOrigin='omit';
 if(!['omit','upstream'].includes(app.webSocketOrigin))throw Error('Unsafe WebSocket Origin policy');
 if(app.webSocketProtocols===undefined)app.webSocketProtocols=[];
 if(!Array.isArray(app.webSocketProtocols)||app.webSocketProtocols.length>8||app.webSocketProtocols.some(p=>!protocolToken(p))||new Set(app.webSocketProtocols).size!==app.webSocketProtocols.length)throw Error('Unsafe WebSocket protocols');
 app.entryPath??='/';if(!validPath(app.entryPath)||!/^\/[a-zA-Z0-9/_-]*(?:\.html)?$/.test(app.entryPath))throw Error('Unsafe entry path');
 for(const k of ['allowDownloads','allowPopups']){app[k]??=false;if(typeof app[k]!=='boolean')throw Error('Unsafe permission');}
}
export function validPath(path){return typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//')&&!/[\\\r\n]/.test(path)&&path.length<=8192;}
function headers(req,c){
 const result={};for(const k of ['range','content-type','content-length','authorization','accept',...c.app.requestHeaders])if(req.headers[k])result[k]=req.headers[k];
 const jar=c.route.jar??=new Map(),pairs=[];
 for(const name of c.app.cookieNames){if(name===c.app.authProfile?.cookie)continue;const stored=jar.get(name);if(stored&&stored.expires<=Date.now())jar.delete(name);const value=jar.get(name)?.value;if(value!==null&&value!==undefined)pairs.push(name+'='+value);}
 if(pairs.length)result.cookie=pairs.join('; ');profileHeaders(result,c);return result;
}
function storeCookies(c,lines=[]){
 for(const line of lines.slice(0,16)){
  if(line.length>4096)continue;const [pair,...parts]=line.split(';').map(x=>x.trim()),index=pair.indexOf('='),name=pair.slice(0,index),value=pair.slice(index+1);
  if(index<1||name===c.app.authProfile?.cookie||!c.app.cookieNames.includes(name)||/[^\x21-\x7e]|[;,]/.test(value))continue;
  const attrs=new Map(parts.map(p=>{const i=p.indexOf('=');return i<0?[p.toLowerCase(),'']:[p.slice(0,i).toLowerCase(),p.slice(i+1)];}));
  // Narrow server-private jar: root-path host cookies only. No browser Set-Cookie forwarding.
  if(attrs.has('domain')||attrs.get('path')!=='/')continue;
  let expires=c.expires;if(attrs.has('max-age')){if(!/^-?\d+$/.test(attrs.get('max-age')))continue;expires=Math.min(expires,Date.now()+Number(attrs.get('max-age'))*1000);}else if(attrs.has('expires')){const n=Date.parse(attrs.get('expires'));if(!Number.isFinite(n))continue;expires=Math.min(expires,n);}
  const jar=c.route.jar??=new Map();if(expires<=Date.now())jar.delete(name);else jar.set(name,{value,expires});
 }
}
function uploadTooLarge(req,res,c,desktopOrigin,fromUpstream=false,upstreamHeaders={}){
 // Never interpolate request paths, headers, upstream bodies or route credentials.
 const limit=c.app.maxRequestBytes??REQUEST_LIMIT;
 const message=fromUpstream?'The upstream application rejected this upload. Its limit may be lower than Relay’s.':`The complete request exceeds this target’s ${limit} byte limit (${limit/(1024*1024)} MiB), including form overhead.`;
 const recovery='Use Back to return to the form, choose a smaller attachment, and submit again. Do not reload this response or automatically resend the upload. Unsaved text may need to be re-entered. If Back cannot restore the form, reopen the app from Relay.';
 const html=req.headers['sec-fetch-mode']==='navigate'||/\btext\/html\b/i.test(req.headers.accept??'');
 const headers={};
 for(const name of ['content-security-policy','content-security-policy-report-only','x-frame-options','permissions-policy','cross-origin-opener-policy','cross-origin-embedder-policy','cross-origin-resource-policy','strict-transport-security'])if(upstreamHeaders[name])headers[name]=upstreamHeaders[name];
 const policy=`default-src 'none'; frame-ancestors ${c.app.presentation==='tab'?"'self'":desktopOrigin}; base-uri 'none'; form-action 'none'`;
 headers['content-security-policy']=[...(headers['content-security-policy']?[headers['content-security-policy']]:[]),policy];
 req.pause();res.shouldKeepAlive=false;
 res.writeHead(413,{...headers,'Connection':'close','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Type':html?'text/html; charset=utf-8':'application/json; charset=utf-8'});
 res.end(html?`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Upload too large</title><h1>Upload too large</h1><p>${message}</p><p>${recovery}</p></html>`:JSON.stringify({error:'Upload too large',code:fromUpstream?'upstream_request_too_large':'request_too_large',...(!fromUpstream?{maxRequestBytes:limit}:{}),message,recovery}));
}
export function createTransport({active,desktopOrigin,stillAuthorized=async()=>{throw Error('No live authority check');}}){
 const stats={http:0,ranges:0,websockets:0,cancelled:0};
 const wss=new WebSocketServer({noServer:true,maxPayload:WS_LIMIT,perMessageDeflate:false,handleProtocols:(_offered,req)=>req[selectedProtocol]||false});
 function proxy(req,res,c){
  if(!validPath(req.url))throw fail(400);
  const site=req.headers['sec-fetch-site'];
  const directNavigation=site==='none'&&req.method==='GET'&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
  if(site!=='same-origin'&&!directNavigation)throw fail(403);
  if(!['GET','HEAD','POST','DELETE','PUT','PATCH'].includes(req.method)||(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==c.route.origin))throw fail(403);
  const p=c.app.authProfile;
  if(p&&req.url===FORGET_PATH){
   if(req.method==='GET'){
    const nonce=randomBytes(16).toString('hex');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`});
    res.end(`<!doctype html><title>Experimental gateway forget</title><p>This clears the server-private app credential. It does not revoke the upstream token or erase browser storage. An app-only Logout may not clear this credential.</p><button>Forget private app credential</button><p id="result" role="status"></p><script nonce="${nonce}">document.querySelector('button').onclick=async()=>{const r=await fetch('/.relay/forget',{method:'POST'});document.querySelector('#result').textContent=r.status===204?'Private credential forgotten':'Forget denied';};</script>`);return;
   }
   if(req.method!=='POST')throw fail(405);forgetCredential(c.route);req.resume();res.writeHead(204);res.end();return;
  }
  const capture=p&&loginMatch(req,p);
  if(capture)forgetCredential(c.route);
  const generation=c.route.authGeneration;
  if(active.size>=32)throw fail(429);
  const h=headers(req,c);
  // Assert only the validated fixed upstream origin, after external Origin,
  // fetch-metadata and live route/capability authority checks. Never a Referer.
  // GET/HEAD keep legacy omission; WebSockets have their independent policy.
  if(c.app.httpOrigin==='upstream'&&!['GET','HEAD'].includes(req.method))h.origin=new URL(c.app.upstream).origin;
  const requestLimit=c.app.maxRequestBytes??REQUEST_LIMIT;
  if(Number(h['content-length']||0)>requestLimit)return uploadTooLarge(req,res,c,desktopOrigin);
  if(p?.logout&&req.method===p.logout.method&&req.url===p.logout.path)forgetCredential(c.route);
  if(h.range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(h.range))throw fail(416);
  stats.http++;if(h.range)stats.ranges++;
  let remote,finished=false,loginDeadline,requestDeadline,bound,requestDone;
  const requestComplete=new Promise(resolve=>requestDone=resolve);
  function stopRequest(){clearTimeout(requestDeadline);req.unpipe(bound);req.pause();bound?.unpipe();bound?.destroy();requestDone(false);}
  function upstreamClosed(){
   if(finished)return;
   if(!remote||(remote.destroyed&&!remote.complete))return badGateway();
   if(req.readableEnded)return; // Normal completed responses also close up.
   // A final response can close the outgoing request before client EOF. Keep
   // counting through the SAME limiter, but discard its bounded output locally:
   // no blocked destination, whole-body buffer, or unlimited request drain.
   // Overflow still stops the source immediately; requestDeadline bounds a
   // client that never ends, even after the upstream socket timer disappears.
   bound.unpipe(up);bound.resume();
  }
  function tooLarge(fromUpstream=false,out){
   if(finished)return;finished=true;clearTimeout(loginDeadline);active.delete(op);stopRequest();up.destroy();remote?.destroy();
   if(res.headersSent){res.destroy();return;}
   uploadTooLarge(req,res,c,desktopOrigin,fromUpstream,out);
  }
  function badGateway(){
   if(finished)return;finished=true;clearTimeout(loginDeadline);active.delete(op);stopRequest();up.destroy();remote?.destroy();
   if(res.headersSent){res.destroy();return;}
   res.shouldKeepAlive=false;res.writeHead(502,{'Connection':'close','Content-Type':'text/plain'});res.end('Bad gateway');
  }
  const up=(c.app.upstream.startsWith('https:')?https:http).request(c.app.upstream+req.url,{method:req.method,headers:h,maxHeaderSize:16384,ca:c.app.tls?.ca,servername:c.app.tls?.serverName,rejectUnauthorized:true},async r=>{
   remote=r;
   try{
   const out={};
   // Passive transport evidence belongs only to this live session/app route.
   // A received response is reachability, never proof of login or app readiness.
   c.route.observation={state:r.statusCode>=200&&r.statusCode<400?'Online':'Reached',source:'relay',checkedAt:Date.now(),httpStatus:r.statusCode,detail:`Gateway upstream received HTTP ${r.statusCode}; not a readiness or authenticated-health check.`};
   for(const name of ['content-type','content-length','content-range','accept-ranges','content-encoding','etag','last-modified','content-security-policy','content-security-policy-report-only','x-frame-options','x-content-type-options','referrer-policy','permissions-policy','cross-origin-opener-policy','cross-origin-embedder-policy','cross-origin-resource-policy','strict-transport-security','content-disposition',...c.app.responseHeaders])if(r.headers[name])out[name]=r.headers[name];
   if(r.statusCode===413)return tooLarge(true,out);
   // Hold (do not buffer) an early response until the whole request has passed
   // the streaming bound, so an early upstream 200 cannot mask upload overflow.
   r.on('error',badGateway);
   if(!req.readableEnded)requestDeadline=setTimeout(badGateway,30000).unref();
   if(!await requestComplete||finished)return;
   if(Number(out['content-length']||0)>(c.app.maxResponseBytes??RESPONSE_LIMIT))return badGateway();
   if(r.headers.location){const target=new URL(r.headers.location,c.app.upstream+req.url);if(target.origin!==c.app.upstream||target.username||target.password||!validPath(target.pathname+target.search+target.hash))return badGateway();out.location=c.route.origin+target.pathname+target.search+target.hash;}
   // Additional policy intersects upstream policy; never delete/weaken upstream CSP/XFO.
   // Executable app code stays on its app+session origin, not Relay's auth origin.
   const policy=`default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ${c.route.origin.replace('https:','wss:')}; frame-src 'self'; frame-ancestors ${c.app.presentation==='tab'?"'self'":desktopOrigin}; form-action 'self'; base-uri 'self'; object-src 'none'; worker-src 'none'`;
   out['content-security-policy']=[...(out['content-security-policy']?[out['content-security-policy']]:[]),policy];
   if(c.app.presentation==='tab')out['content-security-policy'].push('sandbox allow-scripts allow-same-origin allow-forms'+(c.app.allowDownloads?' allow-downloads':'')+(c.app.allowPopups?' allow-popups':''));
   if(capture&&r.statusCode===p.login.status){
    const data=await captureCredential(r,c,generation,async cap=>{await stillAuthorized(cap);if(finished)throw Error('Cancelled login');});
    res.writeHead(r.statusCode,out);res.end(data);finished=true;clearTimeout(loginDeadline);active.delete(op);up.destroy();return;
   }
   if(r.headers['set-cookie']&&c.route.authGeneration===generation){
    await stillAuthorized(c);
    if(!finished&&c.expires>Date.now()&&c.route.authGeneration===generation)storeCookies(c,r.headers['set-cookie']);
   }
   if(finished)return;
   res.writeHead(r.statusCode,out);
   let bytes=0;const bound=new Transform({transform(chunk,encoding,cb){bytes+=chunk.length;cb(bytes>(c.app.maxResponseBytes??RESPONSE_LIMIT)?Error('Response bound'):null,chunk);}});
   pipeline(r,bound,res,()=>{finished=true;clearTimeout(loginDeadline);active.delete(op);up.destroy();});
   }catch{badGateway();}
  });
  const op={cap:c,cancel:()=>{if(finished)return;stats.cancelled++;finished=true;clearTimeout(loginDeadline);active.delete(op);stopRequest();up.destroy();remote?.destroy();res.destroy();}};
  if(capture)loginDeadline=setTimeout(badGateway,5000).unref();
  active.add(op);up.on('error',e=>{
   // Only a write-side closure after a final response can switch to discard;
   // response read errors and all other upstream failures still fail closed.
   if(remote&&['EPIPE','ECONNRESET','ERR_STREAM_DESTROYED'].includes(e.code))upstreamClosed();else badGateway();
  });up.on('close',upstreamClosed);up.setTimeout(30000,badGateway);res.on('close',op.cancel);
  // Do not pipeline the client IncomingMessage: pipeline destroys its socket on
  // overflow before a useful 413 can be flushed. Retain bounded backpressure,
  // pause/unpipe on failure and close the connection instead of draining a body.
  let bytes=0;bound=new Transform({transform(chunk,encoding,cb){bytes+=chunk.length;cb(bytes>requestLimit?fail(413):null,chunk);}});
  bound.on('error',e=>e.status===413?tooLarge():op.cancel());
  req.on('error',op.cancel);req.once('aborted',op.cancel);req.once('end',()=>{clearTimeout(requestDeadline);requestDone(true);});
  req.pipe(bound).pipe(up);
 }
 function upgrade(req,socket,head,c){
  if(!validPath(req.url)||!c.app.webSocketPaths.includes(new URL(req.url,c.app.upstream).pathname))throw fail(403);
  // Require every offered token to be declared; never filter an unsafe offer into
  // a different negotiation. An explicit nonempty policy also forbids downgrade.
  const raw=req.headers['sec-websocket-protocol'],allowed=c.app.webSocketProtocols??[];
  if(raw!==undefined&&(typeof raw!=='string'||raw.length>8*66))throw fail(403);
  const offered=raw===undefined?[]:raw.split(',').map(p=>p.trim());
  if(offered.length>8||offered.some(p=>!protocolToken(p)||!allowed.includes(p))||new Set(offered).size!==offered.length||(!offered.length&&allowed.length))throw fail(403);
  if(active.size>=32)throw fail(429);
  const remote=new WebSocket(c.app.upstream.replace(/^http/,'ws')+req.url,offered,{headers:headers(req,c),origin:c.app.webSocketOrigin==='upstream'?new URL(c.app.upstream).origin:undefined,ca:c.app.tls?.ca,servername:c.app.tls?.serverName,rejectUnauthorized:true,followRedirects:false,handshakeTimeout:2000,maxPayload:WS_LIMIT,perMessageDeflate:false});let peer,stopped=false;
  const op={cap:c,cancel:()=>{if(stopped)return;stopped=true;stats.cancelled++;active.delete(op);remote.terminate();peer?.terminate();socket.destroy();}};
  active.add(op);socket.on('close',op.cancel);remote.on('error',op.cancel);remote.on('close',op.cancel);
  remote.on('open',async()=>{
   try{
    if(stopped)return;
    if(offered.length?!offered.includes(remote.protocol):remote.protocol!=='')return op.cancel();
    await stillAuthorized(c);
    if(stopped||c.expires<=Date.now())return op.cancel();
    req[selectedProtocol]=remote.protocol;
    stats.websockets++;
    wss.handleUpgrade(req,socket,head,client=>{peer=client;client.on('error',op.cancel);client.on('close',op.cancel);client.on('message',(data,binary)=>{if(remote.readyState!==1||remote.bufferedAmount>WS_LIMIT)return op.cancel();remote.send(data,{binary});});remote.on('message',(data,binary)=>{if(client.readyState!==1||client.bufferedAmount>WS_LIMIT)return op.cancel();client.send(data,{binary});});});
   }catch{op.cancel();}
  });
 }
 return {proxy,upgrade,stats,close(){wss.close();}};
}
