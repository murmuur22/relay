import test from 'node:test';
import assert from 'node:assert/strict';
import {guidedLab} from '../guided-helper.mjs';
test('Gateway app registration retry is exact-session idempotent and conflicting draft cannot clobber it',async()=>{
 const l=await guidedLab();try{
 const body={kind:'web',mode:'gateway',label:'Retry app',gateway:{target:'existing'},icon:'globe',userIds:[],registrationId:'e2e00000-0000-4000-8000-000000000001'};
 const first=await l.api('/admin/apps','POST',body);assert.equal(first.status,200);const one=await first.json();
 const second=await l.api('/admin/apps','POST',body);assert.equal(second.status,200);assert.equal((await second.json()).id,one.id);
 assert.equal((await l.api('/admin/apps','POST',{...body,label:'Changed draft'})).status,409);
 assert.equal((await (await l.api('/admin/services')).json()).filter(s=>s.label==='Retry app').length,1);
 }finally{await l.close();}
});
