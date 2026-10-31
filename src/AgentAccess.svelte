<script>
 import {onMount} from 'svelte';
 let {api}=$props();
 let scope=$state('read'),ttlSeconds=$state(300),password=$state(''),token=$state(''),issuedId=$state(''),grants=$state([]),busy=$state(false),error=$state(''),message=$state('');
 let alive=true,generation=0,issuedExpires=0;
 function clear(){generation++;password='';token='';issuedExpires=0;message='';}
 async function load(){const next=await api('/admin/agent-access');if(alive)grants=next;}
 async function act(id){
  if(busy)return;const secret=password;clear();const epoch=generation;busy=true;error='';
  const body=id?{password:secret}:{password:secret,scope,ttlSeconds};
  try{
   const result=await api('/admin/agent-access'+(id?'/'+id:''),id?'DELETE':'POST',body);body.password='';
   if(!alive||epoch!==generation)return;
   if(!id){token=result.token;issuedId=result.id;issuedExpires=result.expires;}else if(id===issuedId){token='';issuedId='';issuedExpires=0;}
   await load();
  }catch(e){if(alive&&epoch===generation)error=e.message;}
  finally{body.password='';if(alive)busy=false;}
 }
 async function copy(){const epoch=generation;try{await navigator.clipboard.writeText(token);if(alive&&epoch===generation)message='Copied. Keep it private; hiding does not clear your clipboard.';}catch{if(alive&&epoch===generation)error='Clipboard unavailable. Select the credential manually, then hide it.';}}
 onMount(()=>{load().catch(e=>{if(alive)error=e.message;});const timer=setInterval(()=>{if(token&&issuedExpires<=Date.now())clear();grants=grants.filter(g=>g.expires>Date.now());},1000);return()=>{alive=false;clear();clearInterval(timer);};});
</script>
<svelte:window onblur={clear}/>
<svelte:document onvisibilitychange={()=>{if(document.hidden)clear();}}/>
<section aria-label="Agent access">
 <h2>Agent access</h2>
 <p>Temporary CLI access to shared Gateway targets and apps only. Credentials expire within 900 seconds and stop on issuing-session logout, restart, expiry or loss of administrator access. No host controls.</p>
 {#if error}<p role="alert">{error}</p>{/if}
 <form onsubmit={e=>{e.preventDefault();act();}}>
  <fieldset disabled={busy}>
   <legend>Issue a credential</legend>
   <label>Agent scope<select aria-label="Agent scope" bind:value={scope} onchange={clear}><option value="read">Read only</option><option value="configure">Configure targets and apps</option></select></label>
   <label>Credential lifetime (seconds)<input type="number" min="1" max="900" step="1" required bind:value={ttlSeconds} oninput={clear}/></label>
   <label>Current password for Agent access<input type="password" autocomplete="current-password" maxlength="128" required bind:value={password}/></label>
   <button>Issue credential</button><button type="button" onclick={clear}>Cancel Agent access</button>
  </fieldset>
 </form>
 {#if token}<div><p>Shown once. Save privately in an owner-only credential file for --token-file. Never put it in a URL, command argument or log.</p><label>One-time agent credential<textarea readonly value={token} autocomplete="off" spellcheck="false"></textarea></label><button onclick={copy}>Copy credential</button><button onclick={clear}>Hide credential</button></div>{/if}
 {#if message}<p role="status">{message}</p>{/if}
 <button disabled={busy} onclick={()=>{clear();load().catch(e=>error=e.message);}}>Refresh Agent access</button>
 <table aria-label="Active agent credentials"><thead><tr><th>Credential ID</th><th>Scope</th><th>Expires</th><th>Action</th></tr></thead><tbody>{#each grants as g(g.id)}<tr><th>{g.id}</th><td>{g.scope}</td><td>{new Date(g.expires).toLocaleTimeString()}</td><td><button disabled={busy||!password} onclick={()=>act(g.id)} aria-label={'Revoke credential '+g.id}>Revoke</button></td></tr>{/each}</tbody></table>
 <p>To revoke, enter your current password above. Hiding or cancelling clears local disclosure, not server access. Revoke to end access early.</p>
</section>
<style>section{margin-top:24px;border-top:1px solid #78716c;padding-top:16px}label{display:block;margin:10px 0}input,select,textarea{display:block;max-width:100%}textarea{width:100%;overflow-wrap:anywhere}table{width:100%;font-size:12px;overflow-wrap:anywhere}button{margin:4px}p{max-width:70ch}</style>
