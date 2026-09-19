// Names are decoration. Only exact, owner-scoped stable keys resolve identity.
export const CELL_WIDTH=112,CELL_HEIGHT=130,GRID_LEFT=18,GRID_TOP=24;
export function itemToken(item){return (item.label.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80).replace(/-+$/,'')||'item')+'--'+item.key;}
export function ancestry(items,id){const result=[],seen=new Set();while(id){const item=items.find(i=>i.id===id&&i.kind==='folder');if(!item||seen.has(id))return null;seen.add(id);result.unshift(item);id=item.parentId;}return result;}
export function folderPath(items,id){const chain=ancestry(items,id);return '/desktop'+(chain?.length?'/'+chain.map(itemToken).join('/'):'');}
export function resolveDesktop(items,pathname,search){
 const fail={unavailable:true,folderId:null,app:null,maximized:false,url:'/desktop'};
 if(pathname.length+search.length>4096)return fail;
 const segments=pathname.split('/').filter(Boolean);if(pathname!=='/'&&segments.shift()!=='desktop')return fail;
 if(segments.length>128)return fail;
 const lookup=(token,kind)=>{const match=/^[a-z0-9]+(?:-[a-z0-9]+)*--([a-f0-9]{8})$/.exec(token);return match&&items.find(i=>i.key===match[1]&&i.kind===kind);};
 let folder=null;for(const segment of segments){folder=lookup(segment,'folder');if(!folder)return fail;}
 const params=new URLSearchParams(search);let app=null;if(params.has('app')){if(params.getAll('app').length!==1)return fail;app=lookup(params.get('app'),'app');if(!app)return fail;}
 const folderId=folder?.id??null,maximized=!!app&&params.get('view')==='maximized';
 const url=folderPath(items,folderId)+(app?'?app='+itemToken(app)+(maximized?'&view=maximized':''):'');
 return {folderId,app,maximized,url,unavailable:false};
}
export function slotPosition(slot,rows){return {x:GRID_LEFT+Math.floor(slot/rows)*CELL_WIDTH,y:GRID_TOP+(slot%rows)*CELL_HEIGHT};}
export function slotAt(x,y,rows){return Math.min(1023,Math.max(0,Math.round((x-GRID_LEFT)/CELL_WIDTH))*rows+Math.max(0,Math.min(rows-1,Math.round((y-GRID_TOP)/CELL_HEIGHT))));}
