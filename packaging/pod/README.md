# Empty Pod Deployment (Static Config)

This folder provides a static deployment path for a brand-new pod.

Use this only when you are comfortable setting pod-local secrets during bootstrap.
Tracked workspace config, if you choose to keep one, should stay secret-free.

## 1) Edit static config once

Open `packaging/pod/openwork-pod-control.sh` and set these constants:

- `REPO_DIR`, `WORKSPACE_DIR`
- `OPENWORK_PORT`, `WEB_PORT`
- `OPENWORK_TOKEN`, `OPENWORK_HOST_TOKEN`
- `MODEL_BASE_URL`, `MODEL_API_KEY`
- `PROVIDER_ID`, `MODEL_ID`

`MODEL_API_KEY` is written into the pod's global OpenCode config and should never be committed as a filled-in value.

## 2) Bootstrap from an empty pod

```bash
bash packaging/pod/openwork-pod-control.sh bootstrap
```

What bootstrap does:

1. Clones/updates OpenWork repo to `REPO_DIR`
2. Installs dependencies (`pnpm install --frozen-lockfile`)
3. Writes global OpenCode config to `~/.config/opencode/opencode.json`

Config split:

- Global `~/.config/opencode/opencode.json`: provider, API key, shared model catalog, and the default model used when no workspace override exists.
- Workspace `$WORKSPACE_DIR/opencode.jsonc`: optional. Add it only when this workspace needs project-local model, plugin, or MCP overrides.
- This repo intentionally leaves `provider` and `model` out of tracked workspace config so pod-local secrets can control the default model.
- Do not put real API keys or bearer tokens into tracked repo `opencode.json*`.

## 3) Start services

```bash
bash packaging/pod/openwork-pod-control.sh start
```

Starts:

- `openwork-orchestrator` (API/proxy stack)
- `@different-ai/openwork-ui` (Vite UI)

Logs:

- `/srv/openwork-runtime/logs/openwork-orchestrator.log`
- `/srv/openwork-runtime/logs/openwork-web.log`

## 4) Stop/restart/status

```bash
bash packaging/pod/openwork-pod-control.sh status
bash packaging/pod/openwork-pod-control.sh stop
bash packaging/pod/openwork-pod-control.sh restart
```

## 5) New pod checklist

Use this checklist for each fresh pod:

1. Ensure `git`, `node`, `pnpm`, `bun` are installed.
2. Update static constants in `openwork-pod-control.sh`.
3. Run `bootstrap` once.
4. Run `start`.
5. Verify API: `http://<pod-ip>:<OPENWORK_PORT>/health`
6. Verify UI: `http://<pod-ip>:<WEB_PORT>`
7. Confirm model selection in app is `PROVIDER_ID/MODEL_ID`.

## Notes

- The actual OpenWork workspace is `WORKSPACE_DIR`, not `REPO_DIR`.
- OpenWork may create a bare `opencode.jsonc` later if you use product features that persist project-level config.
- This script intentionally keeps deployment static and explicit.
- If you later want to support multiple pods, duplicate the script per pod profile and only change the top constants.
