import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client} from '../auth-helper.mjs';

test('native registration does not require Relay DNS or reachability but rejects prohibited literals',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-native-registration-');const g=await createGateway({port:0,runtime});
 try{
  const api=client(g.origin,await authenticate(g.origin,runtime));
  const draft={kind:'web',mode:'native',label:'Client-only fixture',address:'http://client-only.invalid/',icon:'globe',openMode:'tab',allowedOrigins:[],userIds:[]};
  const added=await api('/admin/apps','POST',draft);assert.equal(added.status,200);
  assert.equal((await added.json()).address,draft.address);
  for(const address of [g.origin,'http://127.0.0.1:12345/','https://127.0.0.1:12346/','http://169.254.169.254/','http://100.100.100.200/','http://[fd00:ec2::254]/'])assert.equal((await api('/admin/apps','POST',{...draft,address})).status,400,address);
 }finally{await g.close();await rm(runtime,{recursive:true,force:true});}
});
