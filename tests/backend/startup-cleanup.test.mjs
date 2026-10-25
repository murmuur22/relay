import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const fixture=fileURLToPath(new URL('../helpers/startup-cleanup.mjs',import.meta.url));
for(const mode of ['edge-no-partial','edge-partial','normal-partial','native-partial','edge-live','edge-cleanup-failure'])test('startup cleanup real accepted socket: '+mode,{timeout:15000},async()=>{
 const env={...process.env};for(const key of ['NODE_OPTIONS','RELAY_GATEWAY_CONFIG','RELAY_MAINTENANCE_FILE','RELAY_UPDATER_CONFIG'])delete env[key];
 const child=spawn(process.execPath,[fixture,mode],{env,stdio:['ignore','pipe','pipe']});let output='',timer,escalation;
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const exited=once(child,'exit');
 try{
  const result=await Promise.race([exited,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('owned startup fixture deadline')),12000))]);
  assert.equal(result[1],null,output);assert.equal(result[0],0,output);
  assert.match(output,/"stage":"assertions-passed"/);assert.match(output,/"stage":"fixtures-removed"/);
  console.log(output.trim());
 }finally{
  clearTimeout(timer);
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');escalation=setTimeout(()=>child.kill('SIGKILL'),1000);await exited;clearTimeout(escalation);}
 }
});

test('actual uninstrumented index reports occupied-edge startup failure and releases management port',{timeout:25000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/startup-index-');await chmod(runtime,0o700);
 const blocker=net.createServer(),reservation=net.createServer();let child,exited,timer,killTimer,port,edge;let output='';
 try{
  await new Promise(r=>blocker.listen(0,'127.0.0.1',r));edge=blocker.address().port;
  await new Promise(r=>reservation.listen(0,'127.0.0.1',r));port=reservation.address().port;await new Promise(r=>reservation.close(r));
  await writeFile(runtime+'/gateway-managed.json',JSON.stringify({version:2,mode:'reverse-proxy',bind:'127.0.0.1',port:edge,appBaseDomain:'apps.example.test',desktopOrigin:'https://desktop.example.test',trustedProxy:'127.0.0.1',targets:[{id:'synthetic',label:'Synthetic',upstream:'http://127.0.0.1:18302'}]}),{mode:0o600});
  const env={...process.env,PORT:String(port),RELAY_PROFILE:'standalone',RELAY_STATE_DIR:runtime,RELAY_HOSTNAME:'127.0.0.1',RELAY_NETWORK_MODE:'loopback'};
  for(const key of ['NODE_OPTIONS','RELAY_GATEWAY_CONFIG','RELAY_MAINTENANCE_FILE','RELAY_UPDATER_CONFIG'])delete env[key];
  child=spawn(process.execPath,[fileURLToPath(new URL('../../server/index.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);exited=once(child,'exit');
  const start=performance.now(),result=await Promise.race([exited,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('unchanged 20s driver startup-failure bound')),20000))]);
  assert.equal(result[0],1,output);assert.equal(result[1],null,output);assert.match(output,/EADDRINUSE/);assert.doesNotMatch(output,/Relay listening on/);
  console.log(JSON.stringify({entrypoint:'server/index.mjs',instrumented:false,exit:result[0],signal:result[1],elapsedMs:performance.now()-start,partialHeaders:false}));
 }finally{
  clearTimeout(timer);
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);await exited;clearTimeout(killTimer);}
  if(reservation.listening)await new Promise(r=>reservation.close(r));
  if(blocker.listening)await new Promise(r=>blocker.close(r));
  for(const p of [port,edge].filter(Boolean)){const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(p,'127.0.0.1',resolve);});await new Promise(r=>probe.close(r));}
  await rm(runtime,{recursive:true,force:true});
 }
});
