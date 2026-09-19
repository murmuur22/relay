<script>let {name}= $props();</script>
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter" aria-hidden="true">
{#if name==='parcels'}<path d="m6 13 18-8 18 8v23l-18 8-18-8Z M6 13l18 8 18-8 M24 21v23 M15 9l18 8v9l-7 3v-9"/><path d="m10 30 7 3m-7 1 5 2"/>
{:else if name==='keepsakes'}<path d="M8 8h28v32H8Z M12 4h28v32 M8 31l9-10 7 7 5-5 7 8"/><circle cx="27" cy="17" r="3"/>
{:else if name==='globe'}<circle cx="24" cy="24" r="19"/><ellipse cx="24" cy="24" rx="9" ry="19"/><path d="M5 24h38 M9 13h30 M9 35h30"/>
{:else if name==='folder'}<path d="M5 13h16l4 5h18v23H5Z M5 13V8h14l5 5h16v5"/>
{:else if name==='media'}<path d="M5 8h38v32H5Z M19 16l14 8-14 8Z"/>
{:else if name==='terminal'}<path d="M4 8h40v32H4Z M11 17l7 7-7 7 M23 31h12"/>
{:else if name==='notes-lab'||name==='notes'}<path d="M10 4h20l9 9v31H10Z M30 4v10h9 M16 22h17 M16 28h17 M16 34h11"/>
{:else}<path d="M4 8h40v29H4Z M16 44h16 M24 37v7 M8 25h7l4-10 7 16 5-12 4 6h5"/>{/if}
</svg>
