# Independent updater UI

A separate Vite / Three.js package for independent maintenance. Relay's Updater shortcut first opens a trusted native **desktop browsing window**, using the same chamber/state modules and a session-scoped read-only broker bridge. It does not iframe this application or rotate this application's cookie.

**Start update** opens `/updater/#<single-use-ticket>~<selected-version>` in a user-initiated, opener-severed tab. The ticket is removed before the first API call. The release version is only a review hint—not authority and never an automatic install command. Final interruption consent and the current administrator password are entered in this independent tab, which remains available when Relay stops.

## Build and test

From `updater/ui`:

```sh
npm ci --ignore-scripts
npm run build
npm run test:unit
npm test
npm run test:http
npm run test:fixture
```

Pinned: three 0.186.0, vite 8.3.0, @playwright/test 1.63.0. Node 26.8.1 was exercised. If the matching Chromium is absent, install it with `npx playwright install chromium` first. Tests use sandboxed Chromium.

- `test:unit`: pure byte/phase-to-geometry behavior.
- `test`: real browser against Vite, with explicitly synthetic HTTP responses. Captures `screenshots/updater-synthetic-*.png` at repository root. It tests UI behavior, not the broker.
- `test:http`: compiled UI and the integration-owned real HTTP server, real cookies/CSRF and bridge calls, with a synthetic Unix broker and synthetic Relay authentication server. Checks monitoring after that synthetic Relay endpoint closes. Does not prove installation.
- `test:fixture`: compiled UI, actual Relay gateway in a disposable standalone runtime, real updater HTTP server, real broker and ENGINE's `Sandbox`. Installs HMAC-signed fixture bytes into a disposable Node service, exercises failed readiness / matching-state rollback, and reloads the UI after closing the test Relay gateway. Captures `screenshots/updater-real-fixture-success.png` and `screenshots/updater-real-fixture-rollback.png`. Requires the root Relay UI to have already been built by the integration owner. This test never rebuilds root files. It is NOT GitHub-attestation or production/systemd qualification.

All test processes clean up their own fixture services. No production state is used. Unit tests have Node test deadlines; browser tests have per-test and global deadlines. Invoke commands with an outer process deadline as well.

## Launch

The served artifact is `updater/ui/dist/`. Integration owns `updater/web/index.mjs`, which serves it under `/updater/` with independent authentication. Run that server only with a trusted disposable or approved operator configuration; then launch Updater through an active administrator Relay session. The UI never accepts a caller-supplied broker URL, repository, path or shell command.

`npm run dev` and `npm run preview` bind `127.0.0.1:4283` with strict port use. They do not provide authentication, fixture state or an API proxy. Without the updater server, the page reports unavailable; Vite is not a production launch path. To inspect a synthetic state without configuring a server, run the browser tests and open their screenshots. No fake demo state ships in the application.

## Behavior

- Every byte count, phase, installed version, release note and history entry comes from `/updater/api/state` or `/check`. Percentages describe artifact bytes only, never whole-job completion. Unknown totals have no numeric percentage or fabricated accumulation.
- The independent tab lazy-loads Three.js after authentication and a state read. The native desktop browser reuses the same chamber module in its own bundle, with the same pinned Three.js dependency. Download fragments gather from the byte fraction; phase transitions change assembly directly, without delaying state for animation. Slow active-job rotation and spiral download trails are decorative activity, not progress or a throughput estimate. Trails disappear after the downloading phase; reduced motion freezes them without fabricating byte changes. Camera framing adapts to narrow WebGL viewports as well as desktop sizes.
- OS reduced motion and handed-off `interfaceAnimations:false` suppress continuous motion. No audio. Missing/lost WebGL switches to a static SVG; controls and real telemetry remain usable.
- State polling schedules the next read one second after completion, has a twelve-second fetch deadline, and permits only one state/check read at a time. Connectivity loss preserves and labels last-known data, disables mutation controls, and stops decorative motion. Expired monitoring sessions hide private state.
- Install, cancel and rollback each require an explicit interruption confirmation and transient current Relay password. No mutation is automatically retried. A successful POST is followed by a state read, not an optimistic success screen. Relay reauthentication failures leave the independent read session intact.
- Release notes, events, errors and history are text nodes, never broker-supplied HTML. No credentials, capabilities or UI state are written to localStorage/sessionStorage. No console logging.

## Scripted visual preview

After building, run `node tests/record-demo.mjs` from this directory to record `screenshots/updater-synthetic-motion.webm` at repository root. It launches a private ephemeral loopback preview and sandboxed Chromium, feeds explicitly synthetic read-only API responses, and closes both afterward. The deliberate shot pacing illustrates download/assembly phases; it is **not** installation, network performance or release verification evidence. Use `test:fixture` for the actual disposable update path.

## Design review

Operate composition: a dark neutral chamber plus one release/action rail, followed by a compact disclosure ledger. System Arial is deliberately used as a neutral utility sans, with platform monospace for telemetry; no remote fonts or unverified font assets. No gradients, cards-as-marketing, glass, colored accent rails or ornamental statistics. Slop diagnostic: 0/10 after visual inspection. The light confirmation surface has an automated supporting-text contrast check of at least 4.5:1.

Screenshots use synthetic content. Browser coverage is Chromium on macOS, not Safari, physical mobile, screen-reader qualification or Linux GPU/systemd qualification.
