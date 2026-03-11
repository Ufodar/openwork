#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path


SUPPORTED_MODELS = {
    "Kimi-K2.5": {
        "name": "Kimi-K2.5",
        "capabilities": {
            "input": {
                "text": True,
                "image": True,
                "audio": True,
                "video": True,
                "pdf": True,
            },
            "output": {
                "text": True,
                "image": True,
                "audio": False,
                "video": False,
                "pdf": False,
            },
            "attachment": True,
            "interleaved": True,
            "toolcall": True,
        },
    },
    "GLM-5": {
        "name": "GLM-5",
        "capabilities": {
            "input": {"text": True},
            "output": {"text": True},
            "attachment": False,
            "toolcall": True,
        },
    },
    "MiniMax-2.5": {
        "name": "MiniMax-2.5",
        "capabilities": {
            "input": {"text": True},
            "output": {"text": True},
            "attachment": False,
            "toolcall": True,
        },
    },
    "Qwen3.5-397B-A17B": {
        "name": "Qwen3.5-397B-A17B",
        "capabilities": {
            "input": {
                "text": True,
                "image": True,
                "audio": True,
                "video": True,
                "pdf": True,
            },
            "output": {
                "text": True,
                "image": True,
                "audio": False,
                "video": False,
                "pdf": False,
            },
            "attachment": True,
            "interleaved": True,
            "toolcall": True,
        },
    },
}


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


def main() -> int:
    global_path = Path(
        os.environ.get("OPENWORK_GLOBAL_CONFIG", str(Path.home() / ".config" / "opencode" / "opencode.json"))
    )
    provider_id = os.environ.get("OPENWORK_PROVIDER_ID", "my-company").strip() or "my-company"
    default_model = os.environ.get("OPENWORK_DEFAULT_MODEL", "Kimi-K2.5").strip() or "Kimi-K2.5"
    base_url = resolve_default_base_url()
    api_key = os.environ.get("MY_COMPANY_API_KEY", "").strip()

    if default_model not in SUPPORTED_MODELS:
        print(
            f"[sync-global-opencode-config] Unsupported OPENWORK_DEFAULT_MODEL={default_model!r}. "
            f"Supported: {', '.join(SUPPORTED_MODELS)}",
            file=sys.stderr,
        )
        return 1

    config = load_json(global_path)
    config["$schema"] = "https://opencode.ai/config.json"

    providers = config.get("provider")
    if not isinstance(providers, dict):
        providers = {}
        config["provider"] = providers

    provider = providers.get(provider_id)
    if not isinstance(provider, dict):
        provider = {}
        providers[provider_id] = provider

    provider["options"] = {
        "baseURL": base_url,
        "apiKey": api_key,
    }
    provider["models"] = SUPPORTED_MODELS
    config["model"] = f"{provider_id}/{default_model}"

    global_path.parent.mkdir(parents=True, exist_ok=True)
    global_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    api_key_state = "set" if api_key else "empty"
    print(
        f"[sync-global-opencode-config] Wrote {global_path} "
        f"(provider={provider_id}, default_model={default_model}, api_key={api_key_state})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
