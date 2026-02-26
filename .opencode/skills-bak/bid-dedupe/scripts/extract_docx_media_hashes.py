#!/usr/bin/env python3

import argparse
from pathlib import Path

from docx_dedupe_lib import extract_docx_images, json_dump


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract image hashes from a .docx for dedupe analysis.")
    parser.add_argument("docx", help="Path to .docx")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    images = extract_docx_images(args.docx)
    payload = {
        "docx": str(Path(args.docx)),
        "images": [
            {
                "name": img.name,
                "sizeBytes": img.size_bytes,
                "sha256": img.sha256,
                "dhash": img.dhash,
            }
            for img in images
        ],
    }
    json_dump(payload, args.out)
    print(f"Wrote {len(images)} images -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

