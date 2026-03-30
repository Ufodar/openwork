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
