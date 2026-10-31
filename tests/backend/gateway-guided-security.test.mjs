import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {once} from 'node:events';
import {readFile,writeFile} from 'node:fs/promises';
import {guidedLab,password} from '../guided-helper.mjs';
import {cockpitTarget} from '../../server/gateway-service-profiles.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client} from '../auth-helper.mjs';
function body(l,overrides={}){const target=cockpitTarget({id:'cockpit',label:'Cockpit',upstream:l.origin,trust:'system',serverName:'',caPath:'',...overrides});return {config:{...l.config,targets:[...l.config.targets,target]},baseConfig:l.config,targetId:'cockpit',profileVersion:1,password};}
test('sensitive check refuses wrong password, CSRF, ordinary/revoked administrator and invalid/private-literal inputs without traffic',async()=>{
 const l=await guidedLab();try{
 const b=body(l);
 for(const headers of [{cookie:l.auth.cookie,origin:l.relay.origin},{cookie:l.auth.cookie,origin:'https://evil.test','x-csrf-token':l.auth.s.csrf}])assert.equal((await fetch(l.relay.origin+'/api/admin/gateway/check-target',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(b)})).status,403);
 assert.equal((await l.api('/admin/gateway/check-target','POST',{...b,password:'wrong'})).status,403);
 for(const upstream of ['http://8.8.8.8','http://169.254.169.254','http://127.1']){const config=structuredClone(b.config);config.targets[1].upstream=upstream;assert.equal((await l.api('/admin/gateway/check-target','POST',{...b,config})).status,400);}
 assert.equal(l.hits.length,0);
 const u=await (await l.api('/admin/users','POST',{username:'viewer',password})).json();const viewer=client(l.relay.origin,await authenticate(l.relay.origin,l.dir+'/state','viewer'));assert.equal((await viewer('/admin/gateway/check-target','POST',b)).status,403);
 assert.equal((await l.api('/logout','POST',{})).status,200);assert.equal((await l.api('/admin/gateway/check-target','POST',b)).status,401);
 }finally{await l.close();}
});
test('check verifies upstream CA and exact DNS identity independently; never follows redirects or forwards credentials',async()=>{
 const l=await guidedLab();const tls=https.createServer({key:await readFile(l.dir+'/key.pem'),cert:l.cert},(req,res)=>{res.writeHead(302,{location:'http://8.8.8.8/private','set-cookie':'cockpit=DO-NOT-EXPOSE; Path=/'});res.end();});await new Promise(r=>tls.listen(0,'127.0.0.1',r));
 try{
 const b=body(l,{upstream:`https://127.0.0.1:${tls.address().port}`,trust:'custom',caPath:l.dir+'/cert.pem',serverName:'desktop.example.test'});
 let r=await l.api('/admin/gateway/check-target','POST',b);assert.equal(r.status,200);let v=await r.json();assert.equal(v.tiers.certificate.state,'passed');assert.equal(v.tiers.http.status,302);assert.doesNotMatch(JSON.stringify(v),/DO-NOT-EXPOSE|BEGIN|set-cookie|8\.8\.8\.8/);
 b.config.targets[1].upstreamTLS.serverName='wrong.example.test';r=await l.api('/admin/gateway/check-target','POST',b);v=await r.json();assert.equal(v.tiers.certificate.state,'failed');assert.equal(v.tiers.http.state,'failed');
 b.config.targets[1].upstreamTLS={serverName:'desktop.example.test'};v=await (await l.api('/admin/gateway/check-target','POST',b)).json();assert.equal(v.tiers.certificate.state,'failed');
 }finally{tls.closeAllConnections();await new Promise(r=>tls.close(r));await l.close();}
});
for(const action of ['logout','demotion','expiry'])test('held explicit check is cancelled across '+action+' without delaying session mutation',async()=>{
 const l=await guidedLab();let entered;const arrived=new Promise(r=>entered=r);let closed;const disconnected=new Promise(r=>closed=r);const slow=http.createServer((req,res)=>{res.once('close',closed);entered();});await new Promise(r=>slow.listen(0,'127.0.0.1',r));
 try{
 const b=body(l,{upstream:`http://127.0.0.1:${slow.address().port}`});
 const pending=l.api('/admin/gateway/check-target','POST',b);await arrived;
 const session=[...l.relay.sessions.values()].find(s=>s.userId===l.auth.s.user.id);assert.ok([...session.operations][0]?.done instanceof Promise,'check cleanup participates in acknowledged session retirement');
 if(action==='logout')assert.equal((await l.api('/logout','POST',{})).status,200);
 else if(action==='expiry')session.expires=Date.now()-1;
 else{await l.api('/admin/users','POST',{username:'otheradmin',password,role:'admin'});const second=client(l.relay.origin,await authenticate(l.relay.origin,l.dir+'/state','otheradmin'));assert.equal((await second('/admin/users/'+l.auth.s.user.id,'PATCH',{role:'user'})).status,200);}
 const response=await pending;assert.ok(response.status>=400);await disconnected;
 }finally{slow.closeAllConnections();await new Promise(r=>slow.close(r));await l.close();}
});
test('guided target save preserves unrelated settings and refuses stale retry',async()=>{
 const l=await guidedLab();try{
 const b=body(l);assert.equal((await l.api('/admin/gateway','PUT',b)).status,200);const saved=JSON.parse(await readFile(l.dir+'/state/gateway-managed.json'));assert.deepEqual(saved,b.config);assert.deepEqual(saved.targets[0],l.config.targets[0]);assert.equal((await l.api('/admin/gateway','PUT',b)).status,409);assert.equal(saved.targets.length,2);
 }finally{await l.close();}
});
test('real operator-owned reference refuses guided checks without touching files or destination',async()=>{
 const l=await guidedLab();let operator;try{
 await l.relay.close();const path=l.dir+'/state/gateway-managed.json',before=await readFile(path);
 operator=await createGateway({port:0,runtime:l.dir+'/state',profile:'standalone',gatewayConfigPath:path});const api=client(operator.origin,await authenticate(operator.origin,l.dir+'/state'));
 assert.equal((await api('/admin/gateway/check-target','POST',body(l))).status,409);assert.deepEqual(await readFile(path),before);assert.equal(l.hits.length,0);
 }finally{await operator?.close();await l.close();}
});
