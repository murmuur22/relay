import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import net from 'node:net';
import http from 'node:http';
import {authenticate,client} from '../auth-helper.mjs';
import {createGateway} from '../../server/gateway.mjs';
import WebSocket from 'ws';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function availablePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function socket(origin){const s=net.connect(Number(new URL(origin).port),'127.0.0.1');s.on('error',()=>{});await once(s,'connect');return s;}
async function bound(p,ms){let timer;try{return await Promise.race([p,new Promise(r=>timer=setTimeout(()=>r(false),ms))]);}finally{clearTimeout(timer);}}
for(const control of ['none','idle-keepalive','retained-browser-ws','active-http-body','incomplete-header'])test('uninstrumented standalone SIGTERM within unchanged 20s driver bound: '+control,{timeout:35000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-stop-'),port=await availablePort(),origin='http://127.0.0.1:'+port;
 let p,s,ws;let output='';const fixture=http.createServer((req,res)=>res.end('<!doctype html><p>Synthetic shutdown control</p>'));await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
 try{
  p=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),RELAY_PROFILE:'standalone',RELAY_STATE_DIR:runtime,RELAY_HOSTNAME:'127.0.0.1'},stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);const exited=once(p,'exit');
  const until=Date.now()+10000;while(true){try{if((await fetch(origin+'/health/ready')).ok)break;}catch{}assert.equal(p.exitCode,null,output);assert.ok(Date.now()<until,'listener readiness');await pause(20);}
  if(control==='retained-browser-ws'){
   const a=await authenticate(origin,runtime),api=client(origin,a);const registered=await api('/admin/apps','POST',{label:'Synthetic stream',kind:'web',mode:'stream',address:'http://127.0.0.1:'+fixture.address().port+'/',allowedOrigins:[]});assert.equal(registered.status,200,await registered.clone().text());const app=await registered.json();const opened=await api('/windows','POST',{appId:app.id});assert.equal(opened.status,200,await opened.clone().text());const w=await opened.json();ws=new WebSocket(origin.replace('http','ws')+'/ws/stream/'+w.id,{headers:{cookie:a.cookie,Origin:origin}});ws.on('error',()=>{});const frame=new Promise(resolve=>ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='frame'&&m.mime==='image/jpeg'&&m.data)resolve(m);}));assert.notEqual(await bound(frame,8000),false,'actual sandboxed browser JPEG before shutdown');
  }else if(control!=='none'){
   s=await socket(origin);
   if(control==='idle-keepalive'){const data=once(s,'data');s.write('GET /health/ready HTTP/1.1\r\nHost: 127.0.0.1:'+port+'\r\n\r\n');assert.match(String((await data)[0]),/HTTP\/1.1 200/);}
   else if(control==='active-http-body')s.write('POST /api/login HTTP/1.1\r\nHost: 127.0.0.1:'+port+'\r\nOrigin: '+origin+'\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{');
   else s.write('GET /health/ready HTTP/1.1\r\nHost: 127.0.0.1:'+port+'\r\n');
   await pause(50);
  }
  const start=performance.now();p.kill('SIGTERM');const stopped=await bound(exited,20000);console.log(JSON.stringify({control,stopWithin20s:stopped!==false,elapsedMs:performance.now()-start,instrumented:false,node:process.version}));
  if(stopped===false){s?.destroy();ws?.terminate();await bound(exited,5000);}assert.notEqual(stopped,false,'runtime shutdown exceeds existing updater 20s deadline');assert.equal(stopped[0],0,output);
 }finally{s?.destroy();ws?.terminate();if(p&&p.exitCode===null){p.kill('SIGKILL');await once(p,'exit');}fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(runtime,{recursive:true,force:true});}
});
for(const profile of ['standalone','development'])test('fresh held incomplete request: '+profile+' close settles and closes owned socket',{timeout:12000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-held-stop-');let g,s;
 try{g=await createGateway({port:0,profile,runtime,native:profile==='development',keepsakesPort:await availablePort(),data:runtime+'/synthetic-library'});s=await socket(g.origin);s.write('GET / HTTP/1.1\r\nHost: '+new URL(g.origin).host+'\r\n');await pause(50);const closed=once(s,'close'),stop=g.close();const settled=await bound(stop.then(()=>true),2000);if(!settled)s.destroy();await stop;assert.equal(settled,true,'held parser must not block runtime close');assert.notEqual(await bound(closed,2000),false);}
 finally{s?.destroy();await g?.close();await rm(runtime,{recursive:true,force:true});}
});
