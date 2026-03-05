#!/usr/bin/env python3
"""
Verify docx response table content against CSV source of truth.

After content is assembled from requirements.csv into a docx response table
(by assemble_response_table.py), this script verifies that the content landed
in the correct cells. CSV is always the source of truth --- if CSV and docx
disagree, the docx is wrong.

Matching is done by requirement text (fuzzy), never by row position.

Usage:
    python verify_docx_table.py \
        --requirements requirements.csv \
        --target response.docx \
        --output reports/verify-table.json

    # Use a specific table by index:
    python verify_docx_table.py \
        --requirements requirements.csv \
        --target response.docx \
        --output reports/verify-table.json \
        --table-index 1

    # Strict mode (fail on any mismatch):
    python verify_docx_table.py \
        --requirements requirements.csv \
        --target response.docx \
        --output reports/verify-table.json \
        --strict
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

try:
    from docx import Document  # type: ignore
except ModuleNotFoundError:
    print(
        "Error: python-docx is required. Install with: pip install python-docx",
        file=sys.stderr,
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Table header keywords used to auto-detect the response table
_HEADER_KEYWORDS_ID = ("序号",)
_HEADER_KEYWORDS_REQ = ("招标要求", "需求内容", "技术要求")
_HEADER_KEYWORDS_RESP = ("投标应答", "响应内容", "应答内容", "投标响应")
_HEADER_KEYWORDS_DEV = ("偏离说明", "偏离情况", "偏离")

# Placeholder patterns in table cells
_PLACEHOLDER_PATTERNS = re.compile(
    r"【重点填写】|【待填写】|【请填写】|<<\s*TBD|<<\s*待|〖.*?〗|＜＜"
)


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


def _normalize(text: str) -> str:
    """Normalize whitespace for comparison: collapse runs, strip edges."""
    return re.sub(r"\s+", " ", (text or "").strip())


def _preview(text: str, max_len: int = 80) -> str:
    """Return a truncated preview of text for reports."""
    norm = _normalize(text)
    if len(norm) <= max_len:
        return norm
    return norm[:max_len] + "..."


def _similarity(a: str, b: str) -> float:
    """Return similarity ratio between two strings (0.0 - 1.0)."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _text_contains(haystack: str, needle: str) -> bool:
    """Check if one normalized text contains the other."""
    h = _normalize(haystack)
    n = _normalize(needle)
    if not n:
        return True
    return n in h


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def _load_requirements(requirements_path: Path) -> list[dict[str, Any]]:
    """Load requirements.csv and return list of row dicts."""
    with open(requirements_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader)


def _csv_id(row: dict[str, Any]) -> str:
    """Extract row ID from CSV."""
    return _row_get(row, "id", "序号", "需求ID").strip() or "unknown"


def _csv_requirement(row: dict[str, Any]) -> str:
    """Extract requirement text from CSV."""
    return _row_get(row, "requirement", "招标要求", "条款内容", "需求内容", "title", "标题").strip()


def _csv_response(row: dict[str, Any]) -> str:
    """Extract response content from CSV."""
    return _row_get(row, "响应内容", "response", "应答", "响应", "回复内容").strip()


def _csv_deviation(row: dict[str, Any]) -> str:
    """Extract deviation from CSV."""
    return _row_get(row, "deviation", "偏离", "偏离情况").strip()


# ---------------------------------------------------------------------------
# DOCX table detection and extraction
# ---------------------------------------------------------------------------


def _header_matches(header_text: str, keywords: tuple[str, ...]) -> bool:
    """Check if a header cell text matches any of the keywords."""
    norm = _normalize(header_text)
    for kw in keywords:
        if kw in norm:
            return True
    return False


def _detect_response_table(
    doc: Any, table_index: int | None
) -> tuple[Any | None, int]:
    """
    Find the response table in the document.

    Returns (table_object, table_index) or (None, -1) if not found.
    """
    tables = doc.tables
    if not tables:
        return None, -1

    if table_index is not None:
        if 0 <= table_index < len(tables):
            return tables[table_index], table_index
        return None, -1

    # Auto-detect: look for tables whose header row contains the expected keywords
    for idx, table in enumerate(tables):
        if not table.rows:
            continue
        header_row = table.rows[0]
        header_texts = [_normalize(cell.text) for cell in header_row.cells]
        joined = " ".join(header_texts)

        has_id = any(_header_matches(t, _HEADER_KEYWORDS_ID) for t in header_texts)
        has_req = any(_header_matches(t, _HEADER_KEYWORDS_REQ) for t in header_texts)
        has_resp = any(
            _header_matches(t, _HEADER_KEYWORDS_RESP) for t in header_texts
        )
        has_dev = any(_header_matches(t, _HEADER_KEYWORDS_DEV) for t in header_texts)

        # Require at least: ID + requirement + response (deviation is optional)
        if has_id and has_req and has_resp:
            return table, idx

        # Fallback: check if joined header text contains key phrases
        if "序号" in joined and ("招标要求" in joined or "需求" in joined):
            if "响应" in joined or "应答" in joined or "投标" in joined:
                return table, idx

    return None, -1


def _identify_columns(
    header_row: Any,
) -> dict[str, int]:
    """
    Identify which column index maps to which role (id, requirement, response, deviation).

    Returns a dict like {"id": 0, "requirement": 1, "response": 2, "deviation": 3}.
    """
    columns: dict[str, int] = {}
    seen_indices: set[int] = set()

    header_texts = [_normalize(cell.text) for cell in header_row.cells]

    # De-duplicate merged cells: python-docx repeats the same cell object
    # for merged columns, resulting in duplicate indices.
    unique_headers: list[tuple[int, str]] = []
    prev_cell = None
    for i, cell in enumerate(header_row.cells):
        if cell._tc is not prev_cell:
            unique_headers.append((i, _normalize(cell.text)))
            prev_cell = cell._tc

    for col_idx, text in unique_headers:
        if col_idx in seen_indices:
            continue
        if not columns.get("id") and _header_matches(text, _HEADER_KEYWORDS_ID):
            columns["id"] = col_idx
            seen_indices.add(col_idx)
        elif not columns.get("requirement") and _header_matches(
            text, _HEADER_KEYWORDS_REQ
        ):
            columns["requirement"] = col_idx
            seen_indices.add(col_idx)
        elif not columns.get("response") and _header_matches(
            text, _HEADER_KEYWORDS_RESP
        ):
            columns["response"] = col_idx
            seen_indices.add(col_idx)
        elif not columns.get("deviation") and _header_matches(
            text, _HEADER_KEYWORDS_DEV
        ):
            columns["deviation"] = col_idx
            seen_indices.add(col_idx)

    return columns


def _extract_table_rows(
    table: Any, columns: dict[str, int]
) -> list[dict[str, str]]:
    """
    Extract data rows from the table (skipping header row).

    Returns a list of dicts with keys: id, requirement, response, deviation, _row_index.
    """
    rows: list[dict[str, str]] = []
    req_col = columns.get("requirement")
    resp_col = columns.get("response")
    id_col = columns.get("id")
    dev_col = columns.get("deviation")

    for row_idx, row in enumerate(table.rows):
        if row_idx == 0:
            continue  # skip header

        cells = row.cells
        num_cells = len(cells)

        entry: dict[str, str] = {"_row_index": str(row_idx)}

        if id_col is not None and id_col < num_cells:
            entry["id"] = cells[id_col].text.strip()
        else:
            entry["id"] = ""

        if req_col is not None and req_col < num_cells:
            entry["requirement"] = cells[req_col].text.strip()
        else:
            entry["requirement"] = ""

        if resp_col is not None and resp_col < num_cells:
            entry["response"] = cells[resp_col].text.strip()
        else:
            entry["response"] = ""

        if dev_col is not None and dev_col < num_cells:
            entry["deviation"] = cells[dev_col].text.strip()
        else:
            entry["deviation"] = ""

        # Skip rows that look empty (no requirement text at all)
        if not _normalize(entry.get("requirement", "")):
            continue

        rows.append(entry)

    return rows


# ---------------------------------------------------------------------------
# Matching and comparison
# ---------------------------------------------------------------------------

_FUZZY_THRESHOLD = 0.45  # Minimum similarity to consider a fuzzy match


def _find_matching_table_row(
    csv_req_text: str,
    table_rows: list[dict[str, str]],
    used_indices: set[int],
) -> tuple[dict[str, str] | None, int]:
    """
    Find the best matching table row for a CSV requirement text.

    Uses exact normalized match first, then fuzzy matching.
    Returns (matched_row, index_in_table_rows) or (None, -1).
    """
    csv_norm = _normalize(csv_req_text)
    if not csv_norm:
        return None, -1

    # Pass 1: Exact normalized match
    for idx, trow in enumerate(table_rows):
        if idx in used_indices:
            continue
        table_norm = _normalize(trow.get("requirement", ""))
        if csv_norm == table_norm:
            return trow, idx

    # Pass 2: Containment match (one contains the other)
    for idx, trow in enumerate(table_rows):
        if idx in used_indices:
            continue
        table_norm = _normalize(trow.get("requirement", ""))
        if not table_norm:
            continue
        if csv_norm in table_norm or table_norm in csv_norm:
            return trow, idx

    # Pass 3: Fuzzy match (SequenceMatcher)
    best_score = 0.0
    best_idx = -1
    for idx, trow in enumerate(table_rows):
        if idx in used_indices:
            continue
        table_norm = _normalize(trow.get("requirement", ""))
        if not table_norm:
            continue
        score = _similarity(csv_norm, table_norm)
        if score > best_score:
            best_score = score
            best_idx = idx

    if best_score >= _FUZZY_THRESHOLD and best_idx >= 0:
        return table_rows[best_idx], best_idx

    return None, -1


def _classify_match(
    csv_response: str, table_response: str
) -> tuple[str, list[str]]:
    """
    Compare CSV response against table cell response.

    Returns (match_type, issues) where match_type is one of:
      exact_match, partial_match, mismatch, empty, placeholder
    """
    csv_norm = _normalize(csv_response)
    table_norm = _normalize(table_response)
    issues: list[str] = []

    # Check for empty table cell
    if not table_norm and csv_norm:
        return "empty", ["Table cell is empty but CSV has response content"]

    # Check for placeholder text still in table cell
    if _PLACEHOLDER_PATTERNS.search(table_response):
        return "placeholder", [
            "Table cell still contains placeholder text: "
            + _preview(table_response, 60)
        ]

    # Exact match (after normalization)
    if csv_norm == table_norm:
        return "exact_match", []

    # Containment check: one contains the other
    if csv_norm and table_norm:
        if csv_norm in table_norm or table_norm in csv_norm:
            return "partial_match", [
                "Content partially matches (containment)"
            ]

    # Similarity check: >80% overlap
    sim = _similarity(csv_norm, table_norm)
    if sim >= 0.80:
        return "partial_match", [
            f"Content partially matches (similarity: {sim:.0%})"
        ]

    # Mismatch
    return "mismatch", ["Response content does not match CSV source"]


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


def verify(
    requirements_path: Path,
    target_path: Path,
    table_index: int | None,
    strict: bool,
) -> dict[str, Any]:
    """
    Run the full verification and return the report dict.
    """
    # Load CSV
    try:
        csv_rows = _load_requirements(requirements_path)
    except Exception as e:
        return {
            "meta": {
                "csv_path": str(requirements_path),
                "docx_path": str(target_path),
                "table_index": table_index,
                "mode": "strict" if strict else "normal",
            },
            "summary": {},
            "status": "fail",
            "details": [],
            "unmatched_csv_rows": [],
            "error": f"Failed to load CSV: {e}",
        }

    done_rows = [r for r in csv_rows if _is_done(r)]
    if not done_rows:
        return {
            "meta": {
                "csv_path": str(requirements_path),
                "docx_path": str(target_path),
                "table_index": table_index,
                "mode": "strict" if strict else "normal",
            },
            "summary": {
                "csv_done_rows": 0,
                "verified": 0,
                "exact_match": 0,
                "partial_match": 0,
                "mismatch": 0,
                "empty": 0,
                "placeholder": 0,
                "unmatched_csv_rows": 0,
            },
            "status": "pass",
            "details": [],
            "unmatched_csv_rows": [],
        }

    # Load DOCX
    try:
        doc = Document(str(target_path))
    except Exception as e:
        return {
            "meta": {
                "csv_path": str(requirements_path),
                "docx_path": str(target_path),
                "table_index": table_index,
                "mode": "strict" if strict else "normal",
            },
            "summary": {},
            "status": "fail",
            "details": [],
            "unmatched_csv_rows": [],
            "error": f"Failed to open docx: {e}",
        }

    # Find response table
    table, detected_index = _detect_response_table(doc, table_index)
    if table is None:
        return {
            "meta": {
                "csv_path": str(requirements_path),
                "docx_path": str(target_path),
                "table_index": table_index,
                "mode": "strict" if strict else "normal",
            },
            "summary": {},
            "status": "fail",
            "details": [],
            "unmatched_csv_rows": [],
            "error": (
                f"No response table found in docx"
                + (f" at index {table_index}" if table_index is not None else "")
                + ". Looked for headers: 序号 + 招标要求 + 投标应答/响应内容"
            ),
        }

    # Identify columns
    columns = _identify_columns(table.rows[0])
    if "requirement" not in columns:
        return {
            "meta": {
                "csv_path": str(requirements_path),
                "docx_path": str(target_path),
                "table_index": detected_index,
                "mode": "strict" if strict else "normal",
            },
            "summary": {},
            "status": "fail",
            "details": [],
            "unmatched_csv_rows": [],
            "error": "Could not identify requirement column in table header",
        }

    # Extract table data rows
    table_rows = _extract_table_rows(table, columns)

    # Compare each done CSV row against the table
    details: list[dict[str, Any]] = []
    unmatched: list[dict[str, str]] = []
    used_table_indices: set[int] = set()

    counts = {
        "exact_match": 0,
        "partial_match": 0,
        "mismatch": 0,
        "empty": 0,
        "placeholder": 0,
    }

    for csv_row in done_rows:
        row_id = _csv_id(csv_row)
        csv_req = _csv_requirement(csv_row)
        csv_resp = _csv_response(csv_row)

        matched_trow, match_idx = _find_matching_table_row(
            csv_req, table_rows, used_table_indices
        )

        if matched_trow is None:
            unmatched.append(
                {
                    "csv_id": row_id,
                    "reason": "No matching requirement text found in table",
                }
            )
            continue

        used_table_indices.add(match_idx)
        table_resp = matched_trow.get("response", "")
        table_row_index = int(matched_trow.get("_row_index", "0"))

        match_type, issues = _classify_match(csv_resp, table_resp)
        counts[match_type] += 1

        detail: dict[str, Any] = {
            "csv_id": row_id,
            "csv_requirement_preview": _preview(csv_req),
            "table_row": table_row_index,
            "match_type": match_type,
            "csv_response_preview": _preview(csv_resp),
            "table_response_preview": _preview(table_resp),
            "issues": issues,
        }
        details.append(detail)

    verified = len(details)

    # Determine overall status
    has_hard_failure = (
        counts["mismatch"] > 0
        or counts["empty"] > 0
        or counts["placeholder"] > 0
        or len(unmatched) > 0
    )
    has_soft_issue = counts["partial_match"] > 0

    if strict:
        status = "fail" if (has_hard_failure or has_soft_issue) else "pass"
    else:
        status = "fail" if has_hard_failure else "pass"

    report: dict[str, Any] = {
        "meta": {
            "csv_path": str(requirements_path),
            "docx_path": str(target_path),
            "table_index": detected_index,
            "mode": "strict" if strict else "normal",
        },
        "summary": {
            "csv_done_rows": len(done_rows),
            "verified": verified,
            "exact_match": counts["exact_match"],
            "partial_match": counts["partial_match"],
            "mismatch": counts["mismatch"],
            "empty": counts["empty"],
            "placeholder": counts["placeholder"],
            "unmatched_csv_rows": len(unmatched),
        },
        "status": status,
        "details": details,
        "unmatched_csv_rows": unmatched,
    }

    return report


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verify docx response table content against CSV source of truth. "
            "CSV is always authoritative --- if CSV and docx disagree, the docx is wrong."
        )
    )
    parser.add_argument(
        "--requirements",
        required=True,
        help="Path to requirements.csv (source of truth)",
    )
    parser.add_argument(
        "--target",
        required=True,
        help="Path to target docx file to verify",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output path for JSON verification report",
    )
    parser.add_argument(
        "--table-index",
        type=int,
        default=None,
        help="0-based index of the table to verify (default: auto-detect)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail on any mismatch including partial matches (default: warn-only for partial)",
    )
    args = parser.parse_args()

    requirements_path = Path(args.requirements)
    target_path = Path(args.target)

    # Validate inputs
    if not requirements_path.exists():
        print(
            f"Error: requirements.csv not found: {requirements_path}",
            file=sys.stderr,
        )
        return 1

    if not target_path.exists():
        print(
            f"Error: target docx not found: {target_path}",
            file=sys.stderr,
        )
        return 1

    # Run verification
    report = verify(requirements_path, target_path, args.table_index, args.strict)

    # Write report
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Report written to {output_path}")

    # Summary line
    summary = report.get("summary", {})
    if summary:
        print(
            f"Summary: {summary.get('csv_done_rows', 0)} CSV done rows, "
            f"{summary.get('verified', 0)} verified, "
            f"{summary.get('exact_match', 0)} exact, "
            f"{summary.get('partial_match', 0)} partial, "
            f"{summary.get('mismatch', 0)} mismatch, "
            f"{summary.get('empty', 0)} empty, "
            f"{summary.get('placeholder', 0)} placeholder, "
            f"{summary.get('unmatched_csv_rows', 0)} unmatched"
        )
    else:
        print(f"Status: {report.get('status', 'unknown')}")
        if report.get("error"):
            print(f"Error: {report['error']}", file=sys.stderr)

    # Exit code
    status = report.get("status", "fail")
    if report.get("error"):
        return 1
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
