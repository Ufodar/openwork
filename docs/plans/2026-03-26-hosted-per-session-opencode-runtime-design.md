# Hosted Per-Session OpenCode Runtime Design

**Goal:** Move hosted OpenWork session execution from "shared OpenCode server + per-session working directory" to "per-session OpenCode runtime state", without modifying OpenCode source.

**Architecture:** Keep the existing OpenWork server as the control plane, but let it provision and own a dedicated OpenCode server process for each hosted session. Each runtime keeps its own workspace directory, `OPENCODE_CONFIG_DIR`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME`, so OpenCode global state becomes session-scoped instead of process-shared.

**Tech Stack:** `packages/server`, hosted session workspace store, Node child-process management, per-session runtime metadata, hosted server tests.

---

## Problem

Current hosted isolation only covers:

- session working directory
- mirrored `.opencode` project assets
- workspace-local temp root

It does **not** isolate OpenCode's process-level data plane. As a result:

- `tool-output` lands in shared global data paths
- auth/state/cache/storage can be shared across hosted sessions
- fixing path issues with prompt rules becomes fragile and incomplete

This is the wrong boundary. Session safety should come from runtime ownership, not agent obedience.

## Design

### 1. Per-session OpenCode runtime metadata

Each session workspace record should optionally carry an isolated runtime description:

- runtime root inside the session workspace
- session-scoped `OPENCODE_CONFIG_DIR`
- session-scoped `XDG_DATA_HOME`
- session-scoped `XDG_STATE_HOME`
- session-scoped `XDG_CACHE_HOME`

Ports and PIDs remain process-local and are not treated as durable state.

### 2. Server-owned session runtime manager

`openwork-server` adds a small runtime manager that can:

- provision isolated runtime directories
- seed config/auth state from the host defaults
- spawn `opencode serve` for one session
- wait for health
- reuse the in-memory handle while the process lives
- respawn the runtime on demand after server restarts
- stop the runtime when the session is deleted

This keeps the change inside OpenWork and avoids touching OpenCode source.

### 3. Session routing switches from workspace base URL to session base URL

For session-bound OpenCode routes:

- `POST /session`
- `GET/POST/DELETE /session/:id/...`
- hosted session listing

OpenWork should resolve the session runtime target first. Shared `workspace.baseUrl` becomes a fallback/control-plane default, not the execution path for hosted document sessions.

### 4. Session activity tracking becomes runtime-aware

Active-session tracking should no longer assume one shared `/event` stream per workspace.

Instead:

- shared mode can keep workspace-level SSE
- isolated hosted sessions subscribe to their own runtime SSE stream

This preserves drain/restart correctness after the runtime model changes.

### 5. Scope boundaries

This change should remove most OpenCode-global-state leakage, but it does **not** make the pod a full sandbox:

- file tools still rely on workspace boundaries
- shell commands still run in the shared host environment
- external host directories should not be opened by default

The change is about OpenCode runtime isolation, not full host isolation.

## Rollout

Use an explicit server-side runtime mode flag:

- default safe behavior outside hosted deployments stays unchanged
- hosted pod scripts can opt into isolated session runtimes

This avoids accidentally changing every current OpenWork deployment at once.

## Success Criteria

- Hosted session creation starts a dedicated OpenCode runtime with session-scoped XDG/config dirs.
- Hosted session routes no longer depend on shared OpenCode `tool-output` or other global state.
- Restarting `openwork-server` can rehydrate a session runtime from persisted session metadata.
- `common-work.md` no longer needs to compensate for shared OpenCode runtime state.
