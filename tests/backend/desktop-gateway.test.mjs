import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client} from '../auth-helper.mjs';
import {webConfig} from '../../server/webapps.mjs';
import {gatewayLab,addGateway,launchGateway,redeemGateway,edgeRequest} from '../gateway-helper.mjs';

test('real desktop gateway auth, one-use handoff, private upstream identity and End/reopen',async()=>{
 const l=await gatewayLab();try{
  const conf=await (await l.api('/gateway/config')).json();assert.equal(conf.enabled,true);assert.deepEqual(conf.targets,[{id:'files',label:'Synthetic Files'}]);
  const app=await addGateway(l);assert.deepEqual(app.gateway,{target:'files'});
  const target=await launchGateway(l,app);assert.match(target.origin,/^https:\/\/[a-f0-9]{32}\.relay\.test:\d+$/);assert.ok(!JSON.stringify(target).includes('127.0.0.1'));
  const cap=await redeemGateway(l,target);assert.equal(cap.status,200);assert.equal((await redeemGateway(l,target)).status,403);
  const request=(path,options={})=>edgeRequest(l,target.origin,path,{...options,headers:{cookie:cap.cookie,...options.headers}});
  assert.equal((await request('/private')).status,401);
  assert.equal((await request('/login',{method:'POST',headers:{origin:target.origin}})).status,200);
  assert.equal((await request('/private')).status,200);
  await request('/set');const echo=(await request('/echo',{headers:{cookie:cap.cookie+'; sid=poison'}})).json();assert.equal(echo.cookie,'sid=synthetic-jar');assert.equal(echo.auth,'Bearer synthetic-token');
  const state=await readFile(l.dir+'/state/accounts.json','utf8');assert.ok(!state.includes('synthetic-token'));assert.ok(!state.includes('127.0.0.1'));
  const session=await (await l.api('/session')).json();assert.ok(!JSON.stringify(session).includes(target.ticket));
  assert.equal((await l.api('/gateway/end','POST',{appId:app.id,launchId:target.launchId})).status,200);
  assert.equal((await request('/private')).status,403);
  const fresh=await launchGateway(l,app);assert.notEqual(fresh.origin,target.origin);const freshCap=await redeemGateway(l,fresh);
  assert.equal((await edgeRequest(l,fresh.origin,'/private',{headers:{cookie:freshCap.cookie}})).status,401);
  assert.equal((await l.api('/logout','POST')).status,200);
  assert.equal((await edgeRequest(l,fresh.origin,'/private',{headers:{cookie:freshCap.cookie}})).status,403);
 }finally{await l.close();}
});

test('gateway definitions are explicit, secret-free, persisted and corrupt state is refused',async()=>{
 const draft={kind:'web',mode:'gateway',label:'Files',gateway:{target:'files'}};
 assert.deepEqual(webConfig(draft).gateway,{target:'files'});
 for(const gateway of [null,{}, {target:'files',token:'secret'},{target:'https://bad.test'}])assert.throws(()=>webConfig({...draft,gateway}));
 assert.throws(()=>webConfig({...draft,address:'http://localhost:9999'}));
 const dir=await mkdtemp(tmpdir()+'/relay-gateway-config-');let g;
 try{
  g=await createGateway({port:0,runtime:dir,profile:'standalone'});const auth=await authenticate(g.origin,dir),api=client(g.origin,auth);
  const unavailable=await api('/gateway/config');assert.equal(unavailable.status,200);assert.deepEqual(await unavailable.json(),{enabled:false,targets:[]});
  assert.equal((await api('/admin/apps','POST',draft)).status,503);
  assert.equal((await api('/gateway/launch','POST',{appId:'missing'})).status,503);
  const saved=JSON.parse(await readFile(dir+'/accounts.json'));saved.services.push({id:'service-00000000-0000-0000-0000-000000000000',...webConfig(draft)});
  await g.close();g=null;await writeFile(dir+'/accounts.json',JSON.stringify(saved));
  g=await createGateway({port:0,runtime:dir,profile:'standalone'});await g.close();g=null;
  saved.services[0].gateway.token='secret';const corrupt=JSON.stringify(saved);await writeFile(dir+'/accounts.json',corrupt);
  await assert.rejects(createGateway({port:0,runtime:dir,profile:'standalone'}),/refusing enrollment/);
  assert.equal(await readFile(dir+'/accounts.json','utf8'),corrupt);
 }finally{await g?.close();await rm(dir,{recursive:true,force:true});}
});
