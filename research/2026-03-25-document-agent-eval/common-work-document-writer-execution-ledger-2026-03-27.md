# Common-Work / Document-Writer Execution Ledger

## Mission

Keep this file as the durable control plane for the current roadmap. Do not start a later stage until the current stage exit criteria are met.

Primary product goal:
- `common-work` in hosted pod mode must not be weaker than local raw OpenCode for large document work.

Secondary product goal:
- after `common-work` is stable and stronger than local raw OpenCode, shift to `document-writer` as a workflow-enhanced, general-purpose upgrade rather than a Qin-only bid agent.

## User-Mandated Order

### Stage 1

Finish the current baseline work before anything else:
- eliminate hosted regressions that make `common-work` weaker than local raw OpenCode
- verify session isolation does not break document work
- reduce irrelevant runtime skills and MCP for document sessions
- ensure history sessions reopen into the correct TSX/view

Exit criteria:
- new `common-work` / document-agent sessions only load the intended runtime skill subset
- document-session runtime MCP surface is trimmed to the document-relevant subset
- history re-entry still restores the intended view
- no known hosted-only regression remains in the session creation / runtime provisioning path

### Stage 2

Run local-vs-pod A/B tests for `common-work` only:
- compare `common-work` against local raw OpenCode
- compare tool-call patterns, failure patterns, and final deliverables
- optimize for low-token diagnostics first, long runs only when needed

Exit criteria:
- hosted `common-work` shows no material hosted-only regressions
- final deliverables are at least as strong as local raw OpenCode on the chosen benchmark tasks

### Stage 3

Before changing `document-writer`, audit isolation boundaries:
- verify any future `document-writer` changes will not silently weaken `common-work`
- isolate shared code paths, session preferences, runtime provisioning, and tool surfaces

Exit criteria:
- known shared paths are identified
- guardrails are in place where a `document-writer` tweak would otherwise leak into `common-work`

### Stage 4

Generalize `document-writer`:
- remove Qin-only heuristics from subagent md files, prompt files, and scripts
- keep the result as a general workflow upgrade over `common-work`
- think of it as `common-work-plus`, not a narrow bid-only agent

Exit criteria:
- no obvious Qin-only heuristics remain
- workflow skills are general-purpose and reusable
- `document-writer` remains isolated from `common-work` regressions

## Current Status

Active stage:
- Stage 1

Stage 1 status:
- in progress

Immediate blocker:
- local baseline evidence is now good on all three user-facing concerns:
  - no current local evidence of `external_directory` / repo-external drift in `common-work`
  - runtime session skill surface is physically pruned to the intended document subset
  - history re-entry tests still restore the intended TSX/view
- the remaining blocker is live pod deployment verification: the latest baseline tightening commit is pushed to GitHub and Gitee, but pod-side `git pull --ff-only` / `restart-pod.sh --force` is currently blocked by intermittent SSH / edge timeout; live HTTP health is up, but the pod has not yet been confirmed on the newest commit

## Latest Findings

### 2026-03-27: runtime skill pruning design was correct, first persistence mechanism was wrong

What happened:
- session-aware runtime pruning was implemented by threading `openworkPreferredView / openworkPreferredAgent / openworkPreferredAgentLock` from app create-session payload into server provisioning
- runtime `.opencode/skills` was correctly pruned for document sessions
- runtime MCP allowlist was correctly reduced for document sessions

What broke:
- the first implementation stored runtime session profile metadata inside `opencode.jsonc` under a top-level `openwork` key
- live pod session creation then failed with `500 internal_error`

Root cause evidence:
- direct call to bare OpenCode returned:
  - `ConfigInvalidError`
  - `issues: [{ code: "unrecognized_keys", keys: ["openwork"] }]`

Resolution direction:
- store runtime session profile in a sidecar file under `.opencode/`
- do not write any OpenWork-only metadata into OpenCode config schema

Local verification after the fix:
- `bun test packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts packages/app/src/app/app.create-session-runtime-profile.test.ts packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/context/session.runtime-directory-hydration.test.ts packages/app/src/app/lib/session-command-palette.test.ts`
- all passing

### 2026-03-27: document-session runtime surface was tightened again to remove generic detours

What changed:
- document-agent / common-work runtime skills were reduced to:
  - `doc-coauthoring`
  - `doc-normalize`
  - `docx`
  - `pdf`
  - `pptx`
  - `xlsx`
- document-writer runtime keeps the same set plus `openwork-core`
- document-session runtime MCP allowlist was reduced to:
  - `bocha-search`
  - `doc_state`
  - `openwork-knowledge`
- document sessions no longer preserve the redundant `filesystem` MCP
- `common-work` prompt and session command palette were aligned to this smaller runtime surface

Why:
- OpenCode loads whatever exists under the runtime `.opencode/skills` folder
- keeping generic support skills in document sessions increases the chance of long-document runs drifting into irrelevant routes
- keeping `filesystem` in the document runtime MCP surface was redundant because the hosted session already has native file tools scoped to `<WORKSPACE>`

Local verification:
- `bun test packages/server/src/session-workspaces.test.ts`
- `bun test packages/app/src/app/lib/session-command-palette.test.ts packages/app/scripts/doc-subagent-prompts.test.mjs packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/context/session.runtime-directory-hydration.test.ts`
- `git diff --check -- packages/server/src/session-workspaces.ts packages/server/src/session-workspaces.test.ts packages/app/src/app/lib/session-command-palette.ts packages/app/src/app/lib/session-command-palette.test.ts .opencode/agent/common-work.md packages/app/scripts/doc-subagent-prompts.test.mjs`
- all passing

### 2026-03-27: first low-token Qin diagnostic answered the external-path concern locally

Scenario:
- `QIN_ABC_LANES=raw,local OPENWORK_COMPARE_MODE=diagnostic node tmp/qin-abc-minimax.mjs`

Findings:
- local `common-work` early tool burst:
  - `glob: 1`
  - `skill: 1`
  - `bash: 3`
  - `read: 2`
- local `common-work` routing diagnostics:
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
  - `issueCounts = {}`
- local raw OpenCode routing diagnostics:
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
- raw still showed two `webfetch` failures; this remains a raw-side issue, not a hosted document-session boundary issue

Interpretation:
- the current concern around `external_directory` / workspace-external writes is not showing up as a local parity gap in the first low-token Qin pass
- the remaining parity question is still pod/common-work behavior under hosted runtime, not local raw behavior

### 2026-03-27: compare harness was corrected to create real document-agent/common-work hosted sessions

What was wrong:
- the hosted/local `common-work` compare harness originally created generic OpenWork sessions
- it did not forward:
  - `openworkPreferredView=document-agent`
  - `openworkPreferredAgent=common-work`
  - `openworkPreferredAgentLock=common-work`

Why it mattered:
- some earlier hosted diagnostics were under-testing the real runtime profile
- runtime pruning and hosted session surface can only be trusted when these hints are forwarded

Fix:
- `tmp/qin-abc-minimax.mjs` now forwards the preferred runtime profile hints when creating hosted `common-work` sessions
- regression guard added in `packages/app/scripts/qin-compare-harness.test.mjs`

Verification:
- `bun test packages/app/scripts/qin-compare-harness.test.mjs`
- `node --check tmp/qin-abc-minimax.mjs`

### 2026-03-27: corrected hosted Qin diagnostic shows no external-path drift on the current pod build

Scenario:
- `QIN_ABC_LANES=pod OPENWORK_COMPARE_MODE=diagnostic node tmp/qin-abc-minimax.mjs`
- with the corrected hosted session-create hints enabled

Findings on the current deployed pod build:
- session creation succeeded for a real `document-agent/common-work` session
- upload completed for both Qin source documents
- routing diagnostics:
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
  - `broadDiscoveryCount = 0`
- early tool burst:
  - `bash: 4`
  - `glob: 1`
  - `skill: 1`
  - `read: 1`
  - `bocha-search: 3`
  - `todowrite: 1`
  - `write: 1` (aborted only because the diagnostic run intentionally stopped early)

Interpretation:
- the hosted regression is not currently about `external_directory`, system temp reopening, or direct Office reads
- the more credible hosted/common-work weakness in the early phase is still search routing churn, especially repeated `bocha-search` calls before enough local-document grounding
- the pod used in this diagnostic still reported OpenCode `version = 1.3.2`, so the result describes the current deployed build, not yet the newest local baseline commit

### 2026-03-27: `common-work` now explicitly forbids repo-level `.opencode/**` detours, and the local Qin diagnostic no longer shows external-path drift

What changed:
- `common-work` now explicitly forbids reading prompt / skill / agent instructions from repo root, parent directories, or any workspace-external `.opencode/**`
- if runtime-local references are genuinely needed, the prompt now allows only the current `<WORKSPACE>/.opencode/**` copies

Why:
- an earlier corrected local Qin diagnostic showed a real parity trap:
  - `grep` touched `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode`
  - this was outside the session runtime workspace
- hosted runtimes would reject that route, so leaving it in local `common-work` behavior would mask a real local-vs-hosted mismatch

Verification:
- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
- `git diff --check -- .opencode/agent/common-work.md packages/app/scripts/doc-subagent-prompts.test.mjs`
- low-token local Qin diagnostic after the prompt update:
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
  - `issueCounts = {}`
  - early tool counts:
    - `bash: 4`
    - `skill: 1`
    - `read: 2`
    - `webfetch: 1`
    - `grep: 1`
    - `todowrite: 1`
    - `write: 1` (diagnostic abort only)

Interpretation:
- the specific repo-level `.opencode` detour that previously appeared in local `common-work` is no longer reproducing in the latest low-token Qin pass
- the remaining local `common-work` weakness in this pass is not external path drift; it is that a `webfetch` call still appears in the early route

### 2026-03-27: actual runtime folder inspection confirms the pruned document-session skill set and a small MCP surface

Observed on the latest local `document-agent/common-work` runtime created by the compare harness:
- runtime skill directory contained only:
  - `doc-coauthoring`
  - `doc-normalize`
  - `docx`
  - `pdf`
  - `pptx`
  - `xlsx`
- runtime `opencode.jsonc` MCP keys were:
  - `bocha-search`
  - `openwork-knowledge`

Interpretation:
- the runtime session that OpenCode actually reads is no longer loading generic writing / image / internal-comms skills for `common-work`
- the inspected common-work runtime also did not contain unrelated MCP such as `filesystem`, `memory`, or `sequential-thinking`
- `doc_state` remains supported in the runtime pruning design and unit tests, but it was not present in this particular harness-created common-work runtime snapshot; keep that distinction clear when evaluating live session surfaces

## Files Touched In Current Stage

- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-workspaces.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-workspaces.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/server.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/server.proxy-session-create.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/app.tsx`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/app.create-session-runtime-profile.test.ts`

## Current Working Rules

- do not start Stage 2 A/B work until the live pod regression above is fully cleared
- do not start `document-writer` generalization until `common-work` hosted parity is solid
- prefer low-token diagnostics before long full-generation runs
- for hosted regressions, isolate whether the problem is:
  - app routing/view state
  - server provisioning/runtime control
  - OpenCode config compatibility
  - prompt/tool routing

## Next Actions

1. Commit the newest `common-work` prompt rule and refreshed ledger notes, then push to GitHub and Gitee.
2. Keep retrying pod `git pull --ff-only` + `bash scripts/restart-pod.sh --force` until SSH is usable again.
3. After pod deploy succeeds, confirm the live pod commit and re-run a minimal hinted document-session create check.
4. Confirm on the updated pod:
   - runtime skill folder is physically pruned to the intended subset
   - runtime MCP surface is physically pruned to the intended subset
   - history view behavior still opens the intended TSX
5. Then continue Stage 2 low-token `common-work` A/B work, focusing first on early search-routing drift (`bocha-search` / `webfetch`) rather than external-path drift.
