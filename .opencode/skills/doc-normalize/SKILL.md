---
name: doc-normalize
description: Scan a Word document for structural normalization issues and return a report. Use when the user asks to normalize headings, numbering, outline structure, or style consistency, or when they invoke /doc-normalize.
---

# DOCX normalization scan

## Goal

This skill performs document normalization analysis for `.docx` targets.

V1 is scan-only. It must not modify the target document.

## When To Use

Use this skill when the user wants to:

- inspect a Word document for pseudo headings or pseudo lists
- assess whether a document follows heading and numbering semantics
- check style drift against an existing template or stable target document
- run `/doc-normalize`

Do not use this skill to silently normalize a document during ordinary drafting. Ordinary drafting should preserve the current local block and inherit the target document's existing semantics.

## Workflow

1. Resolve the target `.docx` and any authoritative template or stable target document.
2. Use the `docx` skill to inspect the document structure and any relevant OOXML or faithful extraction output.
3. Capture a style baseline:
   - heading styles or heading-like paragraphs
   - numbering conventions
   - obvious paragraph spacing and table conventions if relevant
4. Scan for normalization findings.
5. Return a report. Do not mutate the document in v1.

## Scan Focus

Prioritize findings that are structural and high-confidence:

- pseudo headings such as plain paragraphs that visually look like `1.`, `1.1`, `一、`, or similar section markers
- pseudo lists such as manually typed `1.`, `(1)`, `-`, or bullet-like prefixes where true numbering should be used
- paragraph style drift where nearby equivalent blocks use a stable style system
- heading hierarchy mismatches that are obvious from surrounding structure

Lower-confidence items may still be reported, but must be marked as review-first:

- TOC or cross-reference inconsistencies
- large-scale template drift
- complex table formatting anomalies
- header, footer, image anchor, comment, or tracked-change issues

## Output

Return a concise report with these sections:

1. Target document
2. Scan scope
3. High-confidence findings
4. Review-first findings
5. Risks and unknowns
6. Suggested next natural-language follow-ups

Suggested follow-ups should stay scan-oriented in v1, for example:

- "只继续分析标题和编号"
- "把高置信问题按章节列出来"
- "对照模板再检查一次样式漂移"

## Guardrails

- Scan-only.
- Do not modify the target `.docx` in v1.
- Do not promise automatic normalization.
- If the target document or authoritative template is unclear, ask one blocking question.
- Prefer reporting uncertainty over inventing a normalization rule that is not clearly supported by the document.
