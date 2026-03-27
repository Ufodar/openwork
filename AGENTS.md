# AGENTS.md

OpenWork helps users run agents, skills, and MCP. It is an open-source alternative to Claude Cowork/Codex as a desktop app.

## What OpenWork Is

OpenWork is a practical control surface for agentic work:

* Run local and remote agent workflows from one place.
* Use OpenCode capabilities directly through OpenWork.
* Compose desktop app, server, and messaging connectors without lock-in.
* Treat the OpenWork app as a client of the OpenWork server API surface.
* Connect to hosted workers through a simple user flow: `Add a worker` -> `Connect remote`.

## Core Philosophy

* **Local-first, cloud-ready**: OpenWork runs on your machine in one click and can connect to cloud workflows when needed.
* **Server-consumption first**: the app should consume OpenWork server surfaces (self-hosted or hosted), not invent parallel behavior.
* **Composable**: use the desktop app, WhatsApp/Slack/Telegram connectors, or server mode based on the task.
* **Ejectable**: OpenWork is powered by OpenCode, so anything OpenCode can do is available in OpenWork, even before a dedicated UI exists.
* **Sharing is caring**: start solo, then share quickly; one CLI or desktop command can spin up an instantly shareable instance.

## Core Runtime Model (Updated)

OpenWork now has three production-grade ways to run the same product surface:

1. **Desktop-hosted app/server**
   - OpenWork app runs locally and can host server functionality on-device.
2. **CLI-hosted server (openwork-orchestrator)**
   - OpenWork server surfaces can be provided by the orchestrator/CLI on a trusted machine.
3. **Hosted OpenWork Cloud server**
   - OpenWork-hosted infrastructure provisions workers and exposes the same remote-connect semantics.

User mental model:

* The app is the UI and control layer.
* The server is the execution/control API layer.
* A worker is a remote runtime destination.
* Connecting to a worker happens through `Add worker` -> `Connect remote` using URL + token (or deep link).

Read INFRASTRUCTURE.md

## Why OpenWork Exists

**Cowork is closed-source and locked to Claude Max.** We need an open alternative.
**Mobile-first matters.** People want to run tasks from their phones, including via messaging surfaces like WhatsApp and Telegram through OpenCode Router.
**Slick UI is non-negotiable.** The experience must feel premium, not utilitarian.

## Agent Guidelines for development

* **Purpose-first UI**: prioritize clarity, safety, and approachability for non-technical users.
* **Parity with OpenCode**: anything the UI can do must map cleanly to OpenCode tools.
* **Prefer OpenCode primitives**: represent concepts using OpenCode's native surfaces first (folders/projects, `.opencode`, `opencode.json`, skills, plugins) before introducing new abstractions.
* **Web parity**: anything that mutates `.opencode/` should be expressible via the OpenWork server API; Tauri-only filesystem calls are a fallback for host mode, not a separate capability set.
* **Self-referential**: maintain a gitignored mirror of OpenCode at `vendor/opencode` for inspection.
* **Self-building**: prefer prompts, skills, and composable primitives over bespoke logic.
* **Open source**: keep the repo portable; no secrets committed.
* **Slick and fluid**: 60fps animations, micro-interactions, premium feel.
* **Mobile-native**: touch targets, gestures, and layouts optimized for small screens.

## Task Intake (Required)

Before making changes, explicitly confirm the target repository in your first task update.

Required format:

1. `Target repo: <path>` (for example: `_repos/openwork`)
2. `Out of scope repos: <list>` (for example: `_repos/opencode`)
3. `Planned output: <what will be changed/tested>`

If the user request references multiple repos and the intended edit location is ambiguous, stop after discovery and ask for a single repo target before editing files.

## Markdown And Prompt Editing (Required)

When editing `.md` files that act as prompts, instructions, plans, or contracts, do not treat the task as a local line patch.

Required discipline:

* Read the whole file before editing.
* Optimize for full-document coherence, not just the nearby block being changed.
* Remove or rewrite stale surrounding text if a local change would leave duplication, contradiction, dead guidance, or attention noise.
* Prefer fewer strong rules over long overlapping lists.
* After editing, re-read the full file and verify headings, ordering, cross-references, and overall logic still make sense.

## New Feature Workflow (Required)

When the user asks to create a new feature, follow this exact procedure:

1. Make sure you are up to date on all submodules and repos synced to the head of remotes.
2. Create a worktree.
3. Implement the feature.
4. Start the OpenWork dev stack via Docker (from the OpenWork repo root): `packaging/docker/dev-up.sh`.
5. Use Chrome MCP to fully test the feature: `.opencode/skills/openwork-docker-chrome-mcp/SKILL.md`.
6. Take screenshots and put them in the repo.
7. Refer to these screenshots in the PR (only if relevant in the UI).
8. Always test the flow you just implemented.

If you cannot complete steps 4-8 (Docker, Chrome MCP, missing credentials, or environment limitations), you must say so explicitly and include:

* which steps you could not run and why
* what you verified instead (tests, logs, manual checks)
* the exact commands/steps the user should run to complete the end-to-end gate

## Pull Request Expectations (Fast Merge)

If you open a PR, you must run tests and report what you ran (commands + result).

To maximize merge speed, include evidence of the end-to-end flow:

* Ideally: attach a short video/screen recording showing the flow running successfully.
* Otherwise: screenshots are acceptable, but video is preferred.

If you cannot run tests or capture the video, say so explicitly and explain why, and include the exact commands/steps for the reviewer to reproduce.

## Living Systems

OpenWork aims to be a **living system**: agents, skills, commands, and config are hot-reloadable while sessions are running. This enables agents to create new skills or update their own configuration and have changes take effect immediately, without tearing down active sessions.

Design principles for hot reload:

* **Conservative triggers**: only reload when a file that OpenCode reads at startup actually changes inside `.opencode/` or `opencode.json`. Ignore metadata files like `openwork.json`, `.DS_Store`, etc.
* **Workspace-scoped**: reload state is keyed per workspace. Switching workspaces never leaks reload signals from one workspace to another.
* **Session-aware**: when sessions are actively running, queue reload signals. Promote to visible reload (toast or auto-reload) only after all active sessions finish. This avoids interrupting in-flight tool calls.
* **Auto-reload setting**: each workspace can opt into automatic reload via `.opencode/openwork.json` (`reload.auto`). When enabled, the engine reloads automatically once queued signals are ready and no sessions are active.
* **Session continuity**: before reload, capture running session IDs, agents, and models. After reload, optionally relaunch those sessions so the user experiences seamless continuity.
* **Per-workspace isolation**: the desktop file watcher only watches the active workspace root and its `.opencode/` directory. The server reload event store is already keyed by `workspaceId`.

## Hosted Runtime Constraints

For the current multi-user hosted deployment model, treat these as product constraints, not implementation details:

* **User isolation**: each authenticated user gets a dedicated workspace root under `~/.openwork/user-workspaces/<userId>`.
* **Session isolation**: each new session gets its own runtime workspace under `<userWorkspace>/documents/sessions/<runtimeId>`. Do not assume the directory name equals the OpenCode `sessionId`; the server persists a `sessionId -> runtimeDir` mapping.
* **Workspace terminology**: in current hosted mode, the active OpenCode workspace for a running task is the current session runtime directory. Prefer the term `<WORKSPACE>` over ad-hoc terms like `<SESSION_ROOT>`.
* **Document placement**: uploaded files, generated files, and session-scoped temp files should live inside the current session workspace. Avoid designing flows that rely on a shared cross-session document root.
* **File safety boundary**: session isolation relies on the runtime workspace plus `external_directory=deny`. This protects OpenCode file tools from crossing session boundaries, but it is not a full container sandbox.
* **Shell boundary**: `bash` still runs in the shared pod environment unless a stronger sandbox is introduced. Do not assume shell commands are confined the same way file tools are.
* **Shared system toolchain**: hosted sessions share the pod's installed system environment. `scripts/start-pod.sh` provisions the common toolchain on a fresh pod. `scripts/restart-pod.sh` reuses that environment, warns if optional document helpers are missing, and may refresh repo dependencies after a pull, but it is not a full environment bootstrap.
* **Shared global modules**: pod startup exports global npm modules via `NODE_PATH`, so session-local `node` processes can resolve preinstalled global packages. Prefer using the shared environment before adding per-session installs.
* **Model default**: the current hosted default model is `my-company/Qwen3.5-397B-A17B`. `Kimi-K2.5` and `GLM-5` are retired in this deployment path and should not be reintroduced as active defaults without an explicit product decision.

## Pod Deployment Discipline (Required)

Treat the repository as the source of truth for hosted behavior. Do not normalize a workflow where code is changed locally and then hand-copied into the pod as the primary deployment path.

Required discipline:

* **Default path is repo-first**: implement and verify in the repo, push the change, then update the pod by pulling the repo and rebuilding/restarting as needed.
* **Pod-only edits are emergency-only**: direct edits under `/root/ai_staff/openwork`, `~/.config/openwork`, or a hosted user workspace are allowed only to diagnose or unblock a live system, not as the steady-state development path.
* **Emergency pod edits must be reconciled immediately**: if you make a pod-local hotfix, copy the same change back into the repo in the same session, record it in the active `research/...` archive, and do not treat the pod as “fixed” until the repo copy exists too.
* **Do not trust dirty pod state as product truth**: if the deployed pod repo is dirty, stale, or ahead of the checked-out repo, treat hosted test conclusions as provisional until source, deployed repo copy, and active hosted workspace assets are re-aligned.
* **Hosted validation must name the deployment path**: when reporting hosted results, say whether they came from a proper repo sync (`push/pull/build` or equivalent) or from an emergency pod-local patch. Do not blur those into the same class of evidence.

## Document-Agent Evaluation Discipline

When evaluating or tuning long-running document agents, treat these as repo rules rather than ad-hoc preferences:

* **Pressure tests are not product narrowing**: real-user samples (for example proposal packages or bid documents) are valid pressure tests, but do not hard-code the system so it only performs well on that sample family.
* **Keep sample specifics out of shared product logic**: filenames, customer names, project names, named systems, exact sample section titles, and domain heuristics discovered from one evaluation sample must not be hard-coded into shared prompts, shared skills, shared scripts, or default runtime config unless they are part of an explicit product contract that clearly generalizes beyond that sample.
* **Sample-specific code must stay quarantined**: if a comparison run needs one-off scaffolding, keep it in clearly labeled evaluation-only harnesses, fixtures, or `research/**` notes. Do not let sample-specific logic quietly migrate into `.opencode/skills/openwork-core/**`, shared agent prompts, or other repo-wide execution paths.
* **Abstract before shipping**: if a test sample reveals a useful behavior, rewrite it as a capability-level rule (for example multi-system coverage checks, authority-vs-background source handling, exact-heading preservation, or matrix-style section verification) instead of shipping the sample's concrete nouns and structure as hidden defaults.
* **Final artifact quality is the real optimization target**: A/B/C lanes (`raw`, `common-work`, `document-writer`) are diagnostic tools, not loyalties. If another lane exposes a better generalizable behavior, adopt it into OpenWork rather than defending the current lane.
* **Use the same baseline when comparing**: for A/B/C comparisons across raw OpenCode, `common-work`, and `document-writer`, keep model choice, permission posture, and major tool availability aligned before drawing conclusions from behavior differences.
* **Do not confuse route choice with capability loading**: if one lane does not proactively call a global skill or overlay, first prove whether the capability is absent or merely suppressed by the active agent prompt/routing policy before blaming runtime/config loading.
* **Record the runtime baseline every round**: every comparison round must write down the actual OpenCode version, active model, global permission posture, critical MCP availability (`bocha-search`, memory, other task-relevant MCPs), and any global skill overlays that materially change routing or questioning behavior before interpreting the result.
* **Permission posture is part of the baseline, not an afterthought**: if raw OpenCode or hosted OpenWork is blocked by `ask`/`deny` permission posture during a comparison run, fix or explicitly record that baseline mismatch before using the run as quality evidence.
* **Keep comparison models narrow**: for current hosted and compare work, prefer `my-company/Qwen3.5-397B-A17B`; `MiniMax-2.5` is the only accepted backup when Qwen is unavailable; do not use `Kimi-K2.5`.
* **`bocha-search` is the required external-search path**: for proposal-style external supplements, policy references, standards references, and API references, treat `bocha-search` as the system search tool. If it fails, surface that failure explicitly as a blocker or system issue.
* **Record critical MCP outcomes per environment**: if a key MCP such as `bocha-search` works in pod/hosted OpenWork but fails on the local machine (or vice versa), record those outcomes separately. Do not collapse local network failures and hosted runtime results into one product conclusion.
* **No hidden search fallback**: do not add or keep secondary search fallbacks just to make a run “complete.” A fake success is worse than an explicit blocker for this class of task.
* **No dangerous operational fallback without an explicit decision**: do not quietly bypass critical system tools, MCPs, or permission posture mismatches with local stubs, alternate services, or “just for testing” shims unless the repo has an explicit documented decision saying that fallback is part of the product.
* **No simulated research**: do not fabricate “模拟搜索结果,” hand-write an industry-practice list, invent vendor comparisons, or synthesize API examples and then present them as if they came from search or external authority.
* **No fake authority via generic pages**: do not substitute a generic homepage, landing page, mirror page, repost, community blog, or arbitrary `webfetch` hit for the authority the task actually requires.
* **Block honestly**: if external evidence is required and the system toolchain cannot retrieve it, say exactly what is blocked, what evidence is missing, and why the section cannot be strengthened yet.
* **Keep an evaluation archive**: for multi-round document-agent testing, maintain a dated folder under `research/` with `README`, `handoff`, `run-ledger`, `findings`, `resolutions`, `decisions`, and `status` so later sessions can continue without rediscovering the same context.
* **Every effective round must be written down before the next round**: after any run that changes your understanding, update `run-ledger.md` first, then update `findings.md`, `decisions.md`, `resolutions.md`, or `status.md` as needed before continuing.
* **Contradicting evidence beats prior hypotheses**: if a later rerun disproves an earlier theory, update the archive and stop treating the old theory as fact. Do not patch production code around an unproven hypothesis.
* **Hosted evidence requires runtime asset verification**: local edits under `.opencode/` are not hosted proof by themselves. Before trusting a hosted result, verify the changed prompt/script exists both in the deployed repo copy and in the target user workspace copy that the hosted run actually loaded.
* **Surface consumed supplements in the final deliverable**: if `reports/doc-writer/external-supplements.md` was materially consumed, the final document must surface those references in `参考与依据/联网补充依据`; do not leave generic `如需进一步补充` / `建议联网检索` placeholders.
* **Distinguish authority from background context**: if only reposts, portal news, or community summaries are available for part of a topic, label them as background references rather than presenting them as first-party authority.
* **Audit `fallback` by concrete path, not by keyword alone**: a `fallback` string can refer to model resolution, state-surface lookup, generic section naming, or other non-search control flow. Only treat it as a forbidden search fallback when the concrete runtime path proves it is being used to bypass required external evidence.

## Technology Stack

| Layer                | Technology                |
| -------------------- | ------------------------- |
| Desktop/Mobile shell | Tauri 2.x                 |
| Frontend             | SolidJS + TailwindCSS     |
| State                | Solid stores + IndexedDB  |
| IPC                  | Tauri commands + events   |
| OpenCode integration | Spawn CLI or embed binary |

## Repository Guidance

* Use `VISION.md`, `PRINCIPLES.md`, `PRODUCT.md`, `ARCHITECTURE.md`, and `INFRASTRUCTURE.md` to understand the "why" and requirements so you can guide your decisions.

## Dev Debugging

* If you change `packages/server/src`, rebuild the OpenWork server binary (`pnpm --filter openwork-server build:bin`) because `openwork` (openwork-orchestrator) runs the compiled server, not the TS sources.
* If you touch session isolation, event streaming, or message rendering, remember that runtime sessions are scoped by directory. Real-time updates must subscribe to the selected session runtime directory as well as the workspace root; otherwise new messages may only appear after a manual refresh.
* When debugging hosted document flows, prefer verifying against the current session workspace path rather than assuming legacy shared `documents/sessions/<sessionId>` behavior.
* When debugging hosted prompt/script changes, verify all three layers before drawing conclusions:
  - local repo source
  - deployed repo copy on the pod
  - active hosted user workspace copy under `~/.openwork/user-workspaces/<userId>`
  Stale hosted assets can create false greens and false negatives.
* When debugging OpenCode agent behavior, verify the actual runtime entry files before drawing conclusions. OpenCode loads agent definitions from `.opencode/agent/*.md`; do not assume a prompt under `.opencode/prompts/` is active unless the wiring proves it.
* When debugging hidden `doc-*` subagents, verify the matching `opencode.json` / `opencode.jsonc` tool and permission block before blaming the prompt. A runtime deny in the concrete subagent config outweighs prompt prose that says a file or tool is available.
* When debugging comparison harnesses, do not “fix” product code until the harness names the failing step. Generic `fetch failed` / `socket hang up` evidence is insufficient to conclude a runtime bug without a step-specific repro.
* When auditing or regenerating pod/global OpenCode config, load the runtime env files first. Do not run `scripts/sync-global-opencode-config.py` naked on a pod and then trust the output; verify whether provider API keys, permission posture, and critical MCP config were preserved.

## Local Structure

```
openwork/
  AGENTS.md                    # This file
  VISION.md                     # Product vision and positioning
  PRINCIPLES.md                 # Decision framework and guardrails
  PRODUCT.md                    # Requirements, UX, and user flows
  ARCHITECTURE.md               # Runtime modes and OpenCode integration
  .gitignore                    # Ignores vendor/opencode, node_modules, etc.
  .opencode/
  packages/
    app/
      src/
      public/
      pr/
      prd/
      package.json
    desktop/
      src-tauri/
      package.json
```

## OpenCode SDK Usage

OpenWork integrates with OpenCode via:

1.  **Non-interactive mode**: `opencode -p "prompt" -f json -q`
2.  **Database access**: Read `.opencode/opencode.db` for sessions and messages.

Key primitives to expose:

* `session.Service` — Task runs, history
* `message.Service` — Chat bubbles, tool calls
* `agent.Service` — Task execution, progress
* `permission.Service` — Permission prompts
* `tools.BaseTool` — Step-level actions

## Safety + Accessibility

* Default to least-privilege permissions and explicit user approvals.
* Provide transparent status, progress, and reasoning at every step.
* WCAG 2.1 AA compliance.
* Screen reader labels for all interactive elements.

## Performance Targets

| Metric                 | Target         |
| ---------------------- | -------------- |
| First contentful paint | <500ms         |
| Time to interactive    | <1s            |
| Animation frame rate   | 60fps          |
| Interaction latency    | <100ms         |
| Bundle size (JS)       | <200KB gzipped |

## Skill: SolidJS Patterns

When editing SolidJS UI (`packages/app/src/**/*.tsx`), consult:

* `.opencode/skills/solidjs-patterns/SKILL.md`

This captures OpenWork’s preferred reactivity + UI state patterns (avoid global `busy()` deadlocks; use scoped async state).

## Skill: Trigger a Release

OpenWork releases are built by GitHub Actions (`Release App`). A release is triggered by pushing a `v*` tag (e.g. `v0.1.6`).
`Release App` can also publish openwork-orchestrator sidecars and npm packages when enabled via workflow inputs or repo vars (`RELEASE_PUBLISH_SIDECARS`, `RELEASE_PUBLISH_NPM`).

### Standard release (recommended)

1.  Ensure `main` is green and up to date.
2.  Bump versions (keep these in sync):

* `packages/app/package.json` (`version`)
* `packages/desktop/package.json` (`version`)
* `packages/orchestrator/package.json` (`version`, publishes as `openwork-orchestrator`)
* `packages/desktop/src-tauri/tauri.conf.json` (`version`)
* `packages/desktop/src-tauri/Cargo.toml` (`version`)

You can bump all three non-interactively with:

* `pnpm bump:patch`
* `pnpm bump:minor`
* `pnpm bump:major`
* `pnpm bump:set -- 0.1.21`

3.  Merge the version bump to `main`.
4.  Create and push a tag:
    * `git tag vX.Y.Z`
    * `git push origin vX.Y.Z`

This triggers the workflow automatically (`on: push.tags: v*`).

### Re-run / repair an existing release

If the workflow needs to be re-run for an existing tag (e.g. notarization retry), use workflow dispatch:

* `gh workflow run "Release App" --repo different-ai/openwork -f tag=vX.Y.Z`

### Verify

* Runs: `gh run list --repo different-ai/openwork --workflow "Release App" --limit 5`
* Release: `gh release view vX.Y.Z --repo different-ai/openwork`

Confirm the DMG assets are attached and versioned correctly.

## Skill: Publish openwork-orchestrator (npm)

This is usually covered by `Release App` when `publish_sidecars` + `publish_npm` are enabled. Use `.opencode/skills/openwork-orchestrator-npm-publish/SKILL.md` for manual recovery or one-off publishing.

1.  Ensure the default branch is up to date and clean.
2.  Bump `packages/orchestrator/package.json` (`version`).
3.  Commit the bump.
4.  Build and upload sidecar assets for the same version tag:
    * `pnpm --filter openwork-orchestrator build:sidecars`
    * `gh release create openwork-orchestrator-vX.Y.Z packages/orchestrator/dist/sidecars/* --repo different-ai/openwork`
5.  Publish:
    * `pnpm --filter openwork-orchestrator publish --access public`
6.  Verify:
    * `npm view openwork-orchestrator version`
