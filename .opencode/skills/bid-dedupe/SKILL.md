---
name: bid-dedupe
description: This skill should be used to detect risky duplicate text and images across multiple bid documents (主标/陪标/伙伴标) to reduce collusion (“串标”) risk, and to produce an actionable dedupe report with exact locations and remediation guidance.
---

# Bid Dedupe

## Quick mode（独立使用）

当作为独立原子功能使用时（不是更大工作流的一部分）：

1. 检查会话中可用的 .docx 文件
2. 对所有 .docx 文件运行 compare_bids.py
3. 在对话中展示摘要结果
4. 保存完整报告到会话目录（优先写到当前 session 的 refs/other，便于在 UI 下载）
5. 等待用户多轮调整指令

## Overview

Compare 2+ `.docx` bid documents and produce a dedupe report covering:

- Exact text duplicates (hash-based)
- Near text duplicates (simhash + similarity scoring)
- Exact image duplicates (SHA256)
- Near image duplicates (dHash, optional, requires Pillow)

This is intentionally deterministic and tool-driven to avoid subjective guessing.

## Note: models without vision

If the active model cannot see images (e.g. text-only models), this skill still works because it relies on deterministic hashing. For human review of duplicate images, export a contact sheet HTML via `--media-dir` (see Quick start).

## When to use

- One main bid + multiple partner bids must be submitted for the same tender.
- A “陪标” must look meaningfully different from the main bid.
- There is a known risk of copy/paste reuse from historical bids.
- The tender explicitly warns against collusion or duplicated submissions.

## Output

- Workflow mode: create `bids/<bid_id>/dedupe-report.md` (and optional intermediate JSON under `bids/<bid_id>/dedupe/`).
- OpenWork quick mode: prefer `.opencode/openwork/inbox/sessions/<sessionId>/refs/other/dedupe-report.md` so the report shows up in the reference library and is easy to download/share.

## Non‑Negotiables

- Do not try to “game” dedupe by meaningless paraphrasing; rewrite for specificity and correctness.
- Treat business forms/tables required by the tender as potentially “legitimately identical” — focus dedupe on the technical narrative and illustrative figures.
- Never change dates/numbers/names just to reduce similarity; facts must remain correct.

## Quick start

1. Collect the `.docx` files to compare (main + partner drafts).
2. Run:

```bash
python3 .opencode/skills/bid-dedupe/scripts/compare_bids.py \
  --out bids/<bid_id>/dedupe-report.md \
  --media-dir bids/<bid_id>/dedupe/media \
  documents/.../main.docx \
  documents/.../partner-a.docx \
  documents/.../partner-b.docx
```

This produces:

- `bids/<bid_id>/dedupe-report.md` (text+image findings)
- `bids/<bid_id>/dedupe/media/index.html` (duplicate image contact sheet for human review)

## Workflow

### Step 1 — Choose scope and thresholds

- Default thresholds are tuned for large bids; adjust only if the report is too noisy:
  - near-duplicate text similarity threshold: `--sim-threshold 0.92`
  - simhash Hamming distance filter: `--simhash-max-dist 4`
  - ignore short chunks (`--min-chars 400`) for near-duplicate detection
  - ignore short exact duplicates (`--exact-min-chars 200`)
- To reduce noise from standard forms/tables, use `--exclude-tables` (text only).
- To limit the analysis to specific sections, use:
  - `--list-headings` to inspect detected chunk titles
  - `--include-title-regex` / `--exclude-title-regex` to filter text chunks by heading title

### Step 2 — Generate intermediate artifacts (optional)

- Extract chunks per `.docx`:

```bash
python3 .opencode/skills/bid-dedupe/scripts/extract_docx_chunks.py documents/.../main.docx \
  --out bids/<bid_id>/dedupe/main.chunks.json
```

- Extract image hashes:

```bash
python3 .opencode/skills/bid-dedupe/scripts/extract_docx_media_hashes.py documents/.../main.docx \
  --out bids/<bid_id>/dedupe/main.images.json
```

### Step 3 — Interpret the report

- Address findings in this order:
  1. Duplicate images across different bids (highest “串标” risk)
  2. Large verbatim technical blocks across bids
  3. Boilerplate blocks that contain wrong names/dates (also a QC issue)

### Step 4 — Fix and re-run

- Apply edits in the `.docx` drafts.
- Re-run `compare_bids.py` until high-risk items are resolved.

## Optional: near-duplicate image detection

To catch resized/recompressed “same” images, install Pillow:

```bash
python3 -m pip install pillow
```

Then re-run `compare_bids.py` to include dHash-based matching.
