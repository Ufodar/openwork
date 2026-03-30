#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
    cat <<'EOF'
Usage: bash scripts/recover-pod-runtime.sh [restart-pod args]

Performs a fast pod recovery by reusing existing build outputs.
Equivalent to:
  OPENWORK_REUSE_BUILD=1 \
  OPENWORK_SKIP_RUNTIME_CONTROL=1 \
  OPENWORK_SERVER_HEALTH_TIMEOUT_SECONDS=60 \
  bash scripts/restart-pod.sh ...

Examples:
  bash scripts/recover-pod-runtime.sh
  bash scripts/recover-pod-runtime.sh --force
EOF
}

for arg in "$@"; do
    case "$arg" in
        --help|-h)
            usage
            exit 0
            ;;
    esac
done

exec env \
    OPENWORK_REUSE_BUILD=1 \
    OPENWORK_SKIP_RUNTIME_CONTROL=1 \
    OPENWORK_POD_OPENCODE_SOURCE="${OPENWORK_POD_OPENCODE_SOURCE:-external}" \
    OPENCODE_VERSION="${OPENCODE_VERSION:-1.3.2}" \
    OPENWORK_MAX_ACTIVE_SESSION_RUNTIMES="${OPENWORK_MAX_ACTIVE_SESSION_RUNTIMES:-30}" \
    OPENWORK_SESSION_RUNTIME_IDLE_TTL_MS="${OPENWORK_SESSION_RUNTIME_IDLE_TTL_MS:-28800000}" \
    OPENWORK_SERVER_HEALTH_TIMEOUT_SECONDS="${OPENWORK_SERVER_HEALTH_TIMEOUT_SECONDS:-60}" \
    bash "$SCRIPT_DIR/restart-pod.sh" "$@"
