#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/open-hosted-session.sh <session_id>

Locate a hosted OpenWork session runtime from the persisted session-workspaces
mapping, switch into that runtime's OpenCode config/data directories, and then
resume the session with:

  opencode -s <session_id>

Optional env:
  OPENWORK_SESSION_WORKSPACES_DIR
    Override the mapping directory.
    Default: $HOME/.openwork/openwork-server/session-workspaces
EOF
}

die() {
  echo "[open-hosted-session] $*" >&2
  exit 1
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

SESSION_ID="${1:-}"
[[ -n "$SESSION_ID" ]] || {
  usage >&2
  exit 1
}

MAPPING_DIR="${OPENWORK_SESSION_WORKSPACES_DIR:-$HOME/.openwork/openwork-server/session-workspaces}"
[[ -d "$MAPPING_DIR" ]] || die "mapping directory not found: $MAPPING_DIR"

command -v opencode >/dev/null 2>&1 || die "opencode command not found in PATH"
command -v jq >/dev/null 2>&1 || die "jq command not found in PATH"

RUNTIME_DIR=""
while IFS= read -r mapping_file; do
  candidate="$(
    jq -r --arg sid "$SESSION_ID" '
      .workspaces[$sid].runtimeDir // .[$sid].runtimeDir // empty
    ' "$mapping_file" 2>/dev/null || true
  )"
  if [[ -n "$candidate" ]]; then
    RUNTIME_DIR="$candidate"
    break
  fi
done < <(find "$MAPPING_DIR" -maxdepth 1 -type f -name '*.json' | sort)

[[ -n "$RUNTIME_DIR" ]] || die "session not found: $SESSION_ID"
[[ -d "$RUNTIME_DIR" ]] || die "runtime directory does not exist: $RUNTIME_DIR"

export OPENCODE_CONFIG_DIR="$RUNTIME_DIR/.openwork-runtime/opencode/config"
export XDG_CONFIG_HOME="$RUNTIME_DIR/.openwork-runtime/opencode/config-home"
export XDG_DATA_HOME="$RUNTIME_DIR/.openwork-runtime/opencode/data"
export XDG_STATE_HOME="$RUNTIME_DIR/.openwork-runtime/opencode/state"
export XDG_CACHE_HOME="$RUNTIME_DIR/.openwork-runtime/opencode/cache"
export TMPDIR="$RUNTIME_DIR/.tmp/system"
export TMP="$RUNTIME_DIR/.tmp/system"
export TEMP="$RUNTIME_DIR/.tmp/system"

cd "$RUNTIME_DIR"

echo "[open-hosted-session] sessionId=$SESSION_ID"
echo "[open-hosted-session] runtimeDir=$RUNTIME_DIR"

exec opencode -s "$SESSION_ID"
