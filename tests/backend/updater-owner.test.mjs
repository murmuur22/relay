import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('monitoring survives same-cookie downtime but logout and a different account cannot reuse its data or mutation authority',async t=>{
 const root=await mkdtemp(tmpdir()+'/relay-updater-owner-'),a='a'.repeat(64),b='b'.repeat(64);let current='owner-a',up=true,starts=0;
 const broker=net.createServer(socket=>{let text='';socket.on('data',bytes=>{text+=bytes;if(!text.includes('\n'))return;const request=JSON.parse(text);if(request.action==='start')starts++;socket.end(JSON.stringify({ok:true,result:request.action==='redeem-ui'?{token:'c'.repeat(64),userId:'owner-a',interfaceAnimations:false,expiresAt:Date.now()+60000}:{mode:'fixture',currentVersion:'private-owner-a',available:[],job:null,history:[],canInstall:true}})+'\n');});});await new Promise(r=>broker.listen(root+'/socket',r));
 const relay=http.createServer((req,res)=>{if(!up){res.writeHead(503);res.end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({user:{id:current,role:'admin'},csrf:'d'.repeat(64)}));});await new Promise(r=>relay.listen(0,'127.0.0.1',r));
 const uiOrigin=`http://127.0.0.1:${await freePort()}`,web=await createUpdaterWeb({uiOrigin,relayOrigin:`http://127.0.0.1:${relay.address().port}`,socketPath:root+'/socket'});
 t.after(async()=>{await web.close();await new Promise(r=>{relay.close(r);relay.closeAllConnections();});await new Promise(r=>broker.close(r));await rm(root,{recursive:true,force:true});});
 const missing=await fetch(uiOrigin+'/updater/api/exchange',{method:'POST',headers:{Origin:uiOrigin,'Content-Type':'application/json'},body:JSON.stringify({ticket:'e'.repeat(64)})});assert.equal(missing.status,401,'An exchange must not create unbound monitoring authority');
 let response=await fetch(uiOrigin+'/updater/api/exchange',{method:'POST',headers:{Origin:uiOrigin,'Content-Type':'application/json',Cookie:'relay_session='+a},body:JSON.stringify({ticket:'e'.repeat(64)})});assert.equal(response.status,200);const updater=response.headers.get('set-cookie').split(';')[0],{csrf}=await response.json();
 const state=cookie=>fetch(uiOrigin+'/updater/api/state',{headers:{Cookie:updater+(cookie?'; relay_session='+cookie:''),Origin:uiOrigin}});
 up=false;assert.equal((await state(a)).status,200);up=true;
 current='owner-b';assert.equal((await state(b)).status,401);assert.equal(starts,0);
 // Re-exchange then explicit Relay logout (cookie removed) retires monitoring.
 current='owner-a';response=await fetch(uiOrigin+'/updater/api/exchange',{method:'POST',headers:{Origin:uiOrigin,'Content-Type':'application/json',Cookie:'relay_session='+a+'; '+updater},body:JSON.stringify({ticket:'e'.repeat(64)})});const next=response.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(uiOrigin+'/updater/api/state',{headers:{Origin:uiOrigin,Cookie:next}})).status,401);
});
