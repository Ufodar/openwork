# Safe Restart And Hosted OpenCode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver safe-by-default pod restarts, an explicit force restart path, and managed hosted OpenCode binary sourcing without regressing in-flight session stability.

**Architecture:** Put restart coordination in the OpenWork server, let `restart-pod.sh` call that control plane before process shutdown, and move hosted `opencode` off the legacy external default while preserving shared `opencode.json` configuration.

**Tech Stack:** TypeScript (`packages/server`), Bash (`scripts/restart-pod.sh`), Bun tests, server host-token APIs

---

### Task 1: Add failing coverage for drain behavior

**Files:**
- Create: `packages/server/src/server.proxy-runtime-control.test.ts`

**Step 1: Capture the new session creation gate**

Write a test proving that `POST /session` must return a `503` runtime-maintenance error while the server is draining.

**Step 2: Capture the prompt gate**

Write a test proving that `POST /session/:id/prompt_async` must also return a `503` runtime-maintenance error while draining.

**Step 3: Preserve read access**

Write a test proving that read-only session listing still passes through during drain.

### Task 2: Add server runtime-control services

**Files:**
- Create: `packages/server/src/runtime-maintenance.ts`
- Create: `packages/server/src/session-activity.ts`
- Modify: `packages/server/src/server.ts`

**Step 1: Implement maintenance state**

Add a lightweight service that tracks `idle | draining | restarting` plus timestamps and reason text.

**Step 2: Implement active-session tracking**

Track active sessions per workspace from prompt starts plus upstream SSE status transitions.

**Step 3: Wire the proxy gates**

Reject new sessions and new prompts while draining/restarting, but keep read flows working.

### Task 3: Expose host restart-control APIs

**Files:**
- Modify: `packages/server/src/server.ts`

**Step 1: Add runtime status endpoint**

Expose a host-only endpoint that reports:

- maintenance mode
- active session totals
- active session details

**Step 2: Add drain / force control endpoint**

Expose a host-only mutation endpoint that:

- enters drain mode
- enters force restart mode
- best-effort aborts active sessions for the force path

### Task 4: Upgrade `restart-pod.sh`

**Files:**
- Modify: `scripts/restart-pod.sh`

**Step 1: Add restart modes**

Support:

- default safe restart
- `--force`
- `--help`

**Step 2: Negotiate with the running server**

Before killing processes:

- call the drain endpoint by default
- poll until active sessions are `0`
- time out safely instead of silently forcing

**Step 3: Support legacy rollout fallback**

If the old server does not yet expose the new API, log that this is a legacy restart and proceed with the current disruptive behavior.

### Task 5: Stop defaulting hosted OpenCode to legacy external

**Files:**
- Modify: `scripts/restart-pod.sh`
- Modify: `scripts/start-pod.sh` only if comments/env handling need clarification

**Step 1: Normalize the hosted OpenCode source**

Make hosted restarts prefer a managed OpenCode source (`downloaded`) instead of `external`.

**Step 2: Preserve shared config**

Keep `~/.config/opencode/opencode.json` intact and continue syncing it from runtime env.

**Step 3: Guard against legacy env pins**

Do not let old `OPENWORK_OPENCODE_SOURCE=external` / `OPENWORK_OPENCODE_BIN=...` values silently override the new hosted default unless the operator explicitly opts back in.

### Task 6: Verify the result

**Files:**
- Test: `packages/server/src/server.proxy-runtime-control.test.ts`
- Test: `packages/server/src/**/*.ts`
- Test: `scripts/restart-pod.sh`

**Step 1: Run focused server tests**

Run:

```bash
bun test packages/server/src/server.proxy-runtime-control.test.ts
```

Expected: drain gating tests pass.

**Step 2: Run a broader server regression slice**

Run:

```bash
bun test packages/server/src
```

Expected: existing server tests stay green.

**Step 3: Validate shell syntax**

Run:

```bash
bash -n scripts/restart-pod.sh
```

Expected: no output, exit `0`.
