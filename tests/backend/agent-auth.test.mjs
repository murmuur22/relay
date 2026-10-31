import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {guidedLab,password} from '../guided-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';
const change={type:'target',id:'existing',set:{label:'Reviewed change'}};
async function issue(l,scope='configure',ttlSeconds=60,api=l.api){const r=await api('/admin/agent-access','POST',{password,scope,ttlSeconds});assert.equal(r.status,200);return r.json();}
const agent=(l,g,path,body,headers={})=>fetch(l.relay.origin+'/api/agent/v1'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+g.token,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function plan(l,g,c=change){const s=await (await agent(l,g,'/state')).json();const r=await agent(l,g,'/plans',{expectedRevision:s.revision,change:c});assert.equal(r.status,200);return r.json();}
test('read scope, exact plan binding, stale revisions, and unknown/malformed shapes fail closed',async()=>{
 const l=await guidedLab();try{
  const g=await issue(l),read=await issue(l,'read'),other=await issue(l);const p=await plan(l,g);
  assert.equal((await agent(l,read,'/plans',{expectedRevision:p.expectedRevision,change})).status,403);
  assert.equal((await agent(l,read,'/apply',p)).status,403);
  assert.equal((await agent(l,other,'/apply',p)).status,409);
  assert.equal((await agent(l,g,'/apply',{...p,change:{...change,set:{label:'Unreviewed'}}})).status,409);
  assert.equal((await agent(l,g,'/apply',{...p,extra:true})).status,409);
  assert.equal((await agent(l,g,'/unknown')).status,404);
  for(const body of [null,[],{}, {expectedRevision:p.expectedRevision,change,extra:true},{expectedRevision:p.expectedRevision,change:{...change,set:{label:'x',unknown:1}}},{expectedRevision:p.expectedRevision,change:{type:'app',id:'not-a-service',set:{label:'x'}}}])assert.equal((await agent(l,g,'/plans',body)).status,400);
  const malformed=await fetch(l.relay.origin+'/api/agent/v1/plans',{method:'POST',headers:{authorization:'Bearer '+g.token,'content-type':'application/json'},body:'{'});assert.equal(malformed.status,400);
  const big=await agent(l,g,'/plans',{padding:'x'.repeat(17000)});assert.equal(big.status,413);
  const user=await (await l.api('/admin/users','POST',{username:'revisionuser',password})).json();
  assert.equal(typeof user.id,'string');assert.equal((await agent(l,g,'/apply',p)).status,409,'account changes participate in revision');
  const next=await plan(l,g);assert.equal((await agent(l,g,'/apply',next)).status,200);
  assert.equal((await agent(l,g,'/apply',p)).status,409);
 }finally{await l.close();}
});
test('browser cookie/Origin are not agent credentials; Bearer cannot bypass browser CSRF',async()=>{
 const l=await guidedLab();try{
  const g=await issue(l);for(const headers of [{cookie:l.auth.cookie},{origin:l.relay.origin},{cookie:l.auth.cookie,origin:l.relay.origin}])assert.equal((await agent(l,g,'/state',undefined,headers)).status,401);
  assert.equal((await fetch(l.relay.origin+'/api/agent/v1/state',{headers:{cookie:l.auth.cookie,origin:l.relay.origin}})).status,401);
  assert.equal((await fetch(l.relay.origin+'/api/agent/v1/state',{headers:{authorization:'Bearer '+l.auth.cookie}})).status,401);
  assert.equal((await agent(l,g,'/state?token='+g.token)).status,401);
  assert.equal((await fetch(l.relay.origin+'/api/admin/agent-access',{method:'POST',headers:{cookie:l.auth.cookie,'content-type':'application/json'},body:JSON.stringify({password,scope:'configure',ttlSeconds:60})})).status,403);
  assert.equal((await fetch(l.relay.origin+'/api/admin/services',{headers:{authorization:'Bearer '+g.token}})).status,401);
  assert.equal((await l.api('/admin/agent-access','POST',{password:password+'wrong',scope:'read',ttlSeconds:60})).status,403);
  assert.equal((await l.api('/admin/agent-access','POST',{password,scope:'configure',ttlSeconds:901})).status,400);
 }finally{await l.close();}
});
for(const action of ['revoke','expire','logout','demote','disable','password-reset'])test('credentials and outstanding plans refused after '+action,async()=>{
 const l=await guidedLab();try{
  const g=await issue(l,'configure',action==='expire'?1:60),p=await plan(l,g);
  if(action==='revoke')assert.equal((await l.api('/admin/agent-access/'+g.id,'DELETE',{password})).status,200);
  if(action==='expire')await delay(1100);
  if(action==='logout')assert.equal((await l.api('/logout','POST',{})).status,200);
  if(['demote','disable','password-reset'].includes(action)){
   assert.equal((await l.api('/admin/users','POST',{username:'operator',role:'admin',password})).status,200);
   const operator=client(l.relay.origin,await authenticate(l.relay.origin,l.dir+'/state','operator'));
   assert.equal((await operator('/admin/users/'+l.auth.s.user.id,'PATCH',action==='demote'?{role:'user'}:action==='disable'?{disabled:true}:{password:password+'new'})).status,200);
  }
  assert.equal((await agent(l,g,'/state')).status,401);assert.equal((await agent(l,g,'/apply',p)).status,401);
 }finally{await l.close();}
});
test('two plans at one revision serialize; concurrent exact retries create one app',async()=>{
 const l=await guidedLab();try{
  const g=await issue(l);const a=await plan(l,g),b=await plan(l,g,{...change,set:{label:'Competing'}});
  const statuses=await Promise.all([a,b].map(p=>agent(l,g,'/apply',p).then(r=>r.status)));assert.deepEqual(statuses.sort(),[200,409]);
  const p=await plan(l,g,{type:'app',id:null,set:{label:'One shared app',gateway:{target:'existing'},userIds:[]}});
  const results=await Promise.all([1,2].map(async()=>{const r=await agent(l,g,'/apply',p);assert.equal(r.status,200);return r.json();}));assert.deepEqual(results[0],results[1]);
  const apps=await (await l.api('/admin/apps')).json();assert.equal(apps.length,1);assert.equal(apps[0].id,results[0].objectId);
 }finally{await l.close();}
});
