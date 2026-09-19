import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Accounts} from '../../server/accounts.mjs';
import {createGateway,APPS} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
test('missing markers migrate without replay and corrupt persisted markers refuse startup',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-firstapp-migration-');
 try{const a=new Accounts(runtime,APPS);await a.init();await a.enroll(password);const saved=JSON.parse(await readFile(runtime+'/accounts.json','utf8'));delete saved.users[0].onboardingAppId;delete saved.users[0].onboardingComplete;
 await writeFile(runtime+'/accounts.json',JSON.stringify(saved));const b=new Accounts(runtime,APPS);await b.init();assert.equal(b.state.users[0].onboardingAppId,null);assert.equal(b.state.users[0].onboardingComplete,true);
 for(const value of [false,0,{},[], '', 'parcels','service-00000000-0000-0000-0000-000000000000']){saved.users[0].onboardingAppId=value;await writeFile(runtime+'/accounts.json',JSON.stringify(saved));await assert.rejects(new Accounts(runtime,APPS).init(),/refusing enrollment/);}
 }finally{await rm(runtime,{recursive:true,force:true});}
});

test('first app rejects foreign progress targets even on an idempotent retry',()=>fixture(async(g,runtime)=>{
 const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
 assert.equal((await api('/onboarding/app','POST',draft)).status,200);
 assert.equal((await api('/onboarding/app','POST',{...draft,userId:auth.s.user.id})).status,400);
}));

test('first-app authority, CSRF and draft failures leave registry and progress unchanged',()=>fixture(async(g,runtime)=>{
 const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
 const viewer=await api('/admin/users','POST',{username:'viewer',password}).then(r=>r.json());
 const other=await api('/admin/users','POST',{username:'other',role:'admin',password}).then(r=>r.json());
 assert.equal((await fetch(g.origin+'/api/onboarding/app',{method:'POST',headers:{Origin:g.origin}})).status,401);
 for(const headers of [{},{Origin:g.origin},{'X-CSRF-Token':auth.s.csrf},{Origin:'http://evil.invalid','X-CSRF-Token':auth.s.csrf}])assert.equal((await fetch(g.origin+'/api/onboarding/app',{method:'POST',headers:{cookie:auth.cookie,...headers}})).status,403);
 const view=client(g.origin,await authenticate(g.origin,runtime,'viewer'));assert.equal((await view('/onboarding/app','POST',draft)).status,403);
 const admin=client(g.origin,await authenticate(g.origin,runtime,'other'));assert.equal((await admin('/onboarding/app','POST',draft)).status,403);
 const before=await readFile(runtime+'/accounts.json','utf8');
 for(const body of [{...draft,userId:other.id},{...draft,userIds:['missing']},{...draft,address:'http://169.254.169.254/'},{...draft,address:g.origin},{...draft,allowedOrigins:['http://169.254.169.254']},{...draft,label:''},{template:'notes-lab'},[],{}]){
  assert.equal((await api('/onboarding/app','POST',body)).status,400);assert.equal(await readFile(runtime+'/accounts.json','utf8'),before);
 }
 assert.equal(g.accounts.state.users[0].onboardingAppId,null);assert.deepEqual(g.accounts.state.users.find(u=>u.id===viewer.id).grants,[]);
 await admin('/admin/users/'+auth.s.user.id,'PATCH',{password});const forced=client(g.origin,await authenticate(g.origin,runtime));assert.equal((await forced('/onboarding/app','POST',draft)).status,403);
 assert.equal((await forced('/profile','PATCH',{currentPassword:password,password:password+'new'})).status,200);
 const recovered=client(g.origin,await authenticate(g.origin,runtime,'admin',password+'new'));
 assert.equal((await recovered('/onboarding/complete','POST',{})).status,200);assert.equal((await recovered('/onboarding/app','POST',draft)).status,403);
 assert.equal((await recovered('/admin/apps','POST',draft)).status,200);
}));

test('first-app writes recheck queued authority after revocation',()=>fixture(async(g,runtime)=>{
 const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);await api('/admin/users','POST',{username:'other',role:'admin',password});
 let entered,release;const started=new Promise(r=>entered=r),blocked=new Promise(r=>release=r),original=g.accounts.updateUser.bind(g.accounts);
 g.accounts.updateUser=async(...args)=>{entered();await blocked;return original(...args);};
 const disable=api('/admin/users/'+auth.s.user.id,'PATCH',{disabled:true});await started;
 let listener,timer;const arrived=new Promise(resolve=>{listener=req=>{if((req.originalUrl||req.url)==='/api/onboarding/app')resolve();};g.server.on('request',listener);});
 const pending=api('/onboarding/app','POST',draft);
 try{await Promise.race([arrived,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Request did not arrive')),2000);})]);}finally{clearTimeout(timer);g.server.off('request',listener);release();}
 assert.equal((await disable).status,200);assert.equal((await pending).status,401);assert.equal(g.accounts.state.users[0].onboardingAppId,null);assert.equal(g.accounts.state.services.length,APPS.length);
}));

test('a lost committed response is safely retried from server progress',()=>fixture(async(g,runtime)=>{
 const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
 const drop=(req,res)=>{if((req.originalUrl||req.url)==='/api/onboarding/app')res.json=()=>res.destroy();};
 g.server.on('request',drop);
 try{await assert.rejects(api('/onboarding/app','POST',draft));}finally{g.server.off('request',drop);}
 const committed=g.accounts.state.users[0].onboardingAppId;assert.ok(committed);
 const retry=await api('/onboarding/app','POST',draft);assert.equal(retry.status,200);assert.equal((await retry.json()).id,committed);assert.equal(g.accounts.state.services.length,APPS.length+1);
}));

const draft={kind:'web',mode:'native',label:'First app',address:'https://device-only.invalid/'};
async function fixture(fn){const runtime=await mkdtemp(tmpdir()+'/relay-firstapp-');let g;try{g=await createGateway({port:0,runtime});await fn(g,runtime);}finally{await g?.close();await rm(runtime,{recursive:true,force:true});}}

test('first app retries atomically reuse one persisted app and grants, including gateway restart',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-firstapp-restart-');let g;
 try{g=await createGateway({port:0,runtime});const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
 assert.equal(auth.s.user.onboardingAppId,null);
 const viewer=await api('/admin/users','POST',{username:'viewer',password}).then(r=>r.json());assert.equal(viewer.onboardingAppId,null);
 const body={...draft,userIds:[viewer.id]};const responses=await Promise.all(Array.from({length:4},()=>api('/onboarding/app','POST',body)));
 for(const r of responses)assert.equal(r.status,200);const apps=await Promise.all(responses.map(r=>r.json()));for(const app of apps)assert.deepEqual(app,apps[0]);
 const saved=apps[0];assert.equal((await api('/onboarding/app','POST',body).then(r=>r.json())).id,saved.id);
 assert.equal((await api('/admin/apps').then(r=>r.json())).length,APPS.length+1);
 assert.equal((await api('/session').then(r=>r.json())).user.onboardingAppId,saved.id);
 const disk=JSON.parse(await readFile(runtime+'/accounts.json','utf8'));assert.equal(disk.users[0].onboardingAppId,saved.id);assert.deepEqual(disk.users.find(u=>u.id===viewer.id).grants,[saved.id]);
 const view=client(g.origin,await authenticate(g.origin,runtime,'viewer'));assert.ok((await view('/session').then(r=>r.json())).apps.some(a=>a.id===saved.id));
 await g.close();g=null;g=await createGateway({port:0,runtime});const resumed=await authenticate(g.origin,runtime),retry=client(g.origin,resumed);
 assert.equal(resumed.s.user.onboardingAppId,saved.id);assert.deepEqual(await retry('/onboarding/app','POST',body).then(r=>r.json()),saved);assert.equal(g.accounts.state.services.length,APPS.length+1);
 assert.equal((await retry('/admin/apps/'+saved.id,'DELETE')).status,200);assert.equal((await retry('/session').then(r=>r.json())).user.onboardingAppId,null);
 const replacement=await retry('/onboarding/app','POST',body).then(r=>r.json());assert.notEqual(replacement.id,saved.id);assert.ok(replacement.id);
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
