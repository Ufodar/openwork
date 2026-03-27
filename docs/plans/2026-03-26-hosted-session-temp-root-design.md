# Hosted Session Temp Root Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make hosted OpenWork sessions default to workspace-local temporary artifacts instead of system `/tmp`, while preserving per-session isolation and without forcing any particular search MCP.

**Architecture:** Hosted sessions already provision a dedicated runtime directory under `documents/sessions/<runtimeId>`. This change strengthens that model by creating a session-local temp root inside the runtime directory, attaching a runtime instruction file that points all agents toward that temp root, and tightening hosted external-directory handling so file tools no longer rely on `/tmp` allowances. `common-work` remains a quality/semantics layer, not the primary safety boundary.

**Tech Stack:** `packages/server` session provisioning and proxy code, runtime `opencode.json(c)` overlays, hosted session tests, prompt contract tests.

---

## Problem

Current hosted behavior still leaks too much responsibility to prompts:

- Sessions do run inside isolated runtime directories.
- But agents can still decide to write intermediate text to `/tmp`.
- Hosted file tools then reject those paths because they are outside the runtime workspace.
- This causes noisy recoveries and makes agent behavior depend too heavily on prompt compliance.

This is the wrong abstraction boundary. The runtime should make the correct temp location the path of least resistance.

## Design

### 1. Session-local temp root

For every hosted session runtime, provision:

- `<WORKSPACE>/.tmp/system`

This directory is the default scratch space for extracted markdown, converted text, unpacked XML, and other ephemeral artifacts that still need to be consumed by file tools later in the flow.

### 2. Runtime instruction carrier

Add a generated runtime instruction file under:

- `.opencode/openwork-runtime.md`

This instruction is attached to every hosted runtime config and should say, at a minimum:

- the current runtime directory is the active workspace root
- hosted temp artifacts that may be reread by tools should stay under `<WORKSPACE>/.tmp/`
- do not route file-tool follow-up reads through `/tmp` or `/private/tmp`

This is still prompt-level guidance, but it is runtime-scoped and agent-agnostic instead of being buried only in `common-work.md`.

### 3. Hosted external-directory rule tightening

Remove hosted special-casing that explicitly allows `/tmp/*` and `/private/tmp/*` through `external_directory`.

Hosted sessions should instead use:

- deny all external directories
- rely on runtime workspace local `.tmp/` for temporary artifacts

This keeps the safety model consistent: if something needs to be reread by OpenCode file tools, it belongs inside the runtime workspace.

### 4. Search MCP stance

Do **not** force Bocha usage.

Bocha should remain available as a configured MCP. The fix in this change is about temp-path correctness and hosted runtime isolation, not about mandating a particular search tool.

### 5. Prompt cleanup

`common-work.md` should be aligned with the runtime model:

- remove Bocha-first or Bocha-mandatory language
- stop describing `/tmp` as a generally acceptable hosted temp location
- keep only high-level semantic guidance

## Verification

Target verification after implementation:

1. Hosted runtime provisioning test shows:
   - `.tmp/system` exists
   - runtime config includes `.opencode/openwork-runtime.md`

2. Hosted proxy/session-create test shows:
   - runtime configs carry the runtime instruction
   - no `/tmp/*` external-directory exceptions remain in session permission rules

3. Prompt contract test shows:
   - `common-work` no longer frames Bocha as mandatory
   - `common-work` now prefers workspace-local temp paths for hosted follow-up reads

4. Live Qin baseline rerun should no longer show hosted file-tool attempts to read `/tmp/...` paths.
