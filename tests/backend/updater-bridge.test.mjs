import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createHmac} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
// Protocol-only socket fixture. Actual broker tests live in updater-real.test.mjs.
test('bridge signs exact protocol, reauthenticates without logout, and throttles failures',async t=>{
 const root=await mkdtemp(tmpdir()+'/relay-bridge-');const key=Buffer.from('synthetic-test-key-32-bytes-abcdef');await writeFile(root+'/key',key,{mode:0o600});const requests=[];
 const socket=net.createServer(s=>{let text='';s.on('data',b=>{text+=b;if(!text.includes('\n'))return;const r=JSON.parse(text);requests.push(r);assert.equal(r.mac,createHmac('sha256',key).update(`${r.timestamp}\n${r.nonce}\n${r.action}\n${r.payload}`).digest('hex'));assert.match(r.nonce,/^[0-9a-f]{32}$/);s.end(JSON.stringify({ok:true,result:r.action==='issue-ui'?{ticket:'a'.repeat(64),expiresAt:Date.now()+60000}:{authorization:'b'.repeat(64),expiresAt:Date.now()+60000}})+'\n');});});
 await new Promise(r=>socket.listen(root+'/broker.sock',r));
 const g=await createGateway({port:0,profile:'standalone',runtime:root+'/relay',updater:{socketPath:root+'/broker.sock',keyFile:root+'/key',uiOrigin:'http://127.0.0.1:4190'}});
 t.after(async()=>{await g.close();await new Promise(r=>socket.close(r));await rm(root,{recursive:true,force:true});});const auth=await authenticate(g.origin,root+'/relay'),api=client(g.origin,auth);
 let response=await api('/updater/launch','POST',{});assert.equal(response.status,200);assert.equal((await response.json()).url,'http://127.0.0.1:4190/updater/#'+'a'.repeat(64));
 const payload=JSON.parse(Buffer.from(requests[0].payload,'base64'));assert.equal(payload.userId,auth.s.user.id);assert.equal(payload.interfaceAnimations,true);assert.equal(typeof payload.relayVersion,'string');
 const body={action:'install',version:'v1.2.3',password,confirmed:true};
 assert.equal((await api('/updater/authorize','POST',{...body,password:'incorrect'})).status,403);assert.equal((await api('/session')).status,200);
 assert.equal((await api('/updater/authorize','POST',{...body,confirmed:false})).status,400);
 assert.equal((await api('/updater/authorize','POST',{...body,version:'main'})).status,400);
 assert.equal((await api('/updater/authorize','POST',{...body,command:'id'})).status,400);
 response=await api('/updater/authorize','POST',body);assert.equal(response.status,200);assert.ok((await response.json()).authorization);
 const action=JSON.parse(Buffer.from(requests.at(-1).payload,'base64'));assert.deepEqual(action,{userId:auth.s.user.id,action:'install',version:'v1.2.3'});
 for(let i=0;i<4;i++)assert.equal((await api('/updater/authorize','POST',{...body,password:'wrong'})).status,403);
 assert.equal((await api('/updater/authorize','POST',body)).status,429);
});
test('pending broker issuance does not hold the persistence queue or outlive logout',async t=>{
 const root=await mkdtemp(tmpdir()+'/relay-bridge-queue-');await writeFile(root+'/key',Buffer.alloc(32,8),{mode:0o600});let arrived,release;const received=new Promise(r=>arrived=r);const socket=net.createServer(s=>{s.once('data',()=>{release=()=>s.end(JSON.stringify({ok:true,result:{ticket:'t'.repeat(64),expiresAt:Date.now()+60000}})+'\n');arrived();});});await new Promise(r=>socket.listen(root+'/socket',r));
 const g=await createGateway({port:0,profile:'standalone',runtime:root+'/relay',updater:{socketPath:root+'/socket',keyFile:root+'/key',uiOrigin:'http://127.0.0.1:4192'}});t.after(async()=>{release?.();await g.close();await new Promise(r=>socket.close(r));await rm(root,{recursive:true,force:true});});const auth=await authenticate(g.origin,root+'/relay'),api=client(g.origin,auth);const launching=api('/updater/launch','POST',{});await received;let early,timer;
 const logout=api('/logout','POST',{});try{early=await Promise.race([logout,new Promise(r=>timer=setTimeout(()=>r(null),750))]);}finally{clearTimeout(timer);release();}const launched=await launching;await logout;assert.equal(early?.status,200,'Slow broker must not delay logout');assert.equal(launched.status,401,'Revoked launch must not return a ticket');
});
test('updater configuration is all-or-none and rejects remote/different hostname/nonabsolute paths',async()=>{
 const {updaterConfig}=await import('../../server/updater.mjs');
 for(const updater of [{socketPath:'/tmp/x'},{socketPath:'relative',keyFile:'/tmp/key',uiOrigin:'http://127.0.0.1:4190'},{socketPath:'/tmp/x',keyFile:'/tmp/key',uiOrigin:'http://localhost:4190'},{socketPath:'/tmp/x',keyFile:'/tmp/key',uiOrigin:'https://evil.example'},{socketPath:'/tmp/x',keyFile:'/tmp/key',uiOrigin:'http://127.0.0.1:4190/path'}])assert.throws(()=>updaterConfig(updater,'127.0.0.1'),/updater/i);
});
