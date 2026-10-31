// Declarative setup defaults, not executable adapters or compatibility claims.
// The standalone design model is intentionally not a runtime schema.
export const COCKPIT_PROFILE=Object.freeze({version:1,id:'cockpit',defaults:Object.freeze({entryPath:'/',cookieNames:Object.freeze(['cockpit']),webSocketPaths:Object.freeze(['/cockpit/socket']),webSocketProtocols:Object.freeze(['cockpit1']),webSocketOrigin:'upstream',presentation:'tab',accessPolicy:'admin-only'})});
export function cockpitTarget(form){
 if(!form||typeof form!=='object'||Object.keys(form).some(k=>!['id','label','upstream','trust','serverName','caPath'].includes(k)))throw Error('Unexpected Cockpit setup field.');
 if(typeof form.id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(form.id))throw Error('Use an exact lowercase target ID, up to 32 letters, digits or hyphens.');
 if(typeof form.label!=='string'||!form.label.trim()||form.label.length>64)throw Error('Enter a service name of up to 64 characters.');
 const text=form.upstream;let u;try{u=new URL(text);}catch{throw Error('Enter an exact private IPv4 service origin.');}
 // Literal canonical IPv4 only: no DNS lookup, alternative IP notation or URL normalization.
 const parts=u.hostname.split('.');
 if(typeof text!=='string'||u.origin!==text||!['http:','https:'].includes(u.protocol)||parts.length!==4||parts.some(p=>!/^\d{1,3}$/.test(p)||String(Number(p))!==p||Number(p)>255)||u.port==='0')throw Error('Use an exact HTTP(S) IPv4 origin, without credentials, path or trailing slash.');
 const [a,b,c,d]=parts.map(Number),privateIP=a===127||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);
 if(!privateIP||(a===100&&b===100&&c===100&&d===200))throw Error('Use a fixed private service destination; public and metadata targets are not allowed.');
 if(!['system','custom'].includes(form.trust))throw Error('Choose provisioned system or custom CA trust.');
 const name=form.serverName;
 if(typeof name!=='string'||(name&&(name.length>253||!name.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x)))))throw Error('Use an exact lowercase DNS certificate identity, without a wildcard.');
 if(typeof form.caPath!=='string')throw Error('Enter a protected server CA path.');
 if(u.protocol==='http:'&&(name||form.caPath||form.trust!=='system'))throw Error('HTTP cannot use certificate settings.');
 if(form.trust==='system'&&form.caPath)throw Error('System trust does not accept a custom CA path.');
 if(form.trust==='custom'&&(!/^\/[a-zA-Z0-9_./-]+$/.test(form.caPath)||form.caPath.split('/').some(p=>p==='..'||p==='.')||form.caPath.includes('//')))throw Error('Enter an absolute, provisioned protected CA file path on the Relay server.');
 return {id:form.id,label:form.label,upstream:text,...structuredClone(COCKPIT_PROFILE.defaults),...(u.protocol==='https:'?{upstreamTLS:{...(name?{serverName:name}:{}),...(form.trust==='custom'?{caPath:form.caPath}:{})}}:{})};
}
export function isCockpitTarget(target){
 try{
 const {upstreamTLS,...value}=target;
 const expected=cockpitTarget({id:value.id,label:value.label,upstream:value.upstream,trust:upstreamTLS?.caPath?'custom':'system',serverName:upstreamTLS?.serverName??'',caPath:upstreamTLS?.caPath??''});
 return JSON.stringify(target)===JSON.stringify(expected)||Object.keys(expected).length===Object.keys(target).length&&Object.entries(expected).every(([k,v])=>JSON.stringify(v)===JSON.stringify(target[k]));
 }catch{return false;}
}
