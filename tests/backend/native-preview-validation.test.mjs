import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';

async function fixture(t){
 const runtime=await mkdtemp(tmpdir()+'/relay-native-validation-');
 const relay=await createGateway({port:0,runtime,profile:'standalone'});
 t.after(async()=>{await relay.close();await rm(runtime,{recursive:true,force:true});});
 const auth=await authenticate(relay.origin,runtime),api=client(relay.origin,auth);
 const draft={kind:'web',mode:'native',label:'Client only',address:'https://client-only.invalid/',openMode:'window',userIds:[]};
 return {runtime,relay,auth,api,draft};
}
test('syntax-only preview validation requires live administrator, exact Origin and CSRF',{timeout:15000},async t=>{
 const f=await fixture(t),{relay,auth,api,draft}=f;
 const request=headers=>fetch(relay.origin+'/api/admin/apps/validate',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(draft)});
 assert.equal((await request({Origin:relay.origin})).status,401);
 assert.equal((await request({cookie:auth.cookie,Origin:relay.origin})).status,403);
 assert.equal((await request({cookie:auth.cookie,Origin:'https://wrong.example.test','x-csrf-token':auth.s.csrf})).status,403);
 assert.equal((await api('/admin/users','POST',{username:'reader',password,role:'user'})).status,200);
 const reader=client(relay.origin,await authenticate(relay.origin,f.runtime,'reader'));
 assert.equal((await reader('/admin/apps/validate','POST',draft)).status,403);
 const allowed=await api('/admin/apps/validate','POST',draft);assert.equal(allowed.status,200);assert.deepEqual(await allowed.json(),{valid:true});
 assert.equal((await api('/logout','POST',{})).status,200);
 assert.equal((await api('/admin/apps/validate','POST',draft)).status,401);
});
test('preview validation and Native registration accept client-only/offline DNS without mutating validation or relaxing hostname/literal policy',{timeout:15000},async t=>{
 const {api,draft}=await fixture(t);
 assert.deepEqual(await(await api('/admin/apps')).json(),[]);
 for(const address of [draft.address,'https://offline.invalid:9443/']){
  const response=await api('/admin/apps/validate','POST',{...draft,address});assert.equal(response.status,200);assert.deepEqual(await response.json(),{valid:true});
 }
 assert.deepEqual(await(await api('/admin/apps')).json(),[],'validation does not register apps');
 for(const address of ['https://127.0.0.1:9443/','http://169.254.169.254/','file:///tmp/example','https://user:password@example.test/'])assert.equal((await api('/admin/apps/validate','POST',{...draft,address})).status,400);
 assert.equal((await api('/admin/apps','POST',draft)).status,200,'registration remains syntax-only, not DNS/reachability');
});
