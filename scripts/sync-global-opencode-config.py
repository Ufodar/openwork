#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path


SUPPORTED_MODELS = {
    "DeepSeek-V4": {
        "name": "DeepSeek-V4",
        "limit": {
            "context": 1048576,
            "output": 1048576,
        },
        "options": {
            "chat_template_kwargs": {
                "thinking": True,
                "reasoning_effort": "max",
            },
        },
        "capabilities": {
            "input": {"text": True},
            "output": {"text": True},
            "attachment": False,
            "toolcall": True,
            "reasoning": True,
        },
        "variants": {
            "thinking-max": {
                "chat_template_kwargs": {
                    "thinking": True,
                    "reasoning_effort": "max",
                },
            },
            "thinking-high": {
                "chat_template_kwargs": {
                    "thinking": True,
                    "reasoning_effort": "high",
                },
            },
            "no-thinking": {
                "chat_template_kwargs": {
                    "thinking": False,
                },
            },
        },
    },
    "Qwen3.5-397B-A17B": {
        "name": "Qwen3.5-397B-A17B",
        "limit": {
            "context": 256000,
            "output": 32000,
        },
        "options": {
            "systemMessageMode": "system",
        },
        "capabilities": {
            "input": {"text": True, "image": True, "audio": True, "video": True, "pdf": True},
            "output": {"text": True, "image": True, "audio": False, "video": False, "pdf": False},
            "attachment": True,
            "interleaved": True,
            "toolcall": True,
        },
    },
    "MiniMax-2.5": {
        "name": "MiniMax-2.5",
        "limit": {
            "context": 256000,
            "output": 32000,
        },
        "capabilities": {
            "input": {"text": True},
            "output": {"text": True},
            "attachment": False,
            "toolcall": True,
        },
    },
    "GLM-5": {
        "name": "GLM-5",
        "limit": {
            "context": 256000,
            "output": 32000,
        },
        "capabilities": {
            "input": {"text": True},
            "output": {"text": True},
            "attachment": False,
            "toolcall": True,
        },
    },
}

DEFAULT_MODEL_ID = "DeepSeek-V4"


def resolve_default_base_url() -> str:
    explicit = os.environ.get("OPENWORK_MODEL_BASE_URL", "").strip()
    if explicit:
        return explicit

    pod_ip = os.environ.get("OPENWORK_POD_IP", "").strip()
    if pod_ip:
        return f"http://{pod_ip}:3002/v1"

    return "http://192.168.5.10:3002/v1"


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


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


def main() -> int:
    global_path = Path(
        os.environ.get("OPENWORK_GLOBAL_CONFIG", str(Path.home() / ".config" / "opencode" / "opencode.json"))
    )
    provider_id = os.environ.get("OPENWORK_PROVIDER_ID", "my-company").strip() or "my-company"
    default_model = os.environ.get("OPENWORK_DEFAULT_MODEL", DEFAULT_MODEL_ID).strip() or DEFAULT_MODEL_ID
    small_model = os.environ.get("OPENWORK_SMALL_MODEL", default_model).strip() or default_model
    base_url = resolve_default_base_url()
    permission_mode = os.environ.get("OPENWORK_GLOBAL_PERMISSION", "").strip()

    if default_model not in SUPPORTED_MODELS:
        print(
            f"[sync-global-opencode-config] Unsupported OPENWORK_DEFAULT_MODEL={default_model!r}; "
            f"falling back to {DEFAULT_MODEL_ID}. Supported: {', '.join(SUPPORTED_MODELS)}",
            file=sys.stderr,
        )
        default_model = DEFAULT_MODEL_ID

    if small_model not in SUPPORTED_MODELS:
        print(
            f"[sync-global-opencode-config] Unsupported OPENWORK_SMALL_MODEL={small_model!r}; "
            f"falling back to {default_model}. Supported: {', '.join(SUPPORTED_MODELS)}",
            file=sys.stderr,
        )
        small_model = default_model

    config = load_json(global_path)
    config["$schema"] = "https://opencode.ai/config.json"

    keep_global_mem_plugin = os.environ.get("OPENWORK_KEEP_GLOBAL_MEM_PLUGIN", "").strip() == "1"
    keep_global_memory_mcp = os.environ.get("OPENWORK_KEEP_GLOBAL_MEMORY_MCP", "").strip() == "1"

    providers = config.get("provider")
    if not isinstance(providers, dict):
        providers = {}
        config["provider"] = providers

    provider = providers.get(provider_id)
    if not isinstance(provider, dict):
        provider = {}
        providers[provider_id] = provider

    provider_options = provider.get("options")
    if not isinstance(provider_options, dict):
        provider_options = {}

    api_key = first_non_empty(
        os.environ.get("MY_COMPANY_API_KEY", ""),
        str(provider_options.get("apiKey", "")),
    )

    provider["options"] = {
        "baseURL": base_url,
        "apiKey": api_key,
    }
    provider["models"] = SUPPORTED_MODELS
    config["model"] = f"{provider_id}/{default_model}"
    config["small_model"] = f"{provider_id}/{small_model}"
    if permission_mode:
        config["permission"] = permission_mode

    plugins = config.get("plugin")
    if isinstance(plugins, list) and not keep_global_mem_plugin:
        filtered_plugins = [
            item
            for item in plugins
            if not (isinstance(item, str) and "opencode-mem" in item)
        ]
        config["plugin"] = filtered_plugins

    mcp = config.get("mcp")
    if not isinstance(mcp, dict):
        mcp = {}
        config["mcp"] = mcp

    if not keep_global_memory_mcp:
        memory = mcp.get("memory")
        if isinstance(memory, dict):
            memory["enabled"] = False

    bocha = mcp.get("bocha-search")
    if not isinstance(bocha, dict):
        bocha = {}

    bocha_env = bocha.get("environment")
    if not isinstance(bocha_env, dict):
        bocha_env = {}
    bocha_command = bocha.get("command")

    bocha_api_key = first_non_empty(
        os.environ.get("BOCAI_API_KEY", ""),
        os.environ.get("BOCHA_API_KEY", ""),
        bocha_env.get("BOCAI_API_KEY", ""),
        bocha_env.get("BOCHA_API_KEY", ""),
    )
    bocha_mcp_dir = first_non_empty(
        os.environ.get("BOCHA_MCP_DIR", ""),
        extract_bocha_mcp_dir(bocha_command),
        str(Path.home() / ".config" / "openwork" / "bocha-search-mcp"),
    )

    if bocha_api_key:
        bocha["type"] = "local"
        bocha["enabled"] = True
        bocha["command"] = [
            "uv",
            "--directory",
            bocha_mcp_dir,
            "run",
            "bocha-search-mcp",
        ]
        bocha["environment"] = {
            "BOCHA_API_KEY": bocha_api_key,
        }
        mcp["bocha-search"] = bocha

    global_path.parent.mkdir(parents=True, exist_ok=True)
    global_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    api_key_state = "set" if api_key else "empty"
    print(
        f"[sync-global-opencode-config] Wrote {global_path} "
        f"(provider={provider_id}, default_model={default_model}, small_model={small_model}, api_key={api_key_state})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
