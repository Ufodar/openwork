#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from urllib.parse import urlparse
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


def extract_markdown_blocks(markdown: str) -> list[dict]:
    lines = markdown.splitlines()
    headings: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines):
        match = re.match(r"^\s{0,3}(#{1,6})\s+(.+?)\s*$", line)
        if not match:
            continue
        headings.append((index, len(match.group(1)), match.group(2).strip()))

    blocks: list[dict] = []
    for position, (line_index, level, title) in enumerate(headings):
        end_index = len(lines)
        for next_line_index, next_level, _ in headings[position + 1:]:
            if next_level <= level:
                end_index = next_line_index
                break
        blocks.append({
            "level": level,
            "title": title,
            "body": "\n".join(lines[line_index + 1:end_index]).strip(),
        })
    return blocks


def extract_markdown_section_body(markdown: str, heading_title: str) -> str:
    target = normalize_heading(heading_title)
    for block in extract_markdown_blocks(markdown):
        if normalize_heading(str(block.get("title") or "")) == target:
            return str(block.get("body") or "").strip()
    return ""


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def append_unique(items: list[str], value: str) -> None:
    normalized = normalize_text(value)
    if normalized and normalized not in items:
        items.append(normalized)


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
    previous = None
    while normalized != previous:
        previous = normalized
        normalized = re.sub(r"^第[一二三四五六七八九十百零0-9]+[章节部分篇]\s*", "", normalized)
        normalized = re.sub(r"^[（(]?[0-9一二三四五六七八九十]+(?:\.[0-9]+)*[)）]?[、.\s]+", "", normalized)
        normalized = re.sub(r"^\s+", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def section_present(section: str, headings: list[str]) -> bool:
    target = normalize_heading(section)
    return any(normalize_heading(heading) == target for heading in headings)


MANUAL_HEADING_PREFIX_PATTERNS = (
    re.compile(r"^第[一二三四五六七八九十百零0-9]+[章节部分篇]\s*"),
    re.compile(r"^[一二三四五六七八九十百零]+、\s*"),
    re.compile(r"^[（(]?[0-9]+(?:\.[0-9]+)+[)）]?\s*"),
    re.compile(r"^[（(]?[0-9]+[)）][、.\s]*"),
    re.compile(r"^[0-9]+[、.．)]\s*"),
)


def has_manual_heading_numbering(text: str) -> bool:
    normalized = normalize_text(text)
    if not normalized:
        return False
    return any(pattern.match(normalized) for pattern in MANUAL_HEADING_PREFIX_PATTERNS)


def detect_manual_heading_numbering(headings: list[str]) -> list[dict]:
    manual_samples = [
        normalize_text(heading)
        for heading in headings
        if has_manual_heading_numbering(heading)
    ]

    if not manual_samples:
        return []

    return [{
        "topic": "manual-heading-numbering",
        "reason": "标题文本仍包含手写章节/小节编号，应改由真实标题层级或渲染器编号承担结构表达。",
        "headings": manual_samples[:8],
    }]


def detect_duplicate_heading_numbering(headings: list[str]) -> list[dict]:
    duplicate_samples: list[str] = []
    numeric_prefix = re.compile(r"^[（(]?[0-9一二三四五六七八九十]+(?:\.[0-9]+)*[)）]?[、.\s]+")
    chapter_prefix = re.compile(r"^第[一二三四五六七八九十百零0-9]+[章节部分篇]\s*")

    for heading in headings:
        text = normalize_text(heading)
        if not text:
            continue
        stripped_numeric = numeric_prefix.sub("", text, count=1).strip()
        stripped_chapter = chapter_prefix.sub("", text, count=1).strip()
        if stripped_numeric != text and (
            chapter_prefix.match(stripped_numeric) or numeric_prefix.match(stripped_numeric)
        ):
            duplicate_samples.append(text)
            continue
        if stripped_chapter != text and numeric_prefix.match(stripped_chapter):
            duplicate_samples.append(text)

    if not duplicate_samples:
        return []

    return [{
        "topic": "duplicate-heading-numbering",
        "reason": "标题同时带有结构编号和手写章节/小节前缀，存在双层编号或语义重复问题。",
        "headings": duplicate_samples[:6],
    }]


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


def extract_docx_content(path: Path) -> tuple[list[str], str, bool, str | None]:
    if not zipfile.is_zipfile(path):
        return [], "", False, "目标文档不是合法的 .docx 文件，当前更像文本、脚本或其他非 Office 包格式。"

    try:
        from docx import Document
    except Exception as exc:  # pragma: no cover
        return [], "", False, f"python-docx unavailable: {exc}"

    try:
        document = Document(str(path))
    except Exception as exc:
        return [], "", False, f"目标文档不是合法的 .docx 文件，python-docx 无法打开：{exc}"

    headings: list[str] = []
    text_parts: list[str] = []
    for paragraph in document.paragraphs:
        text = normalize_text(paragraph.text)
        if not text:
            continue
        text_parts.append(text)
        style_name = normalize_text(getattr(getattr(paragraph, "style", None), "name", ""))
        if "heading" in style_name.lower() or looks_like_heading(text):
            headings.append(text)
    return headings, "\n".join(text_parts), True, None


def read_target_contents(target_path: Path) -> tuple[list[str], str, bool, list[dict], str]:
    suffix = target_path.suffix.lower()
    remaining_risks: list[dict] = []

    if suffix == ".docx":
        headings, content_text, is_valid, error = extract_docx_content(target_path)
        if not is_valid and error:
            remaining_risks.append({
                "topic": "target-format",
                "reason": error,
            })
        return headings, "docx", is_valid, remaining_risks, content_text

    markdown = target_path.read_text(encoding="utf-8")
    return extract_headings(markdown), "markdown", True, remaining_risks, markdown


LOW_AUTHORITY_DOMAINS = (
    "zhihu.com",
    "cnblogs.com",
    "51cto.com",
    "csdn.net",
    "sohu.com",
    "new.qq.com",
    "php.cn",
    "book118.com",
    "docin.com",
    "xjishu.com",
    "jigao616.com",
    "idcsp.com",
    "imooc.com",
    "360doc.cn",
    "163.com",
    "baike.baidu.com",
    "juejin.cn",
    "safehoo.com",
    "txrjy.com",
)

LOW_AUTHORITY_HOST_PATH_PATTERNS = (
    ("cloud.tencent.com", r"^/developer/article/"),
    ("developer.aliyun.com", r"^/article/"),
    ("developer.baidu.com", r"^/article/"),
)


def extract_urls(text: str) -> list[str]:
    return re.findall(r"https?://[^\s)>\]]+", text or "")


def external_research_requested(goal: str) -> bool:
    text = normalize_text(goal)
    markers = ["联网", "网络资料", "网络中的资料", "政策依据", "标准规范", "api 参考", "api调用示例"]
    lowered = text.lower()
    return any(marker in text for marker in markers) or "api" in lowered


def inspect_external_supplements(path: Path, expected: bool) -> list[dict]:
    if not expected and not path.exists():
        return []

    if not path.exists():
        return [{
            "topic": "external-supplements",
            "reason": "任务要求联网补充，但 `reports/doc-writer/external-supplements.md` 缺失。",
        }]

    text = path.read_text(encoding="utf-8")
    urls = extract_urls(text)
    if expected and not urls:
        return [{
            "topic": "external-supplements",
            "reason": "联网补充文件存在，但缺少可核对的 source URLs。",
        }]

    flagged: set[str] = set()
    for url in urls:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        route = parsed.path or ""
        if any(host == domain or host.endswith(f".{domain}") for domain in LOW_AUTHORITY_DOMAINS):
            flagged.add(host)
            continue
        for host_pattern, path_pattern in LOW_AUTHORITY_HOST_PATH_PATTERNS:
            if (host == host_pattern or host.endswith(f".{host_pattern}")) and re.search(path_pattern, route):
                flagged.add(host)
                break

    if not flagged:
        return []

    return [{
        "topic": "low-authority-external-sources",
        "reason": "联网补充主要依赖低权威来源，需要改用更权威的官方、标准或厂商文档。",
        "domains": sorted(flagged),
    }]


GENERIC_EXTERNAL_REFERENCE_MARKERS = (
    "如需进一步补充",
    "建议进行针对性联网检索",
    "建议进行联网检索",
    "建议进一步联网检索",
    "建议检索以下内容",
    "主要基于已上传的两份文档内容进行整理和重组",
)


def detect_unsurfaced_external_citations(target_text: str, target_format: str, supplements_path: Path) -> list[dict]:
    if target_format != "markdown" or not supplements_path.exists():
        return []

    supplements_text = supplements_path.read_text(encoding="utf-8")
    if not extract_urls(supplements_text):
        return []

    section_body = extract_markdown_section_body(target_text, "联网补充依据")
    if not section_body:
        return []

    marker_hits = [marker for marker in GENERIC_EXTERNAL_REFERENCE_MARKERS if marker in section_body]
    if not marker_hits:
        return []

    has_concrete_citations = any(re.search(pattern, section_body) for pattern in (
        r"https?://",
        r"RFC\s*\d+",
        r"《[^》]+》",
        r"(工信部|发改)[^\n]{0,20}\d+号",
    ))
    if has_concrete_citations:
        return []

    return [{
        "topic": "external-support-not-surfaced",
        "reason": "已完成联网补充并生成补充报告，但最终交付物的 `联网补充依据` 仍停留在建议检索/后续补充口径，没有把实际采用的外部依据落到正文。",
        "markers": marker_hits[:4],
    }]


UNSUPPORTED_CONCRETE_TERMS = (
    "OpenAPI 3.0",
    "PromQL",
    "Kubernetes Federation",
    "NVIDIA MIG",
    "消息队列",
    "事件总线",
    "时序数据库",
    "gRPC",
    "WebSocket",
    "RabbitMQ",
    "Kafka",
)


def build_support_text(facts: dict, supplements_path: Path) -> str:
    chunks: list[str] = []
    for fact in facts.get("canonical_facts", []) if isinstance(facts.get("canonical_facts"), list) else []:
        if not isinstance(fact, dict):
            continue
        statement = fact.get("statement")
        if isinstance(statement, str):
            chunks.append(statement)
        for source in fact.get("sources", []) if isinstance(fact.get("sources"), list) else []:
            if not isinstance(source, dict):
                continue
            evidence = source.get("evidence")
            if isinstance(evidence, str):
                chunks.append(evidence)
    if supplements_path.exists():
        chunks.append(supplements_path.read_text(encoding="utf-8"))
    return "\n".join(chunks)


def support_contains_term(term: str, support_text: str) -> bool:
    if term in support_text:
        return True

    lowered_support = support_text.lower()
    lowered_term = term.lower()
    if lowered_term in lowered_support:
        return True

    ascii_tokens = re.findall(r"[a-z0-9]+", lowered_term)
    if len(ascii_tokens) >= 2 and all(token in lowered_support for token in ascii_tokens):
        return True

    return False


def detect_unsupported_concrete_terms(target_text: str, support_text: str) -> list[dict]:
    risks: list[dict] = []
    for term in UNSUPPORTED_CONCRETE_TERMS:
        if term in target_text and not support_contains_term(term, support_text):
            risks.append({
                "topic": "weakly-supported-concrete-term",
                "reason": f"正文出现了 `{term}`，但事实白名单和联网补充里没有对应依据。",
                "term": term,
            })
    return risks


COMMERCIAL_NOISE_TERMS = (
    "商品",
    "充值",
    "优惠券",
    "购物车",
    "支付",
    "账户余额",
    "店铺",
    "消费",
    "红包",
    "下架",
)


def proposal_style_goal(goal: str) -> bool:
    text = normalize_text(goal)
    if not text:
        return False
    markers = ("项目申报", "技术材料", "建设方案", "投标", "标书", "三大系统", "技术方案")
    return any(marker in text for marker in markers)


ADMIN_METADATA_LABELS = (
    "项目编号",
    "申报单位",
    "建设单位",
    "实施单位",
    "申报日期",
    "联系人",
    "联系电话",
    "联系地址",
    "项目负责人",
)


def detect_unsourced_administrative_metadata(target_text: str, support_text: str, goal: str) -> list[dict]:
    if not proposal_style_goal(goal):
        return []

    evidence_text = "\n".join([support_text, goal])
    samples: list[str] = []
    fields: list[str] = []
    header_lines = [
        normalize_text(line)
        for line in target_text.splitlines()
        if normalize_text(line)
    ][:15]

    for line in header_lines:
        match = re.match(
            rf"^({'|'.join(re.escape(label) for label in ADMIN_METADATA_LABELS)})\s*[：:]\s*(.+)$",
            line,
        )
        if not match:
            continue
        label, value = match.groups()
        if support_contains_term(value, evidence_text):
            continue
        append_unique(fields, label)
        append_unique(samples, line)

    if not fields:
        return []

    return [{
        "topic": "unsourced-administrative-metadata",
        "reason": "封面或前言出现了未在任务说明、事实白名单或补充材料中得到支持的管理字段，应删除或改为待补充。",
        "fields": fields,
        "samples": samples[:6],
    }]


def detect_commercial_noise(target_text: str, goal: str) -> list[dict]:
    if not proposal_style_goal(goal):
        return []

    matched_terms = [
        term
        for term in COMMERCIAL_NOISE_TERMS
        if term in target_text
    ]
    if not matched_terms:
        return []

    samples: list[str] = []
    for line in target_text.splitlines():
        text = normalize_text(line)
        if text and any(term in text for term in matched_terms):
            samples.append(text)
        if len(samples) >= 3:
            break

    return [{
        "topic": "commercial-noise",
        "reason": "技术材料正文混入了与当前系统无关的商业/商城词汇，应清理为面向架构、实现和接口的专业表达。",
        "terms": matched_terms[:8],
        "samples": samples,
    }]


def detect_duplicate_architecture_labels(target_text: str, target_format: str) -> list[dict]:
    if target_format != "markdown":
        return []

    risks: list[dict] = []
    for block in extract_markdown_blocks(target_text):
        if normalize_heading(str(block.get("title") or "")) != "技术架构":
            continue

        labels: list[str] = []
        for line in str(block.get("body") or "").splitlines():
            match = re.match(r"^\s*\*\*([^*\n]{1,60})\*\*[：:]?", line)
            if not match:
                continue
            labels.append(normalize_text(match.group(1)))

        duplicates = sorted({label for label in labels if label and labels.count(label) > 1})
        if not duplicates:
            continue

        risks.append({
            "topic": "duplicate-architecture-label",
            "reason": "同一 `技术架构` 小节重复使用了相同层级或组件标签，结构表达不清，应合并或明确区分。",
            "labels": duplicates[:6],
        })

    return risks


def derive_required_sections(plan: dict, coverage: dict) -> tuple[list[str], list[dict]]:
    required_sections: list[str] = []
    schema_risks: list[dict] = []

    plan_sections = plan.get("sections") if isinstance(plan.get("sections"), list) else []
    coverage_targets = coverage.get("targets") if isinstance(coverage.get("targets"), list) else []

    has_custom_plan_schema = any(
        isinstance(section, dict) and section.get("system") and isinstance(section.get("modules"), list) and not section.get("title")
        for section in plan_sections
    )
    has_custom_coverage_schema = any(
        isinstance(target, dict) and target.get("system") and isinstance(target.get("modules"), list) and not target.get("title")
        for target in coverage_targets
    )

    for section in plan_sections:
        if not isinstance(section, dict):
            continue
        title = section.get("title")
        if isinstance(title, str):
            append_unique(required_sections, title)

    if not required_sections:
        for target in coverage_targets:
            if not isinstance(target, dict):
                continue
            if isinstance(target.get("title"), str):
                append_unique(required_sections, target["title"])
            if isinstance(target.get("system"), str):
                append_unique(required_sections, target["system"])
            for subsection in target.get("required_subsections", []) if isinstance(target.get("required_subsections"), list) else []:
                if isinstance(subsection, str):
                    append_unique(required_sections, subsection)
            for module in target.get("modules", []) if isinstance(target.get("modules"), list) else []:
                if not isinstance(module, dict):
                    continue
                if module.get("required", True) and isinstance(module.get("name"), str):
                    append_unique(required_sections, module["name"])

    if not required_sections:
        for section in plan_sections:
            if not isinstance(section, dict):
                continue
            if isinstance(section.get("system"), str):
                append_unique(required_sections, section["system"])
            for module in section.get("modules", []) if isinstance(section.get("modules"), list) else []:
                if isinstance(module, dict) and isinstance(module.get("name"), str):
                    append_unique(required_sections, module["name"])

    if has_custom_plan_schema or has_custom_coverage_schema:
        schema_risks.append({
            "topic": "plan-schema-mismatch",
            "reason": "plan/coverage 使用了自定义 `system/modules` 结构而不是标准 section schema；verifier 已按兼容规则推导必检章节，但上游仍需恢复标准机器可读字段。",
        })

    return required_sections, schema_risks


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

    headings, target_format, target_format_valid, format_risks, target_text = read_target_contents(target_path)

    plan_path = workspace / ".worktree" / "plan" / "solution-plan.json"
    coverage_path = workspace / ".worktree" / "coverage.json"
    facts_path = workspace / ".worktree" / "facts.json"
    conflicts_path = workspace / ".worktree" / "merge" / "conflicts.json"
    supplements_path = workspace / "reports" / "doc-writer" / "external-supplements.md"

    plan = load_json(plan_path) if plan_path.exists() else {}
    coverage = load_json(coverage_path) if coverage_path.exists() else {}
    facts = load_json(facts_path) if facts_path.exists() else {}
    conflicts = load_json(conflicts_path) if conflicts_path.exists() else {}

    required_sections = list(args.required_section)
    schema_risks: list[dict] = []
    if not required_sections:
        required_sections, schema_risks = derive_required_sections(plan, coverage)

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
    supplement_risks = inspect_external_supplements(
        supplements_path,
        expected=external_research_requested(str(plan.get("goal") or facts.get("goal") or "")),
    )
    surfaced_external_risks = detect_unsurfaced_external_citations(target_text, target_format, supplements_path)
    support_text = build_support_text(facts, supplements_path)
    unsupported_term_risks = detect_unsupported_concrete_terms(target_text, support_text)
    administrative_metadata_risks = detect_unsourced_administrative_metadata(
        target_text,
        support_text,
        str(plan.get("goal") or facts.get("goal") or ""),
    )
    commercial_noise_risks = detect_commercial_noise(target_text, str(plan.get("goal") or facts.get("goal") or ""))
    duplicate_architecture_label_risks = detect_duplicate_architecture_labels(target_text, target_format)
    manual_numbering_risks = detect_manual_heading_numbering(headings)
    numbering_risks = detect_duplicate_heading_numbering(headings)
    remaining_risks = format_risks + unresolved_conflicts + open_questions + schema_risks + supplement_risks + surfaced_external_risks + unsupported_term_risks + administrative_metadata_risks + commercial_noise_risks + duplicate_architecture_label_risks + manual_numbering_risks + numbering_risks

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
