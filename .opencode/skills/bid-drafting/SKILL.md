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

## When to stop

- Stop drafting and switch to `bid-qc` when:
  - All requirements have a mapped response location
  - All business-critical fields are filled or explicitly marked TBD
  - The `.docx` builds and opens in OnlyOffice without errors
