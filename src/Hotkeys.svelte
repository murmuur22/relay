<script>
 import {onMount} from 'svelte';
 import {catalog,matches} from './shortcuts.js';
 let {context='desktop',onclose}=$props();let dialog;
 onMount(()=>{const previous=document.activeElement;dialog.showModal();dialog.querySelector('button').focus();return()=>{dialog?.close();(previous?.isConnected&&previous!==document.body?previous:document.querySelector('[aria-label="Navigation"]'))?.focus();};});
</script>
<dialog bind:this={dialog} aria-label="Navigation Hotkeys" oncancel={e=>{e.preventDefault();onclose();}} onkeydown={e=>{if(matches('dismiss',e,'modal')){e.preventDefault();onclose();}}}>
 <h2>Navigation Hotkeys</h2><p>Current screen: {context==='folder'?'Folder':context==='desktop'?'Desktop':context}</p>
 <dl>{#each catalog(context) as shortcut}<div><dt><kbd>{shortcut.keys}</kbd></dt><dd>{shortcut.label}</dd></div>{/each}</dl>
 <p>While this helper is open: Escape closes it; Tab moves through its controls. Shortcuts apply only to focused Relay controls, never inside native frames or streamed app inputs.</p>
 <button onclick={onclose}>Close hotkeys</button>
</dialog>
<style>dialog{width:min(560px,calc(100vw - 24px));max-height:85dvh;overflow:auto;padding:24px;color:#fafaf9;background:#0c0a09;border:1px solid #a8a29e;font:inherit}dialog::backdrop{background:#0009}h2{font-size:16px}dl>div{display:flex;gap:20px;margin:12px 0}dt{min-width:140px}dd{margin:0}p{line-height:1.6;color:#a8a29e}button{border:1px solid #a8a29e;padding:10px}</style>
