import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {deflateSync,brotliCompressSync,gzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client} from '../auth-helper.mjs';
if(process.argv[2]==='--compressed-probe'){
 const runtime=process.argv[3],encoding=process.argv[4];const g=await createGateway({port:0,runtime,profile:'standalone'});
 try{
  const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth),payload=Buffer.from('{"showAppStatus":false}');
  const compressed=encoding==='deflate'?deflateSync(payload):brotliCompressSync(payload);
  await new Promise((resolve,reject)=>{
   const req=http.request(g.origin+'/api/preferences',{method:'PATCH',headers:{Origin:g.origin,Cookie:auth.cookie,'X-CSRF-Token':auth.s.csrf,'Content-Type':'application/json','Content-Encoding':encoding,'Transfer-Encoding':'chunked'}},res=>{
    res.resume();res.on('end',()=>{try{assert.equal(res.statusCode,200);resolve();}catch(e){reject(e);}});res.on('error',reject);
   });req.on('error',reject);req.setTimeout(4000,()=>req.destroy(new Error('Compressed request deadline')));req.write(compressed);setTimeout(()=>req.end(Buffer.from('bounded trailing garbage')),10);
  });
  assert.equal((await api('/session')).status,200,'real gateway remains alive after trailing bytes');
 }finally{await g.close();}
}else{
 test('real gzip parsing retains auth, Origin, malformed-body and decompressed exact-limit controls',{timeout:15000},async()=>{
  const runtime=await mkdtemp(tmpdir()+'/parser-controls-');let g;
  try{g=await createGateway({port:0,runtime,profile:'standalone'});const auth=await authenticate(g.origin,runtime),headers={Origin:g.origin,Cookie:auth.cookie,'X-CSRF-Token':auth.s.csrf,'Content-Type':'application/json','Content-Encoding':'gzip'};
   const send=(text,h=headers)=>fetch(g.origin+'/api/preferences',{method:'PATCH',headers:h,body:gzipSync(text),signal:AbortSignal.timeout(4000)});const normal='{"showAppStatus":false}';
   assert.equal((await send(normal)).status,200);assert.equal((await send(normal+' '.repeat(16384-Buffer.byteLength(normal)))).status,200);assert.equal((await send(normal+' '.repeat(16385-Buffer.byteLength(normal)))).status,413);assert.equal((await send('{invalid')).status,400);assert.equal((await send(normal,{...headers,Origin:'https://untrusted.invalid'})).status,403);const noCookie={...headers};delete noCookie.Cookie;assert.equal((await send(normal,noCookie)).status,401);assert.equal((await client(g.origin,auth)('/session')).status,200);
  }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
 });
 for(const encoding of ['deflate','br'])test('bounded compressed '+encoding+' trailing-byte request keeps the real gateway usable',{timeout:15000},async()=>{
  const runtime=await mkdtemp(tmpdir()+'/parser-tail-');let child;
  try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--compressed-probe',runtime,encoding],{env:process.env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Owned parser probe deadline'));},9000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});child.once('error',e=>{clearTimeout(timer);reject(e);});});assert.equal(code,0,output);}
  finally{if(child?.exitCode===null)child.kill('SIGTERM');await rm(runtime,{recursive:true,force:true});}
 });
}
