<script>
 import { onMount } from 'svelte';
 import DesktopWindow from './DesktopWindow.svelte';
 import Icon from './Icon.svelte';
 import { clampBounds } from './geometry.js';
 let phase=$state('loading'), error=$state(''), apps=$state([]), windows=$state([]), csrf='';
 let now=$state(new Date()), quick=$state(false), busy=$state('');
 let areaWidth=$state(1200),areaHeight=$state(700),desktop,topZ=0;
 const pending=new Map(), timers=new Map();let writes=Promise.resolve();
 async function api(path,method='GET',body) {
  let response;
  try {response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch {throw new Error('Gateway unreachable. Your local desktop is still available.');}
  let data;try{data=await response.json();}catch{throw new Error('Gateway returned an unreadable response.');}
  if(response.status===401){phase='locked';windows=[];throw new Error('Session ended. Unlock your desktop from the local bootstrap URL.');}
  if(!response.ok)throw new Error(data.error||`Gateway error (${response.status})`);
  return data;
 }
 async function bootstrap(){phase='loading';error='';try{const session=await api('/session');csrf=session.csrf;apps=session.apps;windows=session.windows.map(w=>({...w,z:++topZ}));const focused=windows.find(w=>w.focused);if(focused)focused.z=++topZ;phase='ready';fitDesktop();}catch(e){if(phase!=='locked')phase='error';error=e.message;}}
 function local(id,patch){windows=windows.map(w=>w.id===id?{...w,...patch}:patch.focused?{...w,focused:false}:w);}
 function flush(id){clearTimeout(timers.get(id));const patch=pending.get(id);if(!patch)return writes;pending.delete(id);writes=writes.catch(()=>{}).then(()=>api('/windows/'+encodeURIComponent(id),'PATCH',patch)).catch(e=>{error=e.message;throw e;});return writes;}
 function change(id,patch,immediate=false){local(id,patch);pending.set(id,{...pending.get(id),...patch});clearTimeout(timers.get(id));if(immediate)return flush(id).catch(()=>{});timers.set(id,setTimeout(()=>flush(id).catch(()=>{}),180));}
 async function focus(id){const w=windows.find(w=>w.id===id);if(!w)return; if(w.focused&&w.visible)return writes.catch(()=>{});local(id,{z:++topZ});await change(id,{focused:true,visible:true},true);if(areaWidth<640)fitDesktop();}
 async function open(app){quick=false;error='';busy=app.id;try{const w=await api('/windows','POST',{appId:app.id});const next={...w,z:++topZ,focused:true,visible:true};if(windows.some(item=>item.id===w.id))windows=windows.map(item=>item.id===w.id?next:{...item,focused:false});else windows=[...windows.map(item=>({...item,focused:false})),next];fitDesktop();}catch(e){error=e.message;}finally{busy='';}}
 async function close(id){try{await flush(id);await api('/windows/'+encodeURIComponent(id),'DELETE');windows=windows.filter(w=>w.id!==id);}catch(e){error=e.message;}}
 async function reload(id){try{await api('/windows/'+encodeURIComponent(id)+'/reload','POST');const frame=document.querySelector(`[data-window-id="${CSS.escape(id)}"] iframe`);if(frame)frame.src=frame.src;}catch(e){error=e.message;}}
 function fitDesktop(){for(const w of windows){const b=areaWidth<640&&w.focused?{x:0,y:0,width:areaWidth-4,height:areaHeight-24}:clampBounds(w,areaWidth,areaHeight);const patch={...b,...(areaWidth<640&&!w.focused&&w.visible?{visible:false}:{})};if(Object.entries(patch).some(([key,value])=>w[key]!==value))change(w.id,patch);}}
 onMount(()=>{areaWidth=desktop.clientWidth;areaHeight=desktop.clientHeight;const observer=new ResizeObserver(([entry])=>{areaWidth=entry.contentRect.width;areaHeight=entry.contentRect.height;fitDesktop();});observer.observe(desktop);bootstrap();const interval=setInterval(()=>now=new Date(),1000);return()=>{observer.disconnect();clearInterval(interval);timers.forEach(clearTimeout);};});
</script>
<header class="topbar"><span class="path"><span aria-hidden="true">⌂</span> <span>~</span> / desktop</span><time datetime={now.toISOString()}>{now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}<span>{now.toLocaleTimeString('en-GB')}</span></time></header>
<main class="desktop" bind:this={desktop} aria-label="Personal desktop">
 {#if phase==='ready'}
  <nav class="shortcuts" aria-label="Desktop apps">{#each apps as app}<button class="shortcut" aria-label={'Open '+app.label} disabled={busy===app.id} onclick={()=>open(app)} title={app.description}><Icon name={app.id}/><span>{app.label}</span><small>{app.mode==='stream'?'streamed':'native'}</small></button>{/each}</nav>

  {#each windows as win,i (win.id)}<DesktopWindow {win} index={win.z??i} {areaWidth} {areaHeight} onchange={patch=>change(win.id,patch)} onfocus={()=>focus(win.id)} onminimize={()=>change(win.id,{visible:false,focused:false},true)} onclose={()=>close(win.id)} onreload={()=>reload(win.id)}/>{/each}
 {:else}
  <section class="system-panel" aria-live="polite"><div class="panel-heading">desktop / {phase==='locked'?'owner access':'connection'}</div><div class="panel-body"><div class="lock-symbol" aria-hidden="true">{phase==='locked'?'▧':'◌'}</div><h1>{phase==='locked'?'Desktop locked':phase==='loading'?'Connecting to your desktop…':'Gateway unavailable'}</h1>{#if phase==='locked'}<p>Open the one-time bootstrap URL on this machine to unlock your private desktop.</p><code>.runtime/bootstrap-url.txt</code><p class="muted">Keep that URL private. No apps or content are loaded while locked.</p>{:else if phase==='error'}<p>{error}</p>{:else}<p>Waiting for the local gateway.</p>{/if}{#if phase!=='loading'}<button class="text-button" onclick={bootstrap}>Try again</button>{/if}</div></section>
 {/if}
</main>
{#if error&&phase==='ready'}<aside class="error-toast" role="alert"><span>{error}</span><button onclick={()=>error=''} aria-label="Dismiss error">×</button></aside>{/if}
<footer><span class="maker">Made by Wicked Evil Incorporated</span>{#if phase==='ready'}<nav class="dock" aria-label="Open windows"><button class="nav-toggle" aria-label="Quick navigation" aria-expanded={quick} onclick={()=>quick=!quick}>⠿</button>{#each windows as win}<button class:active={win.focused&&win.visible} class:minimized={!win.visible} aria-label={'Restore '+win.title} onclick={()=>focus(win.id)}><span class="dock-indicator">{win.visible?'▪':'▫'}</span>{win.title}</button>{/each}</nav><span class="footer-note">{windows.filter(w=>w.visible).length} visible / {windows.length} open</span>{:else}<span class="footer-note">owner access required</span>{/if}</footer>
{#if quick}<section class="quick-nav" aria-label="Quick navigation"><div class="panel-heading">Quick Nav <button aria-label="Close quick navigation" onclick={()=>quick=false}>×</button></div><p>APPLICATIONS</p>{#each apps as app}<button onclick={()=>open(app)}><Icon name={app.id}/><span>{app.label}<small>{app.mode==='stream'?'streamed · synthetic lab':'native · local files'}</small></span><span>↗</span></button>{/each}</section>{/if}
