# 0.6.9 control-plane migration: source integration, not an operator release

The canonical `deploy.migration_069` package now contains the separately invoked
migration coordinator, bounded archive handling, protected transaction/rollback
logic, stock-baseline comparison, policy parser and release-only builder. Its
stdlib tests retain the accepted migration test identities. This is an unpublished
source integration for independent review. It is NOT an installed migration,
Linux/systemd qualification, or a release-qualified operator tool. Do not run the
fresh installer against an existing installation.

## Supported ordering and baseline

The only baseline described by this first policy slice is the complete stock
updater control plane from official v0.6.4, source
`0bf423eae6709b28fd5ace2a4b97e74924626fc8`, ref `refs/tags/v0.6.4`.
The original anonymous verification receipt is retained as evidence; cached
manifest/archive bytes and the generated complete inventory are pinned, not a
newly invented attestation. The fixed values in `policy.BASELINE` and
`supported-baseline.json` bind:

    manifest SHA-256 83f63eac3b456b6569b626f1bf9683569d5aadce09e2289b2c8cb42c0ae9722b
    updater archive relay-updater-linux-x64.tar.gz
    archive size 193483
    archive SHA-256 1cb69f20b7f4091a4e29c4eade6763606172ef254545c11fde5c24cedd83f687

Comparison includes the complete control tree and exact unit metadata, not just
package.json or seven matching modules. Modified/manual web refreshes,
presentation-bridge bootstraps, extra files, local repairs and other baselines
are not admitted; supported layouts may be inspected but remain inspect-only.
This policy does not qualify any particular deployed mixed installation.

Runtime-before-migration is the only supported order. The old control plane must
first install the exact officially verified v0.6.9 runtime through its ordinary
old UI. Migration compares that runtime's verified receipt to the runtime
artifact in the final verified target manifest. Migration-before-runtime is
refused. The next Linux matrix must prove both the ordinary old-UI update and
archived old-UI recovery, not assume a new staged UI works on an old engine. An
existing presentation bridge is a different, refused baseline; opening its
/updater/ route may select the new unsupported presentation again.

## Implemented source contract

`python3.11 -B -m deploy.migration_069` is the canonical package entry point.
Inspection is the default operation and does not install, acquire migration
locks, or write maintenance markers. Production apply/rollback in a source
checkout fail before service execution: there is no generated release policy.
The explicit synthetic-fixture mode is scratch-confined test infrastructure,
not a qualification override. No production apply/rollback recipe is supplied
until official distribution and real Linux qualification exist.

Apply binds the inspected plan, supported old inventory, exact target source
commit and manifest digest. It verifies target archive provenance and bytes,
rechecks baseline identity, preserves protected configuration/state and the
running Relay runtime, then separately coordinates updater services under a
persistent maintenance hold. Protected receipts, complete inventories and
acknowledged recovery checkpoints bind rollback. Drift and foreign holds are
refused; failed recovery reports uncertainty instead of claiming healthy
cleanup. Filesystem/subprocess tests exercise these paths with synthetic service
adapters; they do not execute systemd or establish Linux readiness.

## Authority and non-circular packaging

The implemented builder has `inventory`, `produce-acceptance` and `build`
subcommands under `python3.11 -B -m deploy.migration_069.build`.
Producing a JSON acceptance document only validates structure and computes pins.
It does not verify a CI run or attest anything. Synthetic schema fixtures and
mocked-verifier packaging tests confer no authority.

The source-implemented chain, pending independent review and actual official Linux execution, is:

1. The explicit pre-policy closure enumerates the package's executable modules,
   supported-baseline inventory and current `updater/broker/auth.py` and
   `releases.py` dependencies. These are namespace packages; no hidden private
   frozen-source dependency is distributed. Tests are not executable release
   inputs. Closure entries bind exact bytes and sizes. Archive entries have a
   fixed 0644 mode.
2. The preparation authority is strictly
   `refs/heads/feat/relay-069-staged-foundation` at the exact target commit in the
   existing official `release.yml`; neither `refs/heads/main` nor arbitrary
   branches are admitted. This bounded pre-policy qualification decision avoids
   merging unrelated main history; it does not change the general release
   publisher. Repository, workflow, source commit, job/run/attempt, artifact and
   tool-closure pins remain mandatory. A future separately reviewed acceptance
   job on that exact preparation ref must attest
   `migration-acceptance.json`. It must authenticate both raw Linux receipt
   digests/sizes and their run/job/artifact identities, plus target source,
   baseline and pre-policy closure. The producer/job source is implemented;
   independent review and actual official Linux execution remain pending.
3. The release-only builder requires an exact clean Linux x64 checkout, the
   verified old release and official acceptance provenance. Anonymous bundle
   verification pins repository, signer workflow, source ref, source digest
   and signer digest, and denies self-hosted runners. Each raw receipt must
   match its attested pins and strict scenario/count/cleanup schema. Local
   labels, environment flags and parser agreement cannot substitute for this.
4. The builder packs `relay-migration-linux-x64.tar.gz` with those exact files
   plus inert `migration-policy.json`. The policy binds the pre-policy closure,
   stock baseline, target and attested receipt identities; it does not hash
   itself. Building this archive does not sign or publish it.
5. A future reviewed official release job must add the optional
   `migrationArtifact` name/size/SHA-256 descriptor to protocol-1
   `relay-release.json`, leaving `artifact` and `updaterArtifact` unchanged,
   then attest that final manifest. Existing manifest parsing tolerates this
   optional descriptor; the current release workflow does not emit it.
6. Production bootstrap requires Linux root and fixed distribution-root files.
   It verifies the final official tag/source attestation, exact tool archive
   digest/size, complete archive-to-extracted-file equality and policy closure
   before migration mutations. A generated policy by itself cannot enable
   apply/rollback. Trusted reviewed bootstrap code is the verification root;
   hostile root rewriting it is outside this threat model.

No new publisher, signing key, arbitrary policy path, self-admission switch or
privileged broker self-update is introduced. Normal runtime archives and the
existing control-plane archive do not silently acquire this separate tool.

## Next gate: actual systemd matrix and official receipt producer

The disposable Linux/systemd worker, guarded supervisor, receipt reducer and
manual non-publishing preparation workflow are implemented in source. Independent
whole-candidate review must precede an official fresh Linux run in both loopback
and private-LAN modes. No dispatch or actual Linux pass is claimed here.

Local archive/controlled-service tests cover the unsigned synthetic v0.6.10
fixture built from unchanged v0.6.9 runtime bytes, live v0.6.9 prepare authority,
Ready preservation, explicit Apply, matching v0.6.9 rollback, pre-stop refusals
and truthful cleanup failures. This tier is NOT real-linux-systemd evidence;
v0.6.10 is not an actual release and the migration target remains v0.6.9.

The parser already requires schema 1, kind `relay-migration-systemd-receipt`,
tier `real-linux-systemd`, the exact mode, official workflow/ref/source and
positive integer runId/jobId/artifactId, exact target/baseline/closure, exit 0,
success true, tests=passed>0, failed/errors/skipped=0, and cleanup true. Required
scenario booleans are:

    stock-old-provenance
    ordinary-old-ui-runtime-upgrade
    archived-old-ui-recovery
    inspect-no-write
    apply
    rollback
    activation-failure-restore
    final-release-failure-restore
    rollback-uncertainty-retry
    drift-refusal
    protected-state-preserved
    service-identities

The producer must derive these from real execution, retain raw command exits
and cleanup observations, and bind the uploaded receipt bytes and identities in
the attested acceptance. Passing this parser on synthetic input is not passing
any of those gates. Real systemd isolation, official preparation provenance,
final tool distribution/provenance, operator ordering and stable publication
remain separate blocking gates. No production host access or deployment is
part of this first slice.
