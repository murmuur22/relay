# Relay prototype verification

## 0.5.0 streamed navigation and upgrade preparation — local verification

A clean staged-tree export with fresh npm/uv setup passed both builds, the complete Relay backend/frontend suite and real hybrid integration, Python updater/deployment tests, and updater unit/browser suites. The staged publication audit excluded protected state, private paths, credentials and uncleared fonts. New deterministic browser fixtures verify multi-hop redirects at their actual destination origin, per-hop DNS/allowlist checks, redirect methods/cookies/CSP, long runtime URLs, bounded request bodies, remote Back/Forward, failed-navigation recovery, logout cancellation, and HTTP 204/replaced-navigation history behavior.

Independent review reproduced an HTTP 204 navigation leaving history busy; the correction tracks the current main-frame request so an obsolete abort cannot settle a newer load. Request body limits are also checked before extra decoding/concatenation, with missing/incomplete bodies rejected. Red/green regressions were executed for both corrections.

Independent re-review passed after those corrections, including real binary-body byte-integrity probes. A separate run of all four compiled navigation scenarios using WebKit as the client browser also passed (the remote streamed browser remains Chromium); this is local engine evidence, not a physical Safari-device certification.

A separate live Google probe through the updated isolated transport reached the real `/sorry/` unusual-traffic response after search rather than the previous proxy-failure blank page. That is redirect-delivery evidence, not proof of unrestricted Google search, anti-bot compatibility or every external resource origin. Native embedding protections and exact-origin approval remain unchanged; wildcards remain deferred.

Hosted jobs now cover the new navigation/body regressions and provide an explicit opt-in signed 0.4.2-to-candidate install/rollback using the unchanged installed old control plane, matching-state restoration and port 4180. Local harness tests do not establish actual signed Linux execution; publication/hosted results are recorded after execution. This preparation does not install the release on an operator VM.

## 0.4.2 updater systemd interface enumeration — local verification

A clean staged-tree export passed fresh dependency setup, both builds, the full Relay backend/frontend/hybrid integration suite, Python updater/deployment tests, and updater unit/browser suites. The narrow AF_NETLINK policy fix retains empty capability sets and NoNewPrivileges. The new hosted probe exercises actual interface enumeration under systemd and requires zero effective capabilities; its execution and signed dual-mode installation qualification are separate publication gates.

Version 0.4.2 subsequently passed hosted Linux preflight ([35470143668](https://github.com/murmuur22/relay/actions/runs/35470143668)), signed release build ([35470317526](https://github.com/murmuur22/relay/actions/runs/35470317526)), and both loopback/private-LAN signed initial-install qualifications ([35470507732](https://github.com/murmuur22/relay/actions/runs/35470507732)). The actual systemd interface-enumeration probe asserted zero effective capabilities. Public assets were anonymously verified against tag commit `5466bd50b3a756955ae9dbd6ceb3f5fde29e7af1` before stable promotion. These runs establish initial installation, not a second-signed-version upgrade.

The preceding 0.4.1 signed hosted qualification passed loopback but failed private-LAN updater startup (`uv_interface_addresses`, error 97). Version 0.4.2 corrects that service address-family restriction without weakening assigned-interface validation.

## 0.4.1 private-LAN mode and MIT license — local verification

Parent-run verification passed both builds, 105 backend tests, 55 frontend tests and full hybrid integration, 48 Python updater/deployment tests, 6 updater unit tests and 35 updater browser tests. Tests used actual assigned private interfaces for HTTP/WebSocket/browser traffic and the real disposable broker handoff, install/rollback and downtime-monitoring paths in both modes. A regression reproduced the independent updater accepting an unassigned bind up to `listen`; the fix rejects it before creating the listener. Scoped independent re-review found no remaining blocker.

MIT licensing was explicitly authorized. Root/UI package metadata and both release archives retain the license, with byte-preservation regressions. Upstream repository licensing and third-party notices are not silently replaced.

Private-LAN is explicit, standalone-only and restricted to an assigned canonical RFC1918 IPv4. Both services retain exact Host/Origin/CSRF and same-host/different-port checks. The default remains loopback. Trusted-network HTTP is not end-to-end TLS; no proxy/DNS/firewall/router/Tailscale changes are made by the mode. Hosted qualification and actual VM installation are separate gates recorded after execution.

## 0.4.0 published Linux release — hosted qualification

Public release: https://github.com/murmuur22/relay/releases/tag/v0.4.0 . Tag source commit: `f793f8060a0a056afd5be3db95a6141e40d98708`. Published as a prerelease, verified, then explicitly promoted to the latest non-prerelease. The two archives and their attested manifest were downloaded without credentials; local verification also pinned the exact source commit. The production release-discovery code subsequently returned `v0.4.0` with `verified: true` using its credential-free verifier.

Executed hosted evidence:
- Linux preflight and real distinct-mount systemd fixture: https://github.com/murmuur22/relay/actions/runs/35464188415 — passed. Actual mount IDs differed for install/state/control, successful install and explicit/failed-readiness rollback completed, and the state root inode stayed stable.
- Both Linux archives, real GitHub provenance and anonymous bundle verification: https://github.com/murmuur22/relay/actions/runs/35464349921 — passed.
- Anonymous download and installation of the actual published signed artifacts under systemd: https://github.com/murmuur22/relay/actions/runs/35464757485 — passed. Verified distinct UIDs/no-new-privileges, key/state access denial, ordinary admin authentication/ticket handoff, monitoring during stop, persistent maintenance across restarts, unexpected-version readiness rejection, and signed-baseline code/state restoration.

The first packaging run rejected the required Three.js license notice; the allowlist now admits that exact path while still rejecting unrelated text files. The first signed-install qualification correctly rejected the hosted runner's world-writable `/opt`; the disposable workflow now sets the required root-only parent mode rather than weakening installer checks. No tag or release artifact was rewritten for the runner setup adjustment.

Scope: Ubuntu 24.04 x64 hosted execution, plus the clean macOS checkout evidence below. Signed-baseline restoration and multi-version HMAC fixture recovery are distinct; no second-signed-release upgrade, host reboot/power-loss test, Debian-specific installed-browser proof or production VM deployment is claimed. The production VM and neighboring services were not changed.

## 0.4.0 public Linux release preparation — local evidence

A clean Git-index export with fresh dependency setup passed both builds, **99 backend tests, 53 frontend tests, full hybrid integration, 43 updater Python tests, 6 updater unit tests, 35 updater browser tests, and both compiled HTTP/disposable install/rollback smokes**. Private state, planning material, host references, credentials and unverified fonts were excluded by the staged-tree audit. Missing local font warnings use the documented public fallback; the Three.js chunk remains lazy-loaded.

Independent pre-publication review found no remaining source blocker after corrections for systemd cross-mount staging and mounted-state restoration. Candidates now stage within the install mount; state restoration retains its root inode and durable checkpoint through bounded no-follow content replacement. The initial installer verifies one GitHub-attested manifest and both payload hashes before account/config/unit changes. Anonymous verification uses a fresh private writable Sigstore cache with no inherited GitHub credentials. This source review and local fixture success do **not** establish hosted systemd success or a real GitHub signature.

Hosted gates are encoded in `.github/workflows/check.yml` (Linux preflight and actual mounted fixture lifecycle) and `.github/workflows/release.yml` (public prerelease, then explicit signed-install qualification). Source publication, valid attestation, signed initial enrollment under hardened systemd, stable promotion and production deployment are separate results. The initial qualification restores a genuine signed baseline; it does not invent a second signed version or claim full power-loss testing. See actual GitHub runs/release notes for subsequently completed hosted gates.

## In-desktop updater browsing → independent maintenance — previous Unreleased verification

Updater now opens a trusted native Svelte desktop window for release selection/notes, real broker status and the shared Three.js chamber. It supports one-window opening, Navigation/private routes, drag/resize/minimize/maximize, content focus, reload and local close. It is not registered with the server window/stream manager or embedded through a relaxed iframe policy. Start update opens a separate authenticated tab with the selected release for explicit final consent/password authorization; blocked/closed/denied launches make no install request.

Parent executed both builds, the full Relay suite (**99 backend tests, 52 frontend tests and real hybrid integration passed**), **16 Python broker/release/safety tests**, **6 updater unit tests**, **34 updater browser tests**, the compiled HTTP smoke and the real disposable installation/readiness-failure rollback smoke. The final parent runs passed; one earlier worker browser run encountered an in-flight test-route teardown race, followed by unchanged successful worker and parent reruns. Root build emits the expected size warning for the separately lazy-loaded Three.js chunk; it does not load with the initial desktop bundle.

Coverage includes read-bridge admin/Origin/CSRF/rate limits and revocation after broker awaits, real desktop-to-tab authentication, no popup until Start update, popup blocking/closure, denied/missing ticket, selected-target preservation and exact install payload after reload, continued independent monitoring after Relay logout/shutdown, multiwindow content focus, local close during held/rejected unrelated saves, pending-launch disposal, narrow floating-window container layout, static WebGL fallback and administrator revocation. Source review found the focus/close issues; their red regressions and fixes were verified, and scoped re-review reported no remaining blocker. Browser verification is Chromium, not physical-device/Safari qualification.

Only the validated non-secret reviewed version is retained in the independent tab's history state; no ticket, password or mutation capability is persisted there. Desktop geometry is local to the current page session; private URLs reopen the browser window, not its previous arbitrary dimensions. Missing selected releases require explicit reselection. The server-side desktop read capability is session-scoped and does not rotate the independent updater cookie.

Actual compiled screenshot: `screenshots/relay-updater-desktop.png` shows the normal floating browse window with visible Start update control. `screenshots/relay-updater-opened.png` shows the separately authenticated tab. Both use disposable accounts and fixture releases; no live server update was started for those captures. Logs are `/tmp/relay-browse-parent-regression.log`, `/tmp/relay-browse-parent-ui.log`, and `/tmp/relay-browse-parent-python.log`.

Source remains **0.3.0**, changes under `CHANGELOG.md` Unreleased, with pinned root Three.js dependency and no workspace-link packaging dependency. Nothing committed, pushed or deployed. All production/Linux/attestation limits below still apply.

## Independent administrator updater — previous Unreleased local verification

Source version remains **0.3.0** on `feat/admin-updater`; updater changes are recorded under Unreleased. The updater has its own web process, browser bundle and maintenance broker, with an administrator-only system launcher, single-use monitoring tickets and fresh-password mutation authorization. The Three.js chamber uses broker bytes/phases for assembly and progress, with explicitly decorative spiral trails, reduced-motion handling and a static WebGL fallback.

Executed locally against temporary synthetic state:

- `npm run build && npm test`: **98 backend tests, 50 frontend tests and the real hybrid integration passed**. Existing ZIP-byte comparison, native upload/notes, two independent remote pages, input isolation, pause/resume and reconnect remain passing.
- Independent UI suite: **4 unit tests and 30 Chromium browser tests passed** in parent-run verification. Coverage includes byte-driven geometry, all-packet trail continuity across loop wraps, real rendered motion versus frozen reduced-motion frames, narrow WebGL/static layouts, safe release text, action payload shapes, connectivity recovery, and permanent retirement of consent when release/job eligibility changes.
- Python broker/release/safety suite: **16 tests passed**, including actual disposable HTTP transfer, activation, matching-state rollback, cancellation, interrupted recovery, archive safety and allowlisted packaging.
- Compiled updater HTTP smoke passed real cookies/CSRF and action bridging with a synthetic broker endpoint. The separate compiled real-fixture smoke passed actual broker/service installation, deliberately failed readiness, restoration of the prior release and matching state, and continued monitoring after the test Relay gateway closed.
- Standalone qualification passed enrollment with an empty editable catalog/no native process, sandboxed client/server Chromium frames and typed input, configured Pillow private image normalization, and restart persistence with rejection of the old session.

Independent source review found and then accepted fixes for trail-wrap discontinuity and stale confirmation eligibility/target binding. New regressions were observed failing before implementation; the final scoped re-review reported no remaining security or logic concerns. This is a focused code review, not a production security audit.

The animated preview at `screenshots/updater-synthetic-motion.webm` is intentionally scripted visual evidence, not a real server update or speed measurement. Screenshot names distinguish synthetic UI states from actual disposable broker success/rollback. Desktop and narrow WebGL/static-fallback layouts were visually inspected. These ignored artifacts contain no real household data.

Limits: macOS/Chromium only. No new Git commit, push, GitHub Release or VM deployment. Real GitHub attestation, Linux/systemd/power-loss qualification, migration of an existing unverified nonempty installation, Safari and physical-device testing remain unverified. Disposable HMAC-signed fixtures do not establish production release provenance. The updater does not self-update.

## Version 0.3.0 standalone preparation — previous verification

Added a Relay-only profile with no builtin catalog/native process/routes, strict localhost-origin configuration, independent state/Python paths, Chromium-only setup, a nonroot bounded systemd template and a runtime-only qualification smoke. Development mode remains compatible with the existing native test integrations; standalone refuses incompatible development registry state instead of deleting it.

Parent executed build and full tests on macOS: **89 backend tests, 47 frontend tests and the real hybrid integration passed**. The standalone smoke also passed real empty-catalog enrollment, sandbox-enabled client/server Chromium frames and typed input, configured Pillow private PNG upload/read, and restart persistence with old-session rejection. No real production state is used by the smoke. Actual Debian/systemd qualification and coexistence checks are deployment steps, not inferred from these local results; see deploy/README.md and the operator's installation record.

## Personal desktop folders, appearance and private routing — previous verification

Branch: `feat/desktop-folders-routing`. Implemented per-user nested folders, grid-snapped shortcut moves, right-click/keyboard/touch actions, personal names/icons, normalized private raster uploads, clickable breadcrumbs and readable stable-key URLs. The existing maximize control persists restore geometry and is reflected in private app URLs. Global app definitions/grants are unchanged by personal customization. Public sharing remains a separate proposal in `docs/public-sharing-plan.md`.

Parent executed `npm run build && npm test`: **80 backend tests, 47 frontend tests and full hybrid integration passed**, then repeated fresh dependency setup/build/full tests from a clean Git-index export without private fonts or runtime state. Coverage includes real PNG/JPEG/WebP normalization/private reads/quotas, folder cycles/collisions/reparenting/persistence, revoked metadata/regrant, removed-history capacity recovery, private deep-link login, foreign/invalid routes, native form continuity, maximize/history/reload, keyboard/touch alternatives, and delayed responses/queued writes across account switches. Red regressions reproduced obsolete maximize after newer folder/app navigation, hidden unavailable-route recovery controls and malformed slugs after Unicode expansion; fixes passed. The existing ZIP-byte, native data, streaming, motion and onboarding suites remain passing.

Independent source re-review found no blocking issue after those fixes. Desktop folder/path, context-menu, icon-gallery, maximized synthetic-app and narrow screenshots were inspected. All screenshots and image fixtures are synthetic, not real user content or household-service evidence.

Limits: single-gateway-process JSON persistence with atomic rename, not a cross-process database/fsync guarantee; fixed ordinal slots can reflow between screen sizes and scroll locally; animated drag ghosts and edge auto-scroll remain polish. Browser verification is Chromium plus emulated touch, not Safari/physical-device qualification. Icon decoding is bounded but may finish after disconnect; stale commits are rejected. No public sharing, GitHub push or VM deployment is included.

## Immersive motion and first-run setup — previous Unreleased verification

Development branch: `feat/immersive-onboarding`, based on source version 0.2.0. The arrival overlay uses `[ESC] BYPASS INITIALIZATION`, a bounded monochrome signal-settling effect, inert covered content and managed keyboard/touch focus. Authentication loads underneath. Login/desktop/window/Navigation motion respects account preferences and device reduced motion; minimized native frames retain state.

First-run enrollment now leads into the real first-app wizard or explicit defer. Existing accounts migrate as setup-complete. A server-backed first-app marker and idempotent endpoint prevent duplicate registration after retries, lost committed responses, reload or restart. Owner setup fragments are cleared before session discovery completes.

Executed verification: **71 backend tests, 33 frontend tests and full hybrid integration passed**, including a fresh Git-index export with dependency setup and no private fonts/runtime state. Coverage includes partial preference merges/migration/corruption, authorization/CSRF and queued revocation, intro focus/input isolation, once-per-tab behavior, keyboard bypass without authentication, live reduced-motion changes, native frame retention, responsive onboarding, interrupted completion and a genuinely lost committed first-app response. The parent reproduced and fixed the intro interaction and duplicate-registration defects; independent source re-review found no remaining blocker in this development scope.

A real synthetic first-run/native-app recording was generated at `screenshots/relay-immersive-demo.webm`, with no page exceptions and retained native form contents after minimize/restore. Intro, onboarding and Profile screenshots were visually inspected. Recordings/screenshots remain ignored local artifacts; they contain test fixtures, not real household apps. No sound, fake security diagnostics, new assets or secret shortcuts were added. No VM deployment or GitHub push is part of this update.

Known limits: pre-login cannot know a new device's account preference, so it uses device reduced-motion and last locally cached booleans until authenticated. Motion is not a general physical-device/Safari qualification. Existing accounts do not replay setup; rolling back source after persisted preference changes may require the protected pre-update runtime backup described in docs/motion-onboarding.md.

## Version 0.2.0 publication — previous verification

`package.json` and the root lockfile now identify version **0.2.0**. `version.js` is the shared source for footer/Profile text and backend System diagnostics. `CHANGELOG.md` backfills the 0.1.0 public baseline and groups the subsequent account, settings and web-app work under 0.2.0, with an Unreleased section for ongoing changes. No historical micro-releases or production deployment are implied.

The build and full suite passed locally and from a fresh Git-index export with dependency setup, without private fonts or runtime state: **58 backend tests, 26 frontend tests and real hybrid integration**. The new browser regression checks footer text/visibility, Profile on desktop/narrow widths, System diagnostics and package/lockfile/changelog agreement. Existing diagnostics assertions now use the shared version rather than a stale literal. Desktop/Profile screenshots were visually inspected. Independent source review found no blocking issue. Runtime secrets, personal data, private planning and unverified fonts remain excluded from publication.

## Web apps wizard and status preference — previous verification

The Add app wizard registers HTTP(S) native or streamed apps, with name/address/icon, mode-specific options/checks/previews, access selection and review. UI terminology is Apps. Profile's Show app status preference defaults on, persists per account, hides dots/text when off and skips client status probes. Existing bundled entries, grants and account data remain compatible.

Parent executed `npm run build && npm test` after integration and review fixes: **58 backend tests, 25 frontend tests and full hybrid integration passed**, with no failures/skips/cancellations. A clean Git-index export also passed fresh install/setup/build and the full suite without local fonts or private runtime data. Its first run exposed a fixed-delay wheel assertion; the regression now waits for the actual compositor scroll, and the complete clean-export rerun passed. Independent source re-review found no blocking security/logic issues within the documented development scope. Actual local HTTP fixtures exercised native tabs and sandboxed frames, streamed JPEG previews and typed input, per-session cookies, user access, client CORS evidence/server fallback and persistent preferences. The baseline real 512KiB ZIP byte comparison, admin-only Keepsakes and synthetic two-stream regression still pass.

New boundary regressions cover DNS-pinned transport, metadata/self/Teredo restrictions and legitimate Tailnet unicast, DNS-independent registration, native cookie-host separation (including actual fixture headers), blocked redirects/egress/WebSockets, pending stream cancellation, preview/check expiry/disconnect/revocation, preview cancellation from the wizard, health fairness above transport capacity, failure-cache handling and corrupt preference state. Connection checks/previews no longer hold the global mutation queue. HTTP error responses are not reported as an unreachable server.

This is local macOS/Chromium verification using synthetic content, not real home-service or production qualification. Native destinations must use a different authentication hostname, with dedicated-host deployment requirements documented in `docs/web-apps.md`. Generic WebSocket/audio/file-transfer support and universal website compatibility are not claimed. No VM changes or GitHub push were performed.

Screenshot artifacts (ignored): `webapps-wizard.png`, `webapps-wizard-narrow.png`, `webapps-apps.png`, `webapps-profile.png`, `webapps-stream-preview.png`, `webapps-stream.png`.

## Settings refinement — previous verification

Profile and Control Panel use neutral black/stone/off-white surfaces, fields, focus rings and feedback; semantic colors remain on status dots. Control Panel has Users, Services and System tabs, searchable semantic tables, focused create/edit forms, removal confirmation, diagnostic grids and a resource-limits table. Drafts survive tab switches in memory; cancel/close discards them. Profile uses a compact account/security grid.

Parent independently ran `npm run build && npm test`: **31 backend tests, 20 frontend tests and full hybrid integration passed**. Real browser tests cover create/edit/grants/role/disable/password reset, service lifecycle, search, cancel/confirmation, modal keyboard focus, draft retention, status-search consistency and session expiry during settings loading. Neutral computed-color checks passed; layouts were exercised at 390px and 320px with local table scrolling rather than viewport overflow. Desktop and narrow screenshots were inspected. Backend and authorization code are unchanged. No preview restart, VM deployment or GitHub push was required. Safari/physical-device checks remain unverified.

Screenshots: `control-panel-users.png`, `control-panel-services.png`, `control-panel-system.png`, `profile-settings.png`, plus narrow variants (ignored local test artifacts).

## Accounts / Navigation update — previous verification

Executed on the local macOS development checkout, branch `feat/accounts-navigation`:

```sh
npm run build && npm test
```

Result: **build passed; 31 backend tests passed; 18 frontend tests passed; real hybrid integration passed.** No failed, skipped or cancelled tests in the final run. Vite reported its existing default-Svelte-configuration notice; the build emitted no Svelte compiler warnings. Tests were exercised against temporary synthetic accounts, layouts and Keepsakes libraries, never the real `.runtime` or `.data` libraries. The supervising agent reran the full suite, then repeated fresh dependency setup/build/tests against a clean Git-index export without private fonts or runtime state; all passed. An independent read-only security/logic review found no blocking issues within the loopback/template scope. Additional concurrent-limit and real slow-transfer revocation tests remain useful follow-ups; this is not a production security audit. No VM deployment or GitHub push was performed.

### New coverage

- Protected first-run enrollment creates `admin` once, requires the local setup credential, stores no plaintext password, and cannot be reused after initialization or restart. Account files are checked as mode 0600.
- Generic failed login, login CSRF, bounded login throttling, logout CSRF, logout/restart/finite-expiry revocation, and live socket/context cleanup on logout and expiry.
- Server-side role/grant enforcement for session app lists, window opening/editing/reload, native Keepsakes and WebSocket upgrades. Ordinary users cannot obtain the shared admin library.
- Separate login sessions have independent managers and real Chromium contexts; text entered into one does not appear in another. Per-user saved layout restoration and restart persistence remain exercised.
- User creation, disable, role/grant changes, last-admin protection, current-password verification, profile edits, password-change revocation and forced password change following admin reset.
- Real service creation, label/enabled edits, removal and grants. Duplicate synthetic templates use separate real contexts; HTML-like labels render as text. Arbitrary URL fields and malformed persisted registries are rejected.
- Per-user/global stream reservations, restored-layout admission limits and per-user login-session limits. Already queued mutations are reauthorized after a caller is disabled.
- Native service-disable cleanup is covered at the gateway response-tracking seam with a controlled in-flight response; ordinary native upload/download regressions use actual HTTP/browser traffic.
- Bounded truthful status: absent synthetic pages are Unknown, unavailable native runtime is Offline, observations are timestamped. Diagnostics expose process/session/resource summaries, not credentials.
- Real compiled browser flow: enrollment → logout → login → Navigation → Control Panel → create user/grant → add/rename/disable/remove a service → user login/authorized desktop → Profile display-name update → logout. No browser page exceptions in this flow.

New auth/security tests were run red before implementation. Additional red/green regressions caught and fixed restored quota overflow, HTML interpolation of service labels, stale queued administrator authority, malformed persisted URL state, non-string usernames, and in-flight native response cleanup. Existing lifecycle/input/focus tests remain in the final suite.

### Real artifacts

Generated and visually inspected login/navigation/control-panel screenshots are ignored local artifacts:

- `screenshots/login.png`
- `screenshots/navigation.png`
- `screenshots/control-panel.png`

The account-UI fixture intentionally starts without native services, so its native status dots truthfully read Offline. The separate full hybrid fixture starts isolated native services and retains `desktop.png`, `native-parcels.png`, `native-keepsakes.png`, `two-streams.png`, and `hybrid-desktop.png`.

The final hybrid integration again downloaded a real **512KiB random-file ZIP** from embedded Parcels and compared extracted bytes, uploaded synthetic artwork and edited notes in isolated Keepsakes, exercised two independent real CDP pages, typing isolation, drag/resize, pause/resume, reconnect retention and gateway-only client HTTP requests. It reported no page exceptions.

### Explicit limits / not newly verified

This is loopback-only development, not production qualification or an independent security audit. General LAN/external service registration is not implemented: only managed native/synthetic templates are supported. Streaming provides upstream session capabilities, not a complete security boundary. Chromium sandbox remains enabled; CDP is private; no host shell, Docker/socket access, process restart/update controls or Clippings integration was added.

Keepsakes remains a single shared admin-only library; trusted native apps share the gateway origin. Sessions expire after eight hours, with four per user / sixteen globally; stream reservations are two per user / eight globally. Same-user sessions have independent live contexts and last-save-wins shared layout persistence. Revocation cannot erase already downloaded client data. Login throttling is gateway-wide and may temporarily throttle other local users after failed attempts.

The local preview was restarted and `npm run open` opened protected first-run enrollment on the laptop; `/api/auth` confirmed setup is required and unauthenticated `/api/session` returned 401. No admin password was chosen automatically. Existing library data and legacy layout remain untouched. Fresh clean-export installation and full tests passed as described above. Linux, Safari, WAN, long-duration soak and a new performance benchmark were not run. README documents optional operator-controlled legacy layout migration.

## Public-source verification

Historical baseline, before the accounts update:

A clean export of the Git index, without local fonts, runtime state, libraries or installed dependencies, passed these commands on macOS:

```sh
npm ci
npm run setup
npm run build
npm test
```

Results: **18 backend tests, 17 frontend tests, and real hybrid integration passed**. Missing optional reference-font warnings and Parcels' large-bundle warning are expected; fresh checkouts use system font fallbacks. This is local verification, not hosted CI, Linux qualification or production deployment.

An independent read-only staged-source review found no blocking secrets or critical security/logic issues within the documented loopback-only prototype boundary. This is not a full production security audit.

## Actual end-to-end checks

- Client-selected synthetic 512KiB file packed and downloaded as a real ZIP; extraction compared original bytes exactly. This exercises compression workers, not just tiny synchronous ZIPs.
- Native Keepsakes uploaded synthetic artwork, saved notes and displayed it through the gateway using an isolated test library.
- Notes Lab and Signal Lab received actual Chromium CDP frames; input changed only the focused page.
- Local dragging, resizing and saved geometry worked, including delayed ResizeObserver restoration.
- Minimize paused capture; restore/reconnect retained the live remote note within the tested grace period.
- Observed client HTTP requests stayed on the gateway origin; no page exceptions in the checked integration path.
- Gateway restart preserved saved layout and rejected old login sessions.
- Host, Origin, CSRF, hostile launch requests, input release and lifecycle-race regressions passed.

Tests use temporary synthetic libraries, not personal media or journal content. Generated screenshots are local artifacts excluded from Git; mock-prefixed screenshots are not evidence of live streaming.

## Benchmark and boundaries

`docs/benchmark-results.json` and its Markdown summary preserve a short local two-page benchmark. The roughly 10Hz synthetic counters do not establish maximum FPS, WAN behavior, dashboard scrolling, input-to-visible latency or hour-long stability.

Native integrations are trusted first-party same-origin copies, not a hostile-plugin sandbox. Direct loopback access to the native subprocess is inside the trusted-machine boundary. Chromium's sandbox remains enabled; browser debugging and Docker control are not exposed to clients.

Debian/GPU qualification, real home-service login, production identity hardening, Safari and deployment remain unfinished. Optional reference fonts are not distributed, and a project-wide license remains undecided.

## Known follow-up from review

The earlier source-publication review noted that a failed layout persistence write poisoned subsequent saves. The accounts update now chains new writes after recovery from rejection and serializes layouts shared by same-user sessions. This is not a claim of crash-proof/fsync durability or disk-failure qualification.

See README.md for startup, storage and limitations. Runtime setup credentials, account state and libraries must remain private.
