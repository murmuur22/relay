# Opt-in gateway deployment configuration (release candidate)

This is an explicit runtime capability, not an installer, exposure switch, certificate authority, or production qualification. With `RELAY_GATEWAY_CONFIG` absent, the existing loopback/private-LAN startup behavior is unchanged. The original programmatic loopback gateway interface remains supported. Historical local-only limitations in `experimental-desktop-gateway.md` describe the earlier experiment; this document describes the new opt-in startup configuration.

## Operator prerequisites and preserved management access

An operator must supply DNS for the desktop and wildcard app namespace, a matching certificate chain and private key, a reachable assigned IPv4 listener address, and client trust. Relay makes no hosts, DNS, routing, firewall, trust-store, capability, or service-unit changes. Use only an explicitly approved exposure boundary. Gateway mode is not a hostile multi-tenant service or universal reverse proxy.

Keep the original private HTTP management URL and independent updater URL accessible through their existing trusted-network/forwarding boundary. The HTTPS edge updater handoff is **unsupported**. Existing updater same-host/different-port and cross-origin validation is unchanged. Do not use the edge as a full management handoff or widen updater validation to make it work. Private management login and HTTPS desktop login use different cookies; authenticate separately. Gateway app windows require the configured HTTPS desktop.

The installed unprivileged runtime reads `RELAY_GATEWAY_CONFIG` at ordinary `server/index.mjs` startup. An operator can set it in the installation's already-supported protected `/etc/relay-updater/relay.env` environment file, alongside (not replacing) the existing settings:

```ini
RELAY_GATEWAY_CONFIG=/etc/relay-gateway/gateway.json
```

No self-changing privileged units or networking are needed. The existing `ProtectSystem=strict`, `ProtectHome=true`, empty capability set and `NoNewPrivileges` are retained. Keep config and TLS inputs in `/etc/relay-gateway`, not `/home`, signed `/opt/relay/current`, or mutable `/var/lib/relay` application state. Normal runtime updates do not replace `/etc` operator configuration or update privileged control-plane units. Changing the environment/configuration and restarting remain deliberate operator actions; installing a release alone does not enable the gateway. This work does not access or modify an installed server.

## JSON schema

All top-level keys are explicit below. Unknown keys, relative paths, invalid values and empty/unreadable config fail closed rather than enabling defaults. Example addresses/names are illustrative, not provisioned services:

```json
{
  "version": 1,
  "bind": "127.0.0.1",
  "port": 8443,
  "desktopHostname": "desktop.example.com",
  "appBaseDomain": "apps.example.com",
  "keyPath": "/etc/relay-gateway/key.pem",
  "certPath": "/etc/relay-gateway/fullchain.pem",
  "targets": [
    {
      "id": "files",
      "label": "Files",
      "upstream": "http://192.168.10.20:8080",
      "entryPath": "/",
      "cookieNames": ["sid"],
      "requestHeaders": [],
      "responseHeaders": [],
      "webSocketPaths": [],
      "allowDownloads": false,
      "allowPopups": false
    }
  ]
}
```

The example listener is deliberately loopback-only. To expose it on an approved LAN/Tailnet interface, the operator must explicitly choose that interface's canonical assigned literal IPv4. No `0.0.0.0`, arbitrary hostname bind, unspecified/multicast/metadata destination or automatic interface selection. The explicit port must be 1024–65535: 443 cannot be bound with the installed empty capability set and is refused. Use a distinct unused port from Relay/private updater and any other service. A port conflict is a startup error, not permission to displace another listener.

The separate management listener still uses `RELAY_HOSTNAME`, `RELAY_NETWORK_MODE` and `PORT`, with their existing rules. `localhost` loopback and assigned RFC1918 private-LAN management are supported. Gateway configuration does not change those settings.

`desktopHostname` and `appBaseDomain` are distinct, canonical lowercase DNS sibling names with the same immediate parent. Relay produces `https://<random-32-hex>.<appBaseDomain>:<port>` for each app launch. For example desktop.example.com and apps.example.com, or desktop.relay.example.com and apps.relay.example.com. They must share a registrable site according to the pinned `tldts` public suffix list, including PRIVATE suffixes. Thus desktop.github.io/apps.github.io are refused; desktop.myrelay.duckdns.org/apps.myrelay.duckdns.org can share a delegated site. Dedicated parents under reserved `.test` and `.home.arpa` are accepted for operator-managed local names. Unknown/local suffixes, case/IDN normalization, unrelated sites, equal names and parent/child layouts are not silently repaired. This conservative policy avoids depending on third-party iframe cookies; it is not proof of every browser's cookie behavior.

The certificate's leaf must be currently valid, match the private key, cover the desktop hostname through SAN, and contain the exact DNS SAN `*.<appBaseDomain>`. Both names are necessary: a wildcard for `*.example.com` does not cover `<launch>.apps.example.com`. The supplied full chain is passed to TLS. Startup checks do not establish client trust, public PKI chain/revocation status, or operator control of DNS. Clients must validate the actual chain and hostname normally. No verification-disable option exists. Certificate renewal is external; replace protected regular files atomically and restart to load them. Running listeners do not automatically reload or schedule renewal.

## Protected files

Before enabling or renaming the gateway, remove or change any external Native app whose hostname equals the management or proposed HTTPS desktop hostname, even on another port. Startup refuses such persisted definitions (including disabled ones) before opening listeners, rather than silently rewriting account data. Keep the former valid configuration available so you can return to the management desktop to resolve conflicts. Browser cookies are not isolated by port.

Config, key, certificate and optional upstream CA paths must be absolute normalized paths. Every ancestor must be a real directory, owned by root or the runtime UID, without group/other write access; root-owned sticky temporary roots are accepted for disposable tests. Symlink ancestors and symlink final files are rejected. Final files are opened read-only with `O_NOFOLLOW | O_NONBLOCK`, must be single-link regular files owned by root/runtime UID, and must not allow other access or group writes/execute. Typical installed ownership: root:relay, directory 0750, files 0640. Runtime-owned 0600 files are allowed for local testing, but root-owned operator configuration is recommended for installation. Relay never chmods or rewrites these inputs.

Config is capped at 64 KiB; key at 64 KiB; chain/CA at 256 KiB each. Reads themselves are bounded, not merely preceded by a size check. The path policy assumes root and the runtime identity are trusted; it is not protection against an attacker already controlling either identity. Common certificate-renewal symlink trees must not be passed directly—supply deliberate protected regular-file copies. Errors are reduced to `Invalid gateway deployment configuration`, without input values or PEM/path contents. Malformed configuration is checked before normal state initialization. An unrelated later runtime failure (for example a listener port already occupied) is not a transactional rollback of normal startup state initialization.

## Fixed upstreams and TLS

There are 1–8 operator-defined targets. Existing strict cookie/header/profile/path schemas and bounds remain. IDs/labels are non-secret presentation fields; do not place credentials in them. The admin UI chooses a target ID, not an arbitrary connection URL. Registry state and authenticated gateway metadata expose no upstream address, CA, TLS key, private cookie jar or profile credential. Metadata contains only enabled status, the public desktop origin/app base domain and target IDs/labels.

Upstreams must be exact canonical literal IPv4 HTTP(S) origins (no credentials, query, fragment or path). LAN and CGNAT/Tailnet unicast are supported; the existing `safeIP` guard rejects metadata, link-local, multicast, unspecified and benchmark destinations. No arbitrary DNS resolution or redirect following is added. An HTTP redirect must stay on the configured origin; it is rewritten to the launch origin, not fetched by Relay. WebSocket redirects are disabled. An HTTP upstream is still plaintext on its network segment; HTTPS is recommended beyond a deliberately trusted segment.

HTTPS uses normal CA and hostname verification. Without an override, the literal IP must match the certificate's IP SAN and its chain must validate using Node's configured trust roots. A protected custom CA and explicit certificate identity/SNI can be supplied while retaining the fixed literal connection destination:

```json
{
  "id": "files",
  "label": "Files",
  "upstream": "https://100.64.0.20:8443",
  "upstreamTLS": {
    "caPath": "/etc/relay-gateway/upstream-ca.pem",
    "serverName": "files.internal.example.com"
  }
}
```

`caPath` and `serverName` are independently optional, HTTPS-only, and do not install trust or enable DNS connections. The identity is verified, not merely sent as SNI. HTTP Host remains the literal upstream origin; virtual-host applications needing a custom Host override are not supported. HTTPS and WSS use the same verification policy. The TLS edge remains host-only Secure/HttpOnly cookie based; exact external Host and Origin checks precede translation to the fixed private management origin. Per-launch capabilities remain bound to genuine account/session/app grants. End, logout, grant removal, disable and restart retire the relevant routes/credentials and active connections. Session restart invalidation is intentional.

The existing 1 MiB request bound remains. Responses default to 64 MiB; an operator may set a target's `maxResponseBytes` to an integer from 1 MiB through 1 GiB (for example 134217728 for 128 MiB). Both declared Content-Length and streamed bytes enforce the selected cap without whole-response buffering. Login-profile capture retains its independent maximum of 8192 bytes. Connection/route/ticket, WebSocket payload and generation-cleanup bounds remain. End does not revoke an upstream token at its issuer, erase downloaded data, or guarantee immediate cleanup after abrupt client disappearance. Apps can retain their own client-side data. Universal upstream compatibility, very large files, long-running media, retained-storage adversarial browser isolation and public exposure remain separate qualification gates.

## Programmatic compatibility and verification

Legacy `createGateway({experimentalGateway:{key,cert,port,targets}})` remains loopback-only with desktop.relay.test and per-launch *.relay.test. Its ephemeral port remains allowed. Loaded JSON produces the same object with an additional `deployment:{bind,desktopHostname,appBaseDomain}` field and server-private normalized upstream TLS bytes. Programmatic tests can supply this field; installed operators should use the validated JSON/PEM path interface so certificate/time/file checks run before startup.

Focused verification command:

```sh
node --test --test-timeout=30000 tests/backend/gateway-deployment.test.mjs tests/backend/desktop-gateway*.test.mjs tests/backend/gateway-domain-policy.test.mjs
```

Tests use genuine temporary Relay enrollment/users/grants and local disposable HTTP/TLS/WSS endpoints. Node verifies generated fixture certificates through a process-local explicit CA and correct names, with negative CA/name checks; no verification disable or trust/hosts edits. Certificate lifetime assertions move only the test validation clock. Assigned-interface testing skips explicitly if no RFC1918 IPv4 exists; CGNAT policy acceptance alone is not a real Tailnet connection test. `server/index.mjs` is exercised in a child process with JSON configuration and actual HTTPS enrollment. This is local release-candidate evidence, not Linux/systemd execution, a signed updater install, trusted Safari/device verification, real operator DNS/certificate success, or production readiness. Publication and installed qualification belong to the parent release process.
