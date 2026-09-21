import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {networkInterfaces} from 'node:os';
import {webURL,RUNTIME_URL_LIMIT} from './webapps.mjs';
import {fail} from './accounts.mjs';
const host=u=>u.hostname.replace(/^\[|\]$/g,'');
function ipv4(a){const p=a.split('.').map(Number);return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255)?p:null;}
export function safeIP(address){
 if(isIP(address)===6)address=new URL(`http://[${address}]/`).hostname.slice(1,-1);
 if(['168.63.129.16','100.100.100.200','fd00:ec2::254'].includes(address.toLowerCase()))return false;
 // CGNAT unicast includes legitimate Tailnet destinations; deny metadata specifically.
 const p=ipv4(address);if(p)return !(p[0]===0||p[0]===169&&p[1]===254||p[0]>=224||p[0]===198&&(p[1]===18||p[1]===19));
 if(isIP(address)!==6)return false;
 const a=address.toLowerCase();
 // Conservatively admit global unicast, ULA and exact loopback only. IPv4-mapped,
 // translation/tunnel, link-local, multicast and unspecified ranges fail closed.
 return a==='::1'||/^[23][0-9a-f]{3}:/.test(a)&&!/^2001:(?:0:|:)/.test(a)&&!a.startsWith('2002:')||/^f[cd][0-9a-f]{2}:/.test(a);
}
export function cleanHeaders(headers){const banned=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','content-length']);for(const key of String(headers.connection||'').split(','))banned.add(key.trim().toLowerCase());return Object.fromEntries(Object.entries(headers).filter(([k,v])=>v!==undefined&&!banned.has(k.toLowerCase())));}
export class Transport{
 constructor({gatewayOrigin,lookup:resolve=lookup,dnsTimeout=2500}={}){this.dnsTimeout=dnsTimeout;this.gateway=gatewayOrigin?new URL(gatewayOrigin):null;this.lookup=resolve;this.active=new Set();this.pending=0;this.closed=false;this.local=new Set(['127.0.0.1','::1',...Object.values(networkInterfaces()).flat().map(i=>i.address)]);}
 async resolve(hostname){let timer;try{return await Promise.race([this.lookup(hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(400,'DNS lookup timed out')),this.dnsTimeout);})]);}finally{clearTimeout(timer);}}
 registration(value,policy,maxLength=2048){const u=webURL(value,maxLength);if(policy){const approved=[webURL(policy.address).origin,...(policy.allowedOrigins||[]).map(v=>webURL(v).origin)];if(!approved.includes(u.origin))throw fail(400,'Destination origin is not approved');}
  const hostname=host(u);if(isIP(hostname)&&!safeIP(hostname))throw fail(400,'Destination network is not allowed');
  if(this.gateway&&Number(u.port||(u.protocol==='https:'?443:80))===Number(this.gateway.port)&&(this.local.has(hostname)||hostname.startsWith('127.')||/^localhost\.?$/i.test(hostname)))throw fail(400,'Relay cannot be registered as an upstream app');
  return u;
 }
 async validate(value,policy){const u=this.registration(value,policy,RUNTIME_URL_LIMIT);
 const hostname=host(u);const records=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await this.resolve(hostname);
 if(!records.length||records.some(r=>!safeIP(r.address)))throw fail(400,'Destination network is not allowed');
 if(this.gateway&&Number(u.port||(u.protocol==='https:'?443:80))===Number(this.gateway.port)&&records.some(r=>this.local.has(r.address)||r.address.startsWith('127.')))throw fail(400,'Relay cannot be registered as an upstream app');
 return {u,record:records[0]};
 }
 async request(value,policy,{method='GET',headers={},body,maxBytes=4*1024*1024,timeout=5000,signal}={}){
 signal?.throwIfAborted();if(this.closed||this.pending>=24)throw fail(429,'Transport busy');if(body&&body.length>1024*1024)throw fail(400,'Request body too large');this.pending++;
 let timer;const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();timer=setTimeout(abort,timeout);this.active.add(controller);
 try{
 const {u,record}=await Promise.race([this.validate(value,policy),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(fail(400,'Upstream timed out')),{once:true}))]);
 if(controller.signal.aborted)throw fail(400,'Upstream timed out');
 return await new Promise((resolve,reject)=>{const req=(u.protocol==='https:'?https:http).request(u,{method,headers:{...cleanHeaders(headers),'accept-encoding':'identity'},agent:false,signal:controller.signal,lookup:(_hostname,options,cb)=>options.all?cb(null,[record]):cb(null,record.address,record.family),servername:isIP(host(u))?undefined:host(u),rejectUnauthorized:true},res=>{
 const chunks=[];let size=0;res.on('error',reject);res.on('aborted',()=>reject(fail(400,'Upstream response interrupted')));
 if(method==='HEAD'){resolve({status:res.statusCode,headers:cleanHeaders(res.headers),body:Buffer.alloc(0)});res.destroy();return;}
 res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){const error=fail(400,'Upstream response too large');reject(error);req.destroy(error);return;}chunks.push(chunk);});
 res.on('end',()=>resolve({status:res.statusCode,headers:cleanHeaders(res.headers),body:Buffer.concat(chunks)}));
 });req.on('error',reject);req.end(body);});
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.active.delete(controller);this.pending--;}
 }
 async probe(config,{signal}={}){try{const r=await this.request(config.address,config,{method:'HEAD',timeout:2500,signal});return {state:r.status>=200&&r.status<400?'Online':'Unknown',source:'relay',checkedAt:Date.now(),detail:r.status>=300&&r.status<400?'Relay received a redirect; destination not followed.':`Relay received HTTP ${r.status}; device reachability may differ.`,httpStatus:r.status};}catch(e){return {state:e.status?'Unknown':'Offline',source:'relay',checkedAt:Date.now(),detail:e.status?e.message:'No bounded HTTP response from Relay.'};}}
 async close(){this.closed=true;for(const c of this.active)c.abort();}
}
