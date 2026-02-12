# OpenWork-DOCX

## Project Overview

An AI-native document editor and multi-agent workspace built on top of OpenWork (which itself runs on OpenCode as its engine). The goal is to build "an AI employee company" where each agent handles a specialized task.

**Core stack:**
- **OpenCode** (official CLI, unmodified) = agentic engine (sessions, tools, MCP, skills)
- **OpenWork** (this fork) = experience layer (UI, document routes, agent workspace, OnlyOffice)
- **OnlyOffice** (Docker) = document rendering/editing
- **Skills** (per-workspace `.opencode/skill/`) = knowledge injection for LLM

## Design Principles

1. **Zero modifications to OpenCode source** — use the official CLI binary as-is, communicate via `@opencode-ai/sdk`
2. **Knowledge injection, not tool wrapping** — LLM reads SKILL.md then uses built-in tools (read/edit/bash) to manipulate OOXML directly
3. **Single fork to maintain** — all customizations live in this openwork fork; upstream sync via `git fetch upstream && git merge upstream/dev`
4. **Composable agent pages** — each agent type gets its own page layout built from shared components (chat, OnlyOffice, diff view, etc.)

## Architecture

```
Browser (OpenWork Desktop / Web)
├── Agent Workspace UI (SolidJS)
│   ├── Session management (upstream)
│   ├── Skills / MCP / Plugins management (upstream)
│   ├── Scheduled tasks (upstream)
│   ├── Agent hub (NEW) — select specialized agents
│   └── Document editor (NEW) — OnlyOffice + AI chat
│
OpenWork Server (Bun, packages/server)
├── Upstream: skills, plugins, MCP, workspaces, events
├── NEW: /document/* routes (file serving, OnlyOffice config, callbacks)
└── NEW: /agent/* routes (agent registry, per-agent config)

OnlyOffice Document Server (Docker, port 8080)
├── Word/Excel/PPT rendering
├── Collaborative editing / track changes / comments
└── PDF export

OpenCode CLI (official binary, port 4096)
├── Agent execution (read, edit, bash, glob, grep)
├── Session management
├── MCP servers
└── Skill loading from .opencode/skill/
```

## Repository Structure (Changes vs Upstream OpenWork)

```
openwork/                              # Fork of different-ai/openwork
├── packages/
│   ├── server/src/
│   │   └── document.ts               # [NEW] OnlyOffice document routes
│   ├── app/src/app/
│   │   ├── pages/
│   │   │   ├── agents.tsx             # [NEW] Agent hub page
│   │   │   └── document.tsx           # [NEW] Document editor page
│   │   └── components/
│   │       └── onlyoffice-editor.tsx  # [NEW] OnlyOffice iframe component
│   └── desktop/
│       └── (Tauri config tweaks if needed)
├── docker-compose.yml                 # [NEW] OnlyOffice Document Server
└── CLAUDE.md                          # [NEW] This file
```

## Document API Endpoints (in OpenWork Server)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/document` | GET | List Office files in workspace `documents/` directory |
| `/document/config` | GET | Generate OnlyOffice editor config (JWT, doc key, URLs) |
| `/document/file` | GET | Serve document binary (OnlyOffice downloads from here) |
| `/document/callback` | POST | Handle OnlyOffice save callbacks |
| `/document/upload` | POST | Upload Office documents |

## AI Document Editing Flow

```
User: "Add a column 'Acceptance Criteria' to the table in Chapter 3"
  |
OpenCode Agent (has read SKILL.md, understands OOXML)
  |
bash: python scripts/office/unpack.py document.docx /tmp/work/
  |
grep: <w:pStyle w:val="Heading1" → locate chapters
  |
read: /tmp/work/word/document.xml (lines 450-600) → read Chapter 3
  |
edit: insert <w:tc> with w:ins markup
  |
bash: python scripts/office/pack.py /tmp/work/ document.docx
  |
OnlyOffice reloads → user sees tracked changes → accept/reject
```

## Agent Hub Vision

The agent hub is a page where users select specialized agents. Each agent has its own page layout composed from shared components:

```
Agent Hub
├── Document Writer    → chat + OnlyOffice + skill: docx
├── Bid Writer         → chat + OnlyOffice + skill: docx + bid-writing
├── Bug Fixer          → chat + diff view + terminal
├── Code Reviewer      → chat + diff view
├── Research Agent     → chat + web search results
├── Manager Agent      → delegates to sub-agents, monitors progress
└── ...
```

Each agent page inherits from a base layout and adds domain-specific components. OnlyOffice is just one type of component — others include diff viewer, terminal, file tree, etc.

## Local Development

```bash
# Start OnlyOffice
docker compose up -d

# Install dependencies
pnpm install

# Start OpenWork (desktop + UI)
pnpm dev

# Or web-only mode
pnpm dev:ui

# Or headless mode
pnpm dev:headless-web
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ONLYOFFICE_URL` | `http://localhost:8080` | OnlyOffice Document Server URL |
| `ONLYOFFICE_CALLBACK_URL` | `http://host.docker.internal:<port>` | OnlyOffice callback URL to OpenWork server |
| `ONLYOFFICE_JWT_SECRET` | (empty) | JWT secret for OnlyOffice security |

## Upstream Sync

```bash
git fetch upstream
git merge upstream/dev
```

Custom code is concentrated in new files/directories. Modifications to upstream files should be minimal (ideally zero — prefer adding new files over modifying existing ones).

## Development Conventions

- Language: TypeScript (consistent with OpenWork/OpenCode)
- Frontend: SolidJS + Tailwind CSS
- Backend: Bun + Express-style routing (OpenWork server)
- Desktop: Tauri 2.x
- SDK: `@opencode-ai/sdk/v2/client` for OpenCode communication
- Analysis and planning in Chinese, code and comments in English
- Commit frequently, keep commits small and clear
- Prefer OpenCode primitives (skills, plugins, MCP, commands) over custom abstractions
- New pages: add to `packages/app/src/app/pages/`, wire in router
- New server routes: add to `packages/server/src/`, register in server setup

## TODO

1. Move document routes from opencode fork to openwork server (`packages/server/src/document.ts`)
2. Add OnlyOffice component to openwork frontend (`packages/app/src/app/components/`)
3. Add document editor page (`packages/app/src/app/pages/`)
4. Publish docx skill to skill hub or bundle as installable skill
5. Build agent hub page — list available agents, route to agent-specific layouts
6. Verify OnlyOffice integration end-to-end
7. Add notify-editor mechanism — AI edit triggers OnlyOffice reload
8. Conflict handling — lock document during AI edit, unlock after
9. Add scheduled task support for agents (e.g., daily report generation)
10. Domain skills — add Layer 2 skills (bid-writing, bug-fixing, etc.)
