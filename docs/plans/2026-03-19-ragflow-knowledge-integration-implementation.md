# RAGFlow Knowledge Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Phase 1 knowledge-base usage to OpenWork so users can attach zero or more knowledge bases to a session, and agents can search them on demand through an OpenWork-owned tool bridge backed by RAGFlow HTTP APIs.

**Architecture:** OpenWork owns the knowledge registry, session attachment state, runtime-scoped knowledge auth, and the agent-facing tool surface. RAGFlow remains the ingestion and retrieval backend. The preferred runtime carrier is an OpenWork-served remote MCP endpoint scoped by a short-lived runtime token; if that carrier proves incompatible with OpenCode runtime behavior, fall back immediately to a local wrapper without changing the product model.

**Tech Stack:** Bun, TypeScript, SolidJS, OpenWork server routes, OpenCode remote MCP integration, RAGFlow HTTP API, Docker dev stack, Chrome MCP for end-to-end verification.

---

## Preconditions

- Sync the repo to the latest remote head.
- Create a dedicated worktree before implementation.
- Do not implement against the pod first.
- Keep Phase 1 scoped to session attachment and tool usage only.

### Task 1: Prepare the isolated implementation branch and baseline

**Files:**
- Create: `docs/plans/2026-03-19-ragflow-knowledge-integration-design.md`
- Create: `docs/plans/2026-03-19-ragflow-knowledge-integration-implementation.md`
- Modify: none
- Test: none

**Step 1: Sync the repository and create a dedicated worktree**

Run:

```bash
git fetch --all --prune
git worktree add ../openwork-ragflow-kb codex/ragflow-knowledge-phase1
```

Expected: a clean dedicated worktree exists at `../openwork-ragflow-kb`.

**Step 2: Verify the baseline server and app tests before feature work**

Run:

```bash
bun test packages/server/src/auth.test.ts packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-runtime-control.test.ts
bun test packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/lib/tool-part-status.test.ts
```

Expected: existing tests pass before new work starts.

**Step 3: Start the Docker dev stack once in the new worktree**

Run:

```bash
packaging/docker/dev-up.sh
```

Expected: the local OpenWork stack is healthy and reachable for later Chrome MCP validation.

**Step 4: Commit the planning baseline**

```bash
git add docs/plans/2026-03-19-ragflow-knowledge-integration-design.md docs/plans/2026-03-19-ragflow-knowledge-integration-implementation.md
git commit -m "docs: add ragflow knowledge integration design and plan"
```

### Task 2: Add server-side persistence for knowledge registry and session attachments

**Files:**
- Create: `packages/server/src/knowledge-registry.ts`
- Create: `packages/server/src/knowledge-registry.test.ts`
- Create: `packages/server/src/knowledge-attachments.ts`
- Create: `packages/server/src/knowledge-attachments.test.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/knowledge-registry.test.ts`, `packages/server/src/knowledge-attachments.test.ts`

**Step 1: Write the failing registry tests**

```ts
test("stores knowledge bases with owner metadata and stable ids", async () => {
  const registry = new KnowledgeRegistryService(tmpRoot);
  const created = await registry.upsert({
    knowledgeId: "kb_1",
    ragflowDatasetId: "ds_1",
    ownerUserId: "user_1",
    ownerDisplayName: "alice",
    title: "招标知识库",
    visibility: "visible_to_all_users",
    status: "ready",
  });
  expect(created.ownerUserId).toBe("user_1");
  expect((await registry.listMine("user_1")).length).toBe(1);
});
```

**Step 2: Run the registry test to confirm failure**

Run:

```bash
bun test packages/server/src/knowledge-registry.test.ts
```

Expected: FAIL because the service does not exist yet.

**Step 3: Implement the minimal registry service**

Implementation notes:

- follow the same file-backed pattern as [auth.ts](/Users/storm/Documents/code/studyProject/opencode-docx/openwork-ragflow-knowledge-phase1/packages/server/src/auth.ts) and [session-workspaces.ts](/Users/storm/Documents/code/studyProject/opencode-docx/openwork-ragflow-knowledge-phase1/packages/server/src/session-workspaces.ts)
- store the registry under the OpenWork server data dir, not inside session runtime directories
- include owner metadata and raw parser settings in the record shape from day one

**Step 4: Write the failing attachment-store tests**

```ts
test("starts empty for a new session and replaces the attached set on save", async () => {
  const store = new KnowledgeAttachmentService(tmpRoot);
  expect(await store.get("ws_1", "ses_1")).toEqual([]);
  await store.set("ws_1", "ses_1", "rt_1", ["kb_a", "kb_b"]);
  expect(await store.get("ws_1", "ses_1")).toEqual(["kb_a", "kb_b"]);
});
```

**Step 5: Run the attachment test to confirm failure**

Run:

```bash
bun test packages/server/src/knowledge-attachments.test.ts
```

Expected: FAIL because the service does not exist yet.

**Step 6: Implement the minimal attachment store**

Implementation notes:

- key by `workspaceId + sessionId`
- persist `runtimeId` alongside `knowledgeIds`
- keep this separate from the registry

**Step 7: Add server wiring only for construction and cleanup**

Implementation notes:

- initialize both services inside [server.ts](/Users/storm/Documents/code/studyProject/opencode-docx/openwork-ragflow-knowledge-phase1/packages/server/src/server.ts)
- ensure session deletion also removes its attachment entry

**Step 8: Run the new tests**

Run:

```bash
bun test packages/server/src/knowledge-registry.test.ts packages/server/src/knowledge-attachments.test.ts
```

Expected: PASS.

**Step 9: Commit**

```bash
git add packages/server/src/knowledge-registry.ts packages/server/src/knowledge-registry.test.ts packages/server/src/knowledge-attachments.ts packages/server/src/knowledge-attachments.test.ts packages/server/src/server.ts
git commit -m "feat: add knowledge registry and attachment stores"
```

### Task 3: Add the RAGFlow HTTP client and OpenWork knowledge APIs

**Files:**
- Create: `packages/server/src/ragflow.ts`
- Create: `packages/server/src/ragflow.test.ts`
- Create: `packages/server/src/server.knowledge-routes.test.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/types.ts`
- Test: `packages/server/src/ragflow.test.ts`, `packages/server/src/server.knowledge-routes.test.ts`

**Step 1: Write the failing RAGFlow client tests**

```ts
test("search sends explicit dataset_ids and never relies on backend fallback", async () => {
  const calls: unknown[] = [];
  const client = createRagflowClient({
    baseUrl: "http://ragflow.local",
    apiKey: "test",
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ code: 0, data: { chunks: [] } }), { status: 200 });
    },
  });
  await client.retrieve({ question: "test", datasetIds: ["ds_1"] });
  expect((calls[0] as any).dataset_ids).toEqual(["ds_1"]);
});
```

**Step 2: Run the RAGFlow client test**

Run:

```bash
bun test packages/server/src/ragflow.test.ts
```

Expected: FAIL.

**Step 3: Implement the minimal RAGFlow client**

Implementation notes:

- wrap dataset list and retrieval only for Phase 1
- read service credentials from server config or env, never from the browser
- normalize backend responses into OpenWork-shaped records

**Step 4: Write the failing route tests**

Cover:

- `GET /workspace/:id/knowledge?scope=mine`
- `GET /workspace/:id/knowledge?scope=others`
- `PUT /workspace/:id/sessions/:sessionId/knowledge`
- `POST /workspace/:id/knowledge/search`
- `knowledge_search` rejects empty attachment state with `no_attached_knowledge`
- explicit `knowledge_ids` must be a subset of the session attachment set

**Step 5: Run the route tests**

Run:

```bash
bun test packages/server/src/server.knowledge-routes.test.ts
```

Expected: FAIL.

**Step 6: Implement the server routes**

Implementation notes:

- authorize using `ctx.actor`, not frontend trust
- `mine` means `ownerUserId === caller.id`
- `others` means `ownerUserId !== caller.id`
- search must translate `knowledgeIds` to `ragflowDatasetId`s before calling RAGFlow
- search must return registry title and owner metadata, not raw backend names

**Step 7: Run all server knowledge tests**

Run:

```bash
bun test packages/server/src/ragflow.test.ts packages/server/src/server.knowledge-routes.test.ts packages/server/src/knowledge-registry.test.ts packages/server/src/knowledge-attachments.test.ts
bunx tsc -p packages/server/tsconfig.json --noEmit
```

Expected: PASS.

**Step 8: Commit**

```bash
git add packages/server/src/ragflow.ts packages/server/src/ragflow.test.ts packages/server/src/server.knowledge-routes.test.ts packages/server/src/server.ts packages/server/src/types.ts
git commit -m "feat: add knowledge routes backed by ragflow http api"
```

### Task 4: Add runtime-scoped knowledge auth and prove the MCP carrier

**Files:**
- Create: `packages/server/src/runtime-knowledge-tokens.ts`
- Create: `packages/server/src/runtime-knowledge-tokens.test.ts`
- Create: `packages/server/src/knowledge-mcp.ts`
- Create: `packages/server/src/knowledge-mcp.test.ts`
- Create: `packages/app/scripts/knowledge-runtime-carrier.mjs`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/session-workspaces.ts`
- Test: `packages/server/src/runtime-knowledge-tokens.test.ts`, `packages/server/src/knowledge-mcp.test.ts`

**Step 1: Write the failing runtime-token tests**

```ts
test("issues a read-only runtime token bound to one runtime id", async () => {
  const tokens = new RuntimeKnowledgeTokenService(tmpRoot);
  const issued = await tokens.issue({ workspaceId: "ws_1", sessionId: "ses_1", runtimeId: "rt_1" });
  const resolved = await tokens.resolve(issued.token);
  expect(resolved?.runtimeId).toBe("rt_1");
});
```

**Step 2: Run the token test**

Run:

```bash
bun test packages/server/src/runtime-knowledge-tokens.test.ts
```

Expected: FAIL.

**Step 3: Implement runtime token issuance and lookup**

Implementation notes:

- tokens must be short-lived
- tokens must only authorize knowledge operations for one runtime
- do not reuse the main client or host tokens

**Step 4: Write the failing MCP endpoint tests**

Cover:

- MCP `tools/list` exposes only the knowledge tools
- knowledge MCP requests authorized by a runtime token resolve attachment scope from runtime id
- `knowledge_search` without attachments returns `no_attached_knowledge`

**Step 5: Run the MCP endpoint test**

Run:

```bash
bun test packages/server/src/knowledge-mcp.test.ts
```

Expected: FAIL.

**Step 6: Implement the preferred carrier**

Implementation notes:

- implement an OpenWork-served remote MCP endpoint in [knowledge-mcp.ts](/Users/storm/Documents/code/studyProject/opencode-docx/openwork-ragflow-knowledge-phase1/packages/server/src/knowledge-mcp.ts)
- runtime provisioning writes a session-local MCP overlay that points to this endpoint with the short-lived runtime token
- keep the overlay non-destructive so parent workspace skills/MCPs remain available

**Step 7: Prove the carrier with a smoke script before touching UI**

Run:

```bash
node packages/app/scripts/knowledge-runtime-carrier.mjs
```

Expected:

- the child runtime sees the knowledge MCP
- inherited parent workspace behavior still works
- the carrier can call `knowledge_list_attached`

**Step 8: Stop-loss gate**

If the smoke script shows that remote MCP overlay breaks inherited config or does not load in OpenCode runtime:

- do not continue layering UI work
- switch the carrier only, not the product model
- implement the fallback local wrapper command using the same runtime token and server endpoints

**Step 9: Rebuild the compiled server binary**

Run:

```bash
bun --filter openwork-server build:bin
bun test packages/server/src/runtime-knowledge-tokens.test.ts packages/server/src/knowledge-mcp.test.ts
```

Expected: PASS.

**Step 10: Commit**

```bash
git add packages/server/src/runtime-knowledge-tokens.ts packages/server/src/runtime-knowledge-tokens.test.ts packages/server/src/knowledge-mcp.ts packages/server/src/knowledge-mcp.test.ts packages/app/scripts/knowledge-runtime-carrier.mjs packages/server/src/server.ts packages/server/src/session-workspaces.ts
git commit -m "feat: add runtime-scoped knowledge mcp bridge"
```

### Task 5: Add the session knowledge UI and client bindings

**Files:**
- Create: `packages/app/src/app/components/session/knowledge-strip.tsx`
- Create: `packages/app/src/app/components/session/knowledge-picker-modal.tsx`
- Create: `packages/app/src/app/lib/knowledge-selection.ts`
- Create: `packages/app/src/app/lib/knowledge-selection.test.ts`
- Modify: `packages/app/src/app/lib/openwork-server.ts`
- Modify: `packages/app/src/app/pages/session.tsx`
- Modify: `packages/app/src/i18n/locales/en.ts`
- Modify: `packages/app/src/i18n/locales/zh.ts`
- Test: `packages/app/src/app/lib/knowledge-selection.test.ts`

**Step 1: Write the failing selection-state tests**

```ts
test("starts empty and replaces the attached set on save", () => {
  const state = reduceKnowledgeSelection([], [{ id: "kb_1", checked: true }]);
  expect(state).toEqual(["kb_1"]);
});
```

**Step 2: Run the app test**

Run:

```bash
bun test packages/app/src/app/lib/knowledge-selection.test.ts
```

Expected: FAIL.

**Step 3: Add OpenWork server client bindings**

Implementation notes:

- add list knowledge, get session attachment, set session attachment, and search preview helpers to [openwork-server.ts](/Users/storm/Documents/code/studyProject/opencode-docx/openwork-ragflow-knowledge-phase1/packages/app/src/app/lib/openwork-server.ts)
- mirror the route payloads from Task 3 exactly

**Step 4: Implement the picker and strip UI**

Implementation notes:

- default to `Mine`
- allow switch to flat `Others`
- show owner inline for `Others`
- load lazily only after the user opens the picker
- disable editing while a run is active
- show an explicit empty state when nothing is attached

**Step 5: Wire the UI into the session page**

Implementation notes:

- integrate the strip and modal into [session.tsx](/Users/storm/Documents/code/studyProject/opencode-docx/openwork-ragflow-knowledge-phase1/packages/app/src/app/pages/session.tsx)
- keep current composer and send flow unchanged
- do not do pre-send retrieval

**Step 6: Run app verification**

Run:

```bash
bun test packages/app/src/app/lib/knowledge-selection.test.ts
bunx vite build
```

Expected: PASS.

**Step 7: Commit**

```bash
git add packages/app/src/app/components/session/knowledge-strip.tsx packages/app/src/app/components/session/knowledge-picker-modal.tsx packages/app/src/app/lib/knowledge-selection.ts packages/app/src/app/lib/knowledge-selection.test.ts packages/app/src/app/lib/openwork-server.ts packages/app/src/app/pages/session.tsx packages/app/src/i18n/locales/en.ts packages/app/src/i18n/locales/zh.ts
git commit -m "feat: add session knowledge selection ui"
```

### Task 6: Run end-to-end verification in Docker and Chrome MCP

**Files:**
- Create: `packages/app/pr/ragflow-knowledge-picker.png`
- Create: `packages/app/pr/ragflow-knowledge-attached-strip.png`
- Create: `packages/app/pr/ragflow-knowledge-tool-timeline.png`
- Modify: optional notes if needed in `packages/app/pr/`
- Test: Docker stack + Chrome MCP flow

**Step 1: Rebuild and start the full dev stack**

Run:

```bash
packaging/docker/dev-up.sh
```

Expected: the local stack restarts on the new implementation.

**Step 2: Use Chrome MCP to verify the complete Phase 1 flow**

Verify:

1. login and open a session
2. open the knowledge picker
3. confirm the initial state is empty
4. confirm `Mine` loads first
5. switch to `Others` and confirm owner labels appear
6. attach at least one knowledge base
7. send a prompt that causes the agent to use the knowledge tool
8. confirm the tool timeline shows a knowledge tool call rather than pre-send context injection
9. change the attached set after the run completes
10. confirm the second run uses the updated set

**Step 3: Save screenshots**

Store screenshots under:

- `packages/app/pr/ragflow-knowledge-picker.png`
- `packages/app/pr/ragflow-knowledge-attached-strip.png`
- `packages/app/pr/ragflow-knowledge-tool-timeline.png`

**Step 4: Run the final verification set**

Run:

```bash
bun test packages/server/src/knowledge-registry.test.ts packages/server/src/knowledge-attachments.test.ts packages/server/src/ragflow.test.ts packages/server/src/runtime-knowledge-tokens.test.ts packages/server/src/knowledge-mcp.test.ts packages/server/src/server.knowledge-routes.test.ts
bun test packages/app/src/app/lib/knowledge-selection.test.ts
bunx tsc -p packages/server/tsconfig.json --noEmit
bunx vite build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/app/pr/ragflow-knowledge-picker.png packages/app/pr/ragflow-knowledge-attached-strip.png packages/app/pr/ragflow-knowledge-tool-timeline.png
git commit -m "test: verify ragflow knowledge session flow end to end"
```

## Rollout Notes

- Do not start with pod deployment.
- Land the feature behind clean server and UI tests first.
- Validate the remote MCP carrier locally before any hosted rollout.
- If the remote MCP carrier fails, switch carriers without changing the registry, attachment, or UI model.

## Handoff

Plan complete and saved to `docs/plans/2026-03-19-ragflow-knowledge-integration-implementation.md`.

Two execution options:

1. Subagent-Driven (this session) - use superpowers:subagent-driven-development and implement task-by-task here
2. Parallel Session (separate) - open a fresh session in the dedicated worktree and use superpowers:executing-plans
