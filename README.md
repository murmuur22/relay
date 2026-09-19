# WE relay — local hybrid desktop prototype

Product name: **Relay**. Full name: **Wicked Evil relay**; short brand: **WE relay**. The project lives in `projects/relay` and uses npm package name `we-relay`. It shares its name with the intended host VM, but the desktop application and VM remain distinct.

The technical rename changes the session cookie to `relay_session`; unlock again after restarting. Existing layout and isolated library directories remain in place. The understated desktop appearance is unchanged.

A small place for your digital things. The desktop keeps the character of Robbie's Wicked project: black dotted workspace, compact white-bordered windows, terminal/pixel typography, top path/clock bar, shortcuts and a bottom dock. It is a working hybrid prototype, not a production remote-access service.

## What runs where

- **Parcels — native:** actual bundled Parcels UI runs in your browser. Choose local files and download a real ZIP onto that same device.
- **Keepsakes — native:** actual adapted Keepsakes UI runs in your browser and talks through Relay to an isolated Python process/library. Upload local images and save notes without streaming a file picker.
- **Notes Lab and Signal Lab — streamed:** real sandbox-enabled headless Chromium pages, in independent contexts, send JPEG frames over authenticated WebSockets. Typing/pointer/wheel input goes back to the focused page. These are explicitly synthetic test apps, not connections to Journalmax or live home dashboards.

Only trusted first-party apps are served natively on Relay's origin. This is not an untrusted-plugin sandbox. Streamed apps are currently a fixed registry of synthetic pages; outside navigation/fetch/WebSockets and popups are blocked. There is no arbitrary URL launcher.

## Public source checkout

Repository: https://github.com/murmuur22/relay

```sh
git clone https://github.com/murmuur22/relay.git
cd relay
```

This is a development prototype, not a production deployment or installable release. Private planning documents, runtime credentials, libraries, generated screenshots and reference font binaries are excluded. Fresh checkouts use system font fallbacks; the local reference fonts have not been cleared for redistribution. The existing bundled integrations remain test/demo functionality, not authorization to deploy them.

No project-wide open-source license has been selected yet. Public visibility does not itself grant an open-source license; third-party dependencies retain their own terms. See `THIRD_PARTY_NOTICES.md`.

## Run locally

Prerequisites: Node.js (tested with v26.8.1), Python 3.11 and uv. The application files and isolated integrations are already prepared here.

From this folder:

```sh
npm ci
npm run setup
npm run build
npm start
```

In another terminal in this folder, **once after starting the gateway**:

```sh
npm run open
```

That opens the protected one-time local bootstrap URL without printing its secret. After unlocking, use http://127.0.0.1:4180 in that same browser. The bootstrap file is `.runtime/bootstrap-url.txt`; treat it as a credential and never paste it into Discord, screenshots, a repo or an issue. If another browser already consumed the token, restart the prototype to generate a fresh one. Restart invalidates previous login cookies.

Gateway binds **127.0.0.1:4180**. The isolated Keepsakes service binds **127.0.0.1:4181**. `PORT` and `KEEPSAKES_PORT` can select other unused ports. An occupied Keepsakes port causes a safe startup refusal, not attachment to another library. Stop the gateway with Ctrl+C; it shuts down its own browser and native subprocess. Do not kill unrelated app processes.

Use the compiled gateway for the real app. Vite on4182 is frontend development/mock-fixture tooling, not a production or authenticated deployment path; proxy Origin handling is intentionally not relaxed for it.

## Desktop controls

- App shortcuts launch or restore one window per app.
- Drag title bars, resize lower corners, maximize/restore, minimize to the dock, reload or close.
- Quick Nav remains available when a window covers desktop icons.
- Native iframes remain mounted when minimized, preserving their live form state during that browser session.
- Minimized/disconnected streamed views stop capture. A bounded disconnect grace period can retain the remote page; closing releases it.
- Saved geometry/visibility survives a gateway restart. Unsaved streamed forms, active browser sessions and native file selections do **not** survive every restart/reload. This is not crash-proof session recovery.
- Streamed pixels are not an accessible remote DOM. Keyboard/text composition support is a prototype, not a guarantee for every browser, language, passkey or application. Stream paste/composition is capped at 4096 UTF-16 units per action, truncated without splitting a codepoint and sent in bounded chunks; it is not an unrestricted clipboard bridge. Native apps keep ordinary browser clipboard behavior.

## Storage and privacy

`.runtime/` contains protected owner bootstrap/session-related state and saved layout. `.data/keepsakes/` is Relay's separate native library. Neither is the original Keepsakes library. Parcels processes its files in the client browser and does not upload them to Relay.

No production service, Journalmax data, home-network policy or upstream project was changed. Native code snapshots are under `integrations/`; provenance is recorded in `integrations/provenance.json`. Rebuild/setup operates on those copies. `tools/prepare-native.py` is a maintenance import helper requiring the sibling source repositories and pinned commits—not an ordinary startup command.

This project is on a Desktop that may sync through iCloud. Runtime files and the library should be moved to deliberately protected non-synced storage before sensitive use; gitignore is not a cloud-sync privacy control. Do not put real private content into this demonstration until storage and deployment are reviewed.

## Tests

After setup/build:

```sh
npm test
```

This runs backend tests, window-geometry tests, and the actual Svelte+gateway integration. The full integration starts a fresh authenticated gateway, downloads a real 512KiB random-file ZIP from embedded Parcels and compares its bytes, uploads synthetic artwork to isolated Keepsakes and edits notes, tests two real remote pages/input isolation, pause/resume, reconnect and gateway-only client HTTP traffic. Temporary test libraries are separate and cleaned up.

For the UI-only mocked fixture (not proof of remote streaming), start `npm run dev` separately and run `node tests/frontend/mock-browser.mjs`. Any artifacts prefixed mock are explicitly not final functional evidence.

For a repeatable short streaming benchmark:

```sh
npm run benchmark
```

See `docs/benchmark-results.json` and `docs/benchmark-results.md`. Do not substitute send-to-frame-decode age for input-to-visible latency. Tests use synthetic files and pages, never journal content. Screenshots from real integration are under `screenshots/`.

## What is deliberately unfinished

- No Tailscale Serve deployment, Debian/GPU qualification or production Docker/release pipeline. Public source hosting is for continued development only.
- No real Journalmax/Proxmox/home-service connection, multi-user isolation, persistent third-party login profiles or arbitrary internet browser.
- No file-transfer bridge for streamed third-party apps; the working upload/download path is the native first-party mode.
- The local access gate is not a complete production identity/session system. No public exposure or router forwarding.
- Visible unfocused streams are not yet separately throttled; minimized capture is paused. Native apps follow browser scheduling rather than server capture control.
- The recorded benchmark is a short local synthetic workload, not the PDF's hour-long/WAN/Safari acceptance suite. Large native uploads and mobile/IME behavior need broader qualification.
- Native service startup is currently a gateway startup dependency. Runtime native failures do not grant host-management access; automatic restart/recovery policy remains future work.
- No Docker socket, no browser debugging port exposed to clients, no service restart/delete controls.
- Reference fonts are copied for local visual review; redistribution rights and the project's software license remain unreviewed. Do not publish the font bundle as though it is already licensed for distribution.

The purpose of this version is to prove the hybrid experience while keeping your original desktop design recognizable. It does not claim the full private-service-desktop brief is complete.
