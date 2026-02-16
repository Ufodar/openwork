#!/usr/bin/env python3
"""
Assemble a baseline bid document by copying pre-formatted sections from reference DOCX files.

This is intentionally deterministic and format-preserving:
- It does NOT generate new ad-hoc tables/styles (which tends to look unprofessional).
- It reuses existing content from reference bids / tender docs and inserts into a target template.

Supported sources:
- .docx (native)
- .doc (auto-converted to .docx via LibreOffice "soffice")
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

from docx_copy_lib import copy_section


DEFAULT_PARTNER_HEADINGS = [
    "开标一览表",
    "开标分项一览表",
    "投标产品点对点应答表",
    "投标产品配置清单",
    "售后服务承诺",
]


@dataclass(frozen=True)
class CopyPlanItem:
    label: str
    source: Path
    heading: str
    heading_index: int | None = None


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _convert_doc_to_docx(input_path: Path, cache_dir: Path) -> Path:
    ext = input_path.suffix.lower()
    if ext in {".docx", ".docm", ".dotx", ".dotm"}:
        return input_path
    if ext != ".doc":
        raise SystemExit(f"Unsupported source type: {input_path} (expected .docx/.docm/.dotx/.dotm or .doc)")

    _ensure_dir(cache_dir)
    info = input_path.stat()
    signature = hashlib.sha256(f"{input_path}:{info.st_size}:{info.st_mtime_ns}".encode("utf-8")).hexdigest()[:12]
    dest = cache_dir / f"{input_path.stem}-{signature}.docx"
    if dest.exists():
        return dest

    tmp_dir = cache_dir / f"tmp-{signature}"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir, ignore_errors=True)
    _ensure_dir(tmp_dir)

    try:
        result = subprocess.run(
            [
                "soffice",
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--convert-to",
                "docx",
                "--outdir",
                str(tmp_dir),
                str(input_path),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            stdout = (result.stdout or "").strip()
            raise SystemExit(stderr or stdout or "LibreOffice conversion failed")

        expected = tmp_dir / f"{input_path.stem}.docx"
        if expected.exists():
            expected.replace(dest)
            return dest

        candidates = sorted(tmp_dir.glob("*.docx"))
        if not candidates:
            raise SystemExit("LibreOffice did not produce a .docx output.")
        candidates[0].replace(dest)
        return dest
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _copy_sequence(
    *,
    target_path: Path,
    items: Sequence[CopyPlanItem],
    match_mode: str,
    exclude_source_heading: bool,
) -> list[str]:
    warnings: list[str] = []
    for item in items:
        result = copy_section(
            source_path=str(item.source),
            target_path=str(target_path),
            output_path=str(target_path),
            source_heading=item.heading,
            target_heading=None,
            match_mode=match_mode,
            source_heading_index=item.heading_index,
            target_heading_index=None,
            exclude_source_heading=exclude_source_heading,
        )
        for w in result.warnings:
            warnings.append(f"{item.label}: {w}")
    return warnings


def _parse_repeated(values: Iterable[str] | None) -> list[str]:
    out: list[str] = []
    for raw in values or []:
        val = (raw or "").strip()
        if not val:
            continue
        out.append(val)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Assemble a bid doc by copying sections from reference DOCX files")
    parser.add_argument("--target", required=True, help="Target .docx template (will be edited in-place unless --output)")
    parser.add_argument("--output", help="Write assembled output to this path (keeps --target unchanged)")
    parser.add_argument("--tender", help="Tender document (.docx or .doc)")
    parser.add_argument("--tender-heading", action="append", help="Heading to copy from tender (repeatable)")
    parser.add_argument("--partner", help="Partner/reference bid (.docx or .doc)")
    parser.add_argument(
        "--partner-heading",
        action="append",
        help="Heading to copy from partner (repeatable). If omitted, uses a default forms set.",
    )
    parser.add_argument(
        "--match-mode",
        choices=["exact", "contains", "startswith"],
        default="exact",
        help="How to match heading text (default: exact)",
    )
    parser.add_argument(
        "--exclude-source-heading",
        action="store_true",
        help="Copy section content without the source heading paragraph",
    )
    parser.add_argument(
        "--doc-convert-cache",
        default=".opencode/openwork/cache/docx-convert",
        help="Directory for .doc -> .docx conversion cache",
    )
    args = parser.parse_args()

    target = Path(args.target)
    if not target.is_file() or target.suffix.lower() != ".docx":
        raise SystemExit(f"--target must be an existing .docx file: {target}")

    out_path = Path(args.output) if args.output else target
    if args.output:
        _ensure_dir(out_path.parent)
        shutil.copyfile(target, out_path)

    cache_dir = Path(args.doc_convert_cache)

    plan: list[CopyPlanItem] = []

    tender_headings = _parse_repeated(args.tender_heading)
    if args.tender and tender_headings:
        tender_doc = _convert_doc_to_docx(Path(args.tender), cache_dir)
        for heading in tender_headings:
            plan.append(CopyPlanItem(label="tender", source=tender_doc, heading=heading))

    partner_headings = _parse_repeated(args.partner_heading) or list(DEFAULT_PARTNER_HEADINGS)
    if args.partner:
        partner_doc = _convert_doc_to_docx(Path(args.partner), cache_dir)
        for heading in partner_headings:
            plan.append(CopyPlanItem(label="partner", source=partner_doc, heading=heading))

    if not plan:
        raise SystemExit("Nothing to assemble. Provide --partner and/or --tender with headings.")

    warnings = _copy_sequence(
        target_path=out_path,
        items=plan,
        match_mode=args.match_mode,
        exclude_source_heading=bool(args.exclude_source_heading),
    )

    print(f"OK: assembled -> {out_path}")
    if warnings:
        print("WARNINGS:")
        for w in warnings:
            print(f"- {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
