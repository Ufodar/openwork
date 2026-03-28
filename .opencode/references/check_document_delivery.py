#!/usr/bin/env python3
"""
Deterministic delivery-quality gate for user-facing document outputs.

This script scans explicit deliverable paths (files or directories) and fails
closed when it finds placeholder hosts, fake credentials, or internal runtime
paths leaking into final artifacts.

Designed for hosted OpenWork document sessions:
- scan only stable user-facing outputs/reports or an explicit final file
- avoid scanning `.opencode/**`, `.tmp/**`, and other runtime-internal trees
- produce machine-readable JSON and a non-zero exit code on violations
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Iterable


SUPPORTED_TEXT_EXTENSIONS = {
    ".md",
    ".txt",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".csv",
    ".tsv",
    ".xml",
    ".html",
    ".htm",
    ".log",
}

SUPPORTED_BINARY_EXTENSIONS = {
    ".docx",
}

IGNORED_DIRECTORIES = {
    ".git",
    ".opencode",
    ".tmp",
    ".worktree",
    "node_modules",
    "dist",
    "build",
    "vendor",
    "tmp",
}

PATTERNS = [
    {
        "code": "placeholder-example-domain",
        "pattern": re.compile(r"example\.com", re.IGNORECASE),
        "message": "Placeholder example.com domain leaked into a deliverable.",
    },
    {
        "code": "placeholder-example-email",
        "pattern": re.compile(r"@example\.com\b", re.IGNORECASE),
        "message": "Placeholder @example.com email leaked into a deliverable.",
    },
    {
        "code": "placeholder-access-token",
        "pattern": re.compile(r"<(?:ACCESS_TOKEN|access_token)>"),
        "message": "Angle-bracket access token placeholder leaked into a deliverable.",
    },
    {
        "code": "placeholder-bearer-token",
        "pattern": re.compile(r"Bearer\s+<(?:ACCESS_TOKEN|access_token)>"),
        "message": "Bearer angle-bracket token placeholder leaked into a deliverable.",
    },
    {
        "code": "placeholder-password",
        "pattern": re.compile(r"(?:YourSecurePassword123!|Passw0rd!|Welcome123!)"),
        "message": "Template password leaked into a deliverable.",
    },
    {
        "code": "placeholder-schemed-host",
        "pattern": re.compile(r"https?://<"),
        "message": "Scheme-prefixed placeholder host leaked into a deliverable.",
    },
    {
        "code": "legacy-host-placeholder",
        "pattern": re.compile(r"<(?:API_HOST|APP_HOST)>"),
        "message": "Legacy host placeholder leaked into a deliverable.",
    },
    {
        "code": "internal-runtime-path",
        "pattern": re.compile(r"/root/\.openwork|documents/sessions/|\.tmp/system"),
        "message": "Internal runtime path leaked into a deliverable.",
    },
]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Deterministic delivery-quality gate for final document outputs")
    parser.add_argument(
        "--target",
        action="append",
        dest="targets",
        default=[],
        help="File or directory to scan. Repeat for multiple explicit targets.",
    )
    parser.add_argument(
        "--max-issues",
        type=int,
        default=50,
        help="Maximum number of issues to include in the JSON report.",
    )
    return parser


def is_supported_file(path: Path) -> bool:
    suffix = path.suffix.lower()
    return suffix in SUPPORTED_TEXT_EXTENSIONS or suffix in SUPPORTED_BINARY_EXTENSIONS


def iter_supported_files(target: Path) -> Iterable[Path]:
    if target.is_file():
        if is_supported_file(target):
            yield target
        return

    if not target.is_dir():
        return

    for path in sorted(target.rglob("*")):
        if not path.is_file():
            continue
        relative_parts = path.relative_to(target).parts[:-1]
        if any(part in IGNORED_DIRECTORIES for part in relative_parts):
            continue
        if is_supported_file(path):
            yield path


def extract_docx_text(path: Path) -> str:
    chunks: list[str] = []
    with zipfile.ZipFile(path) as archive:
        names = sorted(
            name
            for name in archive.namelist()
            if name.startswith("word/") and name.endswith(".xml")
        )
        for name in names:
            data = archive.read(name).decode("utf-8", errors="ignore")
            data = re.sub(r"<w:tab[^>]*/>", "\t", data)
            data = re.sub(r"</w:p>", "\n", data)
            data = re.sub(r"<[^>]+>", "", data)
            data = html.unescape(data)
            if data.strip():
                chunks.append(data)
    return "\n".join(chunks)


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return extract_docx_text(path)
    return path.read_text(encoding="utf-8", errors="ignore")


def collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def build_snippet(text: str, start: int, end: int, radius: int = 120) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    return collapse_whitespace(text[left:right])


def scan_file(path: Path, max_issues: int) -> list[dict]:
    text = extract_text(path)
    issues: list[dict] = []
    for entry in PATTERNS:
        pattern = entry["pattern"]
        for match in pattern.finditer(text):
            issues.append(
                {
                    "code": entry["code"],
                    "message": entry["message"],
                    "match": match.group(0),
                    "snippet": build_snippet(text, match.start(), match.end()),
                }
            )
            if len(issues) >= max_issues:
                return issues
    return issues


def main() -> int:
    args = build_parser().parse_args()
    raw_targets = [Path(item).resolve() for item in args.targets if item and item.strip()]
    if not raw_targets:
        print(json.dumps({"ok": False, "error": "No --target values were provided."}, ensure_ascii=False, indent=2))
        return 2

    scanned_files: list[str] = []
    missing_targets: list[str] = []
    issues: list[dict] = []

    for target in raw_targets:
        if not target.exists():
            missing_targets.append(str(target))
            continue
        for file_path in iter_supported_files(target):
            scanned_files.append(str(file_path))
            for issue in scan_file(file_path, max(1, args.max_issues - len(issues))):
                issues.append({"file": str(file_path), **issue})
                if len(issues) >= args.max_issues:
                    break
            if len(issues) >= args.max_issues:
                break
        if len(issues) >= args.max_issues:
            break

    report = {
        "ok": len(issues) == 0 and len(scanned_files) > 0,
        "scannedFiles": scanned_files,
        "missingTargets": missing_targets,
        "issueCount": len(issues),
        "issues": issues,
    }
    if not scanned_files:
        report["ok"] = False
        report["error"] = "No supported deliverable files were found under the provided targets."
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not issues else 1


if __name__ == "__main__":
    raise SystemExit(main())
