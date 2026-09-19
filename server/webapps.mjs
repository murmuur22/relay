import {fail} from './accounts.mjs';
export function webURL(value){
 if(typeof value!=='string'||value.length>2048||!/^https?:\/\//i.test(value)||value!==value.trim())throw fail(400,'Enter an explicit absolute HTTP or HTTPS address.');
 let u;try{u=new URL(value);}catch{throw fail(400,'Invalid address or port.');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||value.includes('#'))throw fail(400,'HTTP(S) only; credentials and fragments are not allowed.');
 return u;
}
export function webConfig(body){
 if(!body||typeof body!=='object'||['enabled','icon','openMode','allowedOrigins'].some(k=>k in body&&body[k]===null))throw fail(400,'Invalid app fields');
 if(body.kind!=='web'||!['native','stream'].includes(body.mode)||typeof body.label!=='string'||!body.label.trim()||body.label.length>64||!['globe','folder','notes','media','terminal'].includes(body.icon??'globe')||!['window','tab'].includes(body.openMode??'window')||typeof (body.enabled??true)!=='boolean')throw fail(400,'Invalid app fields');
 const address=webURL(body.address).href;
 if(!Array.isArray(body.allowedOrigins??[])||(body.allowedOrigins??[]).length>16)throw fail(400,'Invalid approved origins');
 const allowedOrigins=[...new Set((body.allowedOrigins??[]).map(value=>{const u=webURL(value);if(u.pathname!=='/'||u.search)throw fail(400,'Approved origins must not include paths or queries');return u.origin;}))];
 return {kind:'web',mode:body.mode,label:body.label.trim(),address,icon:body.icon??'globe',openMode:body.openMode??'window',enabled:body.enabled??true,allowedOrigins,description:body.mode==='stream'?'Isolated ephemeral browser; WebSockets and file transfers unsupported.':'Opens on your device; Relay permissions control this launcher, not the upstream site.'};
}
export function publicApp(a){if(a.kind!=='web')return a;const {id,label,mode,enabled,kind,icon,openMode,description}=a;return {id,label,mode,enabled,kind,icon,openMode,description,...(mode==='native'?{url:a.address}:{})};}
