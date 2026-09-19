import './style.css';
import './appearance.css';
import { initAppearance } from './appearance.js';
import { createParcel } from './parcel.js';
import { createVortex } from './vortex.js';

const $=s=>document.querySelector(s);
const vortex=createVortex($('#orbit'));
initAppearance(vortex);
let files=[],busy=false,url=null;
let motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;
const bytes=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
function invalidate(){if(url){URL.revokeObjectURL(url);url=null;}$('#download').hidden=true;$('#download').removeAttribute('href');$('#reset').hidden=true;$('#seal').hidden=false;$('.chamber').classList.remove('complete');vortex.setState('idle');}
function render(){
  $('#count').textContent=`${String(files.length).padStart(2,'0')} FILES`;
  $('#file-list').replaceChildren();
  files.forEach((f,index)=>{
    const li=document.createElement('li');
    for(const [cls,text] of [['file-icon','↳'],['filename',f.name],['size',bytes(f.size)]]){const span=document.createElement('span');span.className=cls;span.textContent=text;li.append(span);}
    const remove=document.createElement('button');remove.className='remove';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${f.name}`);remove.disabled=busy;remove.onclick=()=>{files.splice(index,1);invalidate();render();};li.append(remove);$('#file-list').append(li);
  });
  $('#seal').disabled=busy||!files.length;$('#pick').disabled=busy;$('#note').disabled=busy;
  if(!busy)$('#status').textContent=files.length?`${files.length} ${files.length===1?'file':'files'} · ${bytes(files.reduce((s,f)=>s+f.size,0))} · ready for departure.`:'The universe has room for your files.';
}
function add(incoming){if(busy)return;invalidate();$('#error').textContent='';const next=[...files,...incoming];if(next.length>100||next.reduce((s,f)=>s+f.size,0)>100*1024*1024){$('#error').textContent='Keep this prototype below 100 files and 100 MB.';return;}files=next;render();}
$('#pick').onclick=()=>$('#files').click();
$('#files').onchange=e=>{add(Array.from(e.target.files));e.target.value='';};
$('#pick').ondragover=e=>{e.preventDefault();$('#pick').classList.add('dragging');};
$('#pick').ondragleave=()=>$('#pick').classList.remove('dragging');
$('#pick').ondrop=e=>{e.preventDefault();$('#pick').classList.remove('dragging');const items=Array.from(e.dataTransfer.items);if(items.some(i=>i.webkitGetAsEntry?.()?.isDirectory)){$('#error').textContent='Folders are not supported yet. Choose individual files.';return;}add(Array.from(e.dataTransfer.files));};
$('#note').oninput=()=>{invalidate();render();};
function updateMotion(){vortex.setMotion(motion);$('#motion').textContent=motion?'Motion on':'Motion off';$('#motion').setAttribute('aria-pressed',String(motion));}
$('#motion').onclick=()=>{motion=!motion;updateMotion();};updateMotion();
$('#seal').onclick=async()=>{
  if(busy||!files.length)return;
  invalidate();busy=true;render();$('#error').textContent='';$('#status').textContent='Packing your files on this device…';vortex.setState('packing');
  const started=performance.now();
  try{
    const data=await createParcel(files,$('#note').value);
    if(motion){$('#status').textContent='Sealing · ZIP ready, finishing the wrapping…';await new Promise(r=>setTimeout(r,Math.max(0,2200-(performance.now()-started))));}
    url=URL.createObjectURL(new Blob([data],{type:'application/zip'}));
    $('#download').href=url;$('#download').hidden=false;$('#seal').hidden=true;$('#reset').hidden=false;$('.chamber').classList.add('complete');vortex.setState('done');
    $('#status').textContent=`All wrapped up. ${bytes(data.length)} · ready to download.`;
  }catch(error){$('#error').textContent=error.message||'Could not create the ZIP. Try fewer or smaller files.';vortex.setState('idle');$('#status').textContent='Nothing sent. Your originals are unchanged.';}
  finally{busy=false;$('#pick').disabled=false;$('#note').disabled=false;$('#seal').disabled=!files.length;document.querySelectorAll('.remove').forEach(b=>b.disabled=false);}
};
$('#reset').onclick=()=>{invalidate();files=[];$('#note').value='';$('#error').textContent='';render();};
window.addEventListener('beforeunload',()=>{if(url)URL.revokeObjectURL(url);});
render();
