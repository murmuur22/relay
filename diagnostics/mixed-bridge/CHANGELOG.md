# Disposable mixed-bridge diagnostic history

## Unreleased

- Move browser execution out of the hardened lifecycle worker: the existing trusted fixture owner starts one transient systemd service with User=runner, zero capability bounding set and NoNewPrivileges. Chromium sandbox remains enabled. No production code, service capability or security policy changes.
- Use private bounded, no-follow receipt acquisition, explicit input UID/GID binding, atomic completion receipts, exact service invocation readback, process-exit status and empty-cgroup acknowledgement. Browser shutdown precedes worker shutdown. Failed, cancelled, timed-out and missing-result executions cannot qualify.
- Retain real portable process/listener success, failure, repeated-TERM, timeout and no-result controls, plus descriptor admission negatives. These are not native systemd or browser qualification; the hosted execution remains a separate gate.
- Keep the signed lifecycle labelled v0.6.11 -> explicit backward-version v0.6.8 -> matching v0.6.11 restoration, never forward-upgrade qualification. Native Ubuntu 24.04 evidence does not establish production Debian 13 equivalence. Independent exact-source review remains required before requesting production authorization.

The raw failures from earlier diagnostic commits and runs remain preserved outside this public source tree. This branch is a disposable test harness, not an application release or production runbook authorization.
