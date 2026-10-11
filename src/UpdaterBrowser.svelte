<script>
 import {onMount} from 'svelte';
 import {launchUpdater,updaterTarget} from './updater.js';
 import {phases,activeJob,transfer,formatTime} from '../updater/ui/src/state.js';
 import '../updater/ui/src/surface.css';
 let {api,motion=false,visible=true,onactivate,onmaintenance}=$props();
 let snapshot=$state(null),selected=$state(''),error=$state(''),fresh=$state(false),busy=$state(false),launching=$state(false);
 let host,renderer=$state(null),fallback=$state(true),alive=false,timer;
 let release=$derived(snapshot?.available.find(r=>r.version===selected));
 let eligible=$derived(fresh&&release?.verified&&selected!==snapshot?.currentVersion&&snapshot?.canInstall&&snapshot.mode!=='observe'&&!activeJob(snapshot.job)&&!['rollback-failed','interrupted'].includes(snapshot.job?.phase));
 let progress=$derived(transfer(snapshot?.job));
 let filled=$derived(progress.ratio===null?0:Math.floor(progress.ratio*40));
 $effect(()=>renderer?.update(snapshot?.job,motion&&visible&&fresh));
 async function read(check=false){
  if(busy||!alive)return;busy=true;clearTimeout(timer);
  try{const next=await api('/updater/'+(check?'check':'state'),check?'POST':'GET',check?{}:undefined);if(!alive)return;snapshot=next;fresh=true;error='';if(!next.available.some(r=>r.version===selected))selected=next.available[0]?.version||'';}
  catch(e){if(alive){fresh=false;error=e.message;}}
  finally{if(alive){busy=false;timer=setTimeout(()=>read(),2000);}}
 }
 async function start(){
  if(!eligible||launching)return;const version=selected;launching=true;error='';
  try{if(onmaintenance){const {url}=await api('/updater/launch','POST',{});if(!alive)throw Error('Updater launch expired.');onmaintenance(updaterTarget(url,location.origin,version));}else await launchUpdater(()=>api('/updater/launch','POST',{}),()=>alive,window,version);}
  catch(e){if(alive)error=e.message;}finally{if(alive)launching=false;}
 }
 onMount(()=>{alive=true;void read(true);void import('../updater/ui/src/chamber.js').then(({createChamber})=>{if(!alive)return;try{renderer=createChamber(host,()=>{renderer=null;fallback=true;});fallback=false;}catch{fallback=true;}});return()=>{alive=false;clearTimeout(timer);renderer?.dispose();};});
</script>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="updater-browser relay-terminal" aria-label="Updater browser" onpointerdown={onactivate} onfocusin={onactivate}>
 <header><h1 class="brand">Relay updater</h1><span class="badge">{snapshot?.mode==='fixture'?'FIXTURE SANDBOX':snapshot?.mode==='observe'?'OBSERVE / READ ONLY':snapshot?.mode==='production'?'PRODUCTION':'CONNECTING'}</span></header>
 <div class="observation">RELAY / SYSTEM / UPDATER <span>{fresh?'CONNECTED':'UNAVAILABLE / LAST KNOWN STATE'}</span></div>
 {#if error}<p role="alert">{error}</p>{/if}
 <div class="columns">
  <div class="transfer"><div class="section-line">01 / TRANSFER <span>{fallback?'STATIC VIEW':'WEBGL / BYTE-DRIVEN'}</span></div>
   <div class="chamber" bind:this={host} aria-hidden="true">{#if fallback}<div class="static-view">. : + * # / @<br>3D view unavailable. Live status remains available.</div>{/if}<span class="coordinate north">90 +</span><span class="coordinate south">270 +</span><span class="coordinate west">180 +</span><span class="coordinate east">+ 0</span></div>
   <p class="fine">Shaded 3D character field. Moving particles illustrate activity, not transfer speed.</p>
  </div>
  <aside class="release"><div class="section-line">SYSTEM EVENTS <button class="text-button" disabled={busy} onclick={()=>read(true)}>Check releases</button></div>
   <section class="ledger"><details open><summary>Current job details</summary><ol>{#each snapshot?.job?.events||[] as event}<li>{formatTime(event.at)} / {event.phase||''} — {event.message||''}</li>{/each}</ol></details><details><summary>Update history</summary><ol>{#each snapshot?.history||[] as entry}<li>{entry.version||'Unknown version'} / {entry.outcome||entry.phase||'Unknown outcome'}</li>{/each}</ol></details></section>
   <div class="percentage">{progress.ratio===null?'—':Math.floor(progress.ratio*100)}{#if progress.ratio!==null}<span class="percent-symbol">%</span><small>{' of artifact'}</small>{/if}</div>
   <div class="telemetry"><h2>{snapshot?(phases[snapshot.job?.phase||'idle']?.[0]||'Unknown phase'):'Status unavailable'}</h2></div><p class="muted">{snapshot?phases[snapshot.job?.phase||'idle']?.[1]:'Waiting for a broker observation. No operational status is assumed.'}</p>
   <p class="bytes">{snapshot?.job?`${progress.bytes.toLocaleString()} / ${progress.total?.toLocaleString()||'unknown'} bytes`:snapshot?'No transfer':'No transfer data'}</p>
   <div class="progress" role="progressbar" aria-label="Artifact download" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.ratio===null?undefined:Math.floor(progress.ratio*100)} aria-valuetext={snapshot?.job?`${progress.bytes} / ${progress.total||'unknown'} bytes`:'No transfer'}><span class="progress-fill" aria-hidden="true">{'█'.repeat(filled)+'░'.repeat(40-filled)}</span></div>
   <dl class="installed"><dt>INSTALLED</dt><dd>{snapshot?.currentVersion||'Unknown'}</dd></dl>
   <label class="eyebrow" for="desktop-release">Available release</label><select id="desktop-release" bind:value={selected} disabled={!fresh}>{#each snapshot?.available||[] as r}<option value={r.version}>{r.version}</option>{/each}</select>
   <p class="muted">{release?`${release.verified?'Verified release':'Not verified'} · ${release.size.toLocaleString()} bytes`:'No release available'}</p>
   <h2 class="small-heading">Release notes</h2><pre data-testid="release-notes">{release?.notes||'No release notes available.'}</pre>
   <p class="fine">{selected&&selected===snapshot?.currentVersion?'This release is already installed.':snapshot?.reason||'Review the selected release in the independent embedded console. No installation starts here.'}</p>
   <button class="start" disabled={!eligible||launching} onclick={start}>Start update</button>
   <p class="fine">Final consent and your current password are required in this Relay window. Independent monitoring stays mounted when Relay restarts.</p>
  </aside>
 </div>
 <footer><span>Relay updater · {snapshot?.currentVersion||'—'}</span><span>READ-ONLY BROWSER</span></footer>
</section>
<style>
 .updater-browser :global(.ledger){min-height:0;padding:6px 0}.updater-browser :global(.ledger ol){max-height:64px}.updater-browser :global(.bytes){font-size:14px}
 .updater-browser{height:100%;overflow:auto;padding:0 12px;box-sizing:border-box}.observation{display:flex;justify-content:space-between;gap:8px;font-size:10px;letter-spacing:1px;color:var(--muted);min-height:28px;align-items:center}.columns{height:calc(100% - 122px);min-height:0}.updater-browser :global(.chamber){min-height:0}.updater-browser :global(footer){position:static;inset:auto;width:auto;height:42px;min-height:42px;background:transparent;padding:0;border:0;z-index:auto}.transfer .fine{font-size:10px;margin:0 0 8px}@container(max-width:700px){.columns{height:auto}.updater-browser :global(.chamber){min-height:380px}}
</style>
