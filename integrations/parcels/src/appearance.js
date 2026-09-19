export const DEFAULTS={mode:'dark',accent:'#c8e6a0'};
export function normalizeHex(input){
  if(typeof input!=='string')return null;
  let hex=input.trim().replace(/^#/,'');
  if(/^[0-9a-f]{3}$/i.test(hex))hex=[...hex].map(c=>c+c).join('');
  return /^[0-9a-f]{6}$/i.test(hex)?'#'+hex.toLowerCase():null;
}
function rgb(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
function luminance(hex){const c=rgb(hex).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
export function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function paletteFor(accent,mode){
  const background=mode==='light'?'#f3f0e8':'#141513';
  const onAccent=contrast(accent,'#000000')>=contrast(accent,'#ffffff')?'#000000':'#ffffff';
  let readable=accent;
  const original=rgb(accent),target=mode==='light'?0:255;
  const surface=mode==='light'?'#eae7df':'#1a1c18';
  for(let step=1;Math.min(contrast(readable,background),contrast(readable,surface))<4.5&&step<=100;step++){
    readable='#'+original.map(v=>Math.round(v+(target-v)*step/100).toString(16).padStart(2,'0')).join('');
  }
  return {background,onAccent,readable};
}

export function initAppearance(vortex){
  const root=document.documentElement,dialog=document.querySelector('#settings-panel');
  const input=document.querySelector('#hex'),picker=document.querySelector('#color-picker'),error=document.querySelector('#color-error');
  let settings={...DEFAULTS};
  try{const saved=JSON.parse(localStorage.getItem('parcels.appearance'));if(saved&&typeof saved==='object'){settings.mode=saved.mode==='light'?'light':'dark';settings.accent=normalizeHex(saved.accent)||DEFAULTS.accent;}}catch{/* Storage unavailable or invalid: use defaults. */}
  function apply(save=true){
    const palette=paletteFor(settings.accent,settings.mode);
    root.dataset.theme=settings.mode;root.dataset.accent=settings.accent;
    root.style.setProperty('--accent',settings.accent);root.style.setProperty('--acid',palette.readable);root.style.setProperty('--on-accent',palette.onAccent);
    input.value=settings.accent;picker.value=settings.accent;error.textContent='';
    document.querySelectorAll('[name="theme"]').forEach(r=>r.checked=r.value===settings.mode);
    document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===settings.accent)));
    vortex.setTheme(palette.readable,settings.mode);
    if(save){try{localStorage.setItem('parcels.appearance',JSON.stringify(settings));}catch{error.textContent='Applied for this visit. Your browser could not save preferences.';}}
  }
  document.querySelector('#settings').onclick=()=>dialog.showModal();
  document.querySelector('#close-settings').onclick=()=>dialog.close();
  document.querySelector('#appearance-form').onsubmit=e=>{e.preventDefault();const hex=normalizeHex(input.value);if(!hex){error.textContent='Enter a 3- or 6-digit hex color, such as #7438cf.';input.focus();return;}settings.accent=hex;apply();};
  document.querySelectorAll('[name="theme"]').forEach(r=>r.onchange=()=>{settings.mode=r.value;apply();});
  document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{settings.accent=b.dataset.preset;apply();});
  picker.oninput=()=>{settings.accent=picker.value;apply();};
  document.querySelector('#reset-appearance').onclick=()=>{settings={...DEFAULTS};apply();};
  apply(false);
}
