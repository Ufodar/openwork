#!/bin/bash
set -e
# ============================================
# OpenWork Pod Startup Script
# Deploy to a new pod: only change OPENWORK_POD_IP
# ============================================

# ---- Pod IP (change this when deploying to a new pod) ----
export OPENWORK_POD_IP=192.168.5.250

# ---- Network ----
export OPENWORK_NETWORK_MODE=pod
export OPENWORK_HOST=0.0.0.0
export VITE_HOST=0.0.0.0

# ---- Ports (usually no need to change) ----
export OPENWORK_PORT=8789
export PORT=5173

# ---- Bun path ----
export PATH=$HOME/.bun/bin:$PATH

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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
    if python3 -c "import pypdf, pdfplumber, openpyxl, pandas" &>/dev/null; then
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
install_system_deps
install_python_deps
install_node
install_pnpm
install_bun
install_project_deps
kill_old_processes

echo "[start-pod] Starting OpenWork (POD_IP=$OPENWORK_POD_IP)..."
cd "$PROJECT_DIR"
exec bun scripts/dev-headless-web.ts
