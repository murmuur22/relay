<script>
 import {VERSION} from '../version.js';

 import { onMount } from 'svelte';
 import {launchUpdater} from './updater.js';
 import DesktopWindow from './DesktopWindow.svelte';
 import PersonalDesktop from './PersonalDesktop.svelte';
 import {resolveDesktop,folderPath,itemToken,ancestry} from './desktop.js';
 let personal=$state({items:[],iconChoices:[]}),route=$state({folderId:null,unavailable:false,app:null,maximized:false}),personalView=$state(),tabLanding=$state(null);
 let epoch=0,navigation=0,relayRuntime='';
 // Independent maintenance lives outside the authenticated desktop lifecycle.
 // Only a one-use launch fragment crosses into its fixed origin; messages carry no authority.
 let maintenance=$state(null),maintenanceOpen=$state(false),maintenanceLogin=$state(false),maintenanceFrame=$state();
 function mountMaintenance(frame){maintenanceFrame=frame;const target=maintenance.url;maintenance.url=undefined;frame.contentWindow.location.replace(target);}
 function startMaintenance(url){if(maintenance?.ending)throw Error('The previous monitoring session is still ending. Try again.');if(phase!=='ready'||user?.role!=='admin')throw Error('Updater launch expired.');if(maintenance){maintenanceOpen=true;maintenanceLogin=false;return;}maintenance={url,origin:new URL(url).origin,version:new URL(url).hash.split('~')[1]||'',owner:user.id,runtimeInstance:relayRuntime};maintenanceOpen=true;maintenanceLogin=false;}
 async function standaloneMaintenance(){const e=epoch;try{await launchUpdater(()=>sessionApi('/updater/launch','POST',{}),()=>e===epoch&&!!maintenance,window,maintenance?.version||'');}catch(err){if(e===epoch)error=err.message;}}
 function maintenanceVisibility(){if(maintenance&&maintenanceFrame)maintenanceFrame.contentWindow.postMessage({type:maintenanceOpen&&!maintenanceLogin?'relay-updater-visible':'relay-updater-hidden'},maintenance.origin);}
 $effect(()=>{maintenanceOpen;maintenanceLogin;maintenanceFrame;maintenanceVisibility();});
 let maintenanceEndTimer;
 function clearMaintenance(){clearTimeout(maintenanceEndTimer);maintenance=null;maintenanceOpen=false;maintenanceLogin=false;maintenanceFrame=undefined;}
 function endMaintenanceMessage(){if(maintenance?.ending&&maintenance.ready)maintenanceFrame?.contentWindow?.postMessage({type:'relay-updater-end'},maintenance.origin);}
 function retireMaintenance(){if(!maintenance||maintenance.ending)return;maintenance.ending=true;maintenanceOpen=false;maintenanceLogin=false;endMaintenanceMessage();const target=maintenance;maintenanceEndTimer=setTimeout(()=>{if(maintenance===target){clearMaintenance();error='Monitoring was hidden, but independent session termination could not be confirmed.';}},10000);}
 function maintenanceMessage(event){if(!maintenance||event.source!==maintenanceFrame?.contentWindow||event.origin!==maintenance.origin||!event.data||Object.keys(event.data).length!==1)return;
  if(event.data.type==='relay-updater-ready'){maintenance.ready=true;if(maintenance.ending)endMaintenanceMessage();else maintenanceVisibility();}
  if(event.data.type==='relay-updater-sign-in'&&!maintenance.ending){lock('Sign in again to authorize further actions. Monitoring is read-only during restart.');maintenanceLogin=true;}
  if(event.data.type==='relay-updater-ended')clearMaintenance();
 }
 onMount(()=>{window.addEventListener('message',maintenanceMessage);return()=>window.removeEventListener('message',maintenanceMessage);});
 let crumbs=$derived(route.unavailable?[]:ancestry(personal.items,route.folderId)||[]);
 function titleFor(win){return personal.items.find(i=>i.appId===win.appId)?.label||win.title;}
 const personalGenerations=new Map();
 function acceptDesktop(data){if(data.ownerId!==user?.id)throw new Error('Desktop response belongs to an expired session.');if(personal.ownerId===data.ownerId&&data.revision<personal.revision)return;const prior=personal.personalApps||[];personal=data;apps=[...apps.filter(a=>!a.personal),...(data.personalApps||[])];for(const a of prior){const next=apps.find(b=>b.id===a.id);if(!next||next.url!==a.url||next.openMode!==a.openMode){personalGenerations.set(a.id,(personalGenerations.get(a.id)||0)+1);navigation++;if(busy===a.id){busy='';busyOwner=null;}}}windows=windows.filter(w=>!w.appId.startsWith('personal-')||apps.some(a=>a.id===w.appId&&a.url===w.url&&a.openMode!=='tab'));if(tabLanding?.personal)tabLanding=apps.find(a=>a.id===tabLanding.id)||null;}
 async function loadDesktop(){acceptDesktop(await api('/desktop'));}
 function canonicalize(){route=resolveDesktop(personal.items,location.pathname,location.search);if(!route.unavailable&&location.pathname+location.search!==route.url)history.replaceState(null,'',route.url);}
 let desktopWrites=Promise.resolve();
 async function mutateDesktop(path,method,body){const requestEpoch=epoch,sourceFolder=route.folderId;const operation=desktopWrites.catch(()=>{}).then(async()=>{if(requestEpoch!==epoch||sourceFolder!==route.folderId)throw new Error('Desktop context changed. Select items again.');let data;try{data=await api(path,method,body);}catch(err){if(err.status===409&&requestEpoch===epoch&&sourceFolder===route.folderId){await loadDesktop();canonicalize();throw new Error(err.message+' Desktop refreshed; review selection and retry.');}throw err;}if(requestEpoch!==epoch)throw new Error('Expired desktop operation.');acceptDesktop(data);canonicalize();});desktopWrites=operation;return operation;}
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
 import Hotkeys from './Hotkeys.svelte';
 let hotkeys=$state(false);
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
 import {safeExternal,statusLabel,statusDetail} from './webapps.js';
 import { clampBounds } from './geometry.js';
 let phase=$state('loading'), error=$state(''), apps=$state([]), windows=$state([]), csrf='';
 let sessionApi=$state(api);
 let now=$state(new Date()), quick=$state(false), busy=$state('');
 let user=$state(null),settings=$state(''),health=$state({});
 const liveStatusLabel=value=>statusLabel(value,now.getTime()),liveStatusDetail=value=>statusDetail(value,now.getTime());
 let onboarding=$derived(user?.role==='admin'&&user?.onboardingComplete===false&&!user?.mustChange);
 let showStatus=$derived(user?.preferences?.showAppStatus!==false);
 let deviceController;
 function observation(app){return health[app.id]||{state:'Unknown',reachability:'not-monitored',source:'relay',checkedAt:0,detail:app.personal?'Personal Native URL: not monitored. Relay never probes personal URLs.':'No server observation available. Reachability is not device connectivity, readiness or successful login.'};}
 $effect(()=>{if(!showStatus){deviceController?.abort();health={};}});
 function lock(message='Session expired. Sign in again.'){epoch++;navigation++;personalGenerations.clear();busy='';busyOwner=null;deviceController?.abort();deviceController=null;health={};personal={items:[],iconChoices:[]};route={folderId:null,unavailable:false,app:null};tabLanding=null;phase='locked';windows=[];apps=[];user=null;settings='';hotkeys=false;quick=false;error=message;timers.forEach(clearTimeout);pending.clear();csrf='';}
 async function refresh(){const s=await api('/session');if(s.csrf!==csrf){retireMaintenance();lock('Account session changed. Sign in again.');throw new Error('Account session changed.');}user=s.user;apps=s.apps;windows=windows.filter(w=>apps.some(a=>a.id===w.appId)&&(systemWindow(w.id)||s.windows.some(saved=>saved.id===w.id)));await loadDesktop();canonicalize();}
 async function status(){if(phase!=='ready')return;const e=epoch;try{await refresh();if(showStatus){deviceController?.abort();const controller=new AbortController();deviceController=controller;const observed=await api('/status','GET',undefined,{signal:controller.signal});if(e===epoch&&showStatus&&phase==='ready')health=observed;}}catch(err){if(err.name!=='AbortError'&&e===epoch)error=err.message;}}
 async function logout(){const token=csrf;retireMaintenance();lock('Signing out…');phase='loading';const e=epoch;try{const response=await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:'{}',signal:AbortSignal.timeout(10000)});if(e!==epoch)return;const data=await response.json();if(!response.ok)throw Error(data.error||'Sign out could not be confirmed.');error='Signed out.';}catch(err){if(e===epoch)error=err.message;}finally{if(e===epoch)phase='locked';}}
 let areaWidth=$state(1200),areaHeight=$state(700),desktop,topZ=0;
 const pending=new Map(), timers=new Map(),gatewayClosing=new Map(),gatewayOpens=new Map();let writes=Promise.resolve(),busyOwner;
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
  const runtime=response.headers.get('X-Relay-Runtime-Instance')||'';
  if(response.status===401&&path!=='/profile'){if(maintenance&&(!/^[a-f0-9]{64}$/.test(runtime)||!/^[a-f0-9]{64}$/.test(maintenance.runtimeInstance)||runtime===maintenance.runtimeInstance))retireMaintenance();lock(path==='/session'&&phase==='loading'?'':'Session expired. Sign in again.');throw new Error('Session expired. Sign in again.');}
  if(!response.ok){const err=new Error(data.error||`Gateway error (${response.status})`);err.status=response.status;throw err;}
  if(path==='/session')relayRuntime=runtime;
  return data;
 }
 async function bootstrap(){const e=++epoch;phase='loading';error='';try{const session=await api('/session');csrf=session.csrf;sessionApi=(...args)=>e===epoch?api(...args):Promise.reject(new Error('Expired app session'));user=session.user;if(maintenance){if(maintenance.owner!==user.id||user.role!=='admin'||user.disabled||user.mustChange)retireMaintenance();else{maintenance.runtimeInstance=relayRuntime;maintenanceLogin=false;maintenanceFrame?.contentWindow?.postMessage({type:'relay-updater-reconnected'},maintenance.origin);}}apps=session.apps;windows=session.windows.map(w=>({...w,z:++topZ}));const focused=windows.find(w=>w.focused);if(focused)focused.z=++topZ;await loadDesktop();phase='ready';if(user?.mustChange)settings='profile';fitDesktop();if(!onboarding)await reconcileRoute();await status();}catch(err){if(e===epoch&&phase!=='locked'){phase='error';error=err.message;}}}
 const systemIds=new Set(['system-updater','system-control-panel']);
 function systemWindow(id){const w=windows.find(w=>w.id===id);return w?.mode==='system'&&w.appId===id&&systemIds.has(id);}
 function local(id,patch){windows=windows.map(w=>w.id===id?{...w,...patch}:patch.focused?{...w,focused:false}:w);}
 function flush(id){clearTimeout(timers.get(id));const patch=pending.get(id),writeEpoch=epoch;if(!patch)return writes;pending.delete(id);writes=writes.catch(()=>{}).then(()=>{if(writeEpoch!==epoch)return;return api('/windows/'+encodeURIComponent(id),'PATCH',patch);}).catch(e=>{if(writeEpoch===epoch)error=e.message;throw e;});return writes;}
 function change(id,patch,immediate=false){local(id,patch);if(systemWindow(id))return Promise.resolve();pending.set(id,{...pending.get(id),...patch});clearTimeout(timers.get(id));if(immediate)return flush(id).catch(()=>{});timers.set(id,setTimeout(()=>flush(id).catch(()=>{}),180));}
 async function focus(id,url=true){const w=windows.find(w=>w.id===id);if(!w)return;if(url)updateURL(w.appId,w.maximized,true);if(w.focused&&w.visible)return systemWindow(id)?Promise.resolve():writes.catch(()=>{});local(id,{z:++topZ});await change(id,{focused:true,visible:true},true);if(areaWidth<640)fitDesktop();}
 async function open(app,url=true){const openEpoch=epoch,definitionGeneration=personalGenerations.get(app.id)||0,openKey=openEpoch+':'+app.id,openGeneration=(gatewayOpens.get(openKey)||0)+1;if(app.mode==='gateway'){gatewayOpens.set(openKey,openGeneration);await gatewayClosing.get(openKey);if(openEpoch!==epoch||gatewayOpens.get(openKey)!==openGeneration)return;}quick=false;error='';if(systemIds.has(app.id)&&app.kind==='system'&&user?.role==='admin'&&!user.disabled&&!user.mustChange){let w=windows.find(w=>w.id===app.id);if(!w){w={id:app.id,appId:app.id,title:app.label,mode:'system',x:40,y:30,width:850,height:560,visible:true,focused:true,z:++topZ};windows=[...windows.map(w=>({...w,focused:false})),w];fitDesktop();}await focus(w.id,url);return;}if(app.kind==='web'&&app.mode==='native'&&app.openMode==='tab'){const address=safeExternal(app.url,window.location.origin);if(address){window.open(address,'_blank','noopener,noreferrer');if(url)updateURL(app.id);}else error='Native app address is invalid or shares Relay’s authentication hostname.';return;}busy=app.id;const launch={};busyOwner=launch;try{const w=await api('/windows','POST',{appId:app.id});if(openEpoch!==epoch)return;if(app.mode==='gateway'&&gatewayOpens.get(openKey)!==openGeneration)return;
  if(app.personal){
   // A tab-local generation cannot see parallel owner A -> B -> A edits.
   // Observe the exact live server window after refresh's awaits. Never adopt a
   // replacement cookie's authority, and do not await again before insertion.
   await refresh();const live=await api('/session');
   if(live.csrf!==csrf){retireMaintenance();lock('Account session changed. Sign in again.');return;}
   const current=live.apps.find(a=>a.id===app.id);
   if(openEpoch!==epoch||definitionGeneration!==(personalGenerations.get(app.id)||0)||typeof w.personalLaunchId!=='string'||!live.windows.some(saved=>saved.id===w.id&&saved.personalLaunchId===w.personalLaunchId)||!current?.personal||current.kind!==app.kind||current.mode!==app.mode||current.url!==app.url||current.openMode!==app.openMode||w.appId!==app.id||w.url!==current.url||w.openMode!==current.openMode||current.openMode==='tab'){
    if(openEpoch===epoch&&w.appId===app.id&&typeof w.personalLaunchId==='string')await api('/windows/'+encodeURIComponent(w.id)+'/retire-personal-launch','POST',{personalLaunchId:w.personalLaunchId});
    return;
   }
  }
  const next={...w,z:++topZ,focused:true,visible:true};if(windows.some(item=>item.id===w.id))windows=windows.map(item=>item.id===w.id?next:{...item,focused:false});else windows=[...windows.map(item=>({...item,focused:false})),next];fitDesktop();if(url)updateURL(app.id,w.maximized);}catch(e){if(openEpoch===epoch)error=e.message;}finally{if(busyOwner===launch){busy='';busyOwner=null;}}}
 async function close(id){if(windows.find(w=>w.id===id)?.mode==='gateway')return closeGateway(id);const closeEpoch=epoch;try{if(!systemWindow(id)){await flush(id);if(closeEpoch!==epoch)return;await api('/windows/'+encodeURIComponent(id),'DELETE');}const w=windows.find(w=>w.id===id);windows=windows.filter(w=>w.id!==id);if(route.app?.appId===w?.appId)await navigate(folderPath(personal.items,route.folderId));if(closeEpoch===epoch&&w?.mode==='system')document.querySelector('button[aria-label="Navigation"]')?.focus();}catch(e){error=e.message;}}
 async function reload(id){if(systemWindow(id)){local(id,{reload:(windows.find(w=>w.id===id).reload||0)+1});return;}try{await api('/windows/'+encodeURIComponent(id)+'/reload','POST');const frame=document.querySelector(`[data-window-id="${CSS.escape(id)}"] iframe`);if(frame)frame.src=frame.src;}catch(e){error=e.message;}}
 function fitDesktop(){for(const w of windows){const b=w.maximized||(areaWidth<640&&w.focused)?{x:0,y:0,width:areaWidth-4,height:areaHeight-24}:clampBounds(w,areaWidth,areaHeight);const patch={...b,...(areaWidth<640&&!w.focused&&w.visible?{visible:false}:{})};if(Object.entries(patch).some(([key,value])=>w[key]!==value))change(w.id,patch);}}
 onMount(()=>{areaWidth=desktop.clientWidth;areaHeight=desktop.clientHeight;const observer=new ResizeObserver(([entry])=>{areaWidth=entry.contentRect.width;areaHeight=entry.contentRect.height;fitDesktop();});observer.observe(desktop);bootstrap();const interval=setInterval(()=>now=new Date(),1000),poll=setInterval(status,5000);return()=>{observer.disconnect();clearInterval(interval);clearInterval(poll);timers.forEach(clearTimeout);};});
</script>
<svelte:window onpopstate={()=>{void reconcileRoute().catch(e=>error=e.message);}}/>
<SignalIntro enabled={intro} onvisibility={value=>introVisible=value}/>
<div class="relay-shell" style="display: contents" inert={introVisible}>
<header class="topbar"><nav class="path" aria-label="Desktop path"><a href="/desktop" aria-label="Home" onclick={e=>follow(e,'/desktop')}>~</a>{#if phase==='ready'}{#each crumbs as crumb}<span>/</span><a href={folderPath(personal.items,crumb.id)} onclick={e=>follow(e,folderPath(personal.items,crumb.id))}>{crumb.label}</a>{/each}{/if}</nav><time datetime={now.toISOString()}>{now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}<span>{now.toLocaleTimeString('en-GB')}</span></time></header>
<main class="desktop" bind:this={desktop} aria-label="Personal desktop">
 {#if phase==='ready'&&onboarding}
  <Onboarding {api} {apps} {user} oncomplete={refresh} onlogout={logout}/>
 {:else if phase==='ready'}
  <PersonalDesktop bind:this={personalView} state={personal} folderId={route.folderId} unavailable={route.unavailable} {areaHeight} {motion} {apps} {showStatus} {observation} statusLabel={liveStatusLabel} statusDetail={liveStatusDetail} {busy} onopen={openItem} onmutate={mutateDesktop} onupload={uploadIcon} onerror={message=>error=message}/>
  {#if tabLanding}<aside class="tab-landing"><p>This app opens in a new tab.</p><button onclick={()=>open(tabLanding)}>Open {personal.items.find(i=>i.appId===tabLanding.id)?.label||tabLanding.label} in new tab ↗</button></aside>{/if}

  <div class="window-layer" class:unavailable={route.unavailable} inert={route.unavailable}>
  {#each windows as win,i (win.id)}<DesktopWindow onmaintenance={startMaintenance} {motion} {user} onrefresh={refresh} api={sessionApi} win={{...win,title:titleFor(win)}} index={win.z??i} {areaWidth} {areaHeight} onmaximize={()=>setMaximized(win.id,!win.maximized)} onchange={patch=>change(win.id,patch)} onfocus={()=>focus(win.id)} onminimize={()=>change(win.id,{visible:false,focused:false},true)} onclose={()=>close(win.id)} onreload={()=>reload(win.id)}/>{/each}
  </div>
 {:else if phase==='locked'}
  <Login {motion} {takeSetupCredential} onlogin={bootstrap}/>{#if error}<p class="login-message" role="status">{error}</p>{/if}
 {:else}
  <section class="system-panel" aria-live="polite"><div class="panel-heading">desktop / connection</div><div class="panel-body"><div class="lock-symbol" aria-hidden="true">◌</div><h1>{phase==='loading'?'Connecting to your desktop…':'Gateway unavailable'}</h1>{#if phase==='error'}<p>{error}</p><button class="text-button" onclick={bootstrap}>Try again</button>{:else}<p>Waiting for the local gateway.</p>{/if}</div></section>
 {/if}
</main>
{#if error&&phase==='ready'}<aside class="error-toast" role="alert"><span>{error}</span><button onclick={()=>error=''} aria-label="Dismiss error">×</button></aside>{/if}
<footer><span class="maker">Made by Wicked Evil Incorporated</span>{#if phase==='ready'&&!onboarding}<nav class="dock" use:reveal={{enabled:motion,delay:90}} aria-label="Open windows"><button class="nav-toggle" aria-label="Navigation" aria-expanded={quick} onclick={()=>quick=!quick}>⠿</button>{#each windows as win}<button class:active={win.focused&&win.visible} class:minimized={!win.visible} aria-label={'Restore '+titleFor(win)} onclick={()=>focus(win.id)}><span class="dock-indicator">{win.visible?'▪':'▫'}</span>{titleFor(win)}</button>{/each}</nav><span class="footer-note"><span class="app-version">v{VERSION}</span> · {route.unavailable?0:windows.filter(w=>w.visible).length} visible / {windows.length} open</span>{:else}<span class="footer-note"><span class="app-version">v{VERSION}</span> · {phase==='ready'&&onboarding?'first-run setup':phase==='loading'?'connecting':'account access required'}</span>{/if}</footer>
{#if quick}<section class="quick-nav" use:reveal={{enabled:motion,kind:'slide'}} aria-label="Navigation"><div class="panel-heading">Navigation <button aria-label="Close navigation" onclick={()=>quick=false}>×</button></div><p><span>{user?.displayName}</span> <small> / {user?.role}</small></p><button onclick={()=>{quick=false;personalView?.addApp();}}>Add app</button><button onclick={()=>{quick=false;personalView?.newFolder();}}>New folder</button><p>APPS</p>{#if personal.pendingAppIds?.length}<p>Home is full. New apps remain in Navigation; remove a folder or personal shortcut to place them.</p>{/if}{#if personal.unavailablePersonalItems?.length}<button onclick={()=>{quick=false;personalView?.unavailableShortcuts();}}>Unavailable shortcuts</button>{/if}{#each apps as app}{@const item=personal.items.find(i=>i.appId===app.id)}<button aria-label={item?.label||app.label} onclick={()=>open(app)}>{#if item?.icon?.type==='upload'}<img src={item.icon.url} alt="" width="24" height="24"/>{:else}<Icon name={item?.icon?.name||app.icon||app.template||app.id}/>{/if}<span>{item?.label||app.label}<small>{app.kind==='web'?(app.mode==='gateway'?'gateway · experimental':app.mode==='stream'?'streamed · isolated browser':'native · '+(app.openMode==='tab'?'new tab':'desktop window')):(app.mode==='stream'?'streamed · synthetic lab':'native · built in')}</small></span><span>↗</span></button>{/each}<hr/><button onclick={()=>{settings='profile';quick=false;}}>Profile settings</button><button onclick={()=>{quick=false;hotkeys=true;}}>Navigation Hotkeys</button><button onclick={logout}>Sign out</button></section>{/if}
{#if phase==='ready'&&hotkeys}<Hotkeys context={route.folderId?'folder':'desktop'} onclose={()=>hotkeys=false}/>{/if}
{#if phase==='ready'&&settings}<Settings kind={settings} {user} {api} onclose={()=>settings=''} onrefresh={refresh} onpassword={()=>lock('Password changed. Sign in again.')}/>{/if}
{#if maintenance}
 <section class="maintenance-surface" class:concealed={!maintenanceOpen||maintenanceLogin} inert={!maintenanceOpen||maintenanceLogin} aria-label="Independent maintenance">
  <div class="maintenance-bar"><span>Relay / independent maintenance</span><span>Monitoring is independent · changes require fresh authorization</span><button disabled={phase!=='ready'||user?.role!=='admin'||user?.mustChange} onclick={standaloneMaintenance}>Standalone recovery (new tab)</button><button aria-label="Close maintenance" onclick={()=>maintenanceOpen=false}>×</button></div>
  <iframe use:mountMaintenance title={maintenance.ending?'Retiring Relay updater':'Independent Relay updater'} referrerpolicy="no-referrer"></iframe>
 </section>
 {#if !maintenance.ending&&(!maintenanceOpen||maintenanceLogin)}<button class="maintenance-restore" onclick={()=>{maintenanceOpen=true;maintenanceLogin=false;}}>Return to maintenance monitor</button>{/if}
{/if}
</div>
<style>
 .maintenance-surface{position:fixed;inset:54px 12px 56px;z-index:100;background:#0b0b0a;border:1px solid #77756e;display:flex;flex-direction:column}.maintenance-surface.concealed{visibility:hidden;pointer-events:none}.maintenance-bar{display:flex;flex-wrap:wrap;gap:16px;align-items:center;font:11px ui-monospace,monospace;padding:6px 10px;border-bottom:1px solid #44443f}.maintenance-bar span:nth-child(2){margin-left:auto;color:#aaa8a0}.maintenance-bar button{padding:4px 10px;border:1px solid #77756e}.maintenance-surface iframe{width:100%;height:100%;min-height:0;flex:1;border:0}.maintenance-restore{position:fixed;right:12px;bottom:56px;z-index:101;background:#111110;color:#efeee5;border:1px solid #77756e;padding:12px;font:12px ui-monospace,monospace}
 .window-layer{position:absolute;inset:0;z-index:10;pointer-events:none}.window-layer :global(.desktop-window){pointer-events:auto}.window-layer.unavailable{visibility:hidden}
 .path{min-width:0;overflow-x:auto;white-space:nowrap;margin-right:16px;scrollbar-width:none}.path a{color:inherit;text-decoration:none;flex:none}.path a:hover{text-decoration:underline}.path a:focus-visible{outline:1px dashed #fafaf9;outline-offset:2px}time{flex:none}.tab-landing{position:absolute;left:50%;top:30%;transform:translateX(-50%);padding:24px;background:#1c1917;border:1px solid #a8a29e;z-index:2;max-width:calc(100% - 24px)}.tab-landing button{border:1px solid #a8a29e;padding:10px}
</style>