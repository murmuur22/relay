import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {gatewayLab,launchGateway,redeemGateway,edgeRequest} from '../gateway-helper.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const source=process.env.RELAY_TEST_EXTERMINATOR_SOURCE;
test('actual Exterminator 0.2.0 HTTPS app submission: header diagnosis, acknowledgment and admin DB readback',{timeout:30000,skip:!source&&'Set RELAY_TEST_EXTERMINATOR_SOURCE to read-only v0.2.0 source'},async()=>{
 const dir=await mkdtemp(tmpdir()+'/relay-exterminator-');let child,l;
 try{
  child=spawn(process.env.RELAY_TEST_EXTERMINATOR_PYTHON??source+'/.venv/bin/python',[fileURLToPath(new URL('./exterminator-fixture.py',import.meta.url)),source,dir+'/reports.sqlite3','https://desktop.forms.test'],{stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  const lines=createInterface({input:child.stdout});let errorText='';child.stderr?.on('data',c=>{errorText+=c.toString();});let timer;let info;try{const [line]=await Promise.race([once(lines,'line'),once(child,'exit').then(()=>{throw Error('Exterminator fixture exited before readiness: '+errorText);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Exterminator fixture readiness deadline')),10000);})]);info=JSON.parse(line);}finally{clearTimeout(timer);lines.close();}assert.equal(info.version,'0.2.0');
  const target=(id,port,requestHeaders)=>({id,label:id,upstream:'http://127.0.0.1:'+port,requestHeaders});
  l=await gatewayLab({gatewayConfig:{desktopHostname:'desktop.forms.test',appBaseDomain:'apps.forms.test'},targets:[target('submission',info.submission,['x-exterminator']),target('missing-header',info.submission,[]),target('admin',info.admin,['x-exterminator'])]});
  const add=async target=>{const r=await l.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:target,gateway:{target},userIds:[]});assert.equal(r.status,200);return r.json();};
  const app=await add('submission'),missing=await add('missing-header'),adminApp=await add('admin');
  const user=await(await l.api('/admin/users','POST',{username:'reporter',password,grants:[app.id,missing.id]})).json();
  const api=client(l.relay.origin,await authenticate(l.relay.origin,l.dir+'/state','reporter'));
  const launch=await launchGateway(l,app,api),cap=await redeemGateway(l,launch),broken=await launchGateway(l,missing,api),brokenCap=await redeemGateway(l,broken);
  const submit=(route,cookie,origin=route.origin,extra={})=>edgeRequest(l,route.origin,'/api/submit',{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-exterminator':'1',...extra},body:{title:'[Synthetic] HTTPS gateway regression',kind:'bug',detail:'temporary database only'}});
  assert.equal((await submit(broken,brokenCap.cookie)).status,403,'real app denies missing configured custom-header forwarding');
  for(const origin of ['https://forbidden.forms.test','null',l.relay.experimentalGateway.desktopOrigin])assert.equal((await submit(launch,cap.cookie,origin)).status,403);
  assert.equal((await submit(launch,'')).status,403);assert.equal((await submit(broken,cap.cookie)).status,403,'capability bound to route');
  await l.api('/admin/users','POST',{username:'otherreporter',password,grants:[app.id]});const otherAPI=client(l.relay.origin,await authenticate(l.relay.origin,l.dir+'/state','otherreporter')),otherRoute=await launchGateway(l,app,otherAPI),otherCap=await redeemGateway(l,otherRoute);assert.equal((await submit(otherRoute,cap.cookie)).status,403,'another account route rejects original capability');assert.equal((await edgeRequest(l,otherRoute.origin,'/',{headers:{cookie:otherCap.cookie}})).status,200,'other account has its own genuine granted form');
  assert.equal((await submit(launch,cap.cookie,launch.origin,{'content-type':'text/plain'})).status,415,'application still validates MIME');
  assert.equal((await submit(launch,cap.cookie,launch.origin,{'x-exterminator':'0'})).status,403,'no manufactured application mutation header');
  const saved=await submit(launch,cap.cookie);assert.equal(saved.status,201);assert.deepEqual(saved.json(),{ok:true});
  assert.equal((await edgeRequest(l,launch.origin,'/api/reports',{headers:{cookie:cap.cookie}})).status,404);assert.equal((await api('/windows','POST',{appId:adminApp.id})).status,403);
  const adminLaunch=await launchGateway(l,adminApp),adminCap=await redeemGateway(l,adminLaunch);
  const reports=await edgeRequest(l,adminLaunch.origin,'/api/reports',{headers:{cookie:adminCap.cookie}});assert.equal(reports.status,200);assert.equal(reports.json().length,1);assert.equal(reports.json()[0].title,'[Synthetic] HTTPS gateway regression');
  const direct=await fetch('http://127.0.0.1:'+info.submission+'/api/submit',{method:'POST',headers:{Origin:launch.origin,'Content-Type':'application/json','X-Exterminator':'1'},body:JSON.stringify({title:'must not save'})});assert.equal(direct.status,403,'upstream retains exact direct Origin check');
  await l.api('/admin/users/'+user.id,'PATCH',{grants:[]});assert.equal((await submit(launch,cap.cookie)).status,403);
  const final=await edgeRequest(l,adminLaunch.origin,'/api/reports',{headers:{cookie:adminCap.cookie}});assert.equal(final.json().length,1,'negative requests wrote nothing');
 }finally{await l?.close();if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});}
});
