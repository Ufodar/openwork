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
from dataclasses import dataclass
from pathlib import Path

import defusedxml.ElementTree as DET

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


def qc_docx(docx_path: Path) -> tuple[list[str], list[str], list[TableStats]]:
    failures: list[str] = []
    warnings: list[str] = []
    stats: list[TableStats] = []

    with zipfile.ZipFile(docx_path) as zf:
        xml = zf.read("word/document.xml")
    root = DET.fromstring(xml)
    body = root.find(w("body"))
    if body is None:
        return (["Missing w:body"], [], [])

    full_text = _cell_text(body)
    if re.search(r"<<\\s*TBD\\s*:", full_text, flags=re.IGNORECASE):
        failures.append("Found unresolved placeholders like <<TBD: ...>>")

    # Basic heading duplication check (heuristic; may false-positive if TOC exists).
    for key in ["开标一览表", "开标分项一览表", "投标产品点对点应答表", "投标产品配置清单"]:
        count = full_text.count(key)
        if count > 2:
            warnings.append(f"Heading '{key}' appears {count} times (possible duplication).")

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
            empty_spec = 1 if not first[3].strip() else 0
            empty_price = 1 if not first[5].strip() else 0
            empty_total = 1 if not first[7].strip() else 0
            if empty_spec or empty_price or empty_total:
                failures.append("开标一览表 has empty critical cells (规格型号/单价/投标总价).")
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
            stats.append(
                TableStats(
                    name="投标产品点对点应答表",
                    rows=len(rows),
                    empty_counts={
                        "序号": count_empty(rows, 0),
                        "招标要求": count_empty(rows, 1),
                        "投标应答": count_empty(rows, 2),
                        "偏离说明": count_empty(rows, 3),
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

    return (failures, warnings, stats)


def main() -> int:
    parser = argparse.ArgumentParser(description="QC for bid MVP DOCX output")
    parser.add_argument("--docx", required=True, help="DOCX to check")
    args = parser.parse_args()

    docx_path = Path(args.docx)
    if not docx_path.is_file() or docx_path.suffix.lower() != ".docx":
        raise SystemExit(f"--docx must be an existing .docx file: {docx_path}")

    failures, warnings, stats = qc_docx(docx_path)

    print(f"# QC report: {docx_path.name}\n")
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
    print("## TABLES")
    for s in stats:
        print(f"- {s.name}: rows={s.rows} empty={s.empty_counts}")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

