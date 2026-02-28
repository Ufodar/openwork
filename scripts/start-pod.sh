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
    if command -v apt-get &>/dev/null; then
        echo "[start-pod] Installing system dependencies..."
        apt-get update -qq
        # Base: build tools, git, ssl
        apt-get install -y -qq ca-certificates curl git tar unzip build-essential pkg-config libssl-dev
        # Python
        apt-get install -y -qq python3 python3-pip python3-venv
        # Document processing: pandoc, LibreOffice, poppler, qpdf
        apt-get install -y -qq pandoc libreoffice-nogui poppler-utils qpdf
        # Media: ffmpeg
        apt-get install -y -qq ffmpeg
        # OCR (for scanned PDF)
        apt-get install -y -qq tesseract-ocr
    else
        echo "[start-pod] Not a Debian/Ubuntu system, skipping apt-get. Make sure deps are installed."
    fi
}

# ============================================
# Phase 1b: Install Python packages (for skills)
# ============================================
install_python_deps() {
    echo "[start-pod] Installing Python packages for skills..."
    pip3 install --quiet --break-system-packages \
        pypdf pdfplumber reportlab pytesseract pdf2image \
        openpyxl pandas pillow \
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
