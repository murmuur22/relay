# Linux x64 release artifacts

Only `.github/workflows/release.yml` on the official repository's exact stable-form tag publishes provenance. The tag must match root package.json and both lockfile version fields. The independent updater UI package has its own toolchain version; the shipped control plane receives the canonical Relay version.

The hosted job builds both browser bundles with dependency lifecycle scripts disabled, installs matching Linux Chromium, runs the Python security/engine/installer tests and actual browser/HTTP fixture and standalone checks, prunes development dependencies, and packages:

- `relay-linux-x64.tar.gz`: standalone Relay server, compiled desktop, production Node dependencies, matching Chromium payload, image normalizer, version metadata and the shared broker client.
- `relay-updater-linux-x64.tar.gz`: exact allowlisted broker and web sources, independently compiled UI, exact installer/qualifier/operator sources and systemd templates. No fixture code, tests, keys or secret configs. Its root package metadata is ESM and carries the canonical release version.
- `relay-release.json`: protocol 1, existing `artifact` descriptor unchanged, plus `updaterArtifact` with fixed name, SHA-256 and size. The manifest's GitHub attestation covers BOTH shipped archives transitively.
- `relay-release.attestation.json`: actual GitHub build-provenance bundle. Local builds never synthesize one.

The control plane is for initial operator installation. Normal broker updates continue to install only `artifact`; this is NOT control-plane self-update. Existing protocol-1 manifests without `updaterArtifact` remain accepted by the runtime updater, while initial installation requires both artifacts.

## Trust and anonymous installation

`murmuur22/relay` is the publisher identity, not a required installer login. The verifier downloads public assets using stdlib HTTPS without ambient tokens, proxies or cookies, then invokes `gh attestation verify --bundle` with a cleared environment, a fresh private temporary HOME for Sigstore's trust-root cache, nonexistent GH_CONFIG_DIR, the exact official repository/workflow/tag, and self-hosted runners denied. Deployment machines do not need a GitHub account/login.

`updater.broker.releases.verify_artifact(path, descriptor, updater=True)` validates the fixed updater filename, hash, exact integer size, regular-file type and bytes. Call it only with metadata from an attestation-verified manifest (`Releases.verified_manifest`); it is NOT a substitute for signature verification. The installer independently verifies provenance before checking/extracting both payloads or applying host changes.

## Rollout gate

A stable-form tag (initially `v0.4.0`) is published as a PUBLIC PRERELEASE with `latest=false`. Ordinary updater discovery intentionally excludes it. An operator must anonymously download the actual public assets, verify the real GitHub bundle and qualify installation/systemd on an explicitly disposable Linux x64 host before separately promoting it. Release creation/promotion and deployment are not performed by local tests.

After that prerelease exists, manually dispatch `release.yml` with input `version=v0.4.0`. The separate `qualify` job has read-only repository permission, downloads all four public assets with an empty credential environment, installs root-owned prerequisites only on a fresh hosted Ubuntu runner, and invokes:

    sudo env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME=/nonexistent GH_CONFIG_DIR=/nonexistent GH_PROMPT_DISABLED=1 GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted RELAY_DISPOSABLE_SYSTEMD=I_ACCEPT_DISPOSABLE_HOST_MUTATION /usr/bin/python3 deploy/qualify-systemd.py --release-dir "$RUNNER_TEMP/public-release" --version v0.4.0 --apply

This job cannot publish/promote a release. Do not copy the destructive hosted-runner command onto a production host. See the bundled deploy/README.md for prerequisites and the installer inspect/apply contract.

## Local builder

From repository root, after both builds and a production-only dependency tree:

    python3 -m updater.release.build --source /absolute/prepared-source --browsers /absolute/linux-browser-tree --output /absolute/new-output --version v0.4.0

Output must be outside both input trees. Missing required operator/control-plane files fail closed. Non-Linux development may add `--local-unqualified`, which writes an explicit NOT-FOR-PUBLICATION marker and supplies no attestation. Such a build is packaging evidence only, never Linux execution/provenance evidence. Initial support is Linux x64 only; external Node/Python/Pillow/gh and Chromium system libraries remain explicit host prerequisites.

    python3 -m unittest updater.tests.test_release updater.tests.test_safety -v

Tests distinguish synthetic archive fixtures and mocked gh invocation from actual signature proof. No local fixture establishes GitHub provenance.
