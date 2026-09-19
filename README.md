# WE relay — local hybrid desktop prototype

Product name: **Relay**. Full name: **Wicked Evil relay**; short brand: **WE relay**. The project lives in `projects/relay` and uses npm package name `we-relay`. It shares its name with the intended host VM, but the desktop application and VM remain distinct.

The session cookie is `relay_session`. Accounts and service permissions persist; restarting invalidates login sessions. The understated desktop appearance remains, with a light login panel and a Navigation start menu.

A small place for your digital things. The desktop keeps the character of Robbie's Wicked project: black dotted workspace, compact white-bordered windows, terminal/pixel typography, top path/clock bar, shortcuts and a bottom dock. It is a working hybrid prototype, not a production remote-access service.

## What runs where

- **Parcels — native:** actual bundled Parcels UI runs in your browser. Choose local files and download a real ZIP onto that same device.
- **Keepsakes — native, admin-only:** actual adapted Keepsakes UI runs in your browser and talks through Relay to an isolated Python process/library. This is one shared admin library, not a tenant-isolated library. Ordinary users cannot access it, even if a grant includes its ID.
- **Notes Lab and Signal Lab — streamed:** real sandbox-enabled headless Chromium pages, in independent contexts, send JPEG frames over authenticated WebSockets. Typing/pointer/wheel input goes back to the focused page. These are explicitly synthetic test apps, not connections to Journalmax or live home dashboards.

Only trusted first-party apps are served natively on Relay's origin. This is not an untrusted-plugin sandbox. Admins manage entries from the native and synthetic templates; streamed requests are restricted to their exact synthetic document URL, other requests/WebSockets are blocked, popups closed, and downloads disabled. There is no arbitrary URL launcher or actual LAN service registration. No Clippings integration was added.

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

In another terminal in this folder:

```sh
npm run open
```

On an uninitialized installation this opens `.runtime/setup-url.txt`, a local owner-only enrollment credential carried in a URL fragment (not a request URL). Choose a unique 14–128 character password for username `admin`. The credential is removed after enrollment; neither restarting nor the old `/bootstrap` route grants access to an initialized account. There is no default password or startup backdoor. Later `npm run open` opens the ordinary login URL from `.runtime/open-url.txt`. Keep setup credentials out of screenshots, logs, issues and source control. The login page clears the fragment from browser history.

Accounts use asynchronous scrypt with unique random salts and timing-safe hash comparison. Login failures are generic, with a bounded gateway-wide five-failure/60-second throttle (appropriate only for this loopback prototype). API JSON bodies are capped at 16KiB; application writes are serialized with a maximum queue of 32. Cookies are HttpOnly, SameSite=Strict, rotated on login, and expire after eight hours. They are not Secure on this deliberately HTTP-only loopback origin. Mutations, including enrollment/login/logout, require exact Origin and CSRF; Host checks are strict. A corrupt account/registry file refuses startup rather than silently reopening enrollment. There is no password recovery backdoor: retain a protected backup and preferably another admin account.

Gateway binds **127.0.0.1:4180**. The isolated Keepsakes service binds **127.0.0.1:4181**. `PORT` and `KEEPSAKES_PORT` can select other unused ports. An occupied Keepsakes port causes a safe startup refusal, not attachment to another library. Stop the gateway with Ctrl+C; it shuts down its own browser and native subprocess. Do not kill unrelated app processes.

Use the compiled gateway for the real app. Vite on4182 is frontend development/mock-fixture tooling, not a production or authenticated deployment path; proxy Origin handling is intentionally not relaxed for it.

## Desktop controls

- App shortcuts launch or restore one window per app.
- Drag title bars, resize lower corners, maximize/restore, minimize to the dock, reload or close.
- Navigation remains available when a window covers desktop icons. It contains authorized applications, the current user, Profile settings, Sign out, and an admin-only Control Panel.
- Profile edits require the current password. Password changes revoke all of that user's sessions; admin password resets require a new password before app access.
- Control Panel groups Users, Services and System into separate pages. Searchable user/service tables lead to focused editors; service removal requires confirmation. System diagnostics use a readable grid and resource-limits table. Profile/settings keep the desktop's neutral palette; only service status lights use semantic color. Unsaved editor drafts stay in memory when switching tabs and are discarded on Cancel/close.
- Control Panel creates/disables users, edits roles/grants, resets passwords, adds/labels/enables/disables/removes template service entries, and shows actual bounded process/session/resource diagnostics. It cannot control the host, Docker, service processes, updates or restarts. Last-active-admin removal is rejected.
- Desktop status dots include readable Online/Offline/Unknown text and observation age; observations older than 15 seconds are marked stale. Native health checks use static-asset readiness and a fixed Keepsakes probe with a one-second timeout, cached five seconds. Stream status means synthetic browser readiness, not upstream LAN health; no running page is Unknown, never evidence that an upstream service is offline.
- Native iframes remain mounted when minimized, preserving their live form state during that browser session.
- Minimized/disconnected streamed views stop capture. A bounded disconnect grace period can retain the remote page; closing releases it.
- Saved geometry/visibility survives a gateway restart. Unsaved streamed forms, active browser sessions and native file selections do **not** survive every restart/reload. This is not crash-proof session recovery.
- Streamed pixels are not an accessible remote DOM. Keyboard/text composition support is a prototype, not a guarantee for every browser, language, passkey or application. Stream paste/composition is capped at 4096 UTF-16 units per action, truncated without splitting a codepoint and sent in bounded chunks; it is not an unrestricted clipboard bridge. Native apps keep ordinary browser clipboard behavior.

## Storage and privacy

`.runtime/accounts.json` atomically stores users, password hashes and the service registry with mode 0600 in a 0700 runtime directory. Layouts live in `.runtime/users/<random-internal-id>/layout.json`, not username-derived paths. Account and layout writes are serialized, with atomic rename and recoverable write queues. Accounts/grants/registry survive restart; sessions do not. Separate login sessions get separate window managers and Chromium contexts, including when two sessions belong to the same user. Tabs sharing the same login cookie share that session. Saved layout is per user: concurrent sessions are last-save-wins, not live layout synchronization. Remote cookies/forms are ephemeral and never shared across login sessions.

Limits are four login sessions per user, sixteen globally, two reserved stream windows per user across sessions, and eight globally. A minimized or disconnected window still reserves a slot until closed; restored windows are admitted only within those limits. There are at most 64 users and 64 service entries. Duplicate stream templates have separate contexts; native templates permit only one registry entry each. User security changes revoke sessions, sockets and active native responses. Registry edits close that entry's streams/native responses and revoke affected non-admin sessions, while admins retain Control Panel access. Subsequent requests/input are denied; already downloaded client content cannot be recalled. Desktop polling removes revoked content within approximately five seconds when connected.

Migration: the old `.runtime/layout.json` is left untouched, but not automatically assigned to a new identity. New accounts start with empty layouts. An operator may, with the gateway stopped and after making a backup, copy the legacy layout to the enrolled admin's internal-ID layout path; only currently registered/granted applications restore. Old bootstrap credentials are retired on startup. No existing `.data` library is moved, imported or deleted. `.data/keepsakes/` remains Relay's separate admin library, not an original upstream collection. Parcels handles selected files entirely in the client browser.

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
- No real Journalmax/Proxmox/home-service connection, external URL registration, persistent third-party login profiles or arbitrary internet browser. Synthetic templates are the supported streamed registry, not a claim of secure general browsing.
- No file-transfer bridge for streamed third-party apps; the working upload/download path is the native first-party mode.
- Persistent local accounts and server-enforced ACLs are implemented, but this is not a production identity service or a hostile multi-tenant platform. No public exposure, router forwarding, MFA, recovery workflow or external identity provider.
- Visible unfocused streams are not yet separately throttled; minimized capture is paused. Native apps follow browser scheduling rather than server capture control.
- The recorded benchmark is a short local synthetic workload, not the PDF's hour-long/WAN/Safari acceptance suite. Large native uploads and mobile/IME behavior need broader qualification.
- Native service startup is currently a gateway startup dependency. Runtime native failures do not grant host-management access; automatic restart/recovery policy remains future work.
- No Docker socket, host shell or browser debugging port is exposed. Removing a registry entry removes Relay access, not an installed upstream service or its data.
- Reference fonts are copied for local visual review; redistribution rights and the project's software license remain unreviewed. Do not publish the font bundle as though it is already licensed for distribution.

Streaming hides direct client network access but grants the capabilities of the upstream browser session. It is not a complete security boundary: sharing an upstream admin login would share its privileges. Chromium remains sandbox-enabled and CDP private. Native apps are trusted same-origin code; direct loopback access to the native subprocess assumes a trusted machine. Keepsakes needs proper tenant isolation before ordinary-user access can be considered.

The purpose of this version is to prove the hybrid experience and local account/service control while keeping the original desktop design recognizable. It does not claim the full private-service-desktop brief or production deployment is complete. No new image/font assets were imported for the login design; see `docs/login-lineage.md`.
