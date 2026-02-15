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

- If the UI/user provides a `Target document: documents/.../xxx.docx` line, that file is the target — edit it in place.
- Otherwise, if the tender provides a template `.docx`: copy it to a working file under `documents/` (so OnlyOffice can open it in the Document Writer UI).
- If there is no template: create a working `.docx` under `documents/` using your preferred company template, or create a new document skeleton.

When editing `.docx`, load the `docx` skill and follow its OOXML workflow (tracked changes, pack/unpack/validate).

### Quick path (MVP script)

If you need a **deterministic MVP draft** (no LLM-invented docx generators, no `python-docx` dependency), use:

```bash
python3 .opencode/skills/bid-drafting/scripts/draft_bid_mvp.py \
  --target documents/sessions/<session_id>/<target>.docx \
  --facts bids/<bid_id>/facts.json \
  --requirements bids/<bid_id>/requirements.csv \
  --questions bids/<bid_id>/questions.md \
  --tech-xlsx ".opencode/openwork/inbox/sessions/<session_id>/refs/technical/技术应答表-新华三.xlsx" \
  --equip-xlsx ".opencode/openwork/inbox/sessions/<session_id>/refs/technical/天津职业技术师范大学网络+智算项目清单-新华三.xlsx" \
  --brand-xls ".opencode/openwork/inbox/sessions/<session_id>/refs/technical/天职师大项目伙伴3技术偏离表_品牌.xls"
```

This edits the target doc in place and appends a structured draft section set (tables + checklists). It does **not** produce tracked changes.

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

## Cross-document content assembly

When the user @mentions a source file and asks you to copy/insert content from it:

**First, analyze the file structure.** Before any copy or extraction, understand what the file contains:
- DOCX: run `copy_docx_section.py --source <file> --list-headings --json`
- PDF: use `pdf` skill to extract text and identify chapter/section boundaries
- Excel: use `xlsx` skill to list sheets, column headers, and row counts
- PPT: use `pptx` skill to extract slide titles

Then match the result against the user's request, confirm scope if ambiguous, and execute.

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

1. Run `--list-headings --json` to discover the source document structure.
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
| "把公司资质那块全拿过去" | Copy all qualification sections | Run --list-headings to find 资质-related sections → list them back → confirm scope → copy |
| "技术方案参考 @A @B @C" | Synthesize from multiple sources | Analyze each file's structure → read relevant sections → propose outline → assemble section by section |
| "格式参考 @X，内容参考 @Y" | Copy structure from X, fill with Y's content | Copy X's section first (gets format) → replace content with Y's material via docx skill edits |
| "点对点把技术模块完成" | Fill point-to-point response table | Read requirements.csv for tech items → find matching content in @mentioned sources → assemble responses |

### When to ask vs when to act:

- **Ask** when: multiple sections could match, user @mentions 3+ files without clear roles, instruction contradicts available materials.
- **Act** when: single obvious match after analysis, user has established a pattern in this session, instruction is specific enough.

### Content source priority:

1. **Verbatim copy** from DOCX source → adapt specific values (dates, names) — fastest, highest fidelity
2. **Extract + formatted write** from non-DOCX source (PDF/Excel/PPT) → write into target using target's styles — medium effort
3. **Copy structure**, rewrite content — medium effort
4. **Generate from scratch** — last resort, only when no source material

### Assembling from non-DOCX sources (PDF / Excel / PPT):

When the source material is not `.docx`, `copy_docx_section.py` cannot be used. Instead:

1. **Extract content** using the appropriate skill:
   - PDF → `pdf` skill (pdfplumber for text/tables)
   - Excel → `xlsx` skill (read structured data)
   - PPT → `pptx` skill (extract text content)
2. **Write into target .docx** using the `docx` skill (unpack → edit XML → pack):
   - **Must use the target document's existing styles** (heading styles, body text style, table styles)
   - Every paragraph must have the correct `w:pStyle` matching the target document's conventions
   - Tables must reuse the target document's table style (e.g., `w:tblStyle`)
   - Never insert unstyled/raw paragraphs — they will look visually inconsistent
3. **Verify** the result opens correctly in OnlyOffice and formatting matches surrounding content

### Style alignment rule (applies to ALL assembly paths):

The assembled content must visually match the target document. If the result looks inconsistent (different fonts, sizes, spacing), the tool provides no value over manual copy-paste. Specifically:

- After DOCX-to-DOCX copy: check if source styles conflict with target styles. If fonts/sizes differ, adjust the copied content to use target styles via `docx` skill.
- After content extraction + write: always assign target document styles, never create new ad-hoc styles.
- After any assembly operation: the user should not need to manually fix formatting.

### Companion bids (陪标):

- Copy from main bid → change company name, adjust wording → dedupe check
- Focus on differentiation, not originality

## When to stop

- Stop drafting and switch to `bid-qc` when:
  - All requirements have a mapped response location
  - All business-critical fields are filled or explicitly marked TBD
  - The `.docx` builds and opens in OnlyOffice without errors
