import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Desktop} from '../../server/desktop.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
test('desktop quotas, cross-folder collisions, concurrent persistence and restart',{timeout:20000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-desktop-quota-');let g;try{g=await createGateway({port:0,runtime});let auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);const own=auth.s.user.id;let d=await (await api('/desktop')).json();const apps=d.items;
 const create=async label=>{const r=await api('/desktop/folders','POST',{parentId:null,label});assert.equal(r.status,200);return r.json();};const folder=(await create('A')).itemId;
 await api('/desktop/items/'+apps[0].id,'PATCH',{parentId:folder,slot:0});d=await (await api('/desktop/items/'+apps[1].id,'PATCH',{parentId:folder,slot:0})).json();assert.equal(d.items.find(i=>i.id===apps[0].id).slot,1);assert.equal(d.items.find(i=>i.id===apps[1].id).slot,0);
 await Promise.all(Array.from({length:16},(_,n)=>create('Concurrent '+n)));d=await (await api('/desktop')).json();assert.equal(d.items.filter(i=>i.kind==='folder').length,17);assert.equal(new Set(d.items.map(i=>i.key)).size,d.items.length);
 const store=new Desktop(runtime),path=runtime+'/users/'+own+'/desktop.json',s=JSON.parse(await readFile(path,'utf8'));while(s.items.filter(i=>i.kind==='folder').length<128)s.items.push(store.make(s,'folder',null,100+s.items.length,'Folder'));await writeFile(path,JSON.stringify(s));assert.equal((await api('/desktop/folders','POST',{parentId:null,label:'Overflow'})).status,400);
 const dir=runtime+'/users/'+own+'/icons';await mkdir(dir);for(const [n,i] of s.items.slice(0,128).entries()){const id=n.toString(16).padStart(32,'0');i.iconOverride={type:'upload',id};await writeFile(dir+'/'+id+'.png',Buffer.alloc(1));}await writeFile(path,JSON.stringify(s));await assert.rejects(store.run(own,()=>g.accounts.apps(g.accounts.state.users[0]),(state,allowed)=>store.upload(own,state,allowed,s.items[128].id,Buffer.alloc(100))),/quota/);
 // Replacement is admitted at the count cap; byte cap is checked independently.
 await store.run(own,()=>g.accounts.apps(g.accounts.state.users[0]),(state,allowed)=>store.upload(own,state,allowed,s.items[0].id,Buffer.alloc(100)));
 await writeFile(dir+'/'+s.items[1].iconOverride.id+'.png',Buffer.alloc(8*1024*1024));await assert.rejects(store.run(own,()=>g.accounts.apps(g.accounts.state.users[0]),(state,allowed)=>store.upload(own,state,allowed,s.items[0].id,Buffer.alloc(100))),/quota/);
 await g.close();g=null;g=await createGateway({port:0,runtime});auth=await authenticate(g.origin,runtime);api=client(g.origin,auth);d=await (await api('/desktop')).json();assert.equal(d.items.length,s.items.length);assert.equal(d.items.find(i=>i.id===apps[0].id).parentId,folder);
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
test('queued desktop edits cannot outlive user revocation',{timeout:10000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-desktop-stale-');let g,release;try{g=await createGateway({port:0,runtime});const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);await api('/admin/users','POST',{username:'backup',password,role:'admin'});const d=await (await api('/desktop')).json();let entered;const started=new Promise(r=>entered=r),block=new Promise(r=>release=r);const original=g.accounts.updateUser.bind(g.accounts);g.accounts.updateUser=async(...args)=>{entered();await block;return original(...args);};const disable=api('/admin/users/'+auth.s.user.id,'PATCH',{disabled:true});await started;let listener,timer;const arrived=new Promise((resolve,reject)=>{listener=req=>{if((req.originalUrl||req.url).startsWith('/api/desktop/items/'))resolve();};g.server.on('request',listener);timer=setTimeout(()=>reject(Error('request timeout')),2000);});const edit=api('/desktop/items/'+d.items[0].id,'PATCH',{label:'No'});try{await arrived;}finally{clearTimeout(timer);g.server.off('request',listener);release();}assert.equal((await disable).status,200);assert.equal((await edit).status,401);const disk=JSON.parse(await readFile(runtime+'/users/'+auth.s.user.id+'/desktop.json','utf8'));assert.equal(disk.items[0].labelOverride,null);
 }finally{release?.();await g?.close();await rm(runtime,{recursive:true,force:true});}
});
