#!/usr/bin/env python3

import argparse
from pathlib import Path

from docx_dedupe_lib import extract_docx_chunks, json_dump


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract heading-aware text chunks from a .docx for dedupe analysis.")
    parser.add_argument("docx", help="Path to .docx")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    chunks = extract_docx_chunks(args.docx)
    payload = {
        "docx": str(Path(args.docx)),
        "chunks": [
            {
                "title": c.title,
                "charCount": c.char_count,
                "sha256": c.sha256,
                "simhash64": f"{c.simhash:016x}",
                "text": c.text,
            }
            for c in chunks
        ],
    }
    json_dump(payload, args.out)
    print(f"Wrote {len(chunks)} chunks -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

