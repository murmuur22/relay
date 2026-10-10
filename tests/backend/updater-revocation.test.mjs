import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';

test('genuine administrator demotion refuses old-cookie monitoring rather than treating live revocation as downtime',{timeout:20000},async t=>{
 const root=await mkdtemp(tmpdir()+'/relay-monitor-revocation-');await writeFile(root+'/key',Buffer.alloc(32,7),{mode:0o600});
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const uiOrigin=`http://127.0.0.1:${listener.address().port}`;await new Promise(r=>listener.close(r));
 let owner,reads=0;
 // Protocol-only broker, genuine Relay enrollment/account revocation and real HTTP.
 const broker=net.createServer(socket=>{let text='';socket.on('data',b=>{text+=b;if(!text.includes('\n'))return;const req=JSON.parse(text);let result;
  if(req.action==='issue-ui'){owner=JSON.parse(Buffer.from(req.payload,'base64')).userId;result={ticket:'t'.repeat(64),expiresAt:Date.now()+60000};}
  else if(req.action==='redeem-ui')result={token:'r'.repeat(64),userId:owner,expiresAt:Date.now()+60000,interfaceAnimations:false};
  else{reads++;result={mode:'fixture',currentVersion:'v0.6.3',available:[],history:[],job:null,canInstall:false};}
  socket.end(JSON.stringify({ok:true,result})+'\n');
 });});await new Promise(r=>broker.listen(root+'/socket',r));
 let g=await createGateway({port:0,profile:'standalone',runtime:root+'/relay',updater:{socketPath:root+'/socket',keyFile:root+'/key',uiOrigin}});
 const web=await createUpdaterWeb({uiOrigin,relayOrigin:g.origin,socketPath:root+'/socket'});
 t.after(async()=>{await web.close();await g.close();await new Promise(r=>broker.close(r));await rm(root,{recursive:true,force:true});});
 let admin=await authenticate(g.origin,root+'/relay'),a=client(g.origin,admin);
 assert.equal((await a('/admin/users','POST',{username:'other-admin',password,role:'admin',grants:[]})).status,200);
 let other=client(g.origin,await authenticate(g.origin,root+'/relay','other-admin'));
 const launch=await(await a('/updater/launch','POST',{})).json();
 const exchange=await fetch(uiOrigin+'/updater/api/exchange',{method:'POST',headers:{Origin:uiOrigin,'Content-Type':'application/json',Cookie:admin.cookie},body:JSON.stringify({ticket:new URL(launch.url).hash.slice(1)})});assert.equal(exchange.status,200);
 const monitor=exchange.headers.get('set-cookie').split(';')[0];
 const state=()=>fetch(uiOrigin+'/updater/api/state',{headers:{Origin:uiOrigin,Cookie:monitor+'; '+admin.cookie}});
 assert.equal((await state()).status,200);
 const runtimeBefore=(await a('/session')).headers.get('x-relay-runtime-instance'),port=Number(new URL(g.origin).port);await g.close();
 assert.equal((await state()).status,200,'Read-only monitor survives a stopped runtime');
 g=await createGateway({port,profile:'standalone',runtime:root+'/relay',updater:{socketPath:root+'/socket',keyFile:root+'/key',uiOrigin}});
 assert.equal((await a('/session')).status,401,'Restart invalidates the old Relay session');
 assert.notEqual((await a('/session')).headers.get('x-relay-runtime-instance'),runtimeBefore);
 assert.equal((await state()).status,200,'A positively observed runtime restart preserves read monitoring');
 admin=await authenticate(g.origin,root+'/relay');a=client(g.origin,admin);other=client(g.origin,await authenticate(g.origin,root+'/relay','other-admin'));
 assert.equal((await state()).status,200,'Same owner reauthentication rebinds the monitor');const before=reads;
 assert.equal((await other('/admin/users/'+admin.s.user.id,'PATCH',{role:'user'})).status,200);
 assert.equal((await a('/session')).status,401,'Real Relay session is revoked');
 assert.equal((await state()).status,401,'Live revocation must not expose prior admin state');
 assert.equal(reads,before,'Denied monitor must not reach broker state');
});
