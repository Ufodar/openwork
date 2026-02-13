---
name: bid-intake
description: This skill should be used when starting a new tender/bid (标书) project to intake the 招标文件 and reference materials, extract business/technical requirements, and produce a traceable facts sheet + compliance matrix with source citations (no guessing).
---

# Bid Intake

## Overview

Create a reliable starting point for bid writing by turning messy tender inputs into:

- A **facts sheet** (business-critical values like dates, warranty, schedule, names) with citations
- A **compliance matrix** mapping tender requirements → where they are answered
- A **question list** for missing/ambiguous information

This skill is optimized for high-stakes accuracy: do not invent values.

## Inputs

- Tender package (招标文件): `.docx`, `.pdf`, `.txt`, `.xlsx`, attachments
- Optional tender template: `.docx` (sometimes provided, sometimes not)
- Company materials:资质、案例、人员简历、设备清单、业绩证明、财务/商务表格
- Partner materials (if any): company profile, certificates, authorizations, joint bid docs
- Historical bids (main/companion) for reuse and dedupe checks

## Outputs (Artifacts)

Create these files in the workspace (prefer a per-bid folder, e.g. `bids/<bid_id>/`):

- `bids/<bid_id>/facts.json` using `references/facts-template.json`
- `bids/<bid_id>/requirements.csv` using `references/requirements-matrix-template.csv`
- `bids/<bid_id>/questions.md` (missing info + what to ask the user)
- `bids/<bid_id>/intake-summary.md` (what was ingested + key constraints + deadlines)

If the workspace is currently using the OpenWork Document Writer UI, keep final editable `.docx` deliverables under `documents/` so OnlyOffice can open them.

## Non‑Negotiables (Accuracy Guardrails)

- Determine **current date/time** via `bash: date -Iseconds` and record it in `facts.json` (`generatedAt`).
- Do not guess **any** business-critical value (dates, durations, warranty, project period, names, addresses, legal entities, IDs).
- Attach a **source citation** for every non-trivial fact:
  - minimum: `{ file, locator, excerpt }`
  - locator examples: `page 12`, `section 3.2`, `table "商务响应表" row 5`, `docx paragraph containing "..."`
- If a value is missing or ambiguous, leave it as `null` and add an item to `questions.md`.
- Prefer absolute dates (e.g., `2026-02-12`) over relative phrases (“next month”).

## Workflow

### Step 1 — Create a bid workspace folder

- Choose a stable `bid_id` (tender number or short slug).
- Create:
  - `bids/<bid_id>/` for structured artifacts
  - `documents/bids/<bid_id>/` for any `.docx` you want to open in OnlyOffice

### Step 2 — Inventory all inputs

- Create `intake-summary.md` with:
  - Tender name + issuer + bid deadline (if found)
  - List of all input files (exact paths)
  - Which file appears to be the “source of truth” for business terms (often a form/table)

### Step 2.5 — Build source material index (source-index.json)

Build and maintain a persistent index for all reference DOCX files.

Prefer using the batch indexer script (it stores file hashes + headings and
automatically refreshes changed files):

```bash
python3 .opencode/skills/bid-intake/scripts/update_source_index.py \
  --index bids/<bid_id>/source-index.json \
  .opencode/openwork/inbox/sessions/<sessionId>/refs
```

The index is keyed by workspace-relative file path and includes:
- `sha256`, `size`, `mtimeMs` (cache invalidation)
- `headings` (for cross-document copying / navigation)

Format (per file):

```json
{
  "path/to/历史标书A.docx": {
    "analyzedAt": "2026-02-13T10:30:00+08:00",
    "sha256": "…",
    "size": 123456,
    "mtimeMs": 1700000000000,
    "headings": [
      { "level": 1, "text": "第一章 概述", "elementCount": 12 },
      { "level": 2, "text": "1.1 项目背景", "elementCount": 5 }
    ]
  }
}
```

This is a **persistent cache** — subsequent operations (drafting, copy, QC) will read from cache instead of re-analyzing. The cache is per-bid, lives on disk, and survives context compression / session restarts.

This index serves as the "材料地图" — telling you and the user what content is available in each source file.

### Step 3 — Extract requirements into a compliance matrix

- Read the tender instructions end-to-end and extract *actionable requirements*:
  - Submission structure: 商务/技术/报价 split, formatting, signatures/seals, file naming
  - Mandatory clauses and required evidence
  - Evaluation criteria and scoring points: extract the scoring method (综合评分/最低价), business/technical/price score breakdown with point values, and mark individual item weights
  - Starred (★) / core product requirements and "one-vote veto" clauses: mark these in `requirements.csv` with `priority=starred`
  - Required attachments / certificates
  - Technical specs, acceptance criteria, SLAs
- Write `requirements.csv` with one requirement per row, including citations.

### Step 4 — Extract business-critical facts into `facts.json`

- Populate `facts.json` from tender + company materials:
  - Deadlines: bid submission, clarification, Q&A window
  - Bid opening time/location (开标时间/地点) if provided
  - Schedule: planned start date, construction/implementation period, milestones
  - Warranty/maintenance: duration, response time, coverage
  - Service levels: uptime, support windows, escalation
  - Entities: bidder legal name, partner legal name(s), signatories, contacts
  - Addresses, bank/account info (if required), license numbers
- For each field, include `source` with `{file, locator, excerpt}`.

### Step 5 — Generate the “missing info” question list

- Create `questions.md`:
  - What is missing
  - Why it matters (which tender requirement it blocks)
  - Exactly what to ask the user/partner for
  - Suggested default only if the tender explicitly allows “bidder to propose”

### Step 6 — Handoff to drafting

- Do not start drafting the bid until:
  - `facts.json` is complete for business-critical fields (or questions are acknowledged)
  - `requirements.csv` covers all tender requirements

## Note on “point-to-point” (点对点应答表)

Treat point-to-point responses as the core scoring artifact:

- Build rows from `requirements.csv` and the tender’s scoring items.
- Avoid “偏离” unless the tender explicitly allows it and the impact is documented.
- For technical deviations, clearly label which items are “starred” or “core” to avoid disqualification risk.

## Quick sanity checks (before leaving intake)

- Confirm every row in `requirements.csv` has a citation.
- Confirm every value in `facts.json` has a citation or is `null`.
- Confirm bid deadline and schedule are recorded as absolute dates.
