# Independent updater UI

A separate Vite / Three.js package for independent maintenance. Relay's Updater shortcut first opens a trusted native **desktop browsing window**, using the same chamber/state modules and a session-scoped read-only broker bridge. **Start update** now hosts this independent application in a scoped trusted surface outside Relay's ready/login/window lifecycle. It does not open another page or install anything automatically.

The launch still navigates `/updater/#<single-use-ticket>~<selected-version>`. The host does not retain the ticket in an iframe src attribute; the child removes it before the first API call. The release version is only a review hint—not authority or an install command. Final consent and the current administrator password are entered inside Relay. Independent monitoring survives runtime stop/restart; the existing Login signs in again in the same page and never automatically retries a mutation. Standalone direct navigation and the explicitly requested opener-severed **Standalone recovery (new tab)** launch remain supported. See [architecture/security/control-plane migration](../../docs/updater-embedded.md).

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

Pinned: three 0.186.0, vite 8.3.5, @playwright/test 1.63.0. Node 26.8.1 was exercised. If the matching Chromium is absent, install it with `npx playwright install chromium` first. Tests use sandboxed Chromium.

- `test:unit`: pure byte/phase-to-geometry behavior.
- `test`: real browser against Vite, with explicitly synthetic HTTP responses. Captures `screenshots/updater-synthetic-*.png` at repository root. It tests UI behavior, not the broker.
- `test:http`: compiled UI and the integration-owned real HTTP server, real cookies/CSRF and bridge calls, with a synthetic Unix broker and synthetic Relay authentication server. Checks monitoring after that synthetic Relay endpoint closes. Does not prove installation.
- `test:fixture`: compiled UI, actual Relay gateway in a disposable standalone runtime, real updater HTTP server, real broker and ENGINE's `Sandbox`. Installs HMAC-signed fixture bytes into a disposable Node service, exercises failed readiness / matching-state rollback, and reloads the UI after closing the test Relay gateway. Captures `screenshots/updater-real-fixture-success.png` and `screenshots/updater-real-fixture-rollback.png`. Requires the root Relay UI to have already been built by the integration owner. This test never rebuilds root files. It is NOT GitHub-attestation or production/systemd qualification.

All test processes clean up their own fixture services. No production state is used. Unit tests have Node test deadlines; browser tests have per-test and global deadlines. Invoke commands with an outer process deadline as well.

## Launch

The built-in fallback artifact is `updater/ui/dist/`. Root `npm run build:updater` additionally builds `updater/ui/presentation-dist/` with version-pinned asset URLs and its inert descriptor; the release builder puts that complete presentation in the signed runtime. The fixed-root unprivileged bridge selects eligible current runtime bytes at `/updater/`, otherwise keeps the independently installed fallback. Integration owns `updater/web/index.mjs`, which serves the same independent authentication API. Run that server only with a trusted disposable or approved operator configuration; then launch Updater through an active administrator Relay session. The UI never accepts a caller-supplied broker URL, repository, path or shell command.

`npm run dev` and `npm run preview` bind `127.0.0.1:4283` with strict port use. They do not provide authentication, fixture state or an API proxy. Without the updater server, the page reports unavailable; Vite is not a production launch path. To inspect a synthetic state without configuring a server, run the browser tests and open their screenshots. No fake demo state ships in the application.

## Behavior

- Every byte count, phase, installed version, release note and history entry comes from `/updater/api/state` or `/check`. Percentages describe artifact bytes only, never whole-job completion. Unknown totals have no numeric percentage or fabricated accumulation.
- The independently built bundles lazy-load the same pinned Three.js character renderer. A lit opaque 3D knot/core/orbit/particle scene is depth-tested into bounded stable cells and mapped to `. : + * # / @`. Slow elapsed-time rotation/precession, breathing, phase-driven scan/settle/pulse and curved inward particles are decorative, not throughput or progress estimates. Only artifact bytes supply numeric percentages.
- OS reduced motion and handed-off `interfaceAnimations:false` suppress continuous motion, retaining a calm static view of the actual 3D knot. Hidden/offscreen surfaces and trusted host hiding pause animation. No audio. Missing/lost WebGL uses an explicit text fallback; controls and telemetry remain usable. Container queries stack the rail by actual app width.
- State polling schedules the next read one second after completion, has a twelve-second fetch deadline, and permits only one state/check read at a time. Connectivity loss preserves and labels last-known data, disables mutation controls, and stops decorative motion. Expired monitoring sessions hide private state.
- Install, cancel and rollback each require an explicit interruption confirmation and transient current Relay password. No mutation is automatically retried. A successful POST is followed by a state read, not an optimistic success screen. Relay reauthentication failures leave the independent read session intact.
- Release notes, events, errors and history are text nodes, never broker-supplied HTML. No credentials, capabilities or UI state are written to localStorage/sessionStorage. No console logging.

## Scripted visual preview

After building, run `node tests/record-demo.mjs` from this directory to record `screenshots/updater-synthetic-motion.webm` at repository root. It launches a private ephemeral loopback preview and sandboxed Chromium, feeds explicitly synthetic read-only API responses, and closes both afterward. The deliberate shot pacing illustrates download/assembly phases; it is **not** installation, network performance or release verification evidence. Use `test:fixture` for the actual disposable update path.

## Design review

Monitor primary, Operate secondary: nearly black subtle texture and thin cream rules, a dominant actual shaded ASCII knot with dotted coordinate guides, narrow real events/status/actions rail, and the monochrome pixel artifact percentage plus character-block progress. A small “Relay updater” header replaces the reference wordmark. Silkscreen Bold (numerals) and Share Tech Mono Regular (technical text) are deliberately bundled as WOFF2 under SIL OFL 1.1, not fetched at runtime. Original upstream license bytes and `updater-font-sources.json` are copied into both bundles' `licenses/`; source pins and conversion hashes are in `src/assets/font-sources.json`. No private reference font is redistributed. The latest refinement restores monochrome progress and a minimal functional header. No rounded dashboard cards or invented telemetry. Confirmation remains a cream bordered dialog; supporting-text contrast, real byte progress, motion and security assertions remain intact.

Screenshots use synthetic content. Browser coverage includes Chromium on macOS and a targeted Playwright WebKit font/layout/no-WebGL smoke. This is not physical Safari GPU, physical mobile, screen-reader or Linux GPU/systemd qualification. An ordinary runtime update still leaves installed broker/web API/configuration/units unchanged. Starting with the 0.6.5 candidate, fresh installs or a separately qualified manual web-only bootstrap enable compatible runtime presentation delivery with complete immutable pins for old lazy assets. See [delivery/retention limits](../../docs/updater-ui-delivery.md); an existing old web server cannot update itself from runtime bytes.
