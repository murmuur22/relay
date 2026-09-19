# Private Linux installation and disposable systemd qualification

This directory implements a **fresh-host** Relay-only installation. It does not
migrate an existing source checkout or state, expose a public listener, access
another application, install dependencies, or grant host privileges to a human
account. Run only after explicit operator approval on the intended host.

Local tests are not Linux qualification. Neither a public release nor a successful
macOS fixture establishes that these units, Chromium or provenance verification
work on a Linux machine. The qualification command below must actually succeed
before recording that evidence.

## Trust and service layout

| Path / identity | Ownership and purpose |
| --- | --- |
| `relay` | New system user, own primary group, `/nonexistent`, `nologin`; no sudo, Docker, SSH or human-home access |
| `relay-updater-web` | Separate system user and primary group; same nonlogin/no-home restrictions |
| `relay-updater-socket` | Only supplementary group granted to those users; access to broker socket only |
| `/opt/relay/releases`, `/opt/relay/current` | Root-owned verified runtime releases and selected symlink; not writable by Relay |
| `/opt/relay-updater` | Root-owned independently verified broker/web/UI code; not self-updated |
| `/var/lib/relay` | `relay:relay`, 0700; accounts, private desktop state, protected setup URL |
| `/var/lib/relay-updater` | Root-only 0700; broker journal, capabilities and matching-state backups |
| `/etc/relay-updater` | Root-owned configuration; broker.json 0600, bridge.key root:relay 0640, web.json 0644 |
| `/var/lib/relay-updater-control/maintenance` | Persistent root-controlled gate; parent 0755, marker 0644 |
| `/run/relay-updater-control/broker.sock` | Runtime socket, root:relay-updater-socket 0660; directory root-owned |

Relay and web run with NoNewPrivileges, empty capability sets, protected system
and homes, private temporary storage and resource limits. Web additionally hides
Relay state, broker state and the signing key in its mount namespace. The root
broker exposes only the fixed protocol verbs and controls only `relay.service`;
it does not accept a shell, unit name, arbitrary destination or migration hook.

Both Node services use `/usr/bin/node`. The web entrypoint is
`/opt/relay-updater/updater/web/index.mjs`, working directory `/opt/relay-updater`.
Python is `/usr/bin/python3`, gh is `/usr/bin/gh`. These are generic root-owned
system prerequisites, never executables below a maintenance user's home.

## Operator prerequisites (not installed by the scripts)

- Linux x86_64 with running systemd, Python >=3.10, Node >=26.8.1 at `/usr/bin/node`.
  Use distribution packages or a separately verified official Node archive and
  root-owned installation/symlink. Never pipe remote scripts into a root shell.
  Do not point the unit at an actions/setup-node or nvm user-writable tool cache.
- Root-owned Python/Pillow (for Debian/Ubuntu, `python3-pil`), including its parent
  directories. No user-site imports. Root-owned gh with `gh attestation verify`,
  downloaded-bundle, source-ref and hosted-runner verification support.
- Chromium system libraries and fonts matching the bundled Playwright Chromium.
  Review the matching Playwright `install-deps --dry-run chromium` package list
  as a nonroot build user, then approve/install distro packages separately.
  Do not run root npm, download an unverified browser, disable Chromium's sandbox,
  or globally disable AppArmor/user-namespace protections to make a smoke pass.
  Ubuntu user-namespace/AppArmor restrictions remain an actual qualification gate.
- Standard `systemctl`, `systemd-analyze`, `useradd`, `groupadd`, `nologin` and (for
  qualification) `runuser`, `test`, procfs; sudo is for the operator/CI runner only.
- At least 10 GiB free in `/var/lib`; reserve additional space for actual state
  checkpoints. `/opt` and `/var/lib` must share a filesystem. Default ports
  4190 and 4191 must be free. Port overrides are deliberately not supported by
  this installer; do not relax Host/Origin checking.
- A reviewed, trusted installer checkout (including `updater/broker/releases.py`),
  or previously authenticated control-plane tree. Treat installer code as a
  privileged program: do not run a downloaded unverified installer as root.
  No mutable human UID/name is embedded in the trust policy.

The installer refuses existing users/groups, application directories, configuration,
state (even empty), symlinks in destination ancestors, loaded/generated units,
unit files or drop-ins. It does not overwrite/adopt a partially installed system.
No `--force`, custom destination, fixture-verifier or migration bypass exists.

## Release assets and inspect/apply

Obtain these **public** assets for one exact `vMAJOR.MINOR.PATCH` tag. A public
prerelease may use that exact tag; a draft/private release is not supported:

- `relay-release.json`
- `relay-release.attestation.json`
- `relay-linux-x64.tar.gz`
- `relay-updater-linux-x64.tar.gz`

The manifest binds runtime `artifact` and `updaterArtifact` by exact name, SHA256
and byte size. Both archives must pass before any account/unit/config/state
mutation. The script snapshots external inputs into private temporary storage,
verifies the downloaded manifest using `gh attestation verify --bundle` with
fixed `murmuur22/relay`, `.github/workflows/release.yml`, exact source tag and
`--deny-self-hosted-runners`, then validates both archives and safe extraction.
It excludes ambient GitHub tokens/config and never asks for `gh auth login`.
Anonymous public HTTPS access to GitHub/Sigstore trust material is required.

Example download as an ordinary user (replace the version only with the actual
published tag; downloads are untrusted until the installer verifies them):

```sh
version=v0.4.0
assets=$(mktemp -d)
for name in relay-release.json relay-release.attestation.json relay-linux-x64.tar.gz relay-updater-linux-x64.tar.gz; do
  curl --fail --location --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 180 \
    "https://github.com/murmuur22/relay/releases/download/$version/$name" -o "$assets/$name" || exit 1
done
python3 deploy/install-release.py --release-dir "$assets" --version "$version"
# Only after review and explicit approval:
sudo /usr/bin/python3 deploy/install-release.py --release-dir "$assets" --version "$version" --apply
```

Default mode inspects the host, verifies assets and prints a plan. Its only writes
are disposable verification scratch files, removed on exit. `--apply` creates the
accounts/groups, root-owned code/key/config, private state, persistent closed gate
and three units, validates units and reloads systemd. Then the installed genuine
`updater.broker.enroll` path independently downloads/verifies the official runtime
again and creates the protected baseline receipt. The resulting receipt must
match the first verified manifest. No receipt is fabricated by the installer.
This second transfer deliberately requires the public release to remain available.

Apply **does not start or enable any service and does not remove maintenance**.
An initial installation has no prior version to roll back to. Any error after
mutation leaves a partial installation for operator inspection; rerunning refuses
it instead of silently repairing or deleting it.

## Explicit private-LAN IPv4 mode (0.4.1 or later)

Without a flag the installer keeps the existing localhost origins and exact
127.0.0.1 listeners. For a trusted private network, opt in with
`--private-lan CANONICAL_IP` on both inspection and apply. Only canonical IPv4
literals in 10/8, 172.16/12 and 192.168/16 are accepted. No public, wildcard,
link-local/metadata, multicast, hostname, IPv6, credential, path, query or numeric/
octal alias is accepted. The address must be assigned locally (checked using
root-owned `/usr/sbin/ip -j -4 address show`) and both exact port binds must be
available before any account/config/unit/state mutation; apply repeats the check.

For example, with `lan_ip` set to the intended host's assigned RFC1918 IPv4:

```sh
python3 deploy/install-release.py --release-dir "$assets" --version "$version" --private-lan "$lan_ip"
# Separate explicit operator approval is required for apply:
sudo /usr/bin/python3 deploy/install-release.py --release-dir "$assets" --version "$version" --private-lan "$lan_ip" --apply
```

Use newly built, matching 0.4.1-or-later runtime AND control-plane artifacts, not
0.4.0 bundles with a newer installer. Both signed payloads must contain this
network support. The independently installed control plane does not self-update.
No packaging allowlist extension is required: helpers stay in the already included
`updater/web/broker-client.mjs` and `updater/broker/driver.py`.

The installer generates:

- relay.env: `RELAY_NETWORK_MODE=private-lan`, `RELAY_HOSTNAME=CANONICAL_IP`,
  and `RELAY_UPDATER_UI_ORIGIN=http://CANONICAL_IP:4191`, alongside the existing
  socket/key paths. The service stays `RELAY_PROFILE=standalone`, `PORT=4190`.
- web.json: `networkMode: "private-lan"`, `bind: "CANONICAL_IP"`,
  `uiOrigin: "http://CANONICAL_IP:4191"`,
  `relayOrigin: "http://CANONICAL_IP:4190"`, and the fixed broker socket path.
- broker.json: `networkMode: "private-lan"`, that same UI origin and
  `readinessUrl: "http://CANONICAL_IP:4190/health/ready"`.

Relay also accepts those environment settings for a source standalone launch.
The keyless updater environment entrypoint accepts `RELAY_NETWORK_MODE`,
`RELAY_UPDATER_BIND`, `RELAY_UPDATER_UI_ORIGIN`, `RELAY_UPDATER_RELAY_ORIGIN`, and
`RELAY_UPDATER_SOCKET`. Configure all components together; same host/different
ports are mandatory. No request parameter controls the internal reauthentication
target. Relay refuses invalid mode/profile/host/bridge settings before state writes.

Private HTTP is a **trusted-network mode, not end-to-end TLS**. Passwords, session
cookies and screen/input traffic are not encrypted by Relay. A VPN/subnet router
encrypts the client-to-router segment only; its LAN hop to Relay is still HTTP.
Use only an explicitly trusted network and trusted client devices. There is no
firewall/router/DNS/Tailscale/proxy/certificate change in this mode. Do not forward
these ports to the Internet. Only the independent first-party updater may share
Relay's cookie host; the native-app cookie-host guard remains unchanged.

For LAN activation use `http://$lan_ip:4190/health/ready`, then the same exact
origin for login/private desktop links and `http://$lan_ip:4191/updater/` for the
gesture-opened maintenance tab. Do not substitute localhost or rewrite Origin.
An IP change requires coordinated operator configuration and restart, not a
wildcard listener or automatic discovery in the production service.

## Initial activation after qualification and approval

These commands are not run by the local development worker:

```sh
sudo systemctl start relay-updater-broker.service relay-updater-web.service relay.service
curl --fail --max-time 10 http://localhost:4190/health/ready
```

Require the exact expected package version, `status: ready` and `maintenance: true`.
Inspect unit status, loopback listeners, ownership and logs without printing setup
credentials. On this fresh baseline only, after verification and approval, remove
the initial gate, restart the broker so it rereads recovery status, and optionally
enable the three units for boot. Do not remove a gate left by an interrupted update
using this initial-install procedure. A readiness endpoint is not a Chromium smoke.

Privately forward both exact origins:

```sh
ssh -N -L localhost:4190:127.0.0.1:4190 -L localhost:4191:127.0.0.1:4191 YOUR_SSH_USER@YOUR_VM
```

Open `http://localhost:4190`. Obtain `/var/lib/relay/setup-url.txt` through protected
operator access, never chat/logs/issues. The owner chooses the administrator
password. The setup credential is one-use, not a permanent login bypass. Updater
browsing is in the desktop; Start update opens the independently authenticated tab
at localhost:4191. Only that tab's explicit fresh-password consent can mutate.
Those forwarding instructions are for the default loopback mode. Explicit LAN
mode instead uses the configured private IP directly; no public bind, reverse
proxy or Tailscale Serve is configured by either mode.

## Disposable GitHub-hosted systemd qualification

Parent/CI owns execution. Use a **fresh disposable ubuntu-24.04 x64 hosted VM**, not
self-hosted CI, Docker-in-Docker, a privileged container, an operator workstation,
or any production machine. Run source/fixture tests first. Provision the exact
root-owned prerequisites above through reviewed package/archive steps; `apt-get`
for distro packages is acceptable, root npm and remote-shell installers are not.
In particular the runner's default Node version/path is not sufficient evidence.

The release worker's control archive must include all three units and the two
scripts. Download the four public signed assets into an external absolute directory.
The exact command, after those prerequisites, is:

```sh
sudo env GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted \
  RELAY_DISPOSABLE_SYSTEMD=I_ACCEPT_DISPOSABLE_HOST_MUTATION \
  /usr/bin/python3 deploy/qualify-systemd.py \
  --release-dir "$assets" --version "$version" --apply
```

The environment declarations are an explicit safety acknowledgment, not a
cryptographically authenticated host detector. To qualify LAN, append
`--private-lan "$lan_ip"` using that disposable runner's assigned private IPv4.
The release workflow dispatch runs loopback and private-lan as separate matrix
jobs on fresh hosted runners; LAN discovers the actual RFC1918 interface and
fails if none exists. Both jobs must pass before promotion. Source preflight also
runs real private-interface HTTP/WebSocket/Chromium and broker browser handoff
tests (no mocked bind or Origin). The script additionally requires
Linux/root/running systemd and refuses all existing installation paths, identities
and units before any destructive work. Do not set those flags on arbitrary hosts.
It never publishes, SSHs elsewhere, mounts host directories, or delegates.

What the actual command exercises:

1. Anonymous real provenance verification of both assets; genuine gated baseline
   enrollment, actual systemd start and expected-version readiness.
2. Actual separate process UIDs, NoNewPrivs/capabilities in procfs, exact groups and
   no home/login; real unprivileged read denial for Relay state and bridge key.
3. Normal synthetic administrator enrollment/login with randomly generated
   credentials held only in memory. Actual desktop read/launch API, one-use ticket
   exchange and independent updater cookie. This is HTTP integration, not browser
   rendering or a claim of an executed click/Three.js/Chromium smoke.
4. Persistent gate across broker and Relay restart, admission denial and independent
   monitoring during actual Relay stop/start.
5. Real expected-version readiness rejection, a stopped synthetic-state checkpoint
   of the genuinely signed baseline, and the installed engine's code/state restore
   primitive inside `relay-qualification-restore.service`, a bounded transient
   systemd unit with the broker's ProtectSystem/ReadWritePaths and other hardening.
   The internal probe requires the explicit disposable flags plus a root-only
   marker created only after this fresh installation. It cannot be used as a
   general existing-host recovery entrypoint. No second release is invented;
   no signature/receipt is bypassed.

There is only one signed baseline initially. This **does not exercise a second
signed release install or the UI rollback verb**. The separate real HMAC fixture
suite covers transfer/install/failure/cancel/rollback/interruption; it is not public
provenance evidence. Systemd qualification also does not reboot the VM, simulate
power loss, prove Chromium namespace compatibility, or validate production data.
Run the standalone sandbox/stream/icon smoke separately under equivalent service
hardening before production activation; see the existing `verify-standalone.mjs`.

On success or failure the qualifier gates/stops its newly created services and
retains protected state/receipts for diagnosis. Destroy the disposable VM afterward;
never upload accounts, bridge keys, authority journals, setup URLs or cookies as
CI artifacts. Only the final sanitized result and selected nonsecret metadata
should be retained. A failing command is not qualified.

## Recovery, limits and local verification

For an interrupted apply: stop only the newly created Relay units, preserve the
maintenance marker, inventory the paths above, and retain protected backups before
any operator-approved repair/removal. Do not `rm -rf` the layout or delete accounts
as an automatic cleanup. Existing state migration and partial-install repair are
separate tasks. On a first install, stop/disable and preserve diagnostic state;
there is no earlier signed version or matching checkpoint to select.

For an interrupted update: retain broker journal, verified current/prior releases,
matching stopped-state backup and persistent marker. Never clear maintenance just
to dismiss an error. The restore primitive preserves the gate on failure. Rollback
must restore both code and matching state; choosing a symlink alone is insufficient.
The independent control plane never self-updates. Neighboring applications are
outside all of these procedures.

Local checks:

```sh
python3 -m unittest updater.tests.test_deployment -v
python3 -m unittest discover -s updater/tests -v
python3 deploy/install-release.py --help
python3 deploy/qualify-systemd.py --help
node --test --test-timeout=130000 tests/backend/private-lan*.test.mjs tests/backend/updater-real.test.mjs tests/frontend/updater-real.test.mjs
node deploy/verify-standalone.mjs
node deploy/verify-standalone.mjs --private-lan
```

Tests use temporary files, anonymous-verifier command seams and disposable local
HTTP/Node fixtures. They cover refusal/overwrite/symlinks, ownership requirements,
fixed provenance flags, both artifact digests, signature failure before extraction,
inspect-vs-apply, unit configuration and disposable-host guards. They do not create
OS accounts or run Linux systemd on the development machine. Record real hosted
execution separately; no Linux/production success is asserted by this document.
