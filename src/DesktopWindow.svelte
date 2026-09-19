<script>
 import { onMount } from 'svelte';
 import StreamSurface from './StreamSurface.svelte';
 import {windowMotion} from './motion.js';
 import {safeExternal} from './webapps.js';
 import { clampBounds,TITLE_HEIGHT } from './geometry.js';
 let {win,index,areaWidth,areaHeight,onchange,onfocus,onminimize,onclose,onreload,motion=false}=$props();
 let restore=$state(null),gesture=$state(null),frame=$state(),bridgeCleanup=()=>{},nativeState=$state('loading');
 const nativeUrls={parcels:'/native/parcels/',keepsakes:'/native/keepsakes/'};
 let safeUrl=$derived(win.external?safeExternal(win.url,window.location.origin):nativeUrls[win.appId]===win.url?win.url:null);
 let narrow=$derived(areaWidth<640);
 let bounds=$derived(narrow?{x:0,y:0,width:areaWidth-4,height:areaHeight-TITLE_HEIGHT}:win);
 function begin(e,kind){if(e.button!==0||e.target.closest('.window-controls'))return;e.preventDefault();onfocus();if(restore||narrow)return;gesture={kind,x:e.clientX,y:e.clientY,bounds:{x:win.x,y:win.y,width:win.width,height:win.height}};e.currentTarget.setPointerCapture(e.pointerId);}
 function move(e){if(!gesture)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y,b=gesture.bounds;onchange(clampBounds(gesture.kind==='drag'?{...b,x:b.x+dx,y:b.y+dy}:{...b,width:b.width+dx,height:b.height+dy},areaWidth,areaHeight));}
 function maximize(){if(restore){onchange(clampBounds(restore,areaWidth,areaHeight));restore=null;}else{restore={x:win.x,y:win.y,width:win.width,height:win.height};onchange({x:0,y:0,width:areaWidth-4,height:areaHeight-TITLE_HEIGHT});}onfocus();}
 function nativeLoaded(){bridgeCleanup();try{const doc=frame.contentDocument;if(!doc)throw Error();const activate=()=>onfocus();doc.addEventListener('pointerdown',activate,true);doc.addEventListener('focusin',activate,true);bridgeCleanup=()=>{doc.removeEventListener('pointerdown',activate,true);doc.removeEventListener('focusin',activate,true);};const text=doc.body?.innerText||'';nativeState=doc.querySelector('body > pre')&&/error|unavailable|unauthorized/i.test(text)?'unavailable':'ready';}catch{nativeState='unavailable';}}
 onMount(()=>()=>bridgeCleanup());
</script>
<section class="desktop-window" use:windowMotion={{enabled:motion,visible:win.visible&&(!narrow||win.focused)}} inert={!win.visible||(narrow&&!win.focused)} class:focused={win.focused} class:gesturing={!!gesture} data-app={win.appId} data-window-id={win.id} aria-label={win.title+' window'} style:left={bounds.x+'px'} style:top={bounds.y+'px'} style:width={bounds.width+4+'px'} style:height={bounds.height+TITLE_HEIGHT+'px'} style:z-index={10+index}>
 <!-- svelte-ignore a11y_no_static_element_interactions -->
 <div class="titlebar" onpointerdown={e=>begin(e,'drag')} onpointermove={move} onpointerup={()=>gesture=null} onpointercancel={()=>gesture=null} ondblclick={maximize}>
  <span class="window-title">{win.title}</span><span class="mode-label">{win.mode==='stream'?'streamed':'native'}</span>
  <div class="window-controls"><button aria-label={'Reload '+win.title} title="Reload app" onclick={onreload}>↻</button><button aria-label={'Minimize '+win.title} title="Minimize" onclick={onminimize}>−</button><button aria-label={(restore?'Restore size ':'Maximize ')+win.title} title={restore?'Restore':'Maximize'} onclick={maximize}>{restore?'❐':'□'}</button><button aria-label={'Close '+win.title} title="Close app" onclick={onclose}>×</button></div>
 </div>
 <div class="window-content">
  {#if win.mode==='native'}
   {#if safeUrl&&win.external}<div class="external-native"><p class="embedding-note">Direct from this device · embedding may be blocked. <a href={safeUrl} target="_blank" rel="noopener noreferrer">Open in new tab</a></p><iframe bind:this={frame} src={safeUrl} title={win.title} sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"></iframe></div>
   {:else if safeUrl}<iframe bind:this={frame} src={safeUrl} title={win.title} onload={nativeLoaded}></iframe>{#if nativeState!=='ready'}<div class="native-notice" role="status">{nativeState==='loading'?'Loading native app…':'Native app unavailable — use reload to retry.'}</div>{/if}{:else}<div class="surface-message">Unregistered native app URL. Content was not loaded.</div>{/if}
  {:else}<StreamSurface {win} onactivate={onfocus}/>{/if}
 </div>
 {#if !narrow&&!restore}<button class="resize-handle" aria-label={'Resize '+win.title} onpointerdown={e=>begin(e,'resize')} onpointermove={move} onpointerup={()=>gesture=null} onpointercancel={()=>gesture=null}></button>{/if}
</section>
