#!/usr/bin/env bash
set -euo pipefail
[[ "$GITHUB_EVENT_NAME" = workflow_dispatch ]] || exit 1
[[ "$GITHUB_REPOSITORY" = murmuur22/relay ]] || exit 1
[[ "$GITHUB_REF" = refs/heads/diag/relay-mixed-presentation-bridge ]] || exit 1
[[ "$GITHUB_WORKFLOW_REF" = murmuur22/relay/.github/workflows/ui-delivery-compatibility.yml@refs/heads/diag/relay-mixed-presentation-bridge ]] || exit 1
[[ "$RUNNER_KIND" = github-hosted && "$RUNNER_OS" = Linux && "$RUNNER_ARCH" = X64 ]] || exit 1
[[ "$DIAGNOSTIC_SHA" =~ ^[0-9a-f]{40}$ && "$DIAGNOSTIC_SHA" = "$GITHUB_SHA" ]] || exit 1
[[ "$SOURCE_SHA" = f477a9d8f227d42e83308d45c37e689d085649b7 ]] || exit 1
[[ "$ACKNOWLEDGE" = MIXED_BRIDGE_DISPOSABLE_HOST_ONLY ]] || exit 1
[[ "$ImageOS" = ubuntu24 ]] || exit 1
