#!/bin/bash
set -e
# ============================================
# OpenWork Pod Restart Script
# Kills old processes and restarts the service.
# No environment installation — assumes start-pod.sh has been run once.
# ============================================

# ---- Pod IP (change this when deploying to a new pod) ----
export OPENWORK_POD_IP=192.168.5.250

# ---- Network ----
export OPENWORK_NETWORK_MODE=pod
export OPENWORK_HOST=0.0.0.0
export VITE_HOST=0.0.0.0

# ---- Ports ----
export OPENWORK_PORT=8789
export PORT=5173

# ---- Bun path ----
export PATH=$HOME/.bun/bin:$PATH

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ============================================
# Kill old processes
# ============================================
echo "[restart-pod] Killing old processes..."

# Kill by port
for p in $OPENWORK_PORT $PORT; do
    pids=$(lsof -ti :"$p" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "[restart-pod] Killing processes on port $p: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
done

# Kill leftover dev-headless-web processes
pkill -f "dev-headless-web" 2>/dev/null || true

sleep 1

# ============================================
# Start
# ============================================
echo "[restart-pod] Starting OpenWork (POD_IP=$OPENWORK_POD_IP)..."
cd "$PROJECT_DIR"
exec bun scripts/dev-headless-web.ts
