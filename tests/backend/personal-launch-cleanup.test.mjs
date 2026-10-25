import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const json=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json();};
test('personal late-launch cleanup is exact-window/session bound and cannot retire a valid reopened generation',{timeout:20000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/personal-launch-owner-');let g;
 try{
  g=await createGateway({port:0,runtime,profile:'standalone'});const admin=client(g.origin,await authenticate(g.origin,runtime));await admin('/admin/users','POST',{username:'owner',password});
  const auth=await authenticate(g.origin,runtime,'owner'),api=client(g.origin,auth),parallel=client(g.origin,await authenticate(g.origin,runtime,'owner'));
  const d=await json(await api('/desktop/bookmarks','POST',{parentId:null,label:'Mine',url:'https://offline.invalid/before'})),id=d.createdAppId,item=d.items.find(i=>i.appId===id);
  const old=await json(await api('/windows','POST',{appId:id}));assert.match(old.personalLaunchId,/^[a-f0-9]{64}$/);
  const path='/windows/'+id+'/retire-personal-launch',cleanup=launch=>({personalLaunchId:launch.personalLaunchId});
  assert.equal((await api(path,'POST',{personalLaunchId:['invalid']})).status,400);
  assert.equal((await fetch(g.origin+'/api'+path,{method:'POST',headers:{cookie:auth.cookie,Origin:g.origin,'Content-Type':'application/json'},body:JSON.stringify(cleanup(old))})).status,403);
  assert.equal((await parallel(path,'POST',cleanup(old))).status,200);assert.equal((await json(await api('/session'))).windows.some(w=>w.appId===id),true);
  assert.deepEqual(await json(await api(path,'POST',cleanup(old))),{retired:false},'current definition is still valid');
  await json(await api('/desktop/items/'+item.id,'PATCH',{url:'https://offline.invalid/after'}));const fresh=await json(await api('/windows','POST',{appId:id}));assert.notEqual(fresh.personalLaunchId,old.personalLaunchId);
  assert.deepEqual(await json(await api(path,'POST',cleanup(old))),{retired:false});assert.equal((await json(await api('/session'))).windows.find(w=>w.appId===id).url,'https://offline.invalid/after');
  // Identity removal leaves an unpublished Native window in this session; retire
  // only that exact old object, including idempotent cleanup after it is gone.
  await json(await api('/desktop/items/'+item.id,'DELETE'));const manager=[...g.sessions.values()].find(s=>s.csrf===auth.s.csrf).manager;assert.equal(manager.windows.has(id),true);
  assert.deepEqual(await json(await api(path,'POST',cleanup(old))),{retired:false});assert.equal(manager.windows.has(id),true,'wrong generation cannot delete');
  assert.deepEqual(await json(await api(path,'POST',cleanup(fresh))),{retired:true});assert.equal(manager.windows.has(id),false);assert.deepEqual(await json(await api(path,'POST',cleanup(fresh))),{retired:false});
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
