// Operator names are distinct siblings beneath a registrable same-site parent.
// Include PRIVATE public suffixes: github.io / duckdns.org tenants are not one site.
import {parse} from 'tldts';
// Build canonical browser-facing origins independently of listener addresses.
export function gatewayHTTPSOrigin(hostname,port){
 if(typeof hostname!=='string'||hostname.length>253||!hostname.includes('.')||!hostname.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid gateway HTTPS origin');
 const origin=`https://${hostname}${port===443?'':':'+port}`;
 if(new URL(origin).origin!==origin)throw Error('Invalid gateway HTTPS origin');
 return origin;
}
export function gatewayLaunchOrigin(id,appBaseDomain,desktopOrigin){
 if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw Error('Invalid gateway launch identity');
 const desktop=new URL(desktopOrigin);
 if(desktop.protocol!=='https:'||desktop.origin!==desktopOrigin)throw Error('Invalid gateway desktop origin');
 return gatewayHTTPSOrigin(`${id}.${appBaseDomain}`,desktop.port?Number(desktop.port):443);
}
export function sameSiteDomains(desktop,apps){
 const valid=v=>typeof v==='string'&&v.length<=220&&v.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x));
 if(!valid(desktop)||!valid(apps)||desktop===apps)return false;
 const parent=desktop.split('.').slice(1).join('.');
 if(parent!==apps.split('.').slice(1).join('.'))return false;
 // Reserved local test/home namespaces must still have a dedicated parent label.
 if(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.test$/.test(parent)||/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.home\.arpa$/.test(parent))return true;
 const p=parse(parent,{allowPrivateDomains:true});
 return Boolean(p.domain&&(p.isIcann||p.isPrivate));
}
