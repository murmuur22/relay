# Private-LAN source verification (0.4.1)

## Scope and status

Implemented explicit `networkMode: "private-lan"` / `RELAY_NETWORK_MODE=private-lan` with canonical RFC1918 IPv4, standalone-only Relay operation, exact interface binding, matching updater origins and fixed reauthentication/readiness targets. Default localhost/127.0.0.1 behavior remains intact. Installer and disposable hosted qualifier accept `--private-lan CANONICAL_IP`; release dispatch qualifies loopback and LAN on separate fresh hosted runners.

The checks below were performed against disposable local state, not a production VM. They do not establish publication or installation status; see root `TEST_REPORT.md` and the actual release notes for later hosted and deployment evidence. No firewall/router/proxy/DNS or neighboring application changes were part of these tests.

## Executed evidence

Tests first reproduced missing LAN startup (`Invalid Relay hostname`), broker LAN origin refusal, missing installer flag/plan/preflight, missing qualifier network selection, and absence of private-interface standalone qualification. The new invalid-configuration regression also caught state creation before rejecting an unassigned interface. These paths passed after implementation.

Final executed commands and outcomes:

- `npm run build` and `npm run build:updater`: passed. Existing lazy Three.js chunk-size warning remains in the root build.
- `npm test`: 104 backend tests, 55 frontend tests, and full compiled hybrid integration passed. No skipped tests. Integration retained exact 512KiB native ZIP comparison, native image/notes, separate streams, input isolation, pause/resume and reconnect.
- `python3 -m unittest discover -s updater/tests -v`: 48 passed, including fixture lifecycle, mount/restore safety, installer/qualifier and network validation.
- `npm run test:updater`: Python suite, 6 updater unit tests and 35 updater browser tests passed.
- `node --test --test-timeout=100000 updater/ui/tests/http-smoke.mjs updater/ui/tests/fixture-smoke.mjs`: both passed; real compiled HTTP/cookies/CSRF and disposable broker install/readiness-failure rollback.
- `node deploy/verify-standalone.mjs`: loopback standalone qualification passed.
- LAN standalone qualification ran through `tests/backend/private-lan-stream.test.mjs`: passed with a real assigned non-loopback RFC1918 interface, HTTP, hostile WebSocket rejection against a valid owned stream, actual browser frames/input, sandbox command-line checks, private normalized icon and restart persistence.
- Both backend and compiled frontend real-broker suites ran in loopback AND private-lan modes. LAN used the actual local interface, not a mocked listener or rewritten Origin. Desktop-to-tab review handoff, fragment clearing, selected version, fresh-password authorization, actual fixture activation, failed-readiness rollback, target-bound one-use capabilities, wrong Host/Origin/CSRF rejection and read-only monitoring during Relay shutdown passed.
- `python3 deploy/install-release.py --help`, `python3 deploy/qualify-systemd.py --help`, and `git diff --check`: passed.

The extra WebSocket-denial smoke initially pre-opened a window over the desktop shortcut; the fixture now closes that probe window before testing the real browser launch. The final full regression above includes the correction.

## Operator commands and artifacts

See `deploy/README.md` for prerequisite review, setup credential handling, initial gate/activation and recovery. Set `assets` to the absolute directory of four matching official assets, `version` to the actual published tag, and `lan_ip` to the intended host's assigned canonical RFC1918 IPv4. For this change, both runtime and independently installed control-plane bundles must be rebuilt with 0.4.1 source; do not pair the new installer with 0.4.0 artifacts.

Inspection (no persistent host mutation):

```sh
python3 deploy/install-release.py --release-dir "$assets" --version "$version" --private-lan "$lan_ip"
```

Only the parent/operator performs approved apply:

```sh
sudo /usr/bin/python3 deploy/install-release.py --release-dir "$assets" --version "$version" --private-lan "$lan_ip" --apply
```

Only on a fresh disposable hosted qualification runner:

```sh
sudo env GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted \
  RELAY_DISPOSABLE_SYSTEMD=I_ACCEPT_DISPOSABLE_HOST_MUTATION \
  /usr/bin/python3 deploy/qualify-systemd.py \
  --release-dir "$assets" --version "$version" --private-lan "$lan_ip" --apply
```

Omit `--private-lan` to retain loopback. Public workflow dispatch handles separate loopback/private-lan runners and discovers the LAN runner's actual private interface. Source preflight fails, rather than inventing LAN evidence, when no private IPv4 is available.

No control-plane allowlist changes are needed for network helpers: the implementation stays in existing packaged `updater/web/broker-client.mjs` and `updater/broker/driver.py`. Rebuild both browser bundles before packaging. The signed manifest must bind BOTH matching payload hashes/sizes, and existing anonymous provenance and enrollment verification remain mandatory.

## Remaining gates and limits

These are local macOS/Chromium source and disposable HMAC-fixture results, NOT executed hosted Linux/systemd qualification, genuine GitHub attestation, VM installation, a production endpoint, or a second signed-release upgrade. The parent must execute both hosted qualification modes and the separately approved VM backup/install/activation, then verify the real endpoint. Independent source review is still separate.

Private HTTP is trusted-network mode, not end-to-end TLS. Passwords/cookies/screens/input are unencrypted on the Relay HTTP segment; a subnet-router tunnel encrypts only to that router. No firewall rules are added automatically. Only the exact assigned interface is bound. Normal session/per-user authorization, native cookie-host rejection, Host/Origin/CSRF, browser sandbox/frame policy, persistent maintenance and matching-state rollback remain in place.
