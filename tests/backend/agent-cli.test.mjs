import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFile,chmod,symlink} from 'node:fs/promises';
import http from 'node:http';
import {guidedLab,password} from '../guided-helper.mjs';
const cli=(args,input)=>new Promise((resolve,reject)=>{
 const p=spawn(process.execPath,['tools/relay-agent.mjs',...args],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.stdin.on('error',()=>{});p.on('close',code=>resolve({code,stdout,stderr}));p.stdin.end(input);
});
async function issue(l,scope='configure',ttlSeconds=60){const r=await l.api('/admin/agent-access','POST',{password,scope,ttlSeconds});assert.equal(r.status,200);return r.json();}
async function fixture(){const l=await guidedLab(),g=await issue(l);const tokenFile=l.dir+'/agent-token';await writeFile(tokenFile,g.token,{mode:0o600});
 const run=async(command,body)=>{const args=[command,'--url',l.relay.origin,'--loopback-http','--token-file',tokenFile,'--json'];if(body!==undefined)args.push('--input','-');const r=await cli(args,body===undefined?undefined:JSON.stringify(body));assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout);};return {l,g,tokenFile,run};}
test('actual CLI help and shared target/app API-level bidirectional tracer',async()=>{
 const help=await cli(['--help']);assert.equal(help.code,0,help.stderr);assert.match(help.stdout,/plan/);
 const {l,run}=await fixture();try{
  let state=await run('list');assert.equal(state.targets[0].id,'existing');
  const targetPlan=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'cli-target',set:{label:'CLI target',upstream:l.origin}}});
  assert.equal((await l.api('/admin/gateway').then(r=>r.json())).config.targets.length,1);
  const targetResult=await run('apply',targetPlan);assert.equal(targetResult.objectId,'cli-target');assert.deepEqual(await run('apply',targetPlan),targetResult);
  let config=(await (await l.api('/admin/gateway')).json()).config;assert.equal(config.targets.at(-1).id,'cli-target');config.targets.at(-1).label='Browser target';assert.equal((await l.api('/admin/gateway','PUT',{config,password})).status,200);
  state=await run('state');assert.equal(state.targets.at(-1).label,'Browser target');
  const appPlan=await run('plan',{expectedRevision:state.revision,change:{type:'app',id:null,set:{label:'CLI app',gateway:{target:'cli-target'},userIds:[]}}});
  const appResult=await run('apply',appPlan);assert.match(appResult.objectId,/^service-/);assert.deepEqual(await run('apply',appPlan),appResult);
  const id=appResult.objectId;assert.equal((await (await l.api('/admin/apps')).json())[0].id,id);
  assert.equal((await l.api('/admin/apps/'+id,'PATCH',{label:'Browser app'})).status,200);
  state=await run('state');assert.equal(state.apps[0].id,id);assert.equal(state.apps[0].label,'Browser app');
  const reverse=await run('plan',{expectedRevision:state.revision,change:{type:'app',id,set:{label:'CLI reverse'}}});await run('apply',reverse);
  const apps=await (await l.api('/admin/apps')).json();assert.equal(apps.length,1);assert.equal(apps[0].id,id);assert.equal(apps[0].label,'CLI reverse');
 }finally{await l.close();}
});
test('CLI protected credential inputs, bounded JSON and human/JSON failures',async()=>{
 const {l,g,tokenFile}=await fixture();try{
  const args=['state','--url',l.relay.origin,'--loopback-http'];
  const stdin=await cli([...args,'--token-stdin','--json'],g.token+'\n');assert.equal(stdin.code,0,stdin.stderr);assert.equal(JSON.parse(stdin.stdout).targets[0].id,'existing');
  let r=await cli(['state','--url',l.relay.origin,'--token-file',tokenFile]);assert.equal(r.code,1);assert.match(r.stderr,/Verified HTTPS/);assert.equal(r.stdout,'');
  await chmod(tokenFile,0o644);r=await cli([...args,'--token-file',tokenFile,'--json']);assert.equal(r.code,1);assert.equal(JSON.parse(r.stderr).error.code,'CREDENTIAL_FILE');await chmod(tokenFile,0o600);
  await symlink(tokenFile,l.dir+'/linked-token');r=await cli([...args,'--token-file',l.dir+'/linked-token','--json']);assert.equal(r.code,1);
  for(const extra of [['--insecure'],['--token',g.token]]){r=await cli([...args,'--token-file',tokenFile,...extra,'--json']);assert.equal(r.code,1);assert.equal(JSON.parse(r.stderr).error.code,'USAGE');assert(!r.stderr.includes(g.token));}
  r=await cli([...args,'--token-stdin','--json'],'x'.repeat(200));assert.equal(r.code,1);assert.equal(JSON.parse(r.stderr).error.code,'INPUT_TOO_LARGE');
  r=await cli(['plan',...args.slice(1),'--token-file',tokenFile,'--input','-','--json'],'{');assert.equal(r.code,1);assert.equal(JSON.parse(r.stderr).error.code,'JSON_INPUT');
  r=await cli(['plan',...args.slice(1),'--token-file',tokenFile,'--input','-','--json'],JSON.stringify({padding:'x'.repeat(17000)}));assert.equal(r.code,1);assert.equal(JSON.parse(r.stderr).error.code,'INPUT_TOO_LARGE');
  r=await cli([...args,'--token-stdin','--json'],l.auth.cookie);assert.equal(r.code,1);assert.equal(JSON.parse(r.stderr).error.code,'CREDENTIAL_INPUT');
  assert.equal((await l.api('/admin/agent-access/'+g.id,'DELETE',{password})).status,200);
  r=await cli([...args,'--token-file',tokenFile,'--json']);assert.equal(r.code,1);assert.equal(JSON.parse(r.stderr).error.status,401);assert(!r.stderr.includes(g.token));
 }finally{await l.close();}
});
test('CLI refuses redirects without forwarding Bearer credentials',async()=>{
 const {l,g,tokenFile}=await fixture();const hits=[];
 const destination=http.createServer((req,res)=>{hits.push(req.headers);res.end('{}');});let source;
 try{
  await new Promise(r=>destination.listen(0,'127.0.0.1',r));
  source=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+g.token);res.writeHead(307,{location:'http://127.0.0.1:'+destination.address().port+'/captured'});res.end();});await new Promise(r=>source.listen(0,'127.0.0.1',r));
  const r=await cli(['state','--url','http://127.0.0.1:'+source.address().port,'--loopback-http','--token-file',tokenFile,'--json']);assert.equal(r.code,1);assert.equal(JSON.parse(r.stderr).error.code,'REDIRECT_REFUSED');assert.equal(hits.length,0);assert(!r.stderr.includes(g.token));
 }finally{source?.closeAllConnections();if(source)await new Promise(r=>source.close(r));destination.closeAllConnections();await new Promise(r=>destination.close(r));await l.close();}
});
test('CLI loopback test mode refuses nonliteral aliases before sending credentials',async()=>{
 const {l,tokenFile}=await fixture();try{
  for(const alias of ['127.1','2130706433','0x7f000001','localhost']){
   const url=l.relay.origin.replace('127.0.0.1',alias);
   const r=await cli(['state','--url',url,'--loopback-http','--token-file',tokenFile,'--json']);assert.equal(r.code,1,alias+' must be refused');assert.equal(JSON.parse(r.stderr).error.code,'HTTPS_REQUIRED');
  }
 }finally{await l.close();}
});
