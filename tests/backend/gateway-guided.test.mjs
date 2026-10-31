import test from 'node:test';
import assert from 'node:assert/strict';
import {guidedLab,password} from '../guided-helper.mjs';
import {readFile} from 'node:fs/promises';
test('guided checks are explicit, password protected, tiered and bound to unchanged managed configuration',async()=>{
 const l=await guidedLab();try{
 const body={baseConfig:l.config,config:{...l.config,targets:[...l.config.targets,{id:'cockpit',label:'Cockpit',upstream:l.origin,entryPath:'/',cookieNames:['cockpit'],webSocketPaths:['/cockpit/socket'],webSocketProtocols:['cockpit1'],webSocketOrigin:'upstream',presentation:'tab',accessPolicy:'admin-only'}]},targetId:'cockpit',profileVersion:1,password};
 assert.equal(l.hits.length,0);
 const r=await l.api('/admin/gateway/check-target','POST',body);assert.equal(r.status,200);const result=await r.json();
 assert.equal(result.tiers.http.state,'passed');assert.equal(result.tiers.login.state,'not-tested');assert.equal(result.tiers.live.state,'not-tested');assert.equal(result.tiers.revocation.state,'not-tested');assert.equal(result.tiers.certificate.state,'not-tested');assert.equal(result.source,'relay');assert.ok(result.checkedAt);assert.ok(result.configIdentity);
 assert.equal(l.hits.length,1);assert.equal(l.hits[0].headers.cookie,undefined);assert.equal(l.hits[0].headers.authorization,undefined);
 assert.equal((await l.api('/admin/gateway/check-target','POST',{...body,password:'wrong'})).status,403);
 const bytes=await readFile(l.dir+'/state/gateway-managed.json');
 assert.equal((await l.api('/admin/gateway','PUT',{config:body.config,baseConfig:{...l.config,port:12345},password})).status,409);
 assert.deepEqual(await readFile(l.dir+'/state/gateway-managed.json'),bytes);
 }finally{await l.close();}
});
