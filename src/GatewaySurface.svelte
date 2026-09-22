<script>
 import {onMount} from 'svelte';
 import {validateGatewayHandoff} from './gateway-handoff.js';
 let {appId,title,api,onactivate}=$props();
 let target=$state(null),frame=$state(),message=$state('Opening app…'),ending=$state(false),ended=$state(false);
 let generation=0,launchId=null,ticket=null,request,disposed=false;
 const identity=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 async function start(){
  if(disposed||ending)return;const run=++generation;launchId=identity();const id=launchId;ticket=null;target=null;ended=false;message='Opening app…';
  try{
   const config=await request('/gateway/config');
   if(disposed||run!==generation)return;
   if(!config.enabled||location.protocol!=='https:'||location.origin!==config.desktopOrigin)throw Error('Open the administrator-configured HTTPS desktop to use Gateway apps.');
   const result=await request('/gateway/launch','POST',{appId,launchId:id});
   if(disposed||run!==generation)return;
   const validated=validateGatewayHandoff(result,config,location.origin,id);
   ticket=validated.ticket;target={origin:validated.origin,allowDownloads:validated.allowDownloads,allowPopups:validated.allowPopups};message='';
  }catch(e){if(run===generation&&!disposed){target=null;ticket=null;message=e.message;ended=true;}}
 }
 export async function end(){
  const id=launchId;launchId=null;generation++;ticket=null;target=null;ended=true;message='App session ended. Reopening uses a fresh origin and login.';
  if(!id||!request)return;ending=true;
  try{await request('/gateway/end','POST',{appId,launchId:id});}
  catch(e){if(!disposed)message='Content removed. Could not confirm server session cleanup: '+e.message;}
  finally{ending=false;}
 }
 export async function restart(){await end();if(!disposed)await start();}
 onMount(()=>{
  // Capture the epoch-bound API, never acquire a later account's credentials on cleanup.
  request=api;
  const receive=event=>{if(!target||!frame||event.source!==frame.contentWindow||event.origin!==target.origin||event.data?.type!=='relay-gateway-ready'||!ticket)return;const value=ticket;ticket=null;frame.contentWindow.postMessage({type:'relay-gateway-ticket',ticket:value},target.origin);};
  const focus=()=>{if(document.activeElement===frame)onactivate();};
  window.addEventListener('message',receive);window.addEventListener('blur',focus);void start();
  return()=>{disposed=true;window.removeEventListener('message',receive);window.removeEventListener('blur',focus);void end();};
 });
</script>
<div class="gateway-surface">
 <div class="gateway-controls"><button onclick={end} disabled={ending||ended}>End app session</button>{#if ended}<button onclick={start} disabled={ending}>Reopen app</button>{/if}<span>Experimental · Close ends the session; minimize preserves it. The app's own Logout may not clear gateway identity.</span></div>
 {#if message}<p role="status">{message}</p>{/if}
 {#if target}<iframe bind:this={frame} src={target.origin+'/.relay/bootstrap'} {title} sandbox={'allow-scripts allow-same-origin allow-forms'+(target.allowDownloads?' allow-downloads':'')+(target.allowPopups?' allow-popups':'')} allow="autoplay; fullscreen" referrerpolicy="no-referrer"></iframe>{/if}
</div>
<style>
 .gateway-surface{height:100%;display:flex;flex-direction:column;min-height:0;background:#1c1917;color:#e7e5e4}.gateway-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #57534e;font-size:11px}.gateway-controls span{flex:1;min-width:180px}.gateway-controls button{border:1px solid #a8a29e;padding:5px 8px;color:inherit;background:transparent}.gateway-controls button:focus-visible{outline:1px dashed #fafaf9;outline-offset:2px}p{padding:12px}iframe{flex:1;min-height:0;width:100%;border:0;background:#fff}
</style>
