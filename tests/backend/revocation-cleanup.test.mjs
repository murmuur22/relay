import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {launchBrowser} from '../../server/web-browser.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('revocation deadline: '+label)),4000))]);}finally{clearTimeout(timer);}}
for(const action of ['logout','demotion','service-removal','grants','password','expiry'])test('revoked cleanup remains reachable until acknowledged: '+action,{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/revoke-owned-'),g=await createGateway({port:0,runtime:root});const browsers=[],restores=[];const ack=deferred();let retry;
 try{
  const auth=await authenticate(g.origin,root),admin=client(g.origin,auth);
  assert.equal((await admin('/admin/users','POST',{username:'operator',role:'admin',password})).status,200);
  const operator=client(g.origin,await authenticate(g.origin,root,'operator'));
  let owner=admin,ownerId=auth.s.user.id;
  if(['service-removal','grants'].includes(action)){
   const response=await admin('/admin/users','POST',{username:'viewer',password,grants:['notes-lab']});assert.equal(response.status,200);ownerId=(await response.json()).id;owner=client(g.origin,await authenticate(g.origin,root,'viewer'));
  }
  const s=[...g.sessions.values()].find(s=>s.userId===ownerId),m=s.manager;
  const b=await launchBrowser();browsers.push(b);m.browserPromise=Promise.resolve(b);
  assert.equal((await owner('/windows','POST',{appId:'notes-lab'})).status,200);
  const r=await bounded(m.ensure(m.windows.get('notes-lab')),'real context');const realClose=b.close.bind(b);restores.push(()=>{b.close=realClose;});
  // Also exercise another affected session: its retirement must not be skipped.
  let otherResource;
  if(action==='service-removal'){
   const response=await admin('/admin/users','POST',{username:'second',password,grants:['notes-lab']});assert.equal(response.status,200);
   const second=client(g.origin,await authenticate(g.origin,root,'second')),other=[...g.sessions.values()].find(x=>x.userId!==ownerId&&x.user.username==='second');
   const otherBrowser=await launchBrowser();browsers.push(otherBrowser);other.manager.browserPromise=Promise.resolve(otherBrowser);
   await second('/windows','POST',{appId:'notes-lab'});otherResource=await bounded(other.manager.ensure(other.manager.windows.get('notes-lab')),'second resource');
  }
  let attempts=0;r.context.close=async()=>{throw Error('injected context close failure');};b.close=async()=>{attempts++;throw Error('injected browser close failure');};
  let response;
  if(action==='expiry'){s.expires=0;response=await owner('/session');assert.equal(response.status,401);await bounded(s.cleanup,'expiry cleanup');}
  else{
   response=await bounded(action==='logout'?owner('/logout','POST',{}):action==='demotion'?operator('/admin/users/'+ownerId,'PATCH',{role:'user'}):action==='service-removal'?admin('/admin/services/notes-lab','DELETE'):action==='grants'?admin('/admin/users/'+ownerId,'PATCH',{grants:[]}):owner('/profile','PATCH',{currentPassword:password,password:password+'-changed'}),'mutation');
   assert.equal(response.status,503,'applied revocation must not claim acknowledged cleanup');assert.match((await response.json()).error,/applied|changed|revoked/i);
  }
  assert.equal((await owner('/session')).status,401);assert.equal((await operator('/session')).status,200);
  assert.equal(g.sessions.has(s.id),false);assert.equal(g.retiringSessions.get(s.id),s);assert.equal(g.retiringSessions.size,1);
  assert.equal(m.pendingRetirement.get('notes-lab'),r);assert.equal(m.resources.size,0);assert.equal(r.disposed,true);assert.equal(r.page.isClosed(),false);assert.ok(b.contexts().includes(r.context));
  if(action==='demotion')assert.equal(g.accounts.state.users.find(x=>x.id===ownerId).role,'user');
  if(action==='grants')assert.deepEqual(g.accounts.state.users.find(x=>x.id===ownerId).grants,[]);
  if(action==='service-removal'){assert.equal(g.accounts.state.services.some(x=>x.id==='notes-lab'),false);assert.equal(otherResource.page.isClosed(),true);}
  assert.equal((await owner('/logout','POST',{})).status,401);assert.equal(g.retiringSessions.size,1);
  const failed=await bounded(Promise.allSettled([g.close(),g.close()]),'repeated failed shutdown');
  assert.ok(failed.every(x=>x.status==='rejected'&&x.reason.status===503));
  assert.equal(g.retiringSessions.get(s.id),s);assert.equal(m.pendingRetirement.get('notes-lab'),r);assert.equal(r.page.isClosed(),false);assert.equal(g.server.listening,false);
  const entered=deferred();b.close=async()=>{attempts++;entered.resolve();await ack.promise;return realClose();};
  let completed=false;retry=g.close().then(()=>{completed=true;});await bounded(entered.promise,'retry entered');
  assert.equal(completed,false);assert.equal(g.retiringSessions.get(s.id),s);assert.equal(m.pendingRetirement.get('notes-lab'),r);assert.equal(r.page.isClosed(),false);
  ack.resolve();await bounded(retry,'acknowledged shutdown');
  assert.equal(r.page.isClosed(),true);assert.equal(b.contexts().length,0);assert.equal(b.isConnected(),false);assert.equal(m.pendingRetirement.size,0);assert.equal(g.retiringSessions.size,0);assert.equal(g.sessions.size,0);
  const before=attempts;await bounded(g.close(),'idempotent shutdown');assert.equal(attempts,before);
  console.log('REVOCATION accepted',JSON.stringify({action,attempts,retiring:g.retiringSessions.size,pageClosed:r.page.isClosed(),contexts:b.contexts().length}));
 }finally{ack.resolve();for(const restore of restores)restore();if(retry)await retry.catch(()=>{});for(const b of browsers)await b.close();await bounded(g.close(),'fixture shutdown');await rm(root,{recursive:true,force:true});}
});

test('failed retirements consume the existing per-user session bound',{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/revoke-bound-'),g=await createGateway({port:0,runtime:root});const managers=[];
 try{
  for(let i=0;i<4;i++){
   const auth=await authenticate(g.origin,root),api=client(g.origin,auth),s=[...g.sessions.values()][0];
   // Admission proof without resource fabrication: inject only the close rejection.
   const close=s.manager.close.bind(s.manager);s.manager.close=async()=>{throw Error('injected cleanup rejection');};managers.push(()=>{s.manager.close=close;});
   assert.equal((await api('/logout','POST',{})).status,503);assert.equal(g.retiringSessions.size,i+1);assert.equal(g.sessions.size,0);
  }
  const info=await(await fetch(g.origin+'/api/auth')).json();
  const response=await fetch(g.origin+'/api/login',{method:'POST',headers:{Origin:g.origin,'Content-Type':'application/json','X-CSRF-Token':info.csrf},body:JSON.stringify({username:'admin',password})});
  assert.equal(response.status,429);assert.equal(g.retiringSessions.size,4);assert.equal(g.sessions.size,0);
  for(const restore of managers)restore();await g.close();assert.equal(g.retiringSessions.size,0);
 }finally{for(const restore of managers)restore();await g.close();await rm(root,{recursive:true,force:true});}
});
