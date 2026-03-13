# Document Mode Bridge Design

**Goal:** Add a very small OpenCode plugin layer that improves default behavior for document-heavy workspaces without forking `superpowers` or `task-master-ai`.

**Problem:** The current system can discover many useful skills, but in default non-slash usage it still relies too much on the model to infer which document skills should be primary, which should be companion skills, and what information must survive compaction in long-running tasks.

## Why a bridge instead of editing third-party packages

- `superpowers` already gives strong process discipline, but its bootstrap is generic and code-heavy in parts.
- `task-master-ai` is strongest at task graph orchestration, but it is heavier than the current problem demands.
- The highest-leverage gap is not missing tools; it is missing document-first orchestration for default sessions.

## Approach

Implement one thin plugin:

- Hook `experimental.chat.system.transform`
  - Detect whether the current workspace is document-heavy
  - Inject compact document-mode routing guidance
- Hook `experimental.session.compacting`
  - Force continuation summaries to preserve target document, canonical filenames, active skill composition, state files, blockers, and next action

## Design constraints

- Do not modify or fork the `superpowers` repository
- Do not modify `task-master-ai`
- Do not inject document guidance for clearly code-heavy workspaces
- Keep the bridge heuristic conservative so coding sessions are not polluted
- Reuse existing workspace state files rather than inventing a second memory layer

## Detection heuristic

Treat a workspace as document-heavy when:

- it contains Office/PDF/tabular files, or
- it contains multiple text-document artifacts and little or no code

This is intentionally conservative. A false negative is safer than a false positive because document mode should not disrupt software implementation sessions.

## Expected benefit

High expected benefit:

- more reliable primary/companion skill composition
- better default handling when users do not use slash commands
- less long-task drift after compaction

Lower expected benefit:

- full multi-stage task planning
- memory retrieval across unrelated projects

Those should remain separate concerns for future `task-master-ai` or memory integrations.
