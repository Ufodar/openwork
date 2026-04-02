# OpenWork Server Connection Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make OpenWork recover cleanly from transient server disconnects without requiring page changes or manual reloads.

**Architecture:** Collapse connection state into one frontend source of truth, route action-level health checks through a shared reconnect gate, and let document pages perform a single reconnect-triggered rehydrate instead of treating disconnects as sticky page errors. Keep the backend unchanged; this is a frontend state-machine cleanup.

**Tech Stack:** SolidJS signals/effects, OpenWork server client, Bun tests.

---

## Task 1: Establish one connection state owner

**Files:**
- Modify: `packages/app/src/app/app.tsx`
- Modify: `packages/app/src/app/context/openwork-server.ts`
- Modify: `packages/app/src/app/lib/openwork-server-status.ts`
- Test: `packages/app/src/app/lib/openwork-server-status.test.ts`

**Changes:**
- Stop maintaining a duplicate OpenWork server poller in `app.tsx`.
- Promote `createOpenworkServerStore()` to the only owner of:
  - status
  - capabilities
  - checkedAt
  - disconnect streak / probe reconciliation
  - reconnect busy flag
- Keep `app.tsx` as a consumer of the store instead of a second implementation.
- Preserve the existing transient-failure tolerance:
  - one failed probe may keep prior `connected/limited`
  - repeated failures transition to `disconnected`

**Design constraints:**
- Do not change backend APIs.
- Do not remove `limited` as a first-class state.
- Keep polling paused when the document is hidden.

**Main risks to cover:**
- status drift between `app.tsx` and `context/openwork-server.ts`
- reconnect logic silently diverging in future edits
- reconnect UI showing stale “busy” state because multiple owners exist

**Verification:**
- `bun test packages/app/src/app/lib/openwork-server-status.test.ts`
- A new focused test if needed for the store-level transition semantics

## Task 2: Add a shared action-level reconnect gate

**Files:**
- Create: `packages/app/src/app/lib/openwork-server-action.ts`
- Create: `packages/app/src/app/lib/openwork-server-action.test.ts`
- Modify: `packages/app/src/app/app.tsx`
- Modify: `packages/app/src/app/context/session.ts`

**Changes:**
- Add one helper that front-end actions must call before throwing “connection lost”.
- The helper should:
  - inspect the shared connection state
  - optionally run one foreground reconnect attempt
  - return a typed result instead of throwing generic UI text
- Distinguish these outcomes:
  - `ready`
  - `disconnected`
  - `limited`
  - `workspace_unavailable`
  - `reconnect_failed`

**Design constraints:**
- No direct `setError("服务器连接已断开…")` from action code paths.
- No repeated reconnect loops from multiple call sites.
- One action may request one foreground reconnect; failures then surface as action-level results.

**Call sites to convert first:**
- session creation in `app.tsx`
- session selection/hydration in `context/session.ts`

**Main risks to cover:**
- duplicate reconnect storms if multiple actions all call reconnect simultaneously
- masking real auth failure as network failure
- turning a slow action into a long blocking reconnect chain

**Verification:**
- `bun test packages/app/src/app/lib/openwork-server-action.test.ts`
- targeted tests covering:
  - already connected
  - limited/token missing
  - transient disconnect recovered by reconnect
  - reconnect failure returns typed failure, not sticky UI error

## Task 3: Replace sticky page errors with recoverable action results

**Files:**
- Modify: `packages/app/src/app/app.tsx`
- Modify: `packages/app/src/app/context/session.ts`
- Modify: `packages/app/src/app/system-state.ts` if shared error plumbing must distinguish connection-status vs action failure

**Changes:**
- Stop turning transient health failures into long-lived global page errors.
- Keep global `error` for durable failures that require user intervention.
- Represent transient server-loss failures as recoverable action feedback:
  - create-session failed because reconnect failed
  - session hydrate delayed because server unavailable
- Clear action-scoped connection failures automatically once the shared connection state returns to `connected/limited`.

**Design constraints:**
- Do not hide real server outages.
- Do not suppress backend error text unrelated to connection state.
- Do not make all connection problems invisible; they must still appear in status/UI surfaces.

**Main risks to cover:**
- stale error banners surviving after reconnect
- clearing unrelated user-facing errors by mistake
- mixing “server disconnected” with “invalid token” or “workspace missing”

**Verification:**
- existing relevant app/session tests
- add focused assertions only where current sticky-error behavior is explicitly changed

## Task 4: Add reconnect-triggered document page recovery

**Files:**
- Modify: `packages/app/src/app/pages/document-agent.tsx`
- Modify: `packages/app/src/app/pages/document-writer.tsx`
- Create if useful: `packages/app/src/app/lib/document-session-recovery.ts`
- Test: a small wiring test near the page-level session recovery area

**Changes:**
- Watch for `openworkServerStatus` transitions:
  - `disconnected -> connected`
  - `limited -> connected` when a token becomes usable
- On transition, trigger one lightweight rehydrate for the active session:
  - session info if needed
  - messages
  - todos
  - document list
- Keep the refresh deduped:
  - at most one reconnect recovery per session/status transition
  - no infinite loop if one follow-up request fails

**Design constraints:**
- No full page reload.
- No repeated background hammering.
- Recovery must not clobber in-flight normal loading if the page is already hydrating.

**Main risks to cover:**
- duplicate fetches racing with normal route hydration
- reconnect while the selected session changed
- document pages showing “server not connected” forever even after `connected`

**Verification:**
- reuse existing document-session hydration tests where possible
- add one focused test for “reconnect triggers a single rehydrate”

## Task 5: Unify manual reconnect and automatic reconnect surfaces

**Files:**
- Modify: `packages/app/src/app/app.tsx`
- Modify: `packages/app/src/app/pages/settings.tsx`
- Modify: `packages/app/src/app/pages/identities.tsx`
- Modify: `packages/app/src/app/components/status-bar.tsx` if status copy changes

**Changes:**
- Make settings/identities manual reconnect use the same shared reconnect entry point as action code.
- Ensure the status bar and document pages observe the same state source.
- Keep manual reconnect as an explicit user action, but do not let it diverge from automatic recovery behavior.

**Design constraints:**
- No second reconnect implementation.
- Manual reconnect should improve diagnostics, not alter state semantics.

**Main risks to cover:**
- manual reconnect fixing states that automatic reconnect cannot
- status bar showing connected while document pages still consider the server unavailable

**Verification:**
- targeted smoke checks in settings/identities if existing tests are absent

## Task 6: Regression sweep for affected flows

**Files:**
- Reuse touched tests above
- Add minimal new tests only where behavior changes are not already covered

**Flows to verify:**
- create a new session during a transient disconnect
- recover an already-open document session after the server comes back
- distinguish `limited` from `disconnected`
- keep scheduled-jobs remote loading and status-bar behavior aligned with the unified state source

**Run:**
- `bun test packages/app/src/app/lib/openwork-server-status.test.ts`
- `bun test packages/app/src/app/lib/openwork-server-action.test.ts`
- `bun test packages/app/src/app/context/session.runtime-directory-hydration.test.ts`
- page-level wiring tests for document-agent/document-writer recovery
- `git diff --check` for touched files

## Non-Goals

- No backend retry or health-route changes
- No session/workspace routing redesign
- No document-agent prompt or runtime changes
- No broad refactor of unrelated error handling outside OpenWork server connectivity

## Expected Outcome

After this work:
- a transient server loss no longer leaves the current document page in a dead state
- page changes are no longer required just to recover from a short disconnect
- action code does not invent its own connection semantics
- `connected`, `limited`, and `disconnected` have one shared meaning across the app
