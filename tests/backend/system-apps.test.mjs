import test from 'node:test';
import assert from 'node:assert/strict';
import * as catalog from '../../server/system-apps.mjs';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
test('reserved system catalog exposes Control Panel and Updater only to active admins',()=>{
 assert.deepEqual(catalog.systemApps({role:'admin'}).map(a=>a.id),['system-updater','system-control-panel']);
 assert.ok(Object.isFrozen(catalog.SYSTEM_APPS));assert.ok(catalog.SYSTEM_APPS.every(Object.isFrozen));
 for(const user of [null,{role:'user'},{role:'admin',disabled:true},{role:'admin',mustChange:true}])assert.deepEqual(catalog.systemApps(user),[]);
});
test('Control Panel placement survives role revoke/regrant and stays outside registry and remote windows',{timeout:20000},async t=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-system-apps-'),g=await createGateway({port:0,runtime,profile:'standalone'});t.after(async()=>{await g.close();await rm(runtime,{recursive:true,force:true});});
 const admin=client(g.origin,await authenticate(g.origin,runtime));const response=await admin('/admin/users','POST',{username:'operator',password,role:'admin'});assert.equal(response.status,200);const user=await response.json();
 let api=client(g.origin,await authenticate(g.origin,runtime,'operator'));let d=await(await api('/desktop')).json();const item=d.items.find(i=>i.appId==='system-control-panel');assert.ok(item,'Control Panel shortcut exists');
 assert.equal((await api('/desktop/items/'+item.id,'PATCH',{label:'My controls'})).status,200);
 assert.deepEqual(await(await api('/admin/apps')).json(),[]);assert.equal((await api('/windows','POST',{appId:'system-control-panel'})).status,403);
 assert.equal((await admin('/admin/users/'+user.id,'PATCH',{role:'user'})).status,200);api=client(g.origin,await authenticate(g.origin,runtime,'operator'));d=await(await api('/desktop')).json();assert.equal(d.items.some(i=>i.id===item.id),false);
 assert.equal((await admin('/admin/users/'+user.id,'PATCH',{role:'admin'})).status,200);api=client(g.origin,await authenticate(g.origin,runtime,'operator'));d=await(await api('/desktop')).json();const restored=d.items.find(i=>i.id===item.id);assert.ok(restored);assert.equal(restored.key,item.key);assert.equal(restored.label,'My controls');assert.equal(restored.slot,item.slot);
});
test('persisted editable registry cannot impersonate reserved Control Panel identity',{timeout:15000},async t=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-system-reserved-');t.after(()=>rm(runtime,{recursive:true,force:true}));const g=await createGateway({port:0,runtime});await authenticate(g.origin,runtime);await g.close();const path=runtime+'/accounts.json',state=JSON.parse(await readFile(path,'utf8'));state.services[0].id='system-control-panel';await writeFile(path,JSON.stringify(state));await assert.rejects(createGateway({port:0,runtime}).then(async unexpected=>{await unexpected.close();}),/state unreadable/);
});
