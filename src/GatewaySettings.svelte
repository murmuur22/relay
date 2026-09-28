<script>
 import {onMount,tick} from 'svelte';
 import {gatewayForm,configFromForm,targetForm} from './gateway-settings.js';
 let {api,onrefresh=async()=>{},onaddapp}= $props();
 let status=$state(null),form=$state(gatewayForm()),busy=$state(false),error=$state(''),message=$state(''),validated=$state(''),confirmation=$state(''),password=$state(''),acknowledged=$state(false),stale=$state(true);
 let alive=true,generation=0;
 let draft=$derived.by(()=>{try{return configFromForm(form);}catch{return null;}});
 let draftKey=$derived(draft?JSON.stringify(draft):'');
 let operator=$derived(status?.source==='operator');
 let entry=$derived.by(()=>{try{const u=new URL(status?.desktopOrigin);return u.protocol==='https:'&&u.origin===status.desktopOrigin?u.origin:null;}catch{return null;}});
 function changed(){validated='';confirmation='';password='';acknowledged=false;message='';}
 async function load(){
  const run=++generation;busy=true;error='';stale=true;confirmation='';password='';
  try{const next=await api('/admin/gateway');if(!alive||run!==generation)return;status=next;form=gatewayForm(next.config);validated='';acknowledged=false;stale=false;}
  catch(e){if(alive&&run===generation)error=e.message;}
  finally{if(alive&&run===generation)busy=false;}
 }
 async function check(){
  changed();busy=true;error='';
  try{const config=configFromForm(form),key=JSON.stringify(config);const result=await api('/admin/gateway/validate','POST',{config});if(!alive)return;if(result.valid!==true)throw Error('The server did not confirm this configuration.');if(key===draftKey){validated=key;message='Server configuration valid. DNS and browser trust still need checking.';}}
  catch(e){if(alive)error=e.message;}
  finally{if(alive)busy=false;}
 }
 let passwordInput=$state();
 async function confirm(action){if(busy||stale||operator)return;if(action==='apply'&&(!validated||validated!==draftKey))return;confirmation=action;password='';error='';acknowledged=false;await tick();if(alive)passwordInput?.focus();}
 async function submit(event){
  event.preventDefault();if(busy||stale||operator||!confirmation||!password)return;
  const action=confirmation;if(action==='apply'&&(!acknowledged||validated!==draftKey||!draft))return;
  const body=action==='apply'?{config:structuredClone(draft),password}:{password};
  password='';busy=true;error='';
  try{
   await api('/admin/gateway',action==='apply'?'PUT':'DELETE',body);body.password='';
   if(!alive)return;confirmation='';await load();if(!alive)return;
   message=action==='apply'?'Gateway settings applied. Return to Add app to choose a target. Open apps from the HTTPS desktop.':'Gateway disabled. Registered apps and accounts were kept.';
   await onrefresh();
  }catch(e){body.password='';if(alive){error=e.message;confirmation='';stale=true;message='Refresh gateway status before trying again.';}}
  finally{body.password='';if(alive)busy=false;}
 }
 function addTarget(preset){changed();const t=targetForm(preset);let suffix=2;const base=t.id;while(form.targets.some(v=>v.id===t.id))t.id=base+'-'+suffix++;form.targets.push(t);}
 onMount(()=>{void load();return()=>{alive=false;generation++;password='';};});
</script>
<section class="gateway-settings" aria-label="Gateway settings">
 <header class="gateway-heading"><div><h2>Gateway</h2><p>Bring a service into Relay without sending visitors to its private address.</p></div><button onclick={load} disabled={busy}>Refresh gateway status</button></header>
 {#if error}<p class="notice" role="alert">{error}</p>{/if}
 {#if message}<p class="notice" role="status">{message}</p>{/if}
 {#if !status}<p>Reading gateway status…</p>{:else}
  <div class="status-card"><strong>{status.enabled?'Gateway listener is running':'Gateway is off'}</strong><p>{status.enabled?'The server is listening. This does not prove that visitors can resolve its names or trust its certificate.':'You can prepare and check the settings below before enabling it.'}</p>
   {#if entry}<a href={entry} target="_blank" rel="noopener noreferrer">Open HTTPS desktop</a><p class="small">Sign in again there to open Gateway apps. Keep your existing private desktop address for Updater.</p>{/if}
   {#if onaddapp&&status.enabled}<button onclick={onaddapp} disabled={busy||stale}>Add a gateway app</button>{/if}
  </div>
  <details class="explanation"><summary>What am I setting up?</summary><ol><li><strong>The address:</strong> visitors open Relay, not the service’s private address.</li><li><strong>HTTPS and separate app names:</strong> the browser can verify Relay and keep each app session separate.</li><li><strong>The service target:</strong> where Relay finds Jellyfin or another app.</li><li><strong>Access:</strong> add the target under Apps and choose who may open it. App login is separate from Relay login.</li></ol><p>Public HTTPS can let visitors connect without a VPN. Private LAN/VPN setups are also supported. Buying a domain is not required, but suitable names and trusted certificates must exist.</p></details>
  {#if operator}
   <h3>Managed by the server operator</h3><p>This gateway uses an operator-owned configuration file. Relay will not overwrite it. Ask the server operator to change its addresses, certificates or targets.</p>
  {:else}
   <div class="prerequisites"><h3>Before enabling</h3><p>Your server needs DNS for the desktop and wildcard app names, plus matching certificate files readable by Relay. This page does not create DNS, obtain certificates, install device trust or change firewall rules.</p><p>Enter <strong>file paths on the server</strong>, not files on your laptop. Never paste a private key into these fields. Missing certificates will fail the check without turning anything on.</p></div>
   <fieldset disabled={busy||stale} oninput={changed}>
    <legend>1. Connection</legend>
    <div class="fields"><label>Desktop hostname<input bind:value={form.desktopHostname} placeholder="desktop.example.com" maxlength="220" autocomplete="off"/></label><label>App hostname base<input bind:value={form.appBaseDomain} placeholder="apps.example.com" maxlength="220" autocomplete="off"/></label><label>Listen address<input bind:value={form.bind} placeholder="Server LAN or VPN IPv4" autocomplete="off"/></label><label>HTTPS port<input type="number" bind:value={form.port} min="1024" max="65535"/></label></div>
    <p class="small">Use sibling names such as desktop.example.com and apps.example.com. The certificate must cover the desktop name and *.apps.example.com. Defaults are private-name examples, not automatically configured DNS. 127.0.0.1 listens on the server itself only.</p>
   </fieldset>
   <fieldset disabled={busy||stale} oninput={changed}><legend>2. Existing HTTPS files</legend><div class="fields"><label>Certificate file on server<input bind:value={form.certPath} autocomplete="off" spellcheck="false"/></label><label>Private key file on server<input bind:value={form.keyPath} autocomplete="off" spellcheck="false"/></label></div><p class="small">Relay checks ownership, permissions, certificate lifetime and matching names. Client trust and DNS still need a browser check.</p></fieldset>
   <fieldset disabled={busy||stale}><legend>3. Service targets</legend>
    {#each form.targets as target,index}
     <section class="target" aria-label={'Gateway target '+(index+1)} oninput={changed}><div class="fields"><label>Target ID<input bind:value={target.id} maxlength="32" autocomplete="off"/></label><label>Target name<input bind:value={target.label} maxlength="64"/></label><label class="wide">Service address<input bind:value={target.upstream} placeholder="http://192.168.10.20:8096" autocomplete="off" spellcheck="false"/></label></div><p class="small">The address Relay’s server can reach. Use a literal IPv4 address and port, with no trailing slash or login credentials.</p><details><summary>Advanced target options</summary><label>Target options JSON<textarea bind:value={target.options} rows="9" spellcheck="false"></textarea></label><p class="small">The Jellyfin preset supplies its web entry and WebSocket/header settings. It does not supply an app login or guarantee transcoding, every codec or large-movie compatibility.</p></details><button disabled={form.targets.length===1} onclick={()=>{changed();form.targets.splice(index,1);}}>Remove target</button></section>
    {/each}
    <div class="actions"><button onclick={()=>addTarget('jellyfin')} disabled={form.targets.length>=8}>Add Jellyfin target</button><button onclick={()=>addTarget('generic')} disabled={form.targets.length>=8}>Add custom target</button></div>
   </fieldset>
   <div class="actions"><button onclick={check} disabled={busy||stale}>Check configuration</button><button onclick={()=>confirm('apply')} disabled={busy||stale||!validated||validated!==draftKey}>{status.enabled?'Apply gateway changes':'Enable gateway'}</button>{#if status.enabled}<button onclick={()=>confirm('disable')} disabled={busy||stale}>Disable gateway</button>{/if}</div>
   {#if confirmation}
    <form class="confirmation" onsubmit={submit}><h3>{confirmation==='apply'?'Confirm gateway configuration':'Confirm disabling gateway'}</h3><p>Changing the gateway ends active gateway app sessions. Accounts and registered app definitions are kept. The Relay desktop and its management address remain available.</p>
     {#if confirmation==='apply'}<label class="check"><input type="checkbox" bind:checked={acknowledged}/>I have configured DNS and HTTPS trust for the intended clients.</label>{/if}
     <label>Current password for gateway changes<input bind:this={passwordInput} type="password" bind:value={password} autocomplete="current-password" required disabled={busy}/></label>
     <div class="actions"><button type="submit" disabled={busy||!password||(confirmation==='apply'&&(!acknowledged||validated!==draftKey))}>Confirm {confirmation==='apply'?'gateway settings':'disable'}</button><button type="button" onclick={()=>{confirmation='';password='';}} disabled={busy}>Cancel</button></div>
    </form>
   {/if}
   <p class="small">After enabling: open the HTTPS desktop, then use <strong>Apps → Add app → Gateway</strong> to put a configured target on a desktop and choose access. Saving a target alone does not grant anyone access.</p>
  {/if}
 {/if}
</section>
<style>
 .gateway-settings{container-type:inline-size;min-width:0;color:#e7e5e4;padding:4px 0 16px}.gateway-heading{display:flex;gap:14px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}.gateway-heading div{flex:1;min-width:180px}h2{font-size:20px;margin:0}h3{font-size:14px;margin:0 0 8px}p{font-size:12px;line-height:1.6;margin:8px 0}button,a{font:inherit;font-size:12px}button{border:1px solid #78716c;background:#292524;color:#fafaf9;padding:7px 10px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}a{color:#fafaf9;text-underline-offset:3px}button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible,a:focus-visible{outline:1px dashed #fafaf9;outline-offset:3px}.status-card,.notice,.prerequisites,.confirmation{padding:12px;border:1px solid #57534e;margin:12px 0;background:#1c1917}.status-card strong{font-size:14px}.small{color:#a8a29e;font-size:11px}fieldset{min-width:0;border:1px solid #57534e;margin:14px 0;padding:12px}legend{font-size:13px;padding:0 6px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wide{grid-column:1/-1}label{display:flex;flex-direction:column;gap:6px;font-size:12px;min-width:0}input,textarea{box-sizing:border-box;width:100%;min-width:0;color:#fafaf9;background:#0c0a09;border:1px solid #78716c;padding:8px;font:inherit;font-size:12px}textarea{resize:vertical;font-family:monospace}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.target{border-bottom:1px solid #44403c;padding:12px 0}.target:first-of-type{padding-top:0}.target:last-of-type{border-bottom:0}details{font-size:12px;margin:10px 0}summary{cursor:pointer;padding:4px 0}ol{padding-left:20px;line-height:1.6}li{margin-bottom:8px}.check{flex-direction:row;align-items:flex-start;margin:12px 0}.check input{width:auto;accent-color:#d6d3d1}.confirmation>label{margin:12px 0}@container(max-width:540px){.fields{grid-template-columns:minmax(0,1fr)}.gateway-heading>button{width:100%}}
</style>
