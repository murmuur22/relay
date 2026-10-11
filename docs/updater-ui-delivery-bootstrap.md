# One-time web-only bootstrap for runtime-delivered updater UI

Status: candidate procedure and local harness regressions only. Official signed
v0.6.5 fresh-install, existing-baseline bootstrap, and signed runtime
upgrade/matching-state rollback qualification are PENDING hosted execution.
This document is NOT permission to operate on a live installation. Do not run
replacement commands until the exact public candidate, both hosted network-mode
results, complete target admission and a separately approved exclusive maintenance
window have been reviewed. Prior v0.6.3-to-v0.6.4 refresh evidence does not qualify
these new reader/server bytes. No production access, SSH, OS trust, publication,
commit or push is part of this work.

## Scope

The only live code changes are:

- Replace `/opt/relay-updater/updater/web/server.mjs` with the exact file from the
  anonymously attested official v0.6.5 updater archive.
- Add `/opt/relay-updater/updater/web/presentation.mjs` from that same archive.

Preserve the complete existing `updater/ui/dist` fallback. This candidate does NOT
require replacing it. Do not merge old/new hashed assets. If a future admission
finds that fallback replacement is genuinely necessary, stop: that expanded
complete-directory procedure needs separate qualification and approval.

Leave all seven privileged broker modules, `web/index.mjs`, `web/broker-client.mjs`,
package metadata, configuration, keys, groups/accounts, units/drop-ins, runtime
releases/current link, accounts and user data untouched. Stop/start ONLY
`relay-updater-web.service` during bootstrap. No broker or Relay restart,
`daemon-reload`, unit enablement, runtime install or maintenance-gate removal
belongs to this procedure. This is a deliberate mixed-version web composition;
record it in a protected operator maintenance record, not package.json.

The minimum planned supported baseline is an exact signed v0.6.4 control tree.
Exact signed v0.6.3 is also admitted by the disposable harness, but becomes
operator-supported only after its own hosted bootstrap/delivery matrix passes.
Other versions, an already bootstrapped reader, locally repaired modules,
custom/static roots, links, extra loadable files, unexpected units/drop-ins or
nonstandard configuration are NOT admitted. Do not overwrite an authorized local
repair merely to fit an archive. Stop for separate baseline review.

A normal runtime update cannot change the installed v0.6.3/v0.6.4 web server.
Before bootstrap, v0.6.3's HTML X-Frame-Options DENY remains a negative even after
runtime v0.6.5 is installed; use explicit standalone recovery. v0.6.4 already has
historical framing/original-owner guards, but has no runtime reader. Do not call
its old standalone screen runtime-delivered. Runtime update first or bootstrap
first can work: without an eligible runtime presentation the new reader serves
the preserved built-in fallback.

## Gate 1 — read-only target admission

Run locally on the intended host through operator-controlled access; do not give
this qualifier production credentials. Keep cookies, launch fragments, setup
credentials, key contents and private configuration out of shared logs.

```sh
uname -sm
/usr/bin/node --version
/usr/bin/gh attestation verify --help
/usr/bin/node -p "require('/opt/relay/current/package.json').version"
systemctl --no-pager --full show relay.service relay-updater-web.service relay-updater-broker.service \
  -p FragmentPath -p DropInPaths -p User -p Group -p SupplementaryGroups \
  -p ExecStart -p WorkingDirectory -p ActiveState -p SubState -p MainPID \
  -p ExecMainStartTimestampMonotonic -p NoNewPrivileges -p RestrictAddressFamilies
systemctl cat relay-updater-web.service relay-updater-broker.service
namei -l /opt/relay-updater /opt/relay-updater/updater/web/server.mjs \
  /etc/relay-updater /etc/systemd/system/relay-updater-web.service
stat -c '%u %g %a %h %F %n' /opt/relay-updater/updater/web/*.mjs
sha256sum /opt/relay-updater/updater/broker/*.py /opt/relay-updater/updater/web/*.mjs
readlink -f /opt/relay/current
df -h /opt/relay-updater /root
```

These checks alone do NOT admit the complete host. Privately compare the ENTIRE
installed control path set and all file bytes with a safely extracted, genuinely
verified old updater archive, including package/deploy files, all web modules,
all seven broker modules and the complete fallback dist. Extra files also fail
admission. Require root ownership, non-group/world-writable ancestors and entries,
ordinary directories and regular single-link files; no symlinks, hardlinks,
special files or privilege bits. The runtime current symlink is a separate,
expected signed-runtime selection, not permission to symlink control code.

Compare installed ordinary-file/directory modes with the old installer's normalized
archive modes (0644 files, 0755 executable files/directories; code root 0755).
Record actual uid/gid, modes, single-link counts, sizes and file mtimes for backup
comparison. Installer extraction may set file mtimes at enrollment; archive tar
mtimes are not a claim of installed mtimes. Inodes/ctime differ on copy, and reads
can change atime; web parent-directory mtime necessarily changes on file renames.

Privately admit the fixed production broker/web configuration: exact existing
socket, protected key, existing same trusted hostname/different ports,
loopback or locally assigned canonical RFC1918 mode, fixed readiness target,
no custom staticDir (absent/default installed fallback only), no caller-controlled
runtime root. Confirm the unprivileged web account can read code but cannot write
code/config/units, read bridge.key, Relay state, broker private state or backups.
Require existing hardened units and no unexpected drop-ins. Do not relax units,
permissions, origin guards or accounts to make this composition start.

Use the normal standalone console to confirm no active install/cancel/rollback,
interrupted checkpoint or maintenance/recovery condition. Arrange exclusive
operator maintenance, prevent other administrators from starting updates, close
all monitors and record broker/Relay PID plus monotonic start identity and exact
runtime readiness/current selection. If exclusive coordination cannot be guaranteed,
stop. This is manual coordination, not a new root maintenance lock/controller.

## Gate 2 — public signed inputs, before any live change

Use the official PUBLIC assets for the exact admitted old tag and v0.6.5:
`relay-release.json`, `relay-release.attestation.json`, and
`relay-updater-linux-x64.tar.gz`. The normal runtime archive is separately verified
by the normal updater; bootstrap changes no runtime bytes.

Download without tokens, cookies, ambient proxy credentials or GitHub config from
`https://github.com/murmuur22/relay/releases/download/TAG/ASSET`. Snapshot inputs in
new private staging directories. Use a fresh writable anonymous HOME for Sigstore
cache and a nonexistent GH_CONFIG_DIR. Do not use `gh auth login`. Before extraction,
verify each manifest using the fixed publisher/workflow/tag and hosted-runner policy:

```sh
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$ANONYMOUS_HOME" \
  GH_CONFIG_DIR="$NONEXISTENT_GH_CONFIG" GH_PROMPT_DISABLED=1 \
  /usr/bin/gh attestation verify "$NEW/relay-release.json" \
  --bundle "$NEW/relay-release.attestation.json" --repo murmuur22/relay \
  --signer-workflow murmuur22/relay/.github/workflows/release.yml \
  --source-ref refs/tags/v0.6.5 --source-digest "$APPROVED_V065_SOURCE_SHA" \
  --signer-digest "$APPROVED_V065_SOURCE_SHA" --deny-self-hosted-runners
```

`APPROVED_V065_SOURCE_SHA` must be the independently reviewed exact official release
source, not a placeholder, guessed hash or locally built artifact. This candidate
runbook has no official v0.6.5 archive digest to supply yet. That is a pending gate,
not permission to omit source/provenance verification. The installed-engine hosted
qualifier retains its unchanged official signer policy; exact-source public-release
verification is also a separate parent gate.

Verify manifest protocol=1, repository=murmuur22/relay, platform=linux-x64,
version=v0.6.5, and `updaterArtifact` fixed name, exact integer size and SHA256.
Read back the downloaded archive size/digest and require exact equality. Apply the
same signature/ref/source/hash/size validation to the old archive. Known historical
source pins are v0.6.3 `220553aa557d0d6b4a442a11f2f1ee7ed88625ab` and v0.6.4
`0bf423eae6709b28fd5ace2a4b97e74924626fc8`; documentation hashes never substitute
for verifying the actual downloaded bundle and signed manifest.

Safely extract verified archives into separate new empty private staging trees,
without executing their code. Use the reviewed signed archive extractor or an
independently reviewed unprivileged extraction procedure that rejects traversal,
case collisions, duplicate entries, links/special files, unsafe modes and size
bounds. Do not blindly root-extract tar contents into live paths. Root operator
must snapshot/admit the extracted inputs under a root-protected non-symlink staging
parent before copying live files. Require exact old installed control inventory,
byte-identical candidate/old seven broker modules plus web index/client, and new
server/module regular single-link 0644 exact signed bytes. No locally rebuilt
server or presentation module is admitted.

## Gate 3 — complete backup and readback

The following fixed-path commands are conditional instructions, not an executed
live migration. `STAGE` is the already admitted protected v0.6.5 extracted control
tree. `BACKUP` is a new unique root-0700 directory under /root, on the code
filesystem. Its contents include secrets; never upload or expose it to web users.
Require all `.next`/`.restore` sibling paths below absent, including dangling links.
Reconfirm exclusivity and stable broker/Relay identities before stopping web.
Every failed command aborts; leave web stopped until complete verified restore.

```sh
umask 077
systemctl stop relay-updater-web.service
systemctl --no-pager --full show relay-updater-web.service -p ActiveState -p MainPID
# Require inactive, MainPID=0 and updater listener gone; broker/Relay stay live.
mkdir -m 0700 "$BACKUP"
cp -a /opt/relay-updater "$BACKUP/control"
cp -a /etc/relay-updater "$BACKUP/config"
mkdir -m 0700 "$BACKUP/units"
cp -a /etc/systemd/system/relay.service \
  /etc/systemd/system/relay-updater-broker.service \
  /etc/systemd/system/relay-updater-web.service "$BACKUP/units/"
diff -qr /opt/relay-updater "$BACKUP/control"
diff -qr /etc/relay-updater "$BACKUP/config"
tar --create --numeric-owner --file="$BACKUP/code-metadata-check.tar" --directory=/opt/relay-updater .
tar --compare --file="$BACKUP/code-metadata-check.tar" --directory="$BACKUP/control"
tar --create --numeric-owner --file="$BACKUP/config-metadata-check.tar" --directory=/etc/relay-updater .
tar --compare --file="$BACKUP/config-metadata-check.tar" --directory="$BACKUP/config"
tar --create --numeric-owner --file="$BACKUP/unit-metadata-check.tar" --directory=/etc/systemd/system \
  relay.service relay-updater-broker.service relay-updater-web.service
tar --compare --file="$BACKUP/unit-metadata-check.tar" --directory="$BACKUP/units"
```

Require complete private inventories including byte/path, uid/gid/mode, file mtime
and single-link comparisons, not just copy exit0 or index.html. Tar comparison
is not a link-safety validator; admission precedes it. Keep original signed
manifests/bundles, approved source pins, extracted inventories and actual target
readback in the protected maintenance record. Never restore whole code/config/units
over a running broker. These backups preserve immutable control/configuration/unit
inputs, not mutable broker authorization journals or a runtime state checkpoint.

## Gate 4 — two fixed files and web-only readiness

With web stopped and backup complete:

```sh
cp -a "$STAGE/updater/web/server.mjs" /opt/relay-updater/updater/web/server.mjs.next
cp -a "$STAGE/updater/web/presentation.mjs" /opt/relay-updater/updater/web/presentation.mjs.next
chown 0:0 /opt/relay-updater/updater/web/server.mjs.next \
  /opt/relay-updater/updater/web/presentation.mjs.next
chmod 0644 /opt/relay-updater/updater/web/server.mjs.next \
  /opt/relay-updater/updater/web/presentation.mjs.next
# Verify both complete staged byte hashes/sizes against the attested archive.
# Require regular single-link entries, fixed root-safe parents, no extra paths.
mv /opt/relay-updater/updater/web/server.mjs.next /opt/relay-updater/updater/web/server.mjs
mv /opt/relay-updater/updater/web/presentation.mjs.next /opt/relay-updater/updater/web/presentation.mjs
```

Before any start, read back the exact changed files and complete unchanged tree,
all seven broker hashes, fallback inventory, package/index/client, config and all
units against BACKUP. Allowed changes are exactly server.mjs replacement and NEW
presentation.mjs; no other file or metadata delta (apart from incidental directory
mtime/inode fields) is accepted. Verify unchanged broker/Relay PID/start and runtime
readiness/current selection. Then `systemctl start relay-updater-web.service` only.

Require bounded HTTP readiness; systemd Type=simple active is NOT listener readiness.
Require actual unprivileged UID, NoNewPrivileges, zero effective capabilities and
existing DAC/socket access. Index HTML must permit ONLY the exact configured Relay
frame ancestor with no HTML X-Frame-Options; API/assets still retain DENY. Wrong
Host/Origin, anonymous state, missing/reused ticket, wrong original administrator,
independent CSRF and wrong current password must be denied through genuine sessions.
Do not initiate a production runtime install for this smoke. Browser entry/render
and real signed engine upgrade/rollback belong to separately recorded disposable
evidence. Close/reopen monitors: web restart discards sessions and retained pins.

At old runtime (no eligible presentation), preserved builtin fallback must load.
At eligible signed runtime v0.6.5, `/updater/` must return the runtime index with
nonsecret `X-Relay-Updater-Presentation: v0.6.5`; every exact versioned asset must
match descriptor bytes. Do not infer this from runtime package version alone.

## Explicit restore and interruption

On interruption or failed readback/start/readiness, leave web STOPPED. Do not
restart half-old/half-new modules, clear maintenance, restart broker/Relay or
rerun the fresh installer. Verify complete backup before using it. Require fresh
restore siblings; reject unexpected files or local edits rather than repairing
broadly. An already staged `.next` file must be separately verified and quarantined
at a new protected backup path before attempting exact restore; never copy through
or blindly delete an unknown sibling.

```sh
systemctl stop relay-updater-web.service
cp -a "$BACKUP/control/updater/web/server.mjs" /opt/relay-updater/updater/web/server.mjs.restore
# Verify old server restore sibling bytes and ORIGINAL uid/gid/mode/mtime.
mv /opt/relay-updater/updater/web/server.mjs.restore /opt/relay-updater/updater/web/server.mjs
# Only when this added module is present, admitted and equals verified v0.6.5:
# MODULE_QUARANTINE is a new unique protected path inside BACKUP, same filesystem.
mv /opt/relay-updater/updater/web/presentation.mjs "$MODULE_QUARANTINE"
```

If interruption occurred before module addition, skip the module move after
inspecting the exact absent path. Do not replace or restore fallback dist: it was
never changed. Require complete old control/config/unit inventories against backup,
unchanged broker/Relay PID/start and runtime readiness/current selection, then
start ONLY web and require the old standalone HTTP/CSP/auth behavior. Retain backup
and fault evidence. Unexpected broker/Relay restart, a new active job, damaged
backup or any unadmitted delta requires inspection, not an automatic repair.
Power loss/reboot is NOT qualified; this does not promise web remains stopped
across reboot or a forcibly killed operator process.

## Qualification integration and evidence boundaries

`deploy/qualify-upgrade.py` remains fresh-disposable-only. For old v0.6.3 or v0.6.4
to exact v0.6.5 it performs three explicitly separated phases:

1. Signed old-engine runtime upgrade and real HTTP password/CSRF matching-state
   rollback with the ENTIRE old control/config/unit inventory unchanged. Web
   PID/start and the broker qualification-process identity stay unchanged through
   this runtime cycle. v0.6.3 old-screen DENY is asserted before bootstrap.
2. Start the genuine baseline broker for the separate bootstrap phase; verify the
   official candidate updater archive anonymously with the installed verifier,
   admit complete signed baseline, then perform web-only stop/backup/readback,
   interruption/restore and unprivileged DAC startup-failure/restore rehearsals,
   then final two-file apply. Broker/Relay identities stay unchanged WITHIN this
   phase. A second real administrator is fixture preparation BEFORE its state
   invariant baseline, not a claim that bootstrap creates production users.
3. Stop that broker outside bootstrap to run the separately hardened unchanged-old
   Engine/Broker worker again. Upgrade/rollback must automatically switch the new
   reader without web restart. Validate complete descriptor bytes on disk and eager
   assets after index, deliberately leave a lazy JS asset unrequested, complete
   matching-state rollback, use the unchanged engine's existing prune primitive to
   delete the obsolete candidate, then demand all retained versioned asset bytes
   over HTTP without reading deleted candidate code. Web and worker broker identity
   remain stable within the runtime cycle. Old runtime selects preserved fallback.

Broker lifecycle outside each cycle is harness setup/teardown, not a bootstrap
broker restart or an assertion that one broker PID spans all phases. Full old/new
broker source hashes are compared; configuration/unit/private state hashes are
not printed. Genuine engine receipts are checked, never synthesized. Source
qualifier helper code is separate from installed signed control code. The helper
has NO existing-host CLI, alternate-root flag, maintenance hook or trust bypass;
matching root-protected fresh-install/completion markers are also required.

Fresh signed v0.6.5 `qualify-systemd.py` separately demands actual runtime-selected
index/version marker, descriptor and every versioned asset under the default reader
configuration and existing web unit. Parent owns packaging, workflow admission of
v0.6.4, exact-source public provenance, actual hosted loopback/private-LAN runs,
and real browser click/render/lifecycle. Local tests cover real temporary file
transactions, rejected paths/metadata, HTTP bytes and command/verifier seams;
mocked signature/systemctl seams are not signed or systemd evidence. Operator
interruption rehearsal is a caught exception, not SIGKILL/reboot/power-loss proof.

The local changelog/evidence for this scoped implementation is this document and
`qualification-result.json` in the assigned release scratch; canonical public
CHANGELOG/README/TEST_REPORT integration belongs to the parent. Qualification
status stays PENDING until the actual hosted results have been reviewed.
