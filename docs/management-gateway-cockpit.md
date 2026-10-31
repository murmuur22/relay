# Protected management gateway — local Cockpit candidate

This is a local development candidate, not a release or deployment instruction. Root version remains 0.6.11. The approved Connection lab remains a separate design prototype; its design-plan export is not accepted as runtime configuration. No production endpoint, DNS, Caddy configuration or OS trust store is modified by these development changes.

## Shared target capabilities

The existing explicit operator/managed gateway target schema gains:

- `webSocketProtocols`: optional array of at most eight unique RFC-token-style protocol names, each 1–64 ASCII characters. Missing means none, preserving legacy behavior. Every client offer must be declared. A nonempty policy requires an offer, so the gateway does not silently downgrade. The upstream-selected protocol must be one the browser offered and is mirrored on the browser leg. Existing CA/name verification and bounds remain; live session/app authority is rechecked before completing upgrade.
- `webSocketOrigin`: `omit` by default, or `upstream` to generate an Origin from the fixed operator-approved upstream origin. This is not a free-form header override or permission to pass arbitrary client forwarding headers. Exact external app Origin checks still happen first.
- `presentation`: `frame` by default, or `tab`. A tab is opened only through an explicit browser gesture. A fresh one-use ticket is acquired at that gesture, transferred through source/origin-checked postMessage and redeemed on the isolated app origin. No ticket goes into a URL. The bootstrap severs its opener before application navigation.
- `accessPolicy`: `granted` by default, or `admin-only`. The latter is enforced on live gateway authority, so an ordinary user cannot launch/use that target even when an app grant was accidentally assigned. This does not elevate the person's upstream account. Registry visibility is still governed by the existing app/grant model; this slice does not redesign the grant editor. For an ordinary user with a genuine grant, aggregate status marks only this target `Unknown` / `not-authorized` without probing it, while retaining observations for other permitted services. Administrator status still observes the target. Session, grant and admission failures are not converted into this policy observation.

Tab responses receive a CSP sandbox with only the existing configured form/script/same-origin/download/popup permissions. Unlike an iframe attribute, this cannot be removed by application JavaScript. Relay's additional tab framing policy permits only the app's own origin, allowing same-origin service components without putting upstream code on the Relay authentication origin. Original upstream CSP and X-Frame-Options remain unchanged and intersect this policy. In-frame mode retains its existing desktop-ancestor restriction.

End/Close/logout retire server-side routes, private credential state and active gateway connections. A disowned browser tab may remain visibly open despite a close request; retirement does not erase already rendered/downloaded information. Closure is best-effort and cannot prevent server cleanup from running. Upstream issuer/account-wide logout is not implied.

## Local Cockpit profile used in qualification

Example values below are illustrative, not the owner's live configuration:

```json
{
  "id": "cockpit",
  "label": "Cockpit",
  "upstream": "https://192.168.10.20:9090",
  "entryPath": "/",
  "upstreamTLS": {
    "caPath": "/etc/relay-gateway/cockpit-ca.pem",
    "serverName": "cockpit.internal.example"
  },
  "cookieNames": ["cockpit"],
  "webSocketPaths": ["/cockpit/socket"],
  "webSocketProtocols": ["cockpit1"],
  "webSocketOrigin": "upstream",
  "presentation": "tab",
  "accessPolicy": "admin-only"
}
```

The installed configuration loader still requires protected regular files and verified certificate identity. Do not install a CA observed on an unverified network channel, disable certificate checks, or copy this sample into production without deployment-specific review.

The exercised fixture used Debian Cockpit 337-1+deb13u2, an unprivileged `learner` account and simple password authentication. This is not a claim for all Cockpit versions, PAM/2FA/SSO/certificate-login flows, complete system administration or other services. Its limited-access dashboard runs in a disposable container without host systemd/hardware access.

## Reproduce the disposable fixture

Requires the repository's pinned Node dependencies/Chromium, Python 3 and an explicitly reviewed local Docker Desktop `desktop-linux` Unix-socket context. The following container is disposable and contains no real credentials/data. Do not use privileged mode, host mounts, extra capabilities or public/LAN published ports. Do not remove a pre-existing container with the same name unless its ownership is established.

```sh
docker --context desktop-linux build -t relay-mgmt2-cockpit:local tools/fixtures/cockpit
docker --context desktop-linux run -d --name relay-mgmt2-cockpit \
  --publish 127.0.0.1:0:9090 relay-mgmt2-cockpit:local
```

Select a new private evidence directory, for example below `$TMPDIR` after confirming that it is the intended scratch directory:

```sh
python3 tools/fixtures/cockpit/prepare.py --output-dir "$TMPDIR/relay-mgmt2-proof"
export RELAY_COCKPIT_FIXTURE_STATE="$TMPDIR/relay-mgmt2-proof/cockpit-private.json"
export RELAY_COCKPIT_RESULT="$TMPDIR/relay-mgmt2-proof/transport-result.json"
export RELAY_COCKPIT_BROWSER_EVIDENCE="$TMPDIR/relay-mgmt2-proof/browser"
node tools/fixtures/cockpit/prove.mjs
npm run build
node tools/fixtures/cockpit/prove-browser.mjs
```

The prepare script verifies the fixture label/isolation and loopback publishing, creates an exclusive 0600 synthetic credential file, sets only the container's learner password and copies its public certificate. It never prints the password. Treat the state directory as private; a failed preparation can leave partial state for explicit recovery. It never overwrites an existing credential file. Cockpit's real distro session helper is activated inside the container with systemd-socket-activate, without requiring host systemd or privileged Docker. The image certificate is test-only, short-lived and must never be used for a real deployment.

The Node proof verifies upstream TLS with the explicit fixture CA and certificate identity, performs real Cockpit password login through genuine Relay APIs, confirms private-cookie session retention, negotiates cockpit1, runs a harmless literal printf in the synthetic learner's bridge session, ends the route and proves retained access denied.

The Chromium proof uses only an exact fixture-SPKI exception for browser-facing generated test certificates plus process-local hostname mapping; this is **not ordinary browser PKI trust or Safari qualification**, and no system trust/hosts changes occur. Upstream Node TLS verification remains enabled. It uses the real compiled Relay login, explicit protected-tab button, one-use browser handoff, actual Cockpit login and observed authenticated live channel. It checks uncaught UI errors, opener separation, End closing the observed socket and denial of retained-tab access. Source inspection and screenshots remain complementary; a login/HTTP 200 alone is not functional UI qualification.

Remove only the owned fixture after checks, and verify its published listener is gone:

```sh
docker --context desktop-linux rm -f relay-mgmt2-cockpit
```

No global Docker prune, unrelated restart or trust-store cleanup is required.

## Regression and remaining gates

Focused tests: `tests/backend/gateway-websocket-protocols.test.mjs`, `tests/frontend/gateway-protected-tab.test.mjs`, legacy desktop gateway/security/handoff tests and applicable deployment tests. Temporary protected configuration fixtures canonicalize their root rather than weakening the loader's symlink protection. Keep tests loopback-only; the existing assigned-private-LAN deployment test is outside this task's authority and must be explicitly excluded.

Independent review and final source/evidence reconciliation are separate acceptance gates. Production release qualification, normal browser trust on intended devices, live Babel verification and deployment remain unexecuted. Fresh-authentication/idle-limit/audit UI controls from the Connection lab are not implemented here. Generic authentication-challenge forwarding, richer cookie semantics and Pi-hole/AMP/router/WebRTC compatibility are later work, not toggles secretly enabled by this candidate.
