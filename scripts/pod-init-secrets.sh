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

model_ref = config.get("model", "")
provider_id = "my-company"
default_model = "Qwen3.5-397B-A17B"
if isinstance(model_ref, str) and "/" in model_ref:
    maybe_provider, maybe_model = model_ref.split("/", 1)
    if maybe_provider.strip():
        provider_id = maybe_provider.strip()
    if maybe_model.strip():
        default_model = maybe_model.strip()

if default_model in {"Kimi-K2.5", "GLM-5"}:
    default_model = "Qwen3.5-397B-A17B"

provider = config.get("provider", {}).get(provider_id, {})
provider_options = provider.get("options", {}) if isinstance(provider, dict) else {}
my_company_api_key = provider_options.get("apiKey") if isinstance(provider_options, dict) else None
model_base_url = provider_options.get("baseURL") if isinstance(provider_options, dict) else None

mcp = config.get("mcp", {})
bocha = {}
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

def extract_bocha_mcp_dir(command: object) -> str:
    if not isinstance(command, list):
        return ""
    for index, part in enumerate(command):
        if part == "--directory" and index + 1 < len(command):
            next_part = command[index + 1]
            if isinstance(next_part, str) and next_part.strip():
                return next_part.strip()
    return ""

bocha_command = bocha.get("command", {}) if isinstance(bocha, dict) else {}
bocha_api_key = first_non_empty(
    bocha_env.get("BOCHA_API_KEY", ""),
    bocha_env.get("BOCAI_API_KEY", ""),
)
bocha_mcp_dir = first_non_empty(
    bocha_env.get("BOCHA_MCP_DIR", ""),
    extract_bocha_mcp_dir(bocha_command),
    str(Path.home() / ".config" / "openwork" / "bocha-search-mcp"),
)

def shell_quote(value: str) -> str:
    escaped = value.replace("'", "'\"'\"'")
    return f"'{escaped}'"

lines = [
    "# OpenWork runtime secrets (Pod local only, do not commit)",
    "# This file is loaded by scripts/start-pod.sh and scripts/restart-pod.sh",
    f"export MY_COMPANY_API_KEY={shell_quote(my_company_api_key or '')}",
    f"export OPENWORK_PROVIDER_ID={shell_quote(provider_id)}",
    f"export OPENWORK_MODEL_BASE_URL={shell_quote(model_base_url or 'http://192.168.5.10:3002/v1')}",
    "# Supported values: Qwen3.5-397B-A17B, MiniMax-2.5",
    f"export OPENWORK_DEFAULT_MODEL={shell_quote(default_model)}",
    f"export OPENWORK_SMALL_MODEL={shell_quote(default_model)}",
    f"export BOCHA_API_KEY={shell_quote(bocha_api_key or '')}",
    f"export BOCHA_MCP_DIR={shell_quote(bocha_mcp_dir)}",
    "# RAGFlow knowledge retrieval",
    "export RAGFLOW_BASE_URL='http://192.168.2.35:32473'",
    "export RAGFLOW_API_KEY=''",
    "export RAGFLOW_MCP_URL='http://192.168.2.35:30467/sse'",
    "# Optional:",
    "export BRAVE_API_KEY=''",
    "export GITHUB_TOKEN=''",
    "export OPENWORK_GIT_USERNAME=''",
    "export OPENWORK_GIT_TOKEN=''",
    "# Set to 1 to auto git pull before each restart-pod.sh run",
    "export OPENWORK_PULL_BEFORE_RESTART='1'",
    "# Set to 1 to auto-clean common pod-local script edits before pull",
    "export OPENWORK_AUTO_RESTORE_POD_LOCAL_CHANGES='1'",
    "# Optional npm mirror / package list override for doc tooling preinstall",
    "export OPENWORK_NPM_REGISTRY=''",
    "export OPENWORK_NODE_SKILL_PACKAGES=''",
    "# Optional runtime overrides (avoid editing scripts on pod)",
    "export OPENWORK_POD_IP=''",
    "export OPENWORK_PORT='8789'",
    "export PORT='5173'",
    "export OPENWORK_ONLYOFFICE_URL=''",
    "export OPENWORK_ONLYOFFICE_INTERNAL_URL='http://onlyoffice:80'",
    "export OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL=''",
    "",
]

secrets_path.write_text("\n".join(lines), encoding="utf-8")
os.chmod(secrets_path, 0o600)
print(f"[pod-init-secrets] Wrote: {secrets_path}")
PY

echo "[pod-init-secrets] Done."
