import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';

// Import the exact selected package; missing dependencies must fail, not skip.
export async function assertViteBoundaries(root){
 const {createServer}=await import(new URL('node_modules/vite/dist/node/index.js',root));
 const dir=await mkdtemp(tmpdir()+'/vite-boundary-'),site=dir+'/site';
 let server;
 try{
  await mkdir(site);
  await writeFile(site+'/index.html','<script type="module" src="/main.js"></script>');
  await writeFile(site+'/main.js','export const fixture = "ordinary-module";');
  await writeFile(site+'/.env','SYNTHETIC_PRIVATE_FIXTURE=not-a-secret');
  await writeFile(dir+'/outside.txt','synthetic-outside-file');
  server=await createServer({configFile:false,root:site,logLevel:'silent',server:{host:'127.0.0.1',port:0,strictPort:true,fs:{strict:true,allow:[site]}},optimizeDeps:{noDiscovery:true,include:[]}});
  await server.listen();
  const origin='http://127.0.0.1:'+server.httpServer.address().port;
  const module=await fetch(origin+'/main.js',{signal:AbortSignal.timeout(4000)});
  assert.equal(module.status,200);assert.match(await module.text(),/ordinary-module/);
  for(const path of ['/.env','/.env?raw','/@fs/'+dir+'/outside.txt']){
   const denied=await fetch(origin+path,{signal:AbortSignal.timeout(4000)});
   assert.equal(denied.status,403,path);
   assert.doesNotMatch(await denied.text(),/SYNTHETIC_PRIVATE_FIXTURE|synthetic-outside-file/);
  }
  const cors=await fetch(origin+'/main.js',{headers:{Origin:'https://untrusted.invalid'},signal:AbortSignal.timeout(4000)});
  assert.equal(cors.headers.get('access-control-allow-origin'),null);
 }finally{
  try{await server?.close();}finally{await rm(dir,{recursive:true,force:true});}
 }
}
