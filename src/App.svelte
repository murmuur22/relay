<script>
 import { onMount } from 'svelte';
 import DesktopWindow from './DesktopWindow.svelte';
 import Icon from './Icon.svelte';
 import Login from './Login.svelte';
 import Settings from './Settings.svelte';
 import {safeExternal,checkDevice,statusLabel,statusDetail} from './webapps.js';
 import { clampBounds } from './geometry.js';
 let phase=$state('loading'), error=$state(''), apps=$state([]), windows=$state([]), csrf='';
 let now=$state(new Date()), quick=$state(false), busy=$state('');
 let user=$state(null),settings=$state(''),health=$state({}),deviceHealth=$state({});
 let showStatus=$derived(user?.preferences?.showAppStatus!==false);
 let checking=false;
 function observation(app){const d=deviceHealth[app.id];return d?.address===app.url&&d?.state==='Online'&&Date.now()-d.checkedAt<30000?d:health[app.id];}
 async function deviceChecks(){if(checking||!showStatus)return;checking=true;try{for(const app of apps.filter(a=>a.kind==='web'&&a.mode==='native'&&a.url)){if(!showStatus||phase!=='ready')break;if(deviceHealth[app.id]?.address===app.url&&Date.now()-deviceHealth[app.id].checkedAt<30000)continue;const result=await checkDevice(app.url);if(showStatus&&phase==='ready')deviceHealth={...deviceHealth,[app.id]:{...result,address:app.url}};}}finally{checking=false;}}
 function lock(message='Session expired. Sign in again.'){phase='locked';windows=[];apps=[];user=null;settings='';quick=false;error=message;timers.forEach(clearTimeout);pending.clear();csrf='';}
 async function refresh(){const s=await api('/session');user=s.user;apps=s.apps;windows=windows.filter(w=>apps.some(a=>a.id===w.appId)&&s.windows.some(saved=>saved.id===w.id));}
 async function status(){if(phase!=='ready')return;try{await refresh();if(showStatus){health=await api('/status');void deviceChecks();}}catch(e){error=e.message;}}
 async function logout(){try{await api('/logout','POST');lock('Signed out.');}catch(e){error=e.message;}}
 let areaWidth=$state(1200),areaHeight=$state(700),desktop,topZ=0;
 const pending=new Map(), timers=new Map();let writes=Promise.resolve();
 async function api(path,method='GET',body,options={}) {
  let response;
  try {response=await fetch('/api'+path,{method,signal:options.signal,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch(e) {if(e.name==='AbortError')throw e;throw new Error('Gateway unreachable. Your local desktop is still available.');}
  let data;try{data=await response.json();}catch{throw new Error('Gateway returned an unreadable response.');}
  if(response.status===401&&path!=='/profile'){lock();throw new Error('Session expired. Sign in again.');}
  if(!response.ok)throw new Error(data.error||`Gateway error (${response.status})`);
  return data;
 }
 async function bootstrap(){phase='loading';error='';try{const session=await api('/session');csrf=session.csrf;user=session.user;apps=session.apps;windows=session.windows.map(w=>({...w,z:++topZ}));const focused=windows.find(w=>w.focused);if(focused)focused.z=++topZ;phase='ready';if(user?.mustChange)settings='profile';fitDesktop();await status();}catch(e){if(phase!=='locked')phase='error';error=e.message;}}
 function local(id,patch){windows=windows.map(w=>w.id===id?{...w,...patch}:patch.focused?{...w,focused:false}:w);}
 function flush(id){clearTimeout(timers.get(id));const patch=pending.get(id);if(!patch)return writes;pending.delete(id);writes=writes.catch(()=>{}).then(()=>api('/windows/'+encodeURIComponent(id),'PATCH',patch)).catch(e=>{error=e.message;throw e;});return writes;}
 function change(id,patch,immediate=false){local(id,patch);pending.set(id,{...pending.get(id),...patch});clearTimeout(timers.get(id));if(immediate)return flush(id).catch(()=>{});timers.set(id,setTimeout(()=>flush(id).catch(()=>{}),180));}
 async function focus(id){const w=windows.find(w=>w.id===id);if(!w)return; if(w.focused&&w.visible)return writes.catch(()=>{});local(id,{z:++topZ});await change(id,{focused:true,visible:true},true);if(areaWidth<640)fitDesktop();}
 async function open(app){quick=false;error='';if(app.kind==='web'&&app.mode==='native'&&app.openMode==='tab'){const url=safeExternal(app.url,window.location.origin);if(url)window.open(url,'_blank','noopener,noreferrer');else error='Native app address is invalid or shares Relay’s authentication hostname.';return;}busy=app.id;try{const w=await api('/windows','POST',{appId:app.id});const next={...w,z:++topZ,focused:true,visible:true};if(windows.some(item=>item.id===w.id))windows=windows.map(item=>item.id===w.id?next:{...item,focused:false});else windows=[...windows.map(item=>({...item,focused:false})),next];fitDesktop();}catch(e){error=e.message;}finally{busy='';}}
 async function close(id){try{await flush(id);await api('/windows/'+encodeURIComponent(id),'DELETE');windows=windows.filter(w=>w.id!==id);}catch(e){error=e.message;}}
 async function reload(id){try{await api('/windows/'+encodeURIComponent(id)+'/reload','POST');const frame=document.querySelector(`[data-window-id="${CSS.escape(id)}"] iframe`);if(frame)frame.src=frame.src;}catch(e){error=e.message;}}
 function fitDesktop(){for(const w of windows){const b=areaWidth<640&&w.focused?{x:0,y:0,width:areaWidth-4,height:areaHeight-24}:clampBounds(w,areaWidth,areaHeight);const patch={...b,...(areaWidth<640&&!w.focused&&w.visible?{visible:false}:{})};if(Object.entries(patch).some(([key,value])=>w[key]!==value))change(w.id,patch);}}
 onMount(()=>{areaWidth=desktop.clientWidth;areaHeight=desktop.clientHeight;const observer=new ResizeObserver(([entry])=>{areaWidth=entry.contentRect.width;areaHeight=entry.contentRect.height;fitDesktop();});observer.observe(desktop);bootstrap();const interval=setInterval(()=>now=new Date(),1000),poll=setInterval(status,5000);return()=>{observer.disconnect();clearInterval(interval);clearInterval(poll);timers.forEach(clearTimeout);};});
</script>
<header class="topbar"><span class="path"><span aria-hidden="true">⌂</span> <span>~</span> / desktop</span><time datetime={now.toISOString()}>{now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}<span>{now.toLocaleTimeString('en-GB')}</span></time></header>
<main class="desktop" bind:this={desktop} aria-label="Personal desktop">
 {#if phase==='ready'}
  <nav class="shortcuts" aria-label="Desktop apps">{#each apps as app}<button class="shortcut" aria-label={'Open '+app.label} aria-describedby={showStatus?'health-'+app.id:undefined} disabled={busy===app.id} onclick={()=>open(app)} title={showStatus?statusDetail(observation(app)):app.description}><Icon name={app.icon||app.template||app.id}/><span>{app.label}</span><small>{app.mode==='stream'?'streamed':app.openMode==='tab'?'native · new tab':'native'}</small>{#if showStatus}<small id={'health-'+app.id} class="health"><i class:online={observation(app)?.state==='Online'} class:offline={observation(app)?.state==='Offline'}></i>{statusLabel(observation(app))}<span class="health-detail">{statusDetail(observation(app))}</span></small>{/if}</button>{/each}</nav>

  {#each windows as win,i (win.id)}<DesktopWindow {win} index={win.z??i} {areaWidth} {areaHeight} onchange={patch=>change(win.id,patch)} onfocus={()=>focus(win.id)} onminimize={()=>change(win.id,{visible:false,focused:false},true)} onclose={()=>close(win.id)} onreload={()=>reload(win.id)}/>{/each}
 {:else if phase==='locked'}
  <Login onlogin={bootstrap}/>{#if error}<p class="login-message" role="status">{error}</p>{/if}
 {:else}
  <section class="system-panel" aria-live="polite"><div class="panel-heading">desktop / connection</div><div class="panel-body"><div class="lock-symbol" aria-hidden="true">◌</div><h1>{phase==='loading'?'Connecting to your desktop…':'Gateway unavailable'}</h1>{#if phase==='error'}<p>{error}</p><button class="text-button" onclick={bootstrap}>Try again</button>{:else}<p>Waiting for the local gateway.</p>{/if}</div></section>
 {/if}
</main>
{#if error&&phase==='ready'}<aside class="error-toast" role="alert"><span>{error}</span><button onclick={()=>error=''} aria-label="Dismiss error">×</button></aside>{/if}
<footer><span class="maker">Made by Wicked Evil Incorporated</span>{#if phase==='ready'}<nav class="dock" aria-label="Open windows"><button class="nav-toggle" aria-label="Navigation" aria-expanded={quick} onclick={()=>quick=!quick}>⠿</button>{#each windows as win}<button class:active={win.focused&&win.visible} class:minimized={!win.visible} aria-label={'Restore '+win.title} onclick={()=>focus(win.id)}><span class="dock-indicator">{win.visible?'▪':'▫'}</span>{win.title}</button>{/each}</nav><span class="footer-note">{windows.filter(w=>w.visible).length} visible / {windows.length} open</span>{:else}<span class="footer-note">account access required</span>{/if}</footer>
{#if quick}<section class="quick-nav" aria-label="Navigation"><div class="panel-heading">Navigation <button aria-label="Close navigation" onclick={()=>quick=false}>×</button></div><p><span>{user?.displayName}</span> <small> / {user?.role}</small></p><p>APPS</p>{#each apps as app}<button onclick={()=>open(app)}><Icon name={app.icon||app.template||app.id}/><span>{app.label}<small>{app.kind==='web'?(app.mode==='stream'?'streamed · isolated browser':'native · '+(app.openMode==='tab'?'new tab':'desktop window')):(app.mode==='stream'?'streamed · synthetic lab':'native · built in')}</small></span><span>↗</span></button>{/each}<hr/><button onclick={()=>{settings='profile';quick=false;}}>Profile settings</button>{#if user?.role==='admin'&&!user?.mustChange}<button onclick={()=>{settings='admin';quick=false;}}>Control Panel</button>{/if}<button onclick={logout}>Sign out</button></section>{/if}
{#if phase==='ready'&&settings}<Settings kind={settings} {user} {api} onclose={()=>settings=''} onrefresh={refresh} onpassword={()=>lock('Password changed. Sign in again.')}/>{/if}
