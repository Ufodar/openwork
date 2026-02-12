---
name: bid-qc
description: This skill should be used to quality-check a tender/bid (标书) for compliance, factual correctness (dates/warranty/schedule), entity/name/image consistency, and cross-bid dedupe/plagiarism risks before submission.
---

# Bid QC

## Overview

Perform a “no surprises” QC pass on the bid package and produce an actionable report.

## Inputs

- The draft `.docx` (and tender template if used)
- `bids/<bid_id>/facts.json`
- `bids/<bid_id>/requirements.csv`
- Any attachment folder (certificates, partner materials)
- Optional: historical bids for similarity comparison

## Output

Create `bids/<bid_id>/qc-report.md` with:

- QC summary (pass/fail + top risks)
- Findings grouped by: compliance / facts / consistency / formatting / dedupe
- Exact file/section pointers and suggested fixes
- A short “submission readiness” checklist

## Non‑Negotiables

- Do not “assume correct” — verify against `facts.json`, tender docs, or attachments.
- Use absolute dates (`YYYY-MM-DD`) when describing date findings.
- Treat any uncited number/date/name in the draft as a risk until proven.

## Workflow

### Step 1 — Establish the reference baseline

- Determine current date/time via `bash: date -Iseconds`.
- Load `facts.json` and `requirements.csv` as source-of-truth.
- Identify the draft deliverable file(s) and attachment directory.

### Step 2 — Compliance coverage check (requirements.csv)

- Ensure every requirement row has:
  - a response location (section/table) or an explicit “N/A allowed” citation
  - required evidence attached (if the tender demands it)
- Flag missing coverage as **Blocker**.

### Step 3 — Facts correctness check (facts.json)

- Cross-check the draft against `facts.json`:
  - bid deadline / project schedule /工期
  - warranty/maintenance durations
  - SLA response times and support window
  - legal entity names, IDs, addresses, contacts
- Flag mismatches or missing values.

### Step 4 — Consistency + “entity hygiene”

- Scan for:
  - inconsistent company name variants (legal name vs brand name)
  - partner company names (must match partner materials)
  - stray client names from historical bids
  - wrong people names/titles/dates
  - mismatched logos/images
- If needed, unpack `.docx` with the `docx` skill and grep the OOXML for risky strings.

### Step 5 — Formatting + template compliance

- Verify tender-required formatting:
  - section order, headings, required forms
  - signatures/seals placeholders
  - file naming rules
  - page limits (if any)

### Step 6 — Dedupe / similarity risks

- Compare against historical bids:
  - flag large verbatim blocks
  - flag boilerplate that still contains old names/dates
- Prefer “edit for truth + specificity” over superficial paraphrasing.

Use `references/qc-checklist.md` as the final gating list.

## Severity levels

- **Blocker**: cannot submit (missing requirement, wrong legal entity, wrong date)
- **High**: likely disqualify or contract risk (warranty/SLA mismatch, missing certificate)
- **Medium**: needs cleanup (format drift, unclear wording)
- **Low**: nice-to-have improvements
