// Operator/managed/CLI schema and persistence contracts for the narrow Origin option.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {guidedLab,password} from '../guided-helper.mjs';
import {validateGatewayReference,loadGatewayConfig} from '../../server/experimental-gateway-config.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client} from '../auth-helper.mjs';
import {gatewayForm,configFromForm} from '../../src/gateway-settings.js';
import {remotePKI,remoteReference} from '../remote-tls-helper.mjs';
import {launchGateway,redeemGateway,edgeRequest} from '../gateway-helper.mjs';

const cli=(l,file,command,body)=>new Promise((resolve,reject)=>{
 const args=['tools/relay-agent.mjs',command,'--url',l.relay.origin,'--loopback-http','--token-file',file,'--json'];if(body)args.push('--input','-');
 const child=spawn(process.execPath,args,{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.stdin.on('error',()=>{});child.on('close',code=>resolve({code,data:JSON.parse(code?err:out)}));child.stdin.end(body?JSON.stringify(body):undefined);
});

test('CLI plans preserve httpOrigin through managed save, panel form, readback and restart',{timeout:20000},async()=>{
 const l=await guidedLab();let restarted;try{
  const grant=await(await l.api('/admin/agent-access','POST',{password,scope:'configure',ttlSeconds:60})).json(),file=l.dir+'/token';await writeFile(file,grant.token,{mode:0o600});
  const run=async(cmd,body)=>{const r=await cli(l,file,cmd,body);assert.equal(r.code,0);return r.data;};
  let state=await run('state');const plan=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'origin',set:{label:'Origin',upstream:l.origin,httpOrigin:'upstream'}}});
  assert.equal(plan.change.set.httpOrigin,'upstream');await run('apply',plan);
  let config=(await(await l.api('/admin/gateway')).json()).config;assert.equal(config.targets.at(-1).httpOrigin,'upstream');assert.deepEqual(configFromForm(gatewayForm(config)),config);
  const app=await(await l.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Origin',gateway:{target:'origin'},userIds:[]})).json();
  const launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);assert.equal((await edgeRequest(l,launch.origin,'/',{method:'POST',headers:{origin:launch.origin,cookie:cap.cookie}})).status,200);assert.equal(l.hits.at(-1).headers.origin,l.origin,'HTTP upstream remains HTTP');
  state=await run('state');const stale=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'origin',set:{httpOrigin:'upstream'}}});
  config.targets.at(-1).httpOrigin='omit';assert.equal((await l.api('/admin/gateway','PUT',{config,baseConfig:(await(await l.api('/admin/gateway')).json()).config,password})).status,200);
  const refused=await cli(l,file,'apply',stale);assert.equal(refused.code,1);assert.equal(refused.data.error.status,409);
  assert.equal((await l.api('/admin/gateway','PUT',{config:{...config,targets:config.targets.map(t=>({...t,httpOrigin:'upstream'}))},baseConfig:l.config,password})).status,409);
  state=await run('state');assert.equal(state.targets.at(-1).httpOrigin,'omit');
  const bytes=await readFile(l.dir+'/state/gateway-managed.json');assert.deepEqual(JSON.parse(bytes),config);
  await l.relay.close();restarted=await createGateway({port:0,runtime:l.dir+'/state',profile:'standalone'});const api=client(restarted.origin,await authenticate(restarted.origin,l.dir+'/state'));
  assert.deepEqual((await(await api('/admin/gateway')).json()).config,config);
 }finally{await restarted?.close();await l.close();}
});

test('operator reference and managed schemas reject malformed policies and unknown fields',{timeout:20000},async()=>{
 const l=await guidedLab();try{
  await remotePKI(l.dir);
  for(const version of [1,2,3]){
   const config=version===3?{...remoteReference(l.dir,l.config.port),targets:structuredClone(l.config.targets)}:version===1?structuredClone(l.config):{version:2,mode:'reverse-proxy',bind:'127.0.0.1',port:l.config.port,desktopOrigin:'https://desktop.example.test',appBaseDomain:'apps.example.test',trustedProxy:'127.0.0.1',targets:structuredClone(l.config.targets)};
   for(const policy of ['upstream','omit']){config.targets[0].httpOrigin=policy;assert.equal((await validateGatewayReference(config)).targets[0].httpOrigin,policy);}
   delete config.targets[0].httpOrigin;assert.equal((await validateGatewayReference(config)).targets[0].httpOrigin,'omit');
   for(const value of [null,true,1,[],{},['upstream'],'https://attacker.example','browser','UPSTREAM']){config.targets[0].httpOrigin=value;await assert.rejects(validateGatewayReference(config));}
   config.targets[0].httpOrigin='upstream';config.targets[0].httpOrigins='upstream';await assert.rejects(validateGatewayReference(config));delete config.targets[0].httpOrigins;
   for(const header of ['origin','referer','x-forwarded-host']){config.targets[0].requestHeaders=[header];await assert.rejects(validateGatewayReference(config));}delete config.targets[0].requestHeaders;
   const path=l.dir+'/operator.json';await writeFile(path,JSON.stringify(config),{mode:0o600});assert.equal((await loadGatewayConfig(path)).targets[0].httpOrigin,'upstream');
  }
  const before=await readFile(l.dir+'/state/gateway-managed.json');const invalid=structuredClone(l.config);invalid.targets[0].httpOrigin=null;assert.equal((await l.api('/admin/gateway','PUT',{config:invalid,password})).status,400);assert.deepEqual(await readFile(l.dir+'/state/gateway-managed.json'),before);
 }finally{await l.close();}
});
