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
PULL_REQUESTED=""

# ---- Bun path ----
export PATH="$HOME/.bun/bin:$PATH"

usage() {
    cat <<'EOF'
Usage: bash scripts/restart-pod.sh [--pull]

  --pull    Run git pull + dependency sync before restarting
  --help    Show this help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --pull)
            PULL_REQUESTED="1"
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "[restart-pod] Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

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

auto_restore_common_pod_local_changes() {
    if [ "${OPENWORK_AUTO_RESTORE_POD_LOCAL_CHANGES:-1}" != "1" ]; then
        return 0
    fi

    local restore_paths=(
        "scripts/pod-init-secrets.sh"
        "scripts/restart-pod.sh"
        "scripts/start-pod.sh"
        "scripts/secrets.env.example"
    )
    local status_output
    status_output="$(git status --porcelain -- "${restore_paths[@]}" || true)"
    if [ -z "$status_output" ]; then
        return 0
    fi

    local backup_dir="${OPENWORK_RUNTIME_ENV_DIR:-$RUNTIME_ENV_DIR_DEFAULT}/backups"
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    local patch_file="$backup_dir/pod-local-script-changes-$stamp.patch"

    git diff -- "${restore_paths[@]}" >"$patch_file" || true
    git restore --staged --worktree -- "${restore_paths[@]}" || true
    if [ ! -s "$patch_file" ]; then
        rm -f "$patch_file"
    fi

    echo "[restart-pod] Auto-restored local changes in common pod scripts to avoid pull conflicts."
    echo "[restart-pod] Controlled by OPENWORK_AUTO_RESTORE_POD_LOCAL_CHANGES=1 (default)."
}

git_pull_ff_only() {
    local remote="${OPENWORK_GIT_REMOTE:-origin}"
    local branch="${OPENWORK_GIT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
    local password="${OPENWORK_GIT_TOKEN:-${OPENWORK_GIT_PASSWORD:-}}"

    if [ -n "${OPENWORK_GIT_USERNAME:-}" ] && [ -n "$password" ]; then
        local askpass
        askpass="$(mktemp)"
        cat >"$askpass" <<'EOF'
#!/bin/sh
case "$1" in
  *sername*) printf '%s\n' "${OPENWORK_GIT_USERNAME}" ;;
  *assword*) printf '%s\n' "${OPENWORK_GIT_TOKEN:-${OPENWORK_GIT_PASSWORD:-}}" ;;
  *) printf '\n' ;;
esac
EOF
        chmod 700 "$askpass"
        if ! GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="$askpass" git pull --ff-only "$remote" "$branch"; then
            rm -f "$askpass"
            return 1
        fi
        rm -f "$askpass"
        return 0
    fi

    git pull --ff-only "$remote" "$branch"
}

maybe_pull_latest() {
    cd "$PROJECT_DIR"
    auto_restore_common_pod_local_changes

    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "[restart-pod] Working tree has local changes. Aborting pull to avoid conflicts."
        git status --short
        exit 1
    fi

    local before_rev after_rev
    before_rev="$(git rev-parse HEAD)"
    echo "[restart-pod] Pulling latest code..."
    if ! git_pull_ff_only; then
        echo "[restart-pod] git pull failed."
        echo "[restart-pod] If this is a non-interactive run, set OPENWORK_GIT_USERNAME and OPENWORK_GIT_TOKEN in ~/.config/openwork/secrets.env"
        exit 1
    fi
    after_rev="$(git rev-parse HEAD)"

    if [ "$before_rev" != "$after_rev" ]; then
        echo "[restart-pod] Code updated: $before_rev -> $after_rev"
        echo "[restart-pod] Syncing dependencies..."
        if ! pnpm install --frozen-lockfile; then
            echo "[restart-pod] Frozen lockfile install failed, retrying normal install..."
            pnpm install
        fi
    else
        echo "[restart-pod] No code changes pulled."
    fi
}

sync_global_opencode_config() {
    local sync_script="$SCRIPT_DIR/sync-global-opencode-config.py"
    if [ ! -f "$sync_script" ]; then
        echo "[restart-pod] Missing sync helper: $sync_script" >&2
        exit 1
    fi

    echo "[restart-pod] Syncing global OpenCode config from runtime env..."
    python3 "$sync_script"
}

sync_opencode_config_files() {
    local json_path="$PROJECT_DIR/opencode.json"
    local jsonc_path="$PROJECT_DIR/opencode.jsonc"

    # Keep opencode.jsonc as the editable project source of truth and mirror a
    # plain JSON copy for tooling paths that still expect opencode.json.
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

configure_global_node_path() {
    if ! command -v npm &>/dev/null; then
        return
    fi

    local npm_root=""
    npm_root="$(npm root -g 2>/dev/null || true)"
    if [ -z "$npm_root" ] || [ ! -d "$npm_root" ]; then
        return
    fi

    case ":${NODE_PATH:-}:" in
        *":$npm_root:"*) ;;
        *)
            export NODE_PATH="${NODE_PATH:+$NODE_PATH:}$npm_root"
            ;;
    esac

    echo "[restart-pod] NODE_PATH includes global npm modules: $npm_root"
}

load_runtime_env
configure_global_node_path

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
export OPENWORK_PROVIDER_ID="${OPENWORK_PROVIDER_ID:-my-company}"
export OPENWORK_MODEL_BASE_URL="${OPENWORK_MODEL_BASE_URL:-http://${OPENWORK_POD_IP}:3002/v1}"
export OPENWORK_DEFAULT_MODEL="${OPENWORK_DEFAULT_MODEL:-Qwen3.5-397B-A17B}"

ensure_runtime_ready() {
    local required=(bun pnpm python3 lsof)
    local missing=()
    local cmd
    for cmd in "${required[@]}"; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done

    if [ "${#missing[@]}" -gt 0 ]; then
        echo "[restart-pod] Missing required runtime commands: ${missing[*]}" >&2
        echo "[restart-pod] On a fresh pod, run: bash scripts/start-pod.sh" >&2
        exit 1
    fi

    local optional_doc=(file pandoc soffice pdftotext qpdf)
    local missing_optional=()
    for cmd in "${optional_doc[@]}"; do
        if ! command -v "$cmd" &>/dev/null; then
            missing_optional+=("$cmd")
        fi
    done
    if [ "${#missing_optional[@]}" -gt 0 ]; then
        echo "[restart-pod] Warning: document helper commands missing: ${missing_optional[*]}"
        echo "[restart-pod] Run bash scripts/start-pod.sh on a fresh pod to install the full document toolchain."
    fi
}

ensure_runtime_ready

if [ -z "$PULL_REQUESTED" ]; then
    PULL_REQUESTED="${OPENWORK_PULL_BEFORE_RESTART:-0}"
fi

if [ "$PULL_REQUESTED" = "1" ]; then
    maybe_pull_latest
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
sync_global_opencode_config
sync_opencode_config_files

# ---- Clean up inbox violations ----
if [ -x "$PROJECT_DIR/scripts/inbox-guard.sh" ]; then
    echo "[restart-pod] Running inbox guard (cleanup)..."
    "$PROJECT_DIR/scripts/inbox-guard.sh" --clean || true
fi

echo "[restart-pod] Starting OpenWork (POD_IP=$OPENWORK_POD_IP)..."
cd "$PROJECT_DIR"
exec bun scripts/dev-headless-web.ts
