<script>
 import {onMount,tick} from 'svelte';
 let {enabled=true,onvisibility=()=>{}}= $props();
 let visible=$state(false),bypass=$state(),alive=false,previous;
 async function dismiss(){
  if(!visible)return;
  visible=false;onvisibility(false);await tick();
  if(!alive)return;
  const target=previous?.isConnected&&previous!==document.body&&!previous.closest('[inert]')?previous:document.querySelector('.onboarding h1, .login-panel input:not([readonly]), button[aria-label="Navigation"], .system-panel button');
  target?.focus();
 }
 $effect(()=>{if(!enabled)void dismiss();});
 onMount(()=>{
  alive=true;previous=document.activeElement;
  let seen=false;try{seen=sessionStorage.getItem('relay.intro.seen')==='1';sessionStorage.setItem('relay.intro.seen','1');}catch{}
  visible=enabled&&!seen;onvisibility(visible);
  if(visible)void tick().then(()=>{if(alive&&visible)bypass?.focus();});
  const key=e=>{if(!visible)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();void dismiss();}else if(e.key==='Tab'){e.preventDefault();bypass?.focus();}};
  window.addEventListener('keydown',key);
  const timer=setTimeout(()=>void dismiss(),1100);
  return()=>{alive=false;clearTimeout(timer);window.removeEventListener('keydown',key);onvisibility(false);};
 });
</script>
{#if visible}<div class="signal-intro" role="dialog" aria-modal="true" aria-label="Decorative introduction" tabindex="-1" onpointerdown={e=>{if(e.target!==bypass){e.preventDefault();bypass?.focus();}}}><span class="signal-label" aria-hidden="true">relay_</span><button bind:this={bypass} class="intro-bypass" onclick={dismiss}>[ESC] BYPASS INITIALIZATION</button></div>{/if}
<style>
 .signal-intro{position:fixed;inset:0;z-index:3000;background:#080808;background-image:radial-gradient(#343434 .6px,transparent .6px);background-size:8px 8px;display:grid;place-items:center;animation:signal-reveal 1100ms ease both}
 .signal-label{font:18px monospace;color:#e8e8e8;letter-spacing:.12em;animation:signal-settle 650ms ease-out both}
 .intro-bypass{position:absolute;bottom:26px;left:26px;border:0;background:none;color:#ddd;font:12px/20px monospace;padding:12px 0;min-height:44px}
 @keyframes signal-settle{0%{transform:translateX(-9px);letter-spacing:.35em;opacity:.35}45%{transform:translateX(2px)}100%{transform:none;letter-spacing:.12em;opacity:1}}
 @keyframes signal-reveal{0%,65%{opacity:1}100%{opacity:0}}
</style>
