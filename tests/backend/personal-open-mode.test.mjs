import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const json=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json();};
async function fixture(fn){const runtime=await mkdtemp(tmpdir()+'/personal-mode-');let g;try{g=await createGateway({port:0,runtime,profile:'standalone'});const admin=client(g.origin,await authenticate(g.origin,runtime));await json(await admin('/admin/users','POST',{username:'owner',password}));const auth=await authenticate(g.origin,runtime,'owner'),api=client(g.origin,auth);await fn({g,runtime,admin,api,auth});}finally{await g?.close();await rm(runtime,{recursive:true,force:true});}}
test('personal create validates and persists Native open mode with legacy window default',()=>fixture(async({g,runtime,admin,api})=>{
 let d=await json(await api('/desktop/bookmarks','POST',{url:'https://offline.invalid/tab',label:'Private tab',parentId:null,openMode:'tab'}));const id=d.createdAppId;assert.equal(d.personalApps.find(a=>a.id===id).openMode,'tab');
 const stored=runtime+'/users/'+d.ownerId+'/desktop.json';assert.equal(JSON.parse(await readFile(stored)).bookmarks.find(a=>a.id===id).openMode,'tab');
 const fresh=client(g.origin,await authenticate(g.origin,runtime,'owner'));assert.equal((await json(await fresh('/session'))).apps.find(a=>a.id===id).openMode,'tab');
 for(const openMode of ['gateway','stream',null,{},['tab'],true])assert.equal((await api('/desktop/bookmarks','POST',{url:'https://offline.invalid/',label:'Denied',parentId:null,openMode})).status,400);
 d=await json(await api('/desktop/bookmarks','POST',{url:'https://offline.invalid/legacy',label:'Legacy',parentId:null}));const legacy=d.createdAppId,raw=JSON.parse(await readFile(stored));delete raw.bookmarks.find(b=>b.id===legacy).openMode;await writeFile(stored,JSON.stringify(raw));assert.equal((await json(await api('/desktop'))).personalApps.find(a=>a.id===legacy).openMode,'window');assert.deepEqual(await json(await admin('/admin/apps')),[]);
}));
test('owner edit preserves identity, folder, placement and unchanged upload; URL/mode edits retire old windows',()=>fixture(async({g,runtime,admin,api,auth})=>{
 let d=await json(await api('/desktop/folders','POST',{label:'Private folder',parentId:null}));const folder=d.itemId;
 d=await json(await api('/desktop/bookmarks','POST',{url:'https://offline.invalid/before',label:'Before',parentId:folder}));let item=d.items.find(i=>i.appId===d.createdAppId);const id=item.appId;
 const bytes=await readFile(new URL('../integration/synthetic-relay.png',import.meta.url));const upload=await json(await fetch(g.origin+'/api/desktop/items/'+item.id+'/icon',{method:'POST',headers:{cookie:auth.cookie,Origin:g.origin,'X-CSRF-Token':auth.s.csrf,'Content-Type':'image/png'},body:bytes}));item=upload.items.find(i=>i.id===item.id);const icon=item.icon;
 await json(await api('/windows','POST',{appId:id}));
 const beforeAccounts=await readFile(runtime+'/accounts.json');d=await json(await api('/desktop/items/'+item.id,'PATCH',{label:'After',url:'https://client-only.invalid/after',openMode:'tab'}));const after=d.items.find(i=>i.id===item.id);assert.equal(after.key,item.key);assert.equal(after.parentId,folder);assert.equal(after.slot,item.slot);assert.deepEqual(after.icon,icon);assert.equal(after.label,'After');assert.equal(d.personalApps.find(a=>a.id===id).url,'https://client-only.invalid/after');assert.equal(d.personalApps.find(a=>a.id===id).openMode,'tab');assert.equal((await json(await api('/session'))).windows.some(w=>w.appId===id),false);assert.deepEqual(await readFile(runtime+'/accounts.json'),beforeAccounts);
 assert.equal((await admin('/desktop/items/'+item.id,'PATCH',{url:'https://foreign.invalid/',openMode:'tab'})).status,404);const path=runtime+'/users/'+d.ownerId+'/desktop.json',before=await readFile(path);
 for(const body of [{url:g.origin+'/'},{url:'javascript:alert(1)'},{url:'https://bad.invalid/#fragment'},{openMode:null},{openMode:'stream'},{gateway:{target:'x'}},{userIds:[]}])assert.equal((await api('/desktop/items/'+item.id,'PATCH',body)).status,400);
 assert.deepEqual(await readFile(path),before);d=await json(await api('/desktop/items/'+item.id,'PATCH',{icon:null}));assert.equal(d.items.find(i=>i.id===item.id).icon.type,'builtin');assert.equal((await fetch(g.origin+icon.url,{headers:{cookie:auth.cookie}})).status,404);
 const fresh=client(g.origin,await authenticate(g.origin,runtime,'owner'));assert.equal((await json(await fresh('/desktop'))).personalApps.find(a=>a.id===id).openMode,'tab');
}));
