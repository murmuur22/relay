import net from 'node:net';
export class BrokerError extends Error { constructor(message='Updater broker unavailable',status=503){super(message);this.status=status;} }
// The unprivileged web process only ever supplies capabilities, never a signing key.
export function brokerRequest(socketPath,request,{timeout=15000}={}) {
 const line=JSON.stringify(request)+'\n';if(Buffer.byteLength(line)>65536)return Promise.reject(new BrokerError('Updater request too large',400));
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection({path:socketPath});let bytes=0,chunks=[],done=false;
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(result);};
  const timer=setTimeout(()=>finish(new BrokerError('Updater broker timed out')),timeout);
  socket.on('connect',()=>socket.write(line));socket.on('error',()=>finish(new BrokerError()));socket.on('end',()=>finish(new BrokerError('Updater broker response incomplete')));
  socket.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576)return finish(new BrokerError('Updater broker response too large'));chunks.push(chunk);if(!chunk.includes(10))return;try{const data=Buffer.concat(chunks);const end=data.indexOf(10);if(data.subarray(end+1).length)throw Error();const reply=JSON.parse(data.subarray(0,end).toString('utf8'));if(reply.ok!==true)return finish(new BrokerError('Updater request rejected',403));if(!reply.result||typeof reply.result!=='object')throw Error();finish(null,reply.result);}catch{finish(new BrokerError('Invalid updater broker response'));}});
 });
}
export function privateIPv4(value){
 if(typeof value!=='string'||! /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value))return false;
 const n=value.split('.').map(Number);return n.every(v=>v<=255)&&(n[0]===10||(n[0]===172&&n[1]>=16&&n[1]<=31)||(n[0]===192&&n[1]===168));
}
export function networkHost(hostname,networkMode='loopback'){
 if(networkMode==='private-lan'&&privateIPv4(hostname))return hostname;
 if(networkMode==='loopback'&&['127.0.0.1','localhost'].includes(hostname))return '127.0.0.1';
 throw Error('Invalid Relay hostname or network mode');
}
export function loopbackOrigin(value,networkMode='loopback'){let url;try{url=new URL(value);}catch{throw Error('Invalid updater origin');}if(url.origin!==value||url.protocol!=='http:'||url.username||url.password)throw Error('Invalid updater origin');networkHost(url.hostname,networkMode);return url;}
export const capability=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(value);
export function actionFields(body,action=body?.action){
 if(!body||typeof body!=='object'||Array.isArray(body)||!['install','cancel','rollback'].includes(action)||body.confirmed!==true||typeof body.password!=='string'||body.password.length>128||Object.keys(body).some(k=>!['action','version','jobId','password','confirmed'].includes(k)))throw Object.assign(Error('Invalid update confirmation'),{status:400});
 const fields={action};
 if(action==='install'){if(typeof body.version!=='string'||!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(body.version)||body.version.length>64||'jobId'in body)throw Object.assign(Error('Invalid release version'),{status:400});fields.version=body.version;}
 else if(action==='cancel'){if(typeof body.jobId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.jobId)||'version'in body)throw Object.assign(Error('Invalid update job'),{status:400});fields.jobId=body.jobId;}
 else if('jobId'in body||'version'in body)throw Object.assign(Error('Invalid rollback target'),{status:400});
 return fields;
}
