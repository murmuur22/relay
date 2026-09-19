# Relay visual direction and reference assets

Primary surface: desktop / operate, with native app content and inspected remote streams. This is not a marketing landing page or an equal-weight dashboard tile grid.

The local prototype deliberately follows Wicked's inspected source rather than replacing it with a generic contemporary dashboard:

- Black/stone dotted workspace and compact path/clock top bar.
- Thin pale window borders, compact title strips, corner resize affordance and explicit focus/stacking.
- Pixel/terminal headings, monochrome service icons and a bottom quick-nav/window dock.
- App content remains visually independent inside its frame. Native Parcels and Keepsakes keep their own appearance controls.
- Locally applied drag/resize with debounced gateway persistence, not remote dragging of an entire operating system.

Reference: https://github.com/murmuur22/wicked at ee337dfb600afb454b36a8e4fd59187297b1dd4d. Relevant source was Desktop.svelte, Window.svelte, WindowShortcut.svelte, the user-route layout, app.css and tailwind.config.js. The old production app was not executed, so this is a source-informed recreation, not a pixel-perfect screenshot match.

Locally copied reference fonts:
- public/fonts/SometypeMono-Medium.ttf
- public/fonts/terminal-grotesque.ttf
- public/fonts/VCR_OSD_MONO_1.001.ttf

Redistribution terms have not been verified. Keep these as local review assets until licensing is documented or suitable licensed replacements are selected. The user owns the source project but that alone does not establish third-party font redistribution rights.

Screenshots under screenshots/ are from actual integration against the gateway and native/streamed applications. Images under tests/frontend/artifacts/ prefixed mock are explicitly UI test fixtures and must not be presented as live remote-app proof.

The desktop is visually unbranded: no large product wordmark, background signature or repeated working name. The top bar reads ~/desktop, the browser title is Private desktop, and the only maker attribution is a small 'Made by Wicked Evil Incorporated' footer. The chosen product name is Relay, branded Wicked Evil relay / WE relay. The rename does not add large logos or repeated corporate branding. Layout is usable at narrow widths through one focused window, but desktop is the primary target and the pixel-stream accessibility/IME limitations remain documented.
