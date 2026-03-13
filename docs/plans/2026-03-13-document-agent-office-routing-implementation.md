# Document Agent Office Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add minimal, durable Office/PDF routing guardrails to the default document-agent flow without duplicating skill internals.

**Architecture:** Put universal document-task rules in `common-work`, bid-domain routing in `document-writer`, and first-pass tender-analysis guardrails in `bid-analysis`. Keep `docx` / `xlsx` / `pptx` / `pdf` as the authoritative format-specific procedures.

**Tech Stack:** Markdown agent instructions, Markdown skill instructions, git diff verification

---

### Task 1: Document the approved design

**Files:**
- Create: `docs/plans/2026-03-13-document-agent-office-routing-design.md`
- Create: `docs/plans/2026-03-13-document-agent-office-routing-implementation.md`

**Step 1: Write the design note**

Capture:

- why `common-work` must be updated
- why `document-writer` is necessary but not sufficient
- why Office-format details remain in skills
- how future plugins fit into the layering

**Step 2: Verify files exist**

Run: `ls docs/plans`
Expected: both new plan files appear

### Task 2: Add the universal Office/PDF baseline to `common-work`

**Files:**
- Modify: `.opencode/agent/common-work.md`

**Step 1: Add a short routing section**

Add rules that require:

- matching file-type skill by current target file
- no direct `read` against binary Office files
- exact-path reuse from tool output
- external command preflight before dependency
- method switch after repeated failure

**Step 2: Keep it concise**

Do not copy procedural content from `docx`, `xlsx`, `pptx`, or `pdf`.

### Task 3: Tighten bid-domain routing in `document-writer`

**Files:**
- Modify: `.opencode/agent/document-writer.md`

**Step 1: Strengthen `Tool routing`**

Make conditional skill loading explicit:

- use the matching Office/PDF skill for the active target file
- do not preload all Office skills by default

**Step 2: Add early guardrails**

Add:

- binary-file handling rule
- canonical path reuse rule
- preflight requirement for optional commands

### Task 4: Add entry-stage guardrails to `bid-analysis`

**Files:**
- Modify: `.opencode/skills/bid-analysis/SKILL.md`

**Step 1: Extend the early extraction guidance**

Add a compact rule block covering:

- exact filename reuse
- no raw `read` for `.docx/.xlsx/.pptx`
- preflight before command-dependent extraction
- fallback to the relevant Office/PDF skill when raw-text extraction is not appropriate

### Task 5: Verify the result

**Files:**
- Test: `.opencode/agent/common-work.md`
- Test: `.opencode/agent/document-writer.md`
- Test: `.opencode/skills/bid-analysis/SKILL.md`

**Step 1: Read the modified sections**

Run:

```bash
sed -n '1,220p' .opencode/agent/common-work.md
sed -n '1,220p' .opencode/agent/document-writer.md
sed -n '1,220p' .opencode/skills/bid-analysis/SKILL.md
```

Expected: new rules are present and concise.

**Step 2: Review the diff**

Run: `git diff -- docs/plans .opencode/agent/common-work.md .opencode/agent/document-writer.md .opencode/skills/bid-analysis/SKILL.md`
Expected: only the planned instruction updates appear.
