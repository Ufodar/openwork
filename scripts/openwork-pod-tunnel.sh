#!/bin/bash
set -euo pipefail

SSH_USER="${OPENWORK_POD_SSH_USER:-root}"
SSH_HOST="${OPENWORK_POD_SSH_HOST:-hcc-subcenter1.tianhe-tech.com}"
SSH_PORT="${OPENWORK_POD_SSH_PORT:-31033}"
SSH_KEY="${OPENWORK_POD_SSH_KEY:-$HOME/biaoshu.key}"

LOCAL_WEB_PORT="${OPENWORK_LOCAL_WEB_PORT:-5173}"
LOCAL_API_PORT="${OPENWORK_LOCAL_API_PORT:-8789}"
REMOTE_WEB_PORT="${OPENWORK_REMOTE_WEB_PORT:-5173}"
REMOTE_API_PORT="${OPENWORK_REMOTE_API_PORT:-8789}"

if [ ! -f "$SSH_KEY" ]; then
    echo "[openwork-pod-tunnel] SSH key not found: $SSH_KEY"
    exit 1
fi

echo "[openwork-pod-tunnel] Forwarding:"
echo "  http://127.0.0.1:${LOCAL_WEB_PORT} -> pod:127.0.0.1:${REMOTE_WEB_PORT}"
echo "  http://127.0.0.1:${LOCAL_API_PORT} -> pod:127.0.0.1:${REMOTE_API_PORT}"
echo "[openwork-pod-tunnel] Press Ctrl+C to close."

exec ssh \
    -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 \
    -L "${LOCAL_WEB_PORT}:127.0.0.1:${REMOTE_WEB_PORT}" \
    -L "${LOCAL_API_PORT}:127.0.0.1:${REMOTE_API_PORT}" \
    -p "$SSH_PORT" \
    -i "$SSH_KEY" \
    "${SSH_USER}@${SSH_HOST}"
