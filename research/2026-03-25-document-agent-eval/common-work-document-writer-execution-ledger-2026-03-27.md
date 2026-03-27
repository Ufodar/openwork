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
- pod-side live verification is still partially blocked by intermittent SSH / edge timeout; local code and tests are green, but the latest runtime folder listing on pod still needs a fresh check after republish

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

1. Commit the reduced document-session skill/MCP surface and prompt/palette alignment.
2. Push to GitHub and Gitee.
3. Pull on pod and restart.
4. Re-run a minimal live document-session create check on pod.
5. Confirm on pod:
   - session creation succeeds
   - runtime skill folder is physically pruned to the intended subset
   - runtime MCP surface is physically pruned to the intended subset
   - history view behavior still opens the intended TSX
6. Once that is confirmed, continue Stage 2 with low-token `common-work` A/B diagnostics against local raw OpenCode, then only escalate to longer runs when a parity gap is real.
