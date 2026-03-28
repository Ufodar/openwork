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
- Stage 2

Stage 1 status:
- completed on the current pod build after fresh live verification

Immediate blocker:
- no active Stage 1 blocker remains on the current pod build
- Stage 2 now needs to prove `common-work` is actually stronger than local raw OpenCode, not just free of the hosted regressions

## 2026-03-28 Status Checkpoint

### Task 1: user-facing baseline for `common-work`

Status:
- mostly complete and currently usable on pod
- the three explicit baseline subitems are live-green on the latest deployed build:
  - hosted sessions are not drifting into `external_directory`, parent/sibling session folders, or `/tmp` reopen paths on the successful WJW / Qin runs
  - fresh hosted `common-work` runtimes physically prune `.opencode/skills` down to:
    - `doc-coauthoring`
    - `doc-normalize`
    - `docx`
    - `pdf`
    - `pptx`
    - `xlsx`
  - the inspected live runtime `opencode.jsonc` only exposed:
    - `bocha-search`
  - history-session reopening remains green in the local regression suite, and no new live regression has been found after the earlier pod browser verification

Problems found in this checkpoint window:
- one Qin rerun on pod briefly regressed to a stochastic direct binary read:
  - first bad call:
    - `read 天河监控运维一体化平台软件介绍v0.3.docx`
  - the compare harness intentionally aborted after catching that `direct-office-read`
- this showed that the baseline path rules were correct in principle, but not yet positioned strongly enough in the runtime guidance

What was changed:
- deployed commit `2791943b`:
  - `Tighten final placeholder sweeps in common-work`
- deployed commit `3e7d9164`:
  - `Enforce final output sweeps for common-work`
- deployed commit `d8acc3d1`:
  - `Front-load office extraction rules for document sessions`
- files changed across these fixes:
  - `.opencode/agent/common-work.md`
  - `packages/app/scripts/doc-subagent-prompts.test.mjs`
  - `.opencode/plugins/document-mode-bridge.js`
  - `.opencode/plugins/document-mode-bridge.test.mjs`

Decisions:
- keep Task 1 functionally green for the three baseline items, but do not over-claim that all document quality regressions are solved
- treat the direct-Office-read relapse as a routing-hardening issue, not as evidence that session isolation or skill pruning regressed again

Reason:
- the regression did not touch:
  - runtime skill pruning
  - runtime MCP pruning
  - history-session view restoration
  - hosted file-boundary safety
- it was a model-routing mistake inside an otherwise healthy hosted session

### Task 2: local raw OpenCode vs pod `common-work` A/B

Status:
- in progress
- medium-size WJW and Qin A/B work is complete
- large formal benchmark work under `/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/` has been selected but not yet started because Stage 2 still has one unresolved output-quality gap

What the A/B runs proved:
- WJW:
  - pod `common-work` is now cleaner than raw on temp-path handling and no longer burns the early hosted `/tmp` reopen route
- Qin:
  - pod `common-work` can be cleaner and faster than raw on route quality
  - raw still shows weaker behavior such as:
    - `filesystem_list_directory`
    - unnecessary `skill`
    - `webfetch`
    - malformed export JSON fallback

Problems found:
- final-result quality is still not consistently stronger than raw
- on successful Qin pod completions, generated `.docx` files still retained fabricated placeholders such as:
  - `k8s.cluster.example.com`
  - `app.example.com`
  - `ops-team@example.com`
  - `<access_token>` / `Bearer <access_token>`
- tool traces showed the model still skipping the intended final `grep -RniE ...` sweep and ending with `ls` / file existence checks instead

What was changed:
- `common-work.md` was tightened twice to:
  - forbid placeholder credentials more explicitly
  - require explicit final scans
  - state that `ls` / `glob outputs/*` does not count as final verification
  - require rewrite + regenerate + re-scan if high-risk strings are found
- after the direct-Office-read regression, the extraction-first rule was moved earlier:
  - into the opening discovery contract of `common-work.md`
  - into `document-mode-bridge.js`

Tests run:
- session/history/view regressions:
  - `bun test packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/lib/session-preferences.test.mjs packages/app/src/app/pages/dashboard.history-session-hints.test.mjs packages/app/src/app/lib/session-view-routing.test.ts packages/app/src/app/context/session.runtime-directory-hydration.test.ts packages/app/src/app/app.session-command-order.test.ts`
  - result:
    - `25 pass`
    - `0 fail`
- runtime-surface regressions:
  - `bun test packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts`
  - result:
    - `15 pass`
    - `0 fail`
- prompt regressions:
  - `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
  - result:
    - `39 pass`
    - `0 fail`

Decisions:
- keep Task 2 open
- do not yet declare `common-work` stronger than local raw OpenCode on final deliverable quality
- stop relying only on tail-end prompt rules for quality gates
- move from a noisy `grep ... .` style reminder to a deterministic delivery gate script that scans only explicit deliverable targets

Reason:
- the model repeatedly ignored long tail-end cleanup instructions
- moving the most important rules to the earliest runtime guidance is a better bet than continuing to add weaker wording near the bottom of a long prompt
- the earlier `grep -RniE ... outputs reports .` route was also flawed on its own merits because scanning `.` pulls in runtime `.opencode/**` policy files that intentionally contain `example.com`, `@example.com`, and token placeholders as examples, which creates false positives and weakens the signal

Current local pending work for Task 2:
- one uncommitted bridge-only hardening is now present locally:
  - `.opencode/plugins/document-mode-bridge.js`
- it adds a short “Non-negotiable hosted document guardrails” block covering:
  - no direct `read` on original Office binaries
  - no `/tmp` reopenable outputs
  - mandatory final `grep` sweep before delivery
- this has not yet been committed or redeployed at the time of this checkpoint

### 2026-03-28: deterministic delivery gate added for Stage 2 and wired into the Qin A/B harness

New findings:
- the newly added `python3 .opencode/references/check_document_delivery.py` immediately reproduced the known Qin residue on historical pod outputs:
  - `tmp/compare-agents/qin-abc-minimax/downloads/pod/outputs/融合算力调度平台技术方案.docx`
  - hits:
    - `https://kubernetes.example.com:6443`
- scanning the broader historical pod download corpus also caught the larger family of surviving residue:
  - `http://<API_HOST>/...`
  - `https://<API_HOST>/...`
  - `Bearer <ACCESS_TOKEN>`
  - `ops-team@example.com`
  - `https://example.com/webhook/...`
- a real implementation bug was found and fixed in the first version of the gate:
  - it incorrectly ignored valid files when an ancestor absolute path happened to contain a `tmp/` segment
  - this mattered because the compare corpus lives under `tmp/compare-agents/...`

What was changed:
- added runtime-shippable deterministic delivery gate:
  - `.opencode/references/check_document_delivery.py`
- changed `document-mode-bridge.js` to instruct sessions to run:
  - `python3 .opencode/references/check_document_delivery.py --target outputs --target reports`
  - plus the exact final file path when the stable deliverable lives elsewhere
- changed `common-work.md` final verification rules to:
  - treat the script exit code as the real delivery-quality result
  - explicitly forbid pointing the sweep at the whole `.` tree
- wired the Qin compare harness to record `deliveryQualityGate` results for:
  - raw outputs
  - hosted/local downloaded documents

Tests run for this change:
- `bun test "$PWD/.opencode/plugins/document-mode-bridge.test.mjs"`
- `bun test packages/app/scripts/check-document-delivery.test.mjs packages/app/scripts/qin-compare-harness.test.mjs`
- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
- `git diff --check -- .opencode/references/check_document_delivery.py .opencode/plugins/document-mode-bridge.js .opencode/plugins/document-mode-bridge.test.mjs .opencode/agent/common-work.md packages/app/scripts/check-document-delivery.test.mjs packages/app/scripts/doc-subagent-prompts.test.mjs packages/app/scripts/qin-compare-harness.test.mjs tmp/qin-abc-minimax.mjs`

Decision:
- keep this as the new Stage 2 quality baseline before the next pod rerun

Reason:
- this is a stronger and lower-noise gate than the old prompt-only `grep ... .` route
- it creates the same machine-readable quality verdict for:
  - live hosted reruns
  - raw local reruns
  - historical artifact inspection

### 2026-03-28: fresh Qin pod rerun after commit `39aeaf38` passed the new delivery gate end-to-end

Deployment:
- local commit:
  - `39aeaf38` (`Add deterministic document delivery gate`)
- pushed to:
  - `origin/dev`
  - `gitee/dev`
- pod:
  - `git pull --ff-only`
  - `bash scripts/recover-pod-runtime.sh --force`
- post-restart health:
  - `http://192.168.5.10:32765/openwork/health -> ok`

Rerun:
- `OPENWORK_COMPARE_SCENARIO=qin OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=24 node tmp/qin-abc-minimax.mjs`
- session:
  - `ses_2cdf0743dffeNB7QlH44DkR2Lt`

Result:
- generated deliverables:
  - `outputs/融合算力平台项目申报技术材料.docx`
  - `outputs/融合算力平台项目申报技术材料.md`
- `deliveryGateOk = true`
- `deliveryQualityGate.report.issueCount = 0`

Most important behavior change:
- the tool trace now shows a real repair loop instead of a fake “I checked” close-out:
  - generated Markdown + `.docx`
  - ran `python3 .opencode/references/check_document_delivery.py --target outputs --target reports`
  - edited the Markdown multiple times
  - regenerated the `.docx`
  - reran the same delivery gate
  - only then closed the task

Residual observations:
- this rerun still had one low-severity habit that is worth tracking later:
  - a late `glob outputs/*`
- it no longer matters for baseline correctness because:
  - `broadDiscoveryCount = 0`
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
  - final delivery gate passed
- upload time is still long on this pod scenario:
  - `uploadElapsedMs = 438521`
  - that is a performance concern, not a document-correctness blocker

Decision:
- treat the deterministic gate as effective on hosted Qin
- keep Stage 2 open until the same harness confirms whether raw local OpenCode now still beats, ties, or loses on final deliverable quality under the same gate

### 2026-03-28: matching Qin raw rerun failed the same delivery gate, so hosted `common-work` is now stronger than raw on this benchmark

Rerun:
- `OPENWORK_COMPARE_SCENARIO=qin OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=raw OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=24 node tmp/qin-abc-minimax.mjs`
- session:
  - `ses_2cde4d279ffentciKfO5aM06wp`

Raw result:
- `deliveryGateOk = false`
- generated output:
  - `.tmp/system/算力网络平台项目申报技术材料.docx`
- no stable `outputs/**` deliverable was produced
- the compare harness therefore had no valid stable target to scan and reported:
  - `No delivery-gate targets provided.`

Important raw weaknesses in the same run:
- still started with:
  - `glob **/*.docx`
- still called:
  - `webfetch`
  - `skill`
- still wrote the final Word artifact into:
  - `.tmp/system/...`
- still did not run any equivalent deterministic delivery-quality repair loop
- still produced malformed `export` JSON and forced fallback analysis from `run-jsonl`

Direct comparison on the Qin benchmark now looks like this:
- hosted `common-work`:
  - stable outputs in `outputs/**`
  - deterministic delivery gate passed
  - explicit repair loop observed in the tool trace
- raw local OpenCode:
  - final artifact stranded in `.tmp/system/**`
  - deterministic delivery gate failed / could not validate a stable deliverable
  - more irrelevant routing (`glob`, `webfetch`, `skill`)

Decision:
- count the Qin benchmark as a clear Stage 2 win for hosted `common-work`
- do not stop Stage 2 yet, because the long formal benchmark from `/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/` is still pending

### 2026-03-28: the first `ly` long-form pod diagnostic was a harness false stop, not a hosted product regression

Scenario:
- first pod-only long-form run:
  - `OPENWORK_COMPARE_SCENARIO=ly OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=24 node tmp/qin-abc-minimax.mjs`
- source set:
  - `备-环投数科临沂项目第一包v20250507v1.0(1)(1).docx`
  - `临沂招标文件正文.pdf`
  - `环投数科临沂项目第一包v20250508终版文件.docx`

What happened:
- the hosted route stayed clean on the dimensions the user cares about:
  - `broadDiscoveryCount = 0`
  - `systemTempTouchCount = 0`
  - `externalPathTouchCount = 0`
  - `directOfficeReadCount = 0`
- but the diagnostic harness aborted at:
  - `reason = max-tool-calls`
- the recorded `write` error was:
  - `Tool execution aborted`
- the trace showed the session had already finished the expensive extraction/read phase and was only just entering first-draft creation

Root cause:
- this was not OpenCode / OpenWork imposing a 24-tool product limit
- it was the A/B harness's diagnostic-only early-stop setting
- on a large formal benchmark, `24` tool calls was too low and cut the run before delivery

What was changed locally:
- `packages/app/scripts/openwork-compare-diagnostics.mjs`
  - diagnostic early-stop now refuses to stop on pure `max-tool-calls` once the session has already touched `outputs/**` or `reports/**`
- `packages/app/scripts/openwork-compare-diagnostics.test.mjs`
  - added coverage proving deliverable-phase activity suppresses the false stop
- `tmp/qin-abc-minimax.mjs`
  - raised the default diagnostic `maxToolCalls` fallback from `8` to `240`
  - user explicitly called out that long-form diagnostics should be `200+`, so the harness default was aligned to that expectation

Verification:
- `bun test packages/app/scripts/openwork-compare-diagnostics.test.mjs`
- `node --check tmp/qin-abc-minimax.mjs`
- `git diff --check -- packages/app/scripts/openwork-compare-diagnostics.mjs packages/app/scripts/openwork-compare-diagnostics.test.mjs tmp/qin-abc-minimax.mjs`

Decision:
- do not treat the first failed `ly` pod-only run as evidence against hosted `common-work`
- treat it as a Stage 2 benchmarking-tool bug and keep product conclusions tied only to the corrected reruns

Reason:
- the hosted route was still respecting workspace boundaries and document-first extraction rules
- the session was interrupted by the benchmark harness itself, so changing product prompts or runtime behavior based on that run would have been a category error

### 2026-03-28: corrected `ly` reruns show both lanes can now pass the delivery gate, but hosted `common-work` is still cleaner and more prompt-faithful

Hosted rerun:
- widened diagnostic pod run:
  - `OPENWORK_COMPARE_SCENARIO=ly OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=420000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=40 node tmp/qin-abc-minimax.mjs`
- result:
  - generated:
    - `outputs/天河产业园融合算力系统技术方案.md`
    - `outputs/天河产业园融合算力系统技术方案.docx`
  - `deliveryGateOk = true`
  - `issueCount = 0`
  - `toolIssues = {}`
  - route quality:
    - `broadDiscoveryCount = 0`
    - `systemTempTouchCount = 0`
    - `externalPathTouchCount = 0`
    - `directOfficeReadCount = 0`

Matching raw rerun:
- local raw run:
  - `OPENWORK_COMPARE_SCENARIO=ly OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=raw OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=420000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=40 node tmp/qin-abc-minimax.mjs`
- result:
  - generated:
    - `outputs/天河产业园融合算力系统技术方案.md`
    - `outputs/天河产业园融合算力系统技术方案.docx`
  - `deliveryGateOk = true`
  - but still showed route waste:
    - leading `glob "**/*"`
    - one wrong `read` against a non-existent extracted file
    - malformed `export` JSON again, forcing `run-jsonl` fallback analysis

Cross-check:
- combined deterministic scan over both output directories:
  - `python3 .opencode/references/check_document_delivery.py --target tmp/compare-agents/ly-raw-vs-pod-minimax/raw-opencode-workspace/outputs --target tmp/compare-agents/ly-raw-vs-pod-minimax/downloads/pod/outputs`
- result:
  - all four deliverables scanned clean

Output-quality comparison at this checkpoint:
- pod Markdown is materially fuller:
  - about `8269` chars
  - `66` headings
- raw Markdown is shorter and flatter:
  - about `5300` chars
  - `22` headings
- raw output also carried prompt-faithfulness drift that the hosted result avoided:
  - explicit procurement budget / price-like material:
    - `5782.65万元`
  - more bidder- and招标流程-oriented商务条款 noise
- hosted output better respected the request to stay on a formal technical-solution surface and remove pricing-style residue

Residual hosted nit:
- hosted output still used an ASCII box-drawing architecture block
- this is a readability polish issue, not a baseline delivery blocker

Decision:
- count `ly` as a hosted route-quality win and a hosted prompt-faithfulness win
- do not yet declare Stage 2 fully complete from `ly` alone, because raw also now passes the hard delivery gate on this scenario

Reason:
- the corrected `ly` evidence says hosted `common-work` is cleaner and usually better aligned with the requested document shape
- but Stage 2's exit criterion is stronger than “cleaner route”; it asks for final deliverables that are at least as strong as raw across the chosen benchmark set
- the current state is:
  - Qin: hosted clearly stronger
  - `ly`: hosted cleaner and arguably stronger, but the quality gap is not yet definitive enough to close the entire stage without one more judgment pass

### Task 3: isolate `document-writer` from `common-work`

Status:
- not started by design

Decision:
- keep Task 3 blocked until Task 2 proves that `common-work` is stronger than local raw OpenCode on final-result quality, not just on route cleanliness

Reason:
- starting the shared-path audit too early risks mixing `document-writer`-specific decisions into a still-moving `common-work` baseline

### Task 4: generalize `document-writer`

Status:
- not started

Decision:
- do not begin removing Qin-specific heuristics or reshaping `document-writer` yet

Reason:
- user-mandated order requires:
  - Task 1 baseline closed first
  - then Task 2 A/B proof
  - then Task 3 shared-path audit
  - only then Task 4 generalization

### Current checkpoint conclusion

- Task 1:
  - baseline subitems are functionally green on pod
- Task 2:
  - route-level parity is already strong on WJW and often strong on Qin
  - final-output quality is still the blocking gap
- Task 3:
  - not started
- Task 4:
  - not started

Primary open problem right now:
- `common-work` still does not execute the final output sweep reliably enough, so fabricated hosts/emails/tokens can survive into generated `.docx` output even when the route itself is otherwise clean

Immediate next move after this checkpoint:
- finish the uncommitted `document-mode-bridge.js` front-loaded guardrail block
- redeploy it to pod
- rerun Qin again
- if fabricated placeholders still survive after that, stop treating this as a prompt-only problem and add a harder runtime-side quality gate

## Latest Findings

### 2026-03-27: WJW rerun after commit `dc438fc9` removed the last hosted `/tmp` first-shot detour entirely

Deployment:
- local commit:
  - `dc438fc9` (`Harden hosted temp-path routing`)
- pushed to:
  - `origin/dev`
  - `gitee/dev`
- pod:
  - `git pull --ff-only`
  - `bash scripts/recover-pod-runtime.sh --force`
- health after deploy:
  - `http://127.0.0.1:8789/health -> ok`
  - `http://127.0.0.1:32765/openwork/health -> ok`

Rerun scenario:
- `OPENWORK_COMPARE_SCENARIO=wjw OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=raw,pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=20 node tmp/qin-abc-minimax.mjs`

What changed on the hosted route:
- the earlier denied first command:
  - `pandoc ... -o /tmp/bidding.txt`
  is gone
- the new hosted route starts directly with:
  - `bash: ls -la`
  - `bash: mkdir -p .tmp/system`
  - `bash: pandoc ... -o .tmp/system/招标文件.txt`
  - `bash: pandoc ... -o .tmp/system/设备参数.txt`
  - `bash: pandoc ... -o .tmp/system/点对点应答.txt`
- hosted routing diagnostics now show:
  - `issueCounts = {}`
  - `systemTempTouchCount = 0`
  - `externalPathTouchCount = 0`
  - `directOfficeReadCount = 0`

Outcome:
- pod `common-work` completed both deliverables:
  - `outputs/点对点解决方案.md`
  - `outputs/点对点解决方案.docx`
- raw local OpenCode also completed, but the hosted route is now the cleaner of the two:
  - pod:
    - exact workspace-local temp handling from the first conversion command onward
  - raw:
    - still begins with `filesystem_list_directory`
    - still goes through `skill`
    - keeps rereading the same extracted Markdown
    - still produces malformed `export` JSON and forces fallback analysis from `run-jsonl`

Interpretation:
- the remaining Stage 1 / baseline concern around wasted hosted `/tmp` first shots is now closed on the current pod build
- the hosted path is no longer weaker than raw on temp-path handling; it is now stricter and cleaner

### 2026-03-27: fresh Qin raw-vs-pod A/B on the current pod build shows `common-work` is cleaner and faster than local raw OpenCode on this document pair

Scenario:
- `OPENWORK_COMPARE_SCENARIO=qin OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=raw,pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=20 node tmp/qin-abc-minimax.mjs`

Pod `common-work` result:
- elapsed:
  - `201649 ms`
- tool route:
  - `bash = 7`
  - `todowrite = 5`
  - `read = 3`
  - `bocha-search_bocha_web_search = 3`
  - `write = 1`
- diagnostics:
  - `issueCounts = {}`
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
- output:
  - `outputs/融合算力云平台三大系统技术材料.docx`

Raw local OpenCode result:
- elapsed:
  - `267688 ms`
- tool route:
  - `filesystem_list_directory = 1`
  - `skill = 1`
  - `bash = 6`
  - `filesystem_read_multiple_files = 1`
  - `webfetch = 1`
  - `filesystem_write_file = 2`
- diagnostics:
  - `issueCounts = {}`
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
- output:
  - `融合算力云平台技术材料.docx`
- raw-specific weakness still present:
  - `webfetch` hit `https://www.example.com`
  - `export` JSON was malformed again and analysis had to fall back to `run-jsonl`

Interpretation:
- on the Qin scenario, the current pod `common-work` is now materially stronger than local raw OpenCode in the dimensions that matter for the user baseline:
  - cleaner route
  - no irrelevant external fetch detour
  - no malformed export side path
  - faster completion
- the remaining `common-work` optimization target on Qin is no longer baseline correctness
- it is mainly whether the three `bocha-search` calls can be reduced once local document grounding is already sufficient

### 2026-03-27: long-document benchmark corpus was triaged so the next Stage 2 run can start with the highest-signal file instead of the largest file

Corpus metadata snapshot:
- `备-天河产业园一期融合算力系统建设项目CPU、GPU节点及云计算服务器采购投标文件电子版-技术部分-烽火.docx`
  - file size:
    - `103,815,047 bytes`
  - `word/document.xml`:
    - `6,178,684 bytes`
  - zip entries:
    - `558`
  - embedded media:
    - `517`
- `备-环投数科临沂项目第一包v20250507v1.0(1)(1).docx`
  - file size:
    - `51,510,558 bytes`
  - `word/document.xml`:
    - `6,322,076 bytes`
  - zip entries:
    - `332`
  - embedded media:
    - `281`
- `备1-品冠-技术部分V2.docx`
  - file size:
    - `140,810,792 bytes`
  - `word/document.xml`:
    - `12,247,969 bytes`
  - zip entries:
    - `630`
  - embedded media:
    - `568`

Initial recommendation:
- first large benchmark candidate:
  - `备-环投数科临沂项目第一包v20250507v1.0(1)(1).docx`
- why:
  - it is still a large formal投标文件, but materially smaller than the other two container sizes
  - it has a clear front-page title block and project metadata, which makes scope-selection and authority-resolution easier to evaluate
  - it is large enough to stress long-context document handling without jumping straight to the most image-heavy 99MB / 134MB variants

Proposed Stage 2 long-task benchmark questions:
- benchmark A:
  - “请基于这份技术标正文，输出一份‘投标技术方案骨架 + 关键证据矩阵’，至少覆盖总体架构、核心设备能力、交付实施、售后服务、风险与偏离、待确认问题，并给出每一节引用自原文的证据位置。”
- benchmark B:
  - “请把这份长文档改写成可交付的技术方案正文，保留正式投标口径，但删去供应商专属身份信息、报价信息和明显仅适用于原投标人的承诺，输出 Markdown 与 Word 两个版本。”
- benchmark C:
  - “请从这份长文档中抽取一份‘需求-响应-证据-风险’四列表，并额外指出原文里最容易造成后续答标遗漏的 10 个细节项。”

Why these questions are high-signal:
- they stress:
  - authority resolution
  - whole-document reread discipline
  - long-range section dependency handling
  - evidence anchoring
  - stable output-path discipline
- they also make it easy to compare `raw` vs `pod common-work` on:
  - early tool routing
  - whether the agent drifts into generic search too early
  - whether the final artifact preserves formal delivery quality

### 2026-03-27: latest WJW raw-vs-pod A/B shows the hosted baseline is now tighter than raw on external-path behavior, and the only remaining hosted waste in the early route is a denied first `/tmp/*.txt` extraction attempt

Scenario:
- `OPENWORK_COMPARE_SCENARIO=wjw OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=raw,pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=20 node tmp/qin-abc-minimax.mjs`
- summary output:
  - `tmp/compare-agents/wjw-raw-vs-pod-minimax/summary.json`

What the latest A/B proved:
- pod `common-work`:
  - `totalToolCalls = 11`
  - `broadDiscoveryCount = 0`
  - `externalPathTouchCount = 0`
  - `directOfficeReadCount = 0`
  - only recorded issue:
    - `access-denied = 1`
  - the denied call was:
    - `pandoc "招标文件-天津市滨海新区卫生健康委员会天津市滨海新区卫生健康信息化平台项目.docx" -t plain -o /tmp/bidding.txt`
  - the agent then immediately recovered to:
    - `mkdir -p .tmp/system`
    - workspace-local `pandoc ... -o .tmp/system/*.txt`
    - workspace-local `read`
    - workspace-local `grep`
- local raw OpenCode:
  - `totalToolCalls = 8`
  - `directOfficeReadCount = 3`
  - no hosted boundary issue, but it still wasted three early `read` attempts directly against `.docx`
  - it eventually recovered through:
    - a large inline `python-docx` shell step
    - `write`
    - final `pandoc` conversion

Interpretation:
- the user’s highest-risk hosted concerns are not reproducing in this latest WJW A/B:
  - no `external_directory` drift
  - no workspace-external file touch
  - no parent/sibling-session detour
  - no irrelevant runtime skill surface
- the remaining hosted waste is narrower:
  - one first-try `/tmp/*.txt` conversion that gets denied before the route falls back to `<WORKSPACE>/.tmp/system`
- compared with local raw OpenCode, hosted `common-work` is now stricter on:
  - not reading binary Office files directly
  - not leaving the current workspace
- this means the next baseline refinement should target:
  - eliminating that first denied `/tmp` conversion attempt
  - keeping the A/B diagnostics honest about bash commands that mention `/tmp`

Local hardening prepared immediately after this A/B:
- `.opencode/plugins/document-mode-bridge.js`
  - document-heavy sessions now get an earlier, more explicit system rule:
    - create `<WORKSPACE>/.tmp/system` before the first extraction / conversion shell command
    - do not “probe” `/tmp/*` or `/private/tmp/*` first and then recover after a permission denial
- `packages/server/src/session-workspaces.ts`
  - runtime carrier instructions now mirror the same stronger rule, not just the generic “prefer workspace-local temp” wording
- `packages/app/scripts/openwork-compare-diagnostics.mjs`
  - diagnostics now classify bash commands that embed `/tmp/...` or `/private/tmp/...` as `system-temp-touch`
  - this closes the previous observability gap where a denied `pandoc -o /tmp/foo.txt` command showed up only as `access-denied`

Local verification:
- `bun test packages/server/src/session-workspaces.test.ts packages/app/scripts/openwork-compare-diagnostics.test.mjs .opencode/plugins/document-mode-bridge.test.mjs`
- result:
  - `20 pass`
  - `0 fail`
- `git diff --check` is clean for:
  - `packages/server/src/session-workspaces.ts`
  - `packages/server/src/session-workspaces.test.ts`
  - `packages/app/scripts/openwork-compare-diagnostics.mjs`
  - `packages/app/scripts/openwork-compare-diagnostics.test.mjs`
  - `.opencode/plugins/document-mode-bridge.js`
  - `.opencode/plugins/document-mode-bridge.test.mjs`

Current next step:
- commit this `/tmp`-first-route hardening
- push to `origin` and `gitee`
- pod `git pull --ff-only`
- `bash scripts/recover-pod-runtime.sh --force`
- rerun the same WJW low-token A/B to confirm the hosted route no longer burns the first denied `/tmp` extraction call

### 2026-03-27: commit `fc082920` is live on pod, standard recover succeeded, and a fresh default hosted runtime now proves the document-first surface even without session hints

Deployment:
- local commit:
  - `fc082920` (`Prune default hosted session runtime surface`)
- pushed to:
  - `origin/dev`
  - `gitee/dev`
- pod:
  - `git pull --ff-only`
  - `bash scripts/recover-pod-runtime.sh --force`
- current pod health after deploy:
  - `http://127.0.0.1:8789/health -> ok`
  - `http://127.0.0.1:32765/openwork/health -> ok`

Fresh live runtime-surface probe on pod:
- used the deployed pod source directly against a real hosted user workspace:
  - `/root/.openwork/user-workspaces/479bcb92-84e0-4f1f-a88b-5085b1065076`
- created a fresh default runtime via:
  - `provisionSessionWorkspace(workspacePath)` with no preferred-view / preferred-agent hints
- observed generated runtime surface:
  - skills:
    - `doc-coauthoring`
    - `doc-normalize`
    - `docx`
    - `pdf`
    - `pptx`
    - `xlsx`
  - MCP keys:
    - `bocha-search`

Why this matters:
- this closes the gap between:
  - hinted `document-agent/common-work` sessions
  - no-hint default hosted sessions
- the user concern was not just “does the document-agent entry prune correctly”
- it was “will a newly opened session still load a pile of unrelated skills because OpenCode reads everything under `.opencode/skills`”
- the live pod answer on the current build is now:
  - no

Interpretation:
- the user-facing Stage 1 baseline around runtime skill/MCP pruning remains live-green on pod after the latest deploy
- history-session TSX restoration was not touched in this change set and remains covered by the passing regression suite; no new evidence suggests a regression there
- with this deployment complete, the roadmap can go back to Stage 2 parity work instead of more Stage 1 runtime-surface cleanup

### 2026-03-27: local baseline was tightened again so even default hosted sessions now prune to the document-first runtime surface, and document-mode bridge now explicitly forbids `external_directory` detours

What changed locally:
- `packages/server/src/session-workspaces.ts`
  - the hosted runtime default profile no longer falls back to “copy every skill and keep generic MCP”
  - default hosted session runtimes now use the same document-first runtime surface as `document-agent/common-work`:
    - runtime skills:
      - `doc-coauthoring`
      - `doc-normalize`
      - `docx`
      - `pdf`
      - `pptx`
      - `xlsx`
    - runtime MCP allowlist:
      - `bocha-search`
      - `doc_state`
      - `openwork-knowledge`
  - skill mirroring is now driven by the effective runtime allowlist, not by the profile ID alone
- `.opencode/plugins/document-mode-bridge.js`
  - document-heavy sessions now receive an explicit system rule that they must not:
    - call `external_directory`
    - probe parent directories
    - probe sibling session folders
    - probe repo-root files
  - if a needed document is not inside the current workspace, the agent should treat that as missing input rather than “search one level up”

Why this matters:
- the user baseline is stricter than “document-agent sessions are pruned when the right hint arrives”
- OpenCode loads whatever exists under each session runtime `.opencode/skills`
- so if any no-hint / default hosted session still copied the full workspace skill tree, users could still see the same irrelevant-skill problem in real sessions
- pushing the default hosted runtime down to the document-first surface makes the baseline less dependent on UI routing correctness

Local verification completed:
- red/green tests were added first, then the implementation was updated to make them pass
- verification run:
  - `bun test packages/server/src/server.proxy-session-create.test.ts packages/server/src/session-workspaces.test.ts packages/server/src/skills.test.ts packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/context/session.runtime-directory-hydration.test.ts packages/app/src/app/pages/dashboard.history-session-hints.test.mjs packages/app/src/app/app.create-session-runtime-profile.test.ts packages/app/src/app/app.sidebar-session-hints-preserved.test.mjs .opencode/plugins/document-mode-bridge.test.mjs .opencode/plugins/document-normalize.test.mjs packages/app/scripts/doc-subagent-prompts.test.mjs`
  - result:
    - `78 pass`
    - `0 fail`
- `git diff --check` is clean for:
  - `packages/server/src/session-workspaces.ts`
  - `packages/server/src/session-workspaces.test.ts`
  - `packages/server/src/server.proxy-session-create.test.ts`
  - `.opencode/plugins/document-mode-bridge.js`
  - `.opencode/plugins/document-mode-bridge.test.mjs`

Interpretation:
- locally, the baseline is now stronger than the previous “only hinted document sessions are pruned” behavior
- this does not yet count as deployed proof
- the next required step is still:
  - commit
  - push to `origin` and `gitee`
  - pod `git pull --ff-only`
  - recover/restart pod
  - verify live that a fresh default hosted session runtime also exposes only the intended document skill/MCP surface
  - then rerun the low-token parity diagnostics

### 2026-03-27: fresh hosted-vs-local WJW diagnostics isolated a hosted-only `glob` / `grep` / `skill` weakness, so the next mitigation is to route `common-work` around those tool paths by default

Scenario:
- deployed pod commit:
  - `af392cc2`
- pod diagnostic:
  - `OPENWORK_COMPARE_SCENARIO=wjw OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=20 node tmp/qin-abc-minimax.mjs`
- local raw control:
  - `OPENWORK_COMPARE_SCENARIO=wjw OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=raw OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=20 node tmp/qin-abc-minimax.mjs`

What the hosted diagnostic proved:
- pod `common-work` no longer showed the user-feared boundary regressions:
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
- but inside the hosted served runtime, these tools still failed:
  - `glob("**/*")`
  - `skill(name="docx")`
  - `grep(path=.tmp/system, ...)`
- the repeated error recorded in the session DB was:
  - `Unable to connect. Is the computer able to access the url?`
- after those failures, the agent could still keep moving via:
  - `bash`
  - workspace-local `pandoc` extraction into `.tmp/system/*.txt`
  - `read`
  - `bash grep -n`

What the local raw control proved:
- local raw OpenCode on the same materials did not hit the hosted-only `Unable to connect` failures
- local raw still finished a usable deliverable:
  - `点对点解决方案.docx`
  - `点对点解决方案.md`
- this means the remaining parity gap is not just “model habit”; the served hosted runtime still has a real tool-path weakness around `glob` / `skill` / `grep`

Interpretation:
- the current Stage 2 blocker is no longer session isolation, temp-path handling, or runtime skill/MCP overexposure
- the next practical mitigation is to make `common-work` treat:
  - `glob`
  - `grep`
  - ordinary format-skill activation via `skill`
  as non-default routes in hosted document sessions
- once exact file paths or workspace-local extracted text exist, the default route should stay on:
  - exact paths
  - `bash`
  - `read`
  - workspace-local intermediate artifacts

Immediate implementation plan:
- update `common-work` so normal document sessions:
  - do not use `glob` after exact candidate paths are known
  - do not call `grep` when workspace-local extracted text is already available
  - do not call `skill` merely to “activate” `docx` / `pdf` / `xlsx` / `pptx`
- update `document-mode-bridge` so the injected system guidance does not keep nudging the model toward those failing tool paths
- locally verify prompt/plugin tests
- then continue with:
  - push
  - pod pull
  - recover/restart
  - rerun the same low-token WJW diagnostic
  - check whether those hosted-only tool failures disappear
  - only then reassess final output quality and project-scope anchoring

Local implementation completed:
- updated:
  - `.opencode/agent/common-work.md`
  - `.opencode/plugins/document-mode-bridge.js`
  - `.opencode/plugins/document-normalize.test.mjs`
  - `packages/app/scripts/doc-subagent-prompts.test.mjs`
- key local rule changes:
  - ordinary document sessions no longer permit `glob` as a normal discovery route
  - once exact paths exist, `common-work` must stay on exact-path reads and workspace-local intermediates
  - ordinary format handling no longer starts by calling `skill` just to activate `docx` / `pdf` / `xlsx` / `pptx`
  - when extracted workspace-local text already exists, `common-work` now prefers `bash grep -n` / `sed -n` / targeted `read` over the `grep` tool
  - if `glob` / `grep` / `skill` fails once and exact paths already exist, reroute immediately to `bash` + exact path + `read`

Local verification:
- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts packages/server/src/skills.test.ts packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/context/session.runtime-directory-hydration.test.ts packages/app/src/app/pages/dashboard.history-session-hints.test.mjs`
- `node --test .opencode/plugins/document-normalize.test.mjs`

Current next step:
- commit this mitigation
- push to `origin` and `gitee`
- pod `git pull --ff-only`
- recover or restart pod
- rerun the same low-token WJW diagnostic to see whether hosted `glob` / `grep` / `skill` failures are now absent from the early route

### 2026-03-27: first hosted rerun after commit `483bf7eb` removed `glob` / `skill` from the early route and restored project-level output scope, but one hosted `grep` call and one missing-`outputs/` retry still remained

Scenario:
- pod commit:
  - `483bf7eb`
- rerun command:
  - `OPENWORK_COMPARE_SCENARIO=wjw OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=20 node tmp/qin-abc-minimax.mjs`
- session:
  - `ses_2cf138dc7ffe0WafZTY65JvFLP`

What improved materially:
- no `glob` tool call appeared in the route
- no `skill` tool call appeared in the route
- no hosted boundary regressions reappeared:
  - `broadDiscoveryCount = 0`
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
- the output title and file names returned to project scope instead of collapsing to the narrower supporting-file title:
  - `点对点解决方案_滨海新区卫生健康信息化平台.md`
  - `outputs/点对点解决方案_滨海新区卫生健康信息化平台.docx`

What still remained:
- the hosted `grep` tool still fired once and failed with:
  - `Unable to connect. Is the computer able to access the url?`
- the agent then recovered correctly via:
  - `bash grep -n`
- the final `pandoc` route still wasted one call by trying to write:
  - `outputs/点对点解决方案_滨海新区卫生健康信息化平台.docx`
  before creating `outputs/`

Interpretation:
- the first mitigation succeeded on the two worst hosted-only early-route problems:
  - `glob`
  - `skill`
- but it did not yet fully remove the hosted-only `grep` weakness
- there is also still a small avoidable workflow inefficiency around creating the stable output directory before final document generation

Second local mitigation prepared immediately after this rerun:
- strengthen `common-work` from “prefer not to use `grep`” to:
  - ordinary hosted document sessions should not call the `grep` tool at all
  - once workspace-local extracted text exists, use `bash grep -n` / `sed -n` / targeted `read`
- add an explicit rule that if the stable deliverable lives under `outputs/` or another not-yet-created directory, create that directory first before final `pandoc` / copy / move
- mirror the same stronger guidance into `document-mode-bridge`

Second local verification:
- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
- `node --test .opencode/plugins/document-normalize.test.mjs`

Current next step:
- commit the second mitigation
- push to `origin` and `gitee`
- pod `git pull --ff-only`
- recover pod
- rerun the same WJW diagnostic again
- confirm the route is now clean of hosted-only `glob` / `grep` / `skill` failures

### 2026-03-27: first formal Stage 2 A/B on the卫健委 long-document set shows hosted `common-work` is cleaner and faster, but still had one scope-selection weakness

Scenario:
- `OPENWORK_COMPARE_SCENARIO=wjw OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=raw,pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=300000 node tmp/qin-abc-minimax.mjs`
- source docs:
  - `招标文件-天津市滨海新区卫生健康委员会天津市滨海新区卫生健康信息化平台项目.docx`
  - `海滨医院点对点应答.docx`
  - `智慧网络医疗服务项目设备参数9.29(1).docx`

What the first A/B proved:
- hosted `common-work` early route was materially cleaner:
  - no `external_directory` drift
  - no `/tmp` detour
  - no broad-discovery burst
  - 9 tool calls before the diagnostic stop
- local raw OpenCode was materially noisier:
  - started with `glob **/*.docx`
  - 16 tool calls before finishing
  - repeated `read` passes against the same extracted Markdown
  - `export` JSON was malformed again, forcing recovery from `run-jsonl`
- elapsed time:
  - pod `common-work`: ~49s in the first diagnostic
  - local raw OpenCode: ~149s

Where hosted `common-work` was not yet clearly stronger:
- local raw OpenCode completed a full deliverable in that same run
- the first pod diagnostic was intentionally cut by the old `max-tool-calls` threshold before final output write/convert completed

Targeted follow-up for fairness:
- reran pod only with:
  - `OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS=20`
- result:
  - hosted `common-work` also completed full deliverables:
    - `outputs/海滨医院点对点解决方案.md`
    - `outputs/海滨医院点对点解决方案.docx`
  - elapsed time:
    - ~117s
  - still no hosted boundary issues:
    - `externalPathTouchCount = 0`
    - `systemTempTouchCount = 0`
    - `directOfficeReadCount = 0`

The actual Stage 2 weakness this exposed:
- hosted `common-work` anchored the output scope too tightly to the supporting file:
  - `海滨医院点对点应答.docx`
- its final title and narrative collapsed to:
  - `海滨医院点对点解决方案`
- local raw OpenCode kept the broader project frame:
  - `天津市滨海新区卫生健康信息化平台项目`
  - `点对点解决方案`

Interpretation:
- this is no longer a hosted runtime / permission / skill-surface problem
- it is a prompt-level scope-resolution weakness:
  - in multi-document tasks, `common-work` can still let a specific supporting file name override the user objective and the primary招标/需求文档 scope

### 2026-03-27: local prompt fix prepared to keep multi-document scope anchored on the user objective and the primary requirements document

Local fix:
- `common-work` now explicitly states:
  - when the workspace contains a main招标/需求文档 plus supporting files such as sample responses, parameter sheets, product brochures, or historical point-to-point drafts, first use the user objective and the main招标/需求文档 to determine:
    - task scope
    - target title
    - chapter boundary
  - do not collapse the whole deliverable to a narrower sub-scenario just because one supporting file has a more specific filename
  - supporting files default to evidence, terminology, parameters, or writing reference; they do not override the main project scope

Files changed locally:
- `.opencode/agent/common-work.md`
- `packages/app/scripts/doc-subagent-prompts.test.mjs`

Local verification:
- added a new regression test:
  - `common-work keeps multi-document scope anchored on the user objective and the primary requirements document`
- verified passing:
  - `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
  - `git diff --check -- .opencode/agent/common-work.md packages/app/scripts/doc-subagent-prompts.test.mjs research/2026-03-25-document-agent-eval/common-work-document-writer-execution-ledger-2026-03-27.md`

Next deployment step:
- push this prompt fix to `origin` and `gitee`
- pod `git pull --ff-only`
- `bash scripts/restart-pod.sh --force`
- rerun the same `wjw` pod diagnostic to confirm the output scope no longer collapses to the supporting-file title

### 2026-03-27: fresh live verification after commit `4dd229cd` confirms the runtime-root `.git` boundary actually cut off parent user-workspace skill inheritance

Fresh hosted verification target:
- session id:
  - `ses_2cf3b6663ffefBSEwqcz5Rte2C`
- runtime dir:
  - `/root/.openwork/user-workspaces/c503a0f6-a558-41f4-8ba4-899eb1ed6923/documents/sessions/3e6b5b08c2dc4b04ab52f4164f121899`

Observed directly on pod:
- runtime root now physically contains:
  - `.git`
- runtime `.git` contents:
  - `gitdir: .openwork-runtime/git`
- runtime `.opencode/skills` contains only:
  - `doc-coauthoring`
  - `doc-normalize`
  - `docx`
  - `pdf`
  - `pptx`
  - `xlsx`
- runtime `opencode.jsonc` currently exposes only:
  - `bocha-search`
- runtime instructions are only:
  - `.opencode/references/doc-state-schema.md`
  - `.opencode/openwork-runtime.md`

Most important direct-runtime proof:
- a live pod `opencode run --print-logs --log-level DEBUG --agent common-work --format json "只回复ok"` inside that runtime only evaluated:
  - `doc-coauthoring`
  - `doc-normalize`
  - `docx`
  - `pdf`
  - `pptx`
  - `xlsx`
- the earlier inherited parent skills did not appear:
  - no `file-organizer`
  - no `internal-comms`
  - no `mcp-builder`
  - no `openwork-debug`

Interpretation:
- the runtime-root `.git` boundary fix is now live-green on pod
- the user-facing baseline item “new session runtimes should not load irrelevant parent-workspace skills” is now confirmed by both:
  - physical runtime folder inspection
  - direct runtime log evidence

### 2026-03-27: fresh hosted Qin low-token diagnostic shows no remaining external-directory or temp-path regression on the current build

Scenario:
- `OPENWORK_COMPARE_SCENARIO=qin OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=pod OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS=240000 node tmp/qin-abc-minimax.mjs`
- session:
  - `ses_2cf392103ffe2KCupKWuTKglNS`

Results:
- upload completed successfully for both Qin `.docx` sources
- routing diagnostics:
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
  - `repeatedFailureCount = 0`
  - `issueCounts = {}`
- early route:
  - workspace-local `pwd && ls -la`
  - `skill`
  - workspace-local `mkdir -p .tmp/docx-read`
  - workspace-local `pandoc ... -o .tmp/docx-read/*.md`
  - `read` extracted Markdown
  - `bocha-search` x2
  - `todowrite`
  - final `write` aborted only because diagnostic mode intentionally stopped at max tool calls

Interpretation:
- on the current build, the hosted `common-work` baseline no longer shows the user’s feared regressions around:
  - `external_directory`
  - workspace-external file touches
  - `/tmp` conversion probes
  - direct Office-file reads
- the remaining parity work is now mainly about route quality and final-result quality, not hosted boundary correctness

### 2026-03-27: browser-level history re-entry is still live-green on the current pod build

Real browser verification via Playwright CLI on `http://192.168.5.10:32765`:
- login succeeded with the hosted user account
- from `/dashboard/agents`, clicking historical session:
  - `历史会话 ses_2cf71bb1`
- resulting URL:
  - `/document-agent/ses_2cf71bb17ffeBvY6pTCsgMI481`

Related API confirmation:
- session list entries still expose:
  - `openworkPreferredView = document-agent`
  - `openworkPreferredAgent = common-work`
  - `openworkPreferredAgentLock = common-work`

Interpretation:
- the user-facing baseline item “historical sessions must reopen into the correct TSX/view” remains live-green after the runtime-boundary changes
- this baseline is now covered by:
  - server/API metadata
  - real browser navigation evidence

### 2026-03-27: overnight roadmap was pinned to a durable execution ledger and a formal long-document benchmark corpus

User-directed working order now locked here:
- finish the three user-facing baseline items before any broader A/B or `document-writer` work:
  - avoid wasted workspace-external / `external_directory` detours
  - ensure new session runtimes only load the intended document skill and MCP surface
  - ensure historical sessions reopen into the correct TSX/view
- only after that:
  - run local-vs-pod A/B for `common-work`
  - then audit shared code paths before touching `document-writer`
  - then generalize `document-writer` away from Qin-only heuristics into a workflow-enhanced `common-work-plus`

Benchmark corpus selected for the overnight long-document work:
- `/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/备-天河产业园一期融合算力系统建设项目CPU、GPU节点及云计算服务器采购投标文件电子版-技术部分-烽火.docx`
- `/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/备-环投数科临沂项目第一包v20250507v1.0(1)(1).docx`
- `/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/备1-品冠-技术部分V2.docx`

Why these were chosen:
- they are formal, large, and structurally dense `.docx` files
- they are closer to the real “技术方案 / 标书 / 大文档改写与生成” workload than the smaller earlier probes
- they provide a better Stage 2 parity target once the Stage 1 baseline is truly closed

### 2026-03-27: child runtime config sanitization was not enough because OpenCode was still discovering parent user-workspace skills through directory ancestry

What was observed live after the earlier config-dir cleanup:
- a fresh hosted `document-agent/common-work` session still physically had a clean runtime `.opencode/skills` folder
- the isolated child config dir under `.openwork-runtime/opencode/config` was also trimmed
- but direct `opencode run --print-logs --log-level DEBUG` inside the runtime still evaluated many unrelated skills from the parent user workspace, including examples like:
  - `file-organizer`
  - `internal-comms`
  - `mcp-builder`
  - other non-document support skills

Why:
- session runtime directories live under:
  - `<userWorkspace>/documents/sessions/<runtimeId>`
- OpenCode skill discovery was still walking up directory ancestry and finding:
  - `<userWorkspace>/.opencode/skills/*`
- so trimming only the child config dir did not fully isolate the effective runtime skill surface

Live A/B proof of the root cause:
- on a disposable hosted runtime, adding a runtime-root `.git` marker immediately stopped the parent skill inheritance
- after that boundary marker, the same direct debug run only evaluated the runtime-local pruned document skill set

Resolution implemented locally and deployed:
- `packages/server/src/session-workspaces.ts`
  - fresh session runtimes now write a runtime-root `.git` boundary marker during provisioning
- `packages/server/src/session-workspaces.test.ts`
  - now asserts that provisioned session runtimes contain `.git`
- `packages/server/src/skills.test.ts`
  - new regression test proves `listSkills(runtimeDir, false)` stops inheriting parent workspace skills once the runtime-root project boundary exists

Verification already completed locally:
- `bun test packages/server/src/skills.test.ts`
- `bun test packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts packages/server/src/session-opencode-runtime.test.ts`
- `corepack pnpm --filter openwork-server build:bin`

Deployment state:
- commit deployed:
  - `4dd229cd` (`Isolate session runtime project roots`)
- pushed to:
  - `origin/dev`
  - `gitee/dev`
- pod pull + restart succeeded
- pod health after deploy:
  - `http://127.0.0.1:8789/health -> ok`
  - `http://127.0.0.1:32765/openwork/health -> ok`

Interpretation:
- the earlier “Stage 1 baseline is closed” conclusion was premature
- Stage 1 must stay open until fresh hosted runtime evidence confirms that users no longer inherit parent user-workspace skills in real sessions

### 2026-03-27: hosted child runtimes were still inheriting host-global skills, MCP, and opencode-mem

What was observed live:
- the session root for a pod `common-work` diagnostic session was already trimmed correctly:
  - runtime `.opencode/skills` only contained:
    - `doc-coauthoring`
    - `doc-normalize`
    - `docx`
    - `pdf`
    - `pptx`
    - `xlsx`
  - runtime `opencode.jsonc` only exposed:
    - `mcp = ["bocha-search"]`
- but the isolated child runtime config under:
  - `.openwork-runtime/opencode/config/`
  still contained:
  - a large host-global `skills/` tree
  - host-global `plugins/`
  - host-global MCP entries such as `fetch`, `git`, `github`, `chrome-devtools`, `sqlite`, `sequential-thinking`
  - `opencode-mem.jsonc`

Why this matters:
- OpenCode does not only load the session root `.opencode/skills`
- it also loads global `~/.config/opencode/skills` and global plugins/config surfaces
- so the earlier “runtime skill pruning is complete” conclusion was only half true
- this hidden second load surface can still:
  - expose irrelevant tools/skills to hosted sessions
  - create hosted-only routing differences relative to the intended session profile
  - keep document sessions weaker or noisier than the controlled local comparison target

Root cause:
- `SessionOpencodeRuntimeService.seedIsolatedRuntime()` copied the entire host `OPENCODE_CONFIG_DIR` into the child runtime
- the existing sanitization only removed unsafe absolute-root `filesystem` MCP entries
- it did not strip:
  - global `skills/`
  - global `plugins/`
  - global MCP entries in copied `opencode.json`
  - `opencode-mem.jsonc`

What changed locally:
- isolated child runtimes now strip host-global runtime content after seeding:
  - remove copied global `skills/`
  - remove copied global `plugins/`
  - remove copied `opencode-mem.jsonc`
  - rewrite copied `opencode.json/opencode.jsonc` down to the minimal safe runtime carrier:
    - keep provider/model fields
    - drop copied global MCP surface
    - drop copied global plugin/skill loading state

Local verification:
- new red/green coverage added in:
  - `packages/server/src/session-opencode-runtime.test.ts`
- verified passing:
  - `bun test packages/server/src/session-opencode-runtime.test.ts packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts`
  - `bun test packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/context/session.runtime-directory-hydration.test.ts packages/app/src/app/lib/session-view-routing.test.ts packages/app/src/app/app.sidebar-session-hints-preserved.test.mjs`
  - `corepack pnpm --filter openwork-server build:bin`

Interpretation:
- the next live pod verification must confirm both layers are now clean:
  - session root `.opencode/skills`
  - child runtime `.openwork-runtime/opencode/config/*`
- only after that can the remaining hosted `glob` / `skill(docx)` symptoms be judged fairly

### 2026-03-27: hosted bootstrap source inventory was polluted by runtime-internal files, which masked the real local-source set

What was observed:
- a live pod `common-work` diagnostic session had only 2 user-uploaded `.docx` files in the runtime root
- but its bootstrap state claimed `Uploaded 83 source documents`
- `.worktree/sources/manifest.json` included runtime-internal paths such as:
  - `.openwork-runtime/**`
  - `.opencode/**`
  - `.tmp/**`
  - `node_modules` descendants

Why this matters:
- this makes the state surface noisy and untrustworthy for early routing
- if `common-work` is told to read bootstrap state first, a polluted manifest can still push it away from the actual uploaded source docs
- this is a real hosted parity issue, not just a prompt-quality issue

Root cause:
- server-side `refreshBootstrapDocumentState()` bootstrap discovery did not exclude enough hidden/runtime-internal segments
- the repo-owned `init_doc_state.py` bootstrap helper also needed explicit alignment with the same hosted ignore model

What changed locally:
- server bootstrap discovery now ignores hidden/internal runtime paths such as:
  - `.openwork-runtime`
  - `.tmp`
  - `.opencode`
  - `tmp`
  - `artifacts`
  - other hidden segments
- `init_doc_state.py` was aligned to the same hidden/runtime-internal ignore behavior
- `common-work` now explicitly says:
  - if `.worktree/index.json` / `.worktree/sources/manifest.json` already exist, read them before any external search
  - if the manifest is dominated by runtime-internal paths, treat it as noise and fall back to visible user source docs

Local verification:
- `bun test packages/server/src/document.bootstrap-state.test.ts`
- `bun test packages/app/scripts/init-doc-state-script.test.mjs`
- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
- all passing

Interpretation:
- the next pod A/B rerun should be materially cleaner because the state surface itself will no longer tell the agent that dozens of internal runtime files are “uploaded sources”
- only after this fix is deployed does it make sense to judge whether any remaining early `bocha-search` churn is still a pure prompt-routing issue

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

### 2026-03-27: final history re-entry bug required fixing three separate overwrite points before live pod behavior matched the intended view

What still failed after the first history fix:
- the server and runtime profile did return `openworkPreferredView / openworkPreferredAgent / openworkPreferredAgentLock`
- but live pod clicks from `/dashboard/agents` still reopened `/session/:id`

Root causes found and fixed in order:
- `dashboard.tsx` history reopen path still only forwarded `title`, while `session.tsx` had already been updated to forward session hints
- `resolveSessionPreferences()` still let stale stored `{ view: "session" }` suppress a stronger document-session hint from the session list
- `app.tsx` had a later sidebar sync path that rebuilt `SidebarSessionItem[]` from `sessions()` and silently dropped `openworkPreferred*`, overwriting the good metadata before the dashboard could use it

What changed:
- added a shared `buildSessionPreferenceHint()` helper in `packages/app/src/app/lib/session-preferences.ts`
- updated both `packages/app/src/app/pages/session.tsx` and `packages/app/src/app/pages/dashboard.tsx` to use the same hint builder
- changed `resolveSessionPreferences()` so a stale stored `session` view no longer beats a stronger `document-agent` / `document-writer` hint
- updated the sidebar session sync in `packages/app/src/app/app.tsx` to preserve:
  - `openworkPreferredView`
  - `openworkPreferredAgent`
  - `openworkPreferredAgentLock`

Local verification:
- `bun test packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/pages/dashboard.history-session-hints.test.mjs packages/app/src/app/app.sidebar-session-hints-preserved.test.mjs packages/server/src/server.proxy-session-list.test.ts`
- source-file compile filter clean for:
  - `packages/app/src/app/app.tsx`
  - `packages/app/src/app/pages/dashboard.tsx`
  - `packages/app/src/app/pages/session.tsx`
  - `packages/app/src/app/lib/session-preferences.ts`
- `git diff --check -- packages/app/src/app/app.tsx packages/app/src/app/app.sidebar-session-hints-preserved.test.mjs packages/app/src/app/lib/session-preferences.ts packages/app/src/app/lib/session-preferences.test.ts packages/app/src/app/pages/dashboard.tsx packages/app/src/app/pages/session.tsx packages/app/src/app/pages/dashboard.history-session-hints.test.mjs`

Live pod verification after deploy:
- pushed commits:
  - `045b718c` (`Fix dashboard history session view hints`)
  - `c32c0335` (`Let document history hints beat stale session prefs`)
  - `47a04b0e` (`Preserve document history hints in sidebar sync`)
- pod pulled from Gitee and restarted successfully after each step
- final real browser check on `http://192.168.5.10:32765/dashboard/agents` showed:
  - historical entry `ses_2cf999cbdffeICzOQVFR06CeUs`
  - click target text still rendered as `历史会话 ses_2cf999cb`
  - resulting URL now correctly becomes `/document-agent/ses_2cf999cbdffeICzOQVFR06CeUs`

Interpretation:
- Stage 1 baseline item “history sessions reopen into the correct TSX/view” is now live-green on pod
- the remaining work should move to Stage 2 parity testing rather than more Stage 1 routing repair

### 2026-03-27: a fresh live pod runtime-surface probe confirms the current baseline users actually get

Scenario:
- health check:
  - `GET http://192.168.5.10:32765/openwork/health -> 200`
- fresh hosted session created with:
  - `openworkPreferredView=document-agent`
  - `openworkPreferredAgent=common-work`
  - `openworkPreferredAgentLock=common-work`
- resulting live session:
  - `ses_2cf71bb17ffeBvY6pTCsgMI481`

Live pod inspection through `session-workspaces/<workspaceId>.json` and the runtime folder itself:
- stored runtime preferences were:
  - `preferredView = document-agent`
  - `preferredAgent = common-work`
  - `preferredAgentLock = common-work`
- runtime `.opencode/skills` contained only:
  - `doc-coauthoring`
  - `doc-normalize`
  - `docx`
  - `pdf`
  - `pptx`
  - `xlsx`
- runtime `opencode.jsonc` MCP keys were only:
  - `bocha-search`
- runtime instructions were only:
  - `.opencode/references/doc-state-schema.md`
  - `.opencode/openwork-runtime.md`

Interpretation:
- the user-facing baseline for “new common-work/document-agent sessions should not load irrelevant skills” is currently live-green on pod
- the current live pod surface is even tighter than some older notes in this ledger that still mentioned `openwork-knowledge` or `doc_state` as default runtime MCPs
- document-session runtime pruning is therefore not just a local/unit-test property; it is what real hosted sessions are loading right now

### 2026-03-27: Stage 2 low-token Qin A/B now shows the remaining parity gap is search churn, not external-directory drift

Scenario:
- `OPENWORK_COMPARE_SCENARIO=qin OPENWORK_COMPARE_MODE=diagnostic QIN_ABC_LANES=raw,pod node tmp/qin-abc-minimax.mjs`

Results:
- pod `common-work` session:
  - `ses_2cf78da14ffesi3Z4tuN7F4Ki6`
  - `totalToolCalls = 11`
  - `broadDiscoveryCount = 0`
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
  - `repeatedFailureCount = 0`
  - early route:
    - `bash` workspace-local checks
    - `skill`
    - workspace-local `pandoc` extraction into `.tmp/system`
    - `read`
    - `bocha-search` x3
    - `todowrite`
    - final `write` aborted only because diagnostic mode intentionally stopped early
- local raw OpenCode session:
  - `ses_2cf78ebf9ffeuuB5A4r5151prT`
  - `externalPathTouchCount = 0`
  - `systemTempTouchCount = 0`
  - `directOfficeReadCount = 0`
  - notable detours:
    - `webfetch` to a Baidu search URL
    - malformed `export` JSON, forcing the harness to recover final output from `run-jsonl`

Interpretation:
- the hosted `common-work` parity gap is no longer about:
  - `external_directory`
  - `/tmp` reopen failures
  - direct Office file reads
  - unrelated runtime skills/MCP being loaded by default
- the remaining hosted/common-work weakness is mainly early search routing churn after local source documents have already been extracted
- raw local OpenCode still has its own weaknesses (`webfetch` detour and bad `export` JSON), so the parity story is now narrower and more specific than before

### 2026-03-27: regression tests were added to lock the new baseline guarantees

What was added:
- `packages/server/src/server.proxy-session-create.test.ts` now explicitly checks that:
  - preferred document-session hints are stripped before forwarding to bare OpenCode
  - session creation injects:
    - `external_directory -> deny`
    - hosted `/tmp` / `/private/tmp` bash output deny rules
  - fresh `document-agent/common-work` runtime sessions reduce to:
    - runtime skills:
      - `doc-coauthoring`
      - `doc-normalize`
      - `docx`
      - `pdf`
      - `pptx`
      - `xlsx`
    - runtime MCP:
      - `bocha-search`

Verification:
- `bun test packages/server/src/server.proxy-session-create.test.ts packages/server/src/session-workspaces.test.ts`
- `git diff --check -- packages/server/src/server.proxy-session-create.test.ts research/2026-03-25-document-agent-eval/common-work-document-writer-execution-ledger-2026-03-27.md`

Interpretation:
- the current user baseline is now guarded in both places:
  - live pod evidence
  - local regression tests that should catch future backslides before deploy

## Files Touched In Current Stage

- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-workspaces.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-workspaces.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/skills.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/server.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/server.proxy-session-create.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/app.tsx`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/app.sidebar-session-hints-preserved.test.mjs`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/app.create-session-runtime-profile.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/lib/session-preferences.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/lib/session-preferences.test.ts`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/pages/dashboard.tsx`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/pages/dashboard.history-session-hints.test.mjs`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/src/app/pages/session.tsx`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/scripts/openwork-compare-diagnostics.mjs`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/scripts/openwork-compare-diagnostics.test.mjs`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/scripts/doc-subagent-prompts.test.mjs`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/plugins/document-mode-bridge.js`
- `/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/plugins/document-mode-bridge.test.mjs`

## Current Working Rules

- Stage 1 baseline is closed again on the current pod build
- do not start `document-writer` generalization until `common-work` hosted parity is solid
- prefer low-token diagnostics before long full-generation runs
- for hosted regressions, isolate whether the problem is:
  - app routing/view state
  - server provisioning/runtime control
  - OpenCode config compatibility
  - prompt/tool routing
  - project-root / `.opencode` discovery boundaries

## Next Actions

1. Move Stage 2 on to the formal long-document benchmark set under `/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/`, now that the main hosted baseline issues are live-green on WJW and Qin.
2. Focus Stage 2 on:
   - early search churn after local document grounding
   - repeated failure patterns
   - final-result quality and completion quality
   - whether hosted `common-work` stays stronger than local raw OpenCode on much larger formal bid/technical files, not just the medium-size WJW / Qin scenarios
3. For Stage 2 long-document work, use the formal benchmark docs under:
   - `/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/`
4. Keep the hosted baseline checks in the loop while doing Stage 2:
   - runtime `.opencode/skills` remains physically pruned
   - runtime MCP surface stays trimmed
   - history re-entry remains correct
5. Do not begin Stage 3 / `document-writer` work until `common-work` is demonstrably at least as strong as local raw OpenCode on the chosen document benchmarks.
