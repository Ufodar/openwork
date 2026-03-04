#!/usr/bin/env python3
"""
Deterministic **response table assembler** for bid documents.

Reads a filled requirements.csv and writes the response data into the
correct table rows in a target docx. This eliminates the off-by-N index
errors that occur when an LLM agent tries to address table cells directly.

The agent's only job is to fill the CSV columns; this script handles the
docx table mapping deterministically by matching on requirement text
(content-based addressing, not index-based).

Usage:
    python assemble_response_table.py \
        --requirements requirements.csv \
        --target template.docx \
        --output assembled.docx \
        [--table-index N]         # Which table in the docx (0-based, default: auto-detect)
        [--dry-run]               # Print mapping without modifying docx
        [--report report.json]    # Output JSON report of what was assembled
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

try:
    from docx import Document  # type: ignore
    from docx.table import Table, _Cell  # type: ignore
    from docx.text.run import Run  # type: ignore
except ImportError:
    print(
        "Error: python-docx is required. Install with: pip install python-docx",
        file=sys.stderr,
    )
    raise SystemExit(1)


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


def _norm_text(text: str) -> str:
    """Normalize text for comparison: strip whitespace and punctuation."""
    text = re.sub(r"\s+", "", (text or "").strip())
    # Remove common punctuation for more tolerant matching
    text = re.sub(r"[，。、；：！？\u201c\u201d\u2018\u2019（）《》【】\-—.,;:!?()\[\]]", "", text)
    return text


def _cell_text(cell: _Cell) -> str:
    """Extract all text from a docx table cell."""
    return "\n".join(p.text for p in cell.paragraphs).strip()


def _is_placeholder(text: str) -> bool:
    """Return True if cell text looks like a placeholder or is empty."""
    if not text.strip():
        return True
    placeholder_patterns = [
        r"^[\s]*$",
        r"^<<.*>>$",
        r"^待[填写定]",
        r"^未填",
        r"^TBD",
        r"^/\s*$",
        r"^—\s*$",
        r"^-\s*$",
        r"^N/?A\s*$",
    ]
    for pattern in placeholder_patterns:
        if re.match(pattern, text.strip(), re.IGNORECASE):
            return True
    return False


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def _load_requirements(requirements_path: Path) -> list[dict[str, Any]]:
    """Load requirements.csv and return list of row dicts."""
    with open(requirements_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader)


def _get_done_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filter rows to only those with done status."""
    return [r for r in rows if _is_done(r)]


# ---------------------------------------------------------------------------
# Table detection
# ---------------------------------------------------------------------------

# Header keywords used to score tables for auto-detection.
# Each tuple is (keyword, weight). Higher weight = more distinctive.
_HEADER_KEYWORDS: list[tuple[str, float]] = [
    ("序号", 1.0),
    ("招标要求", 2.0),
    ("投标应答", 2.0),
    ("响应内容", 2.0),
    ("偏离说明", 1.5),
    ("偏离情况", 1.5),
    ("证明材料", 1.5),
    ("需求", 1.0),
    ("应答", 1.0),
    ("响应", 1.0),
]


def _score_table_headers(table: Table) -> float:
    """Score a table by how well its first row matches response table headers."""
    if len(table.rows) < 2:
        return 0.0

    header_row = table.rows[0]
    header_text = "".join(_cell_text(cell) for cell in header_row.cells)
    header_norm = _norm_text(header_text)

    score = 0.0
    for keyword, weight in _HEADER_KEYWORDS:
        if _norm_text(keyword) in header_norm:
            score += weight
    return score


def _detect_table(doc: Document) -> tuple[int, float]:
    """
    Auto-detect the response table by scoring each table's headers.

    Returns (table_index, score). Returns (-1, 0) if no table scores > 0.
    """
    best_index = -1
    best_score = 0.0

    for i, table in enumerate(doc.tables):
        score = _score_table_headers(table)
        if score > best_score:
            best_score = score
            best_index = i

    return best_index, best_score


# ---------------------------------------------------------------------------
# Column detection within a table
# ---------------------------------------------------------------------------


def _detect_columns(table: Table) -> dict[str, int]:
    """
    Detect column indices for key fields in the table header row.

    Returns a dict mapping logical names to 0-based column indices:
      - "id": 序号 column
      - "requirement": 招标要求/需求 column
      - "response": 响应内容/投标应答 column
      - "deviation": 偏离说明/偏离情况 column
      - "proof": 证明材料 column
    """
    if len(table.rows) < 1:
        return {}

    header_row = table.rows[0]
    columns: dict[str, int] = {}

    for col_idx, cell in enumerate(header_row.cells):
        text = _norm_text(_cell_text(cell))

        # Skip if we already found this column (some tables have merged cells
        # that cause duplicate cell references)
        if not text:
            continue

        # ID / 序号
        if "id" not in columns:
            if text in (_norm_text("序号"),) or text == "id":
                columns["id"] = col_idx

        # Requirement text
        if "requirement" not in columns:
            for kw in ("招标要求", "需求描述", "需求内容", "需求", "要求"):
                if _norm_text(kw) in text:
                    columns["requirement"] = col_idx
                    break

        # Response content
        if "response" not in columns:
            for kw in ("投标应答", "响应内容", "应答内容", "响应", "应答"):
                if _norm_text(kw) in text:
                    columns["response"] = col_idx
                    break

        # Deviation
        if "deviation" not in columns:
            for kw in ("偏离说明", "偏离情况", "偏离"):
                if _norm_text(kw) in text:
                    columns["deviation"] = col_idx
                    break

        # Proof materials
        if "proof" not in columns:
            for kw in ("证明材料页码", "证明材料", "佐证材料"):
                if _norm_text(kw) in text:
                    columns["proof"] = col_idx
                    break

    return columns


# ---------------------------------------------------------------------------
# Matching: CSV rows <-> table rows
# ---------------------------------------------------------------------------


def _match_text(csv_text: str, table_text: str) -> tuple[bool, str]:
    """
    Compare CSV requirement text against table cell text.

    Returns (is_match, confidence) where confidence is:
      - "exact": normalized texts are identical
      - "prefix": first 20 normalized chars match
      - "fuzzy": not a match
    """
    csv_norm = _norm_text(csv_text)
    table_norm = _norm_text(table_text)

    if not csv_norm or not table_norm:
        return False, "fuzzy"

    # Exact match (after normalization)
    if csv_norm == table_norm:
        return True, "exact"

    # Prefix match: compare first 20 characters
    prefix_len = 20
    if len(csv_norm) >= prefix_len and len(table_norm) >= prefix_len:
        if csv_norm[:prefix_len] == table_norm[:prefix_len]:
            return True, "prefix"

    # Containment: one contains the other (for cases where table has
    # truncated or extended text)
    if len(csv_norm) > 10 and len(table_norm) > 10:
        if csv_norm in table_norm or table_norm in csv_norm:
            return True, "fuzzy"

    return False, "fuzzy"


def _build_mappings(
    done_rows: list[dict[str, Any]],
    table: Table,
    columns: dict[str, int],
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[int],
    list[str],
]:
    """
    Build mappings between CSV done rows and table data rows.

    Returns:
      - mappings: list of mapping dicts
      - unmapped_csv_rows: CSV rows that could not be matched
      - unmapped_table_rows: table row indices that were not matched
      - warnings: list of warning strings
    """
    mappings: list[dict[str, Any]] = []
    warnings: list[str] = []

    req_col = columns.get("requirement")
    if req_col is None:
        warnings.append("No requirement column detected in table — cannot match rows")
        return [], list(done_rows), list(range(1, len(table.rows))), warnings

    # Build index of table rows (skip header row 0)
    table_row_map: dict[int, str] = {}  # row_index -> requirement text
    for row_idx in range(1, len(table.rows)):
        row_cells = table.rows[row_idx].cells
        if req_col < len(row_cells):
            table_row_map[row_idx] = _cell_text(row_cells[req_col])

    matched_csv_indices: set[int] = set()
    matched_table_indices: set[int] = set()

    # Pass 1: exact matches
    for csv_idx, csv_row in enumerate(done_rows):
        if csv_idx in matched_csv_indices:
            continue

        csv_req = _row_get(csv_row, "requirement", "招标要求", "title", "标题").strip()
        csv_id = _row_get(csv_row, "id", "序号", "需求ID").strip() or f"row-{csv_idx}"

        for table_idx, table_req in table_row_map.items():
            if table_idx in matched_table_indices:
                continue

            is_match, confidence = _match_text(csv_req, table_req)
            if is_match and confidence == "exact":
                mappings.append({
                    "csv_index": csv_idx,
                    "csv_id": csv_id,
                    "csv_requirement": csv_req[:80],
                    "table_row": table_idx,
                    "table_requirement": table_req[:80],
                    "match_confidence": confidence,
                    "filled": False,  # will be updated during fill
                })
                matched_csv_indices.add(csv_idx)
                matched_table_indices.add(table_idx)
                break

    # Pass 2: prefix and fuzzy matches for remaining
    for csv_idx, csv_row in enumerate(done_rows):
        if csv_idx in matched_csv_indices:
            continue

        csv_req = _row_get(csv_row, "requirement", "招标要求", "title", "标题").strip()
        csv_id = _row_get(csv_row, "id", "序号", "需求ID").strip() or f"row-{csv_idx}"

        best_match: dict[str, Any] | None = None
        best_confidence_rank = 0  # prefix=2, fuzzy(containment)=1

        for table_idx, table_req in table_row_map.items():
            if table_idx in matched_table_indices:
                continue

            is_match, confidence = _match_text(csv_req, table_req)
            if is_match:
                rank = 2 if confidence == "prefix" else 1
                if rank > best_confidence_rank:
                    best_confidence_rank = rank
                    best_match = {
                        "csv_index": csv_idx,
                        "csv_id": csv_id,
                        "csv_requirement": csv_req[:80],
                        "table_row": table_idx,
                        "table_requirement": table_req[:80],
                        "match_confidence": confidence,
                        "filled": False,
                    }

        if best_match is not None:
            mappings.append(best_match)
            matched_csv_indices.add(csv_idx)
            matched_table_indices.add(best_match["table_row"])

    # Collect unmapped items
    unmapped_csv = [
        done_rows[i] for i in range(len(done_rows)) if i not in matched_csv_indices
    ]
    unmapped_table = [
        idx for idx in table_row_map if idx not in matched_table_indices
    ]

    # Warnings for unmapped items
    for csv_row in unmapped_csv:
        csv_id = _row_get(csv_row, "id", "序号", "需求ID").strip() or "unknown"
        csv_req = _row_get(csv_row, "requirement", "招标要求", "title", "标题").strip()
        warnings.append(
            f"CSV row {csv_id} ('{csv_req[:40]}') could not be matched to any table row"
        )

    return mappings, unmapped_csv, unmapped_table, warnings


# ---------------------------------------------------------------------------
# Fill table cells
# ---------------------------------------------------------------------------


def _set_cell_text_preserve_format(cell: _Cell, new_text: str) -> None:
    """
    Set cell text while preserving existing formatting.

    Uses the first paragraph's first run as the style template.
    Clears all existing content and writes new text using that style.
    """
    if not cell.paragraphs:
        cell.text = new_text
        return

    # Capture style from first paragraph's first run
    first_para = cell.paragraphs[0]
    template_font_name = None
    template_font_size = None
    template_bold = None
    template_italic = None
    template_para_format = first_para.paragraph_format

    if first_para.runs:
        template_run = first_para.runs[0]
        template_font_name = template_run.font.name
        template_font_size = template_run.font.size
        template_bold = template_run.font.bold
        template_italic = template_run.font.italic

    # Clear all paragraphs except the first
    for para in cell.paragraphs[1:]:
        p_element = para._element
        p_element.getparent().remove(p_element)

    # Clear all runs in first paragraph
    for run in first_para.runs:
        run._element.getparent().remove(run._element)

    # Handle multi-line text: split by newlines and create runs/paragraphs
    lines = new_text.split("\n")
    for line_idx, line in enumerate(lines):
        if line_idx == 0:
            # Use the existing first paragraph
            para = first_para
        else:
            # Add new paragraph (inherits cell default formatting)
            para = cell.add_paragraph()
            # Copy alignment from first paragraph
            if template_para_format.alignment is not None:
                para.paragraph_format.alignment = template_para_format.alignment

        run = para.add_run(line)

        # Apply template formatting
        if template_font_name is not None:
            run.font.name = template_font_name
        if template_font_size is not None:
            run.font.size = template_font_size
        if template_bold is not None:
            run.font.bold = template_bold
        if template_italic is not None:
            run.font.italic = template_italic


def _fill_table(
    table: Table,
    mappings: list[dict[str, Any]],
    done_rows: list[dict[str, Any]],
    columns: dict[str, int],
    dry_run: bool = False,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Fill table cells based on mappings.

    Returns updated mappings (with filled=True/False) and warnings.
    """
    warnings: list[str] = []
    response_col = columns.get("response")
    deviation_col = columns.get("deviation")
    proof_col = columns.get("proof")

    if response_col is None:
        warnings.append("No response column detected — cannot fill responses")

    for mapping in mappings:
        csv_idx = mapping["csv_index"]
        table_row_idx = mapping["table_row"]
        csv_row = done_rows[csv_idx]
        csv_id = mapping["csv_id"]

        row_cells = table.rows[table_row_idx].cells
        filled_any = False

        # Fill response
        if response_col is not None and response_col < len(row_cells):
            response_text = _row_get(
                csv_row, "响应内容", "response", "应答", "响应", "回复内容"
            ).strip()
            existing_text = _cell_text(row_cells[response_col])

            if response_text:
                if not _is_placeholder(existing_text) and existing_text:
                    warnings.append(
                        f"Table row {table_row_idx} (csv {csv_id}): "
                        f"response cell already has content '{existing_text[:30]}...' — skipping"
                    )
                else:
                    if not dry_run:
                        _set_cell_text_preserve_format(
                            row_cells[response_col], response_text
                        )
                    filled_any = True

        # Fill deviation
        if deviation_col is not None and deviation_col < len(row_cells):
            deviation_text = _row_get(
                csv_row, "deviation", "偏离", "偏离情况"
            ).strip()
            existing_text = _cell_text(row_cells[deviation_col])

            if deviation_text:
                if not _is_placeholder(existing_text) and existing_text:
                    warnings.append(
                        f"Table row {table_row_idx} (csv {csv_id}): "
                        f"deviation cell already has content — skipping"
                    )
                else:
                    if not dry_run:
                        _set_cell_text_preserve_format(
                            row_cells[deviation_col], deviation_text
                        )
                    filled_any = True

        # Fill proof page
        if proof_col is not None and proof_col < len(row_cells):
            proof_text = _row_get(
                csv_row, "proof_page", "证明材料页码", "证明材料"
            ).strip()
            existing_text = _cell_text(row_cells[proof_col])

            if proof_text:
                if not _is_placeholder(existing_text) and existing_text:
                    warnings.append(
                        f"Table row {table_row_idx} (csv {csv_id}): "
                        f"proof cell already has content — skipping"
                    )
                else:
                    if not dry_run:
                        _set_cell_text_preserve_format(
                            row_cells[proof_col], proof_text
                        )
                    filled_any = True

        mapping["filled"] = filled_any

    return mappings, warnings


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------


def _build_report(
    csv_path: str,
    docx_path: str,
    table_index: int,
    table_detected_by: str,
    done_rows: list[dict[str, Any]],
    table_data_row_count: int,
    mappings: list[dict[str, Any]],
    unmapped_csv: list[dict[str, Any]],
    unmapped_table: list[int],
    warnings: list[str],
) -> dict[str, Any]:
    """Build the JSON report."""

    unmapped_csv_info = []
    for row in unmapped_csv:
        csv_id = _row_get(row, "id", "序号", "需求ID").strip() or "unknown"
        csv_req = _row_get(row, "requirement", "招标要求", "title", "标题").strip()
        unmapped_csv_info.append({
            "csv_id": csv_id,
            "csv_requirement": csv_req[:80],
        })

    filled_count = sum(1 for m in mappings if m.get("filled"))

    return {
        "meta": {
            "csv_path": csv_path,
            "docx_path": docx_path,
            "table_index": table_index,
            "table_detected_by": table_detected_by,
        },
        "summary": {
            "csv_done_rows": len(done_rows),
            "table_data_rows": table_data_row_count,
            "mapped": len(mappings),
            "unmapped_csv": len(unmapped_csv),
            "unmapped_table": len(unmapped_table),
            "filled": filled_count,
        },
        "mappings": [
            {
                "csv_id": m["csv_id"],
                "csv_requirement": m["csv_requirement"],
                "table_row": m["table_row"],
                "table_requirement": m["table_requirement"],
                "match_confidence": m["match_confidence"],
                "filled": m["filled"],
            }
            for m in mappings
        ],
        "unmapped_csv_rows": unmapped_csv_info,
        "unmapped_table_rows": unmapped_table,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------


def assemble(
    requirements_path: Path,
    target_path: Path,
    output_path: Path,
    table_index: int | None = None,
    dry_run: bool = False,
    report_path: Path | None = None,
) -> int:
    """
    Main assembly logic.

    Returns 0 on success, 1 on error.
    """
    all_warnings: list[str] = []

    # --- Load CSV ---
    try:
        rows = _load_requirements(requirements_path)
    except Exception as e:
        print(f"Error: failed to parse requirements.csv: {e}", file=sys.stderr)
        return 1

    done_rows = _get_done_rows(rows)
    if not done_rows:
        print("Warning: no done rows found in requirements.csv", file=sys.stderr)
        all_warnings.append("No done rows found in CSV — nothing to assemble")

    # --- Load DOCX ---
    try:
        doc = Document(str(target_path))
    except Exception as e:
        print(f"Error: failed to open docx: {e}", file=sys.stderr)
        return 1

    if not doc.tables:
        print("Error: no tables found in the document", file=sys.stderr)
        return 1

    # --- Find target table ---
    table_detected_by = "manual"
    if table_index is not None:
        if table_index < 0 or table_index >= len(doc.tables):
            print(
                f"Error: --table-index {table_index} is out of range "
                f"(document has {len(doc.tables)} table(s), indices 0-{len(doc.tables) - 1})",
                file=sys.stderr,
            )
            return 1
        selected_table_index = table_index
    else:
        table_detected_by = "auto"
        selected_table_index, score = _detect_table(doc)
        if selected_table_index < 0 or score == 0:
            print(
                "Error: could not auto-detect a response table. "
                "Use --table-index to specify manually.",
                file=sys.stderr,
            )
            return 1
        print(
            f"Auto-detected table index {selected_table_index} (score: {score:.1f})"
        )

    table = doc.tables[selected_table_index]
    table_data_row_count = len(table.rows) - 1  # exclude header

    # --- Detect columns ---
    columns = _detect_columns(table)
    if not columns:
        print(
            "Error: could not detect any known columns in the table header",
            file=sys.stderr,
        )
        return 1

    detected_cols = ", ".join(f"{k}={v}" for k, v in sorted(columns.items()))
    print(f"Detected columns: {detected_cols}")

    # --- Build mappings ---
    if done_rows:
        mappings, unmapped_csv, unmapped_table, match_warnings = _build_mappings(
            done_rows, table, columns
        )
        all_warnings.extend(match_warnings)
    else:
        mappings = []
        unmapped_csv = []
        unmapped_table = list(range(1, len(table.rows)))

    print(
        f"Mapping: {len(mappings)} matched, "
        f"{len(unmapped_csv)} unmapped CSV rows, "
        f"{len(unmapped_table)} unmapped table rows"
    )

    # --- Fill table ---
    if mappings and not dry_run:
        mappings, fill_warnings = _fill_table(
            table, mappings, done_rows, columns, dry_run=False
        )
        all_warnings.extend(fill_warnings)
        filled_count = sum(1 for m in mappings if m.get("filled"))
        print(f"Filled {filled_count} table cells")
    elif mappings and dry_run:
        mappings, fill_warnings = _fill_table(
            table, mappings, done_rows, columns, dry_run=True
        )
        all_warnings.extend(fill_warnings)
        filled_count = sum(1 for m in mappings if m.get("filled"))
        print(f"[DRY RUN] Would fill {filled_count} table cells")
    else:
        print("No mappings to fill")

    # --- Save docx ---
    if not dry_run:
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            doc.save(str(output_path))
            print(f"Document saved to {output_path}")
        except Exception as e:
            print(f"Error: failed to save docx: {e}", file=sys.stderr)
            return 1
    else:
        print(f"[DRY RUN] Would save to {output_path}")

    # --- Generate report ---
    report = _build_report(
        csv_path=str(requirements_path),
        docx_path=str(target_path),
        table_index=selected_table_index,
        table_detected_by=table_detected_by,
        done_rows=done_rows,
        table_data_row_count=table_data_row_count,
        mappings=mappings,
        unmapped_csv=unmapped_csv,
        unmapped_table=unmapped_table,
        warnings=all_warnings,
    )

    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"Report written to {report_path}")
    else:
        # Always print summary to stdout
        print(
            json.dumps(report["summary"], ensure_ascii=False, indent=2)
        )

    if all_warnings:
        print(f"\nWarnings ({len(all_warnings)}):")
        for w in all_warnings:
            print(f"  - {w}")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Assemble response content from CSV into docx table. "
            "Matches by requirement text (content-based, not index-based) "
            "to avoid off-by-N errors."
        )
    )
    parser.add_argument(
        "--requirements",
        required=True,
        help="Path to requirements.csv with filled response columns",
    )
    parser.add_argument(
        "--target",
        required=True,
        help="Path to target docx containing the response table template",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path for the output docx (will not modify --target)",
    )
    parser.add_argument(
        "--table-index",
        type=int,
        default=None,
        help="Which table in the docx to fill (0-based). Default: auto-detect",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print mapping without modifying docx",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="Output path for JSON report of what was assembled",
    )
    args = parser.parse_args()

    requirements_path = Path(args.requirements)
    if not requirements_path.exists():
        print(
            f"Error: requirements.csv not found: {requirements_path}",
            file=sys.stderr,
        )
        return 1

    target_path = Path(args.target)
    if not target_path.exists():
        print(f"Error: target docx not found: {target_path}", file=sys.stderr)
        return 1

    output_path = Path(args.output)
    report_path = Path(args.report) if args.report else None

    return assemble(
        requirements_path=requirements_path,
        target_path=target_path,
        output_path=output_path,
        table_index=args.table_index,
        dry_run=args.dry_run,
        report_path=report_path,
    )


if __name__ == "__main__":
    raise SystemExit(main())
