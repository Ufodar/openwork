# Document Agent Office Routing Design

## Goal

Clarify where document-task guardrails belong so the `document-agent` entrypoint handles Office/PDF files more reliably without overloading agent prompts or duplicating skill internals.

## Current Problem

The current split is incomplete:

- `document-agent` often runs `common-work`, not `document-writer`.
- `document-writer` already contains useful file-type routing, but that guidance does not automatically protect the default `document-agent` path.
- Skills like `docx`, `xlsx`, `pptx`, and `pdf` contain format-specific procedures, but the agent layer does not consistently force the model to choose them before using raw tools.
- This leaves avoidable failure modes at the entry layer: invented file names, `read` against binary Office files, and missing preflight checks for external commands.

## Chosen Design

### 1. Keep routing policy at the agent layer

Agent docs should answer:

- Which class of task is this?
- Which file-type skill should be loaded first?
- Which raw tool usage is disallowed or discouraged?
- When should the agent switch methods after repeated failure?

This belongs in:

- `common-work.md` for document-wide baseline behavior
- `document-writer.md` for bid-domain routing and stronger file-type guidance
- `bid-analysis/SKILL.md` for the earliest tender-analysis phase

### 2. Keep file-format procedures in the skill layer

Skill docs should continue to own the detailed how:

- `.docx` extraction/editing/validation in `docx`
- `.xlsx` recalculation and spreadsheet integrity in `xlsx`
- `.pptx` extraction/editing/QA in `pptx`
- `.pdf` extraction/form handling in `pdf`

The agent layer should point to these skills conditionally, not restate their internals.

### 3. Add a thin Office/PDF baseline before domain-specific routing

The baseline should require:

- use the file-type skill that matches the current target file
- avoid direct `read` on binary Office files
- reuse exact paths returned by `ls` / `find` / `glob` instead of rewriting filenames
- preflight external commands before taking a dependency on them
- change method after two failures on the same path or tool

This baseline is intentionally small so it remains compatible with future plugins such as `claude-mem`, `task-master-ai`, or superpower-style planners. Those plugins can improve memory and task orchestration, but they should not replace deterministic Office/PDF routing rules.

## Rejected Alternative

### Put everything in `document-writer.md`

Rejected because the `document-agent` UI often resolves to `common-work`, so this would miss the default path.

### Create a new shared Office baseline skill now

Rejected for now because the immediate need is to fix routing gaps with minimal surface area. A shared skill may still make sense later if the same guardrails need to be reused outside bid/document flows.

## Success Criteria

- `common-work` establishes a reliable Office/PDF baseline for the default document-agent path.
- `document-writer` makes conditional skill loading explicit without forcing all Office skills into every task.
- `bid-analysis` steers first-pass tender analysis away from filename drift and binary misuse.
- The updated guidance remains small enough to coexist cleanly with future planning/memory plugins.
