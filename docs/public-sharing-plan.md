# Public sharing — proposal, not implemented

The current desktop URLs are private, account-scoped navigation. A readable path or maximized app link does **not** grant access and must not become public by removing the gateway's authentication check.

## Latest local implementation status

The authenticated gateway has progressed beyond the separate proof launcher: unreleased, disabled-by-default source now includes normal Gateway Add app/editor/desktop windows and explicit End/Reopen/Close behavior. Actual local nonadmin File Browser upload/download and Jellyfin video/audio/seek worked through that normal desktop, with End cleanup and fresh-login reopening. Full Relay/updater suites and independent final review passed; see `TEST_REPORT.md` and `docs/experimental-desktop-gateway.md` for evidence and limits. The older spike sections below remain historical feasibility evidence, not the current integration status.

This is still a loopback-only programmatic local experiment, not a published or production-enabled feature. Domain/DNS/valid TLS setup, trusted Safari, Linux/load/media-size qualification and the experimental desktop's updater handoff remain deployment gates. Nothing here authorizes production or network changes.

## Deployment and client experience requirements

Relay is browser-based, not Mac-specific. For an administrator-configured Internet-reachable HTTPS gateway, visitors should open the Relay link, log in, open a granted app and authenticate separately to that app when required. Visitors should not need the administrator's VPN, direct access to upstream service addresses, or installation of a private certificate authority in this mode. Gateway access does not implement upstream SSO.

Administrators choose public HTTPS or private LAN/VPN access. A purchased domain is not a product requirement: suitable free/subdomain naming can be used, while private naming/private-CA setups remain an advanced option with explicit device trust requirements. Private IP-only desktop access remains supported; it does not automatically provide the gateway's isolated hostnames or browser-trusted HTTPS. DNS, certificates and reachability must be configured and verified rather than silently changed by a runtime update. No claim of universal browser/app compatibility follows from this intent.

Release delivery is GitHub signed artifacts through the existing administrator Updater. Publishing or updating code is distinct from enabling gateway exposure or provisioning DNS/TLS; production configuration changes require separately scoped approval.

## Current product scope: one address for shared homelab services

The immediate user-selected goal is secure access to administrator-selected self-hosted services through one Relay address, usable by friends who should not need to configure each upstream address or understand the homelab network. Keep services inside the desktop experience. General web search and a general-purpose Browser app are out of scope.

Prioritize reliable service navigation, correct stream geometry/input and measured responsiveness. Do not treat wildcard domains or bitrate controls as substitutes for fixing these defects. An administrator Control Panel desktop launcher is also requested for the next batch, not implemented here.

Selected reference service: **Jellyfin**. Proposed acceptance test: a non-admin visitor signs into Relay, opens the granted Jellyfin desktop window, signs into their own Jellyfin account, browses and plays media with working audio, seeking and controls without needing direct access to Jellyfin's private address; an ungranted visitor is denied by the server. This is a target, not implemented compatibility. Relay's current JPEG screencasting has no audio/media transport and cannot establish successful Jellyfin playback. Evaluate a dedicated authenticated, cookie-isolated application/media gateway with bounded HTTP range and WebSocket support rather than treating increased screenshot quality as video support. Any production integration/network changes require separate approval.

Recommended first proof: a non-admin visitor signs into Relay, opens one explicitly granted self-hosted service and completes a useful task without reaching its private address directly; an ungranted visitor is denied by the server. Relay login is not automatically upstream single sign-on, and visitors must not inherit the host owner's upstream administrator session. Whether access is LAN/VPN-only or Internet-facing remains a separately approved deployment choice; one address must actually be reachable by the intended visitors.

The anonymous-publication roadmap below is an earlier optional proposal, not the immediate requirement or permission to expose anything publicly. Native direct embedding alone does not meet the one-reachable-address requirement when visitors cannot reach the upstream. Streamed delivery can meet that network boundary for compatible services; compatibility and isolation must be tested against actual selected service workflows.

## Universal product intent — Jellyfin is a test, not the product

The user's clarified direction is a general Relay for administrator-selected self-hosted web services: a knowledgeable host configures a service and grants access; friends use it through one understandable desktop entry point. Jellyfin is a demanding compatibility test, not a request for a Jellyfin-only product or a new hand-coded integration per app.

Build reusable authenticated HTTP/media/WebSocket transport and per-app origin isolation. Keep upstream address, permissions, supported origin/redirect mappings and connection limits as validated configuration, not hard-coded app names. If a service requires special settings, surface them as documented compatibility requirements or optional presets rather than pretending the core is universal already. First establish unchanged gateway behavior across distinct services before generalizing the prototype.

The current Jellyfin spike deliberately hard-codes localhost and fixture identities to constrain the experiment. Its small Jellyfin-specific setup/selector/Cast changes are test fixtures, not evidence that arbitrary applications need separate gateway implementations. It proves one application's tested workflow only. The requirement to stay inside a desktop window remains subject to upstream framing policy; other limitations include absolute URLs, secondary origins, cookie/auth assumptions, browser APIs and non-HTTP protocols. Universal intent means broad configurable support, not a guarantee that any address works securely without administrator setup. No further deployment authorization is implied by this clarification.

The user's stated motivation is to bring people together: people comfortable running tools, including AI tools, can voluntarily share access and libraries with friends who find the technology confusing. The administrator still handles setup; the visitor should not need that expertise. Treat compatibility limits as testable engineering questions, not a reason to drift into a single-service product or promise universal security.

## Local cross-service evidence

`spikes/003-service-matrix/README.md` records actual tests of one configurable gateway against Jellyfin12.1.0, File Browser2.63.23 and Uptime Kuma2.5.5. Jellyfin playback/seek and File Browser form login/TUS upload/exact-byte download passed their tested workflows. Kuma login/monitor creation/live UP updates worked, but parent-window access exceptions and a framing-policy error remain; its embedded UI is only partially compatible. Protocol configuration—not separate application-specific forwarding code—handled different headers, selected application cookies, WebSocket paths and popup/download permissions. All test containers are stopped and production is untouched.

These are still fixture identities and one app per isolated browser context; simultaneous app/user isolation, actual Relay auth, HTTPS/Safari, server-issued cookie handling and full protocol/security review remain prerequisites. See the matrix's independent-review findings; do not turn workflow pass results into a production-security claim.

## Local real-Relay authorization proof

`spikes/004-relay-auth-gateway/` now exercises genuine Relay enrollment, compiled-UI login, normal admin-created nonadmin users/registry entries/grants, and a separate local gateway adapter that checks live authenticated Relay HTTP APIs. No account/session records were injected and no production auth validator was relaxed. Parent and independent reviewer each executed **12 passing tests**, with **one explicitly blocked/skipped WebKit certificate test**.

Verified scope: two nonadmin users with differing grants, simultaneous alpha/beta app origins, one-use app-scoped tickets, Secure/HttpOnly __Host- cookies, desktop/sibling DOM separation, private per-capability synthetic upstream cookie jars, and orderly logout/account switch. Logout, grant removal, password reset, user/app disablement, and actual session/capability expiry denied new requests and closed ongoing synthetic HTTP and WebSocket connections within the tested 1500ms local bound. Map capacity/expiry recovery and hostile Host/Origin/CSRF/cookie inputs were tested. Timings are not guarantees under overload or process suspension.

TLS evidence is deliberately split: Node clients verify the temporary CA and hostname; Chromium uses a process-local exception pinned to the test certificate's public key. WebKit with certificate verification enabled rejected that certificate; its multi-origin HTTPS/Safari gate remains outstanding. No OS trust-store, system DNS/hosts or production setting was changed.

This is **not yet normal Relay app-launch integration**: compiled Relay login is followed by a clearly labelled `/proof` launcher and synthetic upstreams. Combining these authority checks with the real-service media gateway is still work to do. Persistent browser storage and malicious retained same-app tabs across user switches also remain unqualified; the narrow server-side `sid` mapper does not establish full real-app cookie compatibility. Independent review found no concrete blocker within this documented local-proof scope, not production readiness.

## Selected direction: authenticated application gateway

The user approved pursuing the gateway approach for Jellyfin. This selects local design/prototype work, not production deployment, Jellyfin configuration changes, public exposure or new DNS/network configuration.

Prototype boundary: a registered, fixed Jellyfin upstream, not an arbitrary-URL forwarder. Serve its UI/media in a desktop iframe on an application origin isolated from Relay's authentication origin. Authorize every proxied HTTP request and WebSocket upgrade; keep Relay cookies/signing credentials out of upstream traffic. Revoke ongoing connections when Relay access is removed. Preserve streaming backpressure, Range/206 behavior, cancellation and bounded connection/resource use. Do not buffer whole media files or strip embedding/security headers as a blanket compatibility workaround.

One address means one user-facing entry point, not putting all applications in the same browser security origin. Separate app hostnames/origins may require administrator setup; exact DNS/TLS and browser cookie behavior remain feasibility gates, not assumed existing infrastructure. Keep each visitor's Jellyfin authentication separate; no automatic administrator session sharing or claimed SSO.

First local proof is implemented separately under `spikes/001-media-gateway/` and has passed a real Chromium synthetic-media test: native video/audio decoding and seek, exact HTTP206 range bytes, separate desktop/app origins and cookies, denied ungranted requests/ticket replay, and interruption of an active stream after grant revocation. Verdict is **partial feasibility only**: fixture identities are not Relay authentication, and no real Jellyfin instance, HTTPS, Safari, HLS or WebSocket support was tested. See the spike README for exact evidence and limits.

A second local proof under `spikes/002-jellyfin-gateway/` passed against a real, isolated Jellyfin12.1.0 container on the development Mac: non-admin Jellyfin form login, synthetic H.264/AAC playback with audio decoding, seek, actual WebSocket forwarding/closure, and access denial after fixture-grant revocation. Optional Chromecast was disabled only in that test instance to avoid its external Cast SDK. The container is stopped with synthetic volumes retained. This still uses fixture gateway identities, local HTTP and Chromium—not real Relay auth, Safari, HTTPS or production deployment.

First local proof: a synthetic media fixture inside a Relay-style desktop window with browser-native playback/seek, denied access without a grant, and live revocation. Follow with an isolated Jellyfin test instance and synthetic library before claiming real Jellyfin compatibility. Existing production Jellyfin may be inspected read-only, but no login, library access or modification without specific permission. Reference: https://jellyfin.org/docs/general/post-install/networking/reverse-proxy/ .

## Recommended progression (optional public publication)

### 1. Publish one app

An administrator creates a separate publication record with a readable alias such as `/s/demo-notes`. It references an allowed registry app, an explicitly chosen public title/icon, an exposure mode and a revocation policy.

Visitors see that app, usually maximized. They do not receive the owner's desktop tree, other app names, private icon assets, Control Panel data or browser session. Private IDs and desktop paths are not publication credentials.

This is the smallest useful first sharing feature. Start admin-only; a later capability can let ordinary users request or create publications only for apps administrators explicitly mark publishable.

### 2. Publish a curated collection

A publication can contain an explicit subset of apps and public folders, with its own public presentation. Options might be:

- **Single app:** no exploration beyond that app.
- **Shared desktop:** visitors can browse only the curated collection.
- **Restricted collection:** sign-in/invite is required for selected entries.

The server returns only entries permitted by the publication and visitor's authorization. Hiding private entries in the UI is insufficient. New private apps must not become public automatically when added to an owner's folder. Public names/icons should be chosen deliberately rather than silently copying private personal labels or uploaded assets.

### 3. Invitations and delegated publishing

Possible access policies: public, Relay-account-only, or revocable invitation/password access. Use bounded guest sessions and hashed invitation credentials, with expiry and revocation. Anonymous visitors must never inherit an administrator's upstream browser cookies or privileges.

A user's ability to open an app does not automatically include permission to publish it. Delegation needs a separate administrative capability and clear ownership/audit rules.

## Native and streamed publication are different

**Native:** the visitor's browser must reach the upstream app. A private LAN address does not become Internet-accessible because Relay lists it. Suitable options are hosting an app's static assets on an approved public app origin, or deliberately configuring a separate upstream reverse proxy with its own authentication and cookie boundary. Browser-only tools such as Parcels are a useful first candidate; this does not create a file-download portal or server upload store.

**Streamed:** the visitor reaches Relay's public streaming entry, while a dedicated isolated browser reaches the configured upstream app. Use a separate guest context per visitor/publication, exact destination restrictions, quotas, idle expiry and least-privilege upstream identities. Never lend visitors an already-authenticated owner/admin session. Pixel streaming does not remove the powers of the upstream account.

Current streamed WebSocket/audio/file-transfer limitations still apply. General website compatibility and production network isolation require separate qualification.

## URL and deployment design

Keep private navigation and public publication routes separate. A private example is `/desktop/work--<stable-key>?app=notes--<stable-key>&view=maximized`; a publication might use `/s/demo-notes`. The public alias resolves a server-side publication record, not arbitrary upstream URL parameters.

Use a dedicated authentication hostname for the private control plane and a separate public presentation hostname where practical. Cookies are not port-isolated. Public native content must not share the private authentication origin. Configure HTTPS, trusted reverse-proxy handling and explicit allowed hosts/origins; do not weaken today's loopback checks globally.

A request to publish specific raw API endpoints would be a **separate adapter** with explicit path/method/authentication rules, not unrestricted URL forwarding. Sharing a desktop app page and proxying an upstream API are different features.

## Gates before public exposure

- Separate guest permissions, cookies, app data and browser contexts from private accounts.
- Reserve private-owner capacity; public traffic must not exhaust the same browser/session pool.
- Bound connection rates, concurrency, memory, idle time and outbound destinations; enforce OS/container network policy in addition to browser routing.
- Revoke guest sessions/streams when publication access changes. Avoid leaking private existence through errors or breadcrumb/catalog responses.
- Define minimal audit records without logging typed passwords, session credentials or private page content.
- Test with synthetic public fixtures and hostile requests before exposing real household services.

No public endpoint, guest browsing, invitation flow, DNS change, reverse-proxy deployment or access-policy relaxation is implemented by this proposal.
