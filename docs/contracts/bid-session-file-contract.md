# Bid Session File Contract (SSOT)

Status: active

This document is the single source of truth for bid workflow file paths, session isolation, and process artifacts.

## 1) Scope

This contract applies to:

- `.opencode/agent/document-writer.md`
- `.opencode/agent/common-work.md`
- `.opencode/skills/bid-analysis/SKILL.md`
- `.opencode/skills/bid-drafting/SKILL.md`
- `.opencode/skills/bid-qc/SKILL.md`
- `.opencode/skills/bid-dedupe/SKILL.md`
- server runtime (`packages/server/src/document.ts`)

## 2) Canonical roots and isolation

- Canonical logical session root: `documents/sessions/<sessionId>/`
- Runtime may mount this root at any absolute path.
- Documentation and persisted metadata MUST use `<SESSION_ROOT>` as path placeholder when giving runnable examples.
- All read/write operations MUST stay inside current `<SESSION_ROOT>`.
- Cross-session access is forbidden.

## 3) Path persistence contract

### 3.1 Persisted paths MUST be session-relative

The following persisted fields MUST be paths relative to `<SESSION_ROOT>`:

- `.worktree/index.json` fields: `tender_file`, `target_doc`, `conventions_ref`, `children[].node_ref`, optional `facts_ref`
- `.worktree/material-registry.json` keys
- `file-triage.json` file entries (`rel_path`)
- any report index/registry fields that reference files

Absolute paths MUST NOT be persisted.

### 3.2 Absolute input handling

Agent input may contain absolute paths (for example from `@` references).

Allowed behavior:

1. Use the absolute path for immediate file IO.
2. Before writing metadata/index/registry, convert to session-relative path.
3. If conversion fails or path escapes `<SESSION_ROOT>`, reject as out-of-scope.

## 4) Reserved directories and visibility

Inside `<SESSION_ROOT>`:

- Persistent process state: `.worktree/`, `.bid/`
- Temporary artifacts: `.tmp/`
- User-visible outputs: any non-hidden path (for example `reports/`, final `.docx`, `.pdf`)

UI may hide hidden directories; do not assume hidden files are always listed in the file panel.

## 5) Input scan hygiene

When scanning source materials (triage/indexing), default include is `<SESSION_ROOT>/**` excluding:

- `.tmp/**`
- `.worktree/**`
- `.bid/**`
- `reports/**`
- `.archive/**`
- `artifacts/**`

These directories are process/output artifacts, not source materials.

## 6) Facts contract

Canonical facts path:

- `<SESSION_ROOT>/.bid/facts.json`

Write path:

- New writes MUST target `.bid/facts.json` only.

Compatibility:

- Legacy root-level `facts.json` may be read-only fallback if present.

## 7) file-triage schema contract

`file-triage.json` uses schema version 2 for new writes.

Minimal entry shape:

```json
{
  "version": 2,
  "total": 156,
  "classified_by_name": 116,
  "classified_by_content": 13,
  "by_category": {
    "tender_main": [
      { "rel_path": "招标文件.pdf", "name": "招标文件.pdf", "size": 1024000 }
    ]
  }
}
```

Valid categories: `tender_main`, `tender_attachment`, `historical_bid`, `qualification`, `pricing_data`, `product_doc`, `image_asset`, `archive`, `other`.

Rules:

- each file entry MUST include `rel_path`, `name`, `size`
- `image_asset` entries SHOULD include `source_pdf` field linking to the parent PDF
- `rel_path` MUST be unique within a session
- `classified_by_name` and `classified_by_content` are optional counters for triage efficiency tracking
- v1 (string-array) may be read for compatibility but MUST NOT be newly written

## 8) Worktree contract

- `.worktree/index.json` remains schema version 1
- `target_doc` MUST be session-relative
- optional `facts_ref` SHOULD be `.bid/facts.json`
- for small requirement sets, a lightweight `.worktree` is allowed (index + conventions, no nodes)

## 9) Cleanup contract

- Keep `.worktree/` and `.bid/` for resume/recovery across long chains and context compression.
- Clean `.tmp/` after task step completion when safe.
- Do not delete persistent state required for resuming.

## 10) Bid module API boundary

- Agent dialog + skills is the primary supported path.
- `/bid/*` standalone module API is optional/experimental and disabled by default.
- When disabled, server returns `501 bid_module_api_disabled` (no 500).

## 11) Runtime/document/test traceability

| Contract item | Implementation | Validation |
|---|---|---|
| session isolation | `packages/server/src/document.ts` path guards | session A/B access tests |
| relative-path persistence | agent + skill docs, registry/triage schemas | `scripts/validate-bid-contract-consistency.mjs` + scenario tests |
| facts canonical path | bid-analysis/bid-drafting/bid-qc docs + server | facts path scenario tests |
| scan exclusions | bid-analysis docs | large-upload rerun test |
| module API disabled | `packages/server/src/document.ts` `/bid/*` gate | API returns 501, UI has no active入口 |

