# Independent updater deployment and recovery

The fresh-host installer and disposable Linux qualification entrypoints are now
implemented in [`../../deploy/README.md`](../../deploy/README.md). Read that guide
for prerequisites, inspect/apply semantics, exact public asset contract, guarded CI
command, private SSH forwarding, initial activation and partial-install recovery.
Implementation and local tests are **not evidence of executed Linux qualification**.
No production host is accessed by these development changes.

## Fixed boundaries

- `relay` runs the desktop; `relay-updater-web` runs the independent HTTP service.
  Both are new nonlogin system users, each with its own primary group and no home.
  Their only extra group is `relay-updater-socket`. No human maintenance username or
  UID is part of the release identity or service ownership policy.
- Broker source is root-owned under `/opt/relay-updater/updater/broker`; working
  directory `/opt/relay-updater`. Python stdlib, fixed systemctl relay.service,
  `/usr/bin/node` >=26.8.1, `/usr/bin/python3` with root-owned Pillow, `/usr/bin/gh`.
  No root npm, shell, arbitrary service name or migration hook is accepted.
- Independent web entrypoint:
  `/usr/bin/node /opt/relay-updater/updater/web/index.mjs --config /etc/relay-updater/web.json`.
  Static UI is under `updater/ui/dist`. Web receives neither a bridge key nor Relay
  state. It cannot issue administrator authorizations on its own.
- `/etc/relay-updater/bridge.key` is random raw bytes, root:relay 0640. Broker checks
  the issuer's SO_PEERCRED UID and HMAC. Socket group membership grants transport
  only; monitoring capabilities do not authorize mutation.
- `/var/lib/relay-updater` contains root-only backups/journals/capabilities. Relay's
  `/var/lib/relay` is 0700 relay:relay. Both state locations and the installation
  root must be on one filesystem for atomic restoration. Qualify free space for
  real state size, not merely the artifact size.
- The durable maintenance gate is exactly
  `/var/lib/relay-updater-control/maintenance`; its root-owned parent is 0755.
  Only the socket lives in `/run/relay-updater-control`. The Relay unit and broker
  config agree on the persistent path. Never move the gate into volatile `/run`.
- Default exact loopback origins are `http://localhost:4180` and
  `http://localhost:4191`; services bind 127.0.0.1. Forward both exact ports over SSH.
  Do not disable Host/Origin checks or substitute a public bind.
- Explicit `--private-lan CANONICAL_IP` installation sets `networkMode: "private-lan"`
  in both broker.json and web.json and `RELAY_NETWORK_MODE=private-lan` plus
  `RELAY_HOSTNAME=CANONICAL_IP` in relay.env. Both origins use that canonical,
  assigned RFC1918 IPv4 on 4180/4191; web binds exactly that IP and broker readiness
  targets the same host on 4180. Relay must use the standalone profile. The root
  broker target stays fixed operator configuration, never a caller-supplied URL.
  See the installation guide for coordinated settings and actual-interface tests.
  This is trusted-network HTTP, NOT end-to-end TLS: a subnet router encrypts only
  to the router, not the final HTTP LAN hop. No firewall/proxy/DNS changes occur.

`broker.example.json` is deliberately non-installable with relayUid=0. The installer
fills the actual newly allocated service UID/socket GID, never a guessed UID. It
also creates relay.env and the keyless web.json. No example key is distributed.

## Verified baseline enrollment

Only a verified staging/enrollment path may write `.relay-verified.json`. Never
hand-forge a production receipt or relabel an HMAC fixture as GitHub provenance.
The operator-only command used by the installer is:

```sh
cd /opt/relay-updater
sudo /usr/bin/python3 -m updater.broker.enroll \
  --config /etc/relay-updater/broker.json --version vMAJOR.MINOR.PATCH
```

It requires an inactive fixed Relay unit, no current symlink, empty Relay state,
a closed persistent gate and an official signed public release. It does not start
Relay or reopen admission. The installer verifies both runtime and independent
control-plane artifacts before privileged mutation; enrollment independently
verifies the runtime again. A changed runtime digest leaves maintenance closed.
No existing-install migration is attempted. An unverified checkout is not a
rollback target; a partial installation is not automatically adopted.

## Update and recovery invariants

Maintenance closes before stop/backup. Candidate code switches only after a
consistent stopped-state checkpoint. Readiness must return the expected version
and `maintenance:true` before admission reopens. Failure restores both code and
matching state. A first baseline has no earlier signed release to roll back to.
The independent updater is not replaced by runtime updates and never self-updates.

On broker restart, interrupted activation remains gated and the journal records
interruption. No ambiguous automatic restore. Preserve candidate, journal, prior
verified code and matching state checkpoint for operator inspection. A failed
rollback stays gated. Never remove maintenance merely to clear an error. Actual
power-loss and host-reboot behavior are separate qualification, not inferred from
process restart tests or the use of persistent storage.

## Release and test evidence boundaries

Release builder/workflow ownership is separate from these deployment scripts.
The manifest contains runtime `artifact` and `updaterArtifact` with exact names,
digests and sizes, both covered by the downloaded GitHub attestation. Installer
verification uses the fixed official repository/workflow/tag, downloaded bundle,
hosted-runner restriction and no ambient credentials. Deployment never requires a
GitHub user login. Publication/CI environment approval are parent/operator tasks.

The disposable hosted-runner script performs genuine initial enrollment, real
systemd isolation/lifecycle, normal synthetic HTTP authentication and ticket handoff,
durable maintenance, expected-version rejection and signed-baseline state restore.
It cannot claim a second-version upgrade on a first published release. Its restore
probe calls the installed engine's operator-level restore primitive in a bounded
transient systemd unit with broker-equivalent ProtectSystem/ReadWritePaths hardening
and a real stopped-state checkpoint, not a fabricated receipt or pretend second
release. A protected disposable-run marker and explicit CI flags guard that internal
probe; it is not an existing-host recovery command.

The separate fixture suite exercises full download/install, failed readiness,
matching-state rollback, failed rollback, cancel and interrupted recovery against
actual disposable Node processes and local HTTP. Its HMAC trust is deliberately
labelled fixture-only. Browser UI coverage and standalone sandbox/stream/icon smoke
remain distinct evidence; HTTP handoff alone is not an executed browser click.
Local macOS tests do not prove systemd, genuine provenance, Chromium under Linux
hardening, production migration, public-network safety or neighboring-service
coexistence. Record actual commands/results and unresolved gates honestly.
