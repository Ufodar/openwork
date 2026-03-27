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
- Stage 1 is now locally green again after a second history-reentry hardening pass:
  - document-session runtime skill pruning is still enforced at the server/runtime layer
  - runtime session metadata now persists `preferredView / preferredAgent / preferredAgentLock` in the session workspace store
  - history resolution no longer depends only on root `.opencode/openwork.json`
  - old runtime directories can now recover document-session view metadata from `.opencode/openwork-runtime-profile.json`
- remaining blocker is live pod verification of this new fallback path plus a fresh hosted check of early `common-work` detours

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

### 2026-03-27: history re-entry was hardened away from root-config fragility

What broke:
- live pod showed a real mismatch after logout/relogin:
  - clicking a historical `document-agent` session could reopen `/session/:id`
  - the matching root workspace `.opencode/openwork.json` did not reliably retain the session view metadata
- browser-local `openwork.sessionPrefs.v1` is cleared on logout, so relying on local storage alone is not acceptable for hosted history re-entry

What changed locally:
- `SessionWorkspaceService` now persists:
  - `preferredView`
  - `preferredAgent`
  - `preferredAgentLock`
- server-side session listing now returns:
  - `openworkPreferredView`
  - `openworkPreferredAgent`
  - `openworkPreferredAgentLock`
- historical isolated sessions without stored metadata can now recover the same view hints from runtime `.opencode/openwork-runtime-profile.json`
- app-side session preference resolution now accepts session-list hints as a fallback beneath explicit stored prefs
- the session page now passes the full session item hint set when opening history entries, so reopening does not depend on root config sync succeeding first

Why this design is better:
- the runtime profile already exists for hosted document sessions and survives independently of flaky root config patching
- the session workspace store is already the durable authority for hosted runtime directories
- local explicit prefs still win, so this does not overwrite deliberate user changes

Local verification:
- `bun test packages/app/src/app/context/session.runtime-directory-hydration.test.ts packages/app/src/app/app.session-prefs-remote-baseline.test.ts packages/app/src/app/lib/session-preferences.test.ts packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-list.test.ts`
- touched-file compile filter is clean:
  - `packages/app/src/app/app.tsx`
  - `packages/app/src/app/pages/session.tsx`
  - `packages/app/src/app/types.ts`
  - `packages/app/src/app/lib/session-preferences.ts`
  - `packages/server/src/server.ts`
  - `packages/server/src/session-history-recovery.ts`
  - `packages/server/src/session-workspaces.ts`

Remaining live check:
- push -> `gitee`/`origin`
- pod `git pull --ff-only`
- `bash scripts/restart-pod.sh --force`
- verify:
  - historical `document-agent` click reopens `/document-agent/:id`
  - fresh runtime `.opencode/skills` only contains the document allowlist
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

### 2026-03-27: low-token compare diagnostics now persist a compact tool trace, which exposed and then removed two local-only early detours

What changed in diagnostics:
- the low-token compare harness now records a compact `toolTrace` for the first tool calls
- each trace row preserves:
  - tool name
  - status
  - issue codes
  - first relevant file path / pattern / command / URL

Why:
- this avoids rerunning long tasks just to find out whether a bad early turn came from `webfetch`, `bocha-search`, repo-level `.opencode` reads, or `bash` leaving the runtime workspace

Verification for the diagnostics change:
- `bun test packages/app/scripts/openwork-compare-diagnostics.test.mjs`
- `node --check tmp/qin-abc-minimax.mjs`

What the first trace exposed:
- one local Qin diagnostic showed:
  - `webfetch https://www.jd.com/`
- this was a real wrong-way route:
  - unrelated to the document task
  - not anchored by a search result, user-provided URL, or source-document URL

Prompt response:
- `common-work` now explicitly forbids:
  - using `webfetch` to probe unrelated consumer sites, portal homepages, search homepages, e-commerce homepages, or other generic popular sites
  - calling `webfetch` before there is a concrete candidate URL from search results, source documents, or the user

What the next trace exposed:
- a later local Qin diagnostic removed the `jd.com` fetch, but still showed:
  - `bash: cd /Users/storm/Documents/code/studyProject/opencode-docx/openwork && bocha-search ...`
- this left the session runtime workspace even though it did not use `external_directory`

Prompt and diagnostics response:
- diagnostics now classify absolute `bash` `cd` targets outside `<WORKSPACE>` as `external-path-touch`
- `common-work` now explicitly forbids leaving `<WORKSPACE>` in `bash` just to run shared CLIs, search commands, helper scripts, or inspect repo files

Latest local Qin verification after both prompt updates:
- `externalPathTouchCount = 0`
- `systemTempTouchCount = 0`
- `directOfficeReadCount = 0`
- `issueCounts = {}`
- early tool trace now looks like:
  - `glob **/*.docx`
  - `skill`
  - workspace-local `pandoc` extraction into `.tmp/docx-read/`
  - `read` extracted Markdown copies
  - workspace-local `grep`
  - `todowrite`
  - no `webfetch`
  - no repo-root `cd`

Interpretation:
- local `common-work` is now materially closer to the intended hosted behavior in the early phase
- the remaining common-work parity question is no longer about obvious workspace escapes; it is about whether hosted search routing is still noisier than local raw OpenCode

### 2026-03-27: live pod baseline verification now confirms skill pruning, session-view persistence, and correct history re-entry

Live checks on the current pod:
- fresh `POST /w/<workspaceId>/opencode/session` for `document-agent/common-work` returned `200`
- the created runtime directory physically contained only:
  - `doc-coauthoring`
  - `doc-normalize`
  - `docx`
  - `pdf`
  - `pptx`
  - `xlsx`
- the same live runtime `opencode.jsonc` currently carried:
  - `bocha-search`
  - `openwork-knowledge`
- the user workspace `.opencode/openwork.json` on pod contains persisted `sessions` entries with `view`, `agent`, and `agentLock`
- a real browser check on `http://192.168.5.10:32765` showed:
  - creating a new 文档智能体 session navigates to `/document-agent/<sessionId>`
  - returning to `/dashboard/agents`
  - clicking that session in the history list reopens the same `/document-agent/<sessionId>` route instead of collapsing to `/session/<sessionId>`

Interpretation:
- the “history session reopens into the wrong TSX” baseline is no longer reproducing on the current pod build
- runtime `.opencode/skills` pruning is working live, not just in local tests
- server-side view persistence now uses the correct OpenWork config surface and is populated on pod

### 2026-03-27: latest live hosted Qin diagnostic narrowed the remaining hosted detour to one denied `/tmp` conversion

Scenario:
- `OPENWORK_COMPARE_SCENARIO=qin OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=pod node tmp/qin-abc-minimax.mjs`

Findings:
- routing diagnostics on pod:
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
  - `issueCounts = { "access-denied": 1 }`
- the one live denial was:
  - `pandoc --track-changes=all "融合算力云平台白皮书.docx" -o /tmp/fusion_whitepaper.md`
- the agent then immediately rerouted correctly to:
  - `mkdir -p .tmp/system && pandoc --track-changes=all "融合算力云平台白皮书.docx" -o .tmp/system/fusion_whitepaper.md`

Interpretation:
- this is no longer a session-isolation bug or `external_directory` bug
- the remaining waste is an early guidance issue: `common-work` still needs to stop trying the first extraction command against `/tmp`

### 2026-03-27: next baseline fix removes the empty default knowledge MCP and hardens the first conversion rule

Local fix prepared:
- fresh session-create no longer injects `openwork-knowledge` by default when the session has no attached knowledge
- `common-work` now explicitly requires the first `.docx/.doc/.pdf -> .md/.txt/.xml` conversion command to create a workspace-local temp directory and write there directly, instead of probing `/tmp` first

Local verification:
- `bun test packages/server/src/server.proxy-session-create.test.ts`
- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
- `bun test packages/server/src/session-workspaces.test.ts packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/context/session.runtime-directory-hydration.test.ts`
- `git diff --check -- packages/server/src/server.ts packages/server/src/server.proxy-session-create.test.ts .opencode/agent/common-work.md packages/app/scripts/doc-subagent-prompts.test.mjs`
- all passing

## Files Touched In Current Stage

- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-workspaces.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-workspaces.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/server.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/server.proxy-session-create.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/app.tsx`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/app.create-session-runtime-profile.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/scripts/doc-subagent-prompts.test.mjs`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md`

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

1. Commit the newest `common-work` prompt / proxy-session-create / ledger updates, then push to GitHub and Gitee.
2. On pod, `git pull --ff-only` and run `bash scripts/restart-pod.sh --force`.
3. After deploy, re-check on pod:
   - fresh document-session runtime MCP surface no longer includes empty default `openwork-knowledge`
   - runtime skill folder is still physically pruned to the intended subset
   - history view behavior still opens the intended TSX
4. Re-run the low-token hosted Qin diagnostic and verify the early denied `/tmp/*.md` conversion no longer appears.
5. Only after that baseline is clean, continue Stage 2 `common-work` A/B work focused on hosted-vs-local quality and remaining search-routing drift.
