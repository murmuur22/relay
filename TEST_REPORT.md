# Relay prototype verification

## Version 0.2.0 publication — current verification

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
