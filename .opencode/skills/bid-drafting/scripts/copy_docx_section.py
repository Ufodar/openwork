#!/usr/bin/env python3
"""CLI for cross-document section copy in DOCX files.

Usage:
    # List headings in a document
    python3 copy_docx_section.py --source doc.docx --list-headings
    python3 copy_docx_section.py --source doc.docx --list-headings --json

    # Copy a section from source to target
    python3 copy_docx_section.py \
        --source source.docx \
        --target target.docx \
        --output target.docx \
        --source-heading "技术方案" \
        --target-heading "第二章" \
        --match-mode contains

    # Disambiguate when multiple headings match
    python3 copy_docx_section.py \
        --source source.docx \
        --target target.docx \
        --output target.docx \
        --source-heading "技术方案" \
        --source-heading-index 2 \
        --target-heading "第二章" \
        --match-mode contains
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

# Allow importing from the same directory
sys.path.insert(0, str(Path(__file__).parent))

from docx_copy_lib import list_headings, copy_section


def main() -> None:
    parser = argparse.ArgumentParser(description="Cross-document DOCX section copy tool")
    parser.add_argument("--source", required=True, help="Source .docx file")
    parser.add_argument("--list-headings", action="store_true",
                        help="List all headings in the source document")
    parser.add_argument("--json", action="store_true",
                        help="Output in JSON format (for list-headings)")
    parser.add_argument("--target", help="Target .docx file (for copy mode)")
    parser.add_argument("--output", help="Output .docx file path (defaults to --target)")
    parser.add_argument("--source-heading", help="Heading text to match in source")
    parser.add_argument("--source-heading-index", type=int,
                        help="1-based index to select a specific matching source heading")
    parser.add_argument("--target-heading",
                        help="Heading text in target after which to insert (omit to append)")
    parser.add_argument("--target-heading-index", type=int,
                        help="1-based index to select a specific matching target heading")
    parser.add_argument("--match-mode", default="contains",
                        choices=["exact", "contains", "startswith"],
                        help="How to match heading text (default: contains)")
    parser.add_argument("--exclude-source-heading", action="store_true",
                        help="Copy section content without the source heading paragraph")
    args = parser.parse_args()

    if args.list_headings:
        try:
            headings = list_headings(args.source)
        except FileNotFoundError:
            print(f"ERROR: File not found: {args.source}", file=sys.stderr)
            sys.exit(1)
        except zipfile.BadZipFile:
            print(f"ERROR: Not a valid .docx file: {args.source}", file=sys.stderr)
            sys.exit(1)
        if args.json:
            data = [
                {"level": h.level, "text": h.text, "elementCount": h.element_count}
                for h in headings
            ]
            print(json.dumps(data, ensure_ascii=False, indent=2))
        else:
            for h in headings:
                print(f"[{h.level}] {h.text} ({h.element_count} elements)")
        return

    # Copy mode
    if not args.source_heading:
        parser.error("--source-heading is required for copy mode")
    if not args.target:
        parser.error("--target is required for copy mode")

    output = args.output or args.target

    try:
        result = copy_section(
            source_path=args.source,
            target_path=args.target,
            output_path=output,
            source_heading=args.source_heading,
            target_heading=args.target_heading,
            match_mode=args.match_mode,
            source_heading_index=args.source_heading_index,
            target_heading_index=args.target_heading_index,
            exclude_source_heading=args.exclude_source_heading,
        )
    except FileNotFoundError as e:
        print(f"ERROR: File not found: {e}", file=sys.stderr)
        sys.exit(1)
    except zipfile.BadZipFile as e:
        print(f"ERROR: Not a valid .docx file: {e}", file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Copied: {result.paragraphs} paragraphs, {result.tables} tables, "
          f"{result.images} images, {result.styles} styles")
    for w in result.warnings:
        print(f"WARNING: {w}", file=sys.stderr)


if __name__ == "__main__":
    main()
