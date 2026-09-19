# Relay prototype verification

## Public-source verification

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

Debian/GPU qualification, real home-service login, production identity, Safari and deployment hardening remain unfinished. Optional reference fonts are not distributed, and a project-wide license remains undecided.

## Known follow-up from review

A failed layout persistence write can leave the stream manager's persistence queue rejected, preventing later layout saves until restart. Add explicit recovery and a regression test before treating persistence as production-ready. This was not changed as part of source publication.

See README.md for startup, storage and limitations. Runtime bootstrap files and libraries must remain private.
