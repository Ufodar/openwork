#!/bin/bash
set -euo pipefail

RUNTIME_ENV_DIR="${OPENWORK_RUNTIME_ENV_DIR:-$HOME/.config/openwork}"
SECRETS_FILE="${OPENWORK_SECRETS_FILE:-$RUNTIME_ENV_DIR/secrets.env}"
GLOBAL_CONFIG="${OPENWORK_GLOBAL_CONFIG:-$HOME/.config/opencode/opencode.json}"
FORCE_REWRITE="${OPENWORK_FORCE_SECRETS_REWRITE:-0}"

mkdir -p "$RUNTIME_ENV_DIR"

if [ -f "$SECRETS_FILE" ] && [ "$FORCE_REWRITE" != "1" ]; then
    echo "[pod-init-secrets] Secrets file already exists: $SECRETS_FILE"
    echo "[pod-init-secrets] Re-run with OPENWORK_FORCE_SECRETS_REWRITE=1 to regenerate."
    exit 0
fi

python3 - "$GLOBAL_CONFIG" "$SECRETS_FILE" <<'PY'
import json
import os
import sys
from pathlib import Path

global_config_path = Path(sys.argv[1])
secrets_path = Path(sys.argv[2])

config = {}
if global_config_path.exists():
    try:
        config = json.loads(global_config_path.read_text(encoding="utf-8"))
    except Exception:
        config = {}

provider = config.get("provider", {}).get("my-company", {})
my_company_api_key = (
    provider.get("options", {}).get("apiKey")
    if isinstance(provider, dict)
    else None
)

mcp = config.get("mcp", {})
bocha_env = {}
if isinstance(mcp, dict):
    bocha = mcp.get("bocha-search", {})
    if isinstance(bocha, dict):
        bocha_env = bocha.get("environment", {}) or {}
    if not bocha_env:
        bocai = mcp.get("bocai-search", {})
        if isinstance(bocai, dict):
            bocha_env = bocai.get("environment", {}) or {}

def first_non_empty(*values: str) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""

bocai_api_key = first_non_empty(
    bocha_env.get("BOCAI_API_KEY", ""),
    bocha_env.get("BOCHA_API_KEY", ""),
)
bocai_api_url = first_non_empty(
    bocha_env.get("BOCAI_API_URL", ""),
    bocha_env.get("BOCHA_API_URL", ""),
    "https://api.bochaai.com/v1/web-search",
)

def shell_quote(value: str) -> str:
    escaped = value.replace("'", "'\"'\"'")
    return f"'{escaped}'"

lines = [
    "# OpenWork runtime secrets (Pod local only, do not commit)",
    "# This file is loaded by scripts/start-pod.sh and scripts/restart-pod.sh",
    f"export MY_COMPANY_API_KEY={shell_quote(my_company_api_key or '')}",
    f"export BOCAI_API_KEY={shell_quote(bocai_api_key or '')}",
    f"export BOCAI_API_URL={shell_quote(bocai_api_url or 'https://api.bochaai.com/v1/web-search')}",
    "# Optional:",
    "export BRAVE_API_KEY=''",
    "export GITHUB_TOKEN=''",
    "export OPENWORK_GIT_USERNAME=''",
    "export OPENWORK_GIT_TOKEN=''",
    "",
]

secrets_path.write_text("\n".join(lines), encoding="utf-8")
os.chmod(secrets_path, 0o600)
print(f"[pod-init-secrets] Wrote: {secrets_path}")
PY

echo "[pod-init-secrets] Done."
