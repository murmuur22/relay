// Test-only loopback reservations. Never retry/reallocate after a bind failure.
import net from 'node:net';
import {spawn} from 'node:child_process';
// Keep transport diagnostics, never response bodies, request headers, cookies,
// enrollment URLs or PEM bytes. Caddy request metadata is deliberately omitted.
function safeError(error){return {code:error.code,message:String(error.message).slice(0,2048)};}
function safeStderr(line){
 try{const value=JSON.parse(line);return JSON.stringify({level:value.level,logger:value.logger,msg:value.msg});}
 catch{return /^Error:/.test(line)?line.slice(0,2048):'[non-JSON Caddy stderr omitted]';}
}
export function startCaddy(caddy,dir){
 const child=spawn(caddy,['run','--config',dir+'/Caddyfile','--adapter','caddyfile'],{env:{...process.env,HOME:dir,XDG_DATA_HOME:dir+'/data',XDG_CONFIG_HOME:dir+'/config'},stdio:['ignore','ignore','pipe']});
 let pending='',stderr='',spawnError;
 const record=line=>{stderr=(stderr+safeStderr(line)+'\n').slice(-8192);};
 child.stderr.setEncoding('utf8');child.stderr.on('data',text=>{pending+=text;let end;while((end=pending.indexOf('\n'))>=0){record(pending.slice(0,end));pending=pending.slice(end+1);}if(pending.length>8192){record(pending.slice(0,2048));pending='';}});
 child.on('error',e=>{spawnError=safeError(e);});
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>{if(pending)record(pending);resolve({code,signal});}));
 return {child,closed,diagnostics:()=>({pid:child.pid,code:child.exitCode,signal:child.signalCode,spawnError,stderr})};
}
export async function stopCaddy(proxy){
 const {child}=proxy;
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
 await proxy.closed;
}
export async function caddyReady(proxy,request,expected=[200],delay=50){
 if(!Array.isArray(expected))expected=[expected];
 const attempts=[];
 const failure=()=>{const diagnostics={...proxy.diagnostics(),attempts};return Object.assign(Error('disposable Caddy ready: '+JSON.stringify(diagnostics)),{diagnostics});};
 for(let i=0;i<100;i++){
  if(proxy.child.exitCode!==null||proxy.child.signalCode!==null){await proxy.closed;throw failure();}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1000);
  try{
   const result=await Promise.race([request(controller.signal),proxy.closed.then(()=>{throw Error('Caddy exited during readiness');})]);
   attempts.push({i,status:result.status});
   if(proxy.child.exitCode!==null||proxy.child.signalCode!==null){await proxy.closed;throw failure();}
   if(expected.includes(result.status))return;
  }catch(e){if(e.diagnostics)throw e;attempts.push({i,error:safeError(e)});}
  finally{clearTimeout(timer);controller.abort();}
  if(proxy.child.exitCode!==null||proxy.child.signalCode!==null){await proxy.closed;throw failure();}
  await new Promise(r=>setTimeout(r,delay));
 }
 throw failure();
}
async function reserve(port){
 const server=net.createServer(socket=>socket.destroy());
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 let closure;
 return {port:server.address().port,close:()=>closure??=new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
export async function reserveCaddyPorts({internal=0,external=0}={}){
 if(internal!==0&&internal===external)throw Error('Caddy fixture candidate ports must be distinct');
 const backend=await reserve(internal);let edge;
 try{edge=await reserve(external);}catch(e){await backend.close();throw e;}
 return {internal:backend.port,external:edge.port,releaseInternal:backend.close,releaseExternal:edge.close,
  close:async()=>{const results=await Promise.allSettled([backend.close(),edge.close()]);const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'Caddy port reservation cleanup failed');}};
}
