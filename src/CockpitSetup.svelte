<script>
 import {tick,onDestroy} from 'svelte';
 import {cockpitTarget,COCKPIT_PROFILE} from '../server/gateway-service-profiles.mjs';
 let {api,status,targetOnly=false,onsaved=async()=>{},oncancel=()=>{},onbusy=()=>{}}=$props();
 function initialConfig(){return structuredClone($state.snapshot(status.config));}
 const baseConfig=initialConfig();
 let id='cockpit',suffix=2;while(baseConfig.targets.some(t=>t.id===id))id='cockpit-'+suffix++;
 const steps=['Destination','Certificate','Login','Live channels','Display','Permissions','Review'];
 let form=$state({id,label:'Cockpit',upstream:'',trust:'system',serverName:'',caPath:''}),step=$state(0),heading=$state(),busy=$state(false),password=$state(''),ack=$state(false),error=$state(''),result=$state(null),validated=$state(''),message=$state(''),saved=$state(false);
 let alive=true,generation=0,controller;
 let tlsRemoved=$state(false);
 let target=$derived.by(()=>{try{return cockpitTarget(form);}catch{return null;}});
 let key=$derived(target?JSON.stringify(target):'');
 function changed(){generation++;controller?.abort();result=null;validated='';password='';ack=false;error='';message='';}
 async function go(n){changed();step=n;await tick();heading?.focus();}
 let issue=$derived.by(()=>{try{cockpitTarget(form);return '';}catch(e){return e.message;}});
 function next(){
  if(step===0){
   try{cockpitTarget({...form,trust:'system',serverName:'',caPath:''});}catch(e){error=e.message;return;}
   if(form.upstream.startsWith('http:')&&(form.serverName||form.caPath||form.trust!=='system')){
    form.serverName='';form.caPath='';form.trust='system';tlsRemoved=true;
   }else if(form.upstream.startsWith('https:'))tlsRemoved=false;
  }
  if(step===1&&issue){error=issue;return;}void go(step+1);
 }
 async function run(save){
  if(busy||!target||!password||saved||(save&&(!ack||validated!==key)))return;
  const run=++generation,identity=key,config={...baseConfig,targets:[...baseConfig.targets,structuredClone(target)]};
  controller=new AbortController();const signal=controller.signal;busy=true;onbusy(true);error='';message='';
  const body={config,baseConfig,password,...(!save?{targetId:target.id,profileVersion:COCKPIT_PROFILE.version}:{})};password='';
  try{
   if(save){
    await api('/admin/gateway','PUT',body,{signal});body.password='';if(!alive||run!==generation)return;saved=true;result=null;validated='';message='Target saved. App registration is separate; your unsaved app draft is kept.';
    // Read back exact state before returning to Add app; a lost response remains explicit.
    const current=await api('/admin/gateway');if(!alive||run!==generation)return;
    if(JSON.stringify(current.config)!==JSON.stringify(config))throw Error('Target save could not be confirmed. Refresh Gateway status; do not blindly retry.');
    await onsaved(target.id);
   }else{
    const check=await api('/admin/gateway/check-target','POST',body,{signal});body.password='';if(!alive||run!==generation||identity!==key)return;
    result=check;validated=identity;
   }
  }catch(e){body.password='';if(alive&&run===generation){error=e.message;result=null;validated='';if(save){saved=true;message='Save outcome needs reconciliation. '+(targetOnly?'Use Cancel target to refresh Gateway options and keep your app draft, then choose an already saved target.':'Use Return without creating another target to refresh Gateway status before making further changes.')+' Do not blindly retry. No app has been created by this step.';}}}
  finally{body.password='';if(alive&&run===generation){busy=false;controller=null;onbusy(false);}}
 }
 onDestroy(()=>{alive=false;generation++;controller?.abort();password='';onbusy(false);});
 const labels={configuration:'Configuration',certificate:'Service certificate',http:'HTTP response',login:'Login',live:'Live interaction',display:'Protected tab compatibility',revocation:'Active disconnection'};
</script>
<section class="guided" aria-label="Guided Cockpit setup">
 <p>Cockpit profile v{COCKPIT_PROFILE.version} · {step+1} / 7 · Compatibility requires authentic service qualification.</p>
 <nav aria-label="Cockpit setup steps">{#each steps as name,i}<button disabled={busy||saved||i>step} aria-current={i===step?'step':undefined} onclick={()=>go(i)}>{name}</button>{/each}</nav>
 <h2 tabindex="-1" bind:this={heading}>{steps[step]}</h2>
 {#if error}<p role="alert">{error}</p>{/if}{#if message}<p role="status">{message}</p>{/if}
 {#if tlsRemoved&&form.upstream.startsWith('http:')}<p role="alert">HTTP selected: removed the certificate DNS identity, custom CA path and TLS trust selection. HTTP has no upstream TLS; confirm the intended protected network boundary.</p>{/if}
 <fieldset disabled={busy||saved} oninput={changed}>
 {#if step===0}
  <label>Target ID<input bind:value={form.id} maxlength="32" autocomplete="off"/></label><label>Service name<input bind:value={form.label} maxlength="64"/></label><label>Cockpit service origin<input bind:value={form.upstream} placeholder="https://192.168.10.20:9090" autocomplete="off" spellcheck="false"/></label>
  <p>Exact private IPv4 HTTP(S) origin. No path, credentials or trailing slash. Nothing is probed while you type.</p>
  <details><summary>Which machine connects?</summary><p>Your browser connects to Relay; Relay connects to this fixed destination. Loopback is supported for disposable tests. Public and metadata destinations are refused. Other services remain unqualified.</p></details>
 {:else if step===1}
  <p>Service trust verifies Cockpit, not the browser-facing Relay certificate.</p>
  {#if form.upstream.startsWith('https:')}
   <label>Service certificate trust<select bind:value={form.trust} onchange={()=>{form.caPath='';changed();}}><option value="system">Provisioned system CA</option><option value="custom">Provisioned custom CA</option></select></label>
   {#if form.trust==='custom'}<label>Protected CA path on Relay server<input bind:value={form.caPath} autocomplete="off" spellcheck="false"/></label>{/if}
   <label>Exact certificate DNS identity<input bind:value={form.serverName} placeholder="Blank verifies the destination IP" autocomplete="off" spellcheck="false"/></label>
  {:else}<p>HTTP has no upstream TLS. Use only a deliberately protected network; this setup does not establish that boundary.</p>{/if}
  <details><summary>What about a self-signed certificate?</summary><p>An operator must provision a verified CA file on the Relay server with protected ownership, permissions and non-symlink ancestry. Enter its path, never upload a key or paste certificates. An observed certificate is never automatically trusted. DNS identity changes TLS verification/SNI, not the fixed IP or HTTP Host.</p></details>
  <details><summary>What does my browser trust?</summary><p>Browser-facing Relay HTTPS, app names, DNS, firewall and Caddy are separate existing listener prerequisites. This target setup never installs certificates or changes global networking.</p></details>
 {:else if step===2}
  <p>Use Cockpit’s own login in the protected app tab. No Cockpit password is requested or saved here.</p><p>Allowed private cookie: cockpit. No ambient browser-cookie import.</p>
  <details><summary>Two accounts, two decisions</summary><p>Relay decides who can launch. Cockpit decides what their upstream account can do. The shared engine keeps its bounded cookie jar private to the live Relay app session; it is not single sign-on or credential persistence.</p></details><p>Login: not-tested</p>
 {:else if step===3}
  <p>WebSocket path /cockpit/socket · protocol cockpit1 · Origin derived from the validated upstream.</p><details><summary>Why does a page load not prove live controls?</summary><p>A named protocol and open socket do not establish authenticated Cockpit interaction. No socket or login probe is made here. Real login, interaction and active termination require separate service qualification.</p></details><p>Live interaction: not-tested</p>
 {:else if step===4}
  <label>Opening mode<select><option>Protected app tab</option></select></label><p>Entry path /. An isolated session origin stays behind Relay. The one-use handoff severs the opener; upstream framing policy is preserved.</p><details><summary>Why not embed?</summary><p>Cockpit components can require same-origin framing. Relay does not strip CSP or X-Frame-Options. This profile uses the shared protected-tab engine, not a bespoke Cockpit proxy. Browser compatibility is not proven by saving settings.</p></details>
 {:else if step===5}
  <p>Administrators only — enforced by the engine even if a regular user has a Relay grant.</p><p>Relay grants do not give upstream account privilege or guarantee read-only access.</p><details><summary>Which session safeguards exist?</summary><p>Applying configuration requires your current Relay password. This is not fresh reauthentication at every launch or configurable idle enforcement. Those management-session safeguards are planned separately before production. End app session, Close and logout retire Relay gateway authority; they do not revoke upstream-issued credentials or erase downloaded data.</p></details>
 {:else}
  <p>{form.label} · {form.id} · {form.upstream}</p><p>Protected tab · admin-only · Cockpit profile v1</p>
  {#if issue}<p role="alert">{issue}</p>{/if}
  <p>Applying changes retires existing Gateway windows. Target save and app registration are separate, not atomic. Cancelling Add app leaves a saved target; target cancellation before save changes nothing.</p>
  <details><summary>What will checks establish?</summary><p>On your explicit action only: validate protected files and runtime settings, then one credential-free HEAD to this destination, no redirects or body. HTTP status is a response, not authenticated health. No credentials, session contents or arbitrary headers are inspected. Checks are observations, not future guarantees.</p></details>
  {#if result}<p>Source: {result.source} · Checked: {new Date(result.checkedAt).toISOString()}</p><p class="identity">Configuration identity: {result.configIdentity}</p>{#each Object.entries(result.tiers) as [name,tier]}<p>{labels[name]}: {tier.state}</p><small>{tier.detail}</small>{/each}{:else}<p>Configuration, service certificate, HTTP response, login, live interaction, protected tab compatibility and active disconnection: not-tested</p>{/if}
  <p>Browser-facing trust and intended network boundary: manual confirmation required, not verified by this form.</p>
  <label>Current password for Cockpit setup<input type="password" bind:value={password} autocomplete="current-password" oninput={e=>e.stopPropagation()}/></label>
  <button disabled={!target||!password} onclick={()=>run(false)}>Check destination now</button>
  <label class="ack"><input type="checkbox" bind:checked={ack} oninput={e=>e.stopPropagation()}/>I understand applying settings retires Gateway windows.</label>
  <button disabled={!target||!password||!ack||validated!==key} onclick={()=>run(true)}>Save Cockpit target separately</button>
 {/if}
 </fieldset>
 <div class="actions"><button disabled={busy||saved||step===0} onclick={()=>go(step-1)}>Previous</button>{#if step<6}<button disabled={busy||saved} onclick={next}>Continue</button>{/if}<button disabled={busy} onclick={()=>oncancel(saved)}>{saved?'Return without creating another target':'Cancel Cockpit setup'}</button></div>
</section>
<style>
 .guided{min-width:0;color:#e7e5e4;font-size:12px}.guided p{line-height:1.6}nav,.actions{display:flex;gap:6px;flex-wrap:wrap}h2{font-size:18px}fieldset{border:1px solid #57534e;margin:12px 0;padding:12px;min-width:0}label{display:flex;flex-direction:column;gap:6px;margin:12px 0}input,select,button{font:inherit;color:#fafaf9;background:#1c1917;border:1px solid #78716c;padding:9px;min-width:0;max-width:100%}input,select{width:100%;box-sizing:border-box}button{cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}details{margin:14px 0}summary{cursor:pointer;padding:6px 0}small{color:#a8a29e;line-height:1.5}.identity{overflow-wrap:anywhere}.ack{flex-direction:row;align-items:flex-start}.ack input{width:auto;accent-color:#d6d3d1}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:1px dashed #fafaf9;outline-offset:3px}
</style>
