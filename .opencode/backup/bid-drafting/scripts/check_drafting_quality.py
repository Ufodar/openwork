#!/usr/bin/env python3
"""
Deterministic **quality gate** checks for the bid-drafting stage.

Validates requirements.csv response quality using hard rules that produce
the same output for the same input, independent of LLM judgment. Designed
to be called from the bid-drafting skill after a drafting pass to catch
low-effort, incomplete, or degrading responses before the document is
assembled.

IMPORTANT: Each check's ``pass`` status only means the check passed within
its declared ``scope``. The ``uncovered`` list in each result specifies what
the check does NOT verify --- those aspects require LLM follow-up.

Usage:
    python check_drafting_quality.py \
        --requirements requirements.csv \
        --conventions conventions.md \
        --output reports/drafting-quality.json

    # Run only quality_trend check:
    python check_drafting_quality.py \
        --requirements requirements.csv \
        --trend-only \
        --output reports/drafting-quality.json
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
    import defusedxml.ElementTree as ET  # type: ignore  # noqa: F401
except ModuleNotFoundError:
    import xml.etree.ElementTree as ET  # type: ignore  # noqa: F401


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row_get(row: dict[str, Any], *keys: str) -> str:
    """Flexible column-name lookup: tries exact key, then case-insensitive."""
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


def _is_done(row: dict[str, Any]) -> bool:
    """Return True if the row's status indicates completion."""
    status_raw = _row_get(row, "status", "状态", "响应状态").strip().lower()
    return status_raw in ("done", "完成", "已完成", "已响应")


def _is_star(row: dict[str, Any]) -> bool:
    """Return True if the row's priority indicates star/key item."""
    priority_raw = _row_get(row, "priority", "优先级", "标记").strip()
    priority_norm = priority_raw.lower()
    return (
        "★" in priority_raw
        or priority_norm in ("star", "*", "星标")
        or "star" in priority_norm
    )


def _response_text(row: dict[str, Any]) -> str:
    """Extract response content from a row."""
    return _row_get(row, "响应内容", "response", "应答", "响应", "回复内容").strip()


def _load_requirements(requirements_path: Path) -> list[dict[str, Any]]:
    """Load requirements.csv and return list of row dicts."""
    with open(requirements_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader)


# ---------------------------------------------------------------------------
# Check modules --- each returns { name, status, scope, uncovered, findings }
# status: pass | fail | skip | not_applicable
# ---------------------------------------------------------------------------


def check_response_length(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Check that all done rows have a response with >= 20 characters."""
    findings: list[str] = []

    _SCOPE = (
        "检查 requirements.csv 中 status=done 的行，"
        "其响应内容列的字符数是否 >= 20"
    )
    _UNCOVERED = [
        "不检查响应内容的语义质量或相关性",
        "不检查是否只是复述了招标要求",
        "不检查中英文混排比例",
    ]

    done_rows = [r for r in rows if _is_done(r)]
    if not done_rows:
        return {
            "name": "response_length",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No done rows found in requirements.csv"],
        }

    for row in done_rows:
        req_id = _row_get(row, "id", "序号", "需求ID").strip() or "unknown"
        title = _row_get(row, "title", "标题", "requirement", "招标要求", "条款内容", "需求内容").strip()
        response = _response_text(row)

        if len(response) < 20:
            findings.append(
                f"Row {req_id} ('{title[:30]}') response is only {len(response)} chars (min 20)"
            )

    return {
        "name": "response_length",
        "status": "fail" if findings else "pass",
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


def check_bare_satisfy(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Detect bare 'satisfy' / 'comply' responses that add no substance."""
    findings: list[str] = []

    _SCOPE = (
        "正则检测 done 行中独立的「满足」「符合」「响应」等作为完整应答的空洞回复"
    )
    _UNCOVERED = [
        "不检测语义等价的变体（如'我方完全满足该要求'）",
        "不检查回复是否与招标要求相关",
        "仅检测完全匹配模式，稍有变化即跳过",
    ]

    # Pattern: optionally quoted, optional 完全, then exactly a 2-char term, then
    # optional trailing punctuation / whitespace
    bare_pattern = re.compile(
        r'^[\s「"\']*(?:完全)?(?:满足|符合|响应)[\s」"\'.。，,]*$'
    )

    done_rows = [r for r in rows if _is_done(r)]
    if not done_rows:
        return {
            "name": "bare_satisfy",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No done rows found in requirements.csv"],
        }

    for row in done_rows:
        req_id = _row_get(row, "id", "序号", "需求ID").strip() or "unknown"
        title = _row_get(row, "title", "标题", "requirement", "招标要求", "条款内容", "需求内容").strip()
        response = _response_text(row)

        if response and bare_pattern.match(response):
            findings.append(
                f"Row {req_id} ('{title[:30]}') response is bare satisfy: '{response}'"
            )

    return {
        "name": "bare_satisfy",
        "status": "fail" if findings else "pass",
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


def check_star_substance(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """
    For star/priority items that are done, verify response has substance
    (>= 50 chars) and no negative deviation.
    """
    findings: list[str] = []

    _SCOPE = (
        "检查 priority=star 且 status=done 的行："
        "响应内容 >= 50 字符、deviation 不含负偏离"
    )
    _UNCOVERED = [
        "不验证响应内容的技术准确性",
        "不检查是否充分覆盖招标要求的所有子项",
        "不检查响应是否与需求相关",
    ]

    star_done_rows = [r for r in rows if _is_star(r) and _is_done(r)]
    if not star_done_rows:
        all_star = [r for r in rows if _is_star(r)]
        if not all_star:
            return {
                "name": "star_substance",
                "status": "pass",
                "scope": _SCOPE,
                "uncovered": _UNCOVERED,
                "findings": ["No star items found in requirements.csv"],
            }
        return {
            "name": "star_substance",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": [
                f"Found {len(all_star)} star items but none are done yet"
            ],
        }

    for row in star_done_rows:
        req_id = _row_get(row, "id", "序号", "需求ID").strip() or "unknown"
        title = _row_get(row, "title", "标题", "requirement", "招标要求", "条款内容", "需求内容").strip()
        response = _response_text(row)
        deviation_raw = _row_get(row, "deviation", "偏离", "偏离情况").strip()

        if len(response) < 50:
            findings.append(
                f"★ Row {req_id} ('{title[:30]}') response is only "
                f"{len(response)} chars (min 50 for star items)"
            )

        if "负偏离" in deviation_raw or "negative" in deviation_raw.lower():
            findings.append(
                f"★ Row {req_id} ('{title[:30]}') has negative deviation: "
                f"'{deviation_raw}' --- DISQUALIFICATION RISK"
            )

    return {
        "name": "star_substance",
        "status": "fail" if findings else "pass",
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


def check_tbd_unresolved(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Check done rows for residual <<TBD or <<待 placeholders."""
    findings: list[str] = []

    _SCOPE = "检查 done 行的响应内容中是否有 <<TBD 或 <<待 残留占位符"
    _UNCOVERED = [
        "不检查文档（docx）正文中的占位符",
        "不检查语义占位（如'详见附件'但附件不存在）",
    ]

    tbd_pattern = re.compile(r"<<\s*(?:TBD|待)", re.IGNORECASE)

    done_rows = [r for r in rows if _is_done(r)]
    if not done_rows:
        return {
            "name": "tbd_unresolved",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["No done rows found in requirements.csv"],
        }

    for row in done_rows:
        req_id = _row_get(row, "id", "序号", "需求ID").strip() or "unknown"
        title = _row_get(row, "title", "标题", "requirement", "招标要求", "条款内容", "需求内容").strip()
        response = _response_text(row)

        matches = tbd_pattern.findall(response)
        if matches:
            findings.append(
                f"Row {req_id} ('{title[:30]}') contains {len(matches)} "
                f"unresolved placeholder(s): {matches[0]}..."
            )

    return {
        "name": "tbd_unresolved",
        "status": "fail" if findings else "pass",
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
    }


def check_quality_trend(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Sliding-window analysis of response lengths for done rows.
    Detects quality degradation over the course of drafting.
    """
    findings: list[str] = []

    _SCOPE = (
        "按行顺序对 done 行分窗口(5)统计平均响应长度，"
        "检测最后窗口相比第一个窗口是否下降超过 30%"
    )
    _UNCOVERED = [
        "不检查内容质量，仅以长度作为代理指标",
        "不区分不同类型的需求（技术/商务/资质）的合理长度差异",
    ]

    WINDOW_SIZE = 5
    MIN_DONE_ROWS = 8

    done_rows = [r for r in rows if _is_done(r)]

    if len(done_rows) < MIN_DONE_ROWS:
        return {
            "name": "quality_trend",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": [
                f"Only {len(done_rows)} done rows (need >= {MIN_DONE_ROWS} for trend analysis)"
            ],
        }

    # Compute response lengths in row order
    lengths = [len(_response_text(r)) for r in done_rows]

    # Build sliding windows
    windows: list[float] = []
    for i in range(0, len(lengths) - WINDOW_SIZE + 1):
        window_slice = lengths[i : i + WINDOW_SIZE]
        windows.append(sum(window_slice) / len(window_slice))

    if len(windows) < 2:
        return {
            "name": "quality_trend",
            "status": "skip",
            "scope": _SCOPE,
            "uncovered": _UNCOVERED,
            "findings": ["Not enough windows for trend comparison"],
        }

    first_avg = windows[0]
    last_avg = windows[-1]

    # Avoid division by zero
    if first_avg == 0:
        decline_pct = 0.0
    else:
        decline_pct = (first_avg - last_avg) / first_avg * 100

    metrics = {
        "total_done_rows": len(done_rows),
        "window_size": WINDOW_SIZE,
        "num_windows": len(windows),
        "first_window_avg_len": round(first_avg, 1),
        "last_window_avg_len": round(last_avg, 1),
        "decline_percent": round(decline_pct, 1),
        "window_averages": [round(w, 1) for w in windows],
    }

    status = "pass"
    if decline_pct > 30:
        status = "fail"
        findings.append(
            f"Quality decline detected: first window avg {first_avg:.0f} chars -> "
            f"last window avg {last_avg:.0f} chars ({decline_pct:.1f}% decline, threshold 30%)"
        )

    return {
        "name": "quality_trend",
        "status": status,
        "scope": _SCOPE,
        "uncovered": _UNCOVERED,
        "findings": findings,
        "metrics": metrics,
    }


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------


def run_all_checks(
    rows: list[dict[str, Any]],
    trend_only: bool = False,
) -> list[dict[str, Any]]:
    """Run all drafting quality checks and return results."""
    results: list[dict[str, Any]] = []

    if trend_only:
        results.append(check_quality_trend(rows))
    else:
        results.append(check_response_length(rows))
        results.append(check_bare_satisfy(rows))
        results.append(check_star_substance(rows))
        results.append(check_tbd_unresolved(rows))
        results.append(check_quality_trend(rows))

    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic quality gate checks for bid-drafting stage"
    )
    parser.add_argument(
        "--requirements",
        required=True,
        help="Path to requirements.csv",
    )
    parser.add_argument(
        "--conventions",
        help="Path to conventions.md (reserved for decision_propagation checks)",
    )
    parser.add_argument(
        "--trend-only",
        action="store_true",
        help="Only run quality_trend check",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output path for JSON report",
    )
    args = parser.parse_args()

    requirements_path = Path(args.requirements)
    if not requirements_path.exists():
        print(
            f"Error: requirements.csv not found: {requirements_path}",
            file=sys.stderr,
        )
        return 1

    # Load requirements
    try:
        rows = _load_requirements(requirements_path)
    except Exception as e:
        print(f"Error: failed to parse requirements.csv: {e}", file=sys.stderr)
        return 1

    results = run_all_checks(rows, trend_only=args.trend_only)

    # Build summary
    total = len(results)
    pass_count = sum(1 for r in results if r["status"] == "pass")
    fail_count = sum(1 for r in results if r["status"] == "fail")
    skip_count = sum(1 for r in results if r["status"] == "skip")

    report = {
        "meta": {
            "description": (
                "撰写阶段确定性质量门控结果。每个 check 包含 scope（实际检查了什么）"
                "和 uncovered（需要 LLM 补充的部分）。pass 仅代表 scope 范围内通过。"
            ),
            "statuses": {
                "pass": "scope 范围内通过，uncovered 部分仍需 LLM 检查",
                "fail": "scope 范围内发现问题",
                "skip": "条件不满足（如无 done 行），未执行",
                "not_applicable": "脚本无法匹配数据结构，LLM 必须手动检查该维度",
            },
        },
        "summary": {
            "total": total,
            "pass": pass_count,
            "fail": fail_count,
            "skip": skip_count,
        },
        "results": results,
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Report written to {output_path}")

    # Summary line
    print(f"Summary: {pass_count} pass, {fail_count} fail, {skip_count} skip / {total} total")

    # Exit code: 1 if any check failed
    return 1 if fail_count > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
