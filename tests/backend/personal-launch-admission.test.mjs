import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const json=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json();};

test('authenticated session observation carries only this live server window generation across owner ABA',{timeout:20000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/personal-admission-');let g;
 try{
  g=await createGateway({port:0,runtime,profile:'standalone'});const admin=client(g.origin,await authenticate(g.origin,runtime));await json(await admin('/admin/users','POST',{username:'owner',password}));
  const auth=await authenticate(g.origin,runtime,'owner'),api=client(g.origin,auth),parallel=client(g.origin,await authenticate(g.origin,runtime,'owner'));
  const d=await json(await api('/desktop/bookmarks','POST',{parentId:null,label:'Mine',url:'https://offline.invalid/a',openMode:'window'})),id=d.createdAppId,item=d.items.find(i=>i.appId===id);
  const launch=()=>api('/windows','POST',{appId:id,personalLaunchId:'f'.repeat(64),generation:999});
  let old=await json(await launch());assert.match(old.personalLaunchId,/^[a-f0-9]{64}$/);assert.notEqual(old.personalLaunchId,'f'.repeat(64),'client metadata never creates authority');
  const observed=async()=> (await json(await api('/session'))).windows.find(w=>w.id===id);
  assert.equal((await observed()).personalLaunchId,old.personalLaunchId);assert.equal((await json(await parallel('/session'))).windows.some(w=>w.id===id),false,'other session cannot observe or adopt the original window');
  await json(await parallel('/desktop/items/'+item.id,'PATCH',{label:'Renamed',icon:{type:'builtin',name:'pixel-bookmark'}}));
  await json(await parallel('/desktop/folders','POST',{parentId:null,label:'Folder'}));assert.equal((await observed()).personalLaunchId,old.personalLaunchId,'appearance/folder edits preserve live generation');
  for(const kind of ['url','mode','both']){
   const away={...(kind!=='mode'?{url:'https://offline.invalid/b'}:{}),...(kind!=='url'?{openMode:'tab'}:{})},back={...(kind!=='mode'?{url:'https://offline.invalid/a'}:{}),...(kind!=='url'?{openMode:'window'}:{})};
   await json(await parallel('/desktop/items/'+item.id,'PATCH',away));await json(await parallel('/desktop/items/'+item.id,'PATCH',back));assert.equal(await observed(),undefined);
   const fresh=await json(await launch());assert.notEqual(fresh.personalLaunchId,old.personalLaunchId);
   assert.deepEqual(await json(await api('/windows/'+id+'/retire-personal-launch','POST',{personalLaunchId:old.personalLaunchId})),{retired:false});
   assert.equal((await observed()).personalLaunchId,fresh.personalLaunchId);old=fresh;
  }
  assert.equal((await fetch(g.origin+'/api/session')).status,401);
  assert.equal((await fetch(g.origin+'/api/session',{headers:{cookie:auth.cookie,Origin:'https://foreign.invalid'}})).status,403);
  const path=g.origin+'/api/windows/'+id+'/retire-personal-launch',headers={cookie:auth.cookie,Origin:g.origin,'X-CSRF-Token':auth.s.csrf,'Content-Type':'application/json'};
  assert.equal((await fetch(path,{method:'POST',headers:{...headers,'X-CSRF-Token':'wrong'},body:JSON.stringify({personalLaunchId:old.personalLaunchId})})).status,403);
  assert.equal((await fetch(path,{method:'POST',headers,body:'{broken'})).status,400);
  assert.equal((await fetch(path,{method:'POST',headers,body:JSON.stringify({personalLaunchId:old.personalLaunchId,padding:'x'.repeat(17000)})})).status,413);
  assert.equal((await observed()).personalLaunchId,old.personalLaunchId);
  await json(await api('/logout','POST',{}));assert.equal((await api('/session')).status,401);assert.equal((await api('/windows/'+id+'/retire-personal-launch','POST',{personalLaunchId:old.personalLaunchId})).status,401);
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
