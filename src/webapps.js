export function webAddress(value){
 if(!/^https?:\/\//i.test(value))throw Error('Choose an explicit http:// or https:// address, including for an IP address.');
 let u;try{u=new URL(value);}catch{throw Error('Enter a valid HTTP(S) address and port.');}
 if(u.username||u.password)throw Error('Credentials are not allowed in an address.');
 if(u.hash)throw Error('Remove the fragment (#…) from the address.');
 return u.href;
}
export function origins(text){return [...new Set(text.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean).map(s=>{const u=new URL(webAddress(s));if(u.pathname!=='/'||u.search)throw Error('Approved origins must contain only scheme, host and optional port.');return u.origin;}))];}
export function statusLabel(value){if(value?.state==='Online')return value.source==='device'?'Reachable from this device':'Reachable from Relay';if(value?.state==='Offline')return 'Not responding from Relay';return 'Unknown';}
export function statusDetail(value){return `${value?.source==='device'?'This device':'Relay'} · ${value?.checkedAt?new Date(value.checkedAt).toLocaleString():'Not checked'} · ${value?.detail||'No observation available'}`;}
export async function checkDevice(address,signal){
 const checkedAt=Date.now();try{const timeout=AbortSignal.timeout(4000);const response=await fetch(webAddress(address),{method:'GET',mode:'cors',credentials:'omit',redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout});await response.body?.cancel();return {state:response.ok?'Online':'Unknown',source:'device',checkedAt,detail:`Device HTTP ${response.status}`};}catch{return {state:'Unknown',source:'device',checkedAt,detail:'Device check blocked or unavailable (CORS, mixed content or network). This does not mean Offline.'};}
}
export function nativeAddress(value,relayOrigin){const address=webAddress(value);if(new URL(address).hostname.replace(/\.$/,'')===new URL(relayOrigin).hostname.replace(/\.$/,''))throw Error('Native apps need a different hostname from Relay: cookies are shared across ports. Use a separate app hostname or choose Streamed.');return address;}
export function safeExternal(value,relayOrigin){try{return relayOrigin?nativeAddress(value,relayOrigin):webAddress(value);}catch{return null;}}
