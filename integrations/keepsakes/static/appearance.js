export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map(c=>c+c).join('');
  return /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : null;
}
function rgb(hex) { return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)); }
function luminance(hex) { const c=rgb(hex).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722; }
export function contrast(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
export function palette(accent,mode) {
 const surfaces=mode==='light'?['#f3f0e8','#eae7df']:['#141513','#1a1c18'];
 const original=rgb(accent),target=mode==='light'?0:255;
 let readable=accent;
 for(let step=1; Math.min(...surfaces.map(s=>contrast(readable,s)))<4.5 && step<=100;step++)
   readable='#'+original.map(v=>Math.round(v+(target-v)*step/100).toString(16).padStart(2,'0')).join('');
 return {readable,onAccent:contrast(accent,'#000000')>=contrast(accent,'#ffffff')?'#000000':'#ffffff'};
}
export function initAppearance() {
 const $=s=>document.querySelector(s), root=document.documentElement;
 let settings={mode:'dark',accent:'#c8e6a0'};
 try {const saved=JSON.parse(localStorage.getItem('keepsakes.appearance'));if(saved){settings.mode=saved.mode==='light'?'light':'dark';settings.accent=normalizeHex(saved.accent)||settings.accent;}}catch{}
 function apply(save=true) {
  const colors=palette(settings.accent,settings.mode);
  root.dataset.theme=settings.mode;root.dataset.accent=settings.accent;
  // Only validated hex values become individual custom properties, never CSS text.
  root.style.setProperty('--accent',settings.accent);root.style.setProperty('--on-accent',colors.onAccent);root.style.setProperty('--readable',colors.readable);
  $('#hex').value=settings.accent;$('#color-error').textContent='';
  document.querySelectorAll('[name=theme]').forEach(r=>r.checked=r.value===settings.mode);
  document.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===settings.accent)));
  if(save) try {localStorage.setItem('keepsakes.appearance',JSON.stringify(settings));}catch{$('#color-error').textContent='Applied for this visit. Browser storage is unavailable.';}
 }
 $('#appearance-open').onclick=()=>$('#appearance').showModal();
 document.querySelectorAll('[name=theme]').forEach(r=>r.onchange=()=>{settings.mode=r.value;apply();});
 document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{settings.accent=b.dataset.color;apply();});
 $('#color-form').onsubmit=e=>{e.preventDefault();const color=normalizeHex($('#hex').value);if(!color){$('#color-error').textContent='Enter a 3- or 6-digit hex color.';return;}settings.accent=color;apply();};
 apply(false);
}
