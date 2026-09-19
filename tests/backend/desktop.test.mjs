import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
async function fixture(fn){const runtime=await mkdtemp(tmpdir()+'/relay-desktop-');let g;try{g=await createGateway({port:0,runtime});const auth=await authenticate(g.origin,runtime);await fn(g,runtime,client(g.origin,auth),auth);}finally{await g?.close();await rm(runtime,{recursive:true,force:true});}}
test('ACLs retain hidden shortcuts without granting access; corrupt trees refuse reset',{timeout:15000},()=>fixture(async(g,runtime,admin)=>{
 const user=await json(await admin('/admin/users','POST',{username:'viewer',password,grants:['parcels','notes-lab']}));let auth=await authenticate(g.origin,runtime,'viewer'),api=client(g.origin,auth);
 let d=await json(await api('/desktop'));const shortcut=d.items.find(i=>i.appId==='notes-lab');d=await json(await api('/desktop/folders','POST',{label:'Private',parentId:null}));const folder=d.itemId;
 await json(await api('/desktop/items/'+shortcut.id,'PATCH',{parentId:folder,label:'Secret alias'}));
 const foreign=await json(await admin('/desktop/folders','POST',{parentId:null,label:'Admin only'}));assert.equal((await api('/desktop/items/'+foreign.itemId,'PATCH',{label:'bad'})).status,404);assert.equal((await api('/desktop/items/'+folder,'PATCH',{parentId:foreign.itemId})).status,404);
 await admin('/admin/users/'+user.id,'PATCH',{grants:['parcels']});auth=await authenticate(g.origin,runtime,'viewer');api=client(g.origin,auth);d=await json(await api('/desktop'));assert.equal(d.items.some(i=>i.id===shortcut.id),false);assert.equal((await api('/desktop/items/'+shortcut.id,'PATCH',{label:'bad'})).status,404);assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,403);
 await json(await api('/desktop/items/'+folder,'DELETE'));await admin('/admin/users/'+user.id,'PATCH',{grants:['parcels','notes-lab']});api=client(g.origin,await authenticate(g.origin,runtime,'viewer'));d=await json(await api('/desktop'));const recovered=d.items.find(i=>i.id===shortcut.id);assert.equal(recovered.key,shortcut.key);assert.equal(recovered.label,'Secret alias');assert.equal(recovered.parentId,null);
 const path=runtime+'/users/'+user.id+'/desktop.json',saved=await readFile(path,'utf8');for(const corrupt of ['bad',JSON.stringify({...JSON.parse(saved),items:JSON.parse(saved).items.map(i=>({...i,url:'https://hidden.invalid'}))}),JSON.stringify({...JSON.parse(saved),items:[{...JSON.parse(saved).items[0],parentId:'missing'}]}),JSON.stringify({...JSON.parse(saved),items:[...JSON.parse(saved).items,JSON.parse(saved).items[0]]})]){await writeFile(path,corrupt);assert.equal((await api('/desktop')).status,500);assert.equal(await readFile(path,'utf8'),corrupt);}await writeFile(path,saved);
 for(const body of [{label:'',parentId:null},{label:'x',parentId:null,slot:1024},{label:'x',parentId:null,slot:-1},{label:'x',parentId:null,url:'https://evil.invalid'}])assert.equal((await api('/desktop/folders','POST',body)).status,400);
}));
const json=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json();};
test('personal desktop migration, folders, collisions, cycles, reset and persistence',{timeout:15000},()=>fixture(async(g,runtime,api,auth)=>{
 let d=await json(await api('/desktop'));assert.equal(d.ownerId,auth.s.user.id);assert.equal(d.items.length,4);assert.ok(d.items.every(i=>/^[a-f0-9]{8}$/.test(i.key)));const app=d.items[0];
 d=await json(await api('/desktop/folders','POST',{parentId:null,label:'Work'}));const folder=d.itemId;
 d=await json(await api('/desktop/items/'+app.id,'PATCH',{parentId:folder,label:'Personal',icon:{type:'builtin',name:'star'}}));assert.equal(d.items.find(i=>i.id===app.id).label,'Personal');
 assert.equal((await api('/desktop/items/'+folder,'PATCH',{parentId:folder})).status,400);
 d=await json(await api('/desktop/folders','POST',{parentId:folder,label:'Nested'}));const child=d.itemId;
 assert.equal((await api('/desktop/items/'+folder,'PATCH',{parentId:child})).status,400);
 assert.equal((await api('/desktop/items/'+app.id,'PATCH',{appId:'keepsakes'})).status,400);
 d=await json(await api('/desktop/items/'+folder,'DELETE'));assert.equal(d.items.find(i=>i.id===app.id).parentId,null);assert.equal(d.items.find(i=>i.id===child).parentId,null);
 const other=d.items.find(i=>i.kind==='app'&&i.id!==app.id),old=d.items.find(i=>i.id===app.id).slot;
 d=await json(await api('/desktop/items/'+app.id,'PATCH',{slot:other.slot,label:null,icon:null}));assert.equal(d.items.find(i=>i.id===other.id).slot,old);assert.equal(d.items.find(i=>i.id===app.id).key,app.key);
 assert.equal((await api('/desktop/items/'+app.id,'DELETE')).status,400);
 const second=client(g.origin,await authenticate(g.origin,runtime));assert.deepEqual(await json(await second('/desktop')),d);
 const path=runtime+'/users/'+auth.s.user.id;assert.equal((await stat(path)).mode&0o777,0o700);assert.equal((await stat(path+'/desktop.json')).mode&0o777,0o600);assert.ok(JSON.parse(await readFile(path+'/desktop.json','utf8')).items.length);
}));
