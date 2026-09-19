<script>
 import {onMount} from 'svelte';
 let {kind,user,api,onclose,onrefresh,onpassword}= $props();
 let error=$state(''),message=$state(''),busy=$state(false),users=$state([]),services=$state([]),diagnostics=$state(null);
 let displayName=$state(''),currentPassword=$state(''),password=$state('');
 let username=$state(''),initialPassword=$state(''),role=$state('user'),grants=$state([]),template=$state('notes-lab'),label=$state('');
 async function load(){if(kind==='admin'){[users,services,diagnostics]=await Promise.all([api('/admin/users'),api('/admin/services'),api('/admin/diagnostics')]);users=users.map(u=>({...u,resetPassword:''}));}}
 async function run(fn){busy=true;error='';message='';try{await fn();}catch(e){error=e.message;}finally{busy=false;}}
 onMount(()=>{displayName=user.displayName;run(load);});
 async function profile(e){e.preventDefault();await run(async()=>{await api('/profile','PATCH',{displayName,currentPassword,...(password?{password}:{})});currentPassword='';if(password){password='';onpassword();}else{await onrefresh();message='Profile saved.';}});}
 async function create(e){e.preventDefault();await run(async()=>{await api('/admin/users','POST',{username,password:initialPassword,role,grants});username='';initialPassword='';grants=[];await load();message='User created.';});}
 async function save(u){await run(async()=>{await api('/admin/users/'+u.id,'PATCH',{role:u.role,disabled:u.disabled,grants:u.grants,...(u.resetPassword?{password:u.resetPassword}:{})});await load();message='User saved. Their sessions were revoked.';});}
 async function service(e){e.preventDefault();await run(async()=>{await api('/admin/services','POST',{template,label});label='';await load();await onrefresh();message='Service registered.';});}
 async function edit(s,remove=false){await run(async()=>{await api('/admin/services/'+s.id,remove?'DELETE':'PATCH',remove?{}:{label:s.label,enabled:s.enabled});await load();await onrefresh();message=remove?'Service removed.':'Service saved.';});}
</script>
<div class="settings-window" role="dialog" tabindex="-1" aria-modal="true" aria-label={kind==='admin'?'Control Panel':'Profile settings'}>
 <div class="panel-heading"><h1>{kind==='admin'?'Control Panel':'Profile settings'}</h1><button aria-label="Close settings" onclick={onclose}>×</button></div>
 <div class="settings-body">
 {#if error}<p role="alert">{error}</p>{/if}{#if message}<p role="status">{message}</p>{/if}
 {#if kind==='profile'}
  {#if user.mustChange}<p role="alert">Your password was reset. Choose a new password before opening apps.</p>{/if}
  <form onsubmit={profile}>
   <label>Display name<input bind:value={displayName} required maxlength="64"/></label>
   <label>Current password<input type="password" autocomplete="current-password" bind:value={currentPassword} required maxlength="128"/></label>
   <label>New password<input type="password" autocomplete="new-password" bind:value={password} minlength="14" maxlength="128" required={user.mustChange}/></label>
   <p>Leave the new password blank to keep it. Password changes sign out all your sessions.</p>
   <button disabled={busy}>Save profile</button>
  </form>
 {:else}
  <p>Application access only. No host, Docker, restart or update controls.</p>
  <h2>Create user</h2>
  <form onsubmit={create}>
   <label>New username<input bind:value={username} required pattern={'[a-z][a-z0-9_\\-]{2,31}'} maxlength="32" autocomplete="off"/></label>
   <label>Initial password<input type="password" bind:value={initialPassword} required minlength="14" maxlength="128" autocomplete="new-password"/></label>
   <label>New user role<select bind:value={role}><option value="user">User</option><option value="admin">Admin</option></select></label>
   <fieldset><legend>Service grants (admins have all enabled services)</legend>{#each services.filter(s=>s.template!=='keepsakes') as s}<label class="check"><input type="checkbox" bind:group={grants} value={s.id}/>Grant {s.label}</label>{/each}</fieldset>
   <button disabled={busy}>Create user</button>
  </form>
  <h2>Users</h2>
  {#each users as u (u.id)}
   <form class="control-record" onsubmit={e=>{e.preventDefault();save(u);}}>
    <h3>{u.username}</h3>
    <label>Role for {u.username}<select bind:value={u.role}><option value="user">User</option><option value="admin">Admin</option></select></label>
    <label class="check"><input type="checkbox" bind:checked={u.disabled}/>Disabled {u.username}</label>
    <fieldset><legend>Grants for {u.username}</legend>{#each services.filter(s=>s.template!=='keepsakes') as s}<label class="check"><input type="checkbox" bind:group={u.grants} value={s.id}/>Grant {s.label} to {u.username}</label>{/each}</fieldset>
    <label>Reset password for {u.username}<input type="password" bind:value={u.resetPassword} minlength="14" maxlength="128" autocomplete="new-password"/></label>
    <small>Reset requires a new password at next login. Saving revokes this user's sessions.</small>
    <button disabled={busy}>Save {u.username}</button>
   </form>
  {/each}
  <h2>Service registry</h2><p>Supported templates only. External LAN connections are not implemented. Keepsakes remains admin-only; its library is shared.</p>
  <form onsubmit={service}>
   <label>Service template<select bind:value={template}><option value="notes-lab">Notes Lab (synthetic stream)</option><option value="signal-lab">Signal Lab (synthetic stream)</option><option value="parcels">Parcels (native, one entry)</option><option value="keepsakes">Keepsakes (admin-only, one entry)</option></select></label>
   <label>Service label<input bind:value={label} required maxlength="64"/></label><button disabled={busy}>Add service</button>
  </form>
  {#each services as s (s.id)}<form class="control-record" onsubmit={e=>{e.preventDefault();edit(s);}}>
   <label>Label for {s.id}<input bind:value={s.label} required maxlength="64"/></label><small>{s.template} · {s.mode}</small>
   <label class="check"><input type="checkbox" bind:checked={s.enabled}/>Enabled {s.id}</label>
   <button disabled={busy}>Save service {s.label}</button><button type="button" disabled={busy} onclick={()=>edit(s,true)}>Remove {s.label}</button>
  </form>{/each}
  <h2>Diagnostics</h2>{#if diagnostics}<dl>{#each Object.entries(diagnostics) as [key,value]}<dt>{key}</dt><dd>{typeof value==='object'?JSON.stringify(value):value}</dd>{/each}</dl>{/if}
  <button disabled={busy} onclick={()=>run(load)}>Refresh diagnostics</button>
 {/if}
 </div>
</div>
