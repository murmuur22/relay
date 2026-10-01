import {remoteSocketAuthorized} from './gateway-remote-tls.mjs';
// Inspect rawHeaders before admitting HTTP or WebSocket forwarding metadata.
export function validateProxyRequest(req,config){
 const deny=()=>{throw Error('Invalid proxy boundary');};
 if(req.socket.remoteAddress!==config.trustedProxy)deny();
 if(config.mtls){if(!remoteSocketAuthorized(req.socket,config.mtls))deny();}
 else if(config.trustedProxy!=='127.0.0.1')deny();
 const fields=new Map();
 for(let i=0;i<req.rawHeaders.length;i+=2){
  const name=req.rawHeaders[i].toLowerCase(),value=req.rawHeaders[i+1];
  if(name==='host'||name==='forwarded'||name==='x-real-ip'||name.startsWith('x-forwarded-')){
   if(!['host','x-forwarded-host','x-forwarded-proto'].includes(name)||fields.has(name))deny();
   fields.set(name,value);
  }
 }
 const host=fields.get('host');
 if(typeof host!=='string'||!host||fields.get('x-forwarded-host')!==host||fields.get('x-forwarded-proto')!=='https')deny();
 let u;try{u=new URL('https://'+host);}catch{deny();}
 if(u.host!==host||u.origin!=='https://'+host||u.username||u.password)deny();
}
