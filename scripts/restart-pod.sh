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
RUNTIME_GENERATED_ENV_FILE_NAME="generated-secrets.env"
PULL_REQUESTED=""
FORCE_RESTART=""
REUSE_BUILD_REQUESTED=""
SKIP_RUNTIME_CONTROL_REQUESTED=""
RUNTIME_CONTROL_SUPPORTED="0"
RUNTIME_CONTROL_CLEANUP_REQUIRED="0"
RUNTIME_KILL_PHASE_STARTED="0"
OPENWORK_DRAIN_TIMEOUT_SECONDS_DEFAULT=900

# ---- Bun path ----
export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
# Keep the downloaded OpenCode sidecar available as a fallback, but prefer a
# healthy external opencode binary already installed on the pod.
export OPENCODE_VERSION="${OPENCODE_VERSION:-1.3.2}"

is_truthy() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|on|ON)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

runtime_env_dir() {
    printf '%s\n' "${OPENWORK_RUNTIME_ENV_DIR:-$RUNTIME_ENV_DIR_DEFAULT}"
}

runtime_generated_env_file() {
    printf '%s/%s\n' "$(runtime_env_dir)" "$RUNTIME_GENERATED_ENV_FILE_NAME"
}

generate_runtime_token() {
    python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
}

usage() {
    cat <<'EOF'
Usage: bash scripts/restart-pod.sh [--pull] [--force]

  --pull    Run git pull + dependency sync before restarting
  --force   Interrupt active sessions and restart immediately
  --reuse-build
            Reuse existing dist/ and dist/bin outputs instead of rebuilding
  --skip-runtime-control
            Skip /admin/runtime/restart negotiation and fall back to legacy stop/start
  Environment overrides:
    OPENWORK_WEB_HEALTH_TIMEOUT_SECONDS
    OPENWORK_PUBLIC_WEB_HEALTH_TIMEOUT_SECONDS
    OPENWORK_SERVER_HEALTH_TIMEOUT_SECONDS
  --help    Show this help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --pull)
            PULL_REQUESTED="1"
            ;;
        --force)
            FORCE_RESTART="1"
            ;;
        --reuse-build)
            REUSE_BUILD_REQUESTED="1"
            ;;
        --skip-runtime-control)
            SKIP_RUNTIME_CONTROL_REQUESTED="1"
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

if [ -z "$REUSE_BUILD_REQUESTED" ] && is_truthy "${OPENWORK_REUSE_BUILD:-0}"; then
    REUSE_BUILD_REQUESTED="1"
fi

if [ -z "$SKIP_RUNTIME_CONTROL_REQUESTED" ] && is_truthy "${OPENWORK_SKIP_RUNTIME_CONTROL:-0}"; then
    SKIP_RUNTIME_CONTROL_REQUESTED="1"
fi

if [ -n "$PULL_REQUESTED" ] && [ -n "$REUSE_BUILD_REQUESTED" ]; then
    echo "[restart-pod] --pull and --reuse-build cannot be used together." >&2
    echo "[restart-pod] Pulling code may require fresh build outputs; run a full restart after pull." >&2
    exit 1
fi

# `nohup bash scripts/restart-pod.sh ... &` only protects this shell process.
# Re-exec under a dedicated session so child services do not inherit the SSH
# session/process group and die on a later SIGHUP.
if [ -z "${OPENWORK_RESTART_POD_SETSID:-}" ] && command -v setsid >/dev/null 2>&1; then
    echo "[restart-pod] Re-executing in a dedicated session to survive SSH hangups..."
    exec env OPENWORK_RESTART_POD_SETSID=1 setsid bash "$0" "$@"
fi

trap '' HUP

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

count_pattern_matches() {
    local pattern="$1"
    local count
    count="$(pgrep -fc "$pattern" 2>/dev/null || true)"
    if [ -z "$count" ]; then
        count="0"
    fi
    printf '%s\n' "$count"
}

log_leak_counts() {
    local stage="$1"
    local opencode_serve_count="$2"
    local opencode_tui_count="$3"
    local bocha_uv_count="$4"
    local bocha_python_count="$5"
    local snapshot_git_count="$6"
    echo "[restart-pod] Leak counts ${stage}: opencode serve=${opencode_serve_count} opencode -s=${opencode_tui_count} bocha uv=${bocha_uv_count} bocha python=${bocha_python_count} snapshot git=${snapshot_git_count}"
}

ensure_pattern_drained() {
    local reason="$1"
    local pattern="$2"
    local remaining
    remaining="$(count_pattern_matches "$pattern")"
    if [ "$remaining" -eq 0 ]; then
        return 0
    fi

    echo "[restart-pod] ${reason} still present after cleanup (${remaining}); retrying..."
    kill_by_pattern "${reason} retry" "$pattern"
    remaining="$(count_pattern_matches "$pattern")"
    if [ "$remaining" -ne 0 ]; then
        echo "[restart-pod] Warning: ${reason} still present after forced cleanup (${remaining})." >&2
    fi
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
    local env_dir
    env_dir="$(runtime_env_dir)"
    local env_files=(
        "$env_dir/pod.env"
        "$(runtime_generated_env_file)"
        "$env_dir/secrets.env"
        "$PROJECT_DIR/.env.pod.local"
    )
    local preserved_names=()
    local preserved_values=()
    local key

    while IFS='=' read -r key _; do
        case "$key" in
            OPENWORK_*)
                preserved_names+=("$key")
                preserved_values+=("${!key}")
                ;;
        esac
    done < <(env)

    for env_file in "${env_files[@]}"; do
        if [ -f "$env_file" ]; then
            echo "[restart-pod] Loading env file: $env_file"
            set -a
            # shellcheck disable=SC1090
            . "$env_file"
            set +a
        fi
    done

    local index
    for index in "${!preserved_names[@]}"; do
        export "${preserved_names[$index]}=${preserved_values[$index]}"
    done
}

ensure_runtime_tokens() {
    local generated_env
    generated_env="$(runtime_generated_env_file)"
    mkdir -p "$(runtime_env_dir)"

    if [ -z "${OPENWORK_TOKEN:-}" ]; then
        export OPENWORK_TOKEN
        OPENWORK_TOKEN="$(generate_runtime_token)"
    fi
    if [ -z "${OPENWORK_HOST_TOKEN:-}" ]; then
        export OPENWORK_HOST_TOKEN
        OPENWORK_HOST_TOKEN="$(generate_runtime_token)"
    fi

    cat >"$generated_env" <<EOF
export OPENWORK_TOKEN='$OPENWORK_TOKEN'
export OPENWORK_HOST_TOKEN='$OPENWORK_HOST_TOKEN'
EOF
    chmod 600 "$generated_env" 2>/dev/null || true
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

detect_missing_python_skill_packages() {
    if ! command -v python3 &>/dev/null; then
        return 0
    fi

    python3 - <<'PY'
checks = [
    ("pypdf", "pypdf"),
    ("pdfplumber", "pdfplumber"),
    ("reportlab", "reportlab"),
    ("pytesseract", "pytesseract"),
    ("pdf2image", "pdf2image"),
    ("openpyxl", "openpyxl"),
    ("pandas", "pandas"),
    ("PIL", "pillow"),
    ("defusedxml", "defusedxml"),
    ("lxml", "lxml"),
    ("docx", "python-docx"),
    ("markitdown", "markitdown[pptx]"),
]
missing = []
seen = set()
for module_name, package_name in checks:
    try:
        __import__(module_name)
    except Exception:
        if package_name not in seen:
            missing.append(package_name)
            seen.add(package_name)
print("\n".join(missing))
PY
}

load_runtime_env
ensure_runtime_tokens
configure_global_node_path

# ---- Pod IP (prefer OPENWORK_POD_IP in ~/.config/openwork/pod.env) ----
export OPENWORK_POD_IP="${OPENWORK_POD_IP:-192.168.5.10}"

# ---- Network ----
export OPENWORK_NETWORK_MODE="${OPENWORK_NETWORK_MODE:-pod}"
export OPENWORK_HOST="${OPENWORK_HOST:-0.0.0.0}"
export VITE_HOST="${VITE_HOST:-0.0.0.0}"
export OPENWORK_WEB_HOST="${OPENWORK_WEB_HOST:-${HOST:-0.0.0.0}}"

# ---- Ports ----
export OPENWORK_PORT="${OPENWORK_PORT:-8789}"
export PORT="${PORT:-5173}"
export OPENWORK_WEB_PORT="${OPENWORK_WEB_PORT:-$PORT}"
export OPENWORK_PUBLIC_WEB_PORT="${OPENWORK_PUBLIC_WEB_PORT:-32765}"
export OPENWORK_WEB_HEALTH_TIMEOUT_SECONDS="${OPENWORK_WEB_HEALTH_TIMEOUT_SECONDS:-10}"
export OPENWORK_PUBLIC_WEB_HEALTH_TIMEOUT_SECONDS="${OPENWORK_PUBLIC_WEB_HEALTH_TIMEOUT_SECONDS:-10}"
export OPENWORK_SERVER_HEALTH_TIMEOUT_SECONDS="${OPENWORK_SERVER_HEALTH_TIMEOUT_SECONDS:-20}"
export OPENWORK_ONLYOFFICE_URL="${OPENWORK_ONLYOFFICE_URL:-http://${OPENWORK_POD_IP}:32764}"
export OPENWORK_ONLYOFFICE_INTERNAL_URL="${OPENWORK_ONLYOFFICE_INTERNAL_URL:-http://onlyoffice:80}"
export OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL="${OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL:-http://${OPENWORK_POD_IP}:32765/openwork}"
export OPENWORK_PROVIDER_ID="${OPENWORK_PROVIDER_ID:-my-company}"
export OPENWORK_MODEL_BASE_URL="${OPENWORK_MODEL_BASE_URL:-http://${OPENWORK_POD_IP}:3002/v1}"
export OPENWORK_DEFAULT_MODEL="${OPENWORK_DEFAULT_MODEL:-DeepSeek-V4}"
export OPENWORK_SMALL_MODEL="${OPENWORK_SMALL_MODEL:-$OPENWORK_DEFAULT_MODEL}"
export OPENWORK_GLOBAL_PERMISSION="${OPENWORK_GLOBAL_PERMISSION:-allow}"
export OPENWORK_USER_WORKSPACE_TEMPLATE_DIR="${OPENWORK_USER_WORKSPACE_TEMPLATE_DIR:-$PROJECT_DIR}"
export OPENWORK_WEB_DIST_DIR="${OPENWORK_WEB_DIST_DIR:-$PROJECT_DIR/packages/app/dist}"
export OPENWORK_SERVER_BIN="${OPENWORK_SERVER_BIN:-$PROJECT_DIR/packages/server/dist/bin/openwork-server}"
export OPENCODE_ROUTER_BIN="${OPENCODE_ROUTER_BIN:-$PROJECT_DIR/packages/opencode-router/dist/bin/opencode-router}"
export OPENWORK_ORCHESTRATOR_BIN="${OPENWORK_ORCHESTRATOR_BIN:-$PROJECT_DIR/packages/orchestrator/dist/bin/openwork}"
export OPENWORK_OPENCODE_ROUTER="${OPENWORK_OPENCODE_ROUTER:-1}"
export OPENWORK_WEB_BACKEND_URL="${OPENWORK_WEB_BACKEND_URL:-http://127.0.0.1:${OPENWORK_PORT}}"
export OPENWORK_RUNTIME_LOG_DIR="${OPENWORK_RUNTIME_LOG_DIR:-$PROJECT_DIR/tmp}"
export OPENWORK_ORCHESTRATOR_LOG="${OPENWORK_ORCHESTRATOR_LOG:-$OPENWORK_RUNTIME_LOG_DIR/manual-orchestrator.log}"
export OPENWORK_WEB_LOG="${OPENWORK_WEB_LOG:-$OPENWORK_RUNTIME_LOG_DIR/manual-web-${OPENWORK_WEB_PORT}.log}"
export OPENWORK_PUBLIC_WEB_LOG="${OPENWORK_PUBLIC_WEB_LOG:-$OPENWORK_RUNTIME_LOG_DIR/manual-web-${OPENWORK_PUBLIC_WEB_PORT}.log}"

mkdir -p "$OPENWORK_RUNTIME_LOG_DIR"

ensure_runtime_ready() {
    local required=(bun pnpm python3 lsof node curl)
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

ensure_python_skill_deps() {
    if ! command -v python3 &>/dev/null; then
        return 0
    fi
    if ! python3 -m pip --version &>/dev/null; then
        echo "[restart-pod] Warning: python3 is available but pip is missing."
        echo "[restart-pod] Run bash scripts/start-pod.sh to install python3-pip and the full Python skill toolchain."
        return 0
    fi

    local missing_raw
    missing_raw="$(detect_missing_python_skill_packages)"
    if [ -z "$missing_raw" ]; then
        echo "[restart-pod] Python skill packages already installed."
        return 0
    fi

    mapfile -t missing_packages <<<"$missing_raw"

    local pip_cmd=(python3 -m pip)
    local break_system_packages=()
    if "${pip_cmd[@]}" install --help 2>/dev/null | grep -q -- "--break-system-packages"; then
        break_system_packages+=(--break-system-packages)
    fi

    local index_url="${OPENWORK_PIP_INDEX_URL:-${PIP_INDEX_URL:-}}"
    local index_args=()
    if [ -n "$index_url" ]; then
        index_args+=(--index-url "$index_url")
    fi

    local common_args=(
        --disable-pip-version-check
        --progress-bar on
        --no-cache-dir
        --retries 5
        --timeout 60
        --prefer-binary
    )

    echo "[restart-pod] Installing missing Python skill packages: ${missing_packages[*]}"
    "${pip_cmd[@]}" install \
        "${break_system_packages[@]}" \
        "${common_args[@]}" \
        "${index_args[@]}" \
        "${missing_packages[@]}"
}

install_opencode() {
    if command -v opencode &>/dev/null; then
        echo "[restart-pod] opencode already installed: $(opencode --version 2>/dev/null || echo unknown)"
        return
    fi

    local install_url="${OPENWORK_OPENCODE_INSTALL_URL:-https://opencode.ai/install}"
    echo "[restart-pod] Installing opencode from $install_url ..."
    curl -fsSL "$install_url" | bash
    export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"

    if ! command -v opencode &>/dev/null; then
        echo "[restart-pod] ERROR: opencode install finished but command is still unavailable." >&2
        echo "[restart-pod] Check whether ~/.opencode/bin/opencode or ~/.local/bin/opencode exists and whether the install script succeeded." >&2
        exit 1
    fi

    echo "[restart-pod] opencode installed: $(opencode --version 2>/dev/null || echo unknown)"
}

ensure_runtime_ready
install_opencode
ensure_python_skill_deps

build_frontend() {
    echo "[restart-pod] Building web UI..."
    (
        cd "$PROJECT_DIR"
        VITE_OPENWORK_URL="/openwork" \
        VITE_SOLID_DEVTOOLS="0" \
        pnpm --filter @different-ai/openwork-ui build
    )
}

build_backend_binaries() {
    echo "[restart-pod] Building openwork-server binary..."
    (
        cd "$PROJECT_DIR"
        pnpm --filter openwork-server build:bin
    )

    if is_truthy "$OPENWORK_OPENCODE_ROUTER"; then
        echo "[restart-pod] Building opencode-router binary..."
        (
            cd "$PROJECT_DIR"
            pnpm --filter opencode-router build:bin
        )
    fi

    echo "[restart-pod] Building openwork orchestrator binary..."
    (
        cd "$PROJECT_DIR"
        pnpm --filter openwork-orchestrator build:bin
    )
}

ensure_build_outputs() {
    local required_files=(
        "$OPENWORK_WEB_DIST_DIR/index.html"
        "$OPENWORK_SERVER_BIN"
        "$OPENWORK_ORCHESTRATOR_BIN"
    )
    local file
    for file in "${required_files[@]}"; do
        if [ ! -f "$file" ]; then
            echo "[restart-pod] Missing build output: $file" >&2
            exit 1
        fi
    done

    if is_truthy "$OPENWORK_OPENCODE_ROUTER" && [ ! -f "$OPENCODE_ROUTER_BIN" ]; then
        echo "[restart-pod] Missing build output: $OPENCODE_ROUTER_BIN" >&2
        exit 1
    fi
}

wait_for_http_ok() {
    local url="$1"
    local seconds="${2:-15}"
    local deadline=$((SECONDS + seconds))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if curl -fsS "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
    done
    return 1
}

launch_detached_process() {
    local __pid_var="$1"
    local log_file="$2"
    shift 2

    mkdir -p "$(dirname "$log_file")"
    if command -v setsid >/dev/null 2>&1; then
        nohup setsid "$@" >"$log_file" 2>&1 </dev/null &
    else
        nohup "$@" >"$log_file" 2>&1 </dev/null &
    fi
    local pid=$!
    printf -v "$__pid_var" '%s' "$pid"
}

runtime_restart_api_url() {
    printf 'http://127.0.0.1:%s/admin/runtime/restart\n' "$OPENWORK_PORT"
}

read_json_field() {
    local field="$1"
    python3 - "$field" <<'PY'
import json
import sys

field = sys.argv[1]
try:
    payload = json.load(sys.stdin)
except Exception:
    print("")
    raise SystemExit(0)

value = payload.get(field)
if value is None:
    print("")
elif isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=False))
else:
    print(value)
PY
}

runtime_restart_request() {
    local method="$1"
    local body="${2:-}"
    local response_file
    response_file="$(mktemp)"
    local status="000"
    if [ "$method" = "GET" ]; then
        status="$(curl -sS -o "$response_file" -w '%{http_code}' \
            -H "X-OpenWork-Host-Token: $OPENWORK_HOST_TOKEN" \
            "$(runtime_restart_api_url)" || printf '000')"
    else
        status="$(curl -sS -o "$response_file" -w '%{http_code}' \
            -X "$method" \
            -H "Content-Type: application/json" \
            -H "X-OpenWork-Host-Token: $OPENWORK_HOST_TOKEN" \
            --data "$body" \
            "$(runtime_restart_api_url)" || printf '000')"
    fi

    RUNTIME_RESTART_LAST_STATUS="$status"
    if [ -f "$response_file" ]; then
        RUNTIME_RESTART_LAST_BODY="$(cat "$response_file")"
        rm -f "$response_file"
    else
        RUNTIME_RESTART_LAST_BODY=""
    fi
}

prepare_runtime_restart() {
    local mode="drain"
    local reason="restart-pod.sh safe restart"
    if [ -n "$FORCE_RESTART" ]; then
        mode="force"
        reason="restart-pod.sh force restart"
    fi

    if [ -n "$SKIP_RUNTIME_CONTROL_REQUESTED" ]; then
        echo "[restart-pod] Skipping runtime control negotiation; using legacy stop/start flow."
        RUNTIME_CONTROL_SUPPORTED="0"
        RUNTIME_CONTROL_CLEANUP_REQUIRED="0"
        return 0
    fi

    if ! wait_for_http_ok "http://127.0.0.1:${OPENWORK_PORT}/health" 2; then
        echo "[restart-pod] No running OpenWork server detected; skipping drain negotiation."
        RUNTIME_CONTROL_SUPPORTED="0"
        return 0
    fi

    local payload
    payload="$(python3 - "$mode" "$reason" <<'PY'
import json
import sys
print(json.dumps({"mode": sys.argv[1], "reason": sys.argv[2]}))
PY
)"
    runtime_restart_request POST "$payload"

    case "$RUNTIME_RESTART_LAST_STATUS" in
        200)
            RUNTIME_CONTROL_SUPPORTED="1"
            RUNTIME_CONTROL_CLEANUP_REQUIRED="1"
            local active_count
            active_count="$(printf '%s' "$RUNTIME_RESTART_LAST_BODY" | read_json_field activeSessionCount)"
            echo "[restart-pod] Runtime control accepted mode=${mode} active=${active_count:-unknown}."
            ;;
        404|405|501|000)
            echo "[restart-pod] Running server does not support restart drain control yet; falling back to legacy restart behavior."
            RUNTIME_CONTROL_SUPPORTED="0"
            ;;
        *)
            echo "[restart-pod] Runtime control request failed with status ${RUNTIME_RESTART_LAST_STATUS}." >&2
            if [ -n "${RUNTIME_RESTART_LAST_BODY:-}" ]; then
                echo "$RUNTIME_RESTART_LAST_BODY" >&2
            fi
            exit 1
            ;;
    esac
}

wait_for_runtime_drain() {
    if [ "${RUNTIME_CONTROL_SUPPORTED:-0}" != "1" ] || [ -n "$FORCE_RESTART" ]; then
        return 0
    fi

    local timeout="${OPENWORK_DRAIN_TIMEOUT_SECONDS:-$OPENWORK_DRAIN_TIMEOUT_SECONDS_DEFAULT}"
    local deadline=$((SECONDS + timeout))
    while [ "$SECONDS" -lt "$deadline" ]; do
        runtime_restart_request GET
        if [ "$RUNTIME_RESTART_LAST_STATUS" != "200" ]; then
            echo "[restart-pod] Failed to read runtime drain status (status ${RUNTIME_RESTART_LAST_STATUS})." >&2
            if [ -n "${RUNTIME_RESTART_LAST_BODY:-}" ]; then
                echo "$RUNTIME_RESTART_LAST_BODY" >&2
            fi
            exit 1
        fi

        local mode active_count
        mode="$(printf '%s' "$RUNTIME_RESTART_LAST_BODY" | read_json_field mode)"
        active_count="$(printf '%s' "$RUNTIME_RESTART_LAST_BODY" | read_json_field activeSessionCount)"
        active_count="${active_count:-0}"
        echo "[restart-pod] Drain status: mode=${mode:-unknown} active=${active_count}"
        if [ "$active_count" = "0" ]; then
            return 0
        fi
        sleep 2
    done

    echo "[restart-pod] Timed out waiting for active sessions to drain." >&2
    echo "[restart-pod] Re-run with --force to interrupt active sessions." >&2
    exit 1
}

resolve_managed_opencode_source() {
    local requested=""
    if [ -n "${OPENWORK_POD_OPENCODE_SOURCE:-}" ]; then
        requested="$OPENWORK_POD_OPENCODE_SOURCE"
    elif [ -n "${OPENWORK_OPENCODE_SOURCE:-}" ]; then
        requested="$OPENWORK_OPENCODE_SOURCE"
    elif [ -n "${OPENWORK_OPENCODE_BIN:-}" ] || command -v opencode >/dev/null 2>&1; then
        requested="external"
    else
        requested="downloaded"
    fi

    case "$requested" in
        auto|bundled|downloaded|external) ;;
        *)
            echo "[restart-pod] Invalid OpenCode source '$requested'. Expected auto, bundled, downloaded, or external." >&2
            exit 1
            ;;
    esac

    printf '%s\n' "$requested"
}

resolve_external_opencode_bin() {
    local candidate="${OPENWORK_OPENCODE_BIN:-}"
    local fallback=""

    if command -v opencode >/dev/null 2>&1; then
        fallback="$(command -v opencode 2>/dev/null || true)"
    fi

    if [ -n "$candidate" ]; then
        if [ ! -x "$candidate" ]; then
            echo "[restart-pod] OPENWORK_OPENCODE_BIN points to a non-executable path: $candidate" >&2
        elif "$candidate" --version >/dev/null 2>&1; then
            printf '%s\n' "$candidate"
            return 0
        else
            echo "[restart-pod] OPENWORK_OPENCODE_BIN is not healthy: $candidate" >&2
        fi

        if [ -n "$fallback" ] && [ "$fallback" != "$candidate" ] && "$fallback" --version >/dev/null 2>&1; then
            echo "[restart-pod] Falling back to opencode from PATH: $fallback" >&2
            printf '%s\n' "$fallback"
            return 0
        fi

        echo "[restart-pod] No healthy fallback opencode binary found after rejecting OPENWORK_OPENCODE_BIN." >&2
        exit 1
    fi

    candidate="$fallback"
    if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" --version >/dev/null 2>&1; then
        printf '%s\n' "$candidate"
        return 0
    fi

    echo "[restart-pod] OpenCode source resolved to external, but no usable opencode binary was found in OPENWORK_OPENCODE_BIN or PATH." >&2
    exit 1
}

prepare_opencode_launch_env() {
    local source="$1"
    case "$source" in
        external)
            OPENWORK_OPENCODE_BIN="$(resolve_external_opencode_bin)"
            export OPENWORK_OPENCODE_BIN
            echo "[restart-pod] Reusing pod OpenCode binary: $OPENWORK_OPENCODE_BIN ($(\"$OPENWORK_OPENCODE_BIN\" --version 2>/dev/null || echo unknown))"
            ;;
        bundled|downloaded)
            if [ -n "${OPENWORK_OPENCODE_BIN:-}" ]; then
                echo "[restart-pod] Unsetting OPENWORK_OPENCODE_BIN because OpenCode source is $source."
                unset OPENWORK_OPENCODE_BIN
            fi
            ;;
    esac
}

cleanup_runtime_control_on_exit() {
    local status="${1:-0}"
    if [ "${RUNTIME_CONTROL_CLEANUP_REQUIRED:-0}" != "1" ]; then
        return
    fi
    if [ "${RUNTIME_KILL_PHASE_STARTED:-0}" = "1" ]; then
        return
    fi
    if [ "${RUNTIME_CONTROL_SUPPORTED:-0}" != "1" ]; then
        return
    fi

    local payload
    payload="$(python3 - <<'PY'
import json
print(json.dumps({"mode": "clear", "reason": "restart-pod.sh aborted before shutdown"}))
PY
)"
    runtime_restart_request POST "$payload" || true
    if [ "$status" -ne 0 ]; then
        echo "[restart-pod] Cleared runtime maintenance after aborting restart." >&2
    fi
}

trap 'cleanup_runtime_control_on_exit $?' EXIT

if [ -z "$PULL_REQUESTED" ]; then
    PULL_REQUESTED="${OPENWORK_PULL_BEFORE_RESTART:-0}"
fi

prepare_runtime_restart

if [ "$PULL_REQUESTED" = "1" ]; then
    maybe_pull_latest
fi

sync_global_opencode_config
sync_opencode_config_files
if [ -n "$REUSE_BUILD_REQUESTED" ]; then
    echo "[restart-pod] Reusing existing build outputs (OPENWORK_REUSE_BUILD=1)."
else
    build_frontend
    build_backend_binaries
fi
ensure_build_outputs
wait_for_runtime_drain

# ============================================
# Kill old processes
# ============================================
RUNTIME_KILL_PHASE_STARTED="1"
echo "[restart-pod] Killing old processes..."

BOCHA_MCP_DIR_RESOLVED="${BOCHA_MCP_DIR:-$HOME/.config/openwork/bocha-search-mcp}"
BOCHA_MCP_DIR_PATTERN="$(printf '%s' "$BOCHA_MCP_DIR_RESOLVED" | sed 's/[][(){}.^$+?*|\\/]/\\&/g')"
BOCHA_UV_PATTERN="uv --directory ${BOCHA_MCP_DIR_PATTERN} run bocha-search-mcp"
BOCHA_PYTHON_PATTERN="${BOCHA_MCP_DIR_PATTERN}/\\.venv/bin/python .*bocha-search-mcp"
OPENCODE_SERVE_PATTERN="opencode serve --hostname"
OPENCODE_TUI_PATTERN="opencode -s "
GIT_SNAPSHOT_ADD_PATTERN="git --git-dir .*/snapshot/global --work-tree .* add \\."

log_leak_counts \
    "before cleanup" \
    "$(count_pattern_matches "$OPENCODE_SERVE_PATTERN")" \
    "$(count_pattern_matches "$OPENCODE_TUI_PATTERN")" \
    "$(count_pattern_matches "$BOCHA_UV_PATTERN")" \
    "$(count_pattern_matches "$BOCHA_PYTHON_PATTERN")" \
    "$(count_pattern_matches "$GIT_SNAPSHOT_ADD_PATTERN")"

# Kill known process signatures first (more reliable than port-only cleanup).
kill_by_pattern "dev-headless-web wrapper" "bun scripts/dev-headless-web.ts"
kill_by_pattern "openwork orchestrator for this workspace" "openwork-orchestrator.*start.*--workspace[ =]$PROJECT_DIR"
kill_by_pattern "compiled openwork orchestrator" "$PROJECT_DIR/packages/orchestrator/dist/bin/openwork"
kill_by_pattern "openwork server cli for this workspace" "$PROJECT_DIR/packages/server/src/cli.ts"
kill_by_pattern "compiled openwork server" "$PROJECT_DIR/packages/server/dist/bin/openwork-server"
kill_by_pattern "vite dev server for openwork-ui" "openwork-ui.*vite|vite/bin/vite.js.*--port 5173"
kill_by_pattern "prod web server" "node .*scripts/serve-web-prod.mjs"
kill_by_pattern "compiled opencode-router" "$PROJECT_DIR/packages/opencode-router/dist/bin/opencode-router"
kill_by_pattern "orchestrator opencode sidecar" "/openwork-orchestrator/sidecars/opencode/.*/opencode serve"
# Failed recoveries can leave detached opencode serves behind. Clear them before
# restarting so stale daemons do not pollute later health checks.
kill_by_pattern "generic opencode serve" "$OPENCODE_SERVE_PATTERN"
kill_by_pattern "interactive opencode tui" "$OPENCODE_TUI_PATTERN"
kill_by_pattern "bocha-search-mcp uv launcher" "$BOCHA_UV_PATTERN"
kill_by_pattern "bocha-search-mcp python worker" "$BOCHA_PYTHON_PATTERN"
kill_by_pattern "opencode snapshot git add" "$GIT_SNAPSHOT_ADD_PATTERN"

# Port-level fallback cleanup.
for p in "$OPENWORK_PORT" "$PORT" "$OPENWORK_WEB_PORT" "$OPENWORK_PUBLIC_WEB_PORT" 8789 5173 32765; do
    kill_by_port "$p"
done

ensure_pattern_drained "generic opencode serve" "$OPENCODE_SERVE_PATTERN"
ensure_pattern_drained "interactive opencode tui" "$OPENCODE_TUI_PATTERN"
ensure_pattern_drained "bocha-search-mcp uv launcher" "$BOCHA_UV_PATTERN"
ensure_pattern_drained "bocha-search-mcp python worker" "$BOCHA_PYTHON_PATTERN"
ensure_pattern_drained "opencode snapshot git add" "$GIT_SNAPSHOT_ADD_PATTERN"

for p in "$OPENWORK_PORT" "$PORT" "$OPENWORK_WEB_PORT" "$OPENWORK_PUBLIC_WEB_PORT" 8789 5173 32765; do
    ensure_port_free "$p"
done

log_leak_counts \
    "after cleanup" \
    "$(count_pattern_matches "$OPENCODE_SERVE_PATTERN")" \
    "$(count_pattern_matches "$OPENCODE_TUI_PATTERN")" \
    "$(count_pattern_matches "$BOCHA_UV_PATTERN")" \
    "$(count_pattern_matches "$BOCHA_PYTHON_PATTERN")" \
    "$(count_pattern_matches "$GIT_SNAPSHOT_ADD_PATTERN")"

sleep 1

# ---- Clean up inbox violations ----
if [ -x "$PROJECT_DIR/scripts/inbox-guard.sh" ]; then
    echo "[restart-pod] Running inbox guard (cleanup)..."
    "$PROJECT_DIR/scripts/inbox-guard.sh" --clean || true
fi

echo "[restart-pod] Starting OpenWork (POD_IP=$OPENWORK_POD_IP)..."
cd "$PROJECT_DIR"

WEB_PID=""
PUBLIC_WEB_PID=""
ORCHESTRATOR_PID=""

cleanup_children() {
    local status="${1:-0}"
    trap - EXIT INT TERM
    if [ -n "$ORCHESTRATOR_PID" ] && kill -0 "$ORCHESTRATOR_PID" 2>/dev/null; then
        kill_pids_gracefully "OpenWork orchestrator" "$ORCHESTRATOR_PID"
    fi
    if [ -n "$WEB_PID" ] && kill -0 "$WEB_PID" 2>/dev/null; then
        kill_pids_gracefully "prod web server" "$WEB_PID"
    fi
    if [ -n "$PUBLIC_WEB_PID" ] && kill -0 "$PUBLIC_WEB_PID" 2>/dev/null; then
        kill_pids_gracefully "public web server" "$PUBLIC_WEB_PID"
    fi
    exit "$status"
}

trap 'cleanup_children $?' EXIT
trap 'cleanup_children 0' INT TERM

echo "[restart-pod] Starting production web server on ${OPENWORK_WEB_HOST}:${OPENWORK_WEB_PORT}..."
launch_detached_process \
    WEB_PID \
    "$OPENWORK_WEB_LOG" \
    env \
    OPENWORK_PORT="${OPENWORK_PORT}" \
    OPENWORK_WEB_PORT="${OPENWORK_WEB_PORT}" \
    OPENWORK_WEB_HOST="${OPENWORK_WEB_HOST}" \
    OPENWORK_WEB_BACKEND_URL="${OPENWORK_WEB_BACKEND_URL}" \
    node "$SCRIPT_DIR/serve-web-prod.mjs"
echo "[restart-pod] Production web server logs: $OPENWORK_WEB_LOG"
sleep 1
if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "[restart-pod] Production web server failed to start." >&2
    wait "$WEB_PID"
    exit 1
fi

if ! wait_for_http_ok "http://127.0.0.1:${OPENWORK_WEB_PORT}/healthz" "$OPENWORK_WEB_HEALTH_TIMEOUT_SECONDS"; then
    echo "[restart-pod] Production web server health check failed." >&2
    exit 1
fi

if [ "$OPENWORK_PUBLIC_WEB_PORT" != "$OPENWORK_WEB_PORT" ]; then
    echo "[restart-pod] Starting public web server on ${OPENWORK_WEB_HOST}:${OPENWORK_PUBLIC_WEB_PORT}..."
    launch_detached_process \
        PUBLIC_WEB_PID \
        "$OPENWORK_PUBLIC_WEB_LOG" \
        env \
        OPENWORK_PORT="${OPENWORK_PORT}" \
        OPENWORK_WEB_PORT="${OPENWORK_PUBLIC_WEB_PORT}" \
        OPENWORK_WEB_HOST="${OPENWORK_WEB_HOST}" \
        OPENWORK_WEB_BACKEND_URL="${OPENWORK_WEB_BACKEND_URL}" \
        node "$SCRIPT_DIR/serve-web-prod.mjs"
    echo "[restart-pod] Public web server logs: $OPENWORK_PUBLIC_WEB_LOG"
    sleep 1
    if ! kill -0 "$PUBLIC_WEB_PID" 2>/dev/null; then
        echo "[restart-pod] Public web server failed to start." >&2
        wait "$PUBLIC_WEB_PID"
        exit 1
    fi

    if ! wait_for_http_ok "http://127.0.0.1:${OPENWORK_PUBLIC_WEB_PORT}/healthz" "$OPENWORK_PUBLIC_WEB_HEALTH_TIMEOUT_SECONDS"; then
        echo "[restart-pod] Public web server health check failed." >&2
        exit 1
    fi
fi

OPENCODE_SOURCE_MODE="$(resolve_managed_opencode_source)"
prepare_opencode_launch_env "$OPENCODE_SOURCE_MODE"

orchestrator_args=(
    serve
    --workspace "$PROJECT_DIR"
    --approval auto
    --allow-external
    --no-opencode-auth
    --sidecar-source auto
    --opencode-source "$OPENCODE_SOURCE_MODE"
    --openwork-host "$OPENWORK_HOST"
    --openwork-port "$OPENWORK_PORT"
    --openwork-token "$OPENWORK_TOKEN"
    --openwork-host-token "$OPENWORK_HOST_TOKEN"
    --openwork-server-bin "$OPENWORK_SERVER_BIN"
)

if [ "$OPENCODE_SOURCE_MODE" = "external" ] && [ -n "${OPENWORK_OPENCODE_BIN:-}" ]; then
    orchestrator_args+=(--opencode-bin "$OPENWORK_OPENCODE_BIN")
fi

if is_truthy "$OPENWORK_OPENCODE_ROUTER"; then
    orchestrator_args+=(--opencode-router-bin "$OPENCODE_ROUTER_BIN")
    if is_truthy "${OPENWORK_OPENCODE_ROUTER_REQUIRED:-0}"; then
        orchestrator_args+=(--opencode-router-required)
    fi
else
    orchestrator_args+=(--no-opencode-router)
fi

echo "[restart-pod] Starting compiled OpenWork orchestrator..."
launch_detached_process \
    ORCHESTRATOR_PID \
    "$OPENWORK_ORCHESTRATOR_LOG" \
    env \
    BOCHA_API_KEY="${BOCHA_API_KEY:-}" \
    BOCHA_MCP_DIR="${BOCHA_MCP_DIR:-}" \
    "$OPENWORK_ORCHESTRATOR_BIN" "${orchestrator_args[@]}"
echo "[restart-pod] OpenWork orchestrator logs: $OPENWORK_ORCHESTRATOR_LOG"
sleep 1
if ! kill -0 "$ORCHESTRATOR_PID" 2>/dev/null; then
    echo "[restart-pod] OpenWork orchestrator failed to start." >&2
    wait "$ORCHESTRATOR_PID"
    exit 1
fi

if ! wait_for_http_ok "http://127.0.0.1:${OPENWORK_PORT}/health" "$OPENWORK_SERVER_HEALTH_TIMEOUT_SECONDS"; then
    echo "[restart-pod] OpenWork health check failed." >&2
    exit 1
fi

if [ "$OPENWORK_PUBLIC_WEB_PORT" != "$OPENWORK_WEB_PORT" ]; then
    echo "[restart-pod] Deployment is up. Web: http://${OPENWORK_POD_IP}:${OPENWORK_PUBLIC_WEB_PORT}  Internal Web: http://127.0.0.1:${OPENWORK_WEB_PORT}  OpenWork: http://127.0.0.1:${OPENWORK_PORT}"
else
    echo "[restart-pod] Deployment is up. Web: http://${OPENWORK_POD_IP}:${OPENWORK_WEB_PORT}  OpenWork: http://127.0.0.1:${OPENWORK_PORT}"
fi

# Services are launched under setsid+nohup when available so they do not remain
# tied to the current SSH/session process group. Once the health checks pass we
# should leave them detached; the orchestrator launcher may exit after handing
# off to the actual sidecars, and treating that as a failure would tear down an
# otherwise healthy deployment.
trap - EXIT INT TERM
WEB_PID=""
PUBLIC_WEB_PID=""
ORCHESTRATOR_PID=""
exit 0
