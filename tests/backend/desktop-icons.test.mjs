import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {normalizeIcon} from '../../server/icons.mjs';
import {Desktop} from '../../server/desktop.mjs';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const image=(format='PNG',size=300)=>execFileSync(ROOT+'integrations/keepsakes/.venv/bin/python',['-c',`from PIL import Image; import sys; Image.new('RGB',(${size},${size}),(23,45,67)).save(sys.stdout.buffer,format='${format}')`],{timeout:10000,maxBuffer:2*1024*1024});
test('icon decoder admits two real subprocesses and rejects excess without queueing',{timeout:10000},async()=>{const bytes=image();const results=await Promise.allSettled([normalizeIcon(bytes,'image/png'),normalizeIcon(bytes,'image/png'),normalizeIcon(bytes,'image/png')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(results[2].reason.status,429);});
test('icons normalize real raster bytes, stay private, clean replacements and reject hostile inputs',{timeout:30000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-icons-');let g;try{g=await createGateway({port:0,runtime});const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);const d=await (await api('/desktop')).json(),item=d.items[0];
 const upload=(bytes,type='image/png',extra={})=>fetch(g.origin+'/api/desktop/items/'+item.id+'/icon',{method:'POST',headers:{cookie:auth.cookie,Origin:g.origin,'X-CSRF-Token':auth.s.csrf,'Content-Type':type,...extra},body:bytes});
 let old;for(const [format,type] of [['PNG','image/png'],['JPEG','image/jpeg'],['WEBP','image/webp']]){const r=await upload(image(format),type);assert.equal(r.status,200,await r.clone().text());const icon=(await r.json()).items.find(i=>i.id===item.id).icon;assert.equal(icon.type,'upload');const fetched=await fetch(g.origin+icon.url,{headers:{cookie:auth.cookie}});assert.equal(fetched.status,200);assert.equal(fetched.headers.get('content-type'),'image/png');assert.equal(fetched.headers.get('cache-control'),'no-store');const bytes=Buffer.from(await fetched.arrayBuffer());assert.equal(bytes.readUInt32BE(16),128);assert.equal(bytes.readUInt32BE(20),128);assert.equal((await fetch(g.origin+icon.url)).status,401);if(old)assert.equal((await fetch(g.origin+old,{headers:{cookie:auth.cookie}})).status,404);old=icon.url;}
 for(const [bytes,type] of [[Buffer.from('<svg/>'),'image/svg+xml'],[Buffer.from('<html>oops</html>'),'image/png'],[image(),'image/jpeg'],[image('PNG',5000),'image/png']])assert.equal((await upload(bytes,type)).status,400);
 assert.equal((await upload(Buffer.alloc(1024*1024+1))).status,413);assert.equal((await upload(image(),'image/png',{'X-CSRF-Token':'bad'})).status,403);
 await api('/admin/users','POST',{username:'viewer',password,grants:['parcels']});const other=await authenticate(g.origin,runtime,'viewer');assert.equal((await fetch(g.origin+old,{headers:{cookie:other.cookie}})).status,404);
 assert.equal((await client(g.origin,other)('/desktop/items/'+item.id,'PATCH',{label:'stolen'})).status,404);
 const dir=runtime+'/users/'+auth.s.user.id+'/icons';assert.equal((await stat(dir)).mode&0o777,0o700);assert.equal((await readdir(dir)).length,1);assert.equal((await stat(dir+'/'+(await readdir(dir))[0])).mode&0o777,0o600);
 const store=new Desktop(runtime);let reads=0;await assert.rejects(store.readIcon(auth.s.user.id,()=>++reads>=5?[]:g.accounts.apps(g.accounts.state.users[0]),old.split('/').pop()),/unavailable/);
 await api('/desktop/items/'+item.id,'PATCH',{icon:null});assert.equal((await readdir(dir)).length,0);
 }finally{await g?.close();await rm(runtime,{recursive:true,force:true});}
});
