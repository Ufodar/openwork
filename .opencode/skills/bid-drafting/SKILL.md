---
name: bid-drafting
description: This skill should be used after bid intake to draft the 商务/技术 parts of a tender/bid (标书) into a real .docx, strictly driven by extracted facts + compliance matrix (no fabricated dates/numbers), and assembled with stable Word formatting.
---

# Bid Drafting

## Overview

Draft a complete bid document by turning `bid-intake` artifacts (facts + requirements) into:

- Business section (商务标): tables/forms, commitments, schedules, warranties, certificates list
- Technical section (技术标): point-to-point responses, solution design, implementation plan
- A real `.docx` deliverable that can be opened in OnlyOffice and reviewed with tracked changes

## Prerequisites

- `bids/<bid_id>/facts.json` (source-of-truth values)
- `bids/<bid_id>/requirements.csv` (compliance matrix)
- Tender template `.docx` (optional)

If `facts.json` or `requirements.csv` is missing or incomplete, stop and run `bid-intake`.

## Non‑Negotiables (Accuracy Guardrails)

- Use `facts.json` as the **only** source for business-critical values (dates, durations, warranty, names, IDs).
- If a value is missing: insert a visible placeholder (e.g., `<<TBD: warranty period>>`) and add it to `bids/<bid_id>/questions.md`.
- Never copy claims/specs into the technical section unless they are supported by:
  - tender requirement, or
  - company/partner reference material (with a citation)
- Prefer absolute dates (`YYYY-MM-DD`) and consistent units.

## Workflow

### Step 1 — Choose the target `.docx`

- If the tender provides a template `.docx`: copy it to a working file (e.g., `documents/bids/<bid_id>/draft.docx`).
- If there is no template: create `documents/bids/<bid_id>/draft.docx` using your preferred company template, or create a new document skeleton.

When editing `.docx`, load the `docx` skill and follow its OOXML workflow (tracked changes, pack/unpack/validate).

### Step 2 — Generate an outline from `requirements.csv`

- Create `bids/<bid_id>/outline.md` with:
  - Section tree (商务/技术)
  - Mapping of each requirement row → target section/subsection
  - A list of “must-include” tables/forms from the tender

Use `references/business-outline.md` and `references/technical-outline.md` as starting points when the tender does not prescribe a structure.

### Step 3 — Draft the business section (商务标)

- Fill all commercial commitments from `facts.json`:
  - Project schedule /工期
  - Warranty/maintenance
  - Support SLA /响应时间
  - Delivery/acceptance plan
- For every tender-provided form/table:
  - Copy the exact table structure
  - Fill cells using `facts.json` values
  - If tender demands “填无/不适用”: only do so if explicitly allowed
- Add an “Attachments checklist” section listing required certificates/evidence and whether each file exists.

### Step 4 — Draft the technical section (技术标)

- Use point-to-point writing:
  - For each major requirement: restate requirement → provide response → cite evidence → list deviations (if any)
- Prefer reusing verified content from historical bids, but:
  - update dates/names/metrics to match current `facts.json` + tender
  - remove any client-specific references that do not apply
- Include implementation plan:
  - milestones and roles
  - risk/mitigation
  - acceptance criteria (align with tender)

### Step 5 — Assemble into `.docx` with minimal formatting drift

- Prefer editing inside the tender template to preserve styles.
- Keep headings, numbering, table styles consistent.
- Use tracked changes when modifying existing template content.

### Step 6 — Produce a drafting changelog

- Update `bids/<bid_id>/draft-log.md`:
  - what was written
  - which facts were consumed
  - which open questions remain

## Source material cache: source-index.json

Before accessing any @mentioned `.docx` file, check `bids/<bid_id>/source-index.json`.

- **Cache hit** → use cached headings, do NOT re-analyze the file.
- **Cache miss** → run `copy_docx_section.py --source <file> --list-headings --json` and save the result.
- If the user explicitly asks to re-analyze a file, delete its cache entry and re-run.

Format:
```json
{
  "documents/refs/历史标书.docx": {
    "analyzedAt": "2026-02-13T...",
    "headings": [
      { "level": 1, "text": "第一章 概述", "elementCount": 12 },
      { "level": 2, "text": "1.1 项目背景", "elementCount": 5 }
    ]
  }
}
```

## Cross-document content assembly

When the user @mentions a source file and asks you to copy/insert content from it:

### What the copier supports (and what it does NOT)

The cross-document copier (`copy_docx_section.py`) is designed to be reliable and avoid corrupting the target DOCX.

Supported:
- Paragraphs and tables inside `word/document.xml`
- Images referenced from the section
- External hyperlinks
- Styles and numbering (best-effort merge)

Not supported (the tool will error rather than produce a broken DOCX):
- Footnotes / endnotes
- Comments
- Charts / SmartArt / embedded objects
- `altChunk`

### If the user wants verbatim copy (保留格式复制):

1. Check `source-index.json` cache; if miss, run `--list-headings --json` and update cache.
2. Confirm the section with the user if ambiguous.
3. Run:
   ```bash
   python3 .opencode/skills/bid-drafting/scripts/copy_docx_section.py \
     --source <source.docx> \
     --target <target.docx> \
     --output <target.docx> \
     --source-heading "技术方案" \
     --target-heading "第二章" \
     --match-mode contains
   ```
   If multiple headings match, disambiguate with:
   - `--source-heading-index N` (1-based)
   - `--target-heading-index N` (1-based)
4. If the target document already has the destination heading and you only want the *content* (not the heading line), add:
   - `--exclude-source-heading`
5. After copy, use the `docx` skill (unpack/edit/pack) for any needed adaptations:
   - Replace company names, dates, project-specific terms
   - Adjust via tracked changes so user can review

### If the user wants adapted content (仿写/改写):

1. Read the source section via unpack or pandoc.
2. Understand the structure and key points.
3. Write new content in the target document via `docx` skill (unpack → edit XML → pack).
4. Preserve the target document's existing styles.

### Handling vague user instructions

Users often give imprecise instructions. Examples and how to handle:

| User says | What they mean | Your action |
|-----------|----------------|-------------|
| "把公司资质那块全拿过去" | Copy all qualification sections | Find 资质-related sections in source-index.json → list them back → confirm scope → copy |
| "技术方案参考 @A @B @C" | Synthesize from multiple sources | Read relevant sections from each via cache → propose outline → assemble section by section |
| "格式参考 @X，内容参考 @Y" | Copy structure from X, fill with Y's content | Copy X's section first (gets format) → replace content with Y's material via docx skill edits |
| "点对点把技术模块完成" | Fill point-to-point response table | Read requirements.csv for tech items → find matching content in @mentioned sources → assemble responses |

### When to ask vs when to act:

- **Ask** when: multiple sections could match, user @mentions 3+ files without clear roles, instruction contradicts available materials.
- **Act** when: single obvious match in cache, user has established a pattern in this session, instruction is specific enough.

### Content source priority:

1. **Verbatim copy** from source → adapt specific values (dates, names) — fastest, highest fidelity
2. **Copy structure**, rewrite content — medium effort
3. **Generate from scratch** — last resort, only when no source material

### Companion bids (陪标):

- Copy from main bid → change company name, adjust wording → dedupe check
- Focus on differentiation, not originality

## When to stop

- Stop drafting and switch to `bid-qc` when:
  - All requirements have a mapped response location
  - All business-critical fields are filled or explicitly marked TBD
  - The `.docx` builds and opens in OnlyOffice without errors
