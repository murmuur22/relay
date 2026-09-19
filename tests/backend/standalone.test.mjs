import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway,APPS} from '../../server/gateway.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import net from 'node:net';
import {normalizeIcon} from '../../server/icons.mjs';
import {authenticate,client} from '../auth-helper.mjs';

test('standalone setup is available and fails Pillow preflight before browser installation',{timeout:10000},async()=>{
 const script=new URL('../../tools/setup-standalone.mjs',import.meta.url);
 await readFile(script);
 const child=spawn(process.execPath,[decodeURIComponent(script.pathname)],{env:{...process.env,RELAY_ICON_PYTHON:'/nonexistent/relay-python'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const [code]=await once(child,'exit');assert.notEqual(code,0);assert.match(output,/Pillow/);assert.doesNotMatch(output,/Downloading/);
 const pkg=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));assert.equal(pkg.scripts['setup:standalone'],'node tools/setup-standalone.mjs');
});

test('invalid icon operator path refuses gateway startup',{timeout:10000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-invalid-icon-'),previous=process.env.RELAY_ICON_PYTHON;let g;
 try{process.env.RELAY_ICON_PYTHON='relative-python';await assert.rejects(async()=>{g=await createGateway({port:0,runtime,profile:'standalone'});},/absolute/);await assert.rejects(readFile(runtime+'/open-url.txt'),{code:'ENOENT'});}
 finally{await g?.close();if(previous===undefined)delete process.env.RELAY_ICON_PYTHON;else process.env.RELAY_ICON_PYTHON=previous;await rm(runtime,{recursive:true,force:true});}
});

test('icon decoder honors trusted absolute operator executable and rejects relative paths',{timeout:10000},async()=>{
 const previous=process.env.RELAY_ICON_PYTHON;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
 try{process.env.RELAY_ICON_PYTHON='/nonexistent/relay-test-python';await assert.rejects(normalizeIcon(png,'image/png'),/unavailable/);
 process.env.RELAY_ICON_PYTHON='python3';await assert.rejects(normalizeIcon(png,'image/png'),/absolute/);
 }finally{if(previous===undefined)delete process.env.RELAY_ICON_PYTHON;else process.env.RELAY_ICON_PYTHON=previous;}
});

async function cli(env,fn){
 const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 try{await fn(child,()=>output);}finally{child.kill('SIGTERM');await Promise.race([exited,delay(3000).then(()=>child.kill('SIGKILL'))]);}
}
test('CLI standalone uses isolated absolute state and localhost without native startup',{timeout:12000},async()=>{
 assert.match(await readFile(new URL('../../server/index.mjs',import.meta.url),'utf8'),/RELAY_STATE_DIR/);
 const runtime=await mkdtemp(tmpdir()+'/relay-cli-');const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 try{await cli({RELAY_PROFILE:'standalone',RELAY_STATE_DIR:runtime,RELAY_HOSTNAME:'localhost',PORT:String(port)},async(child,output)=>{
  for(let n=0;n<80&&!output().includes('Relay listening');n++){if(child.exitCode!==null)break;await delay(50);}
  assert.match(output(),/Relay listening on http:\/\/localhost:/);assert.doesNotMatch(output(),/Keepsakes PID/);
  assert.equal(await readFile(runtime+'/open-url.txt','utf8'),`http://localhost:${port}/`);
  const auth=await authenticate(`http://localhost:${port}`,runtime);assert.deepEqual(auth.s.apps,[]);
 });}finally{await rm(runtime,{recursive:true,force:true});}
});


test('CLI rejects relative state directories before startup',{timeout:10000},async()=>{
 const cwd=await mkdtemp(tmpdir()+'/relay-cli-invalid-');let child;
 try{
  child=spawn(process.execPath,[decodeURIComponent(new URL('../../server/index.mjs',import.meta.url).pathname)],{cwd,env:{...process.env,RELAY_PROFILE:'standalone',RELAY_STATE_DIR:'relative',PORT:'4199'},stdio:['ignore','ignore','pipe']});
  let errors='';child.stderr.on('data',b=>errors+=b);const exited=once(child,'exit');
  await Promise.race([exited,delay(1500)]);assert.match(errors,/RELAY_STATE_DIR.*absolute/);
  await assert.rejects(readFile(cwd+'/relative/open-url.txt'),{code:'ENOENT'});
 }finally{child?.kill('SIGTERM');await rm(cwd,{recursive:true,force:true});}
});

test('invalid profile and standalone native refuse before touching state',{timeout:10000},async()=>{
 const root=await mkdtemp(tmpdir()+'/relay-invalid-profile-');
 try{for(const options of [{profile:'invalid'},{profile:'standalone',native:true},{hostname:'0.0.0.0'},{hostname:'localhost.evil'},{hostname:'localhost:4190'}]){
  let g;try{await assert.rejects(async()=>{g=await createGateway({port:0,runtime:root+'/unused',...options});},/profile|native|hostname/i);}finally{await g?.close();}
  await assert.rejects(readFile(root+'/unused/open-url.txt'),{code:'ENOENT'});
 }}finally{await rm(root,{recursive:true,force:true});}
});
test('localhost origin remains exact, loopback bound and native cookie-host protected',{timeout:10000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-hostname-');let g;
 try{g=await createGateway({port:0,runtime,profile:'standalone',hostname:'localhost'});
 assert.equal(new URL(g.origin).hostname,'localhost');assert.equal(g.server.address().address,'127.0.0.1');
 const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
 assert.equal((await fetch(g.origin.replace('localhost','127.0.0.1')+'/api/auth')).status,403);
 assert.equal((await fetch(g.origin+'/api/session',{headers:{cookie:auth.cookie,Origin:g.origin.replace('localhost','127.0.0.1')}})).status,403);
 assert.equal((await api('/admin/services','POST',{kind:'web',mode:'native',label:'Unsafe',address:'http://localhost:9999',icon:'globe'})).status,400);
 assert.equal((await api('/admin/services','POST',{kind:'web',mode:'native',label:'Safe host',address:'http://127.0.0.1:9999',icon:'globe'})).status,200);
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
test('development state is preserved and refused by standalone',{timeout:10000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-profile-state-');let g;
 try{g=await createGateway({port:0,runtime});assert.deepEqual(g.accounts.templates,APPS);await authenticate(g.origin,runtime);await g.close();g=null;
 const before=await readFile(runtime+'/accounts.json');await assert.rejects(createGateway({port:0,runtime,profile:'standalone'}),/refusing/);assert.deepEqual(await readFile(runtime+'/accounts.json'),before);
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});

test('standalone has no templates, native routes or subprocess and preserves web registry on restart',{timeout:15000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-standalone-test-');let g;
 try{
  g=await createGateway({port:0,runtime,profile:'standalone'});
  let auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
  assert.deepEqual(auth.s.apps,[]);assert.deepEqual(g.accounts.templates,[]);assert.equal(g.nativeService,undefined);
  for(const template of APPS){assert.equal((await api('/admin/services','POST',{template:template.id})).status,400);assert.equal((await fetch(g.origin+'/native/'+template.id+'/',{headers:{cookie:auth.cookie}})).status,404);}
  const r=await api('/onboarding/app','POST',{kind:'web',mode:'stream',label:'Fixture',address:'http://127.0.0.1:9999',icon:'globe'});assert.equal(r.status,200);const app=await r.json();
  await g.close();g=null;g=await createGateway({port:0,runtime,profile:'standalone'});
  auth=await authenticate(g.origin,runtime);assert.deepEqual(auth.s.apps.map(a=>a.id),[app.id]);assert.equal(auth.s.user.username,'admin');
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
