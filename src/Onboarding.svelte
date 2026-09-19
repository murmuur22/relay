<script>
 import {onMount,tick} from 'svelte';
 import AppWizard from './AppWizard.svelte';
 let {api,apps,user,oncomplete,onlogout}= $props();
 let draft=$state(null),busy=$state(false),error=$state(''),saved=$state(null),heading;
 // The persisted registry is authoritative after reload/restart; do not duplicate a saved first app.
 onMount(()=>{saved=apps.find(app=>app.id===user?.onboardingAppId)||(user?.onboardingAppId?{id:user.onboardingAppId,label:'Your first app'}:apps.find(app=>app.kind==='web'))||null;heading?.focus();});
 async function choice(){draft=null;await tick();heading?.focus();}
 async function complete(){if(busy)return;busy=true;error='';try{await api('/onboarding/complete','POST',{});await oncomplete();}catch(e){error=e.message;}finally{busy=false;}if(error){await tick();heading?.parentElement.querySelector('button:not(:disabled)')?.focus();}}
 async function save(data){if(!saved)saved=await api('/onboarding/app','POST',data);draft=null;busy=false;await complete();}
 async function add(){draft={step:1,mode:'native',label:'',address:'',icon:'globe',openMode:'window',originText:'',userIds:[]};await tick();heading?.parentElement.querySelector('.app-wizard input')?.focus();}
</script>
<section class="onboarding settings-body" aria-label="First-run setup">
 <p class="muted">Step 2 of 2</p><h1 tabindex="-1" bind:this={heading}>Add your first app</h1>
 <p>Your admin password is saved. Connect an app now, or enter your desktop and add one later in Control Panel.</p>
 {#if error}<p role="alert">{error}</p>{/if}
 {#if draft}<AppWizard {draft} users={[]} {api} onsave={save} oncancel={choice} onbusy={value=>busy=value}/>
 {:else if saved}<p role="status">{saved.label || 'Your app'} is registered. Finish setup to enter the desktop; retrying will not add it again.</p><button disabled={busy} onclick={complete}>Enter desktop</button>
 {:else}<div class="onboarding-actions"><button disabled={busy} onclick={add}>Add app</button><button disabled={busy} onclick={complete}>Set up later</button></div>{/if}
 <button class="onboarding-signout" disabled={busy} onclick={onlogout}>Sign out</button>
</section>
<style>
 .onboarding{accent-color:#d6d3d1;margin:24px auto;width:min(660px,100%);max-height:calc(100% - 48px);overflow:auto;border:1px solid #777;background:#101010;padding:28px;color:#eee;font-size:14px}
 h1{font-size:24px;font-weight:400;margin:10px 0}p{line-height:1.6}.onboarding-actions{display:flex;gap:12px;margin:24px 0}.onboarding-signout{margin-top:20px}button{border:1px solid #777;padding:9px 14px;background:#181818;color:#eee}button:focus-visible{outline:2px solid #ddd;outline-offset:3px}
 @media(max-width:640px){.onboarding{padding:18px;}.onboarding-actions{flex-wrap:wrap}}
</style>
