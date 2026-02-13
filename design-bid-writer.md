# Bid Writer (标书) — product notes + implementation map

This document captures bid-writing requirements and maps them to the current OpenWork + OpenCode skill/agent architecture.

## Goals

- Produce **submission-ready** bid documents (商务标/技术标) with minimal formatting drift.
- Eliminate "fatal" business errors (dates, warranty, schedule, legal entity mismatches).
- Reduce collusion risk by detecting risky **duplicate text/images** across multiple bids (主标/陪标/伙伴标).
- Keep the workflow **local-first**: tender files and company materials stay on the machine.

## Core insight: 标书 = 组装，不是写作

~50% of a bid document comes from other DOCX files (historical bids, partner documents, tender requirements). The system must support **cross-document content assembly** with format preservation, not just prose generation.

## Observed constraints (from internal team discussion)

- Output must **preserve tender-required formats** (template tables, headings, file naming).
- Large documents are common (hundreds of pages, many images; ~300MB class).
- "点对点应答表" is the scoring core; business part is typically **no deviation**, technical may have deviations but must respect ★/core clauses.
- Real-world pain points are **checking** and **dedupe**, not just "generate prose".
- Users give vague instructions ("把资质那块全拿过去"), agent must interpret and confirm.

## Architecture decision (recommended)

Start with **one primary agent** (Bid Writer) + **workflow-oriented skills**. Add specialized sub-agents later only when the primitives are stable.

Why:
- The hardest part is maintaining a single source-of-truth for business facts and citations; multi-agent early makes drift worse.
- Workflow phases provide the required "gates": intake → draft/assemble → dedupe → QC.

## Current implementation (what exists in this fork)

### Agents
- `document-writer` — edits `.docx` with OnlyOffice + chat.
- `bid-writer` — runs the bid workflow using bid skills + `docx`. Interprets user instructions, manages source-index cache, orchestrates copy/adapt/write operations.

### Skills (workflow phases)
- `bid-intake`
  - Outputs: `facts.json`, `requirements.csv`, `questions.md`, `intake-summary.md`, `source-index.json`
  - Principle: every key fact has a citation; no guessing.
  - **New**: Step 2.5 builds a source material index (`source-index.json`) by analyzing all input DOCX headings.
- `bid-drafting`
  - Uses: `facts.json` + `requirements.csv` to draft 商务/技术 into a real `.docx`.
  - Preserves template formatting and uses tracked changes when editing.
  - **New**: Cross-document content assembly via `copy_docx_section.py`.
  - **New**: `source-index.json` cache for avoiding repeated document analysis.
  - **New**: Guidance for handling vague user instructions.
- `bid-dedupe`
  - Compares 2+ `.docx` drafts for risky duplicate **text and images**.
  - Outputs: `dedupe-report.md`
- `bid-qc`
  - Produces `qc-report.md` with compliance/facts/consistency/format/dedupe findings.
  - **New**: Qualification document company name check, certificate expiry check, stray company name search, point-to-point completeness check.

### Tools
- `copy_docx_section.py` — Cross-document section copy tool (OOXML-level).
  - `--list-headings`: Discover document structure (heading tree with element counts).
  - Copy mode: Extract a section from source → remap IDs → insert into target → merge styles/numbering/images.
  - Handles: rId, numId, bookmarkId, paraId/textId remapping; style chain copying; image dedup by SHA256.
  - Limitations: supports images + external hyperlinks; intentionally errors on footnotes/endnotes/comments/charts/SmartArt/embedded objects to avoid corrupt output.
- `docx_copy_lib.py` — Library powering the copy tool.

### Source material cache (`source-index.json`)
- Per-bid JSON file caching heading analysis results for each DOCX.
- Avoids re-analyzing large documents on every interaction.
- Cache hit → use cached headings. Cache miss → run `--list-headings --json` and write back.
- User can request re-analysis to invalidate cache entries.

### UI
- Agent Hub → launch Bid Writer in the Document Writer layout (documents + OnlyOffice + chat).

## Workflow (end-to-end)

1. **Intake (gate 1)**
   - Ingest tender + materials → generate `facts.json` + `requirements.csv`.
   - Build `source-index.json` for all input DOCX files.
   - Ask questions for missing values; do not draft yet.
2. **Assemble / Draft (gate 2)**
   - Create/modify `documents/bids/<bid_id>/draft.docx`.
   - Content source priority:
     1. Verbatim copy from source → adapt specific values (fastest, highest fidelity)
     2. Copy structure, rewrite content (medium effort)
     3. Generate from scratch (last resort)
   - Ensure every requirement has a mapped response location.
3. **Dedupe (gate 3)**
   - Compare main + partner drafts → `dedupe-report.md`.
   - Rewrite risky blocks and replace/alter duplicated figures.
4. **QC (gate 4)**
   - Cross-check against tender + `facts.json` + attachments.
   - Check qualification docs, certificate dates, stray company names, point-to-point completeness.
   - Fix blockers and rerun QC.

## Next product increments (suggested order)

1. **Semi-automated assembly (V2)**
   - After intake, auto-generate an "assembly plan" mapping each target section to its best source.
   - User confirms, then batch-execute copies.
2. **Full automation (V3)**
   - bid-writer agent autonomously completes intake → assemble → adapt → dedupe → QC.
   - Uses Task tool for segmented execution, `progress.json` for tracking.
   - User only needs final review.
3. **Multi-bid parallel (V4)**
   - Auto-generate companion bid (陪标) drafts from main bid.
   - Cross-bid dedupe runs automatically.
4. **Dedupe robustness**
   - Add perceptual hashing by default (ship Pillow in a controlled runtime) or implement a lightweight native hasher.

## Notes on safety

- Do not modify factual values to "look different".
- Keep all high-stakes values in `facts.json` as the single source-of-truth.
- Prefer deterministic scripts for extraction, hashing, and validation.
