import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {guidedLab,password} from '../guided-helper.mjs';
async function issue(l,ttlSeconds=60){const r=await l.api('/admin/agent-access','POST',{password,scope:'configure',ttlSeconds});assert.equal(r.status,200);return r.json();}
const agent=(l,g,path,body)=>fetch(l.relay.origin+'/api/agent/v1'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+g.token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function plan(l,g,change){const s=await (await agent(l,g,'/state')).json();const r=await agent(l,g,'/plans',{expectedRevision:s.revision,change});assert.equal(r.status,200);return r.json();}
for(const type of ['target','app'])test(type+' postcommit layout failure reconciles exact retries without claiming cleanup',async()=>{
 const l=await guidedLab();let fault;try{
  const app=await (await l.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Shared app',gateway:{target:'existing'},userIds:[]})).json();
  assert.equal((await l.api('/windows','POST',{appId:app.id})).status,200);
  const g=await issue(l),change={type,id:type==='app'?app.id:'existing',set:{label:'Committed with failed cleanup'}},p=await plan(l,g,change);
  fault=l.relay.manager.runtime+'/layout.tmp';await mkdir(fault);
  const r=await agent(l,g,'/apply',p);assert.equal(r.status,200);const result=await r.json();assert.equal(result.outcome,'applied-cleanup-unconfirmed');assert.equal(result.objectId,change.id);
  assert.deepEqual(await (await agent(l,g,'/apply',p)).json(),result);
  const state=await (await agent(l,g,'/state')).json();assert.equal((type==='app'?state.apps:state.targets).find(x=>x.id===change.id).label,change.set.label);
  assert.equal((await (await l.api('/session')).json()).windows.length,0,'retirement removes live window authority despite failed persistence');
  assert.equal((await (await l.api('/admin/apps')).json()).length,1);
 }finally{if(fault){await rm(fault,{recursive:true,force:true});await assert.rejects(l.close(),e=>e.status===503&&/cleanup is unconfirmed/.test(e.message));await assert.rejects(readFile(l.dir+'/state/accounts.json'),e=>e.code==='ENOENT');await assert.rejects(fetch(l.origin),/fetch failed/);}else await l.close();}
});
test('expired live grant while an app write waits cannot commit canonical accounts',async()=>{
 const l=await guidedLab();let release,pending;try{
  const g=await issue(l,1),p=await plan(l,g,{type:'app',id:null,set:{label:'Must not commit',gateway:{target:'existing'},userIds:[]}});
  const before=await readFile(l.dir+'/state/accounts.json');l.relay.accounts.queue=new Promise(r=>release=r);
  pending=agent(l,g,'/apply',p);await delay(1100);
  // GET issuance inventory prunes the expired grant while the serialized write is held.
  assert.deepEqual(await (await l.api('/admin/agent-access')).json(),[]);release();assert.equal((await pending).status,401);
  assert.deepEqual(await readFile(l.dir+'/state/accounts.json'),before);assert.equal((await (await l.api('/admin/apps')).json()).length,0);
 }finally{release?.();await pending?.catch(()=>{});await l.close();}
});
test('agent previews enforce canonical app/target validation without changing stores',async()=>{
 const l=await guidedLab();try{
  const g=await issue(l),state=await (await agent(l,g,'/state')).json();
  for(const change of [{type:'app',id:null,set:{label:'Missing target',gateway:{target:'absent'}}},{type:'target',id:'existing',set:{upstream:'http://169.254.169.254/'}},{type:'app',id:null,set:{label:'Bad access',gateway:{target:'existing'},userIds:['not-a-user']}}]){
   const r=await agent(l,g,'/plans',{expectedRevision:state.revision,change});assert.equal(r.status,400);
  }
  assert.deepEqual(await (await agent(l,g,'/state')).json(),state);
 }finally{await l.close();}
});
