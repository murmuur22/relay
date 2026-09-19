<script>
 import {onMount} from 'svelte';
 import {launchUpdater} from './updater.js';
 import {phases,activeJob,transfer} from '../updater/ui/src/state.js';
 let {api,motion=false,visible=true,onactivate}=$props();
 let snapshot=$state(null),selected=$state(''),error=$state(''),fresh=$state(false),busy=$state(false),launching=$state(false);
 let host,renderer=$state(null),fallback=$state(true),alive=false,timer;
 let release=$derived(snapshot?.available.find(r=>r.version===selected));
 let eligible=$derived(fresh&&release?.verified&&selected!==snapshot?.currentVersion&&snapshot?.canInstall&&snapshot.mode!=='observe'&&!activeJob(snapshot.job)&&!['rollback-failed','interrupted'].includes(snapshot.job?.phase));
 let progress=$derived(transfer(snapshot?.job));
 $effect(()=>renderer?.update(snapshot?.job,motion&&visible&&fresh));
 async function read(check=false){
  if(busy||!alive)return;busy=true;clearTimeout(timer);
  try{const next=await api('/updater/'+(check?'check':'state'),check?'POST':'GET',check?{}:undefined);if(!alive)return;snapshot=next;fresh=true;error='';if(!next.available.some(r=>r.version===selected))selected=next.available[0]?.version||'';}
  catch(e){if(alive){fresh=false;error=e.message;}}
  finally{if(alive){busy=false;timer=setTimeout(()=>read(),2000);}}
 }
 async function start(){
  if(!eligible||launching)return;const version=selected;launching=true;error='';
  try{await launchUpdater(()=>api('/updater/launch','POST',{}),()=>alive,window,version);}
  catch(e){if(alive)error=e.message;}finally{if(alive)launching=false;}
 }
 onMount(()=>{alive=true;void read(true);void import('../updater/ui/src/chamber.js').then(({createChamber})=>{if(!alive)return;try{renderer=createChamber(host,()=>{renderer=null;fallback=true;});fallback=false;}catch{fallback=true;}});return()=>{alive=false;clearTimeout(timer);renderer?.dispose();};});
</script>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="updater-browser" aria-label="Updater browser" onpointerdown={onactivate} onfocusin={onactivate}>
 <header><div><p class="eyebrow">RELAY / SYSTEM / UPDATER</p><h1>Transfer chamber</h1></div><span class="badge">{snapshot?.mode==='fixture'?'FIXTURE SANDBOX':snapshot?.mode==='observe'?'OBSERVE / READ ONLY':snapshot?.mode==='production'?'PRODUCTION':'CONNECTING'}</span></header>
 {#if error}<p role="alert">{error}</p>{/if}
 <div class="columns">
  <div class="transfer"><div class="section-line">01 / TRANSFER <span>{fallback?'STATIC VIEW':'WEBGL / BYTE-DRIVEN'}</span></div>
   <div class="chamber" bind:this={host} aria-hidden="true">{#if fallback}<svg viewBox="0 0 600 370"><g fill="none" stroke="currentColor"><ellipse cx="300" cy="291" rx="156" ry="34" opacity=".2"/><path d="M300 73 405 134 405 255 300 316 195 255 195 134Z M195 134 300 195 405 134 M300 195V316 M300 73V195 M195 255 300 195 405 255"/></g></svg>{/if}</div>
   <p class="eyebrow">BROKER PHASE · {fresh?'CONNECTED':'UNAVAILABLE / LAST KNOWN STATE'}</p>
   <h2>{snapshot?(phases[snapshot.job?.phase||'idle']?.[0]||'Unknown phase'):'Status unavailable'}</h2><p>{snapshot?phases[snapshot.job?.phase||'idle']?.[1]:'Waiting for a broker observation. No operational status is assumed.'}</p>
   <p class="bytes">{snapshot?.job?`${progress.bytes.toLocaleString()} / ${progress.total?.toLocaleString()||'unknown'} bytes`:snapshot?'No transfer':'No transfer data'}</p>
   <p class="fine">Assembly follows real received bytes. Moving trails are decorative, not transfer speed.</p>
  </div>
  <aside><div class="section-line">02 / RELEASE <button disabled={busy} onclick={()=>read(true)}>Check releases</button></div>
   <p class="eyebrow">INSTALLED</p><p class="installed">{snapshot?.currentVersion||'Unknown'}</p>
   <label for="desktop-release">Available release</label><select id="desktop-release" bind:value={selected} disabled={!fresh}>{#each snapshot?.available||[] as r}<option value={r.version}>{r.version}</option>{/each}</select>
   <p>{release?`${release.verified?'Verified release':'Not verified'} · ${release.size.toLocaleString()} bytes`:'No release available'}</p>
   <h2>Release notes</h2><pre data-testid="release-notes">{release?.notes||'No release notes available.'}</pre>
   <p class="fine">{selected&&selected===snapshot?.currentVersion?'This release is already installed.':snapshot?.reason||'Review the selected release in an independent tab. No installation starts here.'}</p>
   <button class="start" disabled={!eligible||launching} onclick={start}>Start update</button>
   <p class="fine">Final consent and your current password are required there. That tab stays open when Relay restarts.</p>
  </aside>
 </div>
</section>
<style>
 .updater-browser{container-type:inline-size;height:100%;overflow:auto;background:#111110;color:#e7e5df;padding:20px;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:12px}header{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:18px}h1{font-size:25px;font-weight:400;margin:6px 0}h2{font-weight:400;font-size:18px;margin:8px 0}p{line-height:1.6}.eyebrow,.fine{font-size:10px;color:#a8a29e}.badge{font-size:10px;border:1px solid #57534e;padding:7px;white-space:nowrap}.columns{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(220px,1fr);border:1px solid #44403c}.transfer,aside{padding:16px;min-width:0}aside{border-left:1px solid #44403c}.section-line{display:flex;justify-content:space-between;gap:10px;color:#a8a29e;font-size:10px;align-items:center}.chamber{height:230px;position:relative}.chamber svg{width:100%;height:100%}.chamber :global(canvas){display:block;position:absolute;inset:0}.installed{font-size:22px}label{display:block;font-size:11px;margin:14px 0 8px}select{width:100%;background:#1c1917;color:#fafaf9;border:1px solid #78716c;padding:9px;font:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto;font:inherit;line-height:1.6;color:#d6d3d1}button{border:1px solid #78716c;padding:7px;color:inherit;font:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}.start{width:100%;background:#e7e5df;color:#111110;padding:12px}button:focus-visible,select:focus-visible{outline:2px solid #fafaf9;outline-offset:2px}[role=alert]{border:1px solid #a8a29e;padding:10px}.bytes{font-variant-numeric:tabular-nums}@container(max-width:640px){.columns{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid #44403c}header{flex-wrap:wrap}}
</style>
