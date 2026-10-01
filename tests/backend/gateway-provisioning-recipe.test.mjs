import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,realpath,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {remoteReference} from '../remote-tls-helper.mjs';
import {validateGatewayReference} from '../../server/experimental-gateway-config.mjs';
test('documented offline OpenSSL recipe produces usable protected backend credentials and refuses overwrite',async()=>{
 const dir=await realpath(await mkdtemp(tmpdir()+'/relay-recipe-'));
 try{
  const doc=await readFile(new URL('../../docs/caddy-gateway.md',import.meta.url),'utf8'),recipe=doc.match(/<!-- provisioning-recipe -->\n```sh\n([\s\S]*?)\n```/)[1];
  await writeFile(dir+'/recipe.sh',recipe,{mode:0o600});
  const env={...process.env,RELAY_PKI_DIR:dir+'/pki',RELAY_BACKEND_NAME:'backend.example.test',RELAY_CADDY_NAME:'caddy.example.test'};
  try{execFileSync('/bin/sh',[dir+'/recipe.sh'],{env,stdio:'pipe',timeout:30000});}catch(e){throw Error(e.stderr.toString().slice(-1600));}
  assert.equal((await stat(dir+'/pki')).mode&0o777,0o700);
  for(const name of await readdir(dir+'/pki'))assert.equal((await stat(dir+'/pki/'+name)).mode&0o777,0o600);
  const ref=remoteReference(dir+'/pki',18444);assert.ok((await validateGatewayReference(ref)).proxy.mtls);
  const before=await readFile(dir+'/pki/server.key');assert.throws(()=>execFileSync('/bin/sh',[dir+'/recipe.sh'],{env,stdio:'ignore'}));assert.deepEqual(await readFile(dir+'/pki/server.key'),before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
