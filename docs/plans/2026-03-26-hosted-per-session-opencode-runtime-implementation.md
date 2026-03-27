# Hosted Per-Session OpenCode Runtime Implementation Plan

**Goal:** Implement hosted per-session OpenCode runtime isolation in OpenWork without modifying OpenCode source.

**Architecture:** Add a server-side runtime manager, persist runtime metadata in session workspace records, route session APIs through session-owned OpenCode processes, and keep hosted-only activation behind an explicit runtime mode flag.

**Tech Stack:** `packages/server`, Bun tests, Node child-process spawning, hosted pod scripts.

---

## Task 1: Persist session runtime metadata

**Files:**
- Modify: `packages/server/src/session-workspaces.ts`
- Modify: `packages/server/src/session-workspaces.test.ts`

**Changes:**
- Extend stored session entries with optional isolated-runtime metadata.
- Keep backward compatibility with existing runtime-dir-only records.
- Add tests that verify the new runtime metadata survives store round-trips.

## Task 2: Add a server-owned session runtime manager

**Files:**
- Create: `packages/server/src/session-opencode-runtime.ts`
- Create: `packages/server/src/session-opencode-runtime.test.ts`

**Changes:**
- Provision session-scoped config/data/state/cache directories.
- Seed host-level OpenCode config and auth state into those directories.
- Spawn `opencode serve` with session-scoped `OPENCODE_CONFIG_DIR` and `XDG_*`.
- Wait for health and expose a session-specific target workspace/base URL.
- Stop and forget runtimes on session deletion.

## Task 3: Route hosted session APIs through isolated runtimes

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/server.proxy-session-create.test.ts`
- Modify: `packages/server/src/server.proxy-session-list.test.ts`
- Modify: `packages/server/src/server.proxy-runtime-control.test.ts`

**Changes:**
- On `POST /session`, create/provision a dedicated runtime before calling OpenCode.
- Persist the isolated runtime metadata after the session id is returned.
- For session-bound routes, resolve the runtime target instead of defaulting to `workspace.baseUrl`.
- Update hosted session listing to aggregate isolated sessions correctly.

## Task 4: Make activity/restart tracking runtime-aware

**Files:**
- Modify: `packages/server/src/session-activity.ts`
- Add/modify tests near runtime maintenance coverage as needed

**Changes:**
- Support per-session SSE subscriptions for isolated runtimes.
- Preserve existing active-session / drain semantics.

## Task 5: Enable hosted rollout and verify

**Files:**
- Modify: `scripts/start-pod.sh`
- Modify: `scripts/restart-pod.sh`
- Modify: research docs under `research/2026-03-25-document-agent-eval/`

**Verification target:**
- `bun test` for the touched server/runtime tests
- a hosted smoke run showing session temp, tool-output, and session routes no longer share OpenCode global state
- update findings/decisions/resolutions/status with the new runtime model and remaining risks
