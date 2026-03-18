#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ENV_DIR="${OPENWORK_RUNTIME_ENV_DIR:-$HOME/.config/openwork}"

export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"

load_env_file() {
    local file="$1"
    if [ -f "$file" ]; then
        echo "[recover-pod] Loading env file: $file"
        set -a
        # shellcheck disable=SC1090
        . "$file"
        set +a
    fi
}

wait_for_http_ok() {
    local url="$1"
    local timeout_seconds="${2:-20}"
    local deadline=$((SECONDS + timeout_seconds))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if curl -fsS "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

wait_for_opencode() {
    local timeout_seconds="${1:-20}"
    local deadline=$((SECONDS + timeout_seconds))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if curl -fsS "http://127.0.0.1:${OPENWORK_OPENCODE_PORT}/global/health" >/dev/null 2>&1; then
            return 0
        fi
        if curl -fsS "http://127.0.0.1:${OPENWORK_OPENCODE_PORT}/health" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

kill_port() {
    local port="$1"
    local pids=""
    pids="$(lsof -ti :"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
        echo "[recover-pod] Killing listeners on port $port: $pids"
        # shellcheck disable=SC2086
        kill -TERM $pids 2>/dev/null || true
        sleep 1
        pids="$(lsof -ti :"$port" 2>/dev/null || true)"
        if [ -n "$pids" ]; then
            # shellcheck disable=SC2086
            kill -KILL $pids 2>/dev/null || true
        fi
    fi
}

ensure_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
        printf '%s\n' "pnpm"
        return 0
    fi
    if command -v corepack >/dev/null 2>&1; then
        printf '%s\n' "corepack pnpm"
        return 0
    fi
    echo "[recover-pod] pnpm/corepack not found." >&2
    exit 1
}

ensure_file() {
    local path="$1"
    local build_cmd="$2"
    if [ -e "$path" ]; then
        return 0
    fi
    echo "[recover-pod] Missing $path, building..."
    eval "$build_cmd"
}

load_env_file "$RUNTIME_ENV_DIR/pod.env"
load_env_file "$RUNTIME_ENV_DIR/generated-secrets.env"
load_env_file "$RUNTIME_ENV_DIR/secrets.env"
load_env_file "$PROJECT_DIR/.env.pod.local"

export OPENWORK_PORT="${OPENWORK_PORT:-8789}"
export OPENWORK_WEB_PORT="${OPENWORK_WEB_PORT:-32765}"
export OPENWORK_LEGACY_WEB_PORT="${OPENWORK_LEGACY_WEB_PORT:-${PORT:-5173}}"
export OPENWORK_WEB_HOST="${OPENWORK_WEB_HOST:-0.0.0.0}"
export OPENWORK_WEB_BACKEND_URL="${OPENWORK_WEB_BACKEND_URL:-http://127.0.0.1:${OPENWORK_PORT}}"
export OPENWORK_OPENCODE_PORT="${OPENWORK_OPENCODE_PORT:-4096}"
export OPENWORK_OPENCODE_HOST="${OPENWORK_OPENCODE_HOST:-127.0.0.1}"
export OPENWORK_HOST="${OPENWORK_HOST:-0.0.0.0}"

mkdir -p "$PROJECT_DIR/tmp"

PNPM_CMD="$(ensure_pnpm)"

cd "$PROJECT_DIR"

ensure_file "packages/app/dist/index.html" "$PNPM_CMD --filter @different-ai/openwork-ui build"
ensure_file "packages/server/dist/bin/openwork-server" "$PNPM_CMD --filter openwork-server build:bin"

kill_port "$OPENWORK_WEB_PORT"
kill_port "$OPENWORK_PORT"
kill_port "$OPENWORK_OPENCODE_PORT"
if [ "$OPENWORK_LEGACY_WEB_PORT" != "$OPENWORK_WEB_PORT" ]; then
    kill_port "$OPENWORK_LEGACY_WEB_PORT"
fi

pkill -f 'serve-web-prod.mjs' 2>/dev/null || true
pkill -f 'packages/orchestrator/dist/bin/openwork' 2>/dev/null || true
pkill -f 'packages/server/dist/bin/openwork-server' 2>/dev/null || true
pkill -f 'opencode serve' 2>/dev/null || true

OPENCODE_BIN="${OPENWORK_OPENCODE_BIN:-$(command -v opencode 2>/dev/null || true)}"
if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
    echo "[recover-pod] opencode binary not found." >&2
    exit 1
fi

echo "[recover-pod] Starting OpenCode on ${OPENWORK_OPENCODE_HOST}:${OPENWORK_OPENCODE_PORT}..."
nohup env -u OPENCODE_SERVER_USERNAME -u OPENCODE_SERVER_PASSWORD -u OPENWORK_OPENCODE_USERNAME -u OPENWORK_OPENCODE_PASSWORD \
    "$OPENCODE_BIN" serve --hostname "$OPENWORK_OPENCODE_HOST" --port "$OPENWORK_OPENCODE_PORT" --cors '*' \
    > "$PROJECT_DIR/tmp/opencode-manual.log" 2>&1 &

if ! wait_for_opencode 20; then
    echo "[recover-pod] OpenCode failed to become healthy." >&2
    tail -n 80 "$PROJECT_DIR/tmp/opencode-manual.log" >&2 || true
    exit 1
fi

echo "[recover-pod] Starting OpenWork server on ${OPENWORK_HOST}:${OPENWORK_PORT}..."
openwork_args=(
    --host "$OPENWORK_HOST"
    --port "$OPENWORK_PORT"
    --approval auto
    --workspace "$PROJECT_DIR"
    --opencode-base-url "http://${OPENWORK_OPENCODE_HOST}:${OPENWORK_OPENCODE_PORT}"
    --opencode-directory "$PROJECT_DIR"
    --cors '*'
)
if [ -n "${OPENWORK_TOKEN:-}" ]; then
    openwork_args+=(--token "$OPENWORK_TOKEN")
fi
if [ -n "${OPENWORK_HOST_TOKEN:-}" ]; then
    openwork_args+=(--host-token "$OPENWORK_HOST_TOKEN")
fi

nohup env -u OPENWORK_OPENCODE_USERNAME -u OPENWORK_OPENCODE_PASSWORD \
    OPENWORK_SERVER_CONFIG=/tmp/openwork-recovery-server.json \
    "$PROJECT_DIR/packages/server/dist/bin/openwork-server" \
    "${openwork_args[@]}" \
    > "$PROJECT_DIR/tmp/openwork-server-manual.log" 2>&1 &

if ! wait_for_http_ok "http://127.0.0.1:${OPENWORK_PORT}/health" 20; then
    echo "[recover-pod] OpenWork server failed to become healthy." >&2
    tail -n 80 "$PROJECT_DIR/tmp/openwork-server-manual.log" >&2 || true
    exit 1
fi

echo "[recover-pod] Starting production web server on ${OPENWORK_WEB_HOST}:${OPENWORK_WEB_PORT}..."
nohup env OPENWORK_PORT="${OPENWORK_PORT}" OPENWORK_WEB_PORT="${OPENWORK_WEB_PORT}" OPENWORK_WEB_HOST="${OPENWORK_WEB_HOST}" OPENWORK_WEB_BACKEND_URL="${OPENWORK_WEB_BACKEND_URL}" \
    node "$PROJECT_DIR/scripts/serve-web-prod.mjs" \
    > "$PROJECT_DIR/tmp/prod-web-manual.log" 2>&1 &

if ! wait_for_http_ok "http://127.0.0.1:${OPENWORK_WEB_PORT}/healthz" 20; then
    echo "[recover-pod] Web server failed to become healthy." >&2
    tail -n 80 "$PROJECT_DIR/tmp/prod-web-manual.log" >&2 || true
    exit 1
fi

if [ "$OPENWORK_LEGACY_WEB_PORT" != "$OPENWORK_WEB_PORT" ]; then
    echo "[recover-pod] Starting legacy web listener on ${OPENWORK_WEB_HOST}:${OPENWORK_LEGACY_WEB_PORT}..."
    nohup env OPENWORK_PORT="${OPENWORK_PORT}" OPENWORK_WEB_PORT="${OPENWORK_LEGACY_WEB_PORT}" OPENWORK_WEB_HOST="${OPENWORK_WEB_HOST}" OPENWORK_WEB_BACKEND_URL="${OPENWORK_WEB_BACKEND_URL}" \
        node "$PROJECT_DIR/scripts/serve-web-prod.mjs" \
        > "$PROJECT_DIR/tmp/prod-web-legacy.log" 2>&1 &

    if ! wait_for_http_ok "http://127.0.0.1:${OPENWORK_LEGACY_WEB_PORT}/healthz" 20; then
        echo "[recover-pod] Legacy web listener failed to become healthy." >&2
        tail -n 80 "$PROJECT_DIR/tmp/prod-web-legacy.log" >&2 || true
        exit 1
    fi
fi

echo "[recover-pod] Emergency recovery stack is up."
echo "[recover-pod] Web: http://${OPENWORK_POD_IP:-127.0.0.1}:${OPENWORK_WEB_PORT}"
echo "[recover-pod] API: http://127.0.0.1:${OPENWORK_PORT}/health"
echo "[recover-pod] Logs:"
echo "  tail -f $PROJECT_DIR/tmp/opencode-manual.log"
echo "  tail -f $PROJECT_DIR/tmp/openwork-server-manual.log"
echo "  tail -f $PROJECT_DIR/tmp/prod-web-manual.log"
if [ "$OPENWORK_LEGACY_WEB_PORT" != "$OPENWORK_WEB_PORT" ]; then
    echo "  tail -f $PROJECT_DIR/tmp/prod-web-legacy.log"
fi
