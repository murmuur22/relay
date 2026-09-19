import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {Desktop} from '../../server/desktop.mjs';
import {authenticate,client} from '../auth-helper.mjs';

test('removed app history cannot fill and brick a personal desktop',{timeout:15000},async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-desktop-capacity-');const g=await createGateway({port:0,runtime});
 try{
  const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);await api('/desktop');await api('/admin/apps/notes-lab','PATCH',{enabled:false});
  const store=new Desktop(runtime),state={version:1,revision:1,items:[]};
  for(let i=0;i<128;i++)state.items.push(store.make(state,'folder',null,i,'Folder '+i));
  for(let i=0;i<128;i++)state.items.push(store.make(state,'app',null,128+i,null,i===127?'notes-lab':'retired-'+i));
  store.validate(state);const file=runtime+'/users/'+auth.s.user.id+'/desktop.json';await writeFile(file,JSON.stringify(state));
  const response=await api('/desktop');assert.equal(response.status,200);const visible=await response.json();assert.equal(visible.items.some(i=>i.appId==='notes-lab'),false);
  const disk=JSON.parse(await readFile(file,'utf8'));assert.equal(disk.items.some(i=>i.appId?.startsWith('retired-')),false);assert.equal(disk.items.some(i=>i.appId==='notes-lab'),true,'Disabled app personalization must survive');
  assert.equal((await api('/desktop/items/'+state.items[0].id,'DELETE')).status,200);
 }finally{await g.close();await rm(runtime,{recursive:true,force:true});}
});
