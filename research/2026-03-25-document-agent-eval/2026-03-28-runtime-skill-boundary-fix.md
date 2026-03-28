# 2026-03-28 Runtime Skill Boundary Fix

## Goal

Clarify the boundary between:

- development-only skills used to work on the OpenWork repo
- production user-facing skills loaded into hosted document sessions
- runtime-only helper scripts needed by the `document-writer` workflow

The immediate product requirement was narrow and concrete: after code sync and pod restart, a newly created hosted `document-writer` session must no longer load development-only skills such as `openwork-core`.

## Root Cause

Two separate concerns had been coupled inside one directory:

- `.opencode/skills/openwork-core/SKILL.md` is development guidance for working on the OpenWork codebase
- `.opencode/skills/openwork-core/scripts/*.py` were being used as production document-state helper scripts

At the same time, `packages/server/src/session-workspaces.ts` explicitly added `openwork-core` to the `document-writer` runtime `skillAllowlist`, so hosted writer runtimes copied the full skill directory into `.opencode/skills/`.

That meant the same repo path was serving both development semantics and production runtime semantics.

## Evidence

### Pod runtime evidence

A hosted probe created a fresh `document-writer` session and inspected the runtime profile plus skill directory from inside the session runtime. The runtime reported:

- `id = document-writer`
- `skillAllowlist = [doc-coauthoring, doc-normalize, docx, pdf, pptx, xlsx, openwork-core]`

The same probe showed the runtime skill directory contained:

- `./.opencode/skills/openwork-core/SKILL.md`

So the problem was not theoretical; a fresh production session on pod really was loading the development skill.

### Inheritance boundary evidence

OpenCode skill discovery in this repo walks upward until a `.git` boundary. Hosted session runtimes already write a runtime-local `.git` marker. The test coverage in `packages/server/src/skills.test.ts` confirms that once the runtime boundary exists, session skill discovery stops there and does not continue inheriting the parent workspace skill tree.

So the main bug was not parent inheritance after runtime creation; it was the runtime mirror allowlist itself.

## Decision

Do not keep patching around the problem by merely hiding `openwork-core` in the UI.

Instead:

1. Keep `openwork-core` as a development-only skill.
2. Move document-state helper scripts out of `.opencode/skills/openwork-core/`.
3. Mirror those helpers into hosted writer runtimes through a non-skill internal path.
4. Remove `openwork-core` from the hosted writer runtime `skillAllowlist`.

## Implementation

### Runtime layout

Added:

- `.opencode/runtime-support/document-state/`

Moved document-state helpers there:

- `init_doc_state.py`
- `extract_doc_state.py`
- `merge_doc_state.py`
- `plan_doc_state.py`
- `verify_doc_state.py`

Deleted the old production helper copies from:

- `.opencode/skills/openwork-core/scripts/`

### Runtime mirroring

Updated `packages/server/src/session-workspaces.ts`:

- added `.opencode/runtime-support` to mirrored runtime support directories
- removed `openwork-core` from `DOCUMENT_WRITER_SESSION_SKILL_ALLOWLIST`
- mirrored `runtime-support` only for `document-writer` runtimes

### Prompt contracts

Updated `document-writer` and the `doc-*` prompts so repo-owned helper resolution now points to:

- `./.opencode/runtime-support/document-state/<script-name>`

and no longer points to:

- `./.opencode/skills/openwork-core/scripts/<script-name>`

## Validation

Local validation passed:

- `bun test packages/server/src/session-workspaces.test.ts packages/app/scripts/doc-subagent-prompts.test.mjs packages/app/scripts/init-doc-state-script.test.mjs packages/app/scripts/merge-doc-state-script.test.mjs packages/app/scripts/plan-doc-state-script.test.mjs packages/app/scripts/verify-doc-state-script.test.mjs`
- `python3 -m py_compile .opencode/runtime-support/document-state/*.py`
- `node --check packages/app/scripts/doc-subagent-simulate.mjs`
- `node --check packages/app/scripts/doc-agent-live-compare.mjs`
- `git diff --check -- ...`

Key assertions now covered by tests:

- document-writer runtimes keep runtime support helpers
- document-writer runtimes no longer keep `openwork-core` as a skill
- prompt contracts reference runtime-local support paths
- helper script tests execute against the new runtime-support location

### Pod deployment validation

After pushing commit `ab33f873` to GitHub and Gitee, pod verification uncovered one deployment-specific trap:

- `scripts/recover-pod-runtime.sh` reused existing build outputs, so the first pod rollout still ran the old compiled server binary.
- A subsequent full restart also initially inherited `OPENWORK_REUSE_BUILD=1` from pod env and failed health checks while still reusing stale outputs.
- Running `OPENWORK_REUSE_BUILD=0 bash scripts/restart-pod.sh --force` via the pod SSH entrypoint forced a fresh frontend + backend rebuild and restored healthy service.

Fresh pod health after the forced rebuild:

- `http://127.0.0.1:8789/health -> {"ok":true,...}`
- `http://192.168.5.10:32765/openwork/health -> {"ok":true,...}`

### Hosted runtime verification result

The final production check must create the session through the raw OpenWork `POST /session` endpoint, not through the SDK helper that only forwards the typed `title` payload.

This matters because a probe that used `client.session.create({... openworkPreferredView ...})` silently created a default runtime session with:

- `preferredView = null`
- `preferredAgent = null`
- `preferredAgentLock = null`

That probe was invalid for verifying the `document-writer` profile.

Using a raw `POST /w/<workspaceId>/opencode/session` body with:

- `openworkPreferredView = document-writer`
- `openworkPreferredAgent = document-writer`
- `openworkPreferredAgentLock = document-writer`

produced a fresh hosted runtime whose stored session mapping and runtime files showed:

- `preferredView = "document-writer"`
- `preferredAgent = "document-writer"`
- `preferredAgentLock = "document-writer"`
- `skillAllowlist = [doc-coauthoring, doc-normalize, docx, pdf, pptx, xlsx]`
- `.opencode/runtime-support/document-state/*.py` present
- `.opencode/skills/openwork-core/SKILL.md` absent

## Product Conclusion

For hosted production sessions, `openwork-core` should no longer be treated as part of the user runtime skill surface.

After deployment, the verified production result for a fresh `document-writer` session is:

- runtime support helpers present under `.opencode/runtime-support/document-state/`
- document-focused user skills present under `.opencode/skills/`
- no `openwork-core` skill in the session runtime skill directory
