import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import WebSocket from 'ws';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
async function fixture(fn,options={}){const runtime=await mkdtemp(tmpdir()+'/relay-acl-');let g;try{g=await createGateway({port:0,runtime,...options});await fn(g,runtime);}finally{await g?.close();await rm(runtime,{recursive:true,force:true});}}
test('admin user lifecycle, native/REST grants, profile passwords, registry and last admin protection',async()=>fixture(async(g,runtime)=>{
 const admin=await authenticate(g.origin,runtime),a=client(g.origin,admin);
 let r=await a('/admin/users','POST',{username:'alice',displayName:'Alice',password,role:'user',grants:['parcels','notes-lab']});assert.equal(r.status,200);const alice=await r.json();
 assert.equal((await a('/admin/users','POST',{username:'../escape',password,role:'user',grants:[]})).status,400);
 assert.equal((await a('/admin/users','POST',{username:['arrayname'],displayName:'Array name',password,role:'user',grants:[]})).status,400);
 const auth=await authenticate(g.origin,runtime,'alice'),u=client(g.origin,auth);
 assert.deepEqual(auth.s.apps.map(a=>a.id),['parcels','notes-lab']);
 assert.equal((await u('/admin/users')).status,403);
 assert.equal((await u('/windows','POST',{appId:'keepsakes'})).status,403);
 assert.equal((await fetch(g.origin+'/native/keepsakes/',{headers:{cookie:auth.cookie}})).status,403);
 assert.equal((await u('/windows','POST',{appId:'notes-lab'})).status,200);
 assert.equal((await a('/session').then(r=>r.json())).windows.length,0);
 assert.equal((await a('/admin/users/'+admin.s.user.id,'PATCH',{disabled:true})).status,400);
 assert.equal((await a('/admin/users/'+admin.s.user.id,'PATCH',{role:'user'})).status,400);
 assert.equal((await u('/profile','PATCH',{displayName:'Changed',currentPassword:'wrong'})).status,401);
 assert.equal((await u('/profile','PATCH',{displayName:'Changed',currentPassword:password})).status,200);
 assert.equal((await u('/profile','PATCH',{currentPassword:password,password:'Replacement-passphrase-42!'})).status,200);
 assert.equal((await u('/session')).status,401);
 const changed=await authenticate(g.origin,runtime,'alice','Replacement-passphrase-42!');assert.equal(changed.s.user.displayName,'Changed');
 r=await a('/admin/services','POST',{template:'notes-lab',label:'My notes'});assert.equal(r.status,200);const service=await r.json();
 assert.equal(service.mode,'stream');assert.notEqual(service.id,'notes-lab');
 assert.equal((await a('/admin/services','POST',{template:'notes-lab',label:'Unsafe',url:'http://169.254.169.254/'})).status,400);
 assert.equal((await a('/admin/users/'+alice.id,'PATCH',{grants:[service.id]})).status,200);
 assert.equal((await client(g.origin,changed)('/session')).status,401);
 const granted=await authenticate(g.origin,runtime,'alice','Replacement-passphrase-42!');assert.deepEqual(granted.s.apps.map(a=>a.id),[service.id]);
 assert.equal((await a('/admin/services/'+service.id,'PATCH',{enabled:false,label:'Renamed'})).status,200);
 assert.equal((await client(g.origin,granted)('/session')).status,401);
 assert.equal((await a('/admin/services/'+service.id,'DELETE')).status,200);
 assert.equal((await a('/admin/services').then(r=>r.json())).some(x=>x.id===service.id),false);
 const diag=await a('/admin/diagnostics').then(r=>r.json());assert.equal(diag.version,'0.1.0');assert.ok(diag.sessions>=1);assert.ok(!JSON.stringify(diag).includes(admin.cookie));
 assert.equal((await a('/admin/users/'+alice.id,'PATCH',{password})).status,200);
 const reset=await authenticate(g.origin,runtime,'alice');assert.equal(reset.s.user.mustChange,true);assert.deepEqual(reset.s.apps,[]);
 assert.equal((await client(g.origin,reset)('/windows','POST',{appId:'parcels'})).status,403);
 assert.equal((await client(g.origin,reset)('/profile','PATCH',{currentPassword:password,password:'Fresh-replacement-passphrase!'})).status,200);
 assert.equal((await a('/admin/users/'+alice.id,'PATCH',{disabled:true})).status,200);
}));
test('bounded login throttle, CSRF, finite expiry, logout and corrupt-state refusal',async()=>{
 await fixture(async(g,runtime)=>{
  const admin=await authenticate(g.origin,runtime),a=client(g.origin,admin);
  assert.equal((await fetch(g.origin+'/api/logout',{method:'POST',headers:{cookie:admin.cookie}})).status,403);
  assert.equal((await a('/logout','POST')).status,200);assert.equal((await a('/session')).status,401);
  const info=await (await fetch(g.origin+'/api/auth')).json();
  const headers={Origin:g.origin,'Content-Type':'application/json','X-CSRF-Token':info.csrf};
  assert.equal((await fetch(g.origin+'/api/login',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})).status,403);
  for(let i=0;i<5;i++)assert.equal((await fetch(g.origin+'/api/login',{method:'POST',headers,body:JSON.stringify({username:i===0?'admin':'unknown',password:'Incorrect-synthetic-passphrase'})})).status,401);
  assert.equal((await fetch(g.origin+'/api/login',{method:'POST',headers,body:JSON.stringify({username:'admin',password})})).status,429);
 });
 await fixture(async(g,runtime)=>{const a=await authenticate(g.origin,runtime);await new Promise(r=>setTimeout(r,180));assert.equal((await client(g.origin,a)('/session')).status,401);},{sessionMs:120});
 const runtime=await mkdtemp(tmpdir()+'/relay-corrupt-');try{await writeFile(runtime+'/accounts.json','{');await assert.rejects(createGateway({port:0,runtime}),/refusing enrollment/);}finally{await rm(runtime,{recursive:true,force:true});}
});
