import http from 'node:http';
import {networkInterfaces} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {isAbsolute,resolve,extname,sep} from 'node:path';
import {brokerRequest,loopbackOrigin,networkHost,capability,actionFields} from './broker-client.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const random=()=>randomBytes(32).toString('hex');
const digest=value=>createHash('sha256').update(value).digest('hex');
function cookie(req,name){const values=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));return values.length===1?values[0].slice(name.length+1):null;}
function expiry(value){const n=typeof value==='number'?(value<1e12?value*1000:value):Date.parse(value);return Number.isFinite(n)?Math.min(n,Date.now()+8*3600000):0;}
async function body(req){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'JSON required');
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)throw fail(413,'Request too large');chunks.push(chunk);}let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'Invalid JSON');}if(!value||typeof value!=='object'||Array.isArray(value))throw fail(400,'JSON object required');return value;
}
// Fixed validated operator target; no redirects, external DNS or caller URL.
function relayRequest(origin,path,cookieValue,method='GET',data,csrf){
 const url=new URL(origin+path),text=data?JSON.stringify(data):null;
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:url.hostname==='localhost'?'127.0.0.1':url.hostname,port:url.port||80,path:url.pathname,method,headers:{Host:url.host,Origin:origin,Cookie:'relay_session='+cookieValue,...(csrf?{'X-CSRF-Token':csrf}:{}),...(text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{})}},res=>{let size=0,chunks=[];res.on('data',c=>{size+=c.length;if(size>1048576){res.destroy();return;}chunks.push(c);});res.on('error',()=>finish(fail(503,'Relay unavailable. Sign in to Relay again before changing updates.')));res.on('end',()=>{if(res.statusCode!==200)return finish(fail([400,401,403,429,503].includes(res.statusCode)?res.statusCode:503,res.statusCode===403?'Reauthentication rejected. Check your password and administrator access.':'Relay unavailable or session expired. Sign in to Relay again.'));try{finish(null,JSON.parse(Buffer.concat(chunks)));}catch{finish(fail(503,'Invalid Relay response'));}});});
  let done=false;const timer=setTimeout(()=>{req.destroy();finish(fail(503,'Relay unavailable. Sign in to Relay again.'));},10000);function finish(error,result){if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);}
  req.on('error',()=>finish(fail(503,'Relay unavailable. Sign in to Relay again.')));req.end(text);
 });
}
export async function createUpdaterWeb({uiOrigin,relayOrigin,socketPath,networkMode='loopback',bind='127.0.0.1',staticDir=fileURLToPath(new URL('../ui/dist/',import.meta.url))}={}){
 const ui=loopbackOrigin(uiOrigin,networkMode),relay=loopbackOrigin(relayOrigin,networkMode);
 if(bind!==networkHost(ui.hostname,networkMode)||ui.hostname!==relay.hostname||ui.origin===relay.origin||typeof socketPath!=='string'||!isAbsolute(socketPath)||!isAbsolute(staticDir))throw Error('Invalid updater web configuration');
 if(networkMode==='private-lan'&&!Object.values(networkInterfaces()).flat().some(n=>n.family==='IPv4'&&!n.internal&&n.address===bind))throw Error('Private LAN IPv4 must be assigned to this host');
 const sessions=new Map(),rates=new Map();let active=0;
 const prune=()=>{for(const [id,s] of sessions)if(s.expires<=Date.now())sessions.delete(id);};
 const rate=key=>{let r=rates.get(key);if(!r||r.until<Date.now()){r={count:0,until:Date.now()+60000};rates.set(key,r);}if(++r.count>(key==='read'?1800:key==='exchange'?20:60))throw fail(429,'Updater request rate limited');};
 const call=(action,params)=>brokerRequest(socketPath,{action,params});
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(active>=16){send(429,{error:'Updater busy'});req.resume();return;}active++;
  try{
   if(req.headers.host!==ui.host||(req.headers.origin&&req.headers.origin!==uiOrigin))throw fail(403,'Invalid Host or Origin');
   if(req.url.length>2048||!req.url.startsWith('/updater/'))throw fail(404,'Not found');const url=new URL(req.url,uiOrigin);if(url.search)throw fail(400,'Query parameters are not supported');
   const path=url.pathname;prune();const id=cookie(req,'relay_updater_session'),s=id?sessions.get(digest(id)):null;
   if(path.startsWith('/updater/api/')){
    if(!['GET','POST'].includes(req.method))throw fail(405,'Method not allowed');
    const mutation=req.method==='POST';rate(mutation?(path.endsWith('/exchange')?'exchange':'write'):'read');
    if(mutation&&req.headers.origin!==uiOrigin)throw fail(403,'Exact Origin required');
    if(path==='/updater/api/auth'&&!mutation){send(200,s?{authenticated:true,csrf:s.csrf,interfaceAnimations:s.interfaceAnimations,relayOrigin}:{authenticated:false,relayOrigin});return;}
    if(path==='/updater/api/exchange'&&mutation){
     const data=await body(req);if(Object.keys(data).length!==1||!capability(data.ticket))throw fail(400,'Invalid launch ticket');if(sessions.size>=64)throw fail(429,'Updater session limit');
     const result=await call('redeem-ui',{ticket:data.ticket,origin:uiOrigin});data.ticket='';const expires=expiry(result.expiresAt);if(!capability(result.token)||expires<=Date.now()||typeof result.interfaceAnimations!=='boolean'||typeof result.userId!=='string')throw fail(503,'Invalid updater session');
     const next=random(),session={token:result.token,expires,userId:result.userId,csrf:random(),interfaceAnimations:result.interfaceAnimations};if(id)sessions.delete(digest(id));sessions.set(digest(next),session);
     res.setHeader('Set-Cookie',`relay_updater_session=${next}; Path=/updater/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1,Math.floor((expires-Date.now())/1000))}`);send(200,{csrf:session.csrf,interfaceAnimations:session.interfaceAnimations});return;
    }
    if(!s)throw fail(401,'Launch Updater from your administrator desktop.');
    if(mutation&&req.headers['x-csrf-token']!==s.csrf)throw fail(403,'CSRF required');
    if(path==='/updater/api/state'&&!mutation){send(200,await call('state',{token:s.token}));return;}
    if(!mutation)throw fail(404,'Not found');const data=await body(req);
    if(path==='/updater/api/logout'){if(Object.keys(data).length)throw fail(400,'Expected empty body');sessions.delete(digest(id));res.setHeader('Set-Cookie','relay_updater_session=; Path=/updater/; HttpOnly; SameSite=Strict; Max-Age=0');send(200,{ok:true});return;}
    if(path==='/updater/api/check'){if(Object.keys(data).length)throw fail(400,'Expected empty body');send(200,await call('check',{token:s.token}));return;}
    const action=path.slice('/updater/api/'.length);if(!['install','cancel','rollback'].includes(action))throw fail(404,'Not found');
    if('action'in data)throw fail(400,'Unexpected action field');const fields=actionFields(data,action),relayCookie=cookie(req,'relay_session');if(!relayCookie||!capability(relayCookie))throw fail(401,'Sign in to Relay again before changing updates.');
    let auth;try{
     const current=await relayRequest(relayOrigin,'/api/session',relayCookie);
     if(current.user?.role!=='admin'||current.user.mustChange||current.user.disabled||!capability(current.csrf))throw fail(403,'Active Relay administrator session required');
     auth=await relayRequest(relayOrigin,'/api/updater/authorize',relayCookie,'POST',{...fields,password:data.password,confirmed:true},current.csrf);
    }finally{data.password='';}
    if(!capability(auth.authorization))throw fail(503,'Invalid Relay authorization');if(sessions.get(digest(id))!==s||s.expires<=Date.now())throw fail(401,'Updater session expired');
    const {action:ignored,...target}=fields;send(200,await call(action==='install'?'start':action,{token:s.token,authorization:auth.authorization,...target}));return;
   }
   if(!['GET','HEAD'].includes(req.method))throw fail(405,'Method not allowed');
   let rel;try{rel=decodeURIComponent(path.slice('/updater/'.length));}catch{throw fail(400,'Invalid path');}if(!rel)rel='index.html';if(rel.includes('\\')||rel.includes('\0')||rel.split('/').some(s=>s==='..'||s.startsWith('.')))throw fail(404,'Not found');
   const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'};const type=types[extname(rel)];if(!type)throw fail(404,'Not found');
   let bytes;try{const base=await realpath(staticDir),file=await realpath(resolve(base,rel));if(!file.startsWith(base+sep))throw Error();const info=await stat(file);if(!info.isFile()||info.size>8*1024*1024)throw Error();bytes=await readFile(file);}catch{throw fail(404,'Updater UI not built or asset unavailable');}
   res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){if(!res.headersSent)send(error.status||503,{error:error.status?error.message:'Updater unavailable'});else res.destroy();req.resume();}finally{active--;}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.timeout=20000;server.keepAliveTimeout=2000;server.maxConnections=64;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(ui.port||80),bind,resolve);});
 return {server,origin:uiOrigin,close:()=>new Promise(resolve=>{sessions.clear();server.close(resolve);server.closeAllConnections();})};
}
