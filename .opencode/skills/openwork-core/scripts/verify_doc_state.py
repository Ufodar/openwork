#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_path(workspace: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path.resolve()
    return (workspace / path).resolve()


def extract_headings(markdown: str) -> list[str]:
    headings: list[str] = []
    for line in markdown.splitlines():
        match = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", line)
        if match:
            headings.append(match.group(1).strip())
    return headings


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def looks_like_heading(value: str) -> bool:
    text = normalize_text(value)
    if not text:
        return False
    if len(text) > 90:
        return False
    patterns = [
        r"^第[一二三四五六七八九十百0-9]+[章节部分篇]",
        r"^[0-9一二三四五六七八九十]+[、.．)]",
        r"^(项目概况|项目理解|系统架构|技术路线|接口示例|实施方案|风险与待确认项|执行摘要)",
    ]
    return any(re.match(pattern, text) for pattern in patterns)


def normalize_heading(value: str) -> str:
    normalized = value.strip()
    normalized = re.sub(r"^\s{0,3}#{1,6}\s+", "", normalized)
    normalized = re.sub(r"^[（(]?[0-9一二三四五六七八九十]+(?:\.[0-9]+)*[)）]?[、.\s]+", "", normalized)
    normalized = re.sub(r"^\s+", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def section_present(section: str, headings: list[str]) -> bool:
    target = normalize_heading(section)
    return any(normalize_heading(heading) == target for heading in headings)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_report(*, target: str, required_sections: list[str], confirmed_sections: list[str], missing_sections: list[str], detected_headings: list[str], remaining_risks: list[dict], next_action: str) -> str:
    lines = [
        "# 文档验证报告",
        "",
        f"- 目标文档: `{target}`",
        f"- 生成时间: `{now_iso()}`",
        "",
        "## 已检查章节",
        "",
    ]

    if confirmed_sections:
        for section in confirmed_sections:
            lines.append(f"- {section}")
    else:
        lines.append("- 无")

    lines.extend([
        "",
        "## 缺失章节",
        "",
    ])
    if missing_sections:
        for section in missing_sections:
            lines.append(f"- {section}")
    else:
        lines.append("- 无")

    lines.extend([
        "",
        "## 检测到的标题",
        "",
    ])
    if detected_headings:
        for heading in detected_headings:
            lines.append(f"- {heading}")
    else:
        lines.append("- 无")

    lines.extend([
        "",
        "## 剩余风险",
        "",
    ])
    if remaining_risks:
        for risk in remaining_risks:
            topic = risk.get("topic") or risk.get("id") or "未命名风险"
            reason = risk.get("reason") or risk.get("rationale") or "需要后续核对"
            lines.append(f"- {topic}: {reason}")
    else:
        lines.append("- 无")

    lines.extend([
        "",
        "## 下一步",
        "",
        f"- {next_action}",
        "",
        "## 必检章节",
        "",
    ])
    for section in required_sections:
        lines.append(f"- {section}")

    return "\n".join(lines) + "\n"


def extract_docx_headings(path: Path) -> tuple[list[str], bool, str | None]:
    if not zipfile.is_zipfile(path):
        return [], False, "目标文档不是合法的 .docx 文件，当前更像文本、脚本或其他非 Office 包格式。"

    try:
        from docx import Document
    except Exception as exc:  # pragma: no cover
        return [], False, f"python-docx unavailable: {exc}"

    try:
        document = Document(str(path))
    except Exception as exc:
        return [], False, f"目标文档不是合法的 .docx 文件，python-docx 无法打开：{exc}"

    headings: list[str] = []
    for paragraph in document.paragraphs:
        text = normalize_text(paragraph.text)
        if not text:
            continue
        style_name = normalize_text(getattr(getattr(paragraph, "style", None), "name", ""))
        if "heading" in style_name.lower() or looks_like_heading(text):
            headings.append(text)
    return headings, True, None


def read_target_headings(target_path: Path) -> tuple[list[str], str, bool, list[dict]]:
    suffix = target_path.suffix.lower()
    remaining_risks: list[dict] = []

    if suffix == ".docx":
        headings, is_valid, error = extract_docx_headings(target_path)
        if not is_valid and error:
            remaining_risks.append({
                "topic": "target-format",
                "reason": error,
            })
        return headings, "docx", is_valid, remaining_risks

    markdown = target_path.read_text(encoding="utf-8")
    return extract_headings(markdown), "markdown", True, remaining_risks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--verify-out", required=True)
    parser.add_argument("--report-out")
    parser.add_argument("--required-section", action="append", default=[])
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    target_path = resolve_path(workspace, args.target)
    verify_out = resolve_path(workspace, args.verify_out)
    report_out = resolve_path(workspace, args.report_out) if args.report_out else None

    headings, target_format, target_format_valid, format_risks = read_target_headings(target_path)

    plan_path = workspace / ".worktree" / "plan" / "solution-plan.json"
    coverage_path = workspace / ".worktree" / "coverage.json"
    facts_path = workspace / ".worktree" / "facts.json"
    conflicts_path = workspace / ".worktree" / "merge" / "conflicts.json"

    plan = load_json(plan_path) if plan_path.exists() else {}
    coverage = load_json(coverage_path) if coverage_path.exists() else {}
    facts = load_json(facts_path) if facts_path.exists() else {}
    conflicts = load_json(conflicts_path) if conflicts_path.exists() else {}

    required_sections = list(args.required_section)
    if not required_sections:
      required_sections = [
          section.get("title")
          for section in plan.get("sections", [])
          if isinstance(section, dict) and isinstance(section.get("title"), str)
      ]

    confirmed_sections = [
        section
        for section in required_sections
        if section_present(section, headings)
    ]
    missing_sections = [
        section
        for section in required_sections
        if section not in confirmed_sections
    ]

    unresolved_conflicts = [
        {
            "id": item.get("id"),
            "topic": item.get("topic"),
            "reason": item.get("rationale") or "仍存在未解决冲突",
        }
        for item in conflicts.get("conflicts", [])
        if isinstance(item, dict) and item.get("unresolved", True)
    ]
    open_questions = [
        {"topic": "open-question", "reason": question}
        for question in conflicts.get("open_questions", [])
        if isinstance(question, str)
    ]
    remaining_risks = format_risks + unresolved_conflicts + open_questions

    next_action = (
        "重新生成合法的 Office 文档后重新运行 verifier。"
        if not target_format_valid
        else
        "补齐缺失章节后重新运行 verifier。"
        if missing_sections
        else "优先处理剩余未解决风险，再决定是否可以结束当前轮次。"
        if remaining_risks
        else "验证通过，可由主 agent 汇总并进入下一轮用户反馈。"
    )

    ok = target_format_valid and len(missing_sections) == 0

    verify_payload = {
        "version": 1,
        "ok": ok,
        "target_doc": os.path.relpath(target_path, workspace),
        "target_format": target_format,
        "target_format_valid": target_format_valid,
        "checked_at": now_iso(),
        "required_sections": required_sections,
        "confirmed_sections": confirmed_sections,
        "missing_sections": missing_sections,
        "detected_headings": headings,
        "facts_count": len(facts.get("canonical_facts", [])) if isinstance(facts.get("canonical_facts"), list) else 0,
        "coverage_targets": coverage.get("targets", []),
        "remaining_risks": remaining_risks,
        "next_action": next_action,
    }

    verify_out.parent.mkdir(parents=True, exist_ok=True)
    verify_out.write_text(json.dumps(verify_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if report_out is not None:
        report_out.parent.mkdir(parents=True, exist_ok=True)
        report_out.write_text(
            build_report(
                target=os.path.relpath(target_path, workspace),
                required_sections=required_sections,
                confirmed_sections=confirmed_sections,
                missing_sections=missing_sections,
                detected_headings=headings,
                remaining_risks=remaining_risks,
                next_action=next_action,
            ),
            encoding="utf-8",
        )

    print(json.dumps({
        "ok": ok,
        "target": os.path.relpath(target_path, workspace),
        "verify_out": os.path.relpath(verify_out, workspace),
        "report_out": os.path.relpath(report_out, workspace) if report_out else None,
        "confirmed_sections": len(confirmed_sections),
        "missing_sections": len(missing_sections),
        "remaining_risks": len(remaining_risks),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
