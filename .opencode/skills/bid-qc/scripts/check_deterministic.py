#!/usr/bin/env python3
"""
Deterministic **pre-screen** checks for bid documents.

Runs hard-rule validations that produce the same output for the same input,
independent of LLM judgment. Designed to be called from the bid-qc skill
as Step 2a (deterministic pre-screen layer).

IMPORTANT: Each check's ``pass`` status only means the check passed within
its declared ``scope``. The ``uncovered`` list in each result specifies what
the check does NOT verify — those aspects require LLM follow-up in Step 2c.

Operates on an unpacked OOXML directory (word/document.xml etc.).

Usage:
    python check_deterministic.py \
        --unpacked /path/to/unpacked/ \
        --facts facts.json \
        --requirements requirements.csv \
        --output reports/qc-deterministic.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    import defusedxml.ElementTree as ET  # type: ignore
except ModuleNotFoundError:
    import xml.etree.ElementTree as ET  # type: ignore

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def _cell_text(node: Any) -> str:
    parts: list[str] = []
    for t in node.iter(w("t")):
        if t.text:
            parts.append(t.text)
    return "".join(parts)


def _norm_text(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").strip())


def _parse_document_xml(unpacked_dir: Path) -> Any:
    doc_path = unpacked_dir / "word" / "document.xml"
    if not doc_path.exists():
        return None
    return ET.parse(str(doc_path)).getroot()


def _get_body(root: Any) -> Any:
    return root.find(w("body")) if root is not None else None


def _get_full_text(body: Any) -> str:
    return _cell_text(body) if body is not None else ""


# ---------------------------------------------------------------------------
# Check modules — each returns { name, status, scope, uncovered, findings[] }
# status: pass | fail | skip | not_applicable
# ---------------------------------------------------------------------------


def check_entity_presence(
    body: Any, full_text: str, facts: dict[str, Any] | None
) -> dict[str, Any]:
    """Check company/project name presence in full text and blacklist residuals."""
    findings: list[str] = []

    _SCOPE = (
        "检查 facts.json 中的 companyName/projectName/projectCode 是否出现在全文中"
        "（去空格匹配）；检查黑名单公司名是否残留"
    )
    _UNCOVERED = [
        "不检查全称vs简称混用",
        "不检查合作方/供应商名称与资质文件匹配",
        "不检查表格/页眉中的实体名与正文是否一致",
    ]

    if not facts:
        return {
            "name": "entity_presence",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No facts.json provided — skipping entity checks"],
        }

    full_text_norm = _norm_text(full_text)

    # Company name check
    company_name = facts.get("companyName") or facts.get("company_name")
    if company_name:
        if _norm_text(company_name) not in full_text_norm:
            findings.append(f"Company name '{company_name}' not found in document")
    else:
        findings.append("No companyName in facts.json — cannot validate entity consistency")

    # Blacklist: other company names that should NOT appear
    blacklist = facts.get("companyBlacklist") or facts.get("company_blacklist") or []
    for name in blacklist:
        if _norm_text(name) in full_text_norm:
            findings.append(f"Blacklisted company name '{name}' found in document (residual from old bid?)")

    # Project name check
    project_name = facts.get("projectName") or facts.get("project_name")
    if project_name:
        if _norm_text(project_name) not in full_text_norm:
            findings.append(f"Project name '{project_name}' not found in document")

    # Project code check
    project_code = facts.get("projectCode") or facts.get("project_code")
    if project_code:
        if _norm_text(project_code) not in full_text_norm:
            findings.append(f"Project code '{project_code}' not found in document")

    return {
        "name": "entity_presence",
        "status": "fail" if findings else "pass",
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


def check_amount_consistency(
    body: Any, full_text: str, facts: dict[str, Any] | None
) -> dict[str, Any]:
    """Parse pricing tables — verify item totals sum to grand total, check budget cap."""
    findings: list[str] = []

    _UNCOVERED = [
        "不验证单价×数量=行合计",
        "不检查正文中提及的金额与报价表一致性",
        "仅检查首个匹配表格",
    ]

    if body is None:
        return {
            "name": "amount_consistency",
            "status": "skip",
            "scope": "N/A — 无文档主体",
            "uncovered": _UNCOVERED,
            "findings": ["No document body"],
        }

    tables = body.findall(w("tbl"))
    table_matched = False

    def _extract_number(text: str) -> float | None:
        text = (text or "").strip().replace(",", "").replace("，", "")
        m = re.search(r"[\d]+\.?\d*", text)
        if m:
            try:
                return float(m.group())
            except ValueError:
                return None
        return None

    # Look for itemized bid table (开标分项一览表) and check sum
    for tbl in tables:
        trs = list(tbl.findall(w("tr")))
        if len(trs) < 2:
            continue

        header_cells = []
        for tc in trs[0].findall(w("tc")):
            header_cells.append(_norm_text(_cell_text(tc)))

        # Detect itemized table by header pattern
        if not (len(header_cells) >= 7 and "总价" in "".join(header_cells)):
            continue

        table_matched = True

        # Find the column index for 总价 (total price per item)
        total_col = None
        for i, h in enumerate(header_cells):
            if "总价" in h and "投标" not in h:
                total_col = i
                break
        if total_col is None:
            # fallback: last column often is total
            total_col = len(header_cells) - 1

        item_totals: list[float] = []
        for tr in trs[1:]:
            cells = [_cell_text(tc).strip() for tc in tr.findall(w("tc"))]
            if total_col < len(cells):
                val = _extract_number(cells[total_col])
                if val is not None and val > 0:
                    item_totals.append(val)

        if item_totals:
            computed_sum = sum(item_totals)
            # Try to find grand total in the document
            grand_total_pattern = re.compile(r"投标总价[：:]\s*([\d,.，]+)")
            m = grand_total_pattern.search(full_text)
            if m:
                grand_total = _extract_number(m.group(1))
                if grand_total is not None and abs(computed_sum - grand_total) > 0.01:
                    findings.append(
                        f"Item totals sum ({computed_sum:.2f}) != grand total ({grand_total:.2f})"
                    )

    # Budget cap check
    if facts:
        budget_str = (
            facts.get("budget", {}).get("value")
            if isinstance(facts.get("budget"), dict)
            else facts.get("budget")
        )
        if budget_str:
            budget = _extract_number(str(budget_str))
            if budget is not None:
                # Look for bid total in text
                total_pattern = re.compile(r"投标总价[：:]\s*([\d,.，]+)")
                m = total_pattern.search(full_text)
                if m:
                    bid_total = _extract_number(m.group(1))
                    if bid_total is not None and bid_total > budget:
                        findings.append(
                            f"Bid total ({bid_total:.2f}) exceeds budget ({budget:.2f})"
                        )

    if not table_matched:
        scope = "未找到匹配格式的报价表（需 ≥7 列且含「总价」表头），仅做了预算上限检查（如有 facts.json）"
    else:
        scope = "匹配到分项报价表，验证了分项合计=总价、预算上限"

    if not table_matched and not findings:
        return {
            "name": "amount_consistency",
            "status": "not_applicable",
            "scope": scope,
            "uncovered": _UNCOVERED + ["未找到匹配格式的报价表，LLM 必须手动检查金额一致性"],
            "findings": ["未找到匹配格式的分项报价表（表头需 ≥7 列且含「总价」），跳过分项合计校验"],
        }

    return {
        "name": "amount_consistency",
        "status": "fail" if findings else "pass",
        "scope": scope,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


def check_date_presence(
    body: Any, full_text: str, facts: dict[str, Any] | None
) -> dict[str, Any]:
    """Check whether dates from facts.json appear in document text."""
    findings: list[str] = []

    _SCOPE = (
        "检查 facts.json 中的截止日期/交货期/保修期是否出现在全文中；"
        "检查截止日期是否已过期"
    )
    _UNCOVERED = [
        "不做文档内部日期交叉比对（如保修期在多处的一致性）",
        "不对照招标文件校验日期",
        "仅检查 facts.json 中有的日期",
    ]

    if not facts:
        return {
            "name": "date_presence",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No facts.json provided — skipping date checks"],
        }

    full_text_norm = _norm_text(full_text)

    # Check deadline
    deadline = None
    if isinstance(facts.get("deadline"), dict):
        deadline = facts["deadline"].get("value")
    elif isinstance(facts.get("deadline"), str):
        deadline = facts["deadline"]

    if deadline:
        date_part = _norm_text(deadline)
        if date_part and date_part not in full_text_norm:
            findings.append(f"Deadline '{deadline}' not found in document")

        # Check if deadline is in the past
        m = re.search(
            r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", deadline
        )
        if m:
            from datetime import date as Date

            try:
                d = Date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                from datetime import datetime

                if d < datetime.now().date():
                    findings.append(f"Deadline appears to be in the past: {deadline}")
            except (ValueError, OverflowError):
                pass

    # Check delivery period
    delivery = None
    if isinstance(facts.get("delivery"), dict):
        delivery = facts["delivery"].get("value")
    elif isinstance(facts.get("delivery"), str):
        delivery = facts["delivery"]

    if delivery:
        if _norm_text(delivery) not in full_text_norm:
            findings.append(f"Delivery period '{delivery}' not found in document")

    # Check warranty period
    warranty = facts.get("warranty") or facts.get("validity")
    if isinstance(warranty, dict):
        warranty = warranty.get("value")
    if warranty and isinstance(warranty, str):
        if _norm_text(warranty) not in full_text_norm:
            findings.append(f"Warranty/validity period '{warranty}' not found in document")

    return {
        "name": "date_presence",
        "status": "fail" if findings else "pass",
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


def check_star_coverage(
    body: Any, full_text: str, requirements_path: Path | None
) -> dict[str, Any]:
    """
    Filter priority=star items from requirements.csv,
    verify each has corresponding content in the document with no negative deviation.
    """
    findings: list[str] = []

    _SCOPE = (
        "读取 requirements.csv 中 priority=star 的条目，"
        "检查 deviation 字段无负偏离、status 字段非 pending/blocked"
    )
    _UNCOVERED = [
        "不验证 docx 中是否有对应的实质性响应内容",
        "仅读 CSV 元数据，若 agent 标了 done 但 docx 内容为空则本检查仍 pass",
        "不检查响应位置是否非空",
    ]

    if requirements_path is None or not requirements_path.exists():
        return {
            "name": "star_coverage",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No requirements.csv provided — skipping star coverage check"],
        }

    def _row_get(row: dict[str, Any], *keys: str) -> str:
        lower_keys = {
            str(k).strip().lower(): str(v)
            for k, v in row.items()
            if k is not None and v is not None
        }
        for key in keys:
            direct = row.get(key)
            if isinstance(direct, str) and direct.strip():
                return direct
            lowered = lower_keys.get(key.strip().lower())
            if lowered and lowered.strip():
                return lowered
        return ""

    star_items: list[dict[str, str]] = []
    try:
        with open(requirements_path, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                priority_raw = _row_get(row, "priority", "优先级", "标记").strip()
                priority_norm = priority_raw.lower()
                is_star = (
                    "★" in priority_raw
                    or priority_norm in ("star", "*", "星标")
                    or "star" in priority_norm
                )
                if is_star:
                    star_items.append(row)
    except Exception as e:
        return {
            "name": "star_coverage",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": [f"Failed to parse requirements.csv: {e}"],
        }

    if not star_items:
        return {
            "name": "star_coverage",
            "status": "pass",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No star (★) items found in requirements.csv"],
        }

    for item in star_items:
        req_id = _row_get(item, "id", "序号", "需求ID").strip() or "unknown"
        title = _row_get(item, "title", "标题", "requirement", "招标要求").strip()
        status_raw = _row_get(item, "status", "状态", "响应状态").strip()
        status = status_raw.lower()
        deviation_raw = _row_get(item, "deviation", "偏离", "偏离情况").strip()
        deviation = deviation_raw.lower()

        # Check if there's a negative deviation recorded
        if "负偏离" in deviation_raw or "negative" in deviation:
            findings.append(
                f"★ item {req_id} ('{title}') has negative deviation — DISQUALIFICATION RISK"
            )

        # Check if still pending (not yet addressed)
        if status in ("pending", "blocked", "todo", "tbd") or status_raw in ("待处理", "未处理", "未开始", "阻塞"):
            findings.append(
                f"★ item {req_id} ('{title}') status is '{status_raw or status}' — not yet addressed"
            )

    return {
        "name": "star_coverage",
        "status": "fail" if findings else "pass",
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


def check_placeholder_residue(body: Any, full_text: str) -> dict[str, Any]:
    """Search for <<TBD: ...>> residual placeholders and highlight markers."""
    findings: list[str] = []

    _SCOPE = "搜索 <<TBD:...>> 占位符、中文占位词（待定/待确认/未填写/未填）、红色高亮文本"
    _UNCOVERED = ["不检测语义占位（如'详见附件'但附件不存在）"]

    # TBD placeholders
    tbd_matches = re.findall(r"<<\s*TBD\s*:\s*([^>]*)>>", full_text, flags=re.IGNORECASE)
    if tbd_matches:
        findings.append(f"Found {len(tbd_matches)} unresolved <<TBD>> placeholder(s)")
        for m in tbd_matches[:5]:  # Show first 5
            findings.append(f"  - <<TBD: {m.strip()}>>")
        if len(tbd_matches) > 5:
            findings.append(f"  ... and {len(tbd_matches) - 5} more")

    # Chinese placeholder patterns
    placeholder_patterns = ["待定", "待确认", "未填写", "未填"]
    for pattern in placeholder_patterns:
        count = full_text.count(pattern)
        if count > 0:
            findings.append(f"Found '{pattern}' x{count} in document")

    # Highlighted text (red = likely unfilled fields)
    if body is not None:
        highlight_counts: dict[str, int] = {}
        for hl in body.iter(w("highlight")):
            val = hl.get(w("val")) or hl.get("w:val") or ""
            val = (val or "").strip().lower()
            if val and val not in ("none", "auto"):
                highlight_counts[val] = highlight_counts.get(val, 0) + 1
        if "red" in highlight_counts:
            findings.append(
                f"Found {highlight_counts['red']} red-highlighted text segments (likely unfilled fields)"
            )

    return {
        "name": "placeholder_residue",
        "status": "fail" if findings else "pass",
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


def check_headers_footers(
    unpacked_dir: Path, facts: dict[str, Any] | None
) -> dict[str, Any]:
    """Parse XML header/footer files, verify company name and project name."""
    findings: list[str] = []

    _SCOPE = "解析 header*.xml 和 footer*.xml，检查含内容的页眉页脚中是否有公司名和项目名"
    _UNCOVERED = ["不检查密级标识", "不检查页码和文档版本"]

    if not facts:
        return {
            "name": "headers_footers",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No facts.json provided — skipping header/footer checks"],
        }

    company_name = facts.get("companyName") or facts.get("company_name")
    project_name = facts.get("projectName") or facts.get("project_name")

    # Find all header/footer XML files
    word_dir = unpacked_dir / "word"
    if not word_dir.exists():
        return {
            "name": "headers_footers",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No word/ directory"],
        }

    hf_files = list(word_dir.glob("header*.xml")) + list(word_dir.glob("footer*.xml"))
    if not hf_files:
        return {
            "name": "headers_footers",
            "status": "pass",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No header/footer files found"],
        }

    for hf_path in hf_files:
        try:
            root = ET.parse(str(hf_path)).getroot()
            text = _cell_text(root)
            text_norm = _norm_text(text)

            if company_name and text.strip():
                if _norm_text(company_name) not in text_norm:
                    # Only flag if the header/footer has content but wrong company
                    if len(text.strip()) > 2:
                        findings.append(
                            f"{hf_path.name}: contains text but company name '{company_name}' not found"
                        )

            if project_name and text.strip():
                if _norm_text(project_name) not in text_norm:
                    if len(text.strip()) > 2:
                        findings.append(
                            f"{hf_path.name}: contains text but project name '{project_name}' not found"
                        )
        except Exception:
            findings.append(f"{hf_path.name}: failed to parse XML")

    return {
        "name": "headers_footers",
        "status": "fail" if findings else "pass",
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------


def run_all_checks(
    unpacked_dir: Path,
    facts_path: Path | None,
    requirements_path: Path | None,
) -> list[dict[str, Any]]:
    """Run all deterministic checks and return results."""

    # Load facts
    facts: dict[str, Any] | None = None
    if facts_path and facts_path.exists():
        try:
            raw = json.loads(facts_path.read_text("utf-8"))
            # Support both { "facts": { ... } } and flat { ... } formats
            if isinstance(raw, dict) and "facts" in raw:
                facts_inner = raw["facts"]
                if isinstance(facts_inner, dict):
                    # Flatten nested { key: { value: "..." } } to { key: "..." }
                    flat: dict[str, Any] = {}
                    for k, v in facts_inner.items():
                        if isinstance(v, dict) and "value" in v:
                            flat[k] = v
                        else:
                            flat[k] = v
                    facts = flat
                else:
                    facts = raw
            else:
                facts = raw
        except Exception:
            facts = None

    # Parse document
    root = _parse_document_xml(unpacked_dir)
    body = _get_body(root)
    full_text = _get_full_text(body)

    results: list[dict[str, Any]] = []

    results.append(check_entity_presence(body, full_text, facts))
    results.append(check_amount_consistency(body, full_text, facts))
    results.append(check_date_presence(body, full_text, facts))
    results.append(check_star_coverage(body, full_text, requirements_path))
    results.append(check_placeholder_residue(body, full_text))
    results.append(check_headers_footers(unpacked_dir, facts))

    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic pre-screen checks for bid documents (Step 2a)"
    )
    parser.add_argument(
        "--unpacked",
        required=True,
        help="Path to unpacked OOXML directory (containing word/document.xml)",
    )
    parser.add_argument("--facts", help="Path to facts.json")
    parser.add_argument("--requirements", help="Path to requirements.csv")
    parser.add_argument(
        "--output",
        help="Output path for JSON report (default: stdout)",
    )
    args = parser.parse_args()

    unpacked_dir = Path(args.unpacked)
    if not unpacked_dir.is_dir():
        print(f"Error: --unpacked must be a directory: {unpacked_dir}", file=sys.stderr)
        return 1

    facts_path = Path(args.facts) if args.facts else None
    requirements_path = Path(args.requirements) if args.requirements else None

    results = run_all_checks(unpacked_dir, facts_path, requirements_path)

    report = {
        "meta": {
            "description": (
                "确定性预检结果。每个 check 包含 scope（实际检查了什么）和 "
                "uncovered（需要 LLM 补充的部分）。pass 仅代表 scope 范围内通过。"
            ),
            "statuses": {
                "pass": "scope 范围内通过，uncovered 部分仍需 LLM 检查",
                "fail": "scope 范围内发现问题",
                "skip": "缺少输入（如无 facts.json），未执行",
                "not_applicable": "脚本无法匹配文档结构，LLM 必须手动检查该维度",
            },
        },
        "checks": results,
    }

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Report written to {output_path}")
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))

    # Exit code: 1 if any check failed
    has_failure = any(c["status"] == "fail" for c in results)
    return 1 if has_failure else 0


if __name__ == "__main__":
    raise SystemExit(main())
