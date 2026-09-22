import {fail} from './accounts.mjs';
export const RUNTIME_URL_LIMIT=32768;
export function webURL(value,maxLength=2048){
 if(typeof value!=='string'||value.length>maxLength||!/^https?:\/\//i.test(value)||value!==value.trim())throw fail(400,'Enter an explicit absolute HTTP or HTTPS address.');
 let u;try{u=new URL(value);}catch{throw fail(400,'Invalid address or port.');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||value.includes('#'))throw fail(400,'HTTP(S) only; credentials and fragments are not allowed.');
 return u;
}
export function webConfig(body){
 if(body?.mode==='gateway'){
  if(Object.keys(body).some(k=>!['id','kind','mode','label','gateway','icon','openMode','allowedOrigins','enabled','description','userIds'].includes(k))||['enabled','icon','openMode'].some(k=>k in body&&body[k]===null))throw fail(400,'Invalid experimental gateway fields');
  const g=body.gateway;
  if(body.kind!=='web'||typeof body.label!=='string'||!body.label.trim()||body.label.length>64||!g||typeof g!=='object'||Array.isArray(g)||Object.keys(g).length!==1||typeof g.target!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(g.target)||'address' in body||('openMode' in body&&body.openMode!=='window')||('allowedOrigins' in body&&(!Array.isArray(body.allowedOrigins)||body.allowedOrigins.length))||!['globe','folder','notes','media','terminal'].includes(body.icon??'globe')||typeof (body.enabled??true)!=='boolean')throw fail(400,'Invalid experimental gateway app');
  return {kind:'web',mode:'gateway',label:body.label.trim(),gateway:{target:g.target},icon:body.icon??'globe',openMode:'window',enabled:body.enabled??true,description:'Experimental private gateway. End app session or Close clears gateway identity; app Logout may not.'};
 }
 if(body&&'gateway' in body)throw fail(400,'Gateway configuration requires gateway mode');
 if(!body||typeof body!=='object'||['enabled','icon','openMode','allowedOrigins'].some(k=>k in body&&body[k]===null))throw fail(400,'Invalid app fields');
 if(body.kind!=='web'||!['native','stream'].includes(body.mode)||typeof body.label!=='string'||!body.label.trim()||body.label.length>64||!['globe','folder','notes','media','terminal'].includes(body.icon??'globe')||!['window','tab'].includes(body.openMode??'window')||typeof (body.enabled??true)!=='boolean')throw fail(400,'Invalid app fields');
 const address=webURL(body.address).href;
 if(!Array.isArray(body.allowedOrigins??[])||(body.allowedOrigins??[]).length>16)throw fail(400,'Invalid approved origins');
 const allowedOrigins=[...new Set((body.allowedOrigins??[]).map(value=>{const u=webURL(value);if(u.pathname!=='/'||u.search)throw fail(400,'Approved origins must not include paths or queries');return u.origin;}))];
 return {kind:'web',mode:body.mode,label:body.label.trim(),address,icon:body.icon??'globe',openMode:body.openMode??'window',enabled:body.enabled??true,allowedOrigins,description:body.mode==='stream'?'Isolated ephemeral browser; WebSockets and file transfers unsupported.':'Opens on your device; Relay permissions control this launcher, not the upstream site.'};
}
export function publicApp(a){if(a.kind!=='web')return a;const {id,label,mode,enabled,kind,icon,openMode,description}=a;return {id,label,mode,enabled,kind,icon,openMode,description,...(mode==='native'?{url:a.address}:{})};}
