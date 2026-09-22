// Experimental login-response profile. No browser cookie/header can populate this state.
export const FORGET_PATH='/.relay/forget';
export function validateProfile(raw){
 if(raw===undefined)return;
 const bad=()=>{throw Error('Unsafe auth profile');};
 const object=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))bad();};
 const endpoint=(v,login=false)=>{object(v,login?['method','path','status','contentType']:['method','path']);if(!['POST','DELETE'].includes(v.method)||typeof v.path!=='string'||v.path.length>256||!/^\/[a-zA-Z0-9/_-]+$/.test(v.path)||v.path.includes('//')||v.path===FORGET_PATH)bad();};
 const header=n=>typeof n==='string'&&n.length<=64&&(n==='authorization'||(/^x-[a-z0-9-]+$/.test(n)&&!/^x-(forwarded|real-|relay-|proof-|remote-|auth-request|original-)/.test(n)));
 object(raw,['login','logout','maxBytes','ttlMs','cookie','headers','stripHeaders']);endpoint(raw.login,true);
 if(!Number.isInteger(raw.login.status)||raw.login.status<200||raw.login.status>299||!['text/plain','application/jwt','application/octet-stream'].includes(raw.login.contentType))bad();
 if(raw.logout){endpoint(raw.logout);if(raw.logout.path===raw.login.path)bad();}
 if(!Number.isInteger(raw.maxBytes)||raw.maxBytes<1||raw.maxBytes>8192||!Number.isInteger(raw.ttlMs)||raw.ttlMs<1||raw.ttlMs>3600000)bad();
 if(raw.cookie!==undefined&&(typeof raw.cookie!=='string'||raw.cookie.length>64||! /^[a-zA-Z0-9_-]+$/.test(raw.cookie)||/^(?:proof_|relay|__Host-|__Secure-)/i.test(raw.cookie)))bad();
 if(!Array.isArray(raw.headers)||raw.headers.length>8||new Set(raw.headers.map(h=>h?.name)).size!==raw.headers.length)bad();
 for(const h of raw.headers){object(h,['name','prefix']);if(!header(h.name)||!['','Bearer ','Token '].includes(h.prefix))bad();}
 if(!raw.cookie&&!raw.headers.length)bad();
 if(!Array.isArray(raw.stripHeaders)||raw.stripHeaders.length>16||raw.stripHeaders.some(h=>!header(h)))bad();
 const p=structuredClone(raw);Object.freeze(p.login);if(p.logout)Object.freeze(p.logout);p.headers.forEach(Object.freeze);Object.freeze(p.headers);Object.freeze(p.stripHeaders);return Object.freeze(p);
}
export function forgetCredential(route){clearTimeout(route.credentialTimer);delete route.credentialTimer;route.authGeneration=(route.authGeneration||0)+1;delete route.credential;route.jar?.clear();}
export function profileHeaders(result,c){
 const p=c.app.authProfile;if(!p)return;
 for(const name of ['authorization',...p.stripHeaders,...p.headers.map(h=>h.name)])delete result[name];
 const stored=c.route.credential;
 if(stored&&stored.expires<=Date.now())forgetCredential(c.route);
 const token=c.route.credential?.value;if(!token)return;
 for(const h of p.headers)result[h.name]=h.prefix+token;
 if(p.cookie)result.cookie=[result.cookie,p.cookie+'='+token].filter(Boolean).join('; ');
}
export function loginMatch(req,p){return req.method===p.login.method&&req.url===p.login.path;}
export async function captureCredential(r,c,generation,stillAuthorized){
 const p=c.app.authProfile,chunks=[];let bytes=0;
 if(r.statusCode!==p.login.status)return null;
 if((r.headers['content-type']||'').split(';')[0].trim().toLowerCase()!==p.login.contentType||r.headers['content-encoding']||Number(r.headers['content-length']||0)>p.maxBytes)throw Error('Invalid login response');
 for await(const chunk of r){bytes+=chunk.length;if(bytes>p.maxBytes)throw Error('Login response bound');chunks.push(chunk);}
 const body=Buffer.concat(chunks),value=body.toString('utf8');
 if(!value||!/^[A-Za-z0-9._~+\/-]+=*$/.test(value))throw Error('Invalid credential');
 await stillAuthorized(c);
 if(c.expires<=Date.now()||c.route.authGeneration!==generation)throw Error('Stale login');
 c.route.credential={value,expires:Math.min(c.expires,Date.now()+p.ttlMs)};
 clearTimeout(c.route.credentialTimer);
 c.route.credentialTimer=setTimeout(()=>forgetCredential(c.route),Math.max(1,c.route.credential.expires-Date.now())).unref();
 return body;
}
