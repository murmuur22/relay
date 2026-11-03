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
const MiB=1024*1024;
const cli=(l,file,command,body)=>new Promise((resolve,reject)=>{
 const args=['tools/relay-agent.mjs',command,'--url',l.relay.origin,'--loopback-http','--token-file',file,'--json'];if(body)args.push('--input','-');
 const child=spawn(process.execPath,args,{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.stdin.on('error',()=>{});child.on('close',code=>{try{resolve({code,data:JSON.parse(code?err:out)});}catch(e){reject(e);}});child.stdin.end(body?JSON.stringify(body):undefined);
});
test('maxRequestBytes round trips through real CLI plans, managed JSON, form edits and restart',{timeout:20000},async()=>{
 const l=await guidedLab();let restarted;try{
  const grant=await(await l.api('/admin/agent-access','POST',{password,scope:'configure',ttlSeconds:60})).json(),file=l.dir+'/token';await writeFile(file,grant.token,{mode:0o600});
  const run=async(cmd,body)=>{const r=await cli(l,file,cmd,body);assert.equal(r.code,0,JSON.stringify(r.data));return r.data;};
  let state=await run('state');
  const plan=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'forum',set:{label:'Forum',upstream:l.origin,maxRequestBytes:24*MiB}}});
  assert.equal(plan.change.set.maxRequestBytes,24*MiB);await run('apply',plan);
  let config=(await(await l.api('/admin/gateway')).json()).config;
  assert.equal(config.targets.find(t=>t.id==='forum').maxRequestBytes,24*MiB);assert.deepEqual(configFromForm(gatewayForm(config)),config);
  assert.equal(config.targets[0].maxRequestBytes,undefined,'unrelated default target is not raised');
  state=await run('state');assert.equal(state.targets.find(t=>t.id==='forum').maxRequestBytes,24*MiB);
  const stale=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'forum',set:{maxRequestBytes:MiB}}});
  const form=gatewayForm(config),target=form.targets.find(t=>t.id==='forum');const options=JSON.parse(target.options);options.maxRequestBytes=2*MiB;target.options=JSON.stringify(options);
  const changed=configFromForm(form);assert.equal((await l.api('/admin/gateway','PUT',{config:changed,baseConfig:config,password})).status,200);config=changed;
  const refused=await cli(l,file,'apply',stale);assert.equal(refused.code,1);assert.equal(refused.data.error.status,409);
  state=await run('state');assert.equal(state.targets.find(t=>t.id==='forum').maxRequestBytes,2*MiB);
  const reverse=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'forum',set:{maxRequestBytes:24*MiB}}});await run('apply',reverse);
  config=(await(await l.api('/admin/gateway')).json()).config;assert.equal(config.targets.find(t=>t.id==='forum').maxRequestBytes,24*MiB);
  const before=await readFile(l.dir+'/state/gateway-managed.json');
  state=await run('state');const invalid=await cli(l,file,'plan',{expectedRevision:state.revision,change:{type:'target',id:'forum',set:{maxRequestBytes:64*MiB+1}}});assert.equal(invalid.code,1);assert.equal(invalid.data.error.status,400);assert.deepEqual(await readFile(l.dir+'/state/gateway-managed.json'),before);
  assert.deepEqual(JSON.parse(before),config);
  await l.relay.close();restarted=await createGateway({port:0,runtime:l.dir+'/state',profile:'standalone'});const api=client(restarted.origin,await authenticate(restarted.origin,l.dir+'/state'));
  assert.deepEqual((await(await api('/admin/gateway')).json()).config,config);
 }finally{await restarted?.close();await l.close();}
});
test('all operator reference versions validate safe integer byte bounds and preserve protected file loading',{timeout:20000},async()=>{
 const l=await guidedLab();try{
  await remotePKI(l.dir);
  for(const version of [1,2,3]){
   const config=version===3?{...remoteReference(l.dir,l.config.port),targets:structuredClone(l.config.targets)}:version===1?structuredClone(l.config):{version:2,mode:'reverse-proxy',bind:'127.0.0.1',port:l.config.port,desktopOrigin:'https://desktop.example.test',appBaseDomain:'apps.example.test',trustedProxy:'127.0.0.1',targets:structuredClone(l.config.targets)};
   for(const bytes of [MiB,24*MiB,64*MiB]){config.targets[0].maxRequestBytes=bytes;assert.equal((await validateGatewayReference(config)).targets[0].maxRequestBytes,bytes);}
   delete config.targets[0].maxRequestBytes;assert.equal((await validateGatewayReference(config)).targets[0].maxRequestBytes,MiB);
   for(const value of [null,true,'25165824',[],{},0,MiB-1,MiB+0.5,64*MiB+1,Number.MAX_SAFE_INTEGER+1,Infinity,NaN]){config.targets[0].maxRequestBytes=value;await assert.rejects(validateGatewayReference(config));}
   config.targets[0].maxRequestBytes=24*MiB;config.targets[0].maxRequestByte=24*MiB;await assert.rejects(validateGatewayReference(config));delete config.targets[0].maxRequestByte;
   const path=l.dir+'/operator.json';await writeFile(path,JSON.stringify(config),{mode:0o600});assert.equal((await loadGatewayConfig(path)).targets[0].maxRequestBytes,24*MiB);
  }
  const before=await readFile(l.dir+'/state/gateway-managed.json');const invalid=structuredClone(l.config);invalid.targets[0].maxRequestBytes=null;assert.equal((await l.api('/admin/gateway','PUT',{config:invalid,password})).status,400);assert.deepEqual(await readFile(l.dir+'/state/gateway-managed.json'),before);
 }finally{await l.close();}
});
