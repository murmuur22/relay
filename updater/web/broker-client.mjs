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
 const invalid=message=>Object.assign(Error(message),{status:400});
 if(!body||typeof body!=='object'||Array.isArray(body)||!['install','prepare','apply','cancel','rollback'].includes(action)||body.confirmed!==true||typeof body.password!=='string'||!body.password.length||body.password.length>128||Object.keys(body).some(k=>!['action','version','jobId','password','confirmed'].includes(k)))throw invalid('Invalid update confirmation');
 const fields={action};
 if(['install','prepare','apply'].includes(action)){
  if(typeof body.version!=='string'||body.version.length>64||!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(body.version))throw invalid('Invalid release version');fields.version=body.version;
 }else if('version'in body)throw invalid('Unexpected release version');
 if(['apply','cancel'].includes(action)){
  if(typeof body.jobId!=='string'||!/^[0-9a-f]{32}$/.test(body.jobId))throw invalid('Invalid update job');fields.jobId=body.jobId;
 }else if('jobId'in body)throw invalid('Unexpected update job');
 return fields;
}
// Explicit protocol-1 staged extension. Absence is not permission to install now.
export function stagedTarget(snapshot,fields,userId){
 const {action,version,jobId}=fields,job=snapshot?.job;
 const staged=['prepare','apply'].includes(action)||(action==='cancel'&&job?.kind==='prepare');
 if(staged&&(snapshot?.capabilities?.prepare!==1||snapshot?.capabilities?.apply!==1))throw new BrokerError('Staged updates unsupported by this control plane',409);
 const stale=()=>{throw new BrokerError('Update target changed or is not ready; review it again',409);};
 if(action==='prepare'&&snapshot?.canPrepare!==true)stale();
 if(action==='apply'&&(snapshot?.canApply!==true||job?.kind!=='prepare'||job.phase!=='ready'||job.id!==jobId||job.version!==version||job.userId!==userId))stale();
 if(action==='cancel'&&(!job||job.id!==jobId||job.canCancel!==true||!['downloading','verifying','staging','ready'].includes(job.phase)||(job.kind==='prepare'&&job.userId!==userId)))stale();
}
