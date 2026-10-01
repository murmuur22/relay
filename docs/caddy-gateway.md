# Optional Caddy Gateway — same host or separate VM

Relay shares services through accounts, grants and per-launch app sessions. It does not administer your network. This integration remains experimental. See `TEST_REPORT.md` for executed evidence; publication is not deployment.

## Choose the topology explicitly

| Configuration | Browser → edge | Caddy → Relay |
| --- | --- | --- |
| Version 1: Direct HTTPS | HTTPS to Relay | No Caddy required |
| Version 2: Existing reverse proxy | HTTPS to Caddy | HTTP to **127.0.0.1 only**, on the same host |
| Version 3: Separate-VM Caddy | HTTPS to Caddy | **Mutual TLS**, assigned private IPv4 listener and one exact trusted socket peer |

Updates do not convert settings. Version 2 still rejects remote plaintext; do not change it to a LAN HTTP listener. Local processes are trusted by version 2. Version 3 does not trust an IP address alone: Relay also requires a verified client chain anchored in the explicit client CA, a non-CA leaf with clientAuth EKU and the exact configured DNS SAN (no CN fallback or wildcard identity). Caddy verifies Relay's server chain and configured server name. Browser certificates and backend certificates are separate.

The private management listener and independent updater remain separate in all modes. Preserve your existing restricted management route for recovery. The HTTPS-edge updater handoff is unsupported; this update does not make the private HTTP management/updater path encrypted or public-safe.

## Separate-VM setup: five operator steps

1. Choose the external origin, e.g. `https://desktop.example.com`, and a same-site app namespace, e.g. `apps.example.com`. Desktop and `*.apps.example.com` DNS must resolve to the **Caddy host**, not Relay. Default external HTTPS port is 443 and is omitted from browser URLs. Configure Caddy's browser certificate for both names. Wildcard ACME typically needs DNS-01, the appropriate Caddy provider module and protected operator credentials; Relay supplies none of these.
2. Provision backend credentials using a dedicated directly issuing client root and a complete backend server chain (policy below), or the complete offline OpenSSL recipe below. On Relay install only its server key/chain and the client CA certificate. On Caddy install only its client key/chain and the server CA certificate. Keep CA signing keys offline. Use authenticated operator file transfer; never paste private keys into Relay, issue trackers or the JSON. No OS trust-store installation is needed for this backend.
3. In **Control Panel → Gateway → Separate-VM Caddy (mutual TLS)**, enter Relay's assigned private LAN/Tailnet IPv4 and unused port (e.g. 8444), and the exact source IPv4 Caddy uses to reach Relay. Enter certificate paths/identities and fixed service targets. Caddy-host paths are snippet references only: Relay cannot read or verify them. Alternatively supply an operator-owned protected `RELAY_GATEWAY_CONFIG` JSON (below); the UI then stays read-only.
4. Check configuration, review the scoped snippet and confirm with your current password and explicit acknowledgement. Add only the two generated Relay sites to the existing Caddy configuration. Preserve unrelated sites/global settings. Validate the complete Caddyfile with `caddy validate --config /path/to/Caddyfile --adapter caddyfile` before a separately approved operator reload. Arrange a network policy allowing only the intended Caddy-to-Relay transport; Relay itself has no root/network administration controls.
5. From an intended client open the port-free HTTPS desktop, sign in again and use **Apps → Add app → Gateway** to select a target and grant access. Verify a permitted and denied client with actual Host/SNI, including off-network when relevant, an unaffected sibling site, backend identity verification and ordinary browser trust. A running listener or valid form is not that verification.

“External HTTPS: Not verified”, “Source access policy: Not verified”, and Caddy-host files/backend connectivity “Not verified” are deliberate. Relay does not contact an arbitrary browser origin to invent a security badge. Draft handoff to Add app survives only in the existing Control Panel's memory, not refresh/logout or another authenticated tab.

## Version-3 operator reference

All addresses below are illustrative, not discovered infrastructure:

```json
{
  "version": 3,
  "mode": "reverse-proxy",
  "bind": "192.168.40.10",
  "port": 8444,
  "desktopOrigin": "https://desktop.example.com",
  "appBaseDomain": "apps.example.com",
  "trustedProxy": "192.168.40.11",
  "backendTLS": {
    "keyPath": "/etc/relay-backend/server.key",
    "certPath": "/etc/relay-backend/server.pem",
    "clientCAPath": "/etc/relay-backend/client-ca.pem",
    "serverName": "relay-backend.example.com",
    "clientName": "caddy-backend.example.com"
  },
  "caddyTLS": {
    "serverCAPath": "/etc/caddy/relay/server-ca.pem",
    "clientCertPath": "/etc/caddy/relay/client.pem",
    "clientKeyPath": "/etc/caddy/relay/client.key"
  },
  "sourceRanges": ["192.168.40.0/24"],
  "targets": [
    {"id": "files", "label": "Files", "upstream": "http://192.168.40.20:8080", "allowDownloads": true}
  ]
}
```

Version 3 accepts only the displayed top-level fields. Required backend fields cannot be omitted; unknown nested fields also fail closed. Listener/peer must be canonical RFC1918 or CGNAT/Tailnet IPv4 literals; the listener must be assigned to Relay. `127.0.0.1` is also allowed for offline rehearsal, not a two-host deployment. No wildcard/any-interface bind, public bind, IPv6 topology, peer CIDR, hop-count trust or accept-any-client-certificate mode. Unprivileged listener ports are 1024–65535 and must not conflict with management/updater.

`serverName`/`clientName` are exact lowercase DNS SAN identities. They do not need a separate DNS record: Caddy connects to the literal backend IP and sends the explicit server name. Server leaf requires serverAuth EKU, a matching private key, current validity and matching SAN; client CA file contains one current CA certificate, not a leaf or an arbitrary CA bundle. The TLS handshake verifies the client chain/purpose/validity; Relay additionally checks the exact leaf identity. An unrelated certificate issued by that CA is insufficient. Backend certificate/key files use the existing bounded, non-symlink, regular-file reader with trusted ancestry, ownership and permissions. Use 0700 directories and 0600 files owned by the service identity (or suitably protected root-owned 0640 files readable by that service). Ancestors must not be writable by other users. Caddy paths use absolute paths containing letters, digits, slash, dot, underscore or hyphen, without `..`; they are not local Relay files and are not fetched by Relay.

Node's server-side TLS API does not expose a complete client intermediate chain for ongoing validity checks. Version 3 therefore requires the client leaf to be **directly signed by the configured self-signed client root**; intermediate-issued client identities are rejected, even if their TLS chain is otherwise trusted. This is a deliberately bounded policy, not accept-any-client trust. Server certificate files must contain the complete ordered chain (leaf, any intermediates, self-signed root), at most eight certificates; Relay verifies signatures/order and tracks every element's expiry. TLS 1.2/1.3 session resumption is disabled so each new backend connection undergoes fresh client certificate verification. Keep-alive and WebSockets still work within the earliest credential expiry.

The client CA trust domain is dedicated to this proxy. Anyone with its signing key can issue the configured identity; protect it accordingly. There is no CRL/OCSP administration. Compromised client credentials require stopping/reconfiguring trust, not merely waiting for a UI badge.

On a multihomed Caddy host, the operating system chooses the outbound source address; the snippet does not bind it. Set `trustedProxy` to the actual observed source and check it after routing/interface changes. A different source is denied, not automatically trusted.

### Preserve older modes

Version 1 retains `version`, `bind`, `port`, `desktopHostname`, `appBaseDomain`, `keyPath`, `certPath`, `targets` and its protected browser TLS checks.

Version 2 retains exactly this shape (optional `sourceRanges` may be omitted):

```json
{
  "version": 2, "mode": "reverse-proxy",
  "bind": "127.0.0.1", "port": 8444,
  "desktopOrigin": "https://desktop.example.com",
  "appBaseDomain": "apps.example.com", "trustedProxy": "127.0.0.1",
  "sourceRanges": [],
  "targets": [{"id": "files", "label": "Files", "upstream": "http://192.168.40.20:8080"}]
}
```

Version 2 does not accept backend certificate fields. Protected upstream HTTPS `upstreamTLS` options remain independent in every mode. Backend mTLS secures Caddy → Relay only: an HTTP service target is still plaintext on Relay → upstream, and private management HTTP is unchanged. Use verified HTTPS upstreams for sensitive cross-network traffic; this feature does not silently upgrade those separate paths. Origin must be canonical HTTPS without path, trailing slash, credentials, query, fragment or port zero. Default 443 is omitted; a nondefault browser port is included in the origin independently of the backend port. Same-site sibling validation includes private public-suffix rules; a textual suffix such as `github.io` is not sufficient.

## Workable offline certificate provisioning

Prerequisite: an ordinary unprivileged shell and OpenSSL supporting `req -addext` (OpenSSL 1.1.1+/3.x, or compatible LibreSSL). The tested recipe creates two dedicated self-signed CAs and two leaf credentials; it does not enroll an OS trust store, run a server, alter DNS or configure a firewall. Choose a **new absolute output directory** under your protected, nonsynced operator directory. The parent must already exist. Do not use a shared/untrusted parent. Existing output is refused; rerun into a new directory for rotation.

Set `RELAY_PKI_DIR` to that new absolute path, `RELAY_BACKEND_NAME=relay-backend.example.com` and `RELAY_CADDY_NAME=caddy-backend.example.com` in your shell, then run this block. The names must match the reference above. Example names need no public certificate issuance. Private keys are deliberately unencrypted service keys protected by filesystem permissions; protect the offline CA directory/backups too.

<!-- provisioning-recipe -->
```sh
set -eu
: "${RELAY_PKI_DIR:?Set a NEW absolute output directory}"
: "${RELAY_BACKEND_NAME:?Set the exact backend DNS identity}"
: "${RELAY_CADDY_NAME:?Set the exact client DNS identity}"
case "$RELAY_PKI_DIR" in /*) ;; *) exit 1 ;; esac
for name in "$RELAY_BACKEND_NAME" "$RELAY_CADDY_NAME"; do
  case "$name" in ''|*[!a-z0-9.-]*) exit 1 ;; esac
done
umask 077
mkdir -m 700 "$RELAY_PKI_DIR"
cd "$RELAY_PKI_DIR"
for ca in server-ca client-ca; do
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
    -keyout "$ca.key" -out "$ca.pem" -subj "/CN=$ca" \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign'
done
for role in server client; do
  if [ "$role" = server ]; then name="$RELAY_BACKEND_NAME"; purpose=serverAuth
  else name="$RELAY_CADDY_NAME"; purpose=clientAuth; fi
  openssl req -new -newkey rsa:3072 -nodes -keyout "$role.key" \
    -out "$role.csr" -subj "/CN=$name"
  printf '%s\n' 'basicConstraints=critical,CA:FALSE' \
    'keyUsage=critical,digitalSignature,keyEncipherment' \
    "extendedKeyUsage=$purpose" "subjectAltName=DNS:$name" > "$role.ext"
  openssl x509 -req -in "$role.csr" -CA "$role-ca.pem" -CAkey "$role-ca.key" \
    -CAcreateserial -days 90 -sha256 -extfile "$role.ext" -out "$role.pem"
done
# Relay tracks the lifetime of the COMPLETE ordered backend server chain.
openssl x509 -in server-ca.pem >> server.pem
openssl verify -CAfile server-ca.pem -purpose sslserver server.pem
openssl verify -CAfile client-ca.pem -purpose sslclient client.pem
```

The commands verify issuer chains and EKU; Relay's Check configuration verifies the backend server SAN, and the real mTLS connection enforces the client SAN. Do not treat the command output alone as hostname verification.

Distribute only these files through your authenticated operator workflow:

| Destination | Files |
| --- | --- |
| Relay service-readable protected directory | `server.key`, `server.pem`, `client-ca.pem` |
| Caddy service-readable protected directory | `client.key`, `client.pem`, `server-ca.pem` |
| Offline operator storage only | `server-ca.key`, `client-ca.key`, serials, CSRs/extensions and protected backups |

Do not copy the whole directory to either VM. For an existing server CA, supply the complete ordered chain including its root in `server.pem`; the client leaf must be signed directly by the dedicated configured client root (not an intermediate). Review issuer/purpose and expiry with OpenSSL before activating. The 90-day leaves in the recipe are not automatically renewed. Maintain an external renewal reminder/monitor; Relay does not schedule one.

## Snippet and request boundary

The version-3 generated `reverse_proxy` points only to the configured literal Relay IP/port, with `transport http { tls; tls_server_name ...; tls_trust_pool file ...; tls_client_auth ... ... }` (each directive on its own line in the actual snippet). It never uses `tls_insecure_skip_verify`. It explicitly preserves the original browser `Host`: recent Caddy versions otherwise rewrite Host for HTTPS upstreams. Backend TLS SNI and external HTTP Host intentionally differ.

Caddy removes incoming `X-Forwarded-*` in `request_header`, removes `Forwarded`, `X-Real-IP` and automatic `X-Forwarded-For` upstream, then sets exactly one HTTPS protocol and original external host field. Do not combine `header_up -X-Forwarded-*` with setters: deletion runs after setting and removes required metadata.

Relay first validates the actual socket peer and, for v3, authenticated TLS identity. It then requires exactly one Host, matching X-Forwarded-Host and X-Forwarded-Proto equal to `https`. Missing, duplicate, conflicting or additional forwarding metadata is rejected for HTTP and WebSockets. There is no Express trust-proxy or arbitrary client-origin inference. The external Host must be the configured desktop or a live randomized app host; Origin/CSRF, account/session/grant checks and active retirement still apply. Secure host-only cookies never become LAN plaintext cookies in v3.

### Source restrictions, SNAT and private access

`sourceRanges` affects only the two generated Caddy sites. Blank generates deny-all. When present, it is at most 16 canonical IPv4 network CIDRs, prefix lengths 1–32; no universal `/0`. `remote_ip` uses Caddy's immediate socket source, not a forged forwarding header. Enter the actual intended source networks, not a blanket assumption that all private space is trusted. DNS is not access control: any client reaching a listener can provide Host and SNI without a DNS record.

Subnet-router SNAT, NAT or upstream proxies may make permitted and forbidden clients appear identical. An IP matcher then cannot distinguish them. Use an independently restricted network/listener boundary instead; Relay does not claim this snippet solves that topology. Likewise `trustedProxy` is the actual Caddy source seen by Relay, potentially after NAT, but mTLS remains mandatory even when multiple machines share that source. Verify positive/negative source policy and unrelated sibling routing after operator changes.

## Renewal, expiry, restart and rollback

Caddy can renew browser certificates when correctly provisioned for ACME. It **does not automatically renew these backend server/client keys and certificates**. Relay loads backend files at check/apply/startup, not on every disk change. Prepare new protected files before expiry; check issuer, exact SAN, EKU and key match. With the same CAs, reissue leaves, explicitly reapply managed Relay settings (or restart operator-owned Relay through private maintenance), then explicitly reload Caddy with the new client files. Use separate new paths to retain a known-good rollback set. All managed changes retire current app windows/routes/credentials/HTTP/WS, even when ports remain the same. Users must reopen affected apps. Caddy connections are reestablished; a runtime restart also invalidates desktop sessions.

For CA rotation, plan a maintenance window: v3 intentionally accepts one explicit client CA anchor, not an arbitrary bundle/accept-any transition. Stage both sides, update/reapply Relay trust and server credentials and reload Caddy's new client/server trust. A mismatch causes denial, not plaintext fallback. Keep the old protected configuration and corresponding still-valid credentials available until the new path is independently checked. CA signing keys never belong in runtime state.

Expired/not-yet-valid server files or client CA refuse startup/apply. TLS handshakes reject missing, wrong-CA, wrong-purpose or expired clients; Relay rejects wrong SAN even from the permitted CA/peer. Expired server credentials fail Caddy verification. Relay rechecks leaf/server/client-CA validity on requests and periodically closes active TLS sockets if that policy expires; already downloaded data cannot be recalled. A failed replacement does not silently reset saved settings. A same-port replacement attempts to restore the previous listener, but expired prior credentials cannot become valid by rollback. Use the private management path to repair; never disable verification to restore service.

Managed `gateway-managed.json` stores paths/policy, not PEM contents. Accounts, fixed target definitions and grants are preserved; retired authentication hostnames remain unavailable to Native apps until restart invalidates sessions. Operator-owned configuration is never rewritten by the UI. Back up matching state, external references and certificate files before migration. Older versions reject v3; a code-only downgrade with v3 managed state is unsupported. Restore the old code and corresponding v1/v2/disabled state together through the independent updater's matching-state recovery. Files outside managed state and the live Caddy configuration require separately coordinated operator rollback. Do not delete account state to force startup.

## Reproduce synthetic qualification

Normal setup/build prerequisites apply. Obtain Caddy 2.11.4 for your platform, compare its archive SHA-512 against the upstream release checksums, extract only the binary into disposable tooling, and set `RELAY_TEST_CADDY` to its absolute path before `npm test`. Missing real Caddy is a test failure, not a silently skipped acceptance gate. Hosted Linux jobs pin the archive checksum.

The real Caddy fixture uses disposable accounts, upstreams and files, disabled Caddy admin/automatic HTTPS, and no OS trust/hosts changes. macOS tests are separate processes on loopback and do not claim two VMs. Node verifies process-local CA/hostname; Chromium uses an exact process-local SPKI exception. Port-free browser URLs use process-local hostname/port mapping to an unprivileged fixture port: they do not prove host port-443 availability, Safari/OS/public trust, DNS or ACME.

`node tools/qualify-remote-containers.mjs` additionally exercises three distinct Linux network namespaces on a local Docker daemon. First inspect `docker context inspect` and ensure the actual endpoint is local. Supply `RELAY_TEST_NODE_IMAGE` as an inspected `node@sha256:…` digest (Node 26.8.1) and `RELAY_TEST_CADDY_LINUX` as a checksummed Linux Caddy binary matching that image's architecture. The harness refuses non-Unix endpoints, copies only explicitly selected source/runtime inputs, creates a labelled internal network and disposable capability-free/read-only containers, exposes no host ports and removes its containers/network/files afterward. It does not use existing services or a Docker socket inside containers. This is network-separation evidence, not separate physical VMs, hosted systemd/signed-release execution or production access.

Its synthetic PKI directory is shared and writable by the fixture roles (including CA keys); it deliberately gives the denied client a valid proxy credential to prove that source restriction is independent. This does not qualify filesystem/credential isolation between hosts. Production provisioning must distribute only the role-specific files listed above.

The prepared signed upgrade harness admits a v0.6.2 baseline: preserve the old independent control plane, start with v2 state, activate the signed candidate, change to v3 mTLS, probe the real TLS listener, then require matching-state rollback to v2. This harness is not a claim of execution before a separately authorized signed release exists.
