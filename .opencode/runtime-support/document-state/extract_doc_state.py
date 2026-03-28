#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


DOCX_EXTENSIONS = {".docx", ".docm", ".dotx", ".dotm"}
TEXTUTIL_EXTENSIONS = {".doc", ".rtf", ".txt", ".html", ".htm", ".odt"}


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def looks_like_heading(value: str) -> bool:
    text = normalize_whitespace(value)
    if not text:
        return False
    if len(text) > 90:
        return False
    patterns = [
        r"^第[一二三四五六七八九十百0-9]+[章节部分篇]",
        r"^[0-9一二三四五六七八九十]+[、.．)]",
        r"^(项目概况|服务要求|技术要求|评分标准|投标要求|建设内容|实施方案|商务条款)",
    ]
    return any(re.match(pattern, text) for pattern in patterns)


def split_sentences(value: str) -> list[str]:
    text = normalize_whitespace(value)
    if not text:
        return []
    raw_parts = re.split(r"(?<=[。！？；;.!?])\s+|(?<=[。！？；;.!?])", text)
    sentences: list[str] = []
    for part in raw_parts:
        item = normalize_whitespace(part)
        if len(item) < 10:
            continue
        sentences.append(item)
    return sentences


def extract_docx(path: Path) -> tuple[list[dict], list[dict]]:
    try:
        from docx import Document
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"python-docx unavailable: {exc}") from exc

    document = Document(str(path))
    blocks: list[dict] = []
    sections: list[dict] = []
    for index, paragraph in enumerate(document.paragraphs, start=1):
        text = normalize_whitespace(paragraph.text)
        if not text:
            continue
        style_name = normalize_whitespace(getattr(getattr(paragraph, "style", None), "name", ""))
        blocks.append({
            "locator": f"paragraph:{index}",
            "text": text,
            "style": style_name,
        })
        if "heading" in style_name.lower() or looks_like_heading(text):
            sections.append({
                "title": text,
                "locator": f"paragraph:{index}",
            })
    return blocks, sections


def extract_pdf(path: Path) -> tuple[list[dict], list[dict]]:
    command = ["pdftotext", "-layout", "-nopgbrk", str(path), "-"]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr = normalize_whitespace(result.stderr)
        raise RuntimeError(f"pdftotext failed: {stderr or result.returncode}")

    blocks: list[dict] = []
    sections: list[dict] = []
    for index, line in enumerate(result.stdout.splitlines(), start=1):
        text = normalize_whitespace(line)
        if not text:
            continue
        blocks.append({
            "locator": f"line:{index}",
            "text": text,
            "style": "",
        })
        if looks_like_heading(text):
            sections.append({
                "title": text,
                "locator": f"line:{index}",
            })
    return blocks, sections


def extract_textutil(path: Path) -> tuple[list[dict], list[dict]]:
    command = ["textutil", "-convert", "txt", "-stdout", str(path)]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr = normalize_whitespace(result.stderr)
        raise RuntimeError(f"textutil failed: {stderr or result.returncode}")

    blocks: list[dict] = []
    sections: list[dict] = []
    for index, line in enumerate(result.stdout.splitlines(), start=1):
        text = normalize_whitespace(line)
        if not text:
            continue
        blocks.append({
            "locator": f"line:{index}",
            "text": text,
            "style": "",
        })
        if looks_like_heading(text):
            sections.append({
                "title": text,
                "locator": f"line:{index}",
            })
    return blocks, sections


def infer_role(relative_path: str, explicit_role: str | None) -> str:
    if explicit_role:
        return explicit_role
    lower = relative_path.lower()
    if "招标" in relative_path or "tender" in lower:
        return "招标文件"
    if "终版" in relative_path or "final" in lower:
        return "终版材料"
    if "投标" in relative_path or "bid" in lower:
        return "投标文件"
    return "参考材料"


def build_summary(blocks: list[dict], *, max_chars: int = 700, max_parts: int = 4) -> str:
    parts: list[str] = []
    total = 0
    for block in blocks:
        text = block["text"]
        if len(text) < 12:
            continue
        if total + len(text) > max_chars and parts:
            break
        parts.append(text)
        total += len(text)
        if len(parts) >= max_parts:
            break
    return normalize_whitespace(" ".join(parts))


def build_section_groups(
    blocks: list[dict],
    sections: list[dict],
    *,
    fallback_title: str,
) -> tuple[list[dict], dict[str, str]]:
    section_starts = {
        str(section.get("locator") or ""): normalize_whitespace(str(section.get("title") or ""))
        for section in sections
        if str(section.get("locator") or "").strip()
    }

    groups: list[dict] = []
    current: dict | None = None

    for block in blocks:
        locator = str(block.get("locator") or "")
        heading_title = section_starts.get(locator)
        if heading_title:
            if current and current["blocks"]:
                groups.append(current)
            current = {
                "title": heading_title,
                "locator": locator,
                "blocks": [block],
            }
            continue

        if current is None:
            current = {
                "title": fallback_title,
                "locator": locator,
                "blocks": [block],
            }
        else:
            current["blocks"].append(block)

    if current and current["blocks"]:
        groups.append(current)

    locator_to_section: dict[str, str] = {}
    normalized_groups: list[dict] = []
    for group in groups:
        group_blocks = group.get("blocks") or []
        if not group_blocks:
            continue
        title = normalize_whitespace(str(group.get("title") or "")) or fallback_title
        locator = str(group.get("locator") or group_blocks[0].get("locator") or "")
        normalized_group = {
            "title": title,
            "locator": locator,
            "blocks": group_blocks,
        }
        normalized_groups.append(normalized_group)
        for block in group_blocks:
            block_locator = str(block.get("locator") or "")
            if block_locator:
                locator_to_section[block_locator] = title

    return normalized_groups, locator_to_section


def build_statement_limit(block_count: int, section_count: int, *, base: int, cap: int, block_divisor: int, section_divisor: int) -> int:
    return max(base, min(cap, (block_count // block_divisor) + max(0, section_count // section_divisor)))


def select_statements(
    blocks: list[dict],
    *,
    kind: str,
    limit: int,
    section_lookup: dict[str, str] | None = None,
) -> list[dict]:
    keywords = {
        "claim": [
            "项目", "采购", "建设", "服务", "功能", "要求", "方案", "实施", "技术", "标准",
            "系统", "平台", "架构", "调度", "监控", "安全", "接口", "资源", "算力",
        ],
        "fact": [
            "时间", "金额", "数量", "评分", "期限", "地址", "联系人", "标准", "平台", "接口",
            "系统", "架构", "调度", "监控", "安全", "认证", "协议", "标签", "资源", "算力",
        ],
    }[kind]

    candidates: list[tuple[int, int, str, str]] = []
    for block in blocks:
        locator = block["locator"]
        section_title = normalize_whitespace((section_lookup or {}).get(locator) or "")
        for sentence in split_sentences(block["text"]):
            score = sum(2 for keyword in keywords if keyword in sentence)
            if kind == "fact" and re.search(r"\d", sentence):
                score += 2
            if len(sentence) >= 40:
                score += 1
            if len(sentence) >= 100:
                score += 1
            if section_title and any(keyword in section_title for keyword in ["架构", "技术", "系统", "平台", "调度", "监控", "安全", "接口", "标识", "资源", "认证"]):
                score += 2
            if score <= 0:
                continue
            candidates.append((score, len(sentence), sentence, locator))

    candidates.sort(key=lambda item: (-item[0], -item[1], item[2]))
    selected: list[dict] = []
    seen = set()
    for score, _, sentence, locator in candidates:
        if sentence in seen:
            continue
        seen.add(sentence)
        index = len(selected) + 1
        selected.append({
            "id": f"{kind}-{index}",
            "statement": sentence,
            "locator": locator,
            "section": (section_lookup or {}).get(locator) or None,
            "evidence": sentence[:220],
            "confidence": min(0.95, 0.45 + (score * 0.1)),
        })
        if len(selected) >= limit:
            break
    return selected


def build_section_briefs(section_groups: list[dict]) -> list[dict]:
    briefs: list[dict] = []
    for group in section_groups:
        raw_blocks = group.get("blocks") or []
        if not raw_blocks:
            continue
        title = normalize_whitespace(str(group.get("title") or ""))
        content_blocks = raw_blocks
        if normalize_whitespace(str(raw_blocks[0].get("text") or "")) == title and len(raw_blocks) > 1:
            content_blocks = raw_blocks[1:]
        summary = build_summary(content_blocks or raw_blocks, max_chars=520, max_parts=5)
        lookup = {
            str(block.get("locator") or ""): title
            for block in (content_blocks or raw_blocks)
            if str(block.get("locator") or "").strip()
        }
        key_points = select_statements(
            content_blocks or raw_blocks,
            kind="fact",
            limit=4,
            section_lookup=lookup,
        )
        if not summary and not key_points:
            continue
        briefs.append({
            "title": title,
            "locator": str(group.get("locator") or ""),
            "summary": summary,
            "key_points": [
                {
                    "statement": str(item.get("statement") or ""),
                    "locator": str(item.get("locator") or ""),
                }
                for item in key_points
            ],
        })
    return briefs[:80]


def build_open_questions(blocks: list[dict], sections: list[dict]) -> list[str]:
    corpus = "\n".join(block["text"] for block in blocks)
    questions: list[str] = []
    if "评分" not in corpus:
        questions.append("未明显识别到评分标准，需要后续核对。")
    if "实施" not in corpus and "进度" not in corpus:
        questions.append("未明显识别到实施计划或里程碑，需要后续核对。")
    if not sections:
        questions.append("未稳定识别到章节结构，需要后续人工补充定位。")
    return questions[:5]


def build_gaps(blocks: list[dict], sections: list[dict]) -> list[str]:
    gaps: list[str] = []
    if len(blocks) < 20:
        gaps.append("可提取文本较少，结构化结果可能只覆盖文档局部。")
    if not sections:
        gaps.append("未识别到可靠章节标题，后续引用定位主要依赖行号或段落号。")
    return gaps[:5]


def extract_blocks(path: Path) -> tuple[list[dict], list[dict]]:
    suffix = path.suffix.lower()
    if suffix in DOCX_EXTENSIONS:
        return extract_docx(path)
    if suffix == ".pdf":
        return extract_pdf(path)
    if suffix in TEXTUTIL_EXTENSIONS:
        return extract_textutil(path)
    raise RuntimeError(f"Unsupported source type: {suffix}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--doc-id", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--role")
    parser.add_argument("--cwd", default=os.getcwd())
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.is_absolute():
        input_path = Path(args.cwd) / input_path
    input_path = input_path.resolve()
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = Path(args.cwd) / output_path
    output_path = output_path.resolve()

    blocks, sections = extract_blocks(input_path)
    if not blocks:
        raise RuntimeError(f"No text extracted from {input_path}")

    relative_path = os.path.relpath(str(input_path), args.cwd)
    title = input_path.stem.replace("_", " ").replace("-", " ").strip()
    role = infer_role(relative_path, args.role)
    section_groups, locator_to_section = build_section_groups(
        blocks,
        sections,
        fallback_title=title or "文档概览",
    )
    claim_limit = build_statement_limit(
        len(blocks),
        len(section_groups),
        base=12,
        cap=32,
        block_divisor=24,
        section_divisor=4,
    )
    fact_limit = build_statement_limit(
        len(blocks),
        len(section_groups),
        base=16,
        cap=40,
        block_divisor=18,
        section_divisor=3,
    )
    claims = select_statements(blocks, kind="claim", limit=claim_limit, section_lookup=locator_to_section)
    facts = select_statements(blocks, kind="fact", limit=fact_limit, section_lookup=locator_to_section)
    section_briefs = build_section_briefs(section_groups)

    payload = {
        "docId": args.doc_id,
        "title": title,
        "relativePath": relative_path,
        "kind": input_path.suffix.lower().lstrip("."),
        "role": role,
        "summary": build_summary(blocks),
        "sections": sections[:80],
        "section_briefs": section_briefs,
        "claims": claims,
        "facts": facts,
        "gaps": build_gaps(blocks, sections),
        "open_questions": build_open_questions(blocks, sections),
        "meta": {
            "extractor": "runtime-support/document-state/extract_doc_state.py",
            "blockCount": len(blocks),
            "sectionBriefCount": len(section_briefs),
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "docId": args.doc_id,
        "output": os.path.relpath(str(output_path), args.cwd),
        "summary": payload["summary"][:240],
        "sections": len(payload["sections"]),
        "claims": len(payload["claims"]),
        "facts": len(payload["facts"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
