#!/usr/bin/env python3
"""
MVP bid drafting: append a structured draft into an existing target .docx (OOXML edit).

Why:
- In many environments we don't have heavyweight docx builders (python-docx) installed.
- LLM-generated ad-hoc scripts (e.g. JS docx libraries) are brittle.
- This script provides a deterministic path: facts/requirements/xlsx -> target.docx.

What it does (MVP):
- Unzips the target .docx
- Appends:
  - Project overview table (from facts.json)
  - Eligibility / business requirements checklist (from requirements.csv)
  - Technical response table (from an .xlsx)
  - Equipment list (from an .xlsx)
  - Warranty & service commitments (from facts.json)
  - Open questions (from questions.md)
- Re-zips the .docx (in place, unless --output is provided)

Limitations:
- No tracked-changes (redlining). This produces a clean draft for review.
- Table formatting is minimal (TableGrid). Use the target template for styling.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

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
    # keep tabs / multiple spaces
    return ("  " in text) or ("\t" in text)


@dataclass(frozen=True)
class TableSpec:
    headers: list[str]
    rows: list[list[str]]


def unzip_docx(docx_path: Path, out_dir: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zf:
        zf.extractall(out_dir)


def zip_dir_to_docx(in_dir: Path, out_docx_path: Path) -> None:
    tmp_out = out_docx_path.with_suffix(out_docx_path.suffix + ".tmp")
    if tmp_out.exists():
        tmp_out.unlink()
    with zipfile.ZipFile(tmp_out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(in_dir):
            for file in files:
                full_path = Path(root) / file
                rel = full_path.relative_to(in_dir)
                # Zip expects forward slashes
                zf.write(full_path, str(rel).replace(os.sep, "/"))
    tmp_out.replace(out_docx_path)


def paragraph(
    text: str = "",
    *,
    style: str | None = None,
    align: str | None = None,
    bold: bool = False,
) -> ET.Element:
    p = ET.Element(w("p"))
    if style or align:
        pPr = ET.SubElement(p, w("pPr"))
        if style:
            pStyle = ET.SubElement(pPr, w("pStyle"))
            pStyle.set(w_attr("val"), style)
        if align:
            jc = ET.SubElement(pPr, w("jc"))
            jc.set(w_attr("val"), align)

    if text == "":
        ET.SubElement(p, w("r"))
        return p

    lines = text.splitlines() or [""]
    for i, line in enumerate(lines):
        r = ET.SubElement(p, w("r"))
        if bold:
            rPr = ET.SubElement(r, w("rPr"))
            ET.SubElement(rPr, w("b"))
        t = ET.SubElement(r, w("t"))
        if _xml_space_preserve(line):
            t.set(f"{{{XML_NS}}}space", "preserve")
        t.text = line
        if i != len(lines) - 1:
            ET.SubElement(r, w("br"))
    return p


def page_break() -> ET.Element:
    p = ET.Element(w("p"))
    r = ET.SubElement(p, w("r"))
    br = ET.SubElement(r, w("br"))
    br.set(w_attr("type"), "page")
    return p


def table(spec: TableSpec, *, col_widths_dxa: list[int] | None = None) -> ET.Element:
    tbl = ET.Element(w("tbl"))

    tblPr = ET.SubElement(tbl, w("tblPr"))
    tblStyle = ET.SubElement(tblPr, w("tblStyle"))
    tblStyle.set(w_attr("val"), "TableGrid")

    # A simple fixed layout avoids weird auto-sizing in OnlyOffice.
    tblLayout = ET.SubElement(tblPr, w("tblLayout"))
    tblLayout.set(w_attr("type"), "fixed")

    cols = len(spec.headers)
    if cols == 0:
        return tbl

    if col_widths_dxa is None:
        # Default total width ~ 9000 dxa.
        base = 9000 // cols
        col_widths_dxa = [base] * cols
        col_widths_dxa[-1] += 9000 - sum(col_widths_dxa)
    if len(col_widths_dxa) != cols:
        raise ValueError("col_widths_dxa length must match number of columns")

    tblGrid = ET.SubElement(tbl, w("tblGrid"))
    for width in col_widths_dxa:
        grid_col = ET.SubElement(tblGrid, w("gridCol"))
        grid_col.set(w_attr("w"), str(width))

    def _row(cells: Iterable[str], *, is_header: bool) -> ET.Element:
        tr = ET.Element(w("tr"))
        for i, value in enumerate(cells):
            tc = ET.SubElement(tr, w("tc"))
            tcPr = ET.SubElement(tc, w("tcPr"))
            tcW = ET.SubElement(tcPr, w("tcW"))
            tcW.set(w_attr("w"), str(col_widths_dxa[i]))
            tcW.set(w_attr("type"), "dxa")
            # Ensure each cell has at least one paragraph.
            tc.append(paragraph(value, bold=is_header))
        return tr

    tbl.append(_row(spec.headers, is_header=True))
    for row in spec.rows:
        # Normalize row length
        normalized = list(row) + [""] * (cols - len(row))
        normalized = normalized[:cols]
        tbl.append(_row([str(v) for v in normalized], is_header=False))

    return tbl


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return [{k: (v or "").strip() for k, v in row.items()} for row in reader]


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


def trim_empty_rows(rows: list[list[str]]) -> list[list[str]]:
    out: list[list[str]] = []
    for row in rows:
        if any((c or "").strip() for c in row):
            out.append(row)
    return out


def _normalize_tech_rows(rows: list[list[str]]) -> list[list[str]]:
    normalized: list[list[str]] = []
    for row in rows:
        # Expect: 序号 | 招标要求 | 投标应答 | 偏离说明 | 证明材料页码?
        row = list(row) + [""] * (5 - len(row))
        seq = (row[0] or "").strip()
        req = (row[1] or "").strip()
        ans = (row[2] or "").strip()
        dev = (row[3] or "").strip()
        proof = (row[4] or "").strip()
        if not (seq or req or ans or dev or proof):
            continue
        if not seq:
            m = re.match(r"^\s*(\d+)\s*[\.、]", req)
            if m:
                seq = m.group(1)
        if not dev:
            dev = "无偏离"
        normalized.append([seq, req, ans, dev, proof])
    return normalized


def _normalize_equipment_rows(rows: list[list[str]]) -> list[list[str]]:
    # The equipment sheet often alternates between:
    # - a row with 序号 + 产品名称 (no model/qty)
    # - a row with 产品型号 + 描述 + 数量 (no 序号/名称)
    # We collapse these pairs for a cleaner table.
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

        # Drop grouping/footer rows.
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

            is_detail_row = (not nxt_seq and not nxt_name) and bool(
                nxt_model or nxt_desc or nxt_qty or nxt_remark
            )
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


def _scoring_breakdown_table(facts: dict) -> TableSpec | None:
    scoring = (facts.get("scoring") or {}).get("breakdown") or {}
    if not scoring:
        return None

    rows: list[list[str]] = []
    price = scoring.get("price") or {}
    if price:
        rows.append(["价格", str(price.get("points") or ""), str(price.get("rule") or "")])

    technical = scoring.get("technical") or {}
    items = technical.get("items") or []
    for item in items:
        if not isinstance(item, dict):
            continue
        note = item.get("note") or ""
        rule = (item.get("rule") or "").strip()
        detail = rule if rule else note
        rows.append(
            [
                f"技术 - {item.get('name') or ''}".strip(),
                str(item.get("points") or ""),
                detail,
            ]
        )

    if not rows:
        return None

    return TableSpec(headers=["评分项", "分值", "规则/说明"], rows=rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Draft an MVP bid into an existing target .docx")
    parser.add_argument("--target", required=True, help="Target .docx to edit in place")
    parser.add_argument("--output", help="Write output .docx here (defaults to overwrite --target)")
    parser.add_argument("--facts", required=True, help="Path to bids/<bid_id>/facts.json")
    parser.add_argument("--requirements", required=True, help="Path to bids/<bid_id>/requirements.csv")
    parser.add_argument("--questions", required=True, help="Path to bids/<bid_id>/questions.md")
    parser.add_argument("--tech-xlsx", required=True, help="Technical response table .xlsx")
    parser.add_argument("--equip-xlsx", required=True, help="Equipment list .xlsx")
    parser.add_argument("--brand-xls", help="Brand deviation table .xls/.xlsx (optional)")
    args = parser.parse_args()

    target = Path(args.target)
    if not target.is_file() or target.suffix.lower() != ".docx":
        raise SystemExit(f"--target must be an existing .docx file: {target}")

    output = Path(args.output) if args.output else target
    facts_path = Path(args.facts)
    reqs_path = Path(args.requirements)
    questions_path = Path(args.questions)

    preview_script = Path(".opencode/skills/xlsx/scripts/preview_xlsx.py")
    soffice_script = Path(".opencode/skills/xlsx/scripts/office/soffice.py")
    if not preview_script.exists():
        raise SystemExit(f"Missing xlsx preview tool: {preview_script}")

    facts = json.loads(facts_path.read_text(encoding="utf-8"))
    requirements = read_csv_rows(reqs_path)
    questions_text = questions_path.read_text(encoding="utf-8").strip()

    tech_rows = load_xlsx_rows_json(
        preview_script=preview_script,
        xlsx_path=Path(args.tech_xlsx),
        sheet="1",
        max_rows=200,
        max_cols=8,
    )
    equip_rows = load_xlsx_rows_json(
        preview_script=preview_script,
        xlsx_path=Path(args.equip_xlsx),
        sheet="1",
        max_rows=250,
        max_cols=12,
    )

    # Try to normalize the equipment sheet by starting at the header row.
    equip_header_idx = find_header_row_index(equip_rows, "序号")
    if equip_header_idx is not None:
        equip_rows = equip_rows[equip_header_idx:]
    equip_rows = trim_empty_rows(equip_rows)

    # Optional brand deviation table: convert .xls -> .xlsx if needed.
    brand_rows: list[list[str]] = []
    if args.brand_xls:
        brand_path = Path(args.brand_xls)
        if brand_path.suffix.lower() == ".xls":
            if not soffice_script.exists():
                raise SystemExit(f"Missing LibreOffice wrapper: {soffice_script}")
            with tempfile.TemporaryDirectory() as td:
                outdir = Path(td)
                subprocess.check_call(
                    [
                        "python3",
                        str(soffice_script),
                        "--headless",
                        "--convert-to",
                        "xlsx",
                        "--outdir",
                        str(outdir),
                        str(brand_path),
                    ]
                )
                xlsx_candidates = sorted(outdir.glob("*.xlsx"))
                if xlsx_candidates:
                    brand_path = xlsx_candidates[0]
                    brand_rows = load_xlsx_rows_json(
                        preview_script=preview_script,
                        xlsx_path=brand_path,
                        sheet="1",
                        max_rows=260,
                        max_cols=10,
                    )
        elif brand_path.suffix.lower() == ".xlsx":
            brand_rows = load_xlsx_rows_json(
                preview_script=preview_script,
                xlsx_path=brand_path,
                sheet="1",
                max_rows=260,
                max_cols=10,
            )

        brand_rows = trim_empty_rows(brand_rows)

    # Build document elements
    elements: list[ET.Element] = []

    project_name = facts.get("tender", {}).get("projectName") or "投标项目"
    project_number = facts.get("tender", {}).get("projectNumber") or "<<TBD>>"
    budget = facts.get("tender", {}).get("budget") or "<<TBD>>"
    agency_name = facts.get("procurementAgency", {}).get("name") or "<<TBD>>"
    bid_deadline = facts.get("bidDeadline") or "<<TBD>>"
    bid_opening_loc = (facts.get("bidOpening") or {}).get("location") or "<<TBD>>"
    delivery = ((facts.get("businessTerms") or {}).get("delivery") or {}).get("value") or "<<TBD>>"
    bid_validity = ((facts.get("businessTerms") or {}).get("bidValidity") or {}).get("value") or "<<TBD>>"
    bid_bond = ((facts.get("businessTerms") or {}).get("bidBond") or {}).get("value") or "<<TBD>>"
    perf_bond = ((facts.get("businessTerms") or {}).get("performanceBond") or {}).get("value") or "<<TBD>>"
    payment = ((facts.get("businessTerms") or {}).get("payment") or {}).get("value") or "<<TBD>>"

    elements.append(paragraph("投标文件（草稿）", style="Heading1", align="center", bold=True))
    elements.append(paragraph(f"项目名称：{project_name}"))
    elements.append(paragraph(f"项目编号：{project_number}"))
    elements.append(paragraph(f"预算金额：{budget}"))
    elements.append(paragraph(f"采购代理机构：{agency_name}"))
    elements.append(paragraph(""))

    elements.append(paragraph("一、项目基本信息", style="Heading1"))
    info_rows = [
        ["项目名称", project_name],
        ["项目编号", project_number],
        ["预算金额", budget],
        ["采购代理机构", agency_name],
        ["投标截止/开标时间", bid_deadline],
        ["开标地点", bid_opening_loc],
        ["交货期/工期", delivery],
        ["投标有效期", bid_validity],
        ["投标保证金", bid_bond],
        ["履约保证金", perf_bond],
        ["付款方式（摘要）", payment],
        ["项目类型", "政府采购（专门面向中小企业）" if facts.get("eligibility", {}).get("面向中小企业") else "<<TBD>>"],
    ]
    elements.append(table(TableSpec(headers=["项目属性", "内容"], rows=info_rows), col_widths_dxa=[2500, 6500]))
    elements.append(paragraph(""))

    # Tender-required composition buckets (helps reviewers map draft sections to tender expectations).
    elements.append(paragraph("投标文件组成（对照招标文件）", style="Heading1"))
    elements.append(paragraph("报价文件：见《开标一览表》《开标分项一览表》等（报价需按招标文件附件格式填写）。"))
    elements.append(paragraph("资格文件：见“资格要求与商务要求（清单）”及后续资质附件。"))
    elements.append(paragraph("技术文件：见“技术参数响应与偏离说明（点对点）”、“设备清单（摘要）”及技术方案附件。"))
    elements.append(paragraph("承诺文件：见“售后与服务承诺（摘要）”及承诺函附件。"))
    elements.append(paragraph("其他补充文件：见“待确认问题清单”等。"))
    elements.append(paragraph(""))

    elements.append(paragraph("二、资格要求与商务要求（清单）", style="Heading1"))
    checklist_rows: list[list[str]] = []
    for r in requirements:
        cat = r.get("Category", "")
        if cat not in {"资格要求", "商务要求"}:
            continue
        checklist_rows.append([cat, r.get("Requirement", ""), r.get("Status", ""), r.get("ResponseLocation", "")])
    if checklist_rows:
        elements.append(
            table(
                TableSpec(headers=["类别", "要求", "状态", "位置/章节"], rows=checklist_rows),
                col_widths_dxa=[1100, 4700, 1100, 2100],
            )
        )
    else:
        elements.append(paragraph("<<TBD: 未找到 requirements.csv 中的资格/商务要求>>"))
    elements.append(paragraph(""))

    elements.append(paragraph("三、评标方法（摘要）", style="Heading1"))
    scoring = facts.get("scoring", {}) or {}
    elements.append(paragraph(f"评标方法：{scoring.get('method') or '<<TBD>>'}"))
    if scoring.get("description"):
        elements.append(paragraph(f"说明：{scoring.get('description')}"))
    breakdown = _scoring_breakdown_table(facts)
    if breakdown:
        elements.append(paragraph(""))
        elements.append(table(breakdown, col_widths_dxa=[2500, 900, 5600]))
    elements.append(paragraph(""))

    elements.append(paragraph("四、技术参数响应与偏离说明（点对点）", style="Heading1"))
    tech_rows = trim_empty_rows(tech_rows)
    if tech_rows:
        tech_header_idx = find_header_row_index(tech_rows, "序号")
        if tech_header_idx is not None:
            tech_rows = tech_rows[tech_header_idx:]
        tech_headers = (tech_rows[0] + [""] * 5)[:5]
        tech_data = _normalize_tech_rows(tech_rows[1:])
        # Keep at most 5 columns for readability.
        tech_headers = tech_headers[:5]
        tech_data = [row[:5] for row in tech_data]
        elements.append(
            table(
                TableSpec(headers=tech_headers, rows=tech_data),
                col_widths_dxa=[700, 3000, 3000, 1200, 1100],
            )
        )
    else:
        elements.append(paragraph("<<TBD: 无法读取技术应答表>>"))
    elements.append(paragraph(""))

    elements.append(paragraph("五、设备清单（摘要）", style="Heading1"))
    if equip_rows and len(equip_rows) >= 2:
        equip_headers = (equip_rows[0] + [""] * 6)[:6]
        equip_data = _normalize_equipment_rows([row[:6] for row in equip_rows[1:]])
        elements.append(
            table(
                TableSpec(headers=equip_headers, rows=equip_data),
                col_widths_dxa=[650, 2000, 1700, 2900, 850, 900],
            )
        )
    else:
        elements.append(paragraph("<<TBD: 无法读取设备清单>>"))
    elements.append(paragraph(""))

    elements.append(paragraph("六、售后与服务承诺（摘要）", style="Heading1"))
    warranty = facts.get("warranty", {}) or {}
    elements.append(paragraph(f"保修期：{warranty.get('duration') or '<<TBD>>'}"))
    elements.append(paragraph(f"服务级别：{warranty.get('serviceLevel') or '<<TBD>>'}"))
    elements.append(paragraph(f"制造商：{warranty.get('manufacturer') or '<<TBD>>'}"))
    elements.append(paragraph(""))

    if brand_rows:
        elements.append(page_break())
        elements.append(paragraph("附录 A：品牌偏离表（节选）", style="Heading1"))
        # Try to find the core table header and only emit a bounded window for MVP.
        header_idx = find_header_row_index(brand_rows, "序号")
        if header_idx is not None:
            brand_rows = brand_rows[header_idx:]
        brand_header = brand_rows[0] if brand_rows else []

        def _idx(name: str) -> int | None:
            try:
                return brand_header.index(name)
            except ValueError:
                return None

        idx_seq = _idx("序号") or 0
        idx_module = _idx("模块") or 1
        idx_req = _idx("招标要求") or 2
        idx_ans = _idx("投标应答") or 3
        idx_dev = _idx("偏离说明") or 4
        idx_proof = _idx("证明材料页码")
        if idx_proof is None:
            idx_proof = 6 if len(brand_header) > 6 else (len(brand_header) - 1)

        cols = [idx_seq, idx_module, idx_req, idx_ans, idx_dev, idx_proof]
        brand_headers = ["序号", "模块", "招标要求", "投标应答", "偏离说明", "证明材料页码"]

        brand_data: list[list[str]] = []
        for raw in brand_rows[1:]:
            row = list(raw)
            if len(row) <= max(cols):
                row += [""] * (max(cols) + 1 - len(row))

            picked = [(row[i] or "").strip() for i in cols]
            if not any(picked):
                continue

            seq = picked[0]
            # Skip section headers like "（一）报价要求" and keep numeric items only.
            if not re.fullmatch(r"\d+", seq):
                continue

            brand_data.append(picked)
            if len(brand_data) >= 50:
                break

        elements.append(
            table(
                TableSpec(headers=brand_headers, rows=brand_data),
                col_widths_dxa=[650, 1400, 2400, 2400, 1200, 950],
            )
        )
        elements.append(paragraph("（MVP：仅展示前 50 行；完整表请在参考资料中查看。）"))

    if questions_text:
        elements.append(page_break())
        elements.append(paragraph("附录 B：待确认问题清单", style="Heading1"))
        for line in questions_text.splitlines():
            if line.strip() == "":
                continue
            # Preserve markdown headings as simple headings.
            if line.startswith("# "):
                elements.append(paragraph(line[2:].strip(), style="Heading1"))
                continue
            if line.startswith("## "):
                elements.append(paragraph(line[3:].strip(), style="Heading2"))
                continue
            if line.startswith("### "):
                elements.append(paragraph(line[4:].strip(), style="Heading3"))
                continue
            # Markdown bullets → simple bullets (text prefix only, MVP)
            if line.lstrip().startswith("- "):
                elements.append(paragraph("• " + line.lstrip()[2:].strip()))
                continue
            elements.append(paragraph(line.strip()))

    with tempfile.TemporaryDirectory() as td:
        workdir = Path(td)
        unzip_docx(target, workdir)
        doc_xml = workdir / "word" / "document.xml"
        root = DET.parse(str(doc_xml)).getroot()
        body = root.find(w("body"))
        if body is None:
            raise SystemExit("Invalid docx: missing w:body")

        # Insert before trailing sectPr if present.
        sect = None
        for child in list(body):
            if child.tag == w("sectPr"):
                sect = child
                body.remove(child)
                break

        for el in elements:
            body.append(el)

        if sect is not None:
            body.append(sect)

        ET.ElementTree(root).write(str(doc_xml), encoding="utf-8", xml_declaration=True)
        zip_dir_to_docx(workdir, output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
