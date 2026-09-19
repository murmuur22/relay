<script>
 import {onMount,tick} from 'svelte';
 import AppWizard from './AppWizard.svelte';
 import {webAddress,origins} from './webapps.js';
 let {kind,user,api,onclose,onrefresh,onpassword}= $props();
 let error=$state(''),message=$state(''),busy=$state(false),users=$state([]),apps=$state([]),diagnostics=$state(null);
 let displayName=$state(''),currentPassword=$state(''),password=$state('');
 let page=$state('Users'),queryUsers=$state(''),queryApps=$state(''),editor=$state(null),confirmRemove=$state(false);
 let dialog,editorElement=$state(),confirmation=$state(),returnId='';
 const pages=['Users','Apps','System'];
 const drafts=new Map();
 const userStatus=u=>u.disabled?'Disabled':u.mustChange?'Password reset':'Active';
 const shownUsers=$derived(users.filter(u=>`${u.username} ${u.displayName} ${u.role} ${userStatus(u)}`.toLowerCase().includes(queryUsers.trim().toLowerCase())));
 const shownApps=$derived(apps.filter(s=>`${s.label} ${s.template} ${s.mode} ${s.enabled?'enabled':'disabled'}`.toLowerCase().includes(queryApps.trim().toLowerCase())));
 async function load(){if(kind==='admin')[users,apps,diagnostics]=await Promise.all([api('/admin/users'),api('/admin/apps'),api('/admin/diagnostics')]);}
 async function run(fn){if(busy)return false;busy=true;error='';message='';try{await fn();return true;}catch(e){error=e.message;return false;}finally{busy=false;}}
 onMount(()=>{
  const previous=document.activeElement;
  const siblings=[...dialog.parentElement.children].filter(el=>el!==dialog&&!el.inert);siblings.forEach(el=>el.inert=true);
  displayName=user.displayName;
  dialog.focus();
  run(load).then(async()=>{await tick();if(dialog?.isConnected)dialog.querySelector(kind==='profile'?'input':'[role=tab]')?.focus();});
  return ()=>{siblings.forEach(el=>el.inert=false);const target=previous?.isConnected&&previous!==document.body?previous:document.querySelector('button[aria-label="Navigation"]');target?.focus();};
 });
 async function openEditor(type,record,event){
  returnId=event.currentTarget.id;error='';message='';
  editor=type==='user'?{type,id:record?.id,username:record?.username||'',role:record?.role||'user',disabled:record?.disabled||false,grants:[...(record?.grants||[])],password:''}:record?{...record,type,originText:(record.allowedOrigins||[]).join('\n')}:{type,step:1,mode:'native',label:'',address:'',icon:'globe',openMode:'window',originText:'',userIds:[]};
  await tick();editorElement?.querySelector('input,select')?.focus();
 }
 async function back(){if(busy)return;drafts.delete(page);editor=null;confirmRemove=false;error='';await tick();(document.getElementById(returnId)||document.getElementById('new-'+page.toLowerCase()))?.focus();}
 function switchPage(next){if(busy||next===page)return;if(editor)drafts.set(page,{editor,returnId});page=next;const saved=drafts.get(next);editor=saved?.editor||null;returnId=saved?.returnId||'';confirmRemove=false;error='';message='';}
 function tabKey(event,index){
  let next;if(event.key==='ArrowRight')next=(index+1)%pages.length;else if(event.key==='ArrowLeft')next=(index+pages.length-1)%pages.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=pages.length-1;else return;
  event.preventDefault();switchPage(pages[next]);document.getElementById('tab-'+pages[next])?.focus();
 }
 async function askRemove(){confirmRemove=true;await tick();confirmation?.querySelector('button')?.focus();}
 async function cancelRemove(){if(busy)return;confirmRemove=false;await tick();document.getElementById('remove-app')?.focus();}
 function keydown(event){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(busy)return;if(confirmRemove)cancelRemove();else if(editor)back();else onclose();}
  if(event.key==='Tab'){
   const scope=confirmRemove?confirmation:dialog;
   const controls=[...scope.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
   const first=controls[0],last=controls.at(-1);
   if(!first){event.preventDefault();dialog.focus();}else if(event.shiftKey&&(document.activeElement===first||!scope.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!scope.contains(document.activeElement))){event.preventDefault();first.focus();}
  }
 }
 async function profile(e){e.preventDefault();await run(async()=>{await api('/profile','PATCH',{displayName,currentPassword,...(password?{password}:{})});currentPassword='';if(password){password='';onpassword();}else{await onrefresh();message='Profile saved.';}});}
 async function saveUser(e){
  e.preventDefault();const u=editor;
  const ok=await run(async()=>{await api('/admin/users'+(u.id?'/'+u.id:''),u.id?'PATCH':'POST',u.id?{role:u.role,disabled:u.disabled,grants:u.grants,...(u.password?{password:u.password}:{})}:{username:u.username,password:u.password,role:u.role,grants:u.grants});await load();message=u.id?'User saved. Their sessions were revoked.':'User created.';});if(ok)await back();
 }
 async function saveApp(e,remove=false){
  e?.preventDefault();const s=editor;
  const ok=await run(async()=>{await api('/admin/apps/'+s.id,remove?'DELETE':'PATCH',remove?{}:{label:s.label,enabled:s.enabled,...(s.kind==='web'?{address:webAddress(s.address),icon:s.icon,openMode:s.openMode,allowedOrigins:origins(s.originText)}:{})});await load();await onrefresh();message=remove?'App removed.':'App saved.';});if(ok)await back();
 }
 async function createApp(data){await api('/admin/apps','POST',data);await load();await onrefresh();busy=false;await back();message='App registered.';}
 async function preference(event){const value=event.currentTarget.checked;const ok=await run(async()=>{await api('/preferences','PATCH',{showAppStatus:value});await onrefresh();message='Status preference saved.';});if(!ok)event.target.checked=user.preferences?.showAppStatus!==false;}
 const mib=value=>`${(value/1024/1024).toFixed(1)} MiB`;
</script>
<div class="settings-window" bind:this={dialog} role="dialog" tabindex="-1" aria-modal="true" aria-label={kind==='admin'?'Control Panel':'Profile settings'} onkeydown={keydown}>
 <div class="panel-heading"><h1>{kind==='admin'?'Control Panel':'Profile settings'}</h1><button aria-label="Close settings" disabled={busy||confirmRemove} onclick={onclose}>×</button></div>
 <div class="settings-body" aria-busy={busy}>
  {#if error}<p role="alert">{error}</p>{/if}{#if message}<p role="status">{message}</p>{/if}
  {#if kind==='profile'}
   {#if user.mustChange}<p role="alert">Your password was reset. Choose a new password before opening apps.</p>{/if}
   <form onsubmit={profile}>
    <fieldset disabled={busy} class="form-grid">
     <legend>Account & security</legend>
     <label>Display name<input bind:value={displayName} required maxlength="64"/></label>
     <div class="account-summary"><span>Signed in as</span><strong>{user.username}</strong><small>{user.role}</small></div>
     <label>Current password<input type="password" autocomplete="current-password" bind:value={currentPassword} required maxlength="128"/></label>
     <label>New password<input type="password" autocomplete="new-password" bind:value={password} minlength="14" maxlength="128" required={user.mustChange}/></label>
     <p class="full-width muted">Leave the new password blank to keep it. Password changes sign out all your sessions.</p>
     <div class="full-width"><button>Save profile</button></div>
    </fieldset>
   </form>
   <fieldset disabled={busy} class="preference-panel"><legend>Apps</legend><label class="check"><input type="checkbox" checked={user.preferences?.showAppStatus!==false} onchange={preference}/>Show app status</label><p class="muted">Show connection observations on app shortcuts. Saved for your account across sessions; no password needed. Hiding status does not change access.</p></fieldset>
  {:else}
   <p class="settings-note">Application access only. No host, Docker, restart or update controls.</p>
   <div class="settings-tabs" role="tablist" aria-label="Control Panel pages">
    {#each pages as name,i}<button id={'tab-'+name} role="tab" aria-selected={page===name} aria-controls={'page-'+name} tabindex={page===name?0:-1} disabled={busy||confirmRemove} onclick={()=>switchPage(name)} onkeydown={e=>tabKey(e,i)}>{name}</button>{/each}
   </div>
   <div id={'page-'+page} role="tabpanel" aria-labelledby={'tab-'+page}>
    {#if editor?.type==='app'&&!editor.id}
     <AppWizard draft={editor} {users} {api} onsave={createApp} oncancel={back} onbusy={value=>busy=value}/>
    {:else if editor}
     <div class="section-heading"><h2>{editor.id?'Edit':'New'} {editor.type}{editor.type==='user'&&editor.id?': '+editor.username:''}</h2><button disabled={busy||confirmRemove} onclick={back}>Back to {page.toLowerCase()}</button></div>
     <div bind:this={editorElement} inert={confirmRemove}>
      {#if editor.type==='user'}
       <form onsubmit={saveUser}><fieldset class="form-grid" disabled={busy}>
        <legend class="sr-only">User details</legend>
        {#if !editor.id}<label>New username<input bind:value={editor.username} required pattern={'[a-z][a-z0-9_\\-]{2,31}'} maxlength="32" autocomplete="off"/></label>
        <label>Initial password<input type="password" bind:value={editor.password} required minlength="14" maxlength="128" autocomplete="new-password"/></label>{/if}
        <label>{editor.id?'Role for '+editor.username:'New user role'}<select bind:value={editor.role}><option value="user">User</option><option value="admin">Admin</option></select></label>
        {#if editor.id}<label class="check"><input type="checkbox" bind:checked={editor.disabled}/>Disabled {editor.username}</label>{/if}
        <fieldset class="full-width grant-grid"><legend>{editor.id?'Grants for '+editor.username:'App grants'} (admins have all enabled apps)</legend>
         {#each apps.filter(s=>s.template!=='keepsakes') as s}<label class="check"><input type="checkbox" bind:group={editor.grants} value={s.id}/>Grant {s.label}{editor.id?' to '+editor.username:''}</label>{/each}
        </fieldset>
        {#if editor.id}<label class="full-width">Reset password for {editor.username}<input type="password" bind:value={editor.password} minlength="14" maxlength="128" autocomplete="new-password"/></label><small class="full-width muted">Leave blank to keep the password. Reset requires a new password at next login. Saving revokes this user's sessions.</small>{/if}
        <div class="full-width"><button>{editor.id?'Save '+editor.username:'Create user'}</button><button type="button" onclick={back}>Cancel</button></div>
       </fieldset></form>
      {:else}
       <form onsubmit={saveApp}><fieldset class="form-grid" disabled={busy}>
        <legend class="sr-only">App details</legend>
        <label>App label<input bind:value={editor.label} required maxlength="64"/></label>
        <label class="check"><input type="checkbox" bind:checked={editor.enabled}/>Enabled</label>
        {#if editor.kind==='web'}<label>Address<input bind:value={editor.address} required/></label><label>Icon<select bind:value={editor.icon}>{#each ['globe','folder','notes','media','terminal'] as icon}<option>{icon}</option>{/each}</select></label>
         {#if editor.mode==='native'}<label>Open in<select bind:value={editor.openMode}><option value="window">Desktop window</option><option value="tab">New tab</option></select></label>{:else}<label class="full-width">Additional approved origins<textarea bind:value={editor.originText} rows="3"></textarea></label>{/if}
         <p class="full-width muted">Saving closes this entry's active connections and may sign out affected users. Native embedding may be blocked. Streamed WebSockets and file transfer are unsupported.</p>
        {:else}<p class="full-width muted">Template: {editor.template} (builtin)</p>{/if}
        <div class="full-width"><button>{editor.id?'Save app':'Add app'}</button><button type="button" onclick={back}>Cancel</button>{#if editor.id}<button id="remove-app" type="button" onclick={askRemove}>Remove app</button>{/if}</div>
       </fieldset></form>
      {/if}
     </div>
     {#if confirmRemove}
      <div class="removal-confirmation" bind:this={confirmation} role="alertdialog" tabindex="-1" aria-modal="true" aria-labelledby="remove-title" aria-describedby="remove-description">
       <h3 id="remove-title">Remove {apps.find(s=>s.id===editor.id)?.label}?</h3>
       <p id="remove-description">This removes the Relay entry and its access grants, not the upstream app or its data. Active connections to this entry will close.</p>
       <button disabled={busy} onclick={cancelRemove}>Cancel removal</button><button disabled={busy} onclick={()=>saveApp(null,true)}>Confirm removal</button>
      </div>
     {/if}
    {:else if page==='Users'}
     <div class="section-heading"><h2>Users <small>{users.length} total</small></h2><button id="new-users" disabled={busy} onclick={e=>openEditor('user',null,e)}>New user</button></div>
     <label class="search-field">Search users<input type="search" bind:value={queryUsers} placeholder="Name, role or status"/></label>
     <p class="result-count">{shownUsers.length} of {users.length} users</p>
     <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll the table.) -->
     <div class="table-scroll" role="region" aria-label="Users table" tabindex="0"><table aria-label="Users"><thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Grants</th><th scope="col">Actions</th></tr></thead><tbody>
      {#each shownUsers as u (u.id)}<tr><th scope="row">{u.username}<small>{u.displayName!==u.username?u.displayName:''}</small></th><td>{u.role}</td><td>{userStatus(u)}</td><td>{u.role==='admin'?'All enabled':u.grants.length}</td><td><button id={'edit-user-'+u.id} disabled={busy} aria-label={'Edit user '+u.username} onclick={e=>openEditor('user',u,e)}>Edit</button></td></tr>{/each}
      {#if !shownUsers.length}<tr><td colspan="5">{busy?'Loading users…':'No matching users.'}</td></tr>{/if}
     </tbody></table></div>
    {:else if page==='Apps'}
     <div class="section-heading"><h2>Apps <small>{apps.length} total</small></h2><button id="new-apps" disabled={busy} onclick={e=>openEditor('app',null,e)}>Add app</button></div>
     <p class="settings-note">Register HTTP(S) apps as native or streamed. Compatibility varies by website. Keepsakes remains admin-only with a shared library. Enabled means access, not live health.</p>
     <label class="search-field">Search apps<input type="search" bind:value={queryApps} placeholder="Label, template, mode or status"/></label>
     <p class="result-count">{shownApps.length} of {apps.length} apps</p>
     <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll the table.) -->
     <div class="table-scroll" role="region" aria-label="Apps table" tabindex="0"><table aria-label="Apps"><thead><tr><th scope="col">App</th><th scope="col">Template</th><th scope="col">Mode</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>
      {#each shownApps as s (s.id)}<tr><th scope="row">{s.label}</th><td>{s.template}</td><td>{s.mode}</td><td>{s.enabled?'Enabled':'Disabled'}</td><td><button id={'edit-app-'+s.id} disabled={busy} aria-label={'Edit app '+s.label} onclick={e=>openEditor('app',s,e)}>Edit</button></td></tr>{/each}
      {#if !shownApps.length}<tr><td colspan="5">{busy?'Loading apps…':'No matching apps.'}</td></tr>{/if}
     </tbody></table></div>
    {:else}
     <div class="section-heading"><h2>System</h2><button disabled={busy} onclick={()=>run(load)}>Refresh diagnostics</button></div>
     {#if diagnostics}
      <dl class="diagnostic-grid">
       <div><dt>Version</dt><dd>{diagnostics.version}</dd></div><div><dt>Uptime</dt><dd>{diagnostics.uptimeSeconds} seconds</dd></div>
       <div><dt>Sessions</dt><dd>{diagnostics.sessions}</dd></div><div><dt>Stream resources</dt><dd>{diagnostics.streams}</dd></div>
       <div><dt>Users</dt><dd>{diagnostics.users}</dd></div><div><dt>Registered apps</dt><dd>{diagnostics.apps??diagnostics.services}</dd></div>
       <div><dt>Resident memory</dt><dd>{mib(diagnostics.memory.rss)}</dd></div><div><dt>Heap used / allocated</dt><dd>{mib(diagnostics.memory.heapUsed)} / {mib(diagnostics.memory.heapTotal)}</dd></div>
       <div><dt>External memory</dt><dd>{mib(diagnostics.memory.external)}</dd></div><div><dt>Array buffers</dt><dd>{mib(diagnostics.memory.arrayBuffers)}</dd></div>
      </dl>
      <table class="limits-table" aria-label="Resource limits"><thead><tr><th scope="col">Resource</th><th scope="col">Per user</th><th scope="col">Global</th></tr></thead><tbody><tr><th scope="row">Sessions</th><td>{diagnostics.limits.sessionsPerUser}</td><td>{diagnostics.limits.sessionsGlobal}</td></tr><tr><th scope="row">Streams</th><td>{diagnostics.limits.streamsPerUser}</td><td>{diagnostics.limits.streamsGlobal}</td></tr></tbody></table>
      <p class="settings-note">External connections: {diagnostics.externalConnections}</p>
     {:else}<p>{busy?'Loading diagnostics…':'Diagnostics unavailable. Try refreshing.'}</p>{/if}
    {/if}
   </div>
  {/if}
 </div>
</div>
