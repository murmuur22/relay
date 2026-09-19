<script>
 let {onlogin}= $props();
 let username=$state(''),password=$state(''),error=$state(''),setup=$state(false),credential=$state(''),csrf='',busy=$state(false),loaded=$state(false);
 import {onMount} from 'svelte';
 onMount(async()=>{credential=location.hash.slice(1);history.replaceState(null,'',location.pathname);try{const r=await fetch('/api/auth');if(!r.ok)throw Error('Gateway unavailable');const info=await r.json();setup=info.setup;csrf=info.csrf;if(setup)username='admin';loaded=true;}catch(e){error=e.message;}});
 async function submit(event){event.preventDefault();busy=true;error='';try{const r=await fetch(setup?'/api/enroll':'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({username,password,setup:credential})});const data=await r.json();if(!r.ok)throw Error(data.error);password='';credential='';await onlogin();}catch(e){error=e.message;}finally{busy=false;}}
</script>
<section class="login-panel" aria-label="Account access">
 <h1>{setup?'first run':'login'}</h1>
 {#if setup}<p>Create the initial admin account. Choose a unique passphrase of at least 14 characters.</p>{#if !credential}<p role="alert">Open the owner-only .runtime/setup-url.txt on this machine to enroll.</p>{/if}{/if}
 <form onsubmit={submit}>
  <label>username<input autocomplete="username" maxlength="32" bind:value={username} readonly={setup} required/></label>
  <label>password<input type="password" autocomplete={setup?'new-password':'current-password'} minlength={setup?14:1} maxlength="128" bind:value={password} required/></label>
  {#if error}<p role="alert">{error}</p>{/if}
  <button type="submit" disabled={!loaded||busy||(setup&&!credential)}>{busy?'Please wait…':setup?'Create admin':'Enter →'}</button>
 </form>
</section>
