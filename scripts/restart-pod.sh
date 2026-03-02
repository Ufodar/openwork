#!/bin/bash
set -euo pipefail
# ============================================
# OpenWork Pod Restart Script
# Kills old processes and restarts the service.
# No environment installation — assumes start-pod.sh has been run once.
# ============================================

# ---- Pod IP (change this when deploying to a new pod) ----
export OPENWORK_POD_IP="${OPENWORK_POD_IP:-192.168.5.250}"

# ---- Network ----
export OPENWORK_NETWORK_MODE="${OPENWORK_NETWORK_MODE:-pod}"
export OPENWORK_HOST="${OPENWORK_HOST:-0.0.0.0}"
export VITE_HOST="${VITE_HOST:-0.0.0.0}"

# ---- Ports ----
export OPENWORK_PORT="${OPENWORK_PORT:-8789}"
export PORT="${PORT:-5173}"
export OPENWORK_PUBLIC_PORT="${OPENWORK_PUBLIC_PORT:-30789}"
export OPENWORK_WEB_PUBLIC_PORT="${OPENWORK_WEB_PUBLIC_PORT:-30173}"
export OPENWORK_BASE_URL="${OPENWORK_BASE_URL:-http://${OPENWORK_POD_IP}:${OPENWORK_PUBLIC_PORT}}"
export OPENWORK_ONLYOFFICE_URL="${OPENWORK_ONLYOFFICE_URL:-http://${OPENWORK_POD_IP}:30080}"
export OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL="${OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL:-${OPENWORK_BASE_URL}}"

# ---- Bun path ----
export PATH=$HOME/.bun/bin:$PATH

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ENV_DIR_DEFAULT="$HOME/.config/openwork"

load_runtime_env() {
    local env_dir="${OPENWORK_RUNTIME_ENV_DIR:-$RUNTIME_ENV_DIR_DEFAULT}"
    local env_files=(
        "$env_dir/pod.env"
        "$env_dir/secrets.env"
        "$PROJECT_DIR/.env.pod.local"
    )

    for env_file in "${env_files[@]}"; do
        if [ -f "$env_file" ]; then
            echo "[restart-pod] Loading env file: $env_file"
            set -a
            # shellcheck disable=SC1090
            . "$env_file"
            set +a
        fi
    done
}

sync_opencode_config_files() {
    local json_path="$PROJECT_DIR/opencode.json"
    local jsonc_path="$PROJECT_DIR/opencode.jsonc"

    if [ -f "$jsonc_path" ] && [ ! -f "$json_path" ]; then
        cp "$jsonc_path" "$json_path"
        echo "[restart-pod] Created opencode.json from opencode.jsonc"
    elif [ -f "$json_path" ] && [ ! -f "$jsonc_path" ]; then
        cp "$json_path" "$jsonc_path"
        echo "[restart-pod] Created opencode.jsonc from opencode.json"
    elif [ -f "$json_path" ] && [ -f "$jsonc_path" ]; then
        if ! cmp -s "$jsonc_path" "$json_path"; then
            cp "$jsonc_path" "$json_path"
            echo "[restart-pod] Synced opencode.json from opencode.jsonc"
        fi
    fi

    if [ -f "$json_path" ]; then
        python3 -m json.tool "$json_path" >/dev/null
    fi
    if [ -f "$jsonc_path" ]; then
        python3 -m json.tool "$jsonc_path" >/dev/null
    fi
}

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
load_runtime_env
sync_opencode_config_files
echo "[restart-pod] Starting OpenWork (POD_IP=$OPENWORK_POD_IP)..."
cd "$PROJECT_DIR"
exec bun scripts/dev-headless-web.ts
