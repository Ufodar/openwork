#!/usr/bin/env python3
"""
Fill pre-formatted bid tables in an existing DOCX using structured XLSX inputs.

This script is intentionally deterministic and format-preserving:
- It edits the existing tables in `word/document.xml` (no new ad-hoc TableGrid tables).
- It clones existing data rows as templates to preserve fonts, spacing, borders, shading, etc.

Supported inputs:
- Technical response table: .xlsx (point-to-point responses)
- Equipment list: .xlsx (item list for bid forms)

What it fills (when the table is found in the target DOCX):
- 投标产品点对点应答表 (序号/招标要求/投标应答/偏离说明/证明材料页码)
- 开标分项一览表 (itemized list; prices filled with placeholder text)
- 投标产品配置清单 (序号/标的名称/规格型号/详细配置及技术标准)
- 开标一览表 (summary row placeholders for spec/price)

This is an MVP helper to make the assembled document look like a real bid,
without relying on LLM-generated prose or brittle formatting.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

import defusedxml.ElementTree as DET
import xml.etree.ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def w_attr(name: str) -> str:
    return f"{{{W_NS}}}{name}"


def _xml_space_preserve(text: str) -> bool:
    if text.startswith(" ") or text.endswith(" "):
        return True
    return ("  " in text) or ("\t" in text)


def _cell_text(tc: ET.Element) -> str:
    parts: list[str] = []
    for t in tc.iter(w("t")):
        if t.text:
            parts.append(t.text)
    return "".join(parts)


def _row_cells(tr: ET.Element) -> list[ET.Element]:
    return list(tr.findall(w("tc")))


def _row_texts(tr: ET.Element) -> list[str]:
    return [(_cell_text(tc) or "").strip() for tc in _row_cells(tr)]


def _norm_header(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").strip())


def _first_matching_row(trs: list[ET.Element], expected_cells: int) -> Optional[ET.Element]:
    for tr in trs:
        if len(_row_cells(tr)) == expected_cells:
            return tr
    return None


def _set_cell_text(tc: ET.Element, text: str) -> None:
    # Keep tcPr if present.
    tcPr = tc.find(w("tcPr"))
    template_p = tc.find(w("p"))
    template_r = template_p.find(w("r")) if template_p is not None else None
    template_pPr = copy.deepcopy(template_p.find(w("pPr"))) if template_p is not None and template_p.find(w("pPr")) is not None else None
    template_rPr = copy.deepcopy(template_r.find(w("rPr"))) if template_r is not None and template_r.find(w("rPr")) is not None else None

    for child in list(tc):
        if tcPr is not None and child is tcPr:
            continue
        tc.remove(child)

    if tcPr is not None:
        tc.append(tcPr)

    p = ET.SubElement(tc, w("p"))
    if template_pPr is not None:
        p.append(template_pPr)
    r = ET.SubElement(p, w("r"))
    if template_rPr is not None:
        r.append(template_rPr)

    lines = (text or "").splitlines() or [""]
    for i, line in enumerate(lines):
        t = ET.SubElement(r, w("t"))
        if _xml_space_preserve(line):
            t.set(f"{{{XML_NS}}}space", "preserve")
        t.text = line
        if i != len(lines) - 1:
            ET.SubElement(r, w("br"))


def unzip_docx(docx_path: Path, out_dir: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zf:
        zf.extractall(out_dir)


def zip_dir_to_docx(in_dir: Path, out_docx_path: Path) -> None:
    tmp_out = out_docx_path.with_suffix(out_docx_path.suffix + ".tmp")
    if tmp_out.exists():
        tmp_out.unlink()
    with zipfile.ZipFile(tmp_out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in in_dir.rglob("*"):
            if not file.is_file():
                continue
            rel = file.relative_to(in_dir)
            zf.write(file, str(rel).replace("\\", "/"))
    tmp_out.replace(out_docx_path)


def load_xlsx_rows_json(
    *,
    preview_script: Path,
    xlsx_path: Path,
    sheet: str,
    max_rows: int,
    max_cols: int,
) -> list[list[str]]:
    cmd = [
        "python3",
        str(preview_script),
        str(xlsx_path),
        "--sheet",
        str(sheet),
        "--max-rows",
        str(max_rows),
        "--max-cols",
        str(max_cols),
        "--format",
        "json",
    ]
    out = subprocess.check_output(cmd)
    payload = json.loads(out.decode("utf-8"))
    rows = payload.get("rows", [])
    if not isinstance(rows, list):
        return []
    normalized: list[list[str]] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        normalized.append([("" if v is None else str(v)) for v in row])
    return normalized


def find_header_row_index(rows: list[list[str]], header_first_cell: str) -> int | None:
    for i, row in enumerate(rows):
        if not row:
            continue
        if (row[0] or "").strip() == header_first_cell:
            return i
    return None


def _normalize_tech_rows(rows: list[list[str]]) -> list[list[str]]:
    normalized: list[list[str]] = []
    for row in rows:
        row = list(row) + [""] * (5 - len(row))
        seq = (row[0] or "").strip()
        req = (row[1] or "").strip()
        ans = (row[2] or "").strip()
        dev = (row[3] or "").strip()
        proof = (row[4] or "").strip()
        if not (seq or req or ans or dev or proof):
            continue
        if not seq:
            m = re.match(r"^\s*(\d+)\s*[\\.、]", req)
            if m:
                seq = m.group(1)
        if not dev:
            dev = "无偏离"
        normalized.append([seq, req, ans, dev, proof])
    return normalized


def _normalize_equipment_rows(rows: list[list[str]]) -> list[list[str]]:
    normalized: list[list[str]] = []
    i = 0
    while i < len(rows):
        row = list(rows[i]) + [""] * (6 - len(rows[i]))
        seq = (row[0] or "").strip()
        name = (row[1] or "").strip()
        model = (row[2] or "").strip()
        desc = (row[3] or "").strip()
        qty = (row[4] or "").strip()
        remark = (row[5] or "").strip()

        if name.startswith("Site_") or name in {"总计", "合计"}:
            i += 1
            continue

        is_name_row = bool(seq and name and not (model or desc or qty or remark))
        if is_name_row and i + 1 < len(rows):
            nxt = list(rows[i + 1]) + [""] * (6 - len(rows[i + 1]))
            nxt_seq = (nxt[0] or "").strip()
            nxt_name = (nxt[1] or "").strip()
            nxt_model = (nxt[2] or "").strip()
            nxt_desc = (nxt[3] or "").strip()
            nxt_qty = (nxt[4] or "").strip()
            nxt_remark = (nxt[5] or "").strip()

            is_detail_row = (not nxt_seq and not nxt_name) and bool(nxt_model or nxt_desc or nxt_qty or nxt_remark)
            if is_detail_row:
                model = nxt_model
                desc = nxt_desc
                qty = nxt_qty
                remark = nxt_remark or remark
                normalized.append([seq, name, model, desc, qty, remark])
                i += 2
                continue

        if seq or name or model or desc or qty or remark:
            normalized.append([seq, name, model, desc, qty, remark])
        i += 1
    return normalized


@dataclass
class FillReport:
    filled_tables: list[str]
    warnings: list[str]


def _fill_table_replace_rows(
    *,
    tbl: ET.Element,
    header_cells: list[str],
    new_rows: list[list[str]],
    keep_first_data_row_if_contains: str | None = None,
    kept_row_updates: dict[int, str] | None = None,
) -> tuple[int, list[str]]:
    warnings: list[str] = []
    trs = list(tbl.findall(w("tr")))
    if not trs:
        return (0, ["table has no rows"])

    header_tr = trs[0]
    expected_cells = len(header_cells)

    # Pick a template row with the same number of cells (skip merged section label rows).
    template_tr = _first_matching_row(trs[1:], expected_cells)
    if template_tr is None:
        # Fallback: clone header row (not ideal, but better than failing).
        template_tr = header_tr
        warnings.append("No data-row template found; cloning header row as template.")

    # Optionally keep the first existing data row (e.g. software platform row) if it matches.
    kept_row: ET.Element | None = None
    if keep_first_data_row_if_contains:
        first_data = _first_matching_row(trs[1:], expected_cells)
        if first_data is not None:
            first_text = " ".join(_row_texts(first_data))
            if keep_first_data_row_if_contains in first_text:
                kept_row = copy.deepcopy(first_data)
                if kept_row_updates:
                    kept_cells = _row_cells(kept_row)
                    for idx, value in kept_row_updates.items():
                        if 0 <= idx < len(kept_cells):
                            _set_cell_text(kept_cells[idx], value)

    # Remove all existing rows after header.
    for tr in trs[1:]:
        tbl.remove(tr)

    inserted = 0
    if kept_row is not None:
        tbl.append(kept_row)
        inserted += 1

    for row in new_rows:
        row = list(row) + [""] * (expected_cells - len(row))
        row = row[:expected_cells]
        new_tr = copy.deepcopy(template_tr)
        tcs = _row_cells(new_tr)
        if len(tcs) != expected_cells:
            warnings.append("Template row cell count mismatch; skipping row fill.")
            continue
        for tc, value in zip(tcs, row):
            _set_cell_text(tc, value)
        tbl.append(new_tr)
        inserted += 1

    return (inserted, warnings)


def _fill_table_update_first_data_row(
    *,
    tbl: ET.Element,
    header_cells: list[str],
    updates: dict[int, str],
) -> tuple[int, list[str]]:
    warnings: list[str] = []
    trs = list(tbl.findall(w("tr")))
    if len(trs) < 2:
        return (0, ["table has no data rows"])

    expected_cells = len(header_cells)
    first_data = _first_matching_row(trs[1:], expected_cells)
    if first_data is None:
        return (0, ["no suitable data row to update"])

    tcs = _row_cells(first_data)
    changed = 0
    for idx, value in updates.items():
        if idx < 0 or idx >= len(tcs):
            continue
        _set_cell_text(tcs[idx], value)
        changed += 1
    return (changed, warnings)


def fill_docx_tables(
    *,
    docx_path: Path,
    tech_rows: list[list[str]] | None,
    equip_rows: list[list[str]] | None,
    brand: str,
    manufacturer: str,
    origin: str,
    default_unit: str,
    price_placeholder: str,
    spec_placeholder: str,
) -> FillReport:
    filled: list[str] = []
    warnings: list[str] = []

    work_dir = Path(tempfile.mkdtemp(prefix="fill_bid_tables_"))
    try:
        unzip_docx(docx_path, work_dir)
        doc_xml_path = work_dir / "word" / "document.xml"
        tree = DET.parse(str(doc_xml_path))
        root = tree.getroot()
        body = root.find(w("body"))
        if body is None:
            raise SystemExit("DOCX has no w:body")

        tables = body.findall(w("tbl"))
        for tbl in tables:
            trs = list(tbl.findall(w("tr")))
            if not trs:
                continue
            header = _row_texts(trs[0])
            header_norm = [_norm_header(c) for c in header]

            # 投标产品点对点应答表
            if header_norm[:3] == ["序号", "招标要求", "投标应答"] and len(header_norm) >= 5:
                if not tech_rows:
                    warnings.append("Found 点对点应答表 but no tech rows provided; skipped.")
                    continue
                inserted, wns = _fill_table_replace_rows(
                    tbl=tbl,
                    header_cells=header_norm[:5],
                    new_rows=tech_rows,
                )
                filled.append(f"投标产品点对点应答表 (+{inserted} rows)")
                warnings.extend([f"点对点应答表: {w}" for w in wns])
                continue

            # 投标产品配置清单
            if header_norm[:2] == ["序号", "标的名称"] and "详细配置及技术标准" in header_norm and len(header_norm) == 4:
                if not equip_rows:
                    warnings.append("Found 配置清单 but no equipment rows provided; skipped.")
                    continue
                # Keep the software platform row if present, then renumber equipment rows sequentially.
                keep_platform = any(
                    "无线网络可视交互平台" in " ".join(_row_texts(tr))
                    for tr in trs[1:2]
                    if len(_row_cells(tr)) == len(header_norm)
                )
                seq_start = 2 if keep_platform else 1
                new_rows = [[str(i), r[1], r[2], r[3]] for i, r in enumerate(equip_rows, start=seq_start)]
                inserted, wns = _fill_table_replace_rows(
                    tbl=tbl,
                    header_cells=header_norm,
                    new_rows=new_rows,
                    keep_first_data_row_if_contains="无线网络可视交互平台",
                    kept_row_updates={
                        2: spec_placeholder,
                        3: "详见技术应答表",
                    },
                )
                filled.append(f"投标产品配置清单 (+{inserted} rows)")
                warnings.extend([f"配置清单: {w}" for w in wns])
                continue

            # 开标分项一览表
            if header_norm[:2] == ["项号", "货物名称"] and "采购数量" in header_norm and len(header_norm) == 11:
                if not equip_rows:
                    warnings.append("Found 开标分项一览表 but no equipment rows provided; skipped.")
                    continue

                keep_platform = any(
                    "无线网络可视交互平台" in " ".join(_row_texts(tr))
                    for tr in trs[1:2]
                    if len(_row_cells(tr)) == len(header_norm)
                )

                out_rows: list[list[str]] = []
                seq = 2 if keep_platform else 1
                for r in equip_rows:
                    name = r[1]
                    model = r[2]
                    desc = r[3]
                    qty = r[4]
                    # 商品属性可以放简短描述，否则放空，避免撑爆版式。
                    attrs = desc.strip()
                    if len(attrs) > 40:
                        attrs = attrs[:40] + "…"
                    out_rows.append(
                        [
                            str(seq),
                            name,
                            brand,
                            model,
                            manufacturer,
                            origin,
                            attrs,
                            price_placeholder,
                            qty,
                            default_unit,
                            price_placeholder,
                        ]
                    )
                    seq += 1

                inserted, wns = _fill_table_replace_rows(
                    tbl=tbl,
                    header_cells=header_norm,
                    new_rows=out_rows,
                    keep_first_data_row_if_contains="无线网络可视交互平台",
                    kept_row_updates={
                        3: spec_placeholder,
                        7: price_placeholder,
                        8: "1",
                        9: "套",
                        10: price_placeholder,
                    },
                )
                filled.append(f"开标分项一览表 (+{inserted} rows)")
                warnings.extend([f"开标分项一览表: {w}" for w in wns])
                continue

            # 开标一览表（summary）：只补齐空白字段，避免破坏合计行。
            if header_norm[:3] == ["序号", "标的名称", "品牌"] and len(header_norm) == 10 and "投标总价" in header_norm:
                changed, wns = _fill_table_update_first_data_row(
                    tbl=tbl,
                    header_cells=header_norm,
                    updates={
                        3: spec_placeholder,  # 规格型号
                        5: price_placeholder,  # 单价
                        7: price_placeholder,  # 投标总价
                    },
                )
                if changed:
                    filled.append("开标一览表 (filled placeholders)")
                warnings.extend([f"开标一览表: {w}" for w in wns])
                continue

        tree.write(str(doc_xml_path), xml_declaration=True, encoding="UTF-8")
        zip_dir_to_docx(work_dir, docx_path)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    return FillReport(filled_tables=filled, warnings=warnings)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fill pre-formatted bid tables in a DOCX using XLSX sources")
    parser.add_argument("--docx", required=True, help="Target .docx to edit in place")
    parser.add_argument("--tech-xlsx", help="Technical response table .xlsx (点对点应答表)")
    parser.add_argument("--tech-sheet", default="Sheet1", help="Sheet name for --tech-xlsx (default: Sheet1)")
    parser.add_argument("--equip-xlsx", help="Equipment list .xlsx (设备清单/开标分项)")
    parser.add_argument("--equip-sheet", default="价格明细清单", help="Sheet name for --equip-xlsx (default: 价格明细清单)")
    parser.add_argument("--brand", default="新华三", help="Brand string to fill in 开标分项一览表 (default: 新华三)")
    parser.add_argument(
        "--manufacturer",
        default="新华三技术有限公司",
        help="Manufacturer string to fill in 开标分项一览表 (default: 新华三技术有限公司)",
    )
    parser.add_argument("--origin", default="中国", help="Origin string to fill in 开标分项一览表 (default: 中国)")
    parser.add_argument("--unit", default="台", help="Default unit string (default: 台)")
    parser.add_argument("--price-placeholder", default="详见报价文件", help="Placeholder for price cells (default: 详见报价文件)")
    parser.add_argument("--spec-placeholder", default="详见开标分项一览表", help="Placeholder for spec cells (default: 详见开标分项一览表)")
    args = parser.parse_args()

    docx_path = Path(args.docx)
    if not docx_path.is_file() or docx_path.suffix.lower() != ".docx":
        raise SystemExit(f"--docx must be an existing .docx file: {docx_path}")

    preview_script = Path(".opencode/skills/xlsx/scripts/preview_xlsx.py")
    if not preview_script.is_file():
        raise SystemExit(f"Missing xlsx preview tool: {preview_script}")

    tech_rows: list[list[str]] | None = None
    equip_rows: list[list[str]] | None = None

    if args.tech_xlsx:
        tech_path = Path(args.tech_xlsx)
        if not tech_path.is_file():
            raise SystemExit(f"--tech-xlsx not found: {tech_path}")
        tech_all = load_xlsx_rows_json(
            preview_script=preview_script,
            xlsx_path=tech_path,
            sheet=str(args.tech_sheet),
            max_rows=5000,
            max_cols=12,
        )
        hidx = find_header_row_index(tech_all, "序号")
        if hidx is None:
            raise SystemExit("Unable to locate header row in tech xlsx (expected first cell '序号').")
        tech_rows = _normalize_tech_rows([row[:5] for row in tech_all[hidx + 1 :]])

    if args.equip_xlsx:
        equip_path = Path(args.equip_xlsx)
        if not equip_path.is_file():
            raise SystemExit(f"--equip-xlsx not found: {equip_path}")
        equip_all = load_xlsx_rows_json(
            preview_script=preview_script,
            xlsx_path=equip_path,
            sheet=str(args.equip_sheet),
            max_rows=5000,
            max_cols=12,
        )
        hidx = find_header_row_index(equip_all, "序号")
        if hidx is None:
            raise SystemExit("Unable to locate header row in equipment xlsx (expected first cell '序号').")
        equip_rows = _normalize_equipment_rows([row[:6] for row in equip_all[hidx + 1 :]])

    report = fill_docx_tables(
        docx_path=docx_path,
        tech_rows=tech_rows,
        equip_rows=equip_rows,
        brand=str(args.brand),
        manufacturer=str(args.manufacturer),
        origin=str(args.origin),
        default_unit=str(args.unit),
        price_placeholder=str(args.price_placeholder),
        spec_placeholder=str(args.spec_placeholder),
    )

    print(f"OK: filled tables in {docx_path}")
    if report.filled_tables:
        print("FILLED:")
        for item in report.filled_tables:
            print(f"- {item}")
    if report.warnings:
        print("WARNINGS:")
        for w in report.warnings:
            print(f"- {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
