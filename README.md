# WE relay — local hybrid desktop prototype

Product name: **Relay**. Full name: **Wicked Evil relay**; short brand: **WE relay**. The project lives in `projects/relay` and uses npm package name `we-relay`. It shares its name with the intended host VM, but the desktop application and VM remain distinct.

The session cookie is `relay_session`. Accounts and service permissions persist; restarting invalidates login sessions. The understated desktop appearance remains, with a light login panel and a Navigation start menu.

A small place for your digital things. The desktop keeps the character of Robbie's Wicked project: black dotted workspace, compact white-bordered windows, terminal/pixel typography, top path/clock bar, shortcuts and a bottom dock. It is a working hybrid prototype, not a production remote-access service.

## What runs where

- **Parcels — native:** actual bundled Parcels UI runs in your browser. Choose local files and download a real ZIP onto that same device.
- **Keepsakes — native, admin-only:** actual adapted Keepsakes UI runs in your browser and talks through Relay to an isolated Python process/library. This is one shared admin library, not a tenant-isolated library. Ordinary users cannot access it, even if a grant includes its ID.
- **Notes Lab and Signal Lab — streamed:** real sandbox-enabled headless Chromium pages, in independent contexts, send JPEG frames over authenticated WebSockets. Typing/pointer/wheel input goes back to the focused page. These are explicitly synthetic test apps, not connections to Journalmax or live home dashboards.

Only trusted first-party integrations are served on Relay's own origin. Admins can now register HTTP(S) web apps using **Control Panel → Apps → Add app**: choose Native or Streamed, enter name/address/icon, test and preview the connection, select access, then review and save. Native web apps run directly in the visitor's browser (sandboxed desktop frame or separate tab); streamed web apps run in isolated Relay browser contexts with approved-origin outbound requests. Existing bundled entries and grants are preserved. No Clippings integration was added. See [Web apps and connection boundaries](docs/web-apps.md) before connecting sensitive apps.

## Version and changelog

The current source version is defined in `package.json` and shared through `version.js`. It appears quietly in the desktop/login footer, in every user's Profile settings (including narrow screens), and in administrator System diagnostics. See [CHANGELOG.md](CHANGELOG.md) for the full versioned history and update policy. Version numbers do not imply production deployment; new changes are recorded under Unreleased until grouped into a version.

## Optional application gateway — 0.6.0 candidate

Gateway mode delivers configured apps' HTTP/media/WebSocket traffic through Relay while the visitor's browser renders them in isolated desktop windows. It is different from direct Native embedding and screenshot Streaming. Visitors still use their own upstream app accounts; Relay grants are not single sign-on.

The installed startup path can read an explicit protected `RELAY_GATEWAY_CONFIG` JSON file. The administrator supplies HTTPS certificates, same-site isolated desktop/app names, listener settings and fixed upstream destinations. With Internet-reachable browser-trusted HTTPS, visitors do not need direct access or a VPN to those upstream services. LAN/VPN-only configurations remain an administrator choice; purchased domains are not mandatory. **Updating the runtime does not provision DNS, certificates, firewall rules, or public exposure.** Gateway is disabled when configuration is absent.

Read [gateway deployment](docs/gateway-deployment.md) for exact prerequisites, supported target configuration, security boundaries and rollback. Keep the existing private management URL for the independent updater; its handoff through the new HTTPS edge is not supported. The feature remains experimental and app/browser compatibility is limited to recorded tests—not every website, Safari, transcoding, large libraries or Internet load.

For the prepared development Mac's synthetic Jellyfin presentation, see [local demo](docs/jellyfin-demo.md). That fixture uses process-local test certificate acceptance, not production trust.

## Public source checkout

Repository: https://github.com/murmuur22/relay

```sh
git clone https://github.com/murmuur22/relay.git
cd relay
```

This is an early private self-hosted desktop. Linux x64 release packaging provides separate Relay-runtime and updater-control-plane archives; prereleases remain qualification candidates until explicitly promoted. Publication does not install anything on a server. Private planning documents, runtime credentials, libraries, generated screenshots and reference font binaries are excluded. Fresh checkouts use system font fallbacks; the local reference fonts have not been cleared for redistribution. Bundled integrations below remain development/test functionality, not part of the standalone server payload.

Relay is licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses and notices; see `THIRD_PARTY_NOTICES.md`. Private reference fonts remain excluded.

## Relay-only installation

See [releases](https://github.com/murmuur22/relay/releases), [Linux installation](deploy/README.md), and [artifact verification](updater/release/README.md). Downloading and verifying official public artifacts does **not** require a GitHub account or login. The pinned repository/workflow identifies the trusted publisher, not an allowed installer identity.

Fresh Linux x64/systemd installations use non-login `relay` and `relay-updater-web` accounts plus a narrowly scoped root broker. The installer defaults to inspection and requires explicit `--apply` for host changes; it refuses existing conflicting accounts, paths, units or state. Node/Python/Pillow/gh and Chromium system libraries are operator prerequisites. Loopback plus SSH forwarding remains the default. Version 0.4.1 added explicit `--private-lan CANONICAL_IP` for an assigned RFC1918 IPv4 address. New installations now use Relay port 4180 and updater port 4191 (Safari blocks the old Relay default 4190), retaining exact Host/Origin and authentication checks. Runtime updates preserve existing operator configuration and do not replace the independent control plane. This is trusted-network HTTP, not end-to-end TLS; no proxy, DNS, router, firewall or Tailscale changes are configured.

For a private server installation without Parcels, Keepsakes or synthetic apps, use `RELAY_PROFILE=standalone`, a fresh absolute `RELAY_STATE_DIR`, and an operator-supplied Python/Pillow interpreter through `RELAY_ICON_PYTHON`. `npm run setup:standalone` installs only Chromium and verifies Pillow. It does not install/start the bundled integrations. See [standalone deployment](deploy/README.md) for the systemd template, private forwarding, qualification and rollback boundaries.

Development mode remains the default for the commands below and retains the bundled test integrations. Do not copy development account/registry state into standalone mode; incompatible builtin entries are refused, not silently removed.

## Independent administrator updater — 0.4.0

An **Updater** system shortcut opens a trusted, read-only **desktop window** for active administrators. Browse releases, notes and current status alongside the Three.js chamber. It is not an editable web-app registry entry, streamed page or arbitrary same-origin iframe. It requires a configured updater broker; normal development commands do not install or enable privileged maintenance services.

**Start update** opens a separate maintenance tab carrying the selected release for review. Installation does not begin until the administrator explicitly confirms and enters the current password in that tab. A blocked/closed tab or failed launch cannot start an update. Keeping execution and progress in the independent service lets that tab remain available when Relay restarts. Desktop window position/size are local to the current page session; a private app link can reopen the browser window after reload.

The monochrome Three.js chamber gathers fragments using received artifact bytes and displays server-reported verification, activation, restart and recovery phases. Spiral trails illustrate activity, not network speed or whole-update progress. Device/account reduced motion and missing WebGL retain functional controls. Monitoring survives Relay shutdown; each mutation still requires a current Relay administrator session and password confirmation.

Build the independent package with `npm run setup:updater` (or `npm run build:updater` after dependencies are installed). Run `npm run test:updater`, then the compiled HTTP/real disposable fixture tests documented in [updater UI](updater/ui/README.md). The root `npm test` also covers the launcher and maintenance bridge. See [operator boundaries](updater/deploy/README.md) before any installation: Linux/systemd, genuine release attestation and existing-state migration remain deployment gates, not established by local fixtures. No production updater has been enabled by this development work.

## Run locally (development profile)

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

## Motion and first-run setup

Relay includes a short monochrome arrival sequence with **[ESC] BYPASS INITIALIZATION**. Escape, click or tap bypasses only decoration; covered controls are inert while real authentication discovery continues. Login, desktop, windows and Navigation have restrained motion. Profile provides independent Intro animation and Interface animations controls, and device reduced-motion settings take priority.

New installations guide the initial administrator from password creation into adding the first app or choosing Set up later. Existing accounts are not forced through setup. First-app progress is server-backed so interrupted responses, retries and reloads do not duplicate registration. See [motion and onboarding](docs/motion-onboarding.md) for preferences, migration and rollback boundaries. These features are included in source version 0.3.0; publication and deployment are separate actions.

## Personal desktop and private links

Each account can create/nest folders, drag shortcuts into folders or snapped grid positions, and change its own shortcut names/icons. Right-click menus have keyboard and touch alternatives; custom PNG/JPEG/WebP icons are normalized and served privately. These are personal presentation overrides, not global app or permission changes.

Home/Desktop/folder breadcrumbs are clickable links. Readable `/desktop/...` paths use stable short keys, and selected/maximized apps are represented in the query string. Reload, login and Back/Forward preserve the private destination; normal/maximized transitions retain native iframe state. These URLs do not publish an app or grant access to another account.

See [personal desktop behavior](docs/personal-desktop.md) for limits and [public sharing proposal](docs/public-sharing-plan.md) for the separate, unimplemented publication layer.

## Desktop controls

- App shortcuts launch or restore one window per app.
- Drag title bars, resize lower corners, maximize/restore, minimize to the dock, reload or close.
- Streamed windows have Back/Forward buttons for their actual remote page history, separate from the desktop URL. Disabled buttons mean no history in that direction or navigation is in progress. Navigation failures show a query-free recovery notice; use Back or Reload. Native cross-origin iframe history is not controllable by Relay: use the site's navigation or **Open in new tab**, without bypassing embedding headers or sandbox restrictions.
- Navigation remains available when a window covers desktop icons. It contains authorized applications, the current user, Profile settings, Sign out, and an admin-only Control Panel.
- Account/password edits require the current password. Password changes revoke all of that user's sessions; admin password resets require a new password before app access. **Show app status** is an independent per-account preference, on by default and saved without a password. Off hides dots and status text and stops this client's status probes, without changing access. It persists across sessions and restarts.
- Control Panel groups Users, Apps and System into separate pages. Searchable tables lead to focused editors; app removal requires confirmation. The five-step wizard preserves drafts across tabs and offers cancellable connection checks/previews. System diagnostics use a readable grid and resource-limits table. Profile/settings keep the desktop's neutral palette; only status lights use semantic color.
- Control Panel creates/disables users, edits roles/grants, resets passwords, registers/edits/enables/disables/removes apps, and shows bounded process/session/resource diagnostics. It cannot control the host, Docker, service processes, updates or restarts. Last-active-admin removal is rejected.
- Status observations identify **this device** or **Relay**, with check time and detail on hover/focus. Reliable client CORS checks can confirm native reachability; a blocked client check is Unknown and may fall back to explicitly labelled Relay evidence. Server checks do not prove client connectivity, successful login or full app health. Unopened synthetic demos remain Unknown. HTTP error responses and network failures are distinguished; no iframe-load event is used as health evidence.
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

- No Tailscale Serve/public-Internet deployment or production Docker image. Linux x64 release packaging and guarded systemd qualification are provided; consult `TEST_REPORT.md` and the actual release status for executed evidence. Debian/GPU, WAN and operator-specific deployment still require target checks.
- No live Journalmax/Proxmox/home-service connection has been configured or tested. HTTP(S) web app registration works against synthetic local fixture sites, but is not a promise of universal website compatibility. Persistent third-party browser profiles, general-purpose browsing, streamed WebSockets/audio/file-transfer bridges and unrestricted popups are not implemented.
- No file-transfer bridge for streamed third-party apps; the working upload/download path is the native first-party mode.
- Persistent local accounts and server-enforced ACLs are implemented, but this is not a production identity service or a hostile multi-tenant platform. No public exposure, router forwarding, MFA, recovery workflow or external identity provider.
- Visible unfocused streams are not yet separately throttled; minimized capture is paused. Native apps follow browser scheduling rather than server capture control.
- The recorded benchmark is a short local synthetic workload, not the PDF's hour-long/WAN/Safari acceptance suite. Large native uploads and mobile/IME behavior need broader qualification.
- Native service startup is currently a gateway startup dependency. Runtime native failures do not grant host-management access; automatic restart/recovery policy remains future work.
- No Docker socket, host shell or browser debugging port is exposed. Removing a registry entry removes Relay access, not an installed upstream service or its data.
- Reference fonts are copied for local visual review; redistribution rights and the project's software license remain unreviewed. Do not publish the font bundle as though it is already licensed for distribution.

Streaming hides direct client network access but grants the capabilities of the upstream browser session. It is not a complete security boundary: sharing an upstream admin login would share its privileges. Chromium remains sandbox-enabled and CDP private. Native apps are trusted same-origin code; direct loopback access to the native subprocess assumes a trusted machine. Keepsakes needs proper tenant isolation before ordinary-user access can be considered.

The purpose of this version is to prove the hybrid experience and local account/service control while keeping the original desktop design recognizable. It does not claim the full private-service-desktop brief or production deployment is complete. No new image/font assets were imported for the login design; see `docs/login-lineage.md`.
