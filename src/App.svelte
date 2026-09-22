<script>
 import {VERSION} from '../version.js';

 import { onMount } from 'svelte';
 import DesktopWindow from './DesktopWindow.svelte';
 import PersonalDesktop from './PersonalDesktop.svelte';
 import {resolveDesktop,folderPath,itemToken,ancestry} from './desktop.js';
 let personal=$state({items:[],iconChoices:[]}),route=$state({folderId:null,unavailable:false,app:null,maximized:false}),personalView=$state(),tabLanding=$state(null);
 let epoch=0,navigation=0;
 let crumbs=$derived(route.unavailable?[]:ancestry(personal.items,route.folderId)||[]);
 function titleFor(win){return personal.items.find(i=>i.appId===win.appId)?.label||win.title;}
 function acceptDesktop(data){if(data.ownerId!==user?.id)throw new Error('Desktop response belongs to an expired session.');if(personal.ownerId===data.ownerId&&data.revision<personal.revision)return;personal=data;}
 async function loadDesktop(){acceptDesktop(await api('/desktop'));}
 function canonicalize(){route=resolveDesktop(personal.items,location.pathname,location.search);if(!route.unavailable&&location.pathname+location.search!==route.url)history.replaceState(null,'',route.url);}
 async function mutateDesktop(path,method,body){const data=await api(path,method,body);acceptDesktop(data);canonicalize();}
 async function uploadIcon(id,file){const data=await api('/desktop/items/'+id+'/icon','POST',file,{raw:true});acceptDesktop(data);canonicalize();}
 function updateURL(appId,maximized=false,replace=false){const item=personal.items.find(i=>i.appId===appId);if(!item)return;const url=folderPath(personal.items,route.folderId)+'?app='+itemToken(item)+(maximized?'&view=maximized':'');if(location.pathname+location.search!==url){navigation++;history[replace?'replaceState':'pushState'](null,'',url);}route=resolveDesktop(personal.items,location.pathname,location.search);}
 async function navigate(url,replace=false){history[replace?'replaceState':'pushState'](null,'',url);await reconcileRoute();}
 function follow(e,url){if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();void navigate(url);}
 async function openItem(item){if(!item||item.kind==='folder'){await navigate(folderPath(personal.items,item?.id));return;}const app=apps.find(a=>a.id===item.appId);if(app)await open(app);}
 async function setMaximized(id,value,push=true){const w=windows.find(w=>w.id===id);if(!w)return;if(push)updateURL(w.appId,value);if(w.maximized!==value){const bounds={x:w.x,y:w.y,width:w.width,height:w.height};if(push)local(id,{z:++topZ});await change(id,{...(push?{focused:true,visible:true}:{}),...(value?{maximized:true,restoreBounds:bounds,x:0,y:0,width:areaWidth-4,height:areaHeight-24}:{maximized:false,...clampBounds(w.restoreBounds||bounds,areaWidth,areaHeight)})},true);}}
 async function reconcileRoute(){const n=++navigation,e=epoch;if(phase!=='ready')return;canonicalize();tabLanding=null;if(route.unavailable)return;const desired=route;
  for(const w of windows.filter(w=>w.maximized&&(!desired.app||w.appId!==desired.app.appId))){if(n!==navigation||e!==epoch)return;await setMaximized(w.id,false,false);if(n!==navigation||e!==epoch)return;}
  if(n!==navigation||e!==epoch||!desired.app)return;
  const app=apps.find(a=>a.id===desired.app.appId);if(!app){route={...route,unavailable:true};return;}
  if(app.kind==='web'&&app.mode==='native'&&app.openMode==='tab'){tabLanding=app;if(desired.maximized){history.replaceState(null,'',folderPath(personal.items,route.folderId)+'?app='+itemToken(desired.app));canonicalize();}return;}
  let w=windows.find(w=>w.appId===app.id);if(!w){await open(app,false);w=windows.find(w=>w.appId===app.id);}if(n!==navigation||e!==epoch||!w)return;await focus(w.id,false);if(n!==navigation||e!==epoch)return;await setMaximized(w.id,desired.maximized,false);
 }
 import Icon from './Icon.svelte';
 import Login from './Login.svelte';
 import Settings from './Settings.svelte';
 import SignalIntro from './SignalIntro.svelte';
 let introVisible=$state(false);
 import Onboarding from './Onboarding.svelte';
 import {reveal} from './motion.js';
 let setupCredential=location.hash.slice(1);
 if(location.hash)history.replaceState(null,'',location.pathname+location.search);
 function takeSetupCredential(){const value=setupCredential;setupCredential='';return value;}
 let reduced=$state(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 function devicePreferences(){const value={introAnimation:true,interfaceAnimations:true};try{const stored=JSON.parse(localStorage.getItem('relay.motion'));for(const key of Object.keys(value))if(typeof stored?.[key]==='boolean')value[key]=stored[key];}catch{}return value;}
 let device=$state(devicePreferences());
 let motion=$derived(!reduced&&(user?.preferences?.interfaceAnimations??device.interfaceAnimations));
 let intro=$derived(!reduced&&(user?.preferences?.introAnimation??device.introAnimation));
 $effect(()=>{if(user?.preferences){const {introAnimation=true,interfaceAnimations=true}=user.preferences;const value={introAnimation,interfaceAnimations};device=value;try{localStorage.setItem('relay.motion',JSON.stringify(value));}catch{}}});
 onMount(()=>{const query=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>reduced=query.matches;query.addEventListener('change',update);return()=>query.removeEventListener('change',update);});
 import {safeExternal,checkDevice,statusLabel,statusDetail} from './webapps.js';
 import { clampBounds } from './geometry.js';
 let phase=$state('loading'), error=$state(''), apps=$state([]), windows=$state([]), csrf='';
 let sessionApi=$state(api);
 let now=$state(new Date()), quick=$state(false), busy=$state('');
 let user=$state(null),settings=$state(''),health=$state({}),deviceHealth=$state({});
 let onboarding=$derived(user?.role==='admin'&&user?.onboardingComplete===false&&!user?.mustChange);
 let showStatus=$derived(user?.preferences?.showAppStatus!==false);
 let checking=false;
 function observation(app){const d=deviceHealth[app.id];return d?.address===app.url&&d?.state==='Online'&&Date.now()-d.checkedAt<30000?d:health[app.id];}
 async function deviceChecks(){if(checking||!showStatus)return;checking=true;try{for(const app of apps.filter(a=>a.kind==='web'&&a.mode==='native'&&a.url)){if(!showStatus||phase!=='ready')break;if(deviceHealth[app.id]?.address===app.url&&Date.now()-deviceHealth[app.id].checkedAt<30000)continue;const result=await checkDevice(app.url);if(showStatus&&phase==='ready')deviceHealth={...deviceHealth,[app.id]:{...result,address:app.url}};}}finally{checking=false;}}
 function lock(message='Session expired. Sign in again.'){epoch++;navigation++;personal={items:[],iconChoices:[]};route={folderId:null,unavailable:false,app:null};tabLanding=null;phase='locked';windows=[];apps=[];user=null;settings='';quick=false;error=message;timers.forEach(clearTimeout);pending.clear();csrf='';}
 async function refresh(){const s=await api('/session');if(s.csrf!==csrf){lock('Account session changed. Sign in again.');throw new Error('Account session changed.');}user=s.user;apps=s.apps;windows=windows.filter(w=>apps.some(a=>a.id===w.appId)&&(w.id==='system-updater'||s.windows.some(saved=>saved.id===w.id)));await loadDesktop();canonicalize();}
 async function status(){if(phase!=='ready')return;try{await refresh();if(showStatus){health=await api('/status');void deviceChecks();}}catch(e){error=e.message;}}
 async function logout(){try{await api('/logout','POST');lock('Signed out.');}catch(e){error=e.message;}}
 let areaWidth=$state(1200),areaHeight=$state(700),desktop,topZ=0;
 const pending=new Map(), timers=new Map(),gatewayClosing=new Map(),gatewayOpens=new Map();let writes=Promise.resolve();
 async function closeGateway(id){
  const e=epoch,key=e+':'+id,w=windows.find(w=>w.id===id);gatewayOpens.set(key,(gatewayOpens.get(key)||0)+1);
  const saved=flush(id);windows=windows.filter(w=>w.id!==id);
  if(route.app?.appId===w?.appId)void navigate(folderPath(personal.items,route.folderId));
  const job=saved.catch(()=>{}).then(()=>{if(e!==epoch)return;return api('/windows/'+encodeURIComponent(id),'DELETE');}).catch(err=>{if(e===epoch)error=err.message;}).finally(()=>{if(gatewayClosing.get(key)===job)gatewayClosing.delete(key);});
  gatewayClosing.set(key,job);return job;
 }
 async function api(path,method='GET',body,options={}) {
  const requestEpoch=epoch;let response;
  try {response=await fetch('/api'+path,{method,signal:options.signal,credentials:'same-origin',headers:{...(body?{'Content-Type':options.raw?body.type:'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(body?{body:options.raw?body:JSON.stringify(body)}:{})});}
  catch(e) {if(e.name==='AbortError')throw e;throw new Error('Gateway unreachable. Your local desktop is still available.');}
  let data;try{data=await response.json();}catch{throw new Error('Gateway returned an unreadable response.');}
  if(requestEpoch!==epoch)throw new Error('Expired request ignored.');
  if(response.status===401&&path!=='/profile'){lock(path==='/session'&&phase==='loading'?'':'Session expired. Sign in again.');throw new Error('Session expired. Sign in again.');}
  if(!response.ok)throw new Error(data.error||`Gateway error (${response.status})`);
  return data;
 }
 async function bootstrap(){const e=++epoch;phase='loading';error='';try{const session=await api('/session');csrf=session.csrf;sessionApi=(...args)=>e===epoch?api(...args):Promise.reject(new Error('Expired app session'));user=session.user;apps=session.apps;windows=session.windows.map(w=>({...w,z:++topZ}));const focused=windows.find(w=>w.focused);if(focused)focused.z=++topZ;await loadDesktop();phase='ready';if(user?.mustChange)settings='profile';fitDesktop();if(!onboarding)await reconcileRoute();await status();}catch(err){if(e===epoch&&phase!=='locked'){phase='error';error=err.message;}}}
 function local(id,patch){windows=windows.map(w=>w.id===id?{...w,...patch}:patch.focused?{...w,focused:false}:w);}
 function flush(id){clearTimeout(timers.get(id));const patch=pending.get(id),writeEpoch=epoch;if(!patch)return writes;pending.delete(id);writes=writes.catch(()=>{}).then(()=>{if(writeEpoch!==epoch)return;return api('/windows/'+encodeURIComponent(id),'PATCH',patch);}).catch(e=>{if(writeEpoch===epoch)error=e.message;throw e;});return writes;}
 function change(id,patch,immediate=false){local(id,patch);if(id==='system-updater')return Promise.resolve();pending.set(id,{...pending.get(id),...patch});clearTimeout(timers.get(id));if(immediate)return flush(id).catch(()=>{});timers.set(id,setTimeout(()=>flush(id).catch(()=>{}),180));}
 async function focus(id,url=true){const w=windows.find(w=>w.id===id);if(!w)return;if(url)updateURL(w.appId,w.maximized,true);if(w.focused&&w.visible)return writes.catch(()=>{});local(id,{z:++topZ});await change(id,{focused:true,visible:true},true);if(areaWidth<640)fitDesktop();}
 async function open(app,url=true){const openEpoch=epoch,openKey=openEpoch+':'+app.id,openGeneration=(gatewayOpens.get(openKey)||0)+1;if(app.mode==='gateway'){gatewayOpens.set(openKey,openGeneration);await gatewayClosing.get(openKey);if(openEpoch!==epoch||gatewayOpens.get(openKey)!==openGeneration)return;}quick=false;error='';if(app.id==='system-updater'&&app.kind==='system'){let w=windows.find(w=>w.id===app.id);if(!w){w={id:app.id,appId:app.id,title:app.label,mode:'system',x:40,y:30,width:850,height:560,visible:true,focused:true,z:++topZ};windows=[...windows.map(w=>({...w,focused:false})),w];fitDesktop();}await focus(w.id,url);return;}if(app.kind==='web'&&app.mode==='native'&&app.openMode==='tab'){const address=safeExternal(app.url,window.location.origin);if(address){window.open(address,'_blank','noopener,noreferrer');if(url)updateURL(app.id);}else error='Native app address is invalid or shares Relay’s authentication hostname.';return;}busy=app.id;try{const w=await api('/windows','POST',{appId:app.id});if(app.mode==='gateway'&&gatewayOpens.get(openKey)!==openGeneration)return;const next={...w,z:++topZ,focused:true,visible:true};if(windows.some(item=>item.id===w.id))windows=windows.map(item=>item.id===w.id?next:{...item,focused:false});else windows=[...windows.map(item=>({...item,focused:false})),next];fitDesktop();if(url)updateURL(app.id,w.maximized);}catch(e){error=e.message;}finally{busy='';}}
 async function close(id){if(windows.find(w=>w.id===id)?.mode==='gateway')return closeGateway(id);const closeEpoch=epoch;try{if(id!=='system-updater'){await flush(id);if(closeEpoch!==epoch)return;await api('/windows/'+encodeURIComponent(id),'DELETE');}const w=windows.find(w=>w.id===id);windows=windows.filter(w=>w.id!==id);if(route.app?.appId===w?.appId)await navigate(folderPath(personal.items,route.folderId));}catch(e){error=e.message;}}
 async function reload(id){if(id==='system-updater'){local(id,{reload:(windows.find(w=>w.id===id).reload||0)+1});return;}try{await api('/windows/'+encodeURIComponent(id)+'/reload','POST');const frame=document.querySelector(`[data-window-id="${CSS.escape(id)}"] iframe`);if(frame)frame.src=frame.src;}catch(e){error=e.message;}}
 function fitDesktop(){for(const w of windows){const b=w.maximized||(areaWidth<640&&w.focused)?{x:0,y:0,width:areaWidth-4,height:areaHeight-24}:clampBounds(w,areaWidth,areaHeight);const patch={...b,...(areaWidth<640&&!w.focused&&w.visible?{visible:false}:{})};if(Object.entries(patch).some(([key,value])=>w[key]!==value))change(w.id,patch);}}
 onMount(()=>{areaWidth=desktop.clientWidth;areaHeight=desktop.clientHeight;const observer=new ResizeObserver(([entry])=>{areaWidth=entry.contentRect.width;areaHeight=entry.contentRect.height;fitDesktop();});observer.observe(desktop);bootstrap();const interval=setInterval(()=>now=new Date(),1000),poll=setInterval(status,5000);return()=>{observer.disconnect();clearInterval(interval);clearInterval(poll);timers.forEach(clearTimeout);};});
</script>
<svelte:window onpopstate={()=>{void reconcileRoute().catch(e=>error=e.message);}}/>
<SignalIntro enabled={intro} onvisibility={value=>introVisible=value}/>
<div class="relay-shell" style="display: contents" inert={introVisible}>
<header class="topbar"><nav class="path" aria-label="Desktop path"><a href="/desktop" aria-label="Home" onclick={e=>follow(e,'/desktop')}>⌂</a><span>/</span><a href="/desktop" onclick={e=>follow(e,'/desktop')}>Desktop</a>{#if phase==='ready'}{#each crumbs as crumb}<span>/</span><a href={folderPath(personal.items,crumb.id)} onclick={e=>follow(e,folderPath(personal.items,crumb.id))}>{crumb.label}</a>{/each}{/if}</nav><time datetime={now.toISOString()}>{now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}<span>{now.toLocaleTimeString('en-GB')}</span></time></header>
<main class="desktop" bind:this={desktop} aria-label="Personal desktop">
 {#if phase==='ready'&&onboarding}
  <Onboarding {api} {apps} {user} oncomplete={refresh} onlogout={logout}/>
 {:else if phase==='ready'}
  <PersonalDesktop bind:this={personalView} state={personal} folderId={route.folderId} unavailable={route.unavailable} {areaHeight} {motion} {apps} {showStatus} {observation} {statusLabel} {statusDetail} {busy} onopen={openItem} onmutate={mutateDesktop} onupload={uploadIcon} onerror={message=>error=message}/>
  {#if tabLanding}<aside class="tab-landing"><p>This app opens in a new tab.</p><button onclick={()=>open(tabLanding)}>Open {personal.items.find(i=>i.appId===tabLanding.id)?.label||tabLanding.label} in new tab ↗</button></aside>{/if}

  <div class="window-layer" class:unavailable={route.unavailable} inert={route.unavailable}>
  {#each windows as win,i (win.id)}<DesktopWindow {motion} api={sessionApi} win={{...win,title:titleFor(win)}} index={win.z??i} {areaWidth} {areaHeight} onmaximize={()=>setMaximized(win.id,!win.maximized)} onchange={patch=>change(win.id,patch)} onfocus={()=>focus(win.id)} onminimize={()=>change(win.id,{visible:false,focused:false},true)} onclose={()=>close(win.id)} onreload={()=>reload(win.id)}/>{/each}
  </div>
 {:else if phase==='locked'}
  <Login {motion} {takeSetupCredential} onlogin={bootstrap}/>{#if error}<p class="login-message" role="status">{error}</p>{/if}
 {:else}
  <section class="system-panel" aria-live="polite"><div class="panel-heading">desktop / connection</div><div class="panel-body"><div class="lock-symbol" aria-hidden="true">◌</div><h1>{phase==='loading'?'Connecting to your desktop…':'Gateway unavailable'}</h1>{#if phase==='error'}<p>{error}</p><button class="text-button" onclick={bootstrap}>Try again</button>{:else}<p>Waiting for the local gateway.</p>{/if}</div></section>
 {/if}
</main>
{#if error&&phase==='ready'}<aside class="error-toast" role="alert"><span>{error}</span><button onclick={()=>error=''} aria-label="Dismiss error">×</button></aside>{/if}
<footer><span class="maker">Made by Wicked Evil Incorporated</span>{#if phase==='ready'&&!onboarding}<nav class="dock" use:reveal={{enabled:motion,delay:90}} aria-label="Open windows"><button class="nav-toggle" aria-label="Navigation" aria-expanded={quick} onclick={()=>quick=!quick}>⠿</button>{#each windows as win}<button class:active={win.focused&&win.visible} class:minimized={!win.visible} aria-label={'Restore '+titleFor(win)} onclick={()=>focus(win.id)}><span class="dock-indicator">{win.visible?'▪':'▫'}</span>{titleFor(win)}</button>{/each}</nav><span class="footer-note"><span class="app-version">v{VERSION}</span> · {route.unavailable?0:windows.filter(w=>w.visible).length} visible / {windows.length} open</span>{:else}<span class="footer-note"><span class="app-version">v{VERSION}</span> · {phase==='ready'&&onboarding?'first-run setup':phase==='loading'?'connecting':'account access required'}</span>{/if}</footer>
{#if quick}<section class="quick-nav" use:reveal={{enabled:motion,kind:'slide'}} aria-label="Navigation"><div class="panel-heading">Navigation <button aria-label="Close navigation" onclick={()=>quick=false}>×</button></div><p><span>{user?.displayName}</span> <small> / {user?.role}</small></p><button onclick={()=>{quick=false;personalView?.newFolder();}}>New folder</button><p>APPS</p>{#each apps as app}{@const item=personal.items.find(i=>i.appId===app.id)}<button onclick={()=>open(app)}>{#if item?.icon?.type==='upload'}<img src={item.icon.url} alt="" width="24" height="24"/>{:else}<Icon name={item?.icon?.name||app.icon||app.template||app.id}/>{/if}<span>{item?.label||app.label}<small>{app.kind==='web'?(app.mode==='gateway'?'gateway · experimental':app.mode==='stream'?'streamed · isolated browser':'native · '+(app.openMode==='tab'?'new tab':'desktop window')):(app.mode==='stream'?'streamed · synthetic lab':'native · built in')}</small></span><span>↗</span></button>{/each}<hr/><button onclick={()=>{settings='profile';quick=false;}}>Profile settings</button>{#if user?.role==='admin'&&!user?.mustChange}<button onclick={()=>{settings='admin';quick=false;}}>Control Panel</button>{/if}<button onclick={logout}>Sign out</button></section>{/if}
{#if phase==='ready'&&settings}<Settings kind={settings} {user} {api} onclose={()=>settings=''} onrefresh={refresh} onpassword={()=>lock('Password changed. Sign in again.')}/>{/if}
</div>
<style>
 .window-layer{position:absolute;inset:0;z-index:10;pointer-events:none}.window-layer :global(.desktop-window){pointer-events:auto}.window-layer.unavailable{visibility:hidden}
 .path{min-width:0;overflow-x:auto;white-space:nowrap;margin-right:16px;scrollbar-width:none}.path a{color:inherit;text-decoration:none;flex:none}.path a:hover{text-decoration:underline}.path a:focus-visible{outline:1px dashed #fafaf9;outline-offset:2px}time{flex:none}.tab-landing{position:absolute;left:50%;top:30%;transform:translateX(-50%);padding:24px;background:#1c1917;border:1px solid #a8a29e;z-index:2;max-width:calc(100% - 24px)}.tab-landing button{border:1px solid #a8a29e;padding:10px}
</style>