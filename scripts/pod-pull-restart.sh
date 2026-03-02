#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ENV_DIR_DEFAULT="$HOME/.config/openwork"

cd "$PROJECT_DIR"

load_runtime_env() {
    local env_dir="${OPENWORK_RUNTIME_ENV_DIR:-$RUNTIME_ENV_DIR_DEFAULT}"
    local env_files=(
        "$env_dir/pod.env"
        "$env_dir/secrets.env"
        "$PROJECT_DIR/.env.pod.local"
    )

    for env_file in "${env_files[@]}"; do
        if [ -f "$env_file" ]; then
            echo "[pod-pull-restart] Loading env file: $env_file"
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
        "scripts/pod-pull-restart.sh"
        "scripts/restart-pod.sh"
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

    echo "[pod-pull-restart] Auto-restored local changes in common pod scripts to avoid pull conflicts."
    echo "[pod-pull-restart] Controlled by OPENWORK_AUTO_RESTORE_POD_LOCAL_CHANGES=1 (default)."
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

load_runtime_env
auto_restore_common_pod_local_changes

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "[pod-pull-restart] Working tree has local changes. Aborting to avoid conflicts."
    git status --short
    exit 1
fi

before_rev="$(git rev-parse HEAD)"
echo "[pod-pull-restart] Pulling latest code..."
if ! git_pull_ff_only; then
    echo "[pod-pull-restart] git pull failed."
    echo "[pod-pull-restart] If this is a non-interactive run, set OPENWORK_GIT_USERNAME and OPENWORK_GIT_TOKEN in ~/.config/openwork/secrets.env"
    exit 1
fi
after_rev="$(git rev-parse HEAD)"

if [ "$before_rev" != "$after_rev" ]; then
    echo "[pod-pull-restart] Code updated: $before_rev -> $after_rev"
    echo "[pod-pull-restart] Syncing dependencies..."
    if ! pnpm install --frozen-lockfile; then
        echo "[pod-pull-restart] Frozen lockfile install failed, retrying normal install..."
        pnpm install
    fi
else
    echo "[pod-pull-restart] No code changes pulled."
fi

OPENWORK_PULL_BEFORE_RESTART=0 exec "$SCRIPT_DIR/restart-pod.sh"
