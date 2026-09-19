import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
const password='Synthetic-test-passphrase-42!';
export async function authenticate(origin,runtime,username='admin',pass=password){
 const info=await (await fetch(origin+'/api/auth')).json();
 const setup=info.setup?new URL(await readFile(runtime+'/setup-url.txt','utf8')).hash.slice(1):undefined;
 const r=await fetch(origin+(setup?'/api/enroll':'/api/login'),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':info.csrf},body:JSON.stringify({username,password:pass,setup})});
 assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
 const s=await (await fetch(origin+'/api/session',{headers:{cookie}})).json();return {cookie,s};
}
test('protected enrollment creates persistent admin once; no bootstrap bypass',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-accounts-');let g;
 try{
  g=await createGateway({port:0,runtime});
  const info=await (await fetch(g.origin+'/api/auth')).json();assert.equal(info.setup,true);
  const headers={Origin:g.origin,'Content-Type':'application/json','X-CSRF-Token':info.csrf};
  assert.equal((await fetch(g.origin+'/api/enroll',{method:'POST',headers,body:JSON.stringify({password})})).status,403);
  const {cookie,s}=await authenticate(g.origin,runtime);assert.equal(s.user.username,'admin');assert.equal(s.user.role,'admin');
  assert.equal((await stat(runtime+'/accounts.json')).mode&0o777,0o600);
  const disk=await readFile(runtime+'/accounts.json','utf8');assert.ok(!disk.includes(password));
  assert.equal((await fetch(g.origin+'/api/enroll',{method:'POST',headers,body:JSON.stringify({password})})).status,403);
  assert.notEqual((await fetch(g.origin+'/bootstrap?token=anything')).status,303);
  await g.close();g=await createGateway({port:0,runtime});
  assert.equal((await fetch(g.origin+'/api/session',{headers:{cookie}})).status,401);
  assert.equal((await (await fetch(g.origin+'/api/auth')).json()).setup,false);
  assert.equal((await authenticate(g.origin,runtime)).s.user.id,s.user.id);
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
