#!/usr/bin/env python3
"""
QC (quality check) for the bid MVP DOCX output.

Goal: catch obvious "this is not a professional bid yet" issues with deterministic checks:
- missing core forms/tables
- empty critical cells in key tables
- leftover placeholders like <<TBD: ...>>

This is NOT a full compliance audit against tender requirements. It's an MVP gate.
"""

from __future__ import annotations

import argparse
import re
import zipfile
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal

try:
    import defusedxml.ElementTree as DET  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    # `defusedxml` is optional in many environments. Fall back to stdlib so the
    # script runs out-of-the-box; install `defusedxml` for hardened XML parsing.
    import xml.etree.ElementTree as DET  # type: ignore

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def _cell_text(node) -> str:
    parts: list[str] = []
    for t in node.iter(w("t")):
        if t.text:
            parts.append(t.text)
    return "".join(parts)


def _norm_header(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").strip())


def _row_texts(tr) -> list[str]:
    out: list[str] = []
    for tc in tr.findall(w("tc")):
        out.append((_cell_text(tc) or "").strip())
    return out


@dataclass
class TableStats:
    name: str
    rows: int
    empty_counts: dict[str, int]


def _norm_text(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").strip())

_PLACEHOLDER_EXACT = {
    "详见报价文件",
    "详见开标分项一览表",
    "详见技术应答表",
    "详见投标文件",
    "见报价文件",
    "见投标文件",
    "见技术应答表",
    "待定",
    "待确认",
    "未填写",
    "未填",
    "-",
    "—",
    "——",
    "--",
}


def _is_placeholder(value: str) -> bool:
    v = (value or "").strip()
    if not v:
        return True
    if re.search(r"<<\s*TBD\s*:", v, flags=re.IGNORECASE):
        return True
    if v in _PLACEHOLDER_EXACT:
        return True
    # Treat short "see ..." directives as placeholders, but allow longer
    # explanatory content that happens to contain cross-references.
    if (v.startswith("详见") or v.startswith("见")) and len(v) <= 32:
        return True
    if re.fullmatch(r"[-—_]+", v):
        return True
    return False


def _has_digits(value: str) -> bool:
    return bool(re.search(r"\d", (value or "")))


def _collect_highlights(node) -> dict[str, int]:
    counts: dict[str, int] = {}
    for hl in node.iter(w("highlight")):
        val = hl.get(w("val")) or hl.get("w:val") or ""
        val = (val or "").strip().lower()
        if not val or val in {"none", "auto"}:
            continue
        counts[val] = counts.get(val, 0) + 1
    return counts


def _is_page_break_para(p) -> bool:
    if getattr(p, "tag", None) != w("p"):
        return False
    has_page_break = False
    for br in p.iter(w("br")):
        btype = br.get(w("type")) or br.get("w:type") or ""
        if (btype or "").strip() == "page":
            has_page_break = True
            break
    if not has_page_break:
        return False
    # Only treat *empty* page-break paragraphs as structural breaks. A paragraph
    # that happens to contain a page break + visible text is not necessarily a
    # blank page indicator.
    return not (_cell_text(p) or "").strip()


def _extract_fact_values(payload: object) -> dict[str, str]:
    if not isinstance(payload, dict):
        return {}
    facts = payload.get("facts")
    if not isinstance(facts, dict):
        return {}
    out: dict[str, str] = {}
    for key in [
        "projectName",
        "projectCode",
        "budget",
        "agency",
        "deadline",
        "openPlace",
        "delivery",
        "validity",
        "bidBond",
        "performanceBond",
        "payment",
    ]:
        entry = facts.get(key)
        if not isinstance(entry, dict):
            continue
        value = entry.get("value")
        if isinstance(value, str) and value.strip():
            out[key] = value.strip()
    return out


QcMode = Literal["draft", "submit"]


def qc_docx(
    docx_path: Path, facts_payload: object | None, mode: QcMode = "draft"
) -> tuple[list[str], list[str], list[TableStats], list[str]]:
    failures: list[str] = []
    warnings: list[str] = []
    stats: list[TableStats] = []
    facts_lines: list[str] = []
    strict = mode == "submit"

    with zipfile.ZipFile(docx_path) as zf:
        xml = zf.read("word/document.xml")
    root = DET.fromstring(xml)
    body = root.find(w("body"))
    if body is None:
        return (["Missing w:body"], [], [], [])

    full_text = _cell_text(body)
    full_text_norm = _norm_text(full_text)
    if re.search(r"<<\s*TBD\s*:", full_text, flags=re.IGNORECASE):
        failures.append("Found unresolved placeholders like <<TBD: ...>>")
    if "详见报价文件" in full_text:
        msg = "Found placeholder text '详见报价文件' in target doc"
        (failures if strict else warnings).append(msg)

    highlight_counts = _collect_highlights(body)
    if highlight_counts:
        counts_str = ", ".join([f"{k}:{v}" for k, v in sorted(highlight_counts.items())])
        # In bid templates, highlight (especially red) almost always means "needs manual fill".
        if "red" in highlight_counts:
            msg = f"Found highlighted text (likely unfilled fields): {counts_str}"
            (failures if strict else warnings).append(msg)
        else:
            warnings.append(f"Found highlighted text: {counts_str}")

    fact_values = _extract_fact_values(facts_payload)
    if fact_values:
        facts_lines.append("## FACTS CHECK")
        facts_lines.append("")
        facts_lines.append(f"- facts loaded: `{len(fact_values)}` fields")
        facts_lines.append("")

        def require_contains(label: str, value: str) -> None:
            needle = _norm_text(value)
            ok = bool(needle) and needle in full_text_norm
            facts_lines.append(f"- {label}: {'OK' if ok else 'NOT FOUND'}")
            if not ok:
                failures.append(f"Facts mismatch: {label} not found in target doc")

        def warn_contains(label: str, value: str) -> None:
            needle = _norm_text(value)
            ok = bool(needle) and needle in full_text_norm
            facts_lines.append(f"- {label}: {'OK' if ok else 'NOT FOUND'}")
            if not ok:
                warnings.append(f"Facts mismatch (warning): {label} not found in target doc")

        if "projectName" in fact_values:
            require_contains("项目名称", fact_values["projectName"])
        else:
            facts_lines.append("- 项目名称: MISSING (facts.json)")
            warnings.append("Facts missing: 项目名称 (facts.json)")

        if "projectCode" in fact_values:
            require_contains("项目编号", fact_values["projectCode"])
        else:
            facts_lines.append("- 项目编号: MISSING (facts.json)")
            warnings.append("Facts missing: 项目编号 (facts.json)")

        if "deadline" in fact_values:
            deadline = fact_values["deadline"]
            # Prefer checking date portion to avoid formatting differences.
            m = re.search(r"(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)", deadline)
            if m:
                date_part = _norm_text(m.group(1))
                ok = date_part in full_text_norm
                facts_lines.append(f"- 投标截止/开标时间(日期): {'OK' if ok else 'NOT FOUND'}")
                if not ok:
                    failures.append("Facts mismatch: 投标截止/开标时间 (date) not found in target doc")

                # Best-effort stale check.
                m2 = re.search(r"(?P<y>\d{4})\s*年\s*(?P<m>\d{1,2})\s*月\s*(?P<d>\d{1,2})\s*日", deadline)
                if m2:
                    try:
                        y = int(m2.group("y"))
                        mo = int(m2.group("m"))
                        da = int(m2.group("d"))
                        parsed_date = date(y, mo, da)
                        if parsed_date < datetime.now().date():
                            warnings.append(f"Deadline appears to be in the past: {deadline}")
                    except Exception:
                        pass
            else:
                warn_contains("投标截止/开标时间", deadline)
        else:
            facts_lines.append("- 投标截止/开标时间: MISSING (facts.json)")
            warnings.append("Facts missing: 投标截止/开标时间 (facts.json)")

        # Remaining fields are useful but less strict for MVP.
        if "budget" in fact_values:
            warn_contains("预算金额", fact_values["budget"])
        if "agency" in fact_values:
            warn_contains("采购代理机构", fact_values["agency"])
        if "openPlace" in fact_values:
            warn_contains("开标地点", fact_values["openPlace"])
        if "delivery" in fact_values:
            warn_contains("交货期/工期", fact_values["delivery"])
        if "validity" in fact_values:
            warn_contains("投标有效期", fact_values["validity"])
        if "bidBond" in fact_values:
            warn_contains("投标保证金", fact_values["bidBond"])
        if "performanceBond" in fact_values:
            warn_contains("履约保证金", fact_values["performanceBond"])
        if "payment" in fact_values:
            warn_contains("付款方式", fact_values["payment"])

        facts_lines.append("")

    # Basic heading duplication check (heuristic; may false-positive if TOC exists).
    form_headings = ["开标一览表", "开标分项一览表", "投标产品点对点应答表", "投标产品配置清单", "售后服务承诺"]
    for key in form_headings:
        # Count paragraph-level occurrences to avoid false positives (e.g. notes that mention a form name).
        para_count = 0
        for p in body.findall(w("p")):
            txt = (_cell_text(p) or "").strip()
            if txt == key:
                para_count += 1
        if para_count > 1:
            failures.append(f"Heading '{key}' appears {para_count} times (duplication).")

    # Blank-page / pagination sanity checks.
    #
    # We can't do true layout pagination deterministically from raw OOXML, but
    # there are some strong signals we can catch:
    # - consecutive page breaks (usually an empty page)
    # - a form heading immediately followed by an empty page-break paragraph
    #   (heading/content split; looks unprofessional and confuses reviewers)
    children = list(body)
    for i, child in enumerate(children):
        if not _is_page_break_para(child):
            continue
        prev = children[i - 1] if i - 1 >= 0 else None
        nxt = children[i + 1] if i + 1 < len(children) else None

        if prev is not None and _is_page_break_para(prev):
            msg = "Found consecutive page breaks (possible blank page)."
            (failures if strict else warnings).append(msg)
            continue

        if nxt is not None and _is_page_break_para(nxt):
            msg = "Found consecutive page breaks (possible blank page)."
            (failures if strict else warnings).append(msg)
            continue

        if prev is not None and getattr(prev, "tag", None) == w("p"):
            prev_text = (_cell_text(prev) or "").strip()
            if prev_text in form_headings:
                msg = f"Form heading '{prev_text}' is immediately followed by a page break (heading/content split)."
                (failures if strict else warnings).append(msg)

        if nxt is not None and getattr(nxt, "tag", None) == w("p"):
            nxt_text = (_cell_text(nxt) or "").strip()
            if nxt_text in form_headings:
                msg = f"Page break directly before form heading '{nxt_text}' (possible blank page)."
                (failures if strict else warnings).append(msg)

    auto_block_title = "项目基本信息（自动提取）"
    auto_block_count = 0
    for p in body.findall(w("p")):
        txt = (_cell_text(p) or "").strip()
        if txt == auto_block_title:
            auto_block_count += 1
    if auto_block_count > 1:
        failures.append(f"Auto-extracted facts block appears {auto_block_count} times (duplication).")

    tables = body.findall(w("tbl"))
    found = {
        "open_bid": False,
        "open_bid_items": False,
        "ptp": False,
        "config": False,
        "service": False,
    }

    def count_empty(rows: list[list[str]], idx: int) -> int:
        n = 0
        for r in rows:
            if idx >= len(r):
                n += 1
                continue
            if not (r[idx] or "").strip():
                n += 1
        return n

    for tbl in tables:
        trs = list(tbl.findall(w("tr")))
        if not trs:
            continue
        header = [_norm_header(c) for c in _row_texts(trs[0])]
        data_rows = [_row_texts(tr) for tr in trs[1:]]

        # 开标一览表（summary）
        if header[:3] == ["序号", "标的名称", "品牌"] and len(header) == 10 and "投标总价" in header:
            found["open_bid"] = True
            # Check first data row critical cells (spec, unit price, total price).
            first = next((r for r in data_rows if len(r) == 10), None)
            if not first:
                failures.append("开标一览表 missing a valid data row.")
                continue
            raw_spec = (first[3] or "").strip()
            empty_spec = 1 if _is_placeholder(raw_spec) else 0
            empty_price = 1 if _is_placeholder(first[5]) else 0
            empty_total = 1 if _is_placeholder(first[7]) else 0

            # 规格型号 in the summary table is sometimes a cross-reference (e.g. "详见开标分项一览表").
            # Treat placeholders as warnings; truly empty remains a failure.
            if not raw_spec:
                failures.append("开标一览表 is missing 规格型号.")
            elif _is_placeholder(raw_spec):
                warnings.append("开标一览表 规格型号 appears to be a placeholder; verify before submission.")
            if empty_price or not _has_digits(first[5]):
                msg = "开标一览表 has placeholder/non-numeric 单价."
                (failures if strict else warnings).append(msg)
            if empty_total or not _has_digits(first[7]):
                msg = "开标一览表 has placeholder/non-numeric 投标总价."
                (failures if strict else warnings).append(msg)
            stats.append(
                TableStats(
                    name="开标一览表",
                    rows=len([r for r in data_rows if any((c or '').strip() for c in r)]),
                    empty_counts={
                        "规格型号": empty_spec,
                        "单价": empty_price,
                        "投标总价": empty_total,
                    },
                )
            )
            continue

        # 开标分项一览表（items）
        if header[:2] == ["项号", "货物名称"] and len(header) == 11 and "采购数量" in header:
            found["open_bid_items"] = True
            # Use only rows with the expected column count.
            rows = [r for r in data_rows if len(r) == 11 and any((c or "").strip() for c in r)]
            if len(rows) < 5:
                failures.append(f"开标分项一览表 row count too small: {len(rows)}")

            empty_spec_rows = 0
            placeholder_spec_rows = 0
            placeholder_price_rows = 0
            placeholder_total_rows = 0
            for r in rows:
                spec = (r[3] or "").strip()
                if not spec:
                    empty_spec_rows += 1
                elif _is_placeholder(spec):
                    placeholder_spec_rows += 1
                if _is_placeholder(r[7]) or not _has_digits(r[7]):
                    placeholder_price_rows += 1
                if _is_placeholder(r[10]) or not _has_digits(r[10]):
                    placeholder_total_rows += 1

            if empty_spec_rows:
                msg = f"开标分项一览表 has empty 规格型号 rows: {empty_spec_rows}"
                (failures if strict else warnings).append(msg)
            if placeholder_spec_rows:
                warnings.append(f"开标分项一览表 has placeholder 规格型号 rows: {placeholder_spec_rows}")
            if placeholder_price_rows:
                msg = f"开标分项一览表 has placeholder/non-numeric 单价 rows: {placeholder_price_rows}"
                (failures if strict else warnings).append(msg)
            if placeholder_total_rows:
                msg = f"开标分项一览表 has placeholder/non-numeric 总价 rows: {placeholder_total_rows}"
                (failures if strict else warnings).append(msg)
            stats.append(
                TableStats(
                    name="开标分项一览表",
                    rows=len(rows),
                    empty_counts={
                        "货物名称": count_empty(rows, 1),
                        "规格型号": count_empty(rows, 3),
                        "单价": count_empty(rows, 7),
                        "采购数量": count_empty(rows, 8),
                        "计量单位": count_empty(rows, 9),
                        "总价": count_empty(rows, 10),
                    },
                )
            )
            continue

        # 点对点应答表
        if header[:3] == ["序号", "招标要求", "投标应答"] and len(header) >= 5:
            found["ptp"] = True
            rows = [r for r in data_rows if len(r) >= 5 and any((c or "").strip() for c in r)]
            if len(rows) < 5:
                failures.append(f"投标产品点对点应答表 row count too small: {len(rows)}")
            placeholder_answers = 0
            placeholder_proof = 0
            for r in rows:
                if _is_placeholder(r[2]):
                    placeholder_answers += 1
                # 证明材料页码（如存在）通常提交前必须补齐；draft 先提示，submit 直接卡住。
                if len(r) >= 5 and _is_placeholder(r[4]):
                    placeholder_proof += 1
            if placeholder_answers:
                msg = f"投标产品点对点应答表 has placeholder/empty 投标应答 rows: {placeholder_answers}"
                (failures if strict else warnings).append(msg)
            if placeholder_proof:
                msg = f"投标产品点对点应答表 证明材料页码 empty/placeholder rows: {placeholder_proof}"
                (failures if strict else warnings).append(msg)
            stats.append(
                TableStats(
                    name="投标产品点对点应答表",
                    rows=len(rows),
                    empty_counts={
                        "序号": count_empty(rows, 0),
                        "招标要求": count_empty(rows, 1),
                        "投标应答": count_empty(rows, 2),
                        "偏离说明": count_empty(rows, 3),
                        "证明材料页码": count_empty(rows, 4) if len(header) >= 5 else 0,
                    },
                )
            )
            continue

        # 配置清单
        if header[:2] == ["序号", "标的名称"] and len(header) == 4 and "详细配置及技术标准" in header:
            found["config"] = True
            rows = [r for r in data_rows if len(r) == 4 and any((c or "").strip() for c in r)]
            if len(rows) < 5:
                failures.append(f"投标产品配置清单 row count too small: {len(rows)}")
            placeholder_details = 0
            for r in rows:
                if _is_placeholder(r[3]):
                    placeholder_details += 1
            if placeholder_details:
                msg = f"投标产品配置清单 has placeholder/empty 详细配置及技术标准 rows: {placeholder_details}"
                (failures if strict else warnings).append(msg)
            stats.append(
                TableStats(
                    name="投标产品配置清单",
                    rows=len(rows),
                    empty_counts={
                        "标的名称": count_empty(rows, 1),
                        "规格型号": count_empty(rows, 2),
                        "详细配置及技术标准": count_empty(rows, 3),
                    },
                )
            )
            continue

        # 售后服务承诺
        if header[:2] == ["序号", "项目"] and len(header) == 3:
            found["service"] = True
            rows = [r for r in data_rows if len(r) == 3 and any((c or "").strip() for c in r)]
            if not rows:
                failures.append("售后服务承诺 table is empty.")
            placeholder_service = 0
            for r in rows:
                if _is_placeholder(r[2]):
                    placeholder_service += 1
            if placeholder_service:
                msg = f"售后服务承诺 has placeholder/empty 承诺内容 rows: {placeholder_service}"
                (failures if strict else warnings).append(msg)
            stats.append(
                TableStats(
                    name="售后服务承诺",
                    rows=len(rows),
                    empty_counts={"承诺内容": count_empty(rows, 2)},
                )
            )
            continue

    for key, ok in found.items():
        if not ok:
            failures.append(f"Missing required table: {key}")

    return (failures, warnings, stats, facts_lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="QC for bid MVP DOCX output")
    parser.add_argument("--docx", required=True, help="DOCX to check")
    parser.add_argument("--facts", help="Optional facts JSON (from Tender facts module)")
    parser.add_argument(
        "--mode",
        choices=["draft", "submit"],
        default="draft",
        help="QC strictness. draft=warnings for incomplete pricing/answers; submit=strict failures (default: draft).",
    )
    args = parser.parse_args()

    docx_path = Path(args.docx)
    if not docx_path.is_file() or docx_path.suffix.lower() != ".docx":
        raise SystemExit(f"--docx must be an existing .docx file: {docx_path}")

    facts_payload: object | None = None
    if args.facts:
        facts_path = Path(args.facts)
        if facts_path.is_file():
            try:
                facts_payload = json.loads(facts_path.read_text("utf-8"))
            except Exception:
                facts_payload = None

    failures, warnings, stats, facts_lines = qc_docx(docx_path, facts_payload, args.mode)

    print(f"# QC report: {docx_path.name}\n")
    print(f"- mode: **{args.mode}**\n")
    if args.mode == "draft":
        print("> Draft mode is meant for iterative work. Switch to submit mode before final export.\n")
    if failures:
        print("## FAILURES")
        for f in failures:
            print(f"- {f}")
        print("")
    if warnings:
        print("## WARNINGS")
        for w in warnings:
            print(f"- {w}")
        print("")
    if facts_lines:
        print("\n".join(facts_lines))
    print("## TABLES")
    for s in stats:
        print(f"- {s.name}: rows={s.rows} empty={s.empty_counts}")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
