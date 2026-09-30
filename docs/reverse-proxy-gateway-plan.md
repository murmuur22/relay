# Next update: reverse-proxy Gateway

Status: implementation acceptance specification for the optional integration targeting 0.6.2. Operator instructions are in [Caddy Gateway](caddy-gateway.md); executed qualification and publication evidence are in TEST_REPORT.md. This specification is not deployment authorization.

## Product purpose

Relay helps people share services on their network and foster community. It provides a shared entry point, accounts, grants and isolated app sessions—not general network administration. Integrate with existing infrastructure instead of replacing it. Operators choose private LAN/VPN access or a separately qualified public deployment; reverse-proxy compatibility does not certify public exposure or hostile multi-tenancy.

## Outcome

An operator with an existing HTTPS reverse proxy can use `https://desktop.example.com` and per-launch `https://<random>.apps.example.com` without explicit ports in browser URLs. Existing services on the proxy remain unaffected. Relay stays unprivileged and does not compete for port 443. Keep current Direct HTTPS deployments supported and unchanged by an update.

## Architecture

Separate canonical external origins from the internal listener. Retain the same-site desktop/app namespace policy, per-launch randomized hosts, fixed upstream destinations, session/grant enforcement, secure host-only cookies, CSRF, exact Host/Origin checks and traffic revocation.

Two explicit modes:

- **Direct HTTPS:** existing certificate-file and assigned listener configuration. Preserve existing schema behavior and default disabled state.
- **Existing reverse proxy:** explicit external HTTPS desktop origin, app namespace and external HTTPS port (443 by default); independent internal listener and explicitly trusted proxy peer. Certificate issuance/renewal belongs to the proxy, not Relay.

First supported topology: Caddy and Relay on the same host, HTTP backend bound exclusively to loopback on an unused unprivileged port. Prove actual placement before recommending this for a deployment. A remote proxy using plaintext across a LAN is NOT an implicit supported default; authenticated/verified backend TLS and remote-peer restrictions are a separately qualified extension. Preserve assigned-interface and hardened-service constraints.

Proxy mode must use configured canonical external origins, not infer them from arbitrary request headers. Specify one minimal forwarding-header contract. Authenticate the connection boundary using configured peer restrictions; reject nontrusted peers and malformed/conflicting authority/protocol headers, including duplicate values. Generated Caddy configuration must strip/overwrite client-supplied forwarding metadata. Do not enable blanket Express trust-proxy or trust arbitrary hop counts. Loopback trust assumes local host processes are trusted; document that boundary.

Browser HTTPS must remain required even with an internal HTTP transport. Preserve Secure cookie behavior, exact Origin enforcement and WebSocket validation. Internal transport must not become an alternate unauthenticated entry point. Per-launch routes and credential ownership stay unchanged.

## Setup UI

Control Panel → Gateway:

1. Select Direct HTTPS or Existing reverse proxy.
2. Enter browser-facing desktop address and app domain; show final example launch address.
3. Enter internal listener/trusted proxy settings. Default the first supported proxy topology to loopback. Hide irrelevant local certificate-file inputs in proxy mode.
4. Check server-side configuration and generate a reviewable Caddy snippet.
5. Require current admin password and explicit acknowledgement before enabling; preserve operator-owned read-only configuration and draft behavior.

Keep the current visual language and compact Control Panel layout. No infrastructure dashboard redesign.

Statuses must distinguish configuration validation, listener state, external HTTPS verification and exposure-policy evidence. A running listener or successful loopback request does not prove browser trust or internet denial. If external checks were not performed, display Not verified—not a green Private/Secure badge. Browser/server reachability tests must be bounded and must not introduce arbitrary URL fetching.

## Caddy integration

Generate a narrowly scoped snippet, not a replacement Caddyfile. Include exact desktop/app hostname routing, the fixed backend, the forwarding-header contract and optional explicitly configured private-network source restrictions. Handle both HTTP requests and WebSocket upgrades. Keep unrelated virtual hosts unchanged.

Private-access examples must use actual operator-specified LAN/VPN source ranges, not automatically trust every private address. Account for subnet-router SNAT and any upstream proxy/NAT: observed source identity determines whether an IP restriction is meaningful. If public and private traffic arrive indistinguishably, refuse to claim the restriction works and document the need for a separate listener/network boundary. Local DNS is not access control. Validate denial with the intended hostname/SNI even without public DNS records.

Document Caddy DNS-challenge prerequisites and certificate renewal ownership. Do not bundle provider credentials into Relay state, snippets, release artifacts or logs. Wildcard DNS-01 requires the appropriate DNS-provider module; an ordinary Caddy build may lack it. Installing/replacing Caddy or adding DNS-provider credentials is an explicitly approved operator action, not an automatic Relay update.

Relay does not edit live Caddy configuration, DNS, firewall, router, Tailscale, trust stores or privileged service units. No automatic public exposure.

## Compatibility and migration

- Version new configuration explicitly; old Direct HTTPS references must retain their meaning. Never silently convert an existing deployment to proxy mode.
- Keep accounts, grants, targets and app definitions. Do not persist proxy API secrets or certificate material in managed state.
- Mode changes must retire active routes, credentials, HTTP/WS and gateway windows using existing lifecycle semantics, including failed/reverted listener replacement.
- Reserve retired authentication hostnames and preserve Native cookie-host conflict rejection.
- Keep private management and independent updater recovery paths unchanged. Updater handoff through the HTTPS edge remains unsupported unless separately designed and qualified; label this in UI/docs rather than weaken updater origin rules.
- Check whether runtime-only configuration changes fit the installed control plane. Do not silently modify hardened units or runtime privileges.
- Back up matching state for migration/rollback. Test rollback with a configuration created by the new version; explicitly describe when matching-state restoration is required.

## Implementation order and acceptance gates

1. **Configuration/origin separation:** inspect current validators, URL generation, managed persistence and listener lifecycle; add failing tests for independent external/internal ports, omitted default 443, explicit nondefault external ports, invalid origins, old config loading and unknown fields.
2. **Proxy transport boundary:** add trusted-loopback mode and strict header contract. Exercise rejection of direct/untrusted peers, spoofed/duplicate forwarding headers, wrong Host/Origin, cross-site mutations and unauthorized WebSocket upgrades. No test-only authentication bypass.
3. **Real Caddy fixture:** run actual Caddy against a disposable Relay instance and synthetic service; use genuine enrollment/login/grants. Verify external HTTPS, per-launch host isolation, app rendering, HTTP/download/Range and WebSocket exchange, logout/end/grant-revocation with established active traffic, and retained-session isolation regressions. Keep fixture CA trust process-local and label real-browser trust separately.
4. **Compiled setup UI and snippet generator:** cover both modes, validation/consent invalidation, read-only operator configuration, setup return-to-app draft, failed/lost mutations, narrow settings layout and accurate status labels. Validate generated snippets with Caddy and execute them, including a synthetic unrelated sibling website and private-policy positive/negative cases.
5. **Regression/release qualification:** full runtime/UI/updater suites, direct-HTTPS compatibility, hardened Linux execution, enabled-gateway upgrade and matching-state rollback. Independent review of trust boundaries before publication. Record actual results in TEST_REPORT.md and implemented changes in CHANGELOG.md; do not list this proposal as shipped functionality.
6. **Separate approved deployment:** back up exact proxy config, validate before reload, preserve the unrelated service, verify intended browsers on LAN/VPN, certificate renewal, and real off-network rejection. Controlled proxy reload only with approval and rollback instructions. No production claim from synthetic fixtures alone.

First proof: genuine Relay login and one synthetic app through real Caddy at a port-free configured external HTTPS origin, with internal Relay on an unrelated loopback port, an unaffected sibling site, and rejected forged proxy metadata.

## Out of scope

Automatic DNS/firewall/VPN setup; replacing reverse proxies; cloud tunnels; universal app compatibility; public sharing redesign; SSO into upstream apps; making the independent updater accessible through the edge; automatic production deployment. Do not promise support for every reverse proxy: qualify Caddy first, document the protocol contract, then test other integrations separately.
