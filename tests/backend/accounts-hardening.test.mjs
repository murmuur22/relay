import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
async function fixture(fn){const runtime=await mkdtemp(tmpdir()+'/relay-hardening-');const g=await createGateway({port:0,runtime});try{await fn(g,runtime);}finally{await g.close();await rm(runtime,{recursive:true,force:true});}}
test('restored layouts cannot exceed per-user stream reservation cap',async()=>fixture(async(g,runtime)=>{
 const first=await authenticate(g.origin,runtime),a=client(g.origin,first);await a('/windows','POST',{appId:'notes-lab'});await a('/windows','POST',{appId:'signal-lab'});await a('/logout','POST');
 const second=await authenticate(g.origin,runtime),b=client(g.origin,second);assert.equal(second.s.windows.length,2);
 const third=await authenticate(g.origin,runtime);assert.equal(third.s.windows.length,0);
 assert.equal((await client(g.origin,third)('/windows','POST',{appId:'notes-lab'})).status,429);
 const layout=runtime+'/users/'+first.s.user.id+'/layout.json';const saved=await readFile(layout,'utf8');
 await b('/windows/signal-lab','DELETE');await writeFile(layout,saved);
 const fourth=await authenticate(g.origin,runtime);const streams=[...g.sessions.values()].reduce((n,s)=>n+[...s.manager.windows.values()].filter(w=>w.mode==='stream').length,0);assert.ok(streams<=2);
 assert.equal(fourth.s.windows.length,1);
}));
test('duplicate synthetic templates use independent contexts and labels are text, never HTML',{timeout:15000},async()=>fixture(async(g,runtime)=>{
 const auth=await authenticate(g.origin,runtime),a=client(g.origin,auth);
 const label='<img src=x onerror="window.injected=true">';
 const first=await a('/admin/services','POST',{template:'notes-lab',label}).then(r=>r.json());const second=await a('/admin/services','POST',{template:'notes-lab',label:'Second notes'}).then(r=>r.json());
 for(const id of [first.id,second.id])await a('/windows','POST',{appId:id});
 const [r1,r2]=await Promise.all([g.manager.ensure(g.manager.windows.get(first.id)),g.manager.ensure(g.manager.windows.get(second.id))]);
 assert.notEqual(r1.context,r2.context);assert.equal(await r1.page.locator('img').count(),0);assert.equal(await r1.page.locator('h1').textContent(),label+' / synthetic');
 await r1.page.locator('textarea').fill('one');assert.equal(await r2.page.locator('textarea').inputValue(),'');
 assert.equal((await a('/admin/services/'+first.id,'PATCH',{enabled:false})).status,200);assert.equal(g.manager.resources.has(first.id),false);
}));
test('native revocation aborts an in-flight admin response on service disable',async()=>fixture(async(g,runtime)=>{
 const auth=await authenticate(g.origin,runtime),a=client(g.origin,auth),session=[...g.sessions.values()][0];
 // Track an in-flight response at the same gateway seam used by native proxying.
 let destroyed=false;const response={serviceId:'keepsakes',destroy(){destroyed=true;}};session.responses.add(response);
 assert.equal((await a('/admin/services/keepsakes','PATCH',{enabled:false})).status,200);assert.equal(destroyed,true);session.responses.delete(response);
}));
test('global stream and per-user session caps reject excess reservations',async()=>fixture(async(g,runtime)=>{
 const owner=await authenticate(g.origin,runtime),a=client(g.origin,owner);
 for(let i=0;i<4;i++){
  const username='user'+i;await a('/admin/users','POST',{username,password,grants:['notes-lab','signal-lab']});const auth=await authenticate(g.origin,runtime,username),u=client(g.origin,auth);
  assert.equal((await u('/windows','POST',{appId:'notes-lab'})).status,200);assert.equal((await u('/windows','POST',{appId:'signal-lab'})).status,200);
 }
 assert.equal((await a('/windows','POST',{appId:'notes-lab'})).status,429);
 for(let i=0;i<3;i++)await authenticate(g.origin,runtime);
 const info=await (await fetch(g.origin+'/api/auth')).json();
 const response=await fetch(g.origin+'/api/login',{method:'POST',headers:{Origin:g.origin,'Content-Type':'application/json','X-CSRF-Token':info.csrf},body:JSON.stringify({username:'admin',password})});assert.equal(response.status,429);
}));
test('queued mutations recheck authorization after the caller is disabled',async()=>fixture(async(g,runtime)=>{
 const owner=await authenticate(g.origin,runtime),a=client(g.origin,owner);
 await a('/admin/users','POST',{username:'otheradmin',password,role:'admin'});
 const auth=await authenticate(g.origin,runtime,'otheradmin'),b=client(g.origin,auth);
 let unblock;g.accounts.queue=new Promise(r=>unblock=r);
 const disable=b('/admin/users/'+auth.s.user.id,'PATCH',{disabled:true});
 await new Promise(r=>setTimeout(r,30));
 const stale=b('/admin/users','POST',{username:'staleuser',password,role:'admin'});
 await new Promise(r=>setTimeout(r,30));unblock();
 assert.equal((await disable).status,200);assert.equal((await stale).status,401);
 assert.equal(g.accounts.state.users.some(u=>u.username==='staleuser'),false);
}));
test('accounts, unique salts, grants and registry survive restart without reviving sessions',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-persistent-acl-');let g;
 try{
  g=await createGateway({port:0,runtime});const owner=await authenticate(g.origin,runtime),a=client(g.origin,owner);
  const service=await a('/admin/services','POST',{template:'signal-lab',label:'Persistent signals'}).then(r=>r.json());
  const alice=await a('/admin/users','POST',{username:'alice',password,grants:[service.id]}).then(r=>r.json());const auth=await authenticate(g.origin,runtime,'alice');
  const disk=JSON.parse(await readFile(runtime+'/accounts.json','utf8'));assert.notEqual(disk.users[0].password.salt,disk.users[1].password.salt);assert.notEqual(disk.users[0].password.key,disk.users[1].password.key);
  await g.close();g=await createGateway({port:0,runtime});assert.equal((await client(g.origin,auth)('/session')).status,401);
  const next=await authenticate(g.origin,runtime,'alice');assert.equal(next.s.user.id,alice.id);assert.deepEqual(next.s.apps.map(s=>s.id),[service.id]);assert.equal(next.s.apps[0].label,'Persistent signals');
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
test('malformed persisted registry fails closed rather than admitting arbitrary URLs',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-corrupt-registry-');let g=await createGateway({port:0,runtime});try{await authenticate(g.origin,runtime);await g.close();g=null;const state=JSON.parse(await readFile(runtime+'/accounts.json','utf8'));state.services[0].url='http://169.254.169.254/';await writeFile(runtime+'/accounts.json',JSON.stringify(state));await assert.rejects(createGateway({port:0,runtime}),/refusing enrollment/);}finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
