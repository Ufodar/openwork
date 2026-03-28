# Document-Writer Single-Controller Design

> For Claude: this design intentionally collapses the writer flow to one active main agent. `document-writer` remains the only user-facing controller. `doc-*` agents remain specialized children.

**Goal:** Remove the double-main-agent shape so `document-writer` stays simpler, more predictable, and no weaker than `common-work` due to prompt drift or over-orchestration.

**Why now:** The current repo registers both `document-writer` and `doc-orchestrator` as primary agents. They overlap heavily, are not auto-composed by OpenCode, and create a real risk of policy drift and unnecessary complexity.

## Decision

- Keep `document-writer` as the only active main agent for the writer flow.
- Keep `doc-intake`, `doc-reader`, `doc-merger`, `doc-planner`, `doc-writer`, and `doc-verifier` as the subagent workflow.
- Remove `doc-orchestrator` from active agent registration in `opencode.json` and `opencode.jsonc`.
- Move any still-useful orchestration rules into `document-writer.md`.
- Remove or de-activate repository references that still treat `doc-orchestrator` as the live main agent.

## Boundary

`document-writer` should be orchestrator-first, not orchestrator-only.

Allowed:
- read durable state
- launch narrow `doc-*` tasks
- inspect compact receipts
- do small supervisory reads of verifier reports or narrow deliverable excerpts when phase health is unclear

Not allowed:
- full raw-corpus analysis in the main session
- direct drafting of the final deliverable in the main session
- bypassing the `doc-*` workflow with unrelated agents or skills

## Why this is better

- One source of truth for the writer control loop
- Fewer chances for `document-writer.md` and `doc-orchestrator.md` to diverge
- Less risk that the writer path becomes more fragile than `common-work`
- Keeps the intended architecture: one controller, many narrow workers, durable state, minimal context pollution

## Expected repo changes

- Modify:
  - `opencode.json`
  - `opencode.jsonc`
  - `.opencode/agent/document-writer.md`
  - `packages/app/scripts/doc-subagent-prompts.test.mjs`
  - `packages/app/scripts/doc-subagent-simulate.mjs`
  - `research/2026-03-25-document-agent-eval/common-work-document-writer-execution-ledger-2026-03-27.md`
- Review and likely update:
  - `.opencode/prompts/doc-orchestrator.md`
  - `packages/app/scripts/doc-agent-live-compare.mjs`

## Verification focus

- `document-writer` remains launchable from the app and config
- no runtime/test path still depends on `doc-orchestrator` as the active main agent
- prompt tests still validate the orchestration contract, but against `document-writer`
- no change leaks into `common-work`
