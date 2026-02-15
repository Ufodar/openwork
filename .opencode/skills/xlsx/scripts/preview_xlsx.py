#!/usr/bin/env python3
"""
Preview / extract cell values from an .xlsx without third‑party deps like pandas/openpyxl.

Why this exists:
- In many OpenWork/OpenCode environments, heavy Python deps (pandas/openpyxl) are not available.
- For bid-writing, we often just need a readable snapshot of sheets (headers + a few rows).

This script reads the OOXML parts directly:
- xl/workbook.xml + xl/_rels/workbook.xml.rels to resolve sheet files
- xl/sharedStrings.xml for string values
- xl/worksheets/sheet*.xml for cell grids
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import defusedxml.ElementTree as ET


NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_RELS = "http://schemas.openxmlformats.org/package/2006/relationships"


@dataclass(frozen=True)
class SheetInfo:
    index: int
    name: str
    target: str


def _col_letters_to_index(letters: str) -> int:
    # A -> 1, B -> 2, Z -> 26, AA -> 27, ...
    idx = 0
    for ch in letters:
        if not ("A" <= ch <= "Z"):
            continue
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx


def _read_xml(zf: zipfile.ZipFile, name: str) -> ET.Element | None:
    try:
        raw = zf.read(name)
    except KeyError:
        return None
    try:
        return ET.fromstring(raw)
    except Exception:
        return None


def _parse_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    root = _read_xml(zf, "xl/sharedStrings.xml")
    if root is None:
        return []

    strings: list[str] = []
    for si in root.findall(f"{{{NS_MAIN}}}si"):
        parts: list[str] = []
        # shared strings can be either <si><t> or <si><r><t>... for rich text
        for t in si.findall(f".//{{{NS_MAIN}}}t"):
            if t.text:
                parts.append(t.text)
        strings.append("".join(parts))
    return strings


def _parse_sheets(zf: zipfile.ZipFile) -> list[SheetInfo]:
    workbook = _read_xml(zf, "xl/workbook.xml")
    rels = _read_xml(zf, "xl/_rels/workbook.xml.rels")
    if workbook is None or rels is None:
        return []

    rid_to_target: dict[str, str] = {}
    for rel in rels.findall(f"{{{NS_RELS}}}Relationship"):
        rid = rel.attrib.get("Id", "").strip()
        target = rel.attrib.get("Target", "").strip()
        if rid and target:
            # Targets in workbook rels are relative to xl/
            rid_to_target[rid] = f"xl/{target.lstrip('/')}"

    sheets_parent = workbook.find(f"{{{NS_MAIN}}}sheets")
    if sheets_parent is None:
        return []

    sheets: list[SheetInfo] = []
    for i, sheet in enumerate(sheets_parent.findall(f"{{{NS_MAIN}}}sheet"), start=1):
        name = (sheet.attrib.get("name") or "").strip() or f"Sheet{i}"
        rid = (sheet.attrib.get(f"{{{NS_REL}}}id") or "").strip()
        target = rid_to_target.get(rid, "")
        if not target:
            continue
        sheets.append(SheetInfo(index=i, name=name, target=target))

    return sheets


def _cell_value(
    cell: ET.Element,
    shared_strings: list[str],
) -> str:
    t = cell.attrib.get("t")

    # inline string
    if t == "inlineStr":
        parts: list[str] = []
        for tt in cell.findall(f".//{{{NS_MAIN}}}t"):
            if tt.text:
                parts.append(tt.text)
        return "".join(parts)

    v = cell.find(f"{{{NS_MAIN}}}v")
    if v is None or v.text is None:
        return ""

    raw = v.text
    if t == "s":
        try:
            idx = int(raw)
            return shared_strings[idx] if 0 <= idx < len(shared_strings) else ""
        except Exception:
            return ""
    if t == "b":
        return "TRUE" if raw.strip() == "1" else "FALSE"

    return raw


def _preview_sheet(
    zf: zipfile.ZipFile,
    sheet: SheetInfo,
    shared_strings: list[str],
    max_rows: int,
    max_cols: int,
) -> dict[str, Any]:
    root = _read_xml(zf, sheet.target)
    if root is None:
        return {"sheet": sheet.name, "error": f"Missing sheet xml: {sheet.target}"}

    sheet_data = root.find(f".//{{{NS_MAIN}}}sheetData")
    if sheet_data is None:
        return {"sheet": sheet.name, "rows": []}

    rows_out: list[list[str]] = []
    seen_rows = 0
    global_max_col = 0

    # Iterate in document order; Excel stores rows in ascending r=.
    for row in sheet_data.findall(f"{{{NS_MAIN}}}row"):
        if seen_rows >= max_rows:
            break
        row_values: dict[int, str] = {}
        for cell in row.findall(f"{{{NS_MAIN}}}c"):
            ref = cell.attrib.get("r", "")
            m = re.match(r"^([A-Z]+)(\d+)$", ref)
            if not m:
                continue
            col_letters = m.group(1)
            col_idx = _col_letters_to_index(col_letters)
            if col_idx <= 0 or col_idx > max_cols:
                continue
            value = _cell_value(cell, shared_strings)
            if value != "":
                row_values[col_idx] = value
                global_max_col = max(global_max_col, col_idx)

        if global_max_col == 0:
            # keep empty rows only if we have already emitted some content
            if rows_out:
                rows_out.append([])
                seen_rows += 1
            continue

        row_list: list[str] = []
        for c in range(1, global_max_col + 1):
            row_list.append(row_values.get(c, ""))
        rows_out.append(row_list)
        seen_rows += 1

    return {
        "sheet": sheet.name,
        "sheetIndex": sheet.index,
        "maxColsEmitted": global_max_col,
        "rows": rows_out,
        "truncated": seen_rows >= max_rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Preview XLSX sheets without pandas/openpyxl")
    parser.add_argument("xlsx", help="Input .xlsx file")
    parser.add_argument("--list-sheets", action="store_true", help="List sheet names/indices")
    parser.add_argument("--sheet", help="Sheet name or 1-based index (default: 1)")
    parser.add_argument("--max-rows", type=int, default=60, help="Max rows to emit (default: 60)")
    parser.add_argument("--max-cols", type=int, default=30, help="Max cols to consider (default: 30)")
    parser.add_argument("--format", choices=["json", "tsv"], default="json", help="Output format")
    args = parser.parse_args()

    xlsx_path = Path(args.xlsx)
    if not xlsx_path.exists():
        print(json.dumps({"error": f"File not found: {xlsx_path}"}))
        return 2
    if xlsx_path.suffix.lower() != ".xlsx":
        print(json.dumps({"error": f"Only .xlsx is supported (got {xlsx_path.suffix})"}))
        return 2

    with zipfile.ZipFile(xlsx_path, "r") as zf:
        sheets = _parse_sheets(zf)
        if args.list_sheets:
            payload = {
                "file": str(xlsx_path),
                "sheets": [{"index": s.index, "name": s.name, "target": s.target} for s in sheets],
            }
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0

        if not sheets:
            print(json.dumps({"error": "No sheets found"}))
            return 1

        sheet_sel = (args.sheet or "1").strip()
        selected: SheetInfo | None = None
        if sheet_sel.isdigit():
            idx = int(sheet_sel)
            selected = next((s for s in sheets if s.index == idx), None)
        else:
            selected = next((s for s in sheets if s.name == sheet_sel), None)
        if selected is None:
            print(json.dumps({"error": f"Sheet not found: {sheet_sel}"}))
            return 1

        shared_strings = _parse_shared_strings(zf)
        preview = _preview_sheet(zf, selected, shared_strings, args.max_rows, args.max_cols)

        if args.format == "json":
            print(json.dumps(preview, ensure_ascii=False, indent=2))
            return 0

        # tsv
        rows = preview.get("rows", [])
        for row in rows:
            if not row:
                print("")
                continue
            print("\t".join(str(v) for v in row))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
