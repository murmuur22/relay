<script>
 import { onMount } from 'svelte';
 import StreamSurface from './StreamSurface.svelte';
 import UpdaterBrowser from './UpdaterBrowser.svelte';
 import GatewaySurface from './GatewaySurface.svelte';
 let gatewaySurface=$state();
 import {windowMotion} from './motion.js';
 import {safeExternal} from './webapps.js';
 import { clampBounds,TITLE_HEIGHT } from './geometry.js';
 let {win,index,areaWidth,areaHeight,onchange,onfocus,onminimize,onclose,onreload,onmaximize,motion=false,api}=$props();
 let restore=$derived(win.maximized),gesture=$state(null),frame=$state(),bridgeCleanup=()=>{},nativeState=$state('loading');
 let navigation=$state({canGoBack:false,canGoForward:false,busy:true}),navigationPending=$state(false),navigationError=$state('');
 async function travel(direction){if(navigationPending)return;navigationPending=true;navigationError='';try{await api('/windows/'+encodeURIComponent(win.id)+'/navigate','POST',{direction});}catch(e){navigationError=e.message;}finally{navigationPending=false;}}
 const nativeUrls={parcels:'/native/parcels/',keepsakes:'/native/keepsakes/'};
 let safeUrl=$derived(win.external?safeExternal(win.url,window.location.origin):nativeUrls[win.appId]===win.url?win.url:null);
 let narrow=$derived(areaWidth<640);
 let bounds=$derived(narrow?{x:0,y:0,width:areaWidth-4,height:areaHeight-TITLE_HEIGHT}:win);
 function begin(e,kind){if(e.button!==0||e.target.closest('.window-controls'))return;e.preventDefault();onfocus();if(restore||narrow)return;gesture={kind,x:e.clientX,y:e.clientY,bounds:{x:win.x,y:win.y,width:win.width,height:win.height}};e.currentTarget.setPointerCapture(e.pointerId);}
 function move(e){if(!gesture)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y,b=gesture.bounds;onchange(clampBounds(gesture.kind==='drag'?{...b,x:b.x+dx,y:b.y+dy}:{...b,width:b.width+dx,height:b.height+dy},areaWidth,areaHeight));}
 function maximize(){onmaximize();}
 function nativeLoaded(){bridgeCleanup();try{const doc=frame.contentDocument;if(!doc)throw Error();const activate=()=>onfocus();doc.addEventListener('pointerdown',activate,true);doc.addEventListener('focusin',activate,true);bridgeCleanup=()=>{doc.removeEventListener('pointerdown',activate,true);doc.removeEventListener('focusin',activate,true);};const text=doc.body?.innerText||'';nativeState=doc.querySelector('body > pre')&&/error|unavailable|unauthorized/i.test(text)?'unavailable':'ready';}catch{nativeState='unavailable';}}
 onMount(()=>()=>bridgeCleanup());
</script>
<section class="desktop-window" use:windowMotion={{enabled:motion,visible:win.visible&&(!narrow||win.focused)}} inert={!win.visible||(narrow&&!win.focused)} class:focused={win.focused} class:gesturing={!!gesture} data-app={win.appId} data-window-id={win.id} aria-label={win.title+' window'} style:left={bounds.x+'px'} style:top={bounds.y+'px'} style:width={bounds.width+4+'px'} style:height={bounds.height+TITLE_HEIGHT+'px'} style:z-index={10+index}>
 <!-- svelte-ignore a11y_no_static_element_interactions -->
 <div class="titlebar" onpointerdown={e=>begin(e,'drag')} onpointermove={move} onpointerup={()=>gesture=null} onpointercancel={()=>gesture=null} ondblclick={maximize}>
  <span class="window-title">{win.title}</span><span class="mode-label">{win.mode==='gateway'?'gateway · experimental':win.mode==='stream'?'streamed':'native'}</span>
  <div class="window-controls">{#if win.mode==='stream'}<button aria-label={'Back in '+win.title} title="Back in remote page" disabled={!navigation.canGoBack||navigation.busy||navigationPending} onclick={()=>travel('back')}>←</button><button aria-label={'Forward in '+win.title} title="Forward in remote page" disabled={!navigation.canGoForward||navigation.busy||navigationPending} onclick={()=>travel('forward')}>→</button>{/if}<button aria-label={'Reload '+win.title} title={win.mode==='gateway'?'Restart app session (fresh login)':'Reload app'} onclick={()=>win.mode==='gateway'?gatewaySurface?.restart():onreload()}>↻</button><button aria-label={'Minimize '+win.title} title="Minimize" onclick={onminimize}>−</button><button aria-label={(restore?'Restore size ':'Maximize ')+win.title} title={restore?'Restore':'Maximize'} onclick={maximize}>{restore?'❐':'□'}</button><button aria-label={'Close '+win.title} title={win.mode==='gateway'?'Close and end app session':'Close app'} onclick={()=>{if(win.mode==='gateway')void gatewaySurface?.end();onclose();}}>×</button></div>
 </div>
 <div class="window-content">
  {#if win.mode==='system'&&win.appId==='system-updater'}
   {#key win.reload}<UpdaterBrowser {api} {motion} visible={win.visible} onactivate={onfocus} />{/key}
  {:else if win.mode==='gateway'}
   <GatewaySurface bind:this={gatewaySurface} appId={win.appId} title={win.title} {api} onactivate={onfocus}/>
  {:else if win.mode==='native'}
   {#if safeUrl&&win.external}<div class="external-native"><p class="embedding-note">Blank or blocked? The site may refuse embedding or require features restricted by the sandbox. Relay cannot control this iframe's Back/Forward history. <a href={safeUrl} target="_blank" rel="noopener noreferrer">Open in new tab</a> for normal browser navigation; admins can make New tab the default in Apps.</p><iframe bind:this={frame} src={safeUrl} title={win.title} sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"></iframe></div>
   {:else if safeUrl}<iframe bind:this={frame} src={safeUrl} title={win.title} onload={nativeLoaded}></iframe>{#if nativeState!=='ready'}<div class="native-notice" role="status">{nativeState==='loading'?'Loading native app…':'Native app unavailable — use reload to retry.'}</div>{/if}{:else}<div class="surface-message">Unregistered native app URL. Content was not loaded.</div>{/if}
  {:else}<StreamSurface {win} onactivate={onfocus} onnavigation={value=>navigation=value}/>{#if navigationError}<p role="alert">{navigationError}</p>{/if}{/if}
 </div>
 {#if !narrow&&!restore}<button class="resize-handle" aria-label={'Resize '+win.title} onpointerdown={e=>begin(e,'resize')} onpointermove={move} onpointerup={()=>gesture=null} onpointercancel={()=>gesture=null}></button>{/if}
</section>
