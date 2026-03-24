# Document State Schema

This workspace uses a document-state layer so the primary document agent can supervise long tasks without repeatedly reopening raw source files.

## Design intent

- Raw source files are not the main session's default memory surface.
- Subagents compile source material into durable state files.
- The primary agent reads state first, then delegates narrow follow-up work.

## Canonical state files

### `.worktree/index.json`

The control-plane summary for the current run.

Recommended fields:
- `version`
- `project`
- `target_doc`
- `phase`
- `summary`
- `current_focus`
- `conventions_ref`
- `children`

### `.worktree/sources/manifest.json`

The source registry for the current workspace.

Recommended fields:
- `generated_at`
- `goal`
- `target_doc`
- `sources`
- `blockers`

Each source entry should prefer:
- `docId`
- `title`
- `relativePath`
- `kind`
- `role`
- `status`

### `.worktree/sources/<doc-id>.json`

The compiled read model for one source document.

Recommended fields:
- `docId`
- `title`
- `relativePath`
- `kind`
- `role`
- `summary`
- `sections`
- `claims`
- `facts`
- `gaps`
- `open_questions`

### `.worktree/facts.json`

The merged canonical fact surface.

Recommended fields:
- `goal`
- `target_doc`
- `canonical_facts`
- `evidence_index`
- `gaps`
- `last_merged_at`

### `.worktree/merge/conflicts.json`

Explicit contradictions and unresolved questions.

Recommended fields:
- `conflicts`
- `open_questions`

### `.worktree/plan/solution-plan.json`

The writer-facing execution plan.

Recommended fields:
- `goal`
- `target_doc`
- `recommended_route`
- `sections`
- `dependencies`
- `required_evidence`
- `open_questions`
- `writer_instructions`

### `.worktree/coverage.json`

The current drafting coverage surface.

Recommended fields:
- `goal`
- `targets`
- `covered`
- `missing`
- `risks`
- `next_checks`

### `.worktree/verify/coverage.json`

The verifier's view of actual coverage and remaining risk.

Recommended fields:
- `checked_at`
- `verified`
- `partial`
- `missing`
- `risks`
- `recommended_next_action`

## Ownership model

- `doc-intake`
  writes `.worktree/index.json`, `.worktree/sources/manifest.json`, `.worktree/conventions.md`
- `doc-reader`
  writes `.worktree/sources/<doc-id>.json`
- `doc-merger`
  writes `.worktree/facts.json`, `.worktree/merge/conflicts.json`
- `doc-planner`
  writes `.worktree/plan/solution-plan.json`, `.worktree/coverage.json`
- `doc-writer`
  writes the target deliverable and refreshes `.worktree/coverage.json`
- `doc-verifier`
  writes `.worktree/verify/coverage.json` and verification reports

## Main-agent operating rule

The primary document agent should prefer:
1. `doc_state_state_get_brief`
2. `doc_state_state_list_sources`
3. `doc_state_state_get_doc`
4. `doc_state_state_get_facts`
5. `doc_state_state_get_conflicts`
6. `doc_state_state_get_plan`
7. `doc_state_state_get_coverage`

Fallback when the MCP tools are unavailable:
- `.worktree/index.json`
- `.worktree/sources/manifest.json`
- `.worktree/facts.json`
- `.worktree/merge/conflicts.json`
- `.worktree/plan/solution-plan.json`
- `.worktree/coverage.json`
- `.worktree/verify/coverage.json`

Primary-agent boundary:
- the main session should not read raw office documents
- the main session should not read `.worktree/sources/*.json`
- source artifacts are for `doc-merger`, not for the main session

Subagent handoff rule:
- subagents should return a compact receipt only
- the durable file artifacts are the source of truth
- long prose recaps are context pollution, not progress
