import {authenticate} from '../auth-helper.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {fork} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';
const fixture=new URL('../../tools/gateway-fixture.mjs',import.meta.url);
test('actual gateway process restart restores layout but invalidates old session',{timeout:15000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-restart-');let child,origin;
 const start=async()=>{child=fork(fixture,[],{env:{...process.env,RELAY_TEST_RUNTIME:runtime},stdio:['ignore','ignore','inherit','ipc']});origin=(await new Promise((r,j)=>{child.once('message',r);child.once('error',j);})).origin;};
 const stop=async()=>{if(!child)return;const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;child=null;};
 const login=()=>authenticate(origin,runtime);
 try{await start();const firstPid=child.pid,{cookie,s}=await login();const headers={cookie,Origin:origin,'X-CSRF-Token':s.csrf,'Content-Type':'application/json'};await fetch(origin+'/api/windows',{method:'POST',headers,body:'{"appId":"notes-lab"}'});await fetch(origin+'/api/windows/notes-lab',{method:'PATCH',headers,body:'{"x":201,"width":900,"visible":false}'});await stop();await start();assert.notEqual(child.pid,firstPid);assert.equal((await fetch(origin+'/api/session',{headers:{cookie}})).status,401);const next=await login();assert.equal(next.s.windows[0].x,201);assert.equal(next.s.windows[0].width,900);assert.equal(next.s.windows[0].visible,false);}finally{await stop();await rm(runtime,{recursive:true,force:true});}
});
