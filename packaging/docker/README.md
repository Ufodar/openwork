# OpenWork Host (Docker)

## Dev testability stack (recommended for testing)

One command, no custom Dockerfile. Uses `node:22-bookworm-slim` off the shelf.

From the repo root:

```bash
./packaging/docker/dev-up.sh
```

Then open the printed Web UI URL (ports are randomized so you can run multiple stacks).

What it does:
- Starts **headless** (OpenCode + OpenWork server) on port 8787
- Starts **web UI** (Vite dev server) on port 5173
- Auto-generates and shares auth tokens between services
- Web waits for headless health check before starting
- Builds Linux binaries inside the container (no host binary conflicts)

Useful commands:
- Logs: `docker compose -p <project> -f packaging/docker/docker-compose.dev.yml logs`
- Tear down: `docker compose -p <project> -f packaging/docker/docker-compose.dev.yml down`
- Health check: `curl http://localhost:<openwork_port>/health`

Optional env vars (via `.env` or `export`):
- `OPENWORK_TOKEN` — fixed client token
- `OPENWORK_HOST_TOKEN` — fixed host/admin token
- `OPENWORK_WORKSPACE` — host path to mount as workspace
- `OPENWORK_PORT` — host port to map to container :8787
- `WEB_PORT` — host port to map to container :5173

---

## OnlyOffice (Document Writer) + Chinese fonts

The Document Writer view uses **OnlyOffice DocumentServer** for in-browser editing.

If your bid/tender templates use common Chinese fonts like `宋体/等线/黑体/楷体`, a default OnlyOffice Docker image may not have them installed, leading to heavy font substitution and “潦草/不工整” rendering compared to Word.

The repo now ships a derived OnlyOffice image under `packaging/onlyoffice/Dockerfile` that bakes in:

* open-source CJK fonts (`Noto`, `WenQuanYi`, `Arphic`)
* fontconfig aliases for common Chinese Office families
* exact aliases for legacy Office names such as `仿宋_GB2312` and `楷体_GB2312`

If you run the root `docker-compose.yml`, build the image instead of pulling the stock upstream image:

```bash
docker compose up --build onlyoffice
```

If you already have an existing OnlyOffice container and want to patch it in place, install the same open-source CJK fonts + aliases:

```bash
./scripts/onlyoffice-install-cjk-fonts.sh opencode-onlyoffice-1
```

If the document still differs from Word because the template depends on proprietary host fonts such as `PingFang SC` or vendor fonts, sync those host fonts too:

```bash
./scripts/onlyoffice-sync-host-fonts.sh opencode-onlyoffice-1
```

Then reload the document in OpenWork and compare again.

---

## Production container

This is a minimal packaging template to run the OpenWork Host contract in a single container.

It runs:

- `opencode serve` (engine) bound to `127.0.0.1:4096` inside the container
- `openwork-server` bound to `0.0.0.0:8787` (the only published surface)

### Local run (compose)

From this directory:

```bash
docker compose up --build
```

Then open:

- `http://127.0.0.1:8787/ui`

### Config

Recommended env vars:

- `OPENWORK_TOKEN` (client token)
- `OPENWORK_HOST_TOKEN` (host/owner token)

Optional:

- `OPENWORK_APPROVAL_MODE=auto|manual`
- `OPENWORK_APPROVAL_TIMEOUT_MS=30000`

Persistence:

- Workspace is mounted at `/workspace`
- Host data dir is mounted at `/data` (OpenCode caches + OpenWork server config/tokens)

### Notes

- OpenCode is not exposed directly; access it via the OpenWork proxy (`/opencode/*`).
- For PaaS, replace `./workspace:/workspace` with a volume or a checkout strategy (git clone on boot).
