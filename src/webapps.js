export function webAddress(value){
 if(!/^https?:\/\//i.test(value))throw Error('Choose an explicit http:// or https:// address, including for an IP address.');
 let u;try{u=new URL(value);}catch{throw Error('Enter a valid HTTP(S) address and port.');}
 if(u.username||u.password)throw Error('Credentials are not allowed in an address.');
 if(u.hash)throw Error('Remove the fragment (#…) from the address.');
 return u.href;
}
export function origins(text){return [...new Set(text.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean).map(s=>{const u=new URL(webAddress(s));if(u.pathname!=='/'||u.search)throw Error('Approved origins must contain only scheme, host and optional port.');return u.origin;}))];}
export function statusLabel(value,now=Date.now()){
 const stale=value?.checkedAt&&now-value.checkedAt>30000?'Stale · ':'';
 if(value?.reachability==='responding')return stale+'UP from Relay'+(value.authRequired?' · authentication required':value.httpStatus>=400?' · HTTP '+value.httpStatus+' · readiness unknown':'');
 if(value?.reachability==='unreachable')return stale+'Unavailable from Relay';
 if(value?.reachability==='not-monitored')return 'Not monitored';
 if(value?.reachability==='unknown')return stale+'Not monitored · no current server observation';
 // Compatibility with older runtime observations; never promote old HTTP error observations to readiness.
 if(value?.state==='Online')return stale+(value.source==='device'?'Reachable from this device':'Reachable from Relay');
 if(value?.state==='Reached')return stale+(value.source==='device'?'Reached from this device · readiness unknown':'Reached from Relay · readiness unknown');
 if(value?.state==='Offline')return stale+'Not responding from Relay';
 return stale+(value?.source==='device'?'Unknown · unobservable from this device':'Not monitored');
}
export function statusDetail(value,now=Date.now()){const stale=value?.checkedAt&&now-value.checkedAt>30000?'Stale observation · ':'';return `${stale}${value?.source==='device'?'This device':'Relay'} · ${value?.checkedAt?new Date(value.checkedAt).toLocaleString():'Not checked'} · ${value?.detail||'No observation available'}`;}
export async function checkDevice(address,signal){
 const checkedAt=Date.now();try{const timeout=AbortSignal.timeout(4000);const response=await fetch(webAddress(address),{method:'GET',mode:'cors',credentials:'omit',redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout});await response.body?.cancel();return {state:response.ok?'Online':'Reached',source:'device',checkedAt:Date.now(),httpStatus:response.status,detail:`Device received HTTP ${response.status}; reachability only, readiness and login are not established.`};}catch{return {state:'Unknown',source:'device',checkedAt,detail:'Device check blocked or unavailable (CORS, mixed content or network). This does not mean Offline.'};}
}
export function nativeAddress(value,relayOrigin){const address=webAddress(value);if(new URL(address).hostname.replace(/\.$/,'')===new URL(relayOrigin).hostname.replace(/\.$/,''))throw Error('Native apps need a different hostname from Relay: cookies are shared across ports. Use a separate app hostname or choose Streamed.');return address;}
export function safeExternal(value,relayOrigin){try{return relayOrigin?nativeAddress(value,relayOrigin):webAddress(value);}catch{return null;}}
