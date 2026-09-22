# Experimental desktop gateway

For the 0.6.0 installed opt-in configuration path, see [gateway deployment](gateway-deployment.md). It adds configurable names/listeners and fixed LAN/VPN upstreams; it does not provision DNS/trust or qualify every browser/service. The original local-only implementation and evidence below are retained as historical context.

## Original local interface and verification (unreleased work on source 0.5.0)

Disabled by default. `npm start` does not enable this feature. No deployment runner, environment configuration, account-state migration, trust installation or hosts/DNS changes are provided. This is not production qualification.

## Programmatic interface

Pass `experimentalGateway` to `createGateway` from `server/gateway.mjs`, alongside a fresh protected runtime directory, `hostname: '127.0.0.1'`, and loopback network mode:

```js
experimentalGateway: {
  key, cert, // operator-supplied PEM bytes, kept server-side
  port: 0,   // loopback listener, ephemeral by default
  targets: [{
    id: 'files', label: 'Files',
    upstream: 'http://127.0.0.1:18302',
    entryPath: '/',
    cookieNames: ['sid'],
    requestHeaders: [], responseHeaders: [], webSocketPaths: [],
    allowDownloads: false, allowPopups: false
  }]
}
```

This example describes the interface, not a service that was started or a recommended real-service profile. Use the existing service's exact tested headers/cookie/login profile, not guessed names. Optional `authProfile` accepts the strict upstream-response profile in `server/experimental-gateway-profile.mjs`: exact POST/DELETE login path, successful status, supported content type, byte limit, TTL and output header/cookie mapping. It never accepts an authentication-success callback. The test helper contains an executable synthetic profile and actual enrollment/HTTP fixture.

`gateway.experimentalGateway.desktopOrigin` is the fixed `https://desktop.relay.test:<port>` normal desktop bridge. All listeners and upstream targets are restricted to loopback; arbitrary hostname and production deployment configuration are deliberately rejected. Resolution and trusted certificates must be supplied outside this interface. Nothing installs them. The test harness uses Chromium-only resolver rules and a process-local exact-SPKI exception; it does not modify macOS trust or hosts.

The bridge forwards the actual compiled desktop, private desktop routes, native routes, API and stream WebSockets to the fixed local Relay origin. It validates exact external Host/Origin before translation and translates only the host-only Secure Relay session cookie. Main Relay Host/Origin validation remains exact and unchanged. Use the ordinary loopback entry for the existing updater workflow: the experimental TLS desktop's independent updater handoff has not been qualified and existing updater URL validation is intentionally not relaxed.

## Desktop and persistence

Control Panel → Apps → Add app shows Gateway only when configured. Choose a non-secret configured target rather than supplying an upstream URL. The editor can change the configured target. Gateway app definitions persist as `kind:'web', mode:'gateway', gateway:{target:'files'}` plus ordinary label/icon/access fields. Registry and browser desktop state contain no upstream addresses, TLS private keys, private cookie jars or launch tickets. Invalid stored gateway fields refuse startup rather than resetting or migrating account state. Removing runtime configuration leaves valid stored definitions intact but unavailable.

The normal shortcut opens a normal desktop window, with existing folder/private-route/geometry controls. Launch requires genuine live Relay session and app grants, exact Origin and CSRF, an existing window, and the configured registry target. One-use ten-second tickets remain in memory and are sent only through exact origin/source checked postMessage to a fresh app/session origin. They never appear in frame URLs, history or layout persistence. Protected app cookies are Secure, HttpOnly, host-only and server capabilities are session/app bound.

End app session removes the iframe immediately and destroys that launch's route, private credentials/jar, tickets and active HTTP/WebSocket operations. Reopen uses a new hostname and requires a fresh app login. Close uses this secure end behavior and removes the window immediately, even while layout saves are pending; same-account reopen waits for old close persistence. Minimize preserves the mounted app/session. Gateway Reload explicitly restarts the app session, requiring fresh login. Other native/streamed reload behavior is unchanged.

The app's own Logout may be client-only and may NOT clear gateway identity. No app DOM/JavaScript logout rewriting is performed. Explicit End is the supported erasure control; it does not revoke an upstream token at its issuer or erase already downloaded browser data. If the cleanup HTTP request fails, the UI says cleanup is unconfirmed rather than claiming success. Server session revocation and route expiry still deny further access. Routes have a one-hour maximum bounded by the Relay session; abrupt browser/network disappearance is not immediate server erasure.

Authority is checked against actual live Relay sessions/accounts on requests; logout, user disable, grant changes and registry edits retire active routes. Browser auth/session polling removes protected frames on discovered auth loss, including account switches in another tab. Existing polling is approximately five seconds, not instantaneous remote browser erasure. Queued actions and component cleanup retain their authentication epoch.

## Transport scope and limits

The reusable experimental transport/profile modules were extracted from local proof 005 and do not import untracked spikes. The ordinary Set-Cookie generation guard is retained: old responses cannot repopulate a forgotten/new-login jar. Profile credentials come only from exact bounded upstream login responses, never ambient browser cookies or supplied authentication headers. Upstream applications may themselves expose/store their own login tokens; Relay does not claim to erase or hide those application-managed tokens. Gateway tickets, TLS keys and private jars are never browser-persisted.

Fixed local origins only, eight configured targets, bounded routes/connections, 1 MiB requests, 64 MiB responses and bounded configured WebSocket paths. These are not large-file or media-load qualifications. Upstream CSP/X-Frame-Options remain enforced; additional gateway CSP constrains origins and blocks workers. Redirects stay on the configured upstream origin. No claim of universal app compatibility or sanitization of upstream response text containing its own addresses.

## Executed evidence and remaining gates

Actual synthetic HTTP/TLS + genuine Relay auth tests cover config persistence/refusal, private identity, exact Origin/CSRF/grants, one-use handoff, End/reopen, active HTTP/WS destruction on End/Close/logout/grant revoke/disable, stale End versus newer launch, upstream-only token capture and held ordinary Set-Cookie generations. Compiled browser tests cover Add/editor/shortcut/window/minimize/End/reopen/Close, delayed launch responses after End/Close/logout, queued close across account switches, and cross-tab session change.

Final parent build and full verification passed: **133 backend tests, 65 frontend tests and the actual hybrid integration**, plus **60 Python updater tests, 6 updater unit tests and 35 updater browser tests**. The earlier interrupted updater-desktop run was rerun successfully alone and in the full suite; it is not counted as earlier success. Independent final review also passed 20 focused gateway tests and three additional held-save/restart browser race tests.

Real-service verification through the normal desktop also passed on the local Mac: `tools/verify-local-desktop-gateway.mjs` used genuine nonadmin Relay login/grants, File Browser viewer form login, actual upload/download byte equality, minimize preservation, End denial of the old capability, fresh-login reopen and Close cleanup, plus Jellyfin viewer playback/audio decoding, seeking and End cleanup. These were disposable existing local service fixtures, not production libraries. The screenshot `screenshots/local-normal-desktop-jellyfin.png` is actual synthetic playback in the normal desktop.

Review found and fixed cancellation-bookkeeping saturation: markers are bounded per actual session rather than shared globally. End always retires the matching owned route; own-session overflow fails closed for new launches for the existing cancellation horizon without blocking another session's cleanup. Tests cover cross-user saturation, pending cancellation near/at capacity, cooldown renewal/recovery and late-End isolation.

Remaining gates: real hostname/DNS and trusted TLS design, Linux runtime/load/resource qualification, ordinary Safari/WebKit trust (native macOS authorization remains blocked; not retried), target-browser/device compatibility, broader retained-tab/storage adversarial testing, larger/long-running media and transfers, experimental-edge updater handoff, and deployment threat/security review. Nothing was published or deployed; version remains0.5.0 with this work under Unreleased. Production, OS trust, hosts and network configuration remain unchanged. Local service containers are stopped after testing.
