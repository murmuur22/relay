# Gateway form compatibility (0.6.7 backend candidate)

## Contract and limits

Gateway is a fixed-target reverse proxy, not universal website adaptation or single sign-on. An administrator registers an app selecting an already validated target ID. Browser assertions never add targets, destinations or trusted origins. Per-launch app origins and capabilities remain bound to the real Relay session, grants, registry definition and authentication generation.

Before forwarding, Relay rejects duplicate raw Host/Origin authorities (including HTTP/WebSocket upgrades), then checks exact external Host and app-route Origin (including port), live capability/session/grants and same-origin fetch metadata. Mutation Origin must equal that live route; absent, `null`, desktop-origin and foreign-origin mutations are denied. Upstream Host is the fixed configured authority. Management cookies, browser cookies, Origin, Referer, Sec-Fetch-Site and forwarding/identity headers are not passed upstream. Only configured app cookie names in the private generation-bound jar, existing authorization/profile rules, fixed safe header lists, content type and body limits apply. In particular no blanket application mutation header is manufactured.

Dropping Origin/Referer is the existing proxy contract, not browser-origin trust bypass: Relay validates the external boundary first, while the app still validates its own CSRF tokens/custom headers and body/MIME rules. Apps requiring Origin/Referer must explicitly support a trusted reverse-proxy/external-origin policy; that is not universally fixable by Relay. This slice does not introduce arbitrary header forwarding, wildcard origins, identity spoofing, unknown-app trust, or Origin/Referer translation without a demonstrated need. Redirects remain fixed-origin and browser-mediated, DNS/literal destination policy is unchanged, TLS validates hostname/CA, and configured auth-generation/cookie isolation remains in force.

## Actual Exterminator v0.2.0

Read-only source `18b832936ad47e700712fed98d662a6fab15cdbf` has two separate listeners sharing SQLite. Submission accepts POST `/api/submit`, requires JSON and `X-Exterminator: 1`, and returns only `{ok:true}` with HTTP 201. The submission app never registers list/detail/edit/export routes. Direct Origin, when present, must exactly equal the direct HTTP authority. `relay_origin` is one exact HTTPS desktop origin controlling CSP frame-ancestors only; it does not permit a Relay HTTPS mutation Origin. The app ignores forwarded identity/host/scheme headers. There is no built-in app rate limiter or user authentication; gateway grants and the operator's direct-access boundary remain necessary.

Required target configuration: add `x-exterminator` to requestHeaders for each intended surface. Do not add content-type there (it is already forwarded), invent a CSRF token, send management cookies, disable Origin checks or widen Exterminator's allowed peers. For embedding, set each surface's `relay_origin` to the exact HTTPS desktop origin, including a nondefault port. Admin and submission must remain separate targets/grants; ordinary reporters receive submission only.

The owned test runs actual v0.2.0 factory code in temporary loopback listeners/database and Node's verifying HTTPS client through genuine Relay accounts, grants, launch and capability redemption. It reproduces an HTTP403 when `x-exterminator` is not configured; the same browser-shaped request with the documented header allowlist receives HTTP201 and its saved report is read back from the temporary admin listener. Foreign/null/desktop origins, missing/wrong capability, direct external Origin, unauthorized admin and revoked grants do not save reports.

This demonstrates one local configuration failure, not the cause of an unknown live deployment's failure. No deployed configuration, production credentials, real reports or live VM were read. No Exterminator canonical files were edited. This is HTTP/TLS/backend evidence, not yet a compiled-browser form-click pass. Parent integration owns the actual compiled browser HTTPS form submit, visible acknowledgment and admin readback (including exact frame-ancestors configuration). If that fails, preserve actual request/status evidence before changing code or configuration.

## Reproduction

Set `RELAY_TEST_EXTERMINATOR_SOURCE` to a read-only v0.2.0 source checkout and optionally `RELAY_TEST_EXTERMINATOR_PYTHON` to a Python interpreter with Flask/Werkzeug installed. Run Node 26.8.1:

    node --test --test-concurrency=1 --test-timeout=30000 tests/backend/gateway-exterminator.test.mjs

Without the explicit source, that external-app test is skipped, never counted as an app pass. Temporary state is under TMPDIR; no OS trust/hosts changes, public traffic or production submissions occur. Node uses a process-local explicit fixture CA with hostname validation. Chromium SPKI fixtures and ordinary client/public-PKI trust are separate qualification tiers.
