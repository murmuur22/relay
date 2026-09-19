import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
test('desktop read bridge is session-scoped, bounded, admin-only and rechecks revocation after broker awaits',{timeout:20000},async t=>{
 const root=await mkdtemp(tmpdir()+'/relay-browse-read-');await writeFile(root+'/key',Buffer.alloc(32,7),{mode:0o600});const calls=[];let userId,hold=false,release,arrive;
 const arrived=new Promise(r=>arrive=r);
 const broker=net.createServer(s=>s.once('data',b=>{const request=JSON.parse(b);calls.push(request.action);const send=result=>s.end(JSON.stringify({ok:true,result})+'\n');
  if(request.action==='issue-ui'){userId=JSON.parse(Buffer.from(request.payload,'base64')).userId;send({ticket:'t'.repeat(64)});}
  else if(request.action==='redeem-ui')send({token:'m'.repeat(64),userId});
  else if(hold){release=()=>send({mode:'fixture',available:[],job:null});arrive();}
  else send({mode:'fixture',available:[],job:null});
 }));await new Promise(r=>broker.listen(root+'/broker',r));
 const g=await createGateway({port:0,runtime:root+'/relay',profile:'standalone',updater:{socketPath:root+'/broker',keyFile:root+'/key',uiOrigin:'http://127.0.0.1:4190'}});
 t.after(async()=>{release?.();await g.close();await new Promise(r=>broker.close(r));await rm(root,{recursive:true,force:true});});
 const auth=await authenticate(g.origin,root+'/relay'),api=client(g.origin,auth);
 assert.equal(auth.s.apps.find(a=>a.id==='system-updater').openMode,'window');
 for(let i=0;i<3;i++){const r=await api('/updater/state');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const text=await r.text();assert.ok(!text.includes('m'.repeat(64)));}
 assert.equal(calls.filter(a=>a==='issue-ui').length,1);assert.equal(calls.filter(a=>a==='redeem-ui').length,1);
 assert.equal((await fetch(g.origin+'/api/updater/check',{method:'POST',headers:{cookie:auth.cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(g.origin+'/api/updater/state',{headers:{cookie:auth.cookie,Origin:'http://evil.invalid'}})).status,403);
 await api('/admin/users','POST',{username:'reader',password});const ordinary=client(g.origin,await authenticate(g.origin,root+'/relay','reader'));assert.equal((await ordinary('/updater/state')).status,403);assert.equal((await ordinary('/updater/check','POST',{})).status,403);
 for(let i=0;i<20;i++)assert.equal((await api('/updater/check','POST',{})).status,200);
 assert.equal((await api('/updater/check','POST',{})).status,429);
 hold=true;const pending=api('/updater/state');await arrived;
 try{assert.equal((await api('/logout','POST',{})).status,200);}finally{release();}
 assert.equal((await pending).status,401);
});
