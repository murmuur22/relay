import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Manager} from '../../server/streams.mjs';
import {createGateway,APPS} from '../../server/gateway.mjs';
test('maximize persists bounded restore geometry and never trusts saved launch URLs',{timeout:10000},async()=>{
 const dir=await mkdtemp(tmpdir()+'/relay-max-');const m=new Manager(dir,APPS);try{await m.init();const w=await m.open('parcels');assert.equal(w.maximized,false);
 await m.patch('parcels',{x:123,y:234,width:654,height:456});await m.patch('parcels',{maximized:true,x:0,y:0,width:1400,height:900});assert.deepEqual(w.restoreBounds,{x:123,y:234,width:654,height:456});
 const n=new Manager(dir,APPS);await n.init();assert.equal(n.windows.get('parcels').maximized,true);assert.deepEqual(n.windows.get('parcels').restoreBounds,w.restoreBounds);await n.patch('parcels',{maximized:false});assert.equal(n.windows.get('parcels').width,654);
 await assert.rejects(m.patch('parcels',{maximized:'true'}));await assert.rejects(m.patch('parcels',{restoreBounds:{x:0,y:0,width:'bad',height:300}}));
 await m.patch('parcels',{restoreBounds:{x:-20,y:9000,width:20,height:9000}});assert.deepEqual(w.restoreBounds,{x:0,y:4096,width:320,height:1000});
 await writeFile(dir+'/layout.json',JSON.stringify([{...w,url:'https://evil.invalid'}]));const safe=new Manager(dir,APPS);await safe.init();assert.equal(safe.windows.get('parcels').url,'/native/parcels/');
 }finally{await m.close();await rm(dir,{recursive:true,force:true});}
});
test('private desktop deep links serve generic shell only with bounded paths',{timeout:10000},async()=>{const runtime=await mkdtemp(tmpdir()+'/relay-shell-');let g;try{g=await createGateway({port:0,runtime});const root=await (await fetch(g.origin+'/')).text();for(const path of ['/desktop','/desktop/work--1234abcd/nested--deadbeef?app=notes--12345678&view=maximized']){const r=await fetch(g.origin+path);assert.equal(r.status,200);assert.equal(await r.text(),root);}for(const path of ['/api/desktop','/api/desktop/icons/1234','/native/parcels/','/ws/stream/parcels'])assert.equal((await fetch(g.origin+path)).status,401);assert.equal((await fetch(g.origin+'/desktop/'+Array(132).fill('x').join('/'))).status,414);assert.equal((await fetch(g.origin+'/desktop/'+ 'x'.repeat(4100))).status,414);assert.equal((await fetch(g.origin+'/desktop',{headers:{Origin:'http://evil.invalid'}})).status,403);}finally{await g?.close();await rm(runtime,{recursive:true,force:true});}});
