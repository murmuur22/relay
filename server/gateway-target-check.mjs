// One credential-free HEAD to an already validated, literal private destination.
// No redirects, DNS, response bodies, cookies, arbitrary headers or WS login.
import http from 'node:http';
import https from 'node:https';
import {createHash} from 'node:crypto';
export function targetCheck(target,{signal,authorize,identity}){
 authorize();
 return new Promise((resolve,reject)=>{
 let settled=false,tlsPassed=false;
 const done=(error,status)=>{if(settled)return;settled=true;clearTimeout(deadline);clearInterval(guard);signal.removeEventListener('abort',abort);q.destroy();
 if(signal.aborted)return reject(signal.reason??Error('Check cancelled'));
 try{authorize();}catch(e){return reject(e);}
 const nt={state:'not-tested',detail:'Requires separate authentic, interactive service qualification.'};
 resolve({source:'relay',checkedAt:Date.now(),configIdentity:createHash('sha256').update(identity).digest('hex'),tiers:{configuration:{state:'passed',detail:'Protected runtime configuration validated; not service compatibility.'},certificate:{state:target.upstream.startsWith('https:')?(tlsPassed?'passed':'failed'):'not-tested',detail:target.upstream.startsWith('https:')?'CA chain and exact server identity checked by Relay TLS.':'HTTP has no upstream TLS; a protected network boundary needs manual confirmation.'},http:{state:error?'failed':'passed',...(status?{status}:{}),detail:error?'No bounded HTTP response received.':'Received HTTP '+status+' without following redirects; not proof of login or readiness.'},login:nt,live:nt,display:nt,revocation:nt}});
 };
 const abort=()=>{if(settled)return;settled=true;clearTimeout(deadline);clearInterval(guard);signal.removeEventListener('abort',abort);q.destroy();reject(signal.reason??Error('Check cancelled'));};
 const q=(target.upstream.startsWith('https:')?https:http).request(target.upstream+'/',{method:'HEAD',agent:false,rejectUnauthorized:true,ca:target.tls?.ca,servername:target.tls?.serverName,maxHeaderSize:8192,headers:{accept:'text/html'}},r=>{r.destroy();done(null,r.statusCode);});
 q.on('socket',socket=>socket.once('secureConnect',()=>{tlsPassed=true;}));q.on('error',e=>done(e));
 const deadline=setTimeout(()=>done(Error('Deadline')),3000);
 const guard=setInterval(()=>{try{authorize();}catch(e){q.destroy();done(e);}},25);
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)return abort();q.end();
 });
}
