# Empty Pod Deployment (Static Config)

This folder provides a static, hardcoded deployment path for a brand-new pod.
No runtime environment variables are required.

## 1) Edit static config once

Open `packaging/pod/openwork-pod-control.sh` and set these constants:

- `REPO_DIR`, `WORKSPACE_DIR`
- `OPENWORK_PORT`, `WEB_PORT`
- `OPENWORK_TOKEN`, `OPENWORK_HOST_TOKEN`
- `MODEL_BASE_URL`, `MODEL_API_KEY`
- `PROVIDER_ID`, `MODEL_ID`

All values are hardcoded in the script.

## 2) Bootstrap from an empty pod

```bash
bash packaging/pod/openwork-pod-control.sh bootstrap
```

What bootstrap does:

1. Clones/updates OpenWork repo to `REPO_DIR`
2. Installs dependencies (`pnpm install --frozen-lockfile`)
3. Writes global OpenCode config to `~/.config/opencode/opencode.json`
4. Writes workspace model config to `opencode.jsonc`

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

- This script intentionally keeps deployment static and explicit.
- If you later want to support multiple pods, duplicate the script per pod profile and only change the top constants.
