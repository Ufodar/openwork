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
export OPENWORK_GLOBAL_PERMISSION="${OPENWORK_GLOBAL_PERMISSION:-allow}"
export OPENWORK_SESSION_RUNTIME_MODE="${OPENWORK_SESSION_RUNTIME_MODE:-process}"
export OPENWORK_MAX_ACTIVE_SESSION_RUNTIMES="${OPENWORK_MAX_ACTIVE_SESSION_RUNTIMES:-30}"
export OPENWORK_SESSION_RUNTIME_IDLE_TTL_MS="${OPENWORK_SESSION_RUNTIME_IDLE_TTL_MS:-28800000}"
export OPENWORK_POD_OPENCODE_SOURCE="${OPENWORK_POD_OPENCODE_SOURCE:-downloaded}"

# ---- Bun path ----
export PATH=$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH

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

    echo "[start-pod] NODE_PATH includes global npm modules: $npm_root"
}

ensure_uv() {
    if command -v uv &>/dev/null; then
        echo "[start-pod] uv already installed: $(uv --version 2>/dev/null || echo unknown)"
        return
    fi

    if ! command -v python3 &>/dev/null; then
        echo "[start-pod] ERROR: python3 is required to install uv." >&2
        exit 1
    fi

    local pip_cmd=(python3 -m pip)
    local break_system_packages=()
    if "${pip_cmd[@]}" install --help 2>/dev/null | grep -q -- "--break-system-packages"; then
        break_system_packages+=(--break-system-packages)
    fi

    echo "[start-pod] Installing uv..."
    "${pip_cmd[@]}" install "${break_system_packages[@]}" --no-cache-dir uv
    export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
    if ! command -v uv &>/dev/null; then
        echo "[start-pod] ERROR: uv install finished but command is still unavailable." >&2
        exit 1
    fi
    echo "[start-pod] uv installed: $(uv --version 2>/dev/null || echo unknown)"
}

ensure_bocha_mcp_checkout() {
    local bocha_dir="${BOCHA_MCP_DIR:-$HOME/.config/openwork/bocha-search-mcp}"
    local bocha_repo_url="${BOCHA_MCP_REPO_URL:-https://github.com/BochaAI/bocha-search-mcp.git}"

    if [ -d "$bocha_dir/.git" ]; then
        echo "[start-pod] Bocha MCP checkout already exists: $bocha_dir"
        return
    fi

    mkdir -p "$(dirname "$bocha_dir")"
    echo "[start-pod] Cloning official Bocha MCP to $bocha_dir ..."
    git clone "$bocha_repo_url" "$bocha_dir"
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
    command -v lsof      &>/dev/null || pkgs+=(lsof)

    # Python
    command -v python3   &>/dev/null || pkgs+=(python3)
    python3 -m pip --version &>/dev/null || pkgs+=(python3-pip)
    python3 -m venv --help &>/dev/null || pkgs+=(python3-venv)

    # Document processing
    command -v file      &>/dev/null || pkgs+=(file)
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

install_python_deps() {
    if ! command -v python3 &>/dev/null; then
        echo "[start-pod] python3 not found, skipping Python packages."
        return
    fi

    if ! python3 -m pip --version &>/dev/null; then
        echo "[start-pod] python3 is available but pip is missing." >&2
        echo "[start-pod] Install python3-pip first, then rerun start-pod.sh." >&2
        exit 1
    fi

    local missing_raw
    missing_raw="$(detect_missing_python_skill_packages)"
    if [ -z "$missing_raw" ]; then
        echo "[start-pod] Python packages already installed."
        return
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

    echo "[start-pod] Installing Python packages for skills..."
    echo "[start-pod] Python: $(python3 -V 2>&1)"
    echo "[start-pod] Pip: $(${pip_cmd[@]} --version 2>&1)"
    if [ -n "$index_url" ]; then
        echo "[start-pod] Pip index: $index_url"
    else
        echo "[start-pod] Pip index: default (set OPENWORK_PIP_INDEX_URL if network to pypi is slow)"
    fi
    echo "[start-pod] Installing missing Python packages: ${missing_packages[*]}"
    "${pip_cmd[@]}" install \
        "${break_system_packages[@]}" \
        "${common_args[@]}" \
        "${index_args[@]}" \
        "${missing_packages[@]}"
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

configure_global_node_path
export OPENWORK_USER_WORKSPACE_TEMPLATE_DIR="${OPENWORK_USER_WORKSPACE_TEMPLATE_DIR:-$PROJECT_DIR}"

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
        export PATH=$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH
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

install_opencode() {
    if command -v opencode &>/dev/null; then
        echo "[start-pod] opencode already installed: $(opencode --version 2>/dev/null || echo unknown)"
        return
    fi

    local install_url="${OPENWORK_OPENCODE_INSTALL_URL:-https://opencode.ai/install}"
    echo "[start-pod] Installing opencode from $install_url ..."
    curl -fsSL "$install_url" | bash
    export PATH=$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH

    if ! command -v opencode &>/dev/null; then
        echo "[start-pod] ERROR: opencode install finished but command is still unavailable." >&2
        echo "[start-pod] Check whether ~/.opencode/bin/opencode or ~/.local/bin/opencode exists and whether the install script succeeded." >&2
        exit 1
    fi

    echo "[start-pod] opencode installed: $(opencode --version 2>/dev/null || echo unknown)"
}

ensure_opencode_ready() {
    if command -v opencode &>/dev/null; then
        echo "[start-pod] opencode already installed: $(opencode --version 2>/dev/null || echo unknown)"
        return
    fi

    echo "[start-pod] ERROR: opencode command not found." >&2
    echo "[start-pod] Install opencode in the pod first, then rerun start-pod.sh." >&2
    exit 1
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
export OPENWORK_DEFAULT_MODEL="${OPENWORK_DEFAULT_MODEL:-Qwen3.5-397B-A17B}"
export OPENWORK_SMALL_MODEL="${OPENWORK_SMALL_MODEL:-$OPENWORK_DEFAULT_MODEL}"
sync_global_opencode_config
sync_opencode_config_files
install_system_deps
install_python_deps
install_node
install_pnpm
install_bun
install_opencode
install_node_skill_deps
install_project_deps
ensure_opencode_ready
ensure_uv
ensure_bocha_mcp_checkout

echo "[start-pod] Environment is ready. Handing off to restart-pod.sh for build + launch..."
exec bash "$SCRIPT_DIR/restart-pod.sh"
