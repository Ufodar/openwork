# Bid Writer (标书) — product notes + implementation map

This document captures bid-writing requirements and maps them to the current OpenWork + OpenCode skill/agent architecture.

## Goals

- Produce **submission-ready** bid documents (商务标/技术标) with minimal formatting drift.
- Eliminate “fatal” business errors (dates, warranty, schedule, legal entity mismatches).
- Reduce collusion risk by detecting risky **duplicate text/images** across multiple bids (主标/陪标/伙伴标).
- Keep the workflow **local-first**: tender files and company materials stay on the machine.

## Observed constraints (from internal team discussion)

- Output must **preserve tender-required formats** (template tables, headings, file naming).
- Large documents are common (hundreds of pages, many images; ~300MB class).
- “点对点应答表” is the scoring core; business part is typically **no deviation**, technical may have deviations but must respect ★/core clauses.
- Real-world pain points are **checking** and **dedupe**, not just “generate prose”.

## Architecture decision (recommended)

Start with **one primary agent** (Bid Writer) + **workflow-oriented skills**. Add specialized sub-agents later only when the primitives are stable.

Why:
- The hardest part is maintaining a single source-of-truth for business facts and citations; multi-agent early makes drift worse.
- Workflow phases provide the required “gates”: intake → draft → dedupe → QC.

## Current implementation (what exists in this fork)

### Agents
- `document-writer` — edits `.docx` with OnlyOffice + chat.
- `bid-writer` — runs the bid workflow using bid skills + `docx`.

### Skills (workflow phases)
- `bid-intake`
  - Outputs: `facts.json`, `requirements.csv`, `questions.md`, `intake-summary.md`
  - Principle: every key fact has a citation; no guessing.
- `bid-drafting`
  - Uses: `facts.json` + `requirements.csv` to draft 商务/技术 into a real `.docx`.
  - Preserves template formatting and uses tracked changes when editing.
- `bid-dedupe`
  - Compares 2+ `.docx` drafts for risky duplicate **text and images**.
  - Outputs: `dedupe-report.md`
- `bid-qc`
  - Produces `qc-report.md` with compliance/facts/consistency/format/dedupe findings.

### UI
- Agent Hub → launch Bid Writer in the Document Writer layout (documents + OnlyOffice + chat).

## Workflow (end-to-end)

1. **Intake (gate 1)**
   - Ingest tender + materials → generate `facts.json` + `requirements.csv`.
   - Ask questions for missing values; do not draft yet.
2. **Draft (gate 2)**
   - Create/modify `documents/bids/<bid_id>/draft.docx`.
   - Ensure every requirement has a mapped response location.
3. **Dedupe (gate 3)**
   - Compare main + partner drafts → `dedupe-report.md`.
   - Rewrite risky blocks and replace/alter duplicated figures.
4. **QC (gate 4)**
   - Cross-check against tender + `facts.json` + attachments.
   - Fix blockers and rerun QC.

## Next product increments (suggested order)

1. **QC automation depth**
   - More deterministic checks: outdated certificates, missing attachments, entity name drift, starred clause coverage.
2. **Dedupe robustness**
   - Add perceptual hashing by default (ship Pillow in a controlled runtime) or implement a lightweight native hasher.
3. **Template-first drafting**
   - Better table/form filling and “点对点应答表” generation from `requirements.csv`.
4. **Image library (not generation)**
   - Reference a curated asset catalog; insert verified figures/tables.

## Notes on safety

- Do not modify factual values to “look different”.
- Keep all high-stakes values in `facts.json` as the single source-of-truth.
- Prefer deterministic scripts for extraction, hashing, and validation.

