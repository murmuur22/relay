import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHmac} from 'node:crypto';
import {createGateway} from '../../server/gateway.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import * as protocol from '../../updater/web/broker-client.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const jobId='c'.repeat(32),version='v0.3.1';
const ready=userId=>({protocol:1,capabilities:{prepare:1,apply:1},canPrepare:false,canApply:true,job:{id:jobId,version,userId,kind:'prepare',phase:'ready',canCancel:true}});
test('staged request fields are exact, bounded and never alias immediate install',()=>{
 for(const action of ['prepare','apply'])assert.deepEqual(protocol.actionFields({action,version,...(action==='apply'?{jobId}:{}),password,confirmed:true}),{action,version,...(action==='apply'?{jobId}:{})});
 for(const data of [{action:'prepare',version,jobId},{action:'apply',version},{action:'apply',version,jobId:'x'},{action:'apply',version,jobId:jobId.toUpperCase()},{action:'apply',version:'v01.2.3',jobId},{action:'apply',version,jobId,extra:true},{action:'apply',version,jobId,authorization:'x'}])assert.throws(()=>protocol.actionFields({password,confirmed:true,...data}));
 assert.throws(()=>protocol.actionFields({action:'cancel',jobId:'x'.repeat(129),password,confirmed:true}));
 assert.throws(()=>protocol.actionFields({action:'prepare',version,password:'',confirmed:true}));
});
test('staged snapshot admission fails closed on unsupported, stale job/version/user and malformed readiness',()=>{
 assert.equal(typeof protocol.stagedTarget,'function');const fields={action:'apply',version,jobId};
 assert.doesNotThrow(()=>protocol.stagedTarget(ready('owner'),fields,'owner'));
 for(const snapshot of [{}, {...ready('owner'),capabilities:{}},{...ready('owner'),capabilities:{prepare:1,apply:true}}])assert.throws(()=>protocol.stagedTarget(snapshot,fields,'owner'),e=>e.status===409&&/unsupported/i.test(e.message));
 for(const patch of [{id:'d'.repeat(32)},{version:'v0.3.2'},{userId:'other'},{phase:'downloading'},{kind:'start'}])assert.throws(()=>protocol.stagedTarget({...ready('owner'),job:{...ready('owner').job,...patch}},fields,'owner'));
 assert.throws(()=>protocol.stagedTarget({...ready('owner'),canApply:false},fields,'owner'));
});
async function fixture(t){
 const root=await mkdtemp(tmpdir()+'/rh-');const key=Buffer.alloc(32,9);await writeFile(root+'/key',key,{mode:0o600});
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const uiOrigin=`http://127.0.0.1:${probe.address().port}`;await new Promise(r=>probe.close(r));
 const calls=[];let owner,hold,arrived,release,unsupported=false;const sockets=new Set();
 const broker=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let text='';socket.on('data',b=>{text+=b;if(!text.includes('\n'))return;const req=JSON.parse(text);calls.push(req);let result;
  if(req.payload){assert.equal(req.mac,createHmac('sha256',key).update(`${req.timestamp}\n${req.nonce}\n${req.action}\n${req.payload}`).digest('hex'));const fields=JSON.parse(Buffer.from(req.payload,'base64'));if(req.action==='issue-ui'){owner=fields.userId;result={ticket:'t'.repeat(64),expiresAt:Date.now()+60000};}else result={authorization:'a'.repeat(64),expiresAt:Date.now()+60000};}
  else if(req.action==='redeem-ui')result={token:'r'.repeat(64),userId:owner,interfaceAnimations:false,expiresAt:Date.now()+3600000};
  else if(req.action==='state')result=unsupported?{protocol:1,job:null}:ready(owner);
  else result={...ready(owner),received:req.action};
  const finish=()=>socket.end(JSON.stringify({ok:true,result})+'\n');if(req.action===hold){release=finish;arrived?.();}else finish();
 });});await new Promise(r=>broker.listen(root+'/s',r));
 const g=await createGateway({port:0,runtime:root+'/relay',profile:'standalone',updater:{socketPath:root+'/s',keyFile:root+'/key',uiOrigin}});
 const web=await createUpdaterWeb({uiOrigin,relayOrigin:g.origin,socketPath:root+'/s'});
 t.after(async()=>{release?.();await web.close();await g.close();for(const s of sockets)s.destroy();await new Promise(r=>broker.close(r));await rm(root,{recursive:true,force:true});});
 const auth=await authenticate(g.origin,root+'/relay'),api=client(g.origin,auth);const launch=await(await api('/updater/launch','POST',{})).json();
 const request=(path,method='GET',data,headers={})=>fetch(uiOrigin+'/updater/api'+path,{method,headers:{Origin:uiOrigin,'Content-Type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});
 const exchange=await request('/exchange','POST',{ticket:new URL(launch.url).hash.slice(1)},{Cookie:auth.cookie});assert.equal(exchange.status,200);const monitor=exchange.headers.get('set-cookie').split(';')[0],{csrf}=await exchange.json();
 return {g,api,auth,calls,request,headers:{Cookie:monitor+'; '+auth.cookie,'X-CSRF-Token':csrf},unsupported:()=>unsupported=true,hold:action=>{hold=action;return new Promise(r=>arrived=r);},release:()=>{hold=null;release?.();},root};
}
test('genuine password issuance and independent apply forwarding preserve exact action/job/version/user',async t=>{
 const f=await fixture(t),data={version,jobId,password,confirmed:true};
 const response=await f.request('/apply','POST',data,{...f.headers,Cookie:f.headers.Cookie+'; unrelated=private'});assert.equal(response.status,200);
 const issue=f.calls.findLast(c=>c.action==='issue-action');assert.deepEqual(JSON.parse(Buffer.from(issue.payload,'base64')),{userId:f.auth.s.user.id,action:'apply',version,jobId});
 assert.deepEqual(f.calls.at(-1),{action:'apply',params:{token:'r'.repeat(64),authorization:'a'.repeat(64),version,jobId}});
 for(const action of ['apply','cancel'])assert.equal((await f.request('/'+action,'POST',{...(action==='apply'?{version}:{}),jobId,confirmed:true},f.headers)).status,400,'every mutation requires a fresh password');
});
test('old broker explicitly unsupported without action issuance or immediate start fallback',async t=>{
 const f=await fixture(t);f.unsupported();
 for(const action of ['prepare','apply']){const r=await f.request('/'+action,'POST',{version,...(action==='apply'?{jobId}:{}),password,confirmed:true},f.headers);assert.equal(r.status,409);assert.match((await r.json()).error,/unsupported/i);}
 assert.ok(!f.calls.some(c=>['start','prepare','apply','issue-action'].includes(c.action)));
 const r=await f.api('/updater/authorize','POST',{action:'prepare',version,password,confirmed:true});assert.equal(r.status,409);assert.match((await r.json()).error,/unsupported/i);
});
test('demotion while genuine staged issuance waits revokes returned authority; logout not queued',async t=>{
 const f=await fixture(t);assert.equal((await f.api('/admin/users','POST',{username:'second',role:'admin',password})).status,200);const second=client(f.g.origin,await authenticate(f.g.origin,f.root+'/relay','second'));
 const arrived=f.hold('issue-action'),pending=f.api('/updater/authorize','POST',{action:'apply',version,jobId,password,confirmed:true});
 await Promise.race([arrived,new Promise((_,reject)=>setTimeout(()=>reject(Error('issuance never reached')),3000).unref())]);
 try{assert.equal((await second('/admin/users/'+f.auth.s.user.id,'PATCH',{role:'user'})).status,200);}finally{f.release();}
 assert.equal((await pending).status,401);assert.ok(!f.calls.some(c=>c.action==='apply'));
});
test('independent logout during awaited preflight blocks staged forwarding',async t=>{
 const f=await fixture(t),arrived=f.hold('state'),pending=f.request('/apply','POST',{version,jobId,password,confirmed:true},f.headers);
 await Promise.race([arrived,new Promise((_,reject)=>setTimeout(()=>reject(Error('preflight never reached')),3000).unref())]);
 try{assert.equal((await f.request('/logout','POST',{},f.headers)).status,200);}finally{f.release();}
 assert.equal((await pending).status,401);assert.ok(!f.calls.some(c=>c.action==='apply'));
});
