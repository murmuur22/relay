<script>
 import {tick,onDestroy} from 'svelte';
 import Icon from './Icon.svelte';
 import {webAddress,nativeAddress,origins,checkDevice,statusLabel,statusDetail} from './webapps.js';
 let {draft,users,api,onsave,oncancel,onbusy}= $props();
 let error=$state(''),busy=$state(false),relay=$state(null),device=$state(null),image=$state(''),nativePreview=$state(''),heading;
 let cancellable=$state(false),controller,generation=0;
 onDestroy(()=>{generation++;controller?.abort();});
 const steps=['Browser location','Name & address','Options & connection','Access','Review app'];
 function payload(){return {kind:'web',mode:draft.mode,label:draft.label.trim(),address:draft.mode==='native'?nativeAddress(draft.address.trim(),window.location.origin):webAddress(draft.address.trim()),icon:draft.icon,openMode:draft.openMode,allowedOrigins:origins(draft.originText),userIds:[...draft.userIds]};}
 async function go(step){error='';try{if(step>2){if(!draft.label.trim())throw Error('Enter an app name.');payload();}draft.step=step;image='';nativePreview='';relay=null;device=null;await tick();heading?.focus();}catch(e){error=e.message;}}
 async function action(fn,canCancel=true){if(busy)return;const run=++generation;controller=new AbortController();busy=true;cancellable=canCancel;onbusy(true);error='';try{await fn(controller.signal);}catch(e){if(run===generation&&e.name!=='AbortError')error=e.message;}finally{if(run===generation){busy=false;cancellable=false;controller=null;onbusy(false);}}}
 function cancel(){if(busy&&!cancellable)return;generation++;controller?.abort();controller=null;busy=false;cancellable=false;onbusy(false);oncancel();}
 async function test(){await action(async(signal)=>{const data=payload();relay=null;device=null;const results=await Promise.allSettled([api('/admin/apps/check','POST',data,{signal}),...(draft.mode==='native'?[checkDevice(data.address,signal)]:[])]);if(signal.aborted)return;if(results[0].status==='fulfilled')relay=results[0].value;else error=results[0].reason.message;if(results[1]?.status==='fulfilled')device=results[1].value;});}
 async function preview(){await action(async(signal)=>{const data=payload();image='';nativePreview='';if(draft.mode==='native')nativePreview=data.address;else{const result=await api('/admin/apps/preview','POST',data,{signal});if(signal.aborted)return;if(!/^data:image\/jpeg;base64,/.test(result.image))throw Error('Preview returned no valid JPEG image.');image=result.image;}});}
</script>
<section class="app-wizard" aria-label="Add app wizard">
 <p class="muted">Step {draft.step} of 5</p><h2 tabindex="-1" bind:this={heading}>{steps[draft.step-1]}</h2>
 {#if error}<p role="alert">{error}</p>{/if}
 <form onsubmit={e=>{e.preventDefault();draft.step===5?action(()=>onsave(payload()),false):go(draft.step+1);}}>
 <fieldset disabled={busy} class="form-grid"><legend class="sr-only">{steps[draft.step-1]}</legend>
 {#if draft.step===1}
  <label class="check"><input type="radio" bind:group={draft.mode} value="native"/>Native</label><label class="check"><input type="radio" bind:group={draft.mode} value="stream"/>Streamed</label>
  <p class="full-width muted">Native runs in your device's browser and connects directly to the app. Streamed runs in an isolated, ephemeral browser on Relay. Each login has its own cookies; login storage is not shared or permanent.</p>
 {:else if draft.step===2}
  <label>App name<input bind:value={draft.label} required maxlength="64"/></label>
  <label>Address<input bind:value={draft.address} required placeholder="https://app.example" autocomplete="off"/></label>
  <p class="full-width muted">Enter an explicit http:// or https:// address. For a bare IP, choose the protocol yourself. No URL credentials or fragments.</p>
  <label>Icon<select bind:value={draft.icon}>{#each ['globe','folder','notes','media','terminal'] as icon}<option value={icon}>{icon}</option>{/each}</select></label><div class="icon-preview"><Icon name={draft.icon}/></div>
 {:else if draft.step===3}
  {#if draft.mode==='native'}
   <label class="check"><input type="radio" bind:group={draft.openMode} value="window"/>Desktop window</label><label class="check"><input type="radio" bind:group={draft.openMode} value="tab"/>New tab</label>
   <p class="full-width muted">Your device must reach this address. Use a different hostname from Relay; cookies are shared across ports. Sites can refuse embedding with X-Frame-Options or CSP frame-ancestors. The iframe sandbox, mixed-content and privacy restrictions can also block sign-in or leave a blank preview; Relay does not bypass these protections. Choose New tab above for the site's normal browser experience. Relay cannot control cross-origin iframe Back/Forward history. Permissions control this launcher, not the upstream site; a loaded iframe is not proof of health.</p>
  {:else}
   <label class="full-width">Additional approved origins<textarea bind:value={draft.originText} rows="3" placeholder="https://assets.example (one origin per line)"></textarea></label>
   <p class="full-width muted">The initial origin is approved automatically. Other origins require explicit approval. Redirects and assets outside this list are blocked. WebSockets, file pickers and download bridges are unsupported. Some websites will not work; this is not a general-purpose browser.</p>
  {/if}
  <div class="full-width"><button type="button" onclick={test}>Test connection</button><button type="button" onclick={preview}>Preview</button></div>
  {#if relay}<p class="full-width" role="status" title={statusDetail(relay)}>{statusLabel(relay)}<small class="observation">{statusDetail(relay)}</small></p>{/if}
  {#if device}<p class="full-width" role="status">{statusLabel(device)}<small class="observation">{statusDetail(device)}</small></p>{/if}
  {#if nativePreview}<div class="full-width"><iframe class="app-preview" src={nativePreview} title="Native preview" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"></iframe><a href={nativePreview} target="_blank" rel="noopener noreferrer">Open preview in new tab</a><p class="muted">A blank preview may mean embedding is blocked, not that the app is offline.</p></div>{/if}
  {#if image}<img class="app-preview full-width" src={image} alt="Streamed preview"/>{/if}
 {:else if draft.step===4}
  <p class="full-width muted">Admins can access all enabled apps. Choose active users to grant access at save time.</p>
  {#each users.filter(u=>u.role!=='admin'&&!u.disabled) as u}<label class="check"><input type="checkbox" bind:group={draft.userIds} value={u.id}/>Allow {u.username}</label>{/each}
  {#if !users.some(u=>u.role!=='admin'&&!u.disabled)}<p class="full-width">No active non-admin users. You can grant access later in Users.</p>{/if}
 {:else}
  <dl class="wizard-review full-width"><dt>Name</dt><dd>{draft.label}</dd><dt>Address</dt><dd>{draft.address}</dd><dt>Browser</dt><dd>{draft.mode==='stream'?'Streamed · isolated ephemeral browser':'Native · '+(draft.openMode==='tab'?'new tab':'desktop window')}</dd><dt>Icon</dt><dd>{draft.icon}</dd><dt>Additional origins</dt><dd>{draft.originText||'None'}</dd><dt>Access</dt><dd>Admins{#each users.filter(u=>draft.userIds.includes(u.id)) as u}, {u.username}{/each}</dd></dl>
  <p class="full-width muted">Saving registers the app; it does not install or change the upstream site. Connection checks describe only the place and time checked.</p>
 {/if}
 <div class="full-width wizard-actions">{#if draft.step>1}<button type="button" onclick={()=>go(draft.step-1)}>Back</button>{/if}<button>{draft.step===5?'Save app':'Next'}</button>{#if busy}<span role="status">Working…</span>{/if}</div>
 </fieldset><button type="button" disabled={busy&&!cancellable} onclick={cancel}>Cancel</button></form>
</section>
