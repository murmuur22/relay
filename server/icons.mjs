import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fail} from './accounts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
let active=0;
export async function normalizeIcon(bytes,type){
 if(!['image/png','image/jpeg','image/webp'].includes(type)||!Buffer.isBuffer(bytes)||!bytes.length)throw fail(400,'Use PNG, JPEG or WebP');
 if(bytes.length>1048576)throw fail(413,'Icon exceeds 1 MiB');
 if(active>=2)throw fail(429,'Icon processing busy');active++;
 try{return await new Promise((resolve,reject)=>{
  const child=spawn(root+'integrations/keepsakes/.venv/bin/python',[root+'tools/icon-normalize.py',type],{stdio:['pipe','pipe','ignore']});let size=0,chunks=[],settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(fail(400,'Icon decoding timed out'));},5000);
  child.on('error',()=>finish(fail(503,'Icon decoder unavailable')));child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>131072){child.kill('SIGKILL');finish(fail(400,'Icon output too large'));}else chunks.push(chunk);});
  child.on('close',code=>finish(code===0&&size>0?null:fail(400,'Invalid or oversized image'),Buffer.concat(chunks)));child.stdin.end(bytes);
 });}finally{active--;}
}
