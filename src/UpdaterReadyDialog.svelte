<script>
 import {onMount} from 'svelte';
 let {version,onapply,onlater}=$props();
 let dialog,later,apply;
 function containFocus(event){if(event.key==='Tab'){event.preventDefault();(document.activeElement===later?apply:later).focus();}}
 onMount(()=>{const previous=document.activeElement;dialog.showModal();later.focus();return()=>{dialog.close();queueMicrotask(()=>{if(document.querySelector('dialog[open]'))return;if(previous?.isConnected&&previous!==document.body&&previous!==document.documentElement&&!previous.closest('[inert]'))previous.focus();else document.querySelector('.maintenance-bar button[aria-label="Close maintenance"]')?.focus();});};});
</script>
<dialog bind:this={dialog} aria-labelledby="ready-title" onkeydown={containFocus} oncancel={event=>{event.preventDefault();onlater();}}>
 <p class="eyebrow">PREPARED / NOT INSTALLED</p><h2 id="ready-title">Update ready</h2>
 <p>Release {version} is verified and prepared. Relay is still running.</p>
 <p>Apply opens fresh authorization in your independent updater. Save your work before authorizing a restart.</p>
 <div class="actions"><button bind:this={later} onclick={onlater}>Later</button><button bind:this={apply} onclick={onapply}>Apply</button></div>
 <small>Later dismisses this reminder. It does not cancel preparation.</small>
</dialog>
<style>
 dialog{box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:28px;background:#f4f1e9;color:#242321;border:1px solid #a8a29e;box-shadow:6px 6px #0008;font:13px/1.6 ui-monospace,monospace;color-scheme:light}
 dialog::backdrop{background:#000b}h2{font-size:23px;margin:8px 0 18px}.eyebrow{font-size:10px;letter-spacing:1px}.actions{display:flex;justify-content:flex-end;gap:12px;margin:24px 0 16px}button{border:1px solid #57534e;min-height:44px;min-width:88px;padding:10px 18px;color:#242321}button:last-child{background:#242321;color:#fafaf9}button:focus-visible{outline:2px solid #57534e;outline-offset:3px}small{display:block;font-size:11px;color:#57534e}
</style>
