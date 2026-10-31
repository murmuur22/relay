import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {guidedLab,password} from '../guided-helper.mjs';
export function cli(args,input){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tools/relay-agent.mjs',...args],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);});}
async function issue(l,scope='configure'){const r=await l.api('/admin/agent-access','POST',{password,scope,ttlSeconds:60});assert.equal(r.status,200);return r.json();}
async function agent(l,grant,path,body){return fetch(l.relay.origin+'/api/agent/v1'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+grant.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}

test('administrator issues a bounded session-bound agent credential; bearer reads versioned state only',async()=>{
 const l=await guidedLab();try{
  const r=await l.api('/admin/agent-access','POST',{password,scope:'read',ttlSeconds:60});assert.equal(r.status,200);const grant=await r.json();
  assert.match(grant.token,/^[a-f0-9]{64}$/);assert.equal(grant.scope,'read');
  const state=await fetch(l.relay.origin+'/api/agent/v1/state',{headers:{authorization:'Bearer '+grant.token}});assert.equal(state.status,200);const data=await state.json();assert.equal(data.version,1);assert.equal(data.targets[0].id,'existing');assert.equal(typeof data.revision,'string');
  assert.equal((await fetch(l.relay.origin+'/api/admin/services',{headers:{authorization:'Bearer '+grant.token}})).status,401);
 }finally{await l.close();}
});
test('Gateway app plans share validation, stable IDs and retirement with panel edits',async()=>{
 const l=await guidedLab();try{
  const g=await issue(l),state=await (await agent(l,g,'/state')).json();
  const change={type:'app',id:null,set:{label:'Agent app',gateway:{target:'existing'},userIds:[]}};
  const r=await agent(l,g,'/plans',{expectedRevision:state.revision,change});assert.equal(r.status,200);const plan=await r.json();
  const applied=await agent(l,g,'/apply',plan);assert.equal(applied.status,200);const result=await applied.json();assert.match(result.objectId,/^service-/);
  assert.equal((await (await l.api('/admin/apps')).json())[0].id,result.objectId);
  assert.equal((await l.api('/admin/apps/'+result.objectId,'PATCH',{label:'Panel edit'})).status,200);
  assert.equal((await (await agent(l,g,'/state')).json()).apps[0].label,'Panel edit');
  const next=await (await agent(l,g,'/state')).json(),p=await (await agent(l,g,'/plans',{expectedRevision:next.revision,change:{type:'app',id:result.objectId,set:{label:'Reverse edit'}}})).json();
  assert.equal((await agent(l,g,'/apply',p)).status,200);assert.equal((await (await l.api('/admin/apps')).json())[0].label,'Reverse edit');
 }finally{await l.close();}
});
test('one exact target plan is nonmutating, revision-bound, shared with panel and reconciles retries',async()=>{
 const l=await guidedLab();try{
  const g=await issue(l),before=await (await agent(l,g,'/state')).json();
  const change={type:'target',id:'agent-target',set:{label:'Agent target',upstream:l.origin}};
  const r=await agent(l,g,'/plans',{expectedRevision:before.revision,change});assert.equal(r.status,200);const plan=await r.json();
  assert.equal((await (await l.api('/admin/gateway')).json()).config.targets.length,1);
  const applied=await agent(l,g,'/apply',plan);assert.equal(applied.status,200);const result=await applied.json();assert.equal(result.outcome,'applied');
  assert.equal((await (await l.api('/admin/gateway')).json()).config.targets.at(-1).id,'agent-target');
  assert.equal((await (await agent(l,g,'/apply',plan)).json()).outcome,'applied');
  assert.equal((await (await l.api('/admin/gateway')).json()).config.targets.length,2);
  const s=await (await agent(l,g,'/state')).json();const stale=await (await agent(l,g,'/plans',{expectedRevision:s.revision,change:{...change,set:{label:'Stale'}}})).json();
  const current=(await (await l.api('/admin/gateway')).json()).config;current.targets.at(-1).label='Panel target';assert.equal((await l.api('/admin/gateway','PUT',{config:current,password})).status,200);
  assert.equal((await agent(l,g,'/apply',stale)).status,409);
 }finally{await l.close();}
});
