// Operator names are distinct siblings beneath a registrable same-site parent.
// Include PRIVATE public suffixes: github.io / duckdns.org tenants are not one site.
import {parse} from 'tldts';
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
