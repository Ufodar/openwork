# Document Subagent Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a document-focused orchestrator agent plus internal subagents and a session-scoped document state layer so long document work can be split into structured intermediate artifacts instead of forcing the main agent to repeatedly read raw source files.

**Architecture:** Add a read-oriented `doc-state` MCP overlay to each session runtime, configure a new visible `doc-orchestrator` primary agent and hidden `doc-*` subagents in `opencode.json`, and tighten agent permissions so the orchestrator reads state files while subagents handle source-document ingestion, extraction, merge, planning, writing, and verification. Update OpenWork’s default document-agent routing to prefer `doc-orchestrator`, then validate the flow with server/app tests plus real workspace simulations using complex source documents.

**Tech Stack:** TypeScript, Bun tests, SolidJS, OpenWork server runtime overlays, OpenCode agent configuration, MCP JSON-RPC, Docker dev stack, Chrome MCP.

---

### Task 1: Add the document-state runtime carrier

**Files:**
- Create: `packages/server/src/document-state-mcp.ts`
- Create: `packages/server/src/runtime-document-state-tokens.ts`
- Modify: `packages/server/src/session-workspaces.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/document-state-mcp.test.ts`
- Test: `packages/server/src/session-workspaces.test.ts`
- Test: `packages/server/src/server.proxy-session-create.test.ts`

**Step 1: Write the failing tests**

Add tests that prove:
- session runtime config includes the new `doc-state` MCP and instruction file
- the new MCP exposes only the intended read tools
- tool calls are scoped to the current runtime and only read allowed state files

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts packages/server/src/document-state-mcp.test.ts
```

Expected:
- new `document-state-mcp.test.ts` fails because the file does not exist
- updated runtime overlay assertions fail because `doc-state` has not been injected yet

**Step 3: Write minimal implementation**

Implement:
- a runtime token service parallel to knowledge tokens
- a read-only `doc-state` MCP with tools for:
  - `state_get_brief`
  - `state_list_sources`
  - `state_get_doc`
  - `state_get_facts`
  - `state_get_conflicts`
  - `state_get_plan`
  - `state_get_coverage`
- runtime overlay wiring in `session-workspaces.ts` and route wiring in `server.ts`

**Step 4: Run tests to verify they pass**

Run:

```bash
bun test packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts packages/server/src/document-state-mcp.test.ts
```

Expected:
- all targeted runtime-overlay and MCP tests pass

**Step 5: Commit**

```bash
git add packages/server/src/document-state-mcp.ts packages/server/src/runtime-document-state-tokens.ts packages/server/src/session-workspaces.ts packages/server/src/server.ts packages/server/src/document-state-mcp.test.ts packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts
git commit -m "feat(server): add document state runtime carrier"
```

### Task 2: Define the orchestrator and internal subagents

**Files:**
- Modify: `opencode.json`
- Modify: `opencode.jsonc`
- Create: `.opencode/prompts/doc-orchestrator.txt`
- Create: `.opencode/prompts/doc-intake.txt`
- Create: `.opencode/prompts/doc-reader.txt`
- Create: `.opencode/prompts/doc-merger.txt`
- Create: `.opencode/prompts/doc-planner.txt`
- Create: `.opencode/prompts/doc-writer.txt`
- Create: `.opencode/prompts/doc-verifier.txt`
- Create: `.opencode/references/doc-state-schema.md`

**Step 1: Write the failing tests**

Add tests or assertions that prove:
- `doc-orchestrator` is available as a primary agent
- internal `doc-*` agents are marked as subagents and hidden
- default document-agent routing can resolve to the orchestrator without breaking existing writer routing

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/pages/agents-visibility.test.ts
```

Expected:
- defaults still point to `common-work`
- any new expectations around `doc-orchestrator` fail

**Step 3: Write minimal implementation**

Define:
- `doc-orchestrator` as the user-facing primary agent
- `doc-intake`, `doc-reader`, `doc-merger`, `doc-planner`, `doc-writer`, `doc-verifier` as hidden subagents
- permission rules so:
  - orchestrator can launch `doc-*` tasks and read state, but cannot edit arbitrary files
  - readers can read source documents and only write `.worktree/**` or `reports/**`
  - merger/planner can read state and only write derived state files
  - writer can read state and edit target deliverables
  - verifier can read deliverables and write verification artifacts

**Step 4: Run tests to verify they pass**

Run:

```bash
bun test packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/pages/agents-visibility.test.ts
```

Expected:
- document routing remains stable
- new orchestrator defaults are covered by tests

**Step 5: Commit**

```bash
git add opencode.json opencode.jsonc .opencode/prompts/doc-orchestrator.txt .opencode/prompts/doc-intake.txt .opencode/prompts/doc-reader.txt .opencode/prompts/doc-merger.txt .opencode/prompts/doc-planner.txt .opencode/prompts/doc-writer.txt .opencode/prompts/doc-verifier.txt .opencode/references/doc-state-schema.md packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/pages/agents-visibility.test.ts
git commit -m "feat(agent): add document orchestrator subagents"
```

### Task 3: Update OpenWork document-agent defaults and compatibility paths

**Files:**
- Modify: `packages/app/src/app/lib/session-preferences.ts`
- Modify: `packages/app/src/app/pages/agents-visibility.ts`
- Test: `packages/app/src/app/lib/session-preferences.test.ts`
- Test: `packages/app/src/app/pages/agents-visibility.test.ts`
- Test: `packages/app/src/app/pages/knowledge-surface-wiring.test.ts`

**Step 1: Write the failing tests**

Cover:
- new document-agent sessions default to `doc-orchestrator`
- legacy `common-work` sessions continue to resolve and hydrate correctly
- document-writer view keeps its existing lock and does not switch to the orchestrator

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/pages/agents-visibility.test.ts packages/app/src/app/pages/knowledge-surface-wiring.test.ts
```

Expected:
- new routing expectations fail before implementation

**Step 3: Write minimal implementation**

Update preference resolution and featured launch logic to:
- use `doc-orchestrator` as the default document-agent path
- preserve stored sessions that explicitly choose `common-work` or `document-writer`
- keep the knowledge surface wiring untouched for all document views

**Step 4: Run tests to verify they pass**

Run:

```bash
bun test packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/pages/agents-visibility.test.ts packages/app/src/app/pages/knowledge-surface-wiring.test.ts
```

Expected:
- all targeted app tests pass

**Step 5: Commit**

```bash
git add packages/app/src/app/lib/session-preferences.ts packages/app/src/app/pages/agents-visibility.ts packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/pages/agents-visibility.test.ts packages/app/src/app/pages/knowledge-surface-wiring.test.ts
git commit -m "feat(app): route document sessions through doc orchestrator"
```

### Task 4: Add document-state discovery logic and artifact mapping

**Files:**
- Create: `packages/server/src/document-state.ts`
- Modify: `packages/server/src/document-state-mcp.ts`
- Test: `packages/server/src/document-state.test.ts`
- Test: `packages/server/src/document-state-mcp.test.ts`

**Step 1: Write the failing tests**

Add tests that prove the state layer can discover and normalize:
- `.worktree/index.json`
- `.worktree/sources/**`
- `.worktree/merge/**`
- `.worktree/plan/**`
- `.bid/facts.json`
- `requirements.csv`
- `reports/**`

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/server/src/document-state.test.ts packages/server/src/document-state-mcp.test.ts
```

Expected:
- the new discovery file is missing
- MCP lookups cannot yet resolve normalized state views

**Step 3: Write minimal implementation**

Implement a normalization layer that:
- treats `.worktree` as the main state root
- falls back to `.bid/facts.json`, `requirements.csv`, and `reports/**`
- returns stable structured payloads to the orchestrator regardless of which state files already exist

**Step 4: Run tests to verify they pass**

Run:

```bash
bun test packages/server/src/document-state.test.ts packages/server/src/document-state-mcp.test.ts
```

Expected:
- all document-state tests pass

**Step 5: Commit**

```bash
git add packages/server/src/document-state.ts packages/server/src/document-state-mcp.ts packages/server/src/document-state.test.ts packages/server/src/document-state-mcp.test.ts
git commit -m "feat(server): normalize document state artifacts"
```

### Task 5: Build a realistic simulation and regression harness

**Files:**
- Create: `scripts/doc-subagent-simulate.mjs`
- Create: `docs/plans/2026-03-23-doc-subagent-test-matrix.md`
- Create: `packages/app/pr/doc-subagent-orchestration/`
- Modify: `packages/app/package.json` if a dedicated script is helpful

**Step 1: Write the failing test or harness expectation**

Define a repeatable simulation that:
- creates a session workspace
- loads multiple complex documents from `/Users/storm/Pictures/开发参考文件/标书agent开发相关文件`
- seeds a target document
- sends realistic multi-turn prompts
- checks for expected intermediate artifacts and final reports

**Step 2: Run the harness to verify the baseline fails**

Run:

```bash
node scripts/doc-subagent-simulate.mjs --scenario multi-doc-solution
```

Expected:
- the harness fails before the feature exists or records missing state outputs

**Step 3: Write minimal implementation**

Implement the harness so it can:
- copy test fixtures into an isolated runtime workspace
- drive a session through multiple prompts
- capture produced state files, final artifacts, and screenshots
- emit a compact machine-readable summary for repeated regression runs

**Step 4: Run the harness to verify it passes**

Run:

```bash
node scripts/doc-subagent-simulate.mjs --scenario multi-doc-solution --verify
```

Expected:
- expected `.worktree` state artifacts exist
- orchestrator and subagent outputs are present
- final target/report artifacts are generated

**Step 5: Commit**

```bash
git add scripts/doc-subagent-simulate.mjs docs/plans/2026-03-23-doc-subagent-test-matrix.md packages/app/pr/doc-subagent-orchestration
git commit -m "test: add document subagent simulation harness"
```

### Task 6: Run full verification and end-to-end UI checks

**Files:**
- Modify as needed based on failures from verification
- Capture: `packages/app/pr/doc-subagent-orchestration/*.png`

**Step 1: Build and test server/app changes**

Run:

```bash
bun test packages/server/src/document-state*.test.ts packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts packages/server/src/commands.test.ts
bun test packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/pages/agents-visibility.test.ts packages/app/src/app/pages/knowledge-surface-wiring.test.ts
pnpm --filter openwork-server build
pnpm --filter openwork-server build:bin
pnpm --filter @different-ai/openwork-ui typecheck
pnpm --filter @different-ai/openwork-ui build
```

Expected:
- targeted tests pass
- server binary rebuild succeeds
- UI typecheck and build succeed

**Step 2: Start the OpenWork dev stack**

Run:

```bash
packaging/docker/dev-up.sh
```

Expected:
- Docker dev stack comes up for the worktree

**Step 3: Run browser-based flow verification**

Use Chrome MCP to:
- create or open a document-agent session
- confirm `doc-orchestrator` is the selected default
- run a realistic multi-doc prompt
- inspect produced artifacts and capture screenshots

**Step 4: Run fixture-backed simulation**

Run:

```bash
node scripts/doc-subagent-simulate.mjs --scenario multi-doc-solution --verify
```

Expected:
- pass with captured summary output

**Step 5: Fix issues and rerun until clean**

Repeat targeted edits and verification commands until:
- server tests are green
- app tests are green
- build succeeds
- simulation succeeds
- browser flow is verified with screenshots

**Step 6: Final commit**

```bash
git add .
git commit -m "feat: add document subagent orchestration"
```
