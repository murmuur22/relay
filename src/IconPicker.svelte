<script>
 import Icon from './Icon.svelte';
 import {pixelIcons} from '../server/pixel-icons.mjs';
 let {choices=Object.keys(pixelIcons),selected,onchoose}=$props();
 let query=$state(''),group=$state('');
 let groups=$derived([...new Set(choices.map(id=>pixelIcons[id]?.group||'Legacy'))]);
 let filtered=$derived(choices.filter(id=>(!group||(pixelIcons[id]?.group||'Legacy')===group)&&((pixelIcons[id]?.label||id)+' '+(pixelIcons[id]?.group||'Legacy')).toLowerCase().includes(query.trim().toLowerCase())));
</script>
<section class="picker" aria-label="Icon library">
 <div class="filters"><label>Search icons<input type="search" bind:value={query}/></label><label>Icon group<select aria-label="Icon group" bind:value={group}><option value="">All groups</option>{#each groups as name}<option value={name}>{name}</option>{/each}</select></label></div>
 <p class="hint">Pixelarticons · free MIT set. Selected icon: {pixelIcons[selected]?.label||selected||'app default'}.</p>
 <div class="icon-grid">{#each filtered as id}<button type="button" aria-label={'Icon '+id} aria-pressed={selected===id} onclick={()=>onchoose(id)}><Icon name={id}/><span>{pixelIcons[id]?.label||id}</span></button>{/each}</div>
 {#if !filtered.length}<p role="status">No matching icons.</p>{/if}
</section>
<style>
 .picker{min-width:0}.filters{display:flex;flex-wrap:wrap;gap:12px}.filters label{flex:1;min-width:120px;font-size:12px}.filters input,.filters select{display:block;width:100%;padding:8px;margin-top:6px;color:#fafaf9;background:#0c0a09;border:1px solid #78716c;font:inherit}.hint{font-size:11px;color:#a8a29e}.icon-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:8px;max-height:240px;overflow:auto;padding:3px}.icon-grid button{display:flex;flex-direction:column;align-items:center;gap:8px;min-height:70px;border:1px solid #78716c;padding:8px 3px;font-size:10px;overflow-wrap:anywhere}.icon-grid button[aria-pressed=true]{background:#44403c;border-color:#fafaf9}.icon-grid button:focus-visible{outline:2px solid #fafaf9;outline-offset:-3px}.icon-grid :global(svg){width:24px;height:24px;flex:none}
</style>
