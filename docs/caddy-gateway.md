# Optional same-host Caddy Gateway

Relay shares services through accounts, grants and per-launch app sessions. It does not replace DNS, firewall, VPN or certificate administration. This integration is optional and experimental. Publication is not deployment; see TEST_REPORT.md for executed qualification and limits.

## Choose a mode

- Direct HTTPS keeps the existing version-1 configuration and certificate references. Updates never convert it automatically.
- Existing reverse proxy uses version 2. Caddy terminates browser HTTPS, then connects to a dedicated Relay HTTP edge on `127.0.0.1` and an unused unprivileged port. The ordinary private management listener and independent updater remain separate.

Only same-host Caddy → loopback HTTP is supported here. Confirm placement on the intended server before deployment. Remote plaintext proxy connections are rejected; verified/authenticated remote backend TLS is not implemented. Local host processes are trusted: another local process can speak the forwarding contract. This is not a hostile-host or hostile-multi-tenant boundary.

## Setup

Control Panel → Gateway → Existing reverse proxy:

1. Enter a canonical HTTPS desktop origin, e.g. `https://desktop.example.com`. No trailing slash, credentials, query or fragment. Default 443 is omitted; a nondefault external port belongs in this origin.
2. Choose a same-site sibling app namespace, e.g. `apps.example.com`. Each launch receives a new randomized hostname. DNS/certificates must cover the desktop and `*.apps.example.com`; a textual shared suffix on public hosting is not sufficient.
3. Choose an unused internal port (default 8444). Bind and trusted peer are fixed to `127.0.0.1`. This is independent of the external HTTPS port.
4. Configure fixed upstream service targets as before. Upstream accounts remain separate from Relay accounts. Protected upstream HTTPS CA references and server names remain supported.
5. Optionally enter explicit comma-separated source CIDRs for the Caddy snippet. Blank generates deny-all, not public exposure. These are snippet inputs, not evidence that live Caddy enforces a policy.
6. Check configuration, review the generated snippet, and confirm changes with your current password and acknowledgement. Operator-owned configuration stays read-only. Add app drafts stay in the existing Control Panel, not across reload/logout or into another authenticated tab.

A validated configuration, running listener, browser-trusted HTTPS and enforced access policy are different facts. The UI reports external HTTPS and source policy as Not verified. Relay does not fetch arbitrary external origins to invent a secure/private badge.

### Operator reference

Set `RELAY_GATEWAY_CONFIG` to an absolute protected JSON file to keep configuration operator-owned:

```json
{
  "version": 2,
  "mode": "reverse-proxy",
  "bind": "127.0.0.1",
  "port": 8444,
  "desktopOrigin": "https://desktop.example.com",
  "appBaseDomain": "apps.example.com",
  "trustedProxy": "127.0.0.1",
  "sourceRanges": [],
  "targets": [
    {"id": "files", "label": "Files", "upstream": "http://192.168.40.20:8080", "allowDownloads": true}
  ]
}
```

Replace example values deliberately. `sourceRanges` is optional; when supplied it is an array of canonical IPv4 network CIDRs with prefix length 1–32 (up to 16). No automatic trust of all private space or universal `/0`. IPv6 policy generation is not supported in this first topology. Never put DNS API credentials, private keys or upstream passwords in this JSON.

Version 1 retains its existing keys (`bind`, `port`, `desktopHostname`, `appBaseDomain`, `keyPath`, `certPath`, `targets`). Unknown versions/fields fail closed. Version 2 does not accept local edge certificate fields. Both versions retain the same protected-read and target validation rules.

## Reviewable snippet, not global reconfiguration

Add only the two Relay sites to an operator-reviewed Caddy configuration. Keep unrelated sites and global options. Relay never installs/replaces Caddy, writes its live configuration, reloads it, installs trust, or changes network policy.

The generated snippet removes incoming `X-Forwarded-*` before reverse proxying, deletes `Forwarded`, `X-Real-IP` and Caddy's automatic `X-Forwarded-For` on the backend request, then overwrites `X-Forwarded-Proto: https` and `X-Forwarded-Host` from the actual request authority. Do not use `header_up -X-Forwarded-*` together with setting those two fields: Caddy deletion runs after setting and would remove required metadata. `Host` and `Origin` retain their browser meanings.

Relay requires exactly one Host, one matching X-Forwarded-Host and one X-Forwarded-Proto equal to `https`, from its configured loopback peer. Duplicate, missing, conflicting or additional forwarding metadata is denied before HTTP or WebSocket routing. There is no Express trust-proxy, arbitrary hop-count trust, or client-controlled canonical origin. Requests still require the configured desktop host or a live randomized app host, exact Origin/CSRF and live account/session/grant authority. Secure host-only cookies remain Secure even though the same-host transport is HTTP.

### Source restrictions and SNAT

The snippet's `remote_ip` matcher uses Caddy's immediate socket peer, not untrusted forwarded headers. Enter the actual source ranges your network design delivers. Local DNS is not access control: anyone who can reach a listener can supply a hostname and SNI without a DNS record.

Subnet routers, SNAT, upstream proxies and NAT may make different clients appear identical. If allowed and disallowed clients arrive under the same source, an IP matcher cannot distinguish them. Use a separate restricted listener or network boundary; do not claim the example provides private access. Test a permitted client and a denied client using the intended Host/SNI, including off-network where applicable, and verify an unrelated sibling site remains unchanged. Synthetic loopback tests do not prove an operator's LAN/VPN/private policy.

### Certificates

Certificate issuance and renewal belong to Caddy. The generated snippet intentionally does not supply a TLS provider block or provider credentials. Wildcard issuance usually needs DNS-01, an appropriate DNS-provider module (often absent from the ordinary Caddy binary), and operator-managed protected credentials. Installing that module or credentials requires separate operator action. Existing operator-managed certificate files are another option; their renewal remains operator work.

Validate the complete reviewed configuration with the installed Caddy before any separately approved reload. Check ordinary clients' CA/hostname trust. Node process-local CA validation and Chromium exact-SPKI test exceptions do not establish OS, Safari or public PKI trust.

## Lifecycle, updater and rollback

Managed settings are stored atomically in protected `gateway-managed.json`. No certificate/key material is copied into managed state. Changes keep accounts, app definitions and grants while retiring old app routes, credentials, HTTP/WebSocket traffic and windows. Retired desktop authentication hostnames stay excluded from Native apps until restart invalidates sessions. Invalid settings or listener failures do not silently reset saved settings.

Keep the original private management URL for maintenance and the independent updater. HTTPS-edge updater handoff remains unsupported. Runtime updates do not self-update the independent control plane or change hardened unit privileges.

Back up matching state and operator configuration before migration. Older Relay versions reject version-2 managed references; a source-only downgrade with that state is not supported. The signed updater's matching-state rollback must restore the old code and corresponding version-1/disabled state together. Reverting an operator-owned JSON reference is a separate operator action because it is outside managed state. Do not delete accounts or configuration to force startup.

## Reproduce synthetic qualification

Install no system service or trust. Obtain a Caddy release appropriate for the test host, compare its archive checksum against the upstream release checksums, extract it into temporary tooling, and set `RELAY_TEST_CADDY` to the absolute binary path before `npm test`. The backend suite intentionally fails if the real binary is missing; it does not silently skip Caddy acceptance. Hosted workflows pin Caddy 2.11.4's Linux archive SHA-512. Browser and native fixture prerequisites remain the normal `npm run setup` prerequisites.

The fixture has disabled Caddy admin/automatic HTTPS, temporary files/accounts/upstreams and process-local certificate acceptance. Port-free browser URLs use process-local hostname/port mapping to a disposable unprivileged Caddy TLS port. This proves canonical URL/Host/Origin handling through actual Caddy, not host port-443 availability, production DNS, ACME renewal, public Internet exposure or ordinary Safari trust.
