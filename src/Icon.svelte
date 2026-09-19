<script>let {name}= $props();</script>
<svg data-icon={name} viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter" aria-hidden="true">
{#if name==='parcels'}<path d="m6 13 18-8 18 8v23l-18 8-18-8Z M6 13l18 8 18-8 M24 21v23 M15 9l18 8v9l-7 3v-9"/><path d="m10 30 7 3m-7 1 5 2"/>
{:else if name==='keepsakes'}<path d="M8 8h28v32H8Z M12 4h28v32 M8 31l9-10 7 7 5-5 7 8"/><circle cx="27" cy="17" r="3"/>
{:else if name==='globe'}<circle cx="24" cy="24" r="19"/><ellipse cx="24" cy="24" rx="9" ry="19"/><path d="M5 24h38 M9 13h30 M9 35h30"/>
{:else if name==='folder'}<path d="M5 13h16l4 5h18v23H5Z M5 13V8h14l5 5h16v5"/>
{:else if name==='media'}<path d="M5 8h38v32H5Z M19 16l14 8-14 8Z"/>
{:else if name==='terminal'}<path d="M4 8h40v32H4Z M11 17l7 7-7 7 M23 31h12"/>
{:else if name==='notes-lab'||name==='notes'}<path d="M10 4h20l9 9v31H10Z M30 4v10h9 M16 22h17 M16 28h17 M16 34h11"/>
{:else if name==='archive'}<path d="M5 6h38v9H5Z M8 15v27h32V15 M18 23h12"/>
{:else if name==='code'}<path d="m16 12-12 12 12 12 M32 12l12 12-12 12 M28 6l-8 36"/>
{:else if name==='games'}<path d="M13 15h22l8 23-6 4-9-10h-8l-9 10-6-4Z M11 23h12 M17 17v12"/><circle cx="32" cy="21" r="2"/><circle cx="36" cy="27" r="2"/>
{:else if name==='music'}<path d="M19 35V10l22-5v25 M19 17l22-5"/><ellipse cx="12" cy="36" rx="7" ry="5"/><ellipse cx="34" cy="31" rx="7" ry="5"/>
{:else if name==='photo'}<path d="M5 12h10l4-6h10l4 6h10v28H5Z"/><circle cx="24" cy="26" r="9"/>
{:else if name==='home'}<path d="m3 23 21-19 21 19 M9 18v25h12V29h8v14h10V18"/>
{:else if name==='star'}<path d="m24 3 6 14 15 2-11 11 3 15-13-8-13 8 3-15L3 19l15-2Z"/>
{:else if name==='tools'}<path d="m28 5 1 11 8 5 9-7c1 12-7 18-17 13L12 44l-8-8 18-17C18 10 22 6 28 5Z"/>
{:else}<path d="M4 8h40v29H4Z M16 44h16 M24 37v7 M8 25h7l4-10 7 16 5-12 4 6h5"/>{/if}
</svg>
