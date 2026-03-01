#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SSH_USER="${OPENWORK_POD_SSH_USER:-root}"
SSH_HOST="${OPENWORK_POD_SSH_HOST:-hcc-subcenter1.tianhe-tech.com}"
SSH_PORT="${OPENWORK_POD_SSH_PORT:-31033}"
SSH_KEY="${OPENWORK_POD_SSH_KEY:-$HOME/biaoshu.key}"

SOURCE_DIR="${OPENWORK_SKILLS_SOURCE:-$PROJECT_DIR/.opencode/skills/}"
TARGET_DIR="${OPENWORK_POD_SKILLS_DIR:-/root/ai_staff/openwork/.opencode/skills/}"

if [ ! -d "$SOURCE_DIR" ]; then
    echo "[sync-skills-to-pod] Source skills directory not found: $SOURCE_DIR"
    exit 1
fi

if [ ! -f "$SSH_KEY" ]; then
    echo "[sync-skills-to-pod] SSH key not found: $SSH_KEY"
    exit 1
fi

echo "[sync-skills-to-pod] Syncing $SOURCE_DIR -> $SSH_USER@$SSH_HOST:$TARGET_DIR"

use_tar_fallback="${OPENWORK_SYNC_USE_TAR:-0}"
if [ "$use_tar_fallback" != "1" ] && command -v rsync >/dev/null 2>&1 && \
    ssh -p "$SSH_PORT" -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "command -v rsync >/dev/null 2>&1"; then
    rsync -az --delete \
        --exclude '.DS_Store' \
        -e "ssh -p $SSH_PORT -i $SSH_KEY" \
        "$SOURCE_DIR" \
        "$SSH_USER@$SSH_HOST:$TARGET_DIR"
else
    echo "[sync-skills-to-pod] Using tar-over-ssh fallback."
    tar -C "$SOURCE_DIR" --exclude '.DS_Store' -cf - . \
        | ssh -p "$SSH_PORT" -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" \
            "mkdir -p '$TARGET_DIR' && tar -C '$TARGET_DIR' -xf -"
fi

echo "[sync-skills-to-pod] Done."
