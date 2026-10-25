// Real loopback development servers; no editor execution or OS configuration.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
for(const entry of ['../../node_modules/vite/dist/node/index.js','../../updater/ui/node_modules/vite/dist/node/index.js','../../integrations/parcels/node_modules/vite/dist/node/index.js'])test('Vite development file/CORS boundaries and ordinary module serving: '+entry,{timeout:20000},async()=>{
 const {createServer}=await import(new URL(entry,import.meta.url));const dir=await mkdtemp(tmpdir()+'/vite-boundary-'),root=dir+'/site';let server;
 try{await mkdir(root);await writeFile(root+'/index.html','<script type="module" src="/main.js"></script>');await writeFile(root+'/main.js','export const fixture = "ordinary-module";');await writeFile(root+'/.env','SYNTHETIC_PRIVATE_FIXTURE=not-a-secret');await writeFile(dir+'/outside.txt','synthetic-outside-file');server=await createServer({configFile:false,root,logLevel:'silent',server:{host:'127.0.0.1',port:0,strictPort:true,fs:{strict:true,allow:[root]}},optimizeDeps:{noDiscovery:true,include:[]}});await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  const module=await fetch(origin+'/main.js',{signal:AbortSignal.timeout(4000)});assert.equal(module.status,200);assert.match(await module.text(),/ordinary-module/);
  for(const path of ['/.env','/.env?raw','/@fs/'+dir+'/outside.txt']){const denied=await fetch(origin+path,{signal:AbortSignal.timeout(4000)});assert.equal(denied.status,403,path);assert.doesNotMatch(await denied.text(),/SYNTHETIC_PRIVATE_FIXTURE|synthetic-outside-file/);}
  const cors=await fetch(origin+'/main.js',{headers:{Origin:'https://untrusted.invalid'},signal:AbortSignal.timeout(4000)});assert.equal(cors.headers.get('access-control-allow-origin'),null);
 }finally{await server?.close();await rm(dir,{recursive:true,force:true});}
});
