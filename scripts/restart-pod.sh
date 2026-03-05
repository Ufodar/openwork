#!/bin/bash
set -euo pipefail
# ============================================
# OpenWork Pod Restart Script
# Kills old processes and restarts the service.
# No environment installation — assumes start-pod.sh has been run once.
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ENV_DIR_DEFAULT="$HOME/.config/openwork"

# ---- Bun path ----
export PATH="$HOME/.bun/bin:$PATH"

kill_pids_gracefully() {
    local reason="$1"
    shift
    local pids=("$@")
    if [ "${#pids[@]}" -eq 0 ]; then
        return 0
    fi

    echo "[restart-pod] Stopping ${reason}: ${pids[*]}"
    for pid in "${pids[@]}"; do
        kill -TERM "$pid" 2>/dev/null || true
    done

    local deadline=$((SECONDS + 3))
    local alive=()
    while [ "$SECONDS" -lt "$deadline" ]; do
        alive=()
        for pid in "${pids[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                alive+=("$pid")
            fi
        done
        if [ "${#alive[@]}" -eq 0 ]; then
            return 0
        fi
        sleep 0.1
    done

    echo "[restart-pod] Force killing ${reason}: ${alive[*]}"
    for pid in "${alive[@]}"; do
        kill -KILL "$pid" 2>/dev/null || true
    done
}

kill_by_pattern() {
    local reason="$1"
    local pattern="$2"
    local pids=()
    while IFS= read -r pid; do
        [ -n "$pid" ] && pids+=("$pid")
    done < <(pgrep -f "$pattern" 2>/dev/null || true)

    if [ "${#pids[@]}" -eq 0 ]; then
        return 0
    fi

    kill_pids_gracefully "$reason" "${pids[@]}"
}

kill_by_port() {
    local port="$1"
    local pids=()
    while IFS= read -r pid; do
        [ -n "$pid" ] && pids+=("$pid")
    done < <(lsof -ti :"$port" 2>/dev/null || true)

    if [ "${#pids[@]}" -eq 0 ]; then
        return 0
    fi

    kill_pids_gracefully "listeners on port ${port}" "${pids[@]}"
}

ensure_port_free() {
    local port="$1"
    local deadline=$((SECONDS + 3))
    while lsof -ti :"$port" >/dev/null 2>&1; do
        if [ "$SECONDS" -ge "$deadline" ]; then
            echo "[restart-pod] ERROR: port $port is still occupied after cleanup"
            lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
            return 1
        fi
        sleep 0.1
    done
    return 0
}

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

load_runtime_env

# ---- Pod IP (prefer OPENWORK_POD_IP in ~/.config/openwork/pod.env) ----
export OPENWORK_POD_IP="${OPENWORK_POD_IP:-192.168.5.10}"

# ---- Network ----
export OPENWORK_NETWORK_MODE="${OPENWORK_NETWORK_MODE:-pod}"
export OPENWORK_HOST="${OPENWORK_HOST:-0.0.0.0}"
export VITE_HOST="${VITE_HOST:-0.0.0.0}"

# ---- Ports ----
export OPENWORK_PORT="${OPENWORK_PORT:-8789}"
export PORT="${PORT:-5173}"
export OPENWORK_ONLYOFFICE_URL="${OPENWORK_ONLYOFFICE_URL:-http://${OPENWORK_POD_IP}:32764}"
export OPENWORK_ONLYOFFICE_INTERNAL_URL="${OPENWORK_ONLYOFFICE_INTERNAL_URL:-http://onlyoffice:80}"
export OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL="${OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL:-http://${OPENWORK_POD_IP}:32765/openwork}"

if [ "${OPENWORK_PULL_BEFORE_RESTART:-0}" = "1" ]; then
    echo "[restart-pod] OPENWORK_PULL_BEFORE_RESTART=1, delegating to pod-pull-restart.sh"
    OPENWORK_PULL_BEFORE_RESTART=0 exec "$SCRIPT_DIR/pod-pull-restart.sh"
fi

# ============================================
# Kill old processes
# ============================================
echo "[restart-pod] Killing old processes..."

# Kill known process signatures first (more reliable than port-only cleanup).
kill_by_pattern "dev-headless-web wrapper" "bun scripts/dev-headless-web.ts"
kill_by_pattern "openwork orchestrator for this workspace" "openwork-orchestrator.*start.*--workspace[ =]$PROJECT_DIR"
kill_by_pattern "openwork server cli for this workspace" "$PROJECT_DIR/packages/server/src/cli.ts"
kill_by_pattern "vite dev server for openwork-ui" "openwork-ui.*vite|vite/bin/vite.js.*--port 5173"
kill_by_pattern "orchestrator opencode sidecar" "/openwork-orchestrator/sidecars/opencode/.*/opencode serve"

# Port-level fallback cleanup.
for p in "$OPENWORK_PORT" "$PORT" 8789 5173; do
    kill_by_port "$p"
done

for p in "$OPENWORK_PORT" "$PORT" 8789 5173; do
    ensure_port_free "$p"
done

sleep 1

# ============================================
# Start
# ============================================
sync_opencode_config_files

# ---- Clean up inbox violations ----
if [ -x "$PROJECT_DIR/scripts/inbox-guard.sh" ]; then
    echo "[restart-pod] Running inbox guard (cleanup)..."
    "$PROJECT_DIR/scripts/inbox-guard.sh" --clean || true
fi

echo "[restart-pod] Starting OpenWork (POD_IP=$OPENWORK_POD_IP)..."
cd "$PROJECT_DIR"
exec bun scripts/dev-headless-web.ts
