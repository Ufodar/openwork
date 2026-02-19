# Bid Writer (标书) — product notes + implementation map

This document captures bid-writing requirements and maps them to the current OpenWork + OpenCode skill/agent architecture.

## Goals

- Produce **submission-ready** bid documents (商务标/技术标) with minimal formatting drift.
- Eliminate "fatal" business errors (dates, warranty, schedule, legal entity mismatches).
- Reduce collusion risk by detecting risky **duplicate text/images** across multiple bids (主标/陪标/伙伴标).
- Keep the workflow **local-first**: tender files and company materials stay on the machine.

## Core insight: 标书 = 组装，不是写作

~50% of a bid document comes from other files (historical bids, partner documents, tender requirements). The system must support **cross-document content assembly** with format preservation, not just prose generation.

Source materials come in multiple formats, each requiring a different assembly strategy:

| Source format | Assembly path | Fidelity |
|---------------|--------------|----------|
| **.docx** | `copy_docx_section.py` — OOXML-level section copy with style/numbering/image merge | Highest (format-preserving) |
| **.doc** | Convert to .docx (pandoc/LibreOffice), then same as above | High |
| **.pdf** | Extract text/tables via `pdf` skill → write into target using target's styles | Medium (content only) |
| **.xlsx** | Read structured data via `xlsx` skill → fill into target tables | Medium (data only) |
| **.pptx** | Extract text via `pptx` skill → use as content reference | Low (text only) |

**Critical design constraint**: converting PDF/Excel/PPT to .docx at upload time is NOT viable — PDF-to-DOCX conversion quality is unreliable (especially for scanned documents), and Excel/PPT lose their structural value when flattened to Word format. The correct approach is format-aware routing, not forced format unification.

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
- `bid-writer` — runs the bid workflow using bid skills + `docx`. Interprets user instructions, orchestrates copy/adapt/write operations.

### Skills (workflow phases)
- `bid-intake`
  - Outputs: `facts.json`, `requirements.csv`, `questions.md`, `intake-summary.md`
  - Principle: every key fact has a citation; no guessing.
- `bid-drafting`
  - Uses: `facts.json` + `requirements.csv` to draft 商务/技术 into a real `.docx`.
  - Preserves template formatting and uses tracked changes when editing.
  - **New**: Cross-document content assembly via `copy_docx_section.py` (DOCX→DOCX only).
  - **New**: Multi-format assembly routing — PDF/Excel/PPT sources use extract-then-write path with target style alignment.
  - **New**: Guidance for handling vague user instructions.
  - **New**: Style alignment rule — all assembled content must use target document styles.
- `bid-dedupe`
  - Compares 2+ `.docx` drafts for risky duplicate **text and images**.
  - Outputs: `dedupe-report.md`
- `bid-qc`
  - Produces `qc-report.md` with compliance/facts/consistency/format/dedupe findings.
  - **New**: Qualification document company name check, certificate expiry check, stray company name search, point-to-point completeness check.

### Tools
- `copy_docx_section.py` — Cross-document section copy tool (OOXML-level). **DOCX→DOCX only.**
  - `--list-headings`: Discover document structure (heading tree with element counts).
  - Copy mode: Extract a section from source → remap IDs → insert into target → merge styles/numbering/images.
  - Handles: rId, numId, bookmarkId, paraId/textId remapping; style chain copying; image dedup by SHA256.
  - Limitations: supports images + external hyperlinks; intentionally errors on footnotes/endnotes/comments/charts/SmartArt/embedded objects to avoid corrupt output.
  - **Not applicable** to non-DOCX sources (PDF, Excel, PPT) — those use extract-then-write via their respective skills.
- `docx_copy_lib.py` — Library powering the copy tool.

### UI
- Agent Hub → launch Bid Writer in the Document Writer layout (documents + OnlyOffice + chat).

## Workflow (end-to-end)

1. **Intake (gate 1)**
   - Ingest tender + materials → generate `facts.json` + `requirements.csv`.
   - Ask questions for missing values; do not draft yet.
2. **Assemble / Draft (gate 2)**
   - Create/modify the target `.docx` under `documents/` (in Document Writer UI this is session-scoped under `documents/sessions/<sessionId>/...`).
   - Assembly routing by source format:
     - **DOCX sources** → `copy_docx_section.py` for format-preserving copy, then adapt values
     - **PDF sources** → extract text/tables via `pdf` skill → write into target using target's styles
     - **Excel sources** → read data via `xlsx` skill → fill into target document tables
     - **PPT sources** → extract text via `pptx` skill → use as content reference for writing
     - **.doc sources** → convert to .docx first, then treat as DOCX
   - **Style alignment**: all assembled content must use the target document's styles. If the result looks visually inconsistent with surrounding content, it provides no value over manual copy-paste.
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

## MVP UX: make it actually usable (not just a demo)

The meeting notes emphasize that users don't want "chat that writes a lot"; they want fewer fatal errors,
less manual copy/paste, and faster verification. The UX should therefore optimize for:

1. **A single, stable target document** (the artifact the team will submit).
2. **Deterministic modules** that produce auditable outputs (reports) and avoid side effects.
3. **Fast review loops**: run a module → see what changed → decide next action.

### Principles

- **Target vs Reference separation**: the UI must make it obvious which file is being edited, and which files are just sources.
- **No silent duplication**: tools should not spawn new “final-vX” documents unless the user explicitly asks.
- **Reports are the interface**: every module writes a timestamped report to the session inbox, and the UI makes those reports one-click accessible (`@` + download).
- **Gated automation**: start with module buttons; do not ship “one-click generate full bid” until each module has clear success criteria.

### Recommended module-first flow (human-in-the-loop)

1. **Pick target**: upload the blank template (主标空模版) and confirm it is the target.
2. **Assemble forms**: copy baseline required forms into the target from a trusted historical/partner DOCX.
3. **Fill tables**: fill point-to-point and equipment list tables from XLSX.
4. **Dedupe**: compare target against 2-4 other bids (主标 + 伙伴标) for text/image risks.
5. **QC gate**: run deterministic checks; only then allow the team to proceed to polishing.

### Make the system feel “real” to users (pragmatic add-ons)

- **Session hygiene**: provide “Archive other documents” so a session converges to one clean target.
- **Reference library categories**: match how bid teams think (招标文件 / 模板 / 商务 / 技术 / 历史 / 合作方 / 图片).
- **Preview mode**: allow opening a reference in OnlyOffice as view-only while keeping the target stable.
- **Failure UX**: when a module fails, surface the report path in the error message so the user can immediately inspect logs and retry.

### Known limitations (explicitly communicate)

- OnlyOffice render ≠ Microsoft Word render. For final submission, always export and spot-check in Word.
- DOCX section copy intentionally refuses footnotes/comments/charts/SmartArt/embedded objects to avoid corrupting output.
- Image near-duplicate detection (dHash) depends on Pillow; without it, only exact image SHA256 matching is available.

## Notes on safety

- Do not modify factual values to "look different".
- Keep all high-stakes values in `facts.json` as the single source-of-truth.
- Prefer deterministic scripts for extraction, hashing, and validation.

## Design decisions log

### Multi-format assembly: route by format, don't convert at upload

**Decision**: Use format-aware routing (DOCX→copy, PDF→extract, Excel→read data) instead of converting all uploads to DOCX.

**Rationale**:
- PDF→DOCX conversion is unreliable: scanned PDFs produce garbage, complex layouts lose structure, and the resulting DOCX has no usable heading styles for `copy_docx_section.py`.
- Excel→DOCX loses the core value (structured tabular data, formulas). Bid scenarios need to read data and fill into target tables, not flatten to paragraphs.
- PPT→DOCX loses visual structure (slides become flat text).
- Only `.doc`→`.docx` is worth converting (same document model, high conversion quality via LibreOffice).

### Style alignment as a hard requirement

**Decision**: Assembled content must use the target document's existing styles. This is treated as a correctness requirement, not a nice-to-have.

**Rationale**: If the user copies a chapter from a historical bid and the result has different fonts/sizes/spacing from the rest of the target document, the user must manually fix formatting — which means the tool provided negative value (they wasted time running it, then still had to do manual work). The bar is: after assembly, the user should not need to touch formatting.

### No persistent source-index cache

**Decision**: Removed `source-index.json`. Agent analyzes reference files on demand instead of maintaining a persistent cache.

**Rationale**:
- `--list-headings` runs in milliseconds (ZIP decompress + XML parse); caching it saves negligible time.
- Within a session, the agent's context already holds previous analysis results — no cache needed.
- Across sessions, the intake artifacts (`facts.json`, `requirements.csv`, `intake-summary.md`) already capture what was learned — a separate index is redundant.
- The cache introduced a consistency problem: files could change but the cache would not, leading the agent to act on stale information.
- The "analyze before acting" workflow pattern is preserved — it's now expressed as "run the tool to discover structure" rather than "check the cache".

### Atomic features before workflow (原子功能优先于工作流)

**Decision**: Decompose the bid-writing workflow into 6 atomic features, each with its own focused agent (~40 lines). Validate each independently before chaining into a pipeline.

**Rationale**:
- "对话式助手" is 鸡肋: simple ops users do faster, complex chains agents can't do well
- Atomic features have clear success criteria (file in → report out, no ambiguity)
- Each feature has multi-turn conversation for refinement (user stays in control)
- One focused agent per feature outperforms one omnibus agent trying to do everything
- Existing production-grade tools (compare_bids.py, copy_docx_section.py) map cleanly to atomic features

**The 6 features**: 查重对比, 陪标换皮, 章节组装, 招标分析, 差异化改写, 质量检查

**Anti-patterns**:
- Don't build the pipeline before validating individual atoms
- Don't create new skills when existing ones can be reused with a "Quick mode" header
- Don't write 200-line agent prompts — atomic agents are ~40 lines max
