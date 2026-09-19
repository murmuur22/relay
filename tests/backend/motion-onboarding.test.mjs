import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Accounts} from '../../server/accounts.mjs';
import {createGateway,APPS} from '../../server/gateway.mjs';
import {authenticate,browserLogin,client,password} from '../auth-helper.mjs';
const defaults={showAppStatus:true,introAnimation:true,interfaceAnimations:true};

test('onboarding enrollment, authorized completion and restart persistence',()=>fixture(async(g,runtime)=>{
 const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
 assert.equal(auth.s.user.onboardingComplete,false);assert.deepEqual(auth.s.user.preferences,defaults);
 const other=await (await api('/admin/users','POST',{username:'other',password,role:'admin',onboardingComplete:false})).json();assert.equal(other.onboardingComplete,true);
 assert.equal((await api('/admin/users/'+auth.s.user.id,'PATCH',{disabled:true})).status,200);
 // Re-enable through the other administrator; old owner session must remain revoked.
 const admin=client(g.origin,await authenticate(g.origin,runtime,'other'));
 assert.equal((await api('/onboarding/complete','POST',{})).status,401);
 assert.equal((await admin('/admin/users/'+auth.s.user.id,'PATCH',{disabled:false})).status,200);
 const owner=await authenticate(g.origin,runtime),own=client(g.origin,owner);
 for(const headers of [{},{Origin:g.origin},{Origin:'http://evil.invalid','X-CSRF-Token':owner.s.csrf},{'X-CSRF-Token':owner.s.csrf}]){
  assert.equal((await fetch(g.origin+'/api/onboarding/complete',{method:'POST',headers:{cookie:owner.cookie,...headers}})).status,403);
 }
 assert.equal((await fetch(g.origin+'/api/onboarding/complete',{method:'POST',headers:{Origin:g.origin}})).status,401);
 for(const body of [{id:other.id},{onboardingComplete:false},[],null])assert.equal((await fetch(g.origin+'/api/onboarding/complete',{method:'POST',headers:{cookie:owner.cookie,Origin:g.origin,'X-CSRF-Token':owner.s.csrf,'Content-Type':'application/json'},body:JSON.stringify(body)})).status,400);
 assert.equal((await own('/session').then(r=>r.json())).user.onboardingComplete,false);
 // The pending flag survives loading persisted state and does not gate existing permissions.
 const pending=new Accounts(runtime,APPS);await pending.init();assert.equal(pending.state.users[0].onboardingComplete,false);assert.ok(pending.apps(pending.state.users[0]).length);
 assert.equal((await own('/onboarding/complete','POST')).status,200);
 assert.equal((await own('/onboarding/complete','POST',{})).status,200);
 assert.deepEqual((await own('/session').then(r=>r.json())).user,{...owner.s.user,onboardingComplete:true});
 const complete=new Accounts(runtime,APPS);await complete.init();assert.equal(complete.state.users[0].onboardingComplete,true);
 const viewer=await (await own('/admin/users','POST',{username:'viewer',password})).json();assert.equal(viewer.onboardingComplete,true);
 const view=client(g.origin,await authenticate(g.origin,runtime,'viewer'));assert.equal((await view('/onboarding/complete','POST',{})).status,403);
 await own('/admin/users/'+other.id,'PATCH',{password});const forced=client(g.origin,await authenticate(g.origin,runtime,'other'));assert.equal((await forced('/onboarding/complete','POST',{})).status,403);
 await own('/admin/users/'+other.id,'PATCH',{disabled:true});assert.equal((await own('/admin/users/'+owner.s.user.id,'PATCH',{disabled:true})).status,400);
}));

test('legacy onboarding is complete but malformed persisted flags refuse startup',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-onboarding-migration-');
 try{const a=new Accounts(runtime,APPS);await a.init();await a.enroll(password);const saved=JSON.parse(await readFile(runtime+'/accounts.json','utf8'));delete saved.users[0].onboardingComplete;
 await writeFile(runtime+'/accounts.json',JSON.stringify(saved));const b=new Accounts(runtime,APPS);await b.init();assert.equal(b.state.users[0].onboardingComplete,true);
 for(const value of [null,0,'false',{},[]]){saved.users[0].onboardingComplete=value;await writeFile(runtime+'/accounts.json',JSON.stringify(saved));await assert.rejects(new Accounts(runtime,APPS).init(),/refusing enrollment/);}
 }finally{await rm(runtime,{recursive:true,force:true});}
});
test('baseline browserLogin uses production APIs while raw authentication leaves onboarding and motion untouched',()=>fixture(async(g,runtime)=>{
 const raw=await authenticate(g.origin,runtime);assert.equal(raw.s.user.onboardingComplete,false);assert.deepEqual(raw.s.user.preferences,defaults);
 let cookies,visited;const page={context:()=>({addCookies:async value=>{cookies=value;}}),goto:async value=>{visited=value;}};
 await browserLogin(page,g.origin,runtime);assert.equal(visited,g.origin);assert.equal(cookies[0].name,'relay_session');
 const current=await client(g.origin,raw)('/session').then(r=>r.json());assert.equal(current.user.onboardingComplete,true);assert.deepEqual(current.user.preferences,{showAppStatus:true,introAnimation:false,interfaceAnimations:false});
}));

test('completion queued behind revocation cannot complete the revoked caller',()=>fixture(async(g,runtime)=>{
 const owner=await authenticate(g.origin,runtime),api=client(g.origin,owner);
 await api('/admin/users','POST',{username:'other',role:'admin',password});
 let entered,release;const started=new Promise(r=>entered=r);const blocked=new Promise(r=>release=r);
 const original=g.accounts.updateUser.bind(g.accounts);g.accounts.updateUser=async(...args)=>{entered();await blocked;return original(...args);};
 const disable=api('/admin/users/'+owner.s.user.id,'PATCH',{disabled:true});await started;
 let listener,timer;
 const arrived=new Promise(resolve=>{listener=req=>{if((req.originalUrl||req.url)==='/api/onboarding/complete')resolve();};g.server.on('request',listener);});
 const pending=api('/onboarding/complete','POST',{});
 // Express can temporarily strip mounted prefixes from req.url; use originalUrl.
 try{await Promise.race([arrived,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Completion request did not arrive')),2000);})]);}
 finally{clearTimeout(timer);g.server.off('request',listener);release();}
 assert.equal((await disable).status,200);assert.equal((await pending).status,401);assert.equal(g.accounts.state.users[0].onboardingComplete,false);
}));

test('gateway restart preserves pending then completed onboarding and motion settings',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-motion-restart-');let g;
 try{g=await createGateway({port:0,runtime});const raw=await authenticate(g.origin,runtime);let api=client(g.origin,raw);
 await api('/preferences','PATCH',{introAnimation:false});await g.close();g=null;
 g=await createGateway({port:0,runtime});assert.equal((await client(g.origin,raw)('/session')).status,401);
 const resumed=await authenticate(g.origin,runtime);assert.equal(resumed.s.user.onboardingComplete,false);assert.deepEqual(resumed.s.user.preferences,{...defaults,introAnimation:false});
 api=client(g.origin,resumed);assert.equal((await api('/onboarding/complete','POST',{})).status,200);await g.close();g=null;
 g=await createGateway({port:0,runtime});const complete=await authenticate(g.origin,runtime);assert.equal(complete.s.user.onboardingComplete,true);assert.deepEqual(complete.s.user.preferences,{...defaults,introAnimation:false});
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});

async function fixture(fn){const runtime=await mkdtemp(tmpdir()+'/relay-motion-');let g;try{g=await createGateway({port:0,runtime});await fn(g,runtime);}finally{await g?.close();await rm(runtime,{recursive:true,force:true});}}

test('motion preferences merge partial concurrent writes without changing authority or sessions',()=>fixture(async(g,runtime)=>{
 const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
 assert.deepEqual(auth.s.user.preferences,defaults);
 const responses=await Promise.all([api('/preferences','PATCH',{introAnimation:false}),api('/preferences','PATCH',{interfaceAnimations:false})]);
 for(const r of responses)assert.equal(r.status,200);
 assert.equal((await api('/preferences','PATCH',{showAppStatus:false})).status,200);
 const second=await authenticate(g.origin,runtime);const expected={showAppStatus:false,introAnimation:false,interfaceAnimations:false};
 assert.deepEqual(second.s.user.preferences,expected);
 const current=await (await api('/session')).json();assert.deepEqual(current.user,{...auth.s.user,preferences:expected});
 for(const body of [{},null,[],false,{introAnimation:0},{interfaceAnimations:null},{extra:true},{role:'admin'},{showAppStatus:'false'}]){
  const r=await fetch(g.origin+'/api/preferences',{method:'PATCH',headers:{cookie:auth.cookie,Origin:g.origin,'X-CSRF-Token':auth.s.csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,400);
 }
 const disk=new Accounts(runtime,APPS);await disk.init();assert.deepEqual(disk.state.users[0].preferences,expected);
}));

test('legacy motion preferences migrate while invalid persisted preferences fail closed',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-motion-migration-');
 try{const a=new Accounts(runtime,APPS);await a.init();await a.enroll(password);const saved=JSON.parse(await readFile(runtime+'/accounts.json','utf8'));
 for(const preferences of [undefined,{showAppStatus:false},{showAppStatus:true,introAnimation:false}]){
  if(preferences===undefined)delete saved.users[0].preferences;else saved.users[0].preferences=preferences;
  await writeFile(runtime+'/accounts.json',JSON.stringify(saved));const b=new Accounts(runtime,APPS);await b.init();assert.deepEqual(b.state.users[0].preferences,{...defaults,...preferences});
 }
 for(const preferences of [null,[],false,{}, {introAnimation:false},{showAppStatus:'false'},{showAppStatus:true,introAnimation:null},{showAppStatus:true,interfaceAnimations:1},{showAppStatus:true,unknown:true}]){
  saved.users[0].preferences=preferences;await writeFile(runtime+'/accounts.json',JSON.stringify(saved));await assert.rejects(new Accounts(runtime,APPS).init(),/refusing enrollment/);
 }
 }finally{await rm(runtime,{recursive:true,force:true});}
});
