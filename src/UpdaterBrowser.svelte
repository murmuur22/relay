<script>
 import {onMount} from 'svelte';
 import {launchUpdater,updaterTarget} from './updater.js';
 import {phases,transfer,formatTime,stagedEligible,stagedSupported} from '../updater/ui/src/state.js';
 import '../updater/ui/src/workspace.css';
 let {api,motion=false,visible=true,onactivate,onmaintenance}=$props();
 let snapshot=$state(null),selected=$state(''),error=$state(''),fresh=$state(false),busy=$state(false),launching=$state(false);
 let host,renderer=$state(null),fallback=$state(true),alive=false,timer;
 let release=$derived(snapshot?.available.find(r=>r.version===selected));
 let ready=$derived(snapshot?.job?.kind==='prepare'&&snapshot.job.phase==='ready');
 let eligible=$derived(stagedEligible({state:snapshot,fresh,authenticated:true,selected,action:'prepare'})||stagedEligible({state:snapshot,fresh,authenticated:true,selected,action:'apply',version:snapshot?.job?.version}));
 let progress=$derived(transfer(snapshot?.job));
 let filled=$derived(progress.ratio===null?0:Math.floor(progress.ratio*40));
 let reason=$derived(selected&&!release&&snapshot?`Selected release ${selected} is unavailable. Choose a release explicitly.`:selected&&selected===snapshot?.currentVersion?'This release is already installed.':snapshot&&!stagedSupported(snapshot)?'Staged updates unsupported by this control plane. A separately qualified control-plane upgrade is required.':ready?`Ready: ${snapshot.job.version}. Relay is still running. Open the independent console to review Apply.`:snapshot?.reason||'Review and authorize Download & prepare in the independent console. No change starts here.');
 $effect(()=>renderer?.update(snapshot?.job,motion&&visible&&fresh));
 async function read(check=false){
  if(busy||!alive)return;busy=true;clearTimeout(timer);
  try{const next=await api('/updater/'+(check?'check':'state'),check?'POST':'GET',check?{}:undefined);if(!alive)return;snapshot=next;fresh=true;error='';if(!selected)selected=next.available[0]?.version||'';}
  catch(e){if(alive){fresh=false;error=e.message;}}
  finally{if(alive){busy=false;timer=setTimeout(()=>read(),2000);}}
 }
 async function start(){
  if(!eligible||launching)return;const version=ready?snapshot.job.version:selected;launching=true;error='';
  try{if(onmaintenance){const {url}=await api('/updater/launch','POST',{});if(!alive)throw Error('Updater launch expired.');onmaintenance(updaterTarget(url,location.origin,version));}else await launchUpdater(()=>api('/updater/launch','POST',{}),()=>alive,window,version);}
  catch(e){if(alive)error=e.message;}finally{if(alive)launching=false;}
 }
 onMount(()=>{alive=true;void read(true);void import('../updater/ui/src/chamber.js').then(({createChamber})=>{if(!alive)return;try{renderer=createChamber(host,()=>{renderer=null;fallback=true;});fallback=false;}catch{fallback=true;}});return()=>{alive=false;clearTimeout(timer);renderer?.dispose();};});
</script>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="updater-browser relay-terminal release-workspace" aria-label="Updater browser" onpointerdown={onactivate} onfocusin={onactivate}>
 <header><h1 class="brand">Relay updater</h1><nav aria-label="Updater surfaces"><span aria-current="page">OPERATE</span><a href="#desktop-updater-monitor">MONITOR</a></nav><span class="badge">{snapshot?.mode==='fixture'?'FIXTURE SANDBOX':snapshot?.mode==='observe'?'OBSERVE / READ ONLY':snapshot?.mode==='production'?'PRODUCTION':'CONNECTING'}</span></header>
 <div class="connection-line"><span>{fresh?'CONNECTED':'UNAVAILABLE / LAST KNOWN STATE'}</span><span>READ-ONLY RELEASE BROWSER</span></div>
 {#if error}<p role="alert">{error}</p>{/if}
 <div class="release-panes">
  <aside class="release-list" aria-label="Release selection"><div class="list-title eyebrow">RELEASES <button class="text-button" disabled={busy} onclick={()=>read(true)}>Check releases</button></div>
   <div class="release-buttons">{#each snapshot?.available||[] as r (r.version)}<button class="release-button" aria-pressed={selected===r.version} onclick={()=>selected=r.version}>{r.version}<br>{r.version===snapshot.currentVersion?'Installed':r.verified?'Verified release':'Not verified'}</button>{/each}</div>
   <label class="eyebrow" for="desktop-release">Available release</label><select id="desktop-release" bind:value={selected} disabled={!fresh}>{#each snapshot?.available||[] as r (r.version)}<option value={r.version}>{r.version}</option>{/each}{#if selected&&!release}<option value={selected}>{selected} — unavailable</option>{/if}</select>
   <dl class="installed"><dt>INSTALLED</dt><dd>{snapshot?.currentVersion||'Unknown'}</dd></dl><p class="list-foot">Selecting a release does not authorize a change.<br><br>Official publisher and compatibility policy remain unchanged.</p>
  </aside>
  <main class="release-detail" aria-label="Release details"><div class="detail-content">
   <div class="detail-top"><div><p class="eyebrow">OPERATE / SELECTED RELEASE</p><h1>{selected?`Release ${selected}`:'Release details'}</h1><p class="muted">{release?`${release.verified?'Verified release':'Not verified'} · ${Number.isSafeInteger(release.size)?release.size.toLocaleString()+' bytes':'Size unavailable'}`:'No published release available.'}</p></div><span class="eyebrow">REVIEW BEFORE CHANGE</span></div>
   <section class="changes"><h2 class="small-heading">Release notes</h2><pre data-testid="release-notes">{release?.notes||'No release notes available.'}</pre></section>
   <section id="desktop-updater-monitor" class="monitor" aria-label="Update monitor"><div class="section-line">MONITOR / BROKER OBSERVATION <span>{fallback?'STATIC VIEW':'WEBGL / BYTE-DRIVEN'}</span></div>
    <div class="monitor-grid"><div><div class="telemetry"><h2>{snapshot?(phases[snapshot.job?.phase||'idle']?.[0]||'Unknown phase'):'Status unavailable'}</h2></div><p class="muted">{snapshot?phases[snapshot.job?.phase||'idle']?.[1]:'Waiting for a broker observation. No operational status is assumed.'}</p>
     <div class="percentage">{progress.ratio===null?'—':Math.floor(progress.ratio*100)}{#if progress.ratio!==null}<span class="percent-symbol">%</span><small>{' of artifact'}</small>{/if}</div><p class="bytes">{snapshot?.job?`${progress.bytes.toLocaleString()} / ${progress.total?.toLocaleString()||'unknown'} bytes`:snapshot?'No transfer':'No transfer data'}</p>
     <div class="progress" role="progressbar" aria-label="Artifact download" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.ratio===null?undefined:Math.floor(progress.ratio*100)} aria-valuetext={snapshot?.job?`${progress.bytes} / ${progress.total||'unknown'} bytes`:'No transfer'}><span class="progress-fill" aria-hidden="true">{'█'.repeat(filled)+'░'.repeat(40-filled)}</span></div>
    </div><div class="transfer"><div class="chamber" bind:this={host} aria-hidden="true">{#if fallback}<div class="static-view">. : + * # / @<br>3D view unavailable. Live status remains available.</div>{/if}</div><p class="fine">Particles illustrate activity, not transfer speed.</p></div></div>
    <section class="ledger"><details open><summary>Current job details</summary><ol>{#each snapshot?.job?.events||[] as event}<li>{formatTime(event.at)} / {event.phase||''} — {event.message||''}</li>{/each}</ol></details><details><summary>Update history</summary><ol>{#each snapshot?.history||[] as entry}<li>{entry.version||'Unknown version'} / {entry.outcome||entry.phase||'Unknown outcome'}</li>{/each}</ol></details></section>
   </section>
  </div></main>
 </div>
 <div class="action-rail"><p class="rail-note">{reason}</p><div class="rail-actions"><button class="start primary" disabled={!eligible||launching} onclick={start}>Start update</button></div></div>
 <footer><span>Relay updater · {snapshot?.currentVersion||'—'}</span><span>READ-ONLY BROWSER</span></footer>
</section>
