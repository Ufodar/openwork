#!/bin/bash
set -euo pipefail
# ============================================
# OpenWork Pod Startup Script
# Deploy to a new pod: only change OPENWORK_POD_IP
# ============================================

# ---- Pod IP (change this when deploying to a new pod) ----
export OPENWORK_POD_IP="${OPENWORK_POD_IP:-192.168.5.10}"

# ---- Network ----
export OPENWORK_NETWORK_MODE="${OPENWORK_NETWORK_MODE:-pod}"
export OPENWORK_HOST="${OPENWORK_HOST:-0.0.0.0}"
export VITE_HOST="${VITE_HOST:-0.0.0.0}"

# ---- Ports (usually no need to change) ----
export OPENWORK_PORT="${OPENWORK_PORT:-8789}"
export PORT="${PORT:-5173}"
export OPENWORK_ONLYOFFICE_URL="${OPENWORK_ONLYOFFICE_URL:-http://${OPENWORK_POD_IP}:32764}"
export OPENWORK_ONLYOFFICE_INTERNAL_URL="${OPENWORK_ONLYOFFICE_INTERNAL_URL:-http://onlyoffice:80}"
export OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL="${OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL:-http://${OPENWORK_POD_IP}:32765/openwork}"

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
            echo "[start-pod] Loading env file: $env_file"
            set -a
            # shellcheck disable=SC1090
            . "$env_file"
            set +a
        fi
    done
}

sync_global_opencode_config() {
    local sync_script="$SCRIPT_DIR/sync-global-opencode-config.py"
    if [ ! -f "$sync_script" ]; then
        echo "[start-pod] Missing sync helper: $sync_script" >&2
        exit 1
    fi

    echo "[start-pod] Syncing global OpenCode config from runtime env..."
    python3 "$sync_script"
}

sync_opencode_config_files() {
    local json_path="$PROJECT_DIR/opencode.json"
    local jsonc_path="$PROJECT_DIR/opencode.jsonc"

    # Keep opencode.jsonc as the editable project source of truth and mirror a
    # plain JSON copy for tooling paths that still expect opencode.json.
    if [ -f "$jsonc_path" ] && [ ! -f "$json_path" ]; then
        cp "$jsonc_path" "$json_path"
        echo "[start-pod] Created opencode.json from opencode.jsonc"
    elif [ -f "$json_path" ] && [ ! -f "$jsonc_path" ]; then
        cp "$json_path" "$jsonc_path"
        echo "[start-pod] Created opencode.jsonc from opencode.json"
    elif [ -f "$json_path" ] && [ -f "$jsonc_path" ]; then
        if ! cmp -s "$jsonc_path" "$json_path"; then
            cp "$jsonc_path" "$json_path"
            echo "[start-pod] Synced opencode.json from opencode.jsonc"
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
# Phase 1: Install system dependencies
# ============================================
install_system_deps() {
    if ! command -v apt-get &>/dev/null; then
        echo "[start-pod] Not a Debian/Ubuntu system, skipping apt-get. Make sure deps are installed."
        return
    fi

    echo "[start-pod] Installing system dependencies (skipping already installed)..."
    apt-get update -qq

    local pkgs=()

    # Base: build tools, git, ssl
    command -v git       &>/dev/null || pkgs+=(git)
    command -v curl      &>/dev/null || pkgs+=(curl ca-certificates)
    command -v make      &>/dev/null || pkgs+=(build-essential pkg-config libssl-dev)
    command -v tar       &>/dev/null || pkgs+=(tar)
    command -v unzip     &>/dev/null || pkgs+=(unzip)

    # Python
    command -v python3   &>/dev/null || pkgs+=(python3 python3-pip python3-venv)

    # Document processing
    command -v pandoc    &>/dev/null || pkgs+=(pandoc)
    command -v soffice   &>/dev/null || pkgs+=(libreoffice-nogui)
    command -v pdftotext &>/dev/null || pkgs+=(poppler-utils)
    command -v qpdf      &>/dev/null || pkgs+=(qpdf)

    # Media
    command -v ffmpeg    &>/dev/null || pkgs+=(ffmpeg)

    # OCR
    command -v tesseract &>/dev/null || pkgs+=(tesseract-ocr)

    if [ ${#pkgs[@]} -eq 0 ]; then
        echo "[start-pod] All system dependencies already installed."
    else
        echo "[start-pod] Installing: ${pkgs[*]}"
        apt-get install -y -qq "${pkgs[@]}"
    fi
}

# ============================================
# Phase 1b: Install Python packages (for skills)
# ============================================
install_python_deps() {
    if ! command -v python3 &>/dev/null; then
        echo "[start-pod] python3 not found, skipping Python packages."
        return
    fi

    # Check if key packages are already installed
    if python3 -c "import pypdf, pdfplumber, openpyxl, pandas, defusedxml, lxml, docx" &>/dev/null; then
        echo "[start-pod] Python packages already installed."
        return
    fi

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
    local core_packages=(
        pypdf
        pdfplumber
        reportlab
        pytesseract
        pdf2image
        openpyxl
        pandas
        pillow
        defusedxml
        lxml
        python-docx
    )

    echo "[start-pod] Installing Python packages for skills..."
    echo "[start-pod] Python: $(python3 -V 2>&1)"
    echo "[start-pod] Pip: $(${pip_cmd[@]} --version 2>&1)"
    if [ -n "$index_url" ]; then
        echo "[start-pod] Pip index: $index_url"
    else
        echo "[start-pod] Pip index: default (set OPENWORK_PIP_INDEX_URL if network to pypi is slow)"
    fi
    echo "[start-pod] Installing core Python packages..."
    "${pip_cmd[@]}" install \
        "${break_system_packages[@]}" \
        "${common_args[@]}" \
        "${index_args[@]}" \
        "${core_packages[@]}"

    echo "[start-pod] Installing markitdown[pptx]..."
    "${pip_cmd[@]}" install \
        "${break_system_packages[@]}" \
        "${common_args[@]}" \
        "${index_args[@]}" \
        "markitdown[pptx]"
}

install_node_skill_deps() {
    if ! command -v npm &>/dev/null; then
        echo "[start-pod] npm not found, skipping global Node skill deps."
        return
    fi

    local default_packages=(
        docx
        pptxgenjs
        react
        react-dom
        react-icons
        sharp
        exceljs
        xlsx
        mammoth
        jszip
        pdf-lib
        pdfjs-dist
    )

    local configured="${OPENWORK_NODE_SKILL_PACKAGES:-}"
    local packages=()
    if [ -n "$configured" ]; then
        # Space-delimited package list override.
        read -r -a packages <<<"$configured"
    else
        packages=("${default_packages[@]}")
    fi

    local missing=()
    local pkg
    for pkg in "${packages[@]}"; do
        if [ -z "$pkg" ]; then
            continue
        fi
        if ! npm list -g "$pkg" --depth=0 &>/dev/null; then
            missing+=("$pkg")
        fi
    done

    if [ ${#missing[@]} -eq 0 ]; then
        echo "[start-pod] Global Node document packages already installed."
        return
    fi

    local npm_args=(install -g --no-fund --no-audit)
    local npm_registry="${OPENWORK_NPM_REGISTRY:-${NPM_CONFIG_REGISTRY:-}}"
    if [ -n "$npm_registry" ]; then
        npm_args+=(--registry "$npm_registry")
        echo "[start-pod] npm registry: $npm_registry"
    fi

    echo "[start-pod] Installing global Node document packages: ${missing[*]}"
    set +e
    npm "${npm_args[@]}" "${missing[@]}"
    local bulk_status=$?
    local failed=()
    if [ $bulk_status -ne 0 ]; then
        echo "[start-pod] Bulk npm install failed. Retrying one-by-one..."
        for pkg in "${missing[@]}"; do
            if npm list -g "$pkg" --depth=0 &>/dev/null; then
                continue
            fi
            echo "[start-pod] Installing npm package: $pkg"
            npm "${npm_args[@]}" "$pkg"
            if [ $? -ne 0 ]; then
                failed+=("$pkg")
            fi
        done
    fi
    set -e

    if [ ${#failed[@]} -gt 0 ]; then
        echo "[start-pod] WARNING: Failed to install some Node packages: ${failed[*]}"
        echo "[start-pod] Startup continues. You can retry manually with:"
        echo "[start-pod]   npm install -g ${failed[*]}"
    fi
}

# ============================================
# Phase 2: Install runtimes (Node 22 + pnpm + Bun)
# ============================================
install_node() {
    if command -v node &>/dev/null; then
        echo "[start-pod] Node.js already installed: $(node -v)"
    else
        echo "[start-pod] Installing Node.js 22..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y -qq nodejs
    fi
}

install_pnpm() {
    if command -v pnpm &>/dev/null; then
        echo "[start-pod] pnpm already installed: $(pnpm -v)"
    else
        echo "[start-pod] Installing pnpm 10.27.0..."
        corepack enable
        corepack prepare pnpm@10.27.0 --activate
    fi
}

install_bun() {
    if command -v bun &>/dev/null; then
        echo "[start-pod] Bun already installed: $(bun -v)"
    else
        echo "[start-pod] Installing Bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH=$HOME/.bun/bin:$PATH
    fi
}

# ============================================
# Phase 3: Install project dependencies
# ============================================
install_project_deps() {
    cd "$PROJECT_DIR"
    if [ ! -d "node_modules" ]; then
        echo "[start-pod] Running pnpm install..."
        pnpm install
    else
        echo "[start-pod] node_modules exists, skipping pnpm install. Run 'pnpm install' manually if needed."
    fi
}

# ============================================
# Phase 4: Kill old processes
# ============================================
kill_old_processes() {
    echo "[start-pod] Killing old processes on port $OPENWORK_PORT and $PORT..."

    # Kill processes on the openwork server port
    local pids
    pids=$(lsof -ti :"$OPENWORK_PORT" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "[start-pod] Killing processes on port $OPENWORK_PORT: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null || true
    fi

    # Kill processes on the vite dev server port
    pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "[start-pod] Killing processes on port $PORT: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null || true
    fi

    # Also kill any leftover bun dev-headless-web processes
    pkill -f "dev-headless-web" 2>/dev/null || true

    sleep 1
}

# ============================================
# Run
# ============================================
load_runtime_env
export OPENWORK_PROVIDER_ID="${OPENWORK_PROVIDER_ID:-my-company}"
export OPENWORK_MODEL_BASE_URL="${OPENWORK_MODEL_BASE_URL:-http://${OPENWORK_POD_IP}:3002/v1}"
export OPENWORK_DEFAULT_MODEL="${OPENWORK_DEFAULT_MODEL:-Kimi-K2.5}"
sync_global_opencode_config
sync_opencode_config_files
install_system_deps
install_python_deps
install_node
install_pnpm
install_bun
install_node_skill_deps
install_project_deps
kill_old_processes

# ---- Clean up inbox violations (AI agent may have written scripts/deps there) ----
if [ -x "$PROJECT_DIR/scripts/inbox-guard.sh" ]; then
    echo "[start-pod] Running inbox guard (cleanup)..."
    "$PROJECT_DIR/scripts/inbox-guard.sh" --clean || true
fi

echo "[start-pod] Starting OpenWork (POD_IP=$OPENWORK_POD_IP)..."
cd "$PROJECT_DIR"
exec bun scripts/dev-headless-web.ts
