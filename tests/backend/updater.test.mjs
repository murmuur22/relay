import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import http from 'node:http';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
async function fixture(t,options={}) {const runtime=await mkdtemp(tmpdir()+'/relay-updater-');const g=await createGateway({port:0,runtime,profile:'standalone',...options});t.after(async()=>{await g.close();await rm(runtime,{recursive:true,force:true});});const admin=await authenticate(g.origin,runtime);return {g,runtime,admin,api:client(g.origin,admin)};}
test('reserved updater is admin-only, keeps placement, refuses registry/grants/windows and is honestly unavailable',async t=>{
 const {g,api,runtime}=await fixture(t);const session=await (await api('/session')).json();assert.equal(session.apps.find(a=>a.id==='system-updater')?.kind,'system');
 let d=await (await api('/desktop')).json();const item=d.items.find(i=>i.appId==='system-updater');assert.ok(item);assert.equal((await api('/desktop/items/'+item.id,'PATCH',{label:'Maintenance'})).status,200);d=await (await api('/desktop')).json();assert.equal(d.items.find(i=>i.id===item.id).label,'Maintenance');
 assert.equal((await api('/windows','POST',{appId:'system-updater'})).status,403);
 for(const method of ['PATCH','DELETE'])assert.ok((await api('/admin/services/system-updater',method,{})).status>=400);
 assert.equal((await api('/admin/services','POST',{kind:'system',id:'system-updater'})).status,400);
 assert.equal((await api('/admin/users','POST',{username:'badgrant',password,grants:['system-updater']})).status,400);
 assert.equal((await api('/updater/launch','POST',{})).status,503);
 assert.equal((await api('/admin/users','POST',{username:'ordinary',password})).status,200);
 const ordinary=await authenticate(g.origin,runtime,'ordinary'),userApi=client(g.origin,ordinary);assert.ok(!ordinary.s.apps.some(a=>a.id==='system-updater'));
 assert.equal((await userApi('/updater/launch','POST',{})).status,403);assert.equal((await userApi('/updater/authorize','POST',{action:'rollback',password,confirmed:true})).status,403);
});
test('maintenance gates private reads, login, writes and upgrades but readiness and shell survive',async t=>{
 const root=await mkdtemp(tmpdir()+'/relay-maintenance-');t.after(()=>rm(root,{recursive:true,force:true}));const marker=root+'/maintenance';const {g,api,runtime}=await fixture(t,{maintenanceFile:marker});
 const ready=await (await fetch(g.origin+'/health/ready')).json();assert.equal(ready.status,'ready');assert.equal(ready.maintenance,false);
 await writeFile(marker,'maintenance');for(const path of ['/session','/desktop','/auth'])assert.equal((await api(path)).status,503);
 assert.equal((await api('/login','POST',{})).status,503);assert.equal((await api('/updater/launch','POST',{})).status,503);
 assert.equal((await fetch(g.origin+'/')).status,200);assert.equal((await (await fetch(g.origin+'/health/ready')).json()).maintenance,true);
 assert.equal((await fetch(g.origin+'/health/ready',{headers:{Origin:'http://evil.invalid'}})).status,403);
 assert.equal(await new Promise(resolve=>{const req=http.get(g.origin+'/ws/stream/notes-lab',{headers:{Connection:'Upgrade',Upgrade:'websocket',Origin:g.origin,'Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ==','Sec-WebSocket-Version':'13'}},res=>{res.resume();resolve(res.statusCode);});req.setTimeout(2000,()=>req.destroy());}),503);
 await assert.rejects(readFile(runtime+'/users/'+(g.accounts.state.users[0].id)+'/desktop.json'));
 await rm(marker);await symlink(root+'/missing-marker-target',marker);assert.equal((await api('/session')).status,503,'A present dangling marker must not reopen admission');
});
test('forced-password-change and role revocation cannot launch or authorize; personal placement survives regrant',async t=>{
 const {g,api,runtime}=await fixture(t);const created=await (await api('/admin/users','POST',{username:'operator',role:'admin',password})).json();let auth=await authenticate(g.origin,runtime,'operator'),other=client(g.origin,auth);let d=await (await other('/desktop')).json();const item=d.items.find(i=>i.appId==='system-updater');await other('/desktop/items/'+item.id,'PATCH',{label:'My updater'});
 assert.equal((await fetch(g.origin+'/api/updater/launch',{method:'POST',headers:{cookie:auth.cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await api('/admin/users/'+created.id,'PATCH',{role:'user'})).status,200);assert.equal((await other('/updater/launch','POST',{})).status,401);auth=await authenticate(g.origin,runtime,'operator');other=client(g.origin,auth);assert.equal((await other('/updater/launch','POST',{})).status,403);assert.ok(!(await (await other('/desktop')).json()).items.some(i=>i.appId==='system-updater'));
 await api('/admin/users/'+created.id,'PATCH',{role:'admin'});auth=await authenticate(g.origin,runtime,'operator');other=client(g.origin,auth);d=await (await other('/desktop')).json();assert.equal(d.items.find(i=>i.id===item.id).label,'My updater');
 await api('/admin/users/'+created.id,'PATCH',{password:password+'reset'});auth=await authenticate(g.origin,runtime,'operator',password+'reset');other=client(g.origin,auth);assert.ok(!auth.s.apps.some(a=>a.id==='system-updater'));assert.equal((await other('/updater/authorize','POST',{action:'rollback',password:password+'reset',confirmed:true})).status,403);
});
test('persisted registry cannot shadow the reserved system updater',async t=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-reserved-');t.after(()=>rm(runtime,{recursive:true,force:true}));const g=await createGateway({port:0,runtime});await authenticate(g.origin,runtime);await g.close();const path=runtime+'/accounts.json',state=JSON.parse(await readFile(path,'utf8'));state.services[0].id='system-updater';await writeFile(path,JSON.stringify(state));await assert.rejects(createGateway({port:0,runtime}).then(async unexpected=>{await unexpected.close();}),/state unreadable/);
});
