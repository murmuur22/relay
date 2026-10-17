import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client} from '../auth-helper.mjs';
test('new desktop defaults use existing audited folder, monitor and branch IDs while overrides remain intact',{timeout:10000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-defaults-');let g;try{g=await createGateway({port:0,runtime});const api=client(g.origin,await authenticate(g.origin,runtime));let d=await json(await api('/desktop/folders','POST',{label:'Fresh',parentId:null}));assert.equal(d.items.find(i=>i.id===d.itemId).icon.name,'pixel-folder');assert.equal(d.items.find(i=>i.appId==='system-control-panel').icon.name,'pixel-monitor');assert.equal(d.items.find(i=>i.appId==='system-updater').icon.name,'pixel-git-branch');const id=d.itemId;d=await json(await api('/desktop/items/'+id,'PATCH',{icon:{type:'builtin',name:'folder'}}));d=await json(await api('/desktop/sort','POST',{parentId:null,revision:d.revision,by:'type'}));assert.equal(d.items.find(i=>i.id===id).icon.name,'folder');}finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
const json=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json();};
test('atomic owner group move uses revision, preserves metadata, rejects late invalid members and sorts deterministically',{timeout:20000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-batch-');let g;
 try{g=await createGateway({port:0,runtime});const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);let d=await json(await api('/desktop'));
 const app=d.items.find(i=>i.appId==='parcels');d=await json(await api('/desktop/items/'+app.id,'PATCH',{label:'Zulu',icon:{type:'builtin',name:'star'}}));
 d=await json(await api('/desktop/folders','POST',{parentId:null,label:'Work'}));const folder=d.itemId;
 d=await json(await api('/desktop/folders','POST',{parentId:null,label:'Alpha'}));const other=d.itemId;
 const path=runtime+'/users/'+auth.s.user.id+'/desktop.json',before=await readFile(path,'utf8');
 const move={revision:d.revision,sourceParentId:null,itemIds:[app.id,'item-00000000-0000-0000-0000-000000000000'],parentId:folder};
 assert.equal((await api('/desktop/move','POST',move)).status,404);assert.equal(await readFile(path,'utf8'),before);
 d=await json(await api('/desktop/move','POST',{...move,itemIds:[app.id,other]}));assert.equal(d.items.find(i=>i.id===app.id).parentId,folder);assert.equal(d.items.find(i=>i.id===other).parentId,folder);assert.equal(d.items.find(i=>i.id===app.id).icon.name,'star');
 assert.equal((await api('/desktop/move','POST',{...move,itemIds:[folder],parentId:other,revision:d.revision})).status,400);
 assert.equal((await api('/desktop/move','POST',{...move,itemIds:[app.id],sourceParentId:folder,revision:d.revision-1,parentId:null})).status,409);
 d=await json(await api('/desktop/sort','POST',{revision:d.revision,parentId:folder,by:'name'}));assert.deepEqual(d.items.filter(i=>i.parentId===folder).sort((a,b)=>a.slot-b.slot).map(i=>i.label),['Alpha','Zulu']);
 const second=client(g.origin,await authenticate(g.origin,runtime));assert.deepEqual(await json(await second('/desktop')),d);
 const sorted=await json(await second('/desktop/sort','POST',{revision:d.revision,parentId:folder,by:'name'}));assert.deepEqual(sorted,d,'already sorted is idempotent');
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
