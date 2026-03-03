#!/bin/bash
# ============================================
# Inbox Guard — Detect and clean up unauthorized files
# ============================================
# The AI agent sometimes writes files directly to the inbox directory
# (.opencode/openwork/inbox/sessions/<sid>/refs/...) instead of the
# correct workspace directory (documents/sessions/<sid>/...).
#
# This script detects and removes files that should not be in inbox:
#   - .js files (scripts created by the AI)
#   - node_modules/ directories (npm install in inbox)
#   - .tmp-* files (leftover temp files)
#
# Usage:
#   ./scripts/inbox-guard.sh              # Dry-run (report only)
#   ./scripts/inbox-guard.sh --clean      # Remove unauthorized files
#   ./scripts/inbox-guard.sh --watch      # Continuous monitoring (every 30s)
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INBOX_DIR="$PROJECT_DIR/.opencode/openwork/inbox"

MODE="${1:-}"
VIOLATIONS=0

log() {
    echo "[inbox-guard] $*"
}

warn() {
    echo "[inbox-guard] ⚠ $*" >&2
}

check_inbox() {
    VIOLATIONS=0

    if [ ! -d "$INBOX_DIR" ]; then
        log "Inbox directory does not exist: $INBOX_DIR"
        return 0
    fi

    # --- Check 1: JavaScript files (AI-created scripts) ---
    while IFS= read -r -d '' file; do
        warn "VIOLATION: Script file in inbox: $file"
        VIOLATIONS=$((VIOLATIONS + 1))
        if [ "$MODE" = "--clean" ]; then
            rm -f "$file"
            log "  Removed: $file"
        fi
    done < <(find "$INBOX_DIR" -name "*.js" -type f -print0 2>/dev/null)

    # --- Check 2: node_modules directories ---
    while IFS= read -r -d '' dir; do
        warn "VIOLATION: node_modules in inbox: $dir"
        VIOLATIONS=$((VIOLATIONS + 1))
        if [ "$MODE" = "--clean" ]; then
            rm -rf "$dir"
            log "  Removed: $dir"
        fi
    done < <(find "$INBOX_DIR" -name "node_modules" -type d -print0 2>/dev/null)

    # --- Check 3: package.json / package-lock.json ---
    while IFS= read -r -d '' file; do
        warn "VIOLATION: npm config in inbox: $file"
        VIOLATIONS=$((VIOLATIONS + 1))
        if [ "$MODE" = "--clean" ]; then
            rm -f "$file"
            log "  Removed: $file"
        fi
    done < <(find "$INBOX_DIR" \( -name "package.json" -o -name "package-lock.json" \) -type f -print0 2>/dev/null)

    # --- Check 4: .tmp-* leftover files ---
    while IFS= read -r -d '' file; do
        warn "VIOLATION: Temp file in inbox: $file"
        VIOLATIONS=$((VIOLATIONS + 1))
        if [ "$MODE" = "--clean" ]; then
            rm -f "$file"
            log "  Removed: $file"
        fi
    done < <(find "$INBOX_DIR" -name ".tmp-*" -type f -print0 2>/dev/null)

    # --- Check 5: Python scripts ---
    while IFS= read -r -d '' file; do
        warn "VIOLATION: Python script in inbox: $file"
        VIOLATIONS=$((VIOLATIONS + 1))
        if [ "$MODE" = "--clean" ]; then
            rm -f "$file"
            log "  Removed: $file"
        fi
    done < <(find "$INBOX_DIR" -name "*.py" -type f -print0 2>/dev/null)

    # --- Check 6: Shell scripts ---
    while IFS= read -r -d '' file; do
        warn "VIOLATION: Shell script in inbox: $file"
        VIOLATIONS=$((VIOLATIONS + 1))
        if [ "$MODE" = "--clean" ]; then
            rm -f "$file"
            log "  Removed: $file"
        fi
    done < <(find "$INBOX_DIR" -name "*.sh" -type f -print0 2>/dev/null)

    # --- Summary ---
    if [ "$VIOLATIONS" -eq 0 ]; then
        log "Inbox clean: no unauthorized files found."
    else
        warn "Found $VIOLATIONS violation(s) in inbox."
        if [ "$MODE" != "--clean" ]; then
            log "Run with --clean to remove unauthorized files."
        else
            log "Cleaned up $VIOLATIONS unauthorized file(s)."
        fi
    fi
}

if [ "$MODE" = "--watch" ]; then
    log "Starting continuous inbox monitoring (Ctrl+C to stop)..."
    while true; do
        check_inbox
        sleep 30
    done
else
    check_inbox
    exit "$VIOLATIONS"
fi
