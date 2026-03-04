# End-to-End Bid Generation Design

**Date**: 2026-03-04
**Status**: Approved
**Scope**: Fix path assumptions + close 5 capability gaps for the scenario: "user uploads hundreds of files, agent generates a complete bid document"

---

## Problem Statement

A user uploads ~100-200 files (tender documents, historical bids, qualification certificates, pricing spreadsheets, product datasheets) and instructs the agent: "Generate a complete bid response based on the tender document."

The current bid skill pipeline (bid-analysis → bid-drafting → bid-qc → bid-dedupe) covers core analysis and writing, but cannot deliver end-to-end because of:

1. **No file classification** — agent doesn't know which files are tender vs qualification vs historical
2. **No autonomous orchestration** — agent is interactive-only ("follow user's pace")
3. **No qualification document assembly** — can't batch-insert scanned certificates into docx
4. **No batch file digestion strategy** — hundreds of files exceed context window
5. **No pricing data handling** — weak coverage for xlsx → docx table population

Additionally, a **cross-cutting path mismatch** was discovered: agent/skills assume `refs/` and `target/` directories exist, but the UI uploads files flat into the session root.

## Design Principles

- **No new skills** — all changes within existing 4 bid skills + document-writer agent
- **No new data formats** — extend existing worktree, material-registry, `.bid/facts.json` schemas
- **Agent adapts to user** — no mandatory directory conventions; agent works with whatever file layout exists
- **Incremental implementation** — each gap fix is independent and can ship separately

---

## Final Contract Landing (Implemented)

Authoritative contract is now centralized at:

- `docs/contracts/bid-session-file-contract.md`

Final, active conventions:

1. Canonical session root in docs/examples uses `<SESSION_ROOT>` placeholder; runtime logical root remains `documents/sessions/<sessionId>/`.
2. Canonical facts path is `<SESSION_ROOT>/.bid/facts.json` (new writes only).
3. Persisted metadata paths are session-relative (`target_doc`, triage entries, registry keys, node refs).
4. `file-triage.json` new writes use v2 entries (`rel_path`, `name`, `size`), while v1 remains read-compatible.
5. Agent dialog + skills is the primary workflow path.
6. `/bid/*` standalone module APIs are optional/experimental and disabled by default.

Deprecated in active guidance:

- root-level `facts.json` write path
- hardcoded `documents/sessions/<sessionId>` runnable examples in skills (use `<SESSION_ROOT>`)
- assumptions that users must pre-create `refs/` or `target/` folders

---

## Foundation Fix: Remove Hardcoded Path Assumptions

### Current State

The UI (document-agent.tsx) uploads files to `documents/sessions/<sessionId>/` root or user-chosen subfolders. No code creates `refs/` or `target/` directories. But:

| File | Assumption | Risk |
|------|-----------|------|
| document-writer.md lines 34-36 | `refs/`, `target/`, `artifacts/` as recommended dirs | Medium — advisory but misleading |
| document-writer.md lines 63/85/97 | "copy to `target/`" in template probing | Medium — agent creates phantom dirs |
| bid-drafting SKILL.md line 11 | "check `target/` for target .docx" | **High** — fails to find user-uploaded docs |
| worktree-schema.json all examples | `refs/tender/...`, `refs/partners/...` | Low — misleads LLM path generation |
| material-registry-template.json | keys prefixed `refs/...` | Low — same |

### Solution

**Principle**: Agent and skills operate from session root. `refs/` and `target/` become optional organizational tools the agent may create, never prerequisites.

**Target document locator**: Change from "search `target/` directory" to "read `.worktree/index.json` field `target_doc`". This field is set by document-writer Phase 2 (target document decision gate) and consumed by all downstream skills.

### Specific Changes

#### document-writer.md

| Location | Current | New |
|----------|---------|-----|
| Lines 34-36 (dir conventions) | `refs/`, `target/`, `artifacts/` as recommended | "Optional organizational dirs. Agent must not assume they exist. All file references use paths relative to session root." |
| Lines 63/85/97 (template probing) | "copy to `target/`" | "Record target document path in `.worktree/index.json` `target_doc` field. If copying to protect the original, agent may create a working copy anywhere; path must be recorded in `target_doc`." |
| Line 101 | "`refs/` files are read-only" | "User-uploaded original files are read-only by default. Copy before editing." |
| Lines 252/270/300 (examples) | `refs/tender/...`, `refs/technical/...` | Remove `refs/` prefix, use flat filenames: `招标文件.pdf`, `技术方案/...` |

#### bid-drafting SKILL.md

| Location | Current | New |
|----------|---------|-----|
| Step 0, line 11 | "check `target/` for target .docx" | "Read `target_doc` from `.worktree/index.json`. If not set, check if user specified a target via @. If neither exists → stop and ask user." |

#### worktree-schema.json

| Change | Details |
|--------|---------|
| New field `target_doc` | `"target_doc": "Relative path to the target document being written. Set by document-writer Phase 2, consumed by all skills."` |
| Field `tender_file` description | Change from "in refs/" to "in session directory" |
| All example paths | Remove `refs/` prefixes |
| New field `autopilot` | See Gap 2 section below |
| New field `registry_progress` | See Gap 4 section below |

#### material-registry-template.json

| Change | Details |
|--------|---------|
| All example keys | `refs/partners/h3c/...` → `partners/h3c/...` or just `S6860-datasheet.pdf` |

---

## Gap 1: File Triage

### Location

bid-analysis SKILL.md — new **Step 0** before current Step 1.

### Trigger

`refs/` or session root contains >= 10 files.

### Flow

```
Step 0: File Triage

1. Quick scan — for every file in session directory (recursive):
   - Read: filename + extension + file size
   - Read: first 2 pages / first 3000 characters
   - Do NOT read full content

2. Classify — assign each file to exactly one category:

   | Category | Detection signals |
   |----------|-------------------|
   | tender_main | Contains evaluation methods, bidder instructions, technical requirements chapters |
   | tender_attachment | Named with "格式"/"模板"/"附件"/"清单"; or referenced in tender_main |
   | historical_bid | Contains bid letter / technical proposal / company name in bid context |
   | qualification | PDF/image of business license, certificates, contracts, audit reports |
   | pricing_data | xlsx/csv with price/quantity/model columns |
   | product_doc | Parameter sheets, datasheets, whitepapers, manuals |
   | other | Cannot classify with confidence |

3. Output — write file-triage.json to session root:

   {
     "version": 1,
     "total": 156,
     "by_category": {
       "tender_main": ["招标文件.pdf"],
       "tender_attachment": ["投标文件格式.docx", "报价清单.xlsx"],
       "qualification": ["营业执照.pdf", "ISO证书.pdf", ...],
       "historical_bid": ["2024年XX项目投标文件.docx", ...],
       "pricing_data": ["报价参考.xlsx"],
       "product_doc": ["H3C-S6860-datasheet.pdf", ...],
       "other": ["附件3.pdf"]
     },
     "ambiguous": [
       { "file": "附件3.pdf", "candidates": ["tender_attachment", "qualification"], "reason": "..." }
     ]
   }

4. Confirm — show user a classification summary (not per-file), ask to confirm tender_main identification and resolve ambiguous items.
```

### Batch Strategy

If file count > 50, scan in batches of 20. Each batch appends to file-triage.json incrementally. Batch order: files with "招标" in name first, then by size descending (larger files more likely to be main documents).

### Integration Points

- Step 0 output feeds Step 1 (analysis reads `tender_main` files)
- Step 0 output feeds Step 4.5 (material-registry uses triage categories as `type` field)
- Step 0 output feeds document-writer template probing (search `tender_attachment` for templates)
- Step 0 output feeds bid-drafting Route E (qualification assembly reads `qualification` category)
- Step 0 output feeds bid-drafting Route F (pricing reads `pricing_data` category)

---

## Gap 2: Autopilot Mode (End-to-End Orchestration)

### Location

document-writer.md — new **Autopilot Protocol** section within the workflow.

### Trigger

Phase 1 classifies intent as production (产出类) AND the user's request implies complete document generation (not single-chapter or targeted assembly).

Detection: user says "generate bid document" / "prepare bid response" / "make the full proposal" without specifying a particular chapter or section.

### Stage Pipeline

```
┌─────────────────────────────────────────────────────────┐
│ Stage 0: File Triage                                     │
│   Auto-execute. Checkpoint: confirm tender_main + ambiguous │
├─────────────────────────────────────────────────────────┤
│ Stage 1: Tender Analysis                                 │
│   Auto-execute. skill: bid-analysis                      │
│   Output: requirements.csv, .worktree/, facts.json,      │
│           material-registry.json                         │
│   Checkpoint: none (auto-advance)                        │
├─────────────────────────────────────────────────────────┤
│ Stage 2: Target Document Resolution                      │
│   Auto-execute template probing.                         │
│   Output: target_doc in index.json                       │
│   Checkpoint: show document structure, user confirms     │
├─────────────────────────────────────────────────────────┤
│ Stage 3: Content Drafting                                │
│   skill: bid-drafting                                    │
│   Execute by worktree priority (star > hash > others)    │
│   Checkpoint: pause after each major chapter for review  │
│   User options: "continue" / give feedback / "skip"      │
├─────────────────────────────────────────────────────────┤
│ Stage 4: Qualification Assembly                          │
│   Auto-execute. Route E.                                 │
│   Output: qualification chapter populated                │
│   Checkpoint: show mapping + missing items               │
├─────────────────────────────────────────────────────────┤
│ Stage 5: Pricing Population                              │
│   Auto-execute. Route F.                                 │
│   Output: pricing tables filled                          │
│   Checkpoint: show price summary, user confirms amounts  │
├─────────────────────────────────────────────────────────┤
│ Stage 6: Quality Check                                   │
│   Auto-execute. skill: bid-qc                            │
│   Output: QC report                                      │
│   Checkpoint: show Blocker/High issues                   │
│   Auto-fix fixable items, prompt user for rest           │
├─────────────────────────────────────────────────────────┤
│ Stage 7: Finalization                                    │
│   Auto-execute. Update TOC, page numbers, headers/footers│
│   Output: final .docx                                    │
│   Checkpoint: notify user "bid document complete"        │
└─────────────────────────────────────────────────────────┘
```

### Checkpoint Density Summary

| Stage | Execution | Checkpoint |
|-------|-----------|------------|
| 0 File Triage | Auto | Only if ambiguous items exist |
| 1 Analysis | Auto | None |
| 2 Target Doc | Auto | **Mandatory** — user confirms structure |
| 3 Drafting | Auto per node | **Per major chapter** — user reviews |
| 4 Qualification | Auto | Show mapping + missing list |
| 5 Pricing | Auto | **Mandatory** — user confirms amounts |
| 6 QC | Auto | Show Blocker/High issues |
| 7 Finalize | Auto | Completion notification |

### State Persistence

New `autopilot` field in `.worktree/index.json`:

```json
"autopilot": {
  "enabled": true,
  "current_stage": 3,
  "stages": [
    { "id": 0, "name": "file_triage", "status": "done" },
    { "id": 1, "name": "analysis", "status": "done" },
    { "id": 2, "name": "target_doc", "status": "done" },
    { "id": 3, "name": "drafting", "status": "in_progress", "progress": "12/28 nodes" },
    { "id": 4, "name": "qualification_assembly", "status": "pending" },
    { "id": 5, "name": "pricing", "status": "pending" },
    { "id": 6, "name": "qc", "status": "pending" },
    { "id": 7, "name": "finalize", "status": "pending" }
  ]
}
```

### Recovery

On re-orientation (context compression or new session turn), the agent reads `autopilot` from index.json and resumes at `current_stage`. No user re-instruction needed.

### Interaction with Interactive Mode

- Autopilot does not replace interactive mode; both coexist
- User can interrupt autopilot at any checkpoint to switch to interactive (e.g., manually edit a specific paragraph)
- User says "continue" or equivalent to resume autopilot from current stage
- User can start interactive and later say "finish the rest automatically" to activate autopilot mid-stream

---

## Gap 3: Qualification File Assembly

### Location

bid-drafting SKILL.md — new **Route E** in content assembly routing.

### Trigger

Current worktree node belongs to a "资格证明文件" chapter, AND file-triage.json has `qualification` category files.

### Flow

```
Route E: Qualification Assembly

1. Match — map each qualification requirement (from requirements.csv where 分类 == "资格要求") to triage'd qualification files:

   | Requirement type | File matching signals |
   |-----------------|----------------------|
   | 营业执照 | filename contains "营业执照" / "business_license" |
   | 资质证书 | filename contains "资质" / "证书" / "认证" / "ISO" / "CMMI" |
   | 业绩合同 | filename contains "合同" / "业绩" / "案例" / "project" |
   | 财务报表 | filename contains "审计" / "财务" / "资产负债" / "audit" |
   | 授权书 | filename contains "授权" / "authorization" |
   | 人员证书 | filename contains "人员" / "工程师" / "PMP" / "证书" near person name |
   | Other | semantic match on first-2-page content |

2. Order — sort by tender requirement order if specified, else standard order:
   营业执照 → 资质证书 → 业绩合同 → 财务报表 → 人员证书 → 授权书 → other

3. Convert — for each matched file:
   - PDF scans → images via bash (ghostscript/imagemagick), one image per page
   - Native images (jpg/png) → use directly
   - DOCX → Route A (format-preserving copy)

4. Insert — into target document qualification chapter:
   - Section heading per document type (e.g., "一、营业执照")
   - Image insertion using docx skill XML knowledge
   - Page break between each document
   - Maintain tracked changes markup

5. Report missing — for unmatched requirements:
   - Insert placeholder "<<待补充：XX证书>>" in document
   - Set node status: blocked, blocked_by: "缺少XX证书"
   - Aggregate into missing list for user

Output artifact: qualification-mapping.json

{
  "mappings": [
    { "requirement": "营业执照", "file": "营业执照.pdf", "status": "inserted", "pages": [45, 46] },
    { "requirement": "ISO27001", "file": "ISO27001证书.pdf", "status": "inserted", "pages": [47] },
    { "requirement": "近三年审计报告", "file": null, "status": "missing" }
  ],
  "summary": { "total": 12, "inserted": 10, "missing": 2 }
}
```

### QC Integration

bid-qc vision sub-agent already has extraction schemas for 9 document types (business_license, qualification_cert, audit_report, etc.). After Route E inserts these files, QC Stage 6 can verify that:
- Inserted certificates match the bidding company (entity consistency)
- Certificates are not expired (date validation)
- Image quality is sufficient (legibility assessment)

No changes needed to bid-qc for this integration.

---

## Gap 4: Batch File Digestion Strategy

### Location

bid-analysis SKILL.md — expand **Step 4.5** (material-registry construction).

### Trigger

file-triage.json exists (Step 0 was executed).

### Flow

```
Step 4.5 expanded: Batch Material Registry Construction

Priority order (from file-triage categories):
  Batch 1: tender_main + tender_attachment (critical, usually < 5 files)
  Batch 2: historical_bid (reusable structure, usually < 20 files)
  Batch 3: product_doc (technical parameters)
  Batch 4: pricing_data (pricing references)
  Batch 5: qualification (filename-level index only, no content read)
  Batch 6: other

Per-batch process:
  a. Pull file list from file-triage.json for this category
  b. For each file (max 20 per sub-batch):
     - Read first 3000 chars / first 2 pages
     - Extract: description, covers[], useful_for_reqs[], quality, caveats
     - Append entry to material-registry.json
  c. Persist material-registry.json to disk after each sub-batch
  d. Update index.json:
     "registry_progress": {
       "total": 156,
       "indexed": 45,
       "current_batch": "historical_bid",
       "batch_order": ["tender_main", "tender_attachment", "historical_bid", "product_doc", "pricing_data", "qualification", "other"]
     }

Qualification special handling:
  - Only record filename + detected type (营业执照/资质证书/...)
  - Do NOT read content (content handled by Route E at assembly time)
  - Token cost: ~0 per file

Progressive indexing:
  - Batches 1-2 complete → drafting can begin
  - Remaining batches index in background or on-demand
  - When drafting encounters a node needing materials not in registry:
    search session directory by keyword, index found files, add to registry

Token budget per sub-batch:
  - Max 20 files × 3000 chars = ~60K tokens
  - If exceeded, split into smaller sub-batches automatically
```

### Integration

- file-triage.json (Gap 1) provides category-sorted file lists → eliminates random scanning
- material-registry.json feeds bid-drafting "check index before opening files" pattern (unchanged)
- registry_progress in index.json feeds autopilot progress tracking (Gap 2)

---

## Gap 5: Pricing Data Population

### Location

bid-drafting SKILL.md — new **Route F** in content assembly routing.

### Trigger

Current worktree node belongs to a pricing/commercial chapter, AND file-triage.json has `pricing_data` files.

### Flow

```
Route F: Pricing Data Population

1. Read source — use xlsx skill to read pricing_data files:
   - Extract column headers and row data
   - Identify structure: equipment list / pricing breakdown / rate table / BOQ

2. Read target table — extract pricing table structure from target document:
   - If template has blank pricing table → use its column structure
   - If no template table → derive from tender pricing format requirements

3. Map columns — source → target:
   - Auto-match: identical column names
   - Semantic match: near-synonyms (e.g., "单价" ↔ "含税单价")
   - Unmatched columns → report to user for manual mapping

4. Populate — write data into target document table:
   - Use docx skill table XML operations
   - Preserve original number precision (no rounding)
   - Compute derived columns: subtotal = unit_price × quantity, total = Σ subtotals

5. Validate — post-population consistency checks:
   - Row check: subtotal == unit_price × quantity (per row)
   - Sum check: total == Σ all subtotals
   - Budget check: total <= facts.json budget (if available)
   - Validation failure → mark node as blocked, report to user

Safety rules:
  - Price data MUST come from user-provided source files. Never fabricate prices.
  - After population, MUST show user a summary: total price, top-5 line items by value
  - User confirmation required before marking node as done
```

---

## Schema Changes Summary

### .worktree/index.json — new fields

```json
{
  "target_doc": "应标文件.docx",
  "autopilot": {
    "enabled": true,
    "current_stage": 3,
    "stages": [
      { "id": 0, "name": "file_triage", "status": "done" },
      { "id": 1, "name": "analysis", "status": "done" },
      { "id": 2, "name": "target_doc", "status": "done" },
      { "id": 3, "name": "drafting", "status": "in_progress", "progress": "12/28 nodes" },
      { "id": 4, "name": "qualification_assembly", "status": "pending" },
      { "id": 5, "name": "pricing", "status": "pending" },
      { "id": 6, "name": "qc", "status": "pending" },
      { "id": 7, "name": "finalize", "status": "pending" }
    ]
  },
  "registry_progress": {
    "total": 156,
    "indexed": 45,
    "current_batch": "historical_bid",
    "batch_order": ["tender_main", "tender_attachment", "historical_bid", "product_doc", "pricing_data", "qualification", "other"]
  }
}
```

### New artifact: file-triage.json

Created by bid-analysis Step 0. Schema defined in Gap 1 section above.

### New artifact: qualification-mapping.json

Created by bid-drafting Route E. Schema defined in Gap 3 section above.

---

## Files Changed

| File | Change Type | Summary |
|------|------------|---------|
| `.opencode/agent/document-writer.md` | Modify | Path fix + Autopilot Protocol + Phase 1 "complete generation" intent |
| `.opencode/skills/bid-analysis/SKILL.md` | Modify | New Step 0 (File Triage) + expand Step 4.5 (batch strategy) |
| `.opencode/skills/bid-drafting/SKILL.md` | Modify | Path fix (Step 0) + new Route E (qualification) + new Route F (pricing) |
| `.opencode/skills/bid-analysis/references/worktree-schema.json` | Modify | Path fix + new fields (target_doc, autopilot, registry_progress) |
| `.opencode/skills/bid-analysis/references/material-registry-template.json` | Modify | Path fix (remove refs/ prefix from example keys) |

**No new files created. No new skills created. All changes within existing structure.**

---

## Implementation Order

Recommended sequence (each step is independently shippable):

1. **Foundation: Path fix** — all files, remove refs/target hardcoding, add target_doc field
2. **Gap 1: File Triage** — bid-analysis Step 0
3. **Gap 4: Batch digestion** — bid-analysis Step 4.5 expansion (depends on Gap 1)
4. **Gap 2: Autopilot** — document-writer autopilot protocol (depends on Gap 1)
5. **Gap 3: Qualification assembly** — bid-drafting Route E (depends on Gap 1)
6. **Gap 5: Pricing population** — bid-drafting Route F (depends on Gap 1)

Gap 1 (File Triage) is the foundation — everything else depends on it.
Gaps 3, 4, 5 are independent of each other after Gap 1 is done.
Gap 2 (Autopilot) orchestrates gaps 3-5 but can be implemented with stubs.
