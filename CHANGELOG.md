# Changelog

Meaningful user-facing changes, security fixes and migration notes for **WE relay**.
Versions describe the source/application, not a production deployment or a GitHub Release. Earlier unversioned development commits are grouped into the first version containing them; no retrospective releases are invented.

## [Unreleased]

No changes recorded yet.

## [0.4.0] — 2026-09-19

Release preparation: publication and Linux qualification are separate gates; version metadata alone does not establish deployment readiness.

### Added
- Administrator Updater now opens a draggable/resizable/minimizable desktop browser for release notes, selection, real status and the shared Three.js chamber. Start update hands the selected release to a separate maintenance tab; only explicit confirmation and a fresh Relay administrator password there can begin installation.
- Session-scoped, bounded admin-only read/check bridge for desktop browsing, with authority rechecked after broker awaits and no rotation of an existing independent updater session. The system window remains outside editable web-app registration and server stream/window managers.
- Standalone Three.js transfer chamber with byte-driven fragment assembly, decorative spiral download trails, release notes, server-reported phases/events/history and actual artifact-byte progress. The lazy-loaded renderer respects account/device reduced motion, freezes on connectivity loss and falls back to a static view without WebGL.
- Separate updater web service and broker, protected maintenance admission, verified staging, matching-state backup/restoration, cancellation before activation and gated interrupted/failed recovery. Disposable fixtures exercise real HTTP payload transfer, Node service activation and readiness-failure rollback; they are not production release evidence.
- Separate Linux x64 runtime and updater-control-plane release archives, both bound by one GitHub-attested manifest. Verification uses public downloads and a fresh credential-free Sigstore cache, not an operator GitHub login.
- Inspect-by-default fresh-host installer, dedicated non-login service identities, protected code/key/state, durable maintenance, and guarded hosted systemd qualification. Conflicting installations are refused instead of overwritten. Prerelease publication and stable promotion are separate gates; no production deployment is implied.

### Fixed
- Stage verified candidates privately inside the install mount before atomic publication, rather than renaming across systemd writable mounts. Restore state contents without replacing the mounted state directory, using bounded no-follow descriptor operations and retaining a durable checkpoint through failure.
- Both updater surfaces disable installation of the already installed version and explain why.
- Updater content activates its desktop window without disrupting controls; local close and pending-launch cleanup no longer wait for unrelated application saves. Layout follows the resizable window width, not only the browser viewport.
- The selected update version survives independent-tab refresh as a validated, non-secret history hint. Missing versions require explicit reselection; hints never authorize or automatically start installation.
- Open authorization dialogs now disable submission visually when monitoring loses connectivity. New snapshots that revoke action eligibility or change the captured release/job invalidate consent and clear the password, requiring a fresh review instead of reviving an obsolete confirmation.
- Decorative trail endpoints stay on one traversal across the loop boundary, preventing long flashing spokes as particles reset.

### Verification boundary
- Local macOS/Chromium development only. Scripted visual previews, real HTTP with protocol doubles, and actual disposable broker/service tests are labelled separately. Production installation, existing-state migration and updater self-updates are not provided by these results.

## [0.3.0] — 2026-09-19

### Added
- Relay-only standalone profile with an empty builtin catalog, no bundled app processes/routes, explicit private state/Python configuration and strict localhost-origin support for SSH forwarding.
- Chromium-only standalone setup, a nonroot bounded systemd service template and an executable standalone qualification smoke for real streaming, icon decoding and restart persistence.
- Per-user folders, nested organization, top-left/downward grid-snapped drag/drop, context menus and keyboard/touch alternatives.
- Personal app names/icons without changing registry definitions or grants; premade icon gallery plus private normalized PNG/JPEG/WebP uploads.
- Clickable breadcrumb navigation and readable private desktop/app URLs with stable short keys, login/reload/Back/Forward handling and URL-backed maximize/restore.
- A separate public-sharing design proposal covering single-app links, curated exploration and restricted access. No public sharing is enabled.
- Restrained monochrome signal-settling intro with the exact keyboard/click/tap prompt `[ESC] BYPASS INITIALIZATION`, once per tab session. Bypass dismisses decoration only, never authentication.
- Login fade, desktop icon/dock reveal, window opening/minimize/restore and Navigation motion. Native iframe state survives minimizing, and drag/resize remains immediate.
- Independent per-account Intro animation and Interface animations controls. Device reduced-motion settings take priority, including changes while Relay is running; pre-login display can use the last locally saved motion booleans.
- Protected first-run administrator wizard: create the admin password, optionally add the first real app, then enter the desktop. Setup can be deferred or resumed without creating another administrator.
- Server-backed first-app progress and an idempotent registration endpoint, preventing duplicate apps after retries, lost responses or restart.

### Fixed and hardened
- Personal desktop/icon APIs enforce ownership and current app grants, reject invalid trees/cycles and normalize uploaded raster content instead of serving originals.
- Queued window writes retain their original account epoch, and route reconciliation cannot apply an obsolete maximize state after newer navigation.
- Permanently removed app history is reclaimed before desktop admission; revoked/disabled customizations remain available for regrant. Invalid private routes do not leave a previous maximized window covering recovery controls.
- Covered intro content is inert, with managed focus and reliable Escape/Tab behavior; hidden forms cannot receive accidental interaction.
- Owner setup fragments are captured and cleared before waiting for session discovery.
- Existing accounts do not replay first-run setup. Existing preference values are preserved while new motion defaults are added; malformed persisted flags still fail closed.

This source version supports a private standalone installation. A source push alone does not deploy it or make apps public; deployment qualification and operator access remain separate steps.

## [0.2.0] — 2026-09-18

### Added
- Persistent accounts with protected first-run `admin` enrollment, administrator-created users, roles and per-app grants. No shared default password.
- Login screen informed by Wicked and Journalmax; display-name/password editing, password resets and account disabling.
- Navigation start menu with authorized apps, Profile settings, Sign out and administrator-only Control Panel.
- Users, Apps and System pages with searchable tables, focused editors, removal confirmation and readable diagnostics.
- Five-step Add app wizard: Native/Streamed, name/address/icon, options and connection tests/previews, access selection, and review/save.
- Real HTTP(S) web apps: native sandboxed frames/new tabs and isolated streamed Chromium contexts with approved origins. Existing bundled apps remain available.
- Status observations identifying the user's device or Relay, with check time and details. Per-account **Show app status** preference, enabled by default and persisted across sessions/restarts.
- Quiet version display in the desktop/login footer, Profile settings and Control Panel → System, all derived from package metadata.
- This changelog and documented versioning/update practice.

### Changed
- Quick Nav became **Navigation**; user-facing Services terminology became **Apps**. Legacy registry endpoints remain compatible.
- Profile and settings now use the original black/stone/off-white palette. Semantic color is reserved for status indicators.
- Account and app registry state persist; login sessions remain ephemeral. Layout is per user, while browser contexts are separate per login session.
- Registration no longer requires Relay-side DNS resolution; client-only native addresses and temporarily offline apps can be saved.

### Fixed and hardened
- Server-enforced grants across window operations, native routes and WebSockets; sensitive account changes revoke live access. Last-active-admin protection prevents accidental lockout.
- Salted asynchronous password hashing, bounded login attempts, finite sessions, CSRF/Origin checks and refusal to reset corrupt account state into enrollment mode.
- DNS-pinned HTTP transport and exact approved-origin checks, with metadata/self-access restrictions and a deny-only browser fallback proxy. Legitimate Tailnet destinations remain supported.
- Native initial URLs sharing Relay's authentication hostname are rejected across ports, including wizard previews and desktop launches; cookies are not port-isolated.
- Pending stream and preview/check cancellation on logout, expiry, revocation and disconnect. Slow checks/previews do not hold the account mutation queue.
- Separate fair background-health scheduling prevents larger app lists from exhausting interactive stream capacity. HTTP error responses are not labelled as an unreachable server.
- Preserved editor drafts across tabs, aligned status search with displayed labels, and fixed settings teardown when authentication expires during loading.
- Recovered persistence queues after write failures and replaced a timing-sensitive wheel-test delay with waiting for the actual scroll effect.

### Migration and compatibility
- Existing app IDs, grants and libraries are retained. Missing legacy status preferences default to enabled; stored preferences are validated.
- The old owner bootstrap-login bypass is retired. Uninitialized installs enroll an admin once; initialized installs require a password. Restart signs users out.
- Legacy `.runtime/layout.json` remains untouched but is not automatically assigned to a new user. See README for optional operator-controlled migration.
- Native app permissions control the Relay launcher, not the destination website. Use a dedicated Relay authentication hostname; native redirects and direct visits remain an administrator trust responsibility.
- Streamed upstream WebSockets, audio and file-transfer bridges, durable upstream browser logins, and universal website compatibility are not implemented. This is still a loopback development prototype, not a production deployment.

Development checkpoints included: accounts/navigation (`d171459`), neutral structured settings (`3fb1524`), and web-app wizard/status preferences (`c58c0dc`).

## [0.1.0] — 2026-09-18

Initial public source baseline (`4962fb4`).

### Added
- Hybrid Svelte desktop with movable/resizable windows, dock, saved layout and compact dotted visual style.
- Bundled native Parcels and isolated Keepsakes integrations, plus two synthetic Chromium-streamed demo apps.
- Owner-only loopback bootstrap access, authenticated HTTP/WebSocket gateway, native proxy and sandbox-enabled browser capture.
- Real ZIP-byte comparison, native upload/edit, two-stream input isolation, pause/resume/reconnect and geometry regressions; scoped local benchmark documentation.
- Public source packaging that excludes credentials, user libraries, private planning documents and uncleared reference-font binaries.

### Naming
- The project was renamed from Orbit to **Relay — Wicked Evil relay / WE relay** before this public baseline. Internal project identifiers and the folder were migrated while retaining local data.

## Maintenance

- Record each meaningful change under Unreleased while developing. Include Added, Changed, Fixed, Security or migration notes as appropriate; omit empty categories.
- When publishing a version, move those notes into a dated version entry. Use `npm version X.Y.Z --no-git-tag-version --ignore-scripts` to keep package and lockfile metadata together.
- `version.js` reads `package.json`; frontend displays and backend diagnostics must import it rather than hardcoding a version. Rebuild the frontend and restart the gateway when changing versions.
- Run the build and full suite; `tests/frontend/version.test.mjs` checks metadata, visible UI, diagnostics and changelog consistency. Keep test evidence in TEST_REPORT.md and private infrastructure history outside the public repository.
- A commit/push does not deploy, create a release tag or publish a GitHub Release. Those are separate deliberate actions.
