<script>let {name}= $props();</script>
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter" aria-hidden="true">
{#if name==='parcels'}<path d="m6 13 18-8 18 8v23l-18 8-18-8Z M6 13l18 8 18-8 M24 21v23 M15 9l18 8v9l-7 3v-9"/><path d="m10 30 7 3m-7 1 5 2"/>
{:else if name==='keepsakes'}<path d="M8 8h28v32H8Z M12 4h28v32 M8 31l9-10 7 7 5-5 7 8"/><circle cx="27" cy="17" r="3"/>
{:else if name==='notes-lab'}<path d="M10 4h20l9 9v31H10Z M30 4v10h9 M16 22h17 M16 28h17 M16 34h11"/>
{:else}<path d="M4 8h40v29H4Z M16 44h16 M24 37v7 M8 25h7l4-10 7 16 5-12 4 6h5"/>{/if}
</svg>
