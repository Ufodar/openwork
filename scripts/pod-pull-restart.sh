#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "[pod-pull-restart] Working tree has local changes. Aborting to avoid conflicts."
    git status --short
    exit 1
fi

before_rev="$(git rev-parse HEAD)"
echo "[pod-pull-restart] Pulling latest code..."
git pull --ff-only
after_rev="$(git rev-parse HEAD)"

if [ "$before_rev" != "$after_rev" ]; then
    echo "[pod-pull-restart] Code updated: $before_rev -> $after_rev"
    echo "[pod-pull-restart] Syncing dependencies..."
    if ! pnpm install --frozen-lockfile; then
        echo "[pod-pull-restart] Frozen lockfile install failed, retrying normal install..."
        pnpm install
    fi
else
    echo "[pod-pull-restart] No code changes pulled."
fi

exec "$SCRIPT_DIR/restart-pod.sh"
