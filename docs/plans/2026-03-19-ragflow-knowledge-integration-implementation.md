# RAGFlow Knowledge Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a stable `v1` of RAGFlow-backed knowledge in OpenWork where users create and manage personal knowledge bases outside sessions, attach zero or more of them to a session, and let the runtime search only the selected knowledge bases through an OpenWork-owned bridge.

**Architecture:** OpenWork owns knowledge metadata, ownership, attachment scope, and runtime tool wiring. RAGFlow remains the backend parser and retriever. `v1` intentionally excludes session-private hidden knowledge bases and removes frontend pre-retrieval so all knowledge access happens through explicit runtime tool calls.

**Tech Stack:** Bun, TypeScript, SolidJS, OpenWork server routes, file-backed server stores, OpenCode remote MCP integration, RAGFlow HTTP API, Docker dev stack, Chrome MCP.

---

## Preconditions

- Work only in the existing `ragflow` worktree.
- Do not move partial Ragflow work onto `dev` before the `v1` flow is coherent.
- Keep the scope to session-external knowledge bases only.
- Treat `RAGFLOW_BASE_URL` and `RAGFLOW_API_KEY` as server-only secrets.
- Preserve the existing session-scoped MCP bridge model instead of reintroducing frontend pre-retrieval.

### Task 1: Re-baseline the branch around the approved `v1`

**Files:**
- Modify: `docs/plans/2026-03-19-ragflow-knowledge-integration-design.md`
- Modify: `docs/plans/2026-03-19-ragflow-knowledge-integration-implementation.md`
- Test: none

**Step 1: Save the approved stable `v1` design**

Ensure the design document matches these product rules:

- knowledge bases are created outside sessions
- each user can own multiple knowledge bases
- all users share one RAGFlow API key
- OpenWork owns ownership and visibility metadata
- session attachment is optional
- no selection means no retrieval
- no session-private hidden knowledge bases in `v1`
- no frontend pre-retrieval
- default parsing is RAGFlow general parsing with 2000-character chunks

**Step 2: Save the updated implementation plan**

Ensure the plan reflects what is already implemented and focuses only on the remaining `v1` work.

**Step 3: Commit the planning baseline**

```bash
git add docs/plans/2026-03-19-ragflow-knowledge-integration-design.md docs/plans/2026-03-19-ragflow-knowledge-integration-implementation.md
git commit -m "docs: align ragflow plan with stable v1 scope"
```

### Task 2: Finish the server-side knowledge management model

**Files:**
- Modify: `packages/server/src/ragflow.ts`
- Modify: `packages/server/src/ragflow.test.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/types.ts`
- Create: `packages/server/src/server.knowledge-management-routes.test.ts`
- Test: `packages/server/src/ragflow.test.ts`, `packages/server/src/server.knowledge-management-routes.test.ts`

**Step 1: Write the failing management-route tests**

Cover:

- create a knowledge base owned by the current OpenWork user
- use the shared RAGFlow credential to create the backend dataset
- store the resulting `knowledgeId -> ragflowDatasetId` mapping in the registry
- reject invalid create payloads
- upload one or more files into an owned knowledge base
- return knowledge base status after upload

**Step 2: Run the new tests**

Run:

```bash
bun test packages/server/src/server.knowledge-management-routes.test.ts packages/server/src/ragflow.test.ts
```

Expected: FAIL because the management routes and extra RAGFlow client methods are incomplete.

**Step 3: Extend the RAGFlow client**

Add only the `v1` operations needed:

- create dataset
- upload documents into a dataset
- read dataset metadata needed to refresh counts and readiness

Implementation notes:

- do not move ownership into RAGFlow
- use a generated internal dataset name such as `ow_<knowledgeId>`
- keep user-facing titles only in the OpenWork registry
- default the backend config to general parsing with 2000-character chunks unless the caller provided valid RAGFlow-native overrides

**Step 4: Add knowledge management routes**

Add server routes for:

- create knowledge base
- upload files to a knowledge base
- refresh or load knowledge base status

Implementation notes:

- ownership is enforced with `ctx.actor`
- only the owner can upload into a knowledge base in `v1`
- registry status should move through `processing -> ready` or `degraded`
- list routes must keep returning OpenWork registry metadata, not raw RAGFlow names

**Step 5: Re-run server tests**

Run:

```bash
bun test packages/server/src/knowledge-registry.test.ts packages/server/src/knowledge-attachments.test.ts packages/server/src/ragflow.test.ts packages/server/src/server.knowledge-routes.test.ts packages/server/src/server.knowledge-management-routes.test.ts
bunx tsc -p packages/server/tsconfig.json --noEmit
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/server/src/ragflow.ts packages/server/src/ragflow.test.ts packages/server/src/server.ts packages/server/src/types.ts packages/server/src/server.knowledge-management-routes.test.ts
git commit -m "feat: add ragflow knowledge management routes"
```

### Task 3: Add the knowledge management UI outside sessions

**Files:**
- Create: `packages/app/src/app/pages/knowledge.tsx`
- Modify: `packages/app/src/app/app.tsx`
- Modify: `packages/app/src/app/lib/openwork-server.ts`
- Modify: `packages/app/src/i18n/locales/en.ts`
- Modify: `packages/app/src/i18n/locales/zh.ts`
- Create: `packages/app/src/app/pages/knowledge-page.test.ts`
- Test: `packages/app/src/app/pages/knowledge-page.test.ts`

**Step 1: Write the failing UI wiring test**

Cover:

- a dedicated knowledge management page exists outside sessions
- the app can navigate to it
- the page is wired to OpenWork knowledge-management APIs

**Step 2: Run the failing UI test**

Run:

```bash
bun test packages/app/src/app/pages/knowledge-page.test.ts
```

Expected: FAIL because the page and bindings do not exist yet.

**Step 3: Add OpenWork client bindings**

Add browser-side client methods for:

- create knowledge base
- upload files to a knowledge base
- refresh knowledge base status

Mirror the server payloads exactly.

**Step 4: Build the page**

The page should support:

- listing `Mine` and `Others`
- creating a knowledge base
- editing title/description at create time
- selecting RAGFlow-native parsing/chunking options with a safe default
- uploading files
- showing status, document count, and chunk count

`v1` rules:

- default config is general parsing + 2000-character chunks
- do not invent OpenWork-only parsing presets
- do not expose session concepts on this page

**Step 5: Re-run app tests**

Run:

```bash
bun test packages/app/src/app/pages/knowledge-page.test.ts packages/app/src/app/lib/knowledge-selection.test.ts
bunx vite build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/app/src/app/pages/knowledge.tsx packages/app/src/app/app.tsx packages/app/src/app/lib/openwork-server.ts packages/app/src/i18n/locales/en.ts packages/app/src/i18n/locales/zh.ts packages/app/src/app/pages/knowledge-page.test.ts
git commit -m "feat: add knowledge management page"
```

### Task 4: Unify session attachment UI and remove old direct-RAGFlow prompt injection

**Files:**
- Modify: `packages/app/src/app/pages/session.tsx`
- Modify: `packages/app/src/app/pages/document-agent.tsx`
- Modify: `packages/app/src/app/pages/document-writer.tsx`
- Modify: `packages/app/src/app/app.tsx`
- Modify: `packages/app/src/app/lib/openwork-server.ts`
- Delete or stop using: `packages/app/src/app/components/session-knowledge-modal.tsx`
- Delete or stop using: `packages/app/src/app/components/session-knowledge-strip.tsx`
- Delete or stop using: `packages/app/src/app/lib/ragflow-context.ts`
- Delete or stop using: `packages/app/src/app/lib/ragflow-context.test.ts`
- Modify: `packages/app/src/app/pages/knowledge-surface-wiring.test.ts`
- Modify: `packages/app/src/app/lib/session-preferences.ts`
- Modify: `packages/app/src/app/lib/session-preferences.test.ts`
- Test: `packages/app/src/app/pages/knowledge-surface-wiring.test.ts`, `packages/app/src/app/lib/session-preferences.test.ts`

**Step 1: Write or update failing tests for the intended flow**

Cover:

- `session.tsx`, `document-agent.tsx`, and `document-writer.tsx` all use `SessionKnowledgeSurface`
- sending a prompt no longer performs direct frontend RAGFlow retrieval
- session knowledge is no longer stored as legacy direct dataset-selection prompt state

**Step 2: Run the failing tests**

Run:

```bash
bun test packages/app/src/app/pages/knowledge-surface-wiring.test.ts packages/app/src/app/lib/session-preferences.test.ts
```

Expected: FAIL because the old direct-RAGFlow prompt path still exists.

**Step 3: Remove the old path**

Remove or retire:

- `buildSessionRagflowContextText()` prompt injection
- direct prompt-time calls to `retrieveRagflow()`
- legacy modal/strip components that were built around frontend pre-retrieval
- legacy session preferences that store direct dataset retrieval settings rather than session attachment state

**Step 4: Use only the new session attachment model**

Implementation notes:

- all three session surfaces should rely on `SessionKnowledgeSurface`
- attachment changes are saved through `getSessionKnowledge()` and `setSessionKnowledge()`
- no prompt should be mutated by the browser with retrieved chunks

**Step 5: Re-run app tests**

Run:

```bash
bun test packages/app/src/app/pages/knowledge-surface-wiring.test.ts packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/lib/knowledge-selection.test.ts
bunx vite build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/app/src/app/pages/session.tsx packages/app/src/app/pages/document-agent.tsx packages/app/src/app/pages/document-writer.tsx packages/app/src/app/app.tsx packages/app/src/app/lib/openwork-server.ts packages/app/src/app/pages/knowledge-surface-wiring.test.ts packages/app/src/app/lib/session-preferences.ts packages/app/src/app/lib/session-preferences.test.ts
git rm -f packages/app/src/app/components/session-knowledge-modal.tsx packages/app/src/app/components/session-knowledge-strip.tsx packages/app/src/app/lib/ragflow-context.ts packages/app/src/app/lib/ragflow-context.test.ts
git commit -m "refactor: remove legacy frontend ragflow injection"
```

### Task 5: Enforce runtime-side knowledge usage without reintroducing frontend retrieval

**Files:**
- Modify: `packages/server/src/session-workspaces.ts`
- Modify: `packages/server/src/session-workspaces.test.ts`
- Modify: `packages/server/src/knowledge-mcp.ts`
- Modify: `packages/server/src/knowledge-mcp.test.ts`
- Optionally create: `packages/server/src/knowledge-runtime-instructions.ts`
- Test: `packages/server/src/session-workspaces.test.ts`, `packages/server/src/knowledge-mcp.test.ts`

**Step 1: Write the failing enforcement tests**

Cover:

- when a runtime has attached knowledge, the runtime overlay includes a small instruction layer telling the agent to use the OpenWork knowledge tool before answering with grounded claims
- when a runtime has no attached knowledge, no such requirement is injected
- the runtime overlay remains non-destructive and preserves inherited parent config

**Step 2: Run the tests**

Run:

```bash
bun test packages/server/src/session-workspaces.test.ts packages/server/src/knowledge-mcp.test.ts
```

Expected: FAIL because the runtime guidance is not fully enforced yet.

**Step 3: Implement the runtime guidance**

Implementation notes:

- do not enforce retrieval by browser-side prompt mutation
- inject a runtime-local instruction or equivalent overlay alongside the MCP bridge
- the instruction should only apply when the session has attached knowledge
- the agent must still be free to search multiple times, but not to search outside the attached set

**Step 4: Re-run server tests**

Run:

```bash
bun test packages/server/src/runtime-knowledge-tokens.test.ts packages/server/src/knowledge-mcp.test.ts packages/server/src/session-workspaces.test.ts
bun --filter openwork-server build:bin
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server/src/session-workspaces.ts packages/server/src/session-workspaces.test.ts packages/server/src/knowledge-mcp.ts packages/server/src/knowledge-mcp.test.ts
git commit -m "feat: enforce runtime knowledge tool guidance"
```

### Task 6: Validate the full `v1` flow locally

**Files:**
- Create: `packages/app/pr/ragflow-knowledge-library.png`
- Create: `packages/app/pr/ragflow-knowledge-attach.png`
- Create: `packages/app/pr/ragflow-knowledge-tool-timeline.png`
- Test: local stack and browser verification

**Step 1: Start the local stack**

Run:

```bash
packaging/docker/dev-up.sh
```

Expected: OpenWork is reachable locally with the `ragflow` branch code.

**Step 2: Configure local runtime env**

Set:

```bash
export RAGFLOW_BASE_URL="https://172.25.0.149"
export RAGFLOW_API_KEY="..."
```

Expected: OpenWork server reports RAGFlow as configured.

**Step 3: Use Chrome MCP to validate the complete flow**

Verify:

1. open the knowledge management page
2. create a knowledge base for the current user
3. upload at least one file
4. wait until the knowledge base becomes ready
5. open a session with no attached knowledge and confirm no retrieval occurs
6. attach the created knowledge base
7. send a prompt that should require grounded retrieval
8. confirm the tool timeline shows the knowledge tool call
9. confirm the search is scoped to the selected knowledge base only
10. confirm the agent can still use document skills on original files after retrieval narrows the scope

**Step 4: Save screenshots**

Store:

- `packages/app/pr/ragflow-knowledge-library.png`
- `packages/app/pr/ragflow-knowledge-attach.png`
- `packages/app/pr/ragflow-knowledge-tool-timeline.png`

**Step 5: Run the final verification set**

Run:

```bash
bun test packages/server/src/knowledge-registry.test.ts packages/server/src/knowledge-attachments.test.ts packages/server/src/ragflow.test.ts packages/server/src/runtime-knowledge-tokens.test.ts packages/server/src/knowledge-mcp.test.ts packages/server/src/server.knowledge-routes.test.ts packages/server/src/server.knowledge-management-routes.test.ts
bun test packages/app/src/app/pages/knowledge-page.test.ts packages/app/src/app/pages/knowledge-surface-wiring.test.ts packages/app/src/app/lib/knowledge-selection.test.ts packages/app/src/app/lib/session-preferences.test.ts
bunx tsc -p packages/server/tsconfig.json --noEmit
bunx vite build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/app/pr/ragflow-knowledge-library.png packages/app/pr/ragflow-knowledge-attach.png packages/app/pr/ragflow-knowledge-tool-timeline.png
git commit -m "test: verify ragflow stable v1 flow end to end"
```

## Rollout Notes

- Do not merge to `dev` until the knowledge-management flow and session attachment flow are both coherent.
- Do not deploy pod-first.
- Land the server routes and UI flow locally before hosted rollout.
- If runtime MCP enforcement proves incompatible, change only the carrier mechanism; do not change the ownership or attachment model.

## Handoff

Plan complete and saved to `docs/plans/2026-03-19-ragflow-knowledge-integration-implementation.md`.

Two execution options:

1. Subagent-Driven (this session) - use superpowers:subagent-driven-development and implement task-by-task here
2. Parallel Session (separate) - open a fresh session in this worktree and use superpowers:executing-plans
