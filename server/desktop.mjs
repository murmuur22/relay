import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,mkdir,chmod,readdir,rm,stat} from 'node:fs/promises';
import {fail} from './accounts.mjs';
export const iconChoices=['parcels','keepsakes','notes-lab','signal-lab','globe','folder','notes','media','terminal','archive','code','games','music','photo','home','star','tools'];
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const label=v=>typeof v==='string'&&v.trim().length>0&&v.length<=64&&!/[\x00-\x1f\x7f]/.test(v);
const slot=v=>Number.isInteger(v)&&v>=0&&v<=1023;
const builtin=v=>object(v)&&Object.keys(v).length===2&&v.type==='builtin'&&iconChoices.includes(v.name);
const icon=v=>v===null||builtin(v)||(object(v)&&Object.keys(v).length===2&&v.type==='upload'&&/^[a-f0-9]{32}$/.test(v.id));
const first=(items,parentId,exclude)=>{const used=new Set(items.filter(i=>i.parentId===parentId&&i!==exclude).map(i=>i.slot));for(let n=0;n<=1023;n++)if(!used.has(n))return n;throw fail(400,'Folder full');};
export class Desktop{
 constructor(runtime,registry=null){this.runtime=runtime;this.registry=registry;this.queues=new Map();}
 dir(owner){if(!/^[a-f0-9-]{36}$/.test(owner))throw Error('Invalid owner');return this.runtime+'/users/'+owner;}
 validate(s){
  if(!object(s)||s.version!==1||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.items)||s.items.length>256||s.items.filter(i=>i.kind==='folder').length>128)throw Error();
  const ids=new Set(),keys=new Set(),apps=new Set(),slots=new Set();
  for(const i of s.items){if(!object(i)||Object.keys(i).some(k=>!['id','key','kind','parentId','slot','labelOverride','iconOverride',...(i.kind==='app'?['appId']:[])].includes(k))||!/^item-[a-f0-9-]{36}$/.test(i.id)||!/^[a-f0-9]{8}$/.test(i.key)||ids.has(i.id)||keys.has(i.key)||!['app','folder'].includes(i.kind)||!slot(i.slot)||!icon(i.iconOverride)||(i.labelOverride!==null&&!label(i.labelOverride))||(i.kind==='folder'&&!label(i.labelOverride))||(i.kind==='app'&&(typeof i.appId!=='string'||apps.has(i.appId))))throw Error();ids.add(i.id);keys.add(i.key);if(i.kind==='app')apps.add(i.appId);const position=JSON.stringify([i.parentId,i.slot]);if(slots.has(position))throw Error();slots.add(position);}
  for(const i of s.items){let p=i;const seen=new Set([i.id]);while(p.parentId!==null){p=s.items.find(x=>x.id===p.parentId&&x.kind==='folder');if(!p||seen.has(p.id))throw Error();seen.add(p.id);}}
 }
 async load(owner){try{const s=JSON.parse(await readFile(this.dir(owner)+'/desktop.json','utf8'));this.validate(s);return s;}catch(e){if(e.code==='ENOENT')return {version:1,revision:0,items:[]};throw fail(500,'Desktop state unreadable; refusing reset');}}
 make(s,kind,parentId,position,labelOverride=null,appId){let key;do{key=randomBytes(4).toString('hex');}while(s.items.some(i=>i.key===key));return {id:'item-'+randomUUID(),key,kind,parentId,slot:position,labelOverride,iconOverride:null,...(appId?{appId}:{})};}
 parent(s,id){if(id!==null&&!s.items.some(i=>i.id===id&&i.kind==='folder'))throw fail(404,'Item unavailable');}
 item(s,id,apps){const i=s.items.find(i=>i.id===id);if(!i||(i.kind==='app'&&!apps.some(a=>a.id===i.appId)))throw fail(404,'Item unavailable');return i;}
 public(owner,s,apps){return {ownerId:owner,revision:s.revision,iconChoices,items:s.items.filter(i=>i.kind==='folder'||apps.some(a=>a.id===i.appId)).map(i=>{const a=apps.find(a=>a.id===i.appId);const visibleIcon=v=>v?.type==='upload'?{...v,url:'/api/desktop/icons/'+v.id}:v;return {...i,label:i.labelOverride??a.label,icon:visibleIcon(i.iconOverride)??{type:'builtin',name:i.kind==='folder'?'folder':iconChoices.includes(a.icon)?a.icon:iconChoices.includes(a.template)?a.template:'globe'},iconOverride:visibleIcon(i.iconOverride)};})};}
 run(owner,authority,edit){const job=(this.queues.get(owner)||Promise.resolve()).catch(()=>{}).then(async()=>{
  authority();const s=await this.load(owner);let apps=authority();const before=JSON.stringify(s);
  // Permanently removed apps have no future grant to restore. Preserve merely
  // disabled/revoked entries, but reclaim deleted history before admitting new apps.
  if(this.registry){const known=new Set(this.registry().map(a=>a.id));s.items=s.items.filter(i=>i.kind==='folder'||known.has(i.appId));}
  for(const a of apps)if(!s.items.some(i=>i.appId===a.id)){if(s.items.length>=256)throw fail(400,'Desktop full');s.items.push(this.make(s,'app',null,first(s.items,null),null,a.id));}
  const extra=edit?await edit(s,apps):{};apps=authority();this.validate(s);
  if(JSON.stringify(s)!==before){s.revision++;const dir=this.dir(owner);await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);await writeFile(dir+'/desktop.tmp',JSON.stringify(s),{mode:0o600});await chmod(dir+'/desktop.tmp',0o600);authority();await rename(dir+'/desktop.tmp',dir+'/desktop.json');}
  await this.clean(owner,s);
  return {...this.public(owner,s,authority()),...extra};
 });this.queues.set(owner,job);return job;}
 async clean(owner,s){const dir=this.dir(owner)+'/icons';let files;try{files=await readdir(dir);}catch(e){if(e.code==='ENOENT')return;throw e;}const used=new Set(s.items.filter(i=>i.iconOverride?.type==='upload').map(i=>i.iconOverride.id+'.png'));for(const f of files)if(/^[a-f0-9]{32}\.png$/.test(f)&&!used.has(f))await rm(dir+'/'+f,{force:true});}
 async upload(owner,s,apps,id,bytes){const item=this.item(s,id,apps),dir=this.dir(owner)+'/icons';await this.clean(owner,s);const retained=s.items.filter(i=>i!==item&&i.iconOverride?.type==='upload');if(retained.length>=128)throw fail(400,'Icon quota reached');let total=bytes.length;for(const i of retained)total+=(await stat(dir+'/'+i.iconOverride.id+'.png')).size;if(total>8*1024*1024)throw fail(400,'Icon quota reached');await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);const asset=randomBytes(16).toString('hex');await writeFile(dir+'/'+asset+'.png',bytes,{mode:0o600,flag:'wx'});item.iconOverride={type:'upload',id:asset};return {};}
 async readIcon(owner,authority,id){if(!/^[a-f0-9]{32}$/.test(id))throw fail(404,'Icon unavailable');const d=await this.run(owner,authority);if(!d.items.some(i=>i.icon.type==='upload'&&i.icon.id===id))throw fail(404,'Icon unavailable');let bytes;try{bytes=await readFile(this.dir(owner)+'/icons/'+id+'.png');}catch{throw fail(404,'Icon unavailable');}const apps=authority();if(!d.items.some(i=>i.icon.type==='upload'&&i.icon.id===id&&(i.kind==='folder'||apps.some(a=>a.id===i.appId))))throw fail(404,'Icon unavailable');return bytes;}
 folder(s,body){if(!object(body)||Object.keys(body).some(k=>!['parentId','label','slot'].includes(k))||!label(body.label)||!('parentId'in body)||('slot'in body&&!slot(body.slot)))throw fail(400,'Invalid folder');if(s.items.length>=256||s.items.filter(i=>i.kind==='folder').length>=128)throw fail(400,'Desktop full');this.parent(s,body.parentId);const i=this.make(s,'folder',body.parentId,first(s.items,body.parentId),body.label.trim());s.items.push(i);if('slot'in body)this.move(s,i,body.parentId,body.slot);return {itemId:i.id};}
 move(s,i,parentId,position){this.parent(s,parentId);let p=parentId;while(p!==null){if(p===i.id)throw fail(400,'Folder cycle');p=s.items.find(x=>x.id===p).parentId;}const oldParent=i.parentId,oldSlot=i.slot;const collision=s.items.find(x=>x!==i&&x.parentId===parentId&&x.slot===position);if(collision)collision.slot=oldParent===parentId?oldSlot:first(s.items,parentId,i);i.parentId=parentId;i.slot=position;}
 patch(s,apps,id,body){if(!object(body)||!Object.keys(body).length||Object.keys(body).some(k=>!['label','icon','parentId','slot'].includes(k)))throw fail(400,'Invalid item fields');const i=this.item(s,id,apps);
  if('label'in body){if(!(body.label===null&&i.kind==='app')&&!label(body.label))throw fail(400,'Invalid label');i.labelOverride=body.label===null?null:body.label.trim();}
  if('icon'in body){if(body.icon!==null&&!builtin(body.icon))throw fail(400,'Invalid icon');i.iconOverride=body.icon;}
  if('slot'in body&&!slot(body.slot))throw fail(400,'Invalid slot');if('parentId'in body||'slot'in body){const parent='parentId'in body?body.parentId:i.parentId;this.move(s,i,parent,'slot'in body?body.slot:parent===i.parentId?i.slot:first(s.items,parent,i));}return {};
 }
 remove(s,apps,id){const i=this.item(s,id,apps);if(i.kind!=='folder')throw fail(400,'Only folders can be removed');s.items=s.items.filter(x=>x!==i);for(const child of s.items.filter(x=>x.parentId===id)){child.parentId=i.parentId;child.slot=first(s.items,i.parentId,child);}return {};}
}
