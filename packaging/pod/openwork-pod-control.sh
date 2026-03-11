#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Static pod deployment config (edit once, no env vars required)
# -----------------------------------------------------------------------------
REPO_DIR="/srv/openwork"
WORKSPACE_DIR="/srv/openwork-workspace"
RUNTIME_DIR="/srv/openwork-runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"

GIT_REMOTE="https://github.com/different-ai/openwork.git"
GIT_REF="dev"

OPENWORK_HOST="0.0.0.0"
OPENWORK_PORT="8789"
WEB_HOST="0.0.0.0"
WEB_PORT="5173"

OPENWORK_TOKEN="replace-with-openwork-token"
OPENWORK_HOST_TOKEN="replace-with-openwork-host-token"

PROVIDER_ID="my-company"
MODEL_ID="Kimi-K2.5"
MODEL_ALIAS="$PROVIDER_ID/$MODEL_ID"
MODEL_BASE_URL="http://192.168.5.10:3002/v1"
MODEL_API_KEY="replace-with-api-key"

ORCH_PID_FILE="$PID_DIR/openwork-orchestrator.pid"
WEB_PID_FILE="$PID_DIR/openwork-web.pid"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing command: $cmd" >&2
    exit 1
  fi
}

ensure_dirs() {
  mkdir -p "$WORKSPACE_DIR" "$LOG_DIR" "$PID_DIR"
}

write_global_opencode_config() {
  local cfg_dir="$HOME/.config/opencode"
  local cfg_path="$cfg_dir/opencode.json"
  mkdir -p "$cfg_dir"

  cat > "$cfg_path" <<JSON
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "$PROVIDER_ID": {
      "options": {
        "baseURL": "$MODEL_BASE_URL",
        "apiKey": "$MODEL_API_KEY"
      },
      "models": {
        "$MODEL_ID": {
          "name": "$MODEL_ID",
          "attachment": true,
          "tool_call": true,
          "interleaved": true,
          "modalities": {
            "input": ["text", "image", "audio", "video", "pdf"],
            "output": ["text"]
          }
        }
      }
    }
  },
  "model": "$MODEL_ALIAS"
}
JSON

  echo "Wrote $cfg_path"
}

clone_or_update_repo() {
  require_cmd git
  if [ ! -d "$REPO_DIR/.git" ]; then
    git clone "$GIT_REMOTE" "$REPO_DIR"
  fi

  cd "$REPO_DIR"
  git fetch --all --prune
  git checkout "$GIT_REF"
  git pull --ff-only origin "$GIT_REF"
}

install_deps() {
  require_cmd node
  require_cmd pnpm
  require_cmd bun
  cd "$REPO_DIR"
  pnpm install --frozen-lockfile
}

bootstrap() {
  ensure_dirs
  clone_or_update_repo
  install_deps
  write_global_opencode_config

  echo
  echo "Bootstrap complete"
  echo "- repo: $REPO_DIR"
  echo "- workspace: $WORKSPACE_DIR"
  echo "- model: $MODEL_ALIAS"
}

is_pid_running() {
  local pid_file="$1"
  if [ ! -f "$pid_file" ]; then
    return 1
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [ -z "$pid" ]; then
    return 1
  fi
  kill -0 "$pid" >/dev/null 2>&1
}

start_orchestrator() {
  if is_pid_running "$ORCH_PID_FILE"; then
    echo "openwork-orchestrator already running (pid $(cat "$ORCH_PID_FILE"))"
    return
  fi

  cd "$REPO_DIR"
  nohup pnpm --filter openwork-orchestrator dev -- start \
    --workspace "$WORKSPACE_DIR" \
    --approval auto \
    --allow-external \
    --no-opencode-auth \
    --opencode-router true \
    --openwork-host "$OPENWORK_HOST" \
    --openwork-port "$OPENWORK_PORT" \
    --openwork-token "$OPENWORK_TOKEN" \
    --openwork-host-token "$OPENWORK_HOST_TOKEN" \
    > "$LOG_DIR/openwork-orchestrator.log" 2>&1 &

  echo $! > "$ORCH_PID_FILE"
  echo "Started openwork-orchestrator (pid $(cat "$ORCH_PID_FILE"))"
}

start_web() {
  if is_pid_running "$WEB_PID_FILE"; then
    echo "web already running (pid $(cat "$WEB_PID_FILE"))"
    return
  fi

  cd "$REPO_DIR"
  nohup pnpm --filter @different-ai/openwork-ui dev -- --host "$WEB_HOST" --port "$WEB_PORT" \
    > "$LOG_DIR/openwork-web.log" 2>&1 &

  echo $! > "$WEB_PID_FILE"
  echo "Started web (pid $(cat "$WEB_PID_FILE"))"
}

start_all() {
  ensure_dirs
  start_orchestrator
  start_web

  echo
  echo "Endpoints"
  echo "- OpenWork API/UI proxy: http://<pod-ip>:$OPENWORK_PORT"
  echo "- Web UI (Vite): http://<pod-ip>:$WEB_PORT"
  echo "- OpenWork token: $OPENWORK_TOKEN"
  echo "- OpenWork host token: $OPENWORK_HOST_TOKEN"
}

stop_pid_file() {
  local pid_file="$1"
  local name="$2"

  if ! is_pid_running "$pid_file"; then
    rm -f "$pid_file"
    echo "$name not running"
    return
  fi

  local pid
  pid="$(cat "$pid_file")"
  kill "$pid" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$pid_file"
  echo "Stopped $name"
}

stop_all() {
  stop_pid_file "$WEB_PID_FILE" "web"
  stop_pid_file "$ORCH_PID_FILE" "openwork-orchestrator"
}

status_all() {
  if is_pid_running "$ORCH_PID_FILE"; then
    echo "openwork-orchestrator: running (pid $(cat "$ORCH_PID_FILE"))"
  else
    echo "openwork-orchestrator: stopped"
  fi

  if is_pid_running "$WEB_PID_FILE"; then
    echo "web: running (pid $(cat "$WEB_PID_FILE"))"
  else
    echo "web: stopped"
  fi

  echo "logs: $LOG_DIR"
}

usage() {
  cat <<USAGE
Usage: $(basename "$0") <bootstrap|start|stop|restart|status>

Commands:
  bootstrap  Clone/update repo, install deps, write OpenCode configs
  start      Start openwork-orchestrator and web UI
  stop       Stop openwork-orchestrator and web UI
  restart    Stop then start
  status     Show process status
USAGE
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    bootstrap)
      bootstrap
      ;;
    start)
      start_all
      ;;
    stop)
      stop_all
      ;;
    restart)
      stop_all
      start_all
      ;;
    status)
      status_all
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
