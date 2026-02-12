#!/usr/bin/env python3

from __future__ import annotations

import argparse
import itertools
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Tuple

from docx_dedupe_lib import DocxChunk, DocxImageHash, extract_docx_chunks, extract_docx_images, hamming_distance64, normalize_text


def excerpt(text: str, limit: int = 140) -> str:
    t = normalize_text(text)
    if len(t) <= limit:
        return t
    return t[: limit - 1] + "…"


def write_report(out_path: str, docs: List[str], chunks_by_doc: Dict[str, List[DocxChunk]], images_by_doc: Dict[str, List[DocxImageHash]]) -> None:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    doc_labels = {doc: Path(doc).name for doc in docs}

    # Exact duplicates (text)
    chunk_map: Dict[str, List[Tuple[str, DocxChunk]]] = {}
    for doc, chunks in chunks_by_doc.items():
        for c in chunks:
            chunk_map.setdefault(c.sha256, []).append((doc, c))

    exact_text_groups = [items for sha, items in chunk_map.items() if len(items) > 1 and items[0][1].char_count >= 200]
    exact_text_groups.sort(key=lambda g: g[0][1].char_count, reverse=True)

    # Exact duplicates (images)
    img_map: Dict[str, List[Tuple[str, DocxImageHash]]] = {}
    dhash_map: Dict[str, List[Tuple[str, DocxImageHash]]] = {}
    for doc, images in images_by_doc.items():
        for img in images:
            img_map.setdefault(img.sha256, []).append((doc, img))
            if img.dhash:
                dhash_map.setdefault(img.dhash, []).append((doc, img))

    exact_image_groups = [items for sha, items in img_map.items() if len(items) > 1]
    exact_image_groups.sort(key=lambda g: g[0][1].size_bytes, reverse=True)

    near_image_groups = [items for dh, items in dhash_map.items() if len(items) > 1]
    near_image_groups.sort(key=lambda g: g[0][1].size_bytes, reverse=True)

    # Near duplicates (text)
    near_pairs: List[Tuple[str, str, DocxChunk, DocxChunk, int, float]] = []
    SIMHASH_MAX_DIST = 4
    RATIO_THRESHOLD = 0.92
    MIN_CHARS = 400

    for a, b in itertools.combinations(docs, 2):
        a_chunks = [c for c in chunks_by_doc[a] if c.char_count >= MIN_CHARS]
        b_chunks = [c for c in chunks_by_doc[b] if c.char_count >= MIN_CHARS]
        if not a_chunks or not b_chunks:
            continue

        for ca in a_chunks:
            for cb in b_chunks:
                if ca.sha256 == cb.sha256:
                    continue
                dist = hamming_distance64(ca.simhash, cb.simhash)
                if dist > SIMHASH_MAX_DIST:
                    continue
                ra = normalize_text(ca.text)
                rb = normalize_text(cb.text)
                ratio = SequenceMatcher(None, ra, rb).ratio()
                if ratio >= RATIO_THRESHOLD:
                    near_pairs.append((a, b, ca, cb, dist, ratio))

    near_pairs.sort(key=lambda x: x[5], reverse=True)

    with out.open("w", encoding="utf-8") as f:
        f.write("# Bid dedupe report\n\n")
        f.write("## Compared documents\n\n")
        for doc in docs:
            f.write(f"- `{doc}`\n")

        f.write("\n## Exact duplicate images (highest risk)\n\n")
        if not exact_image_groups:
            f.write("- None found.\n")
        else:
            for group in exact_image_groups[:50]:
                f.write(f"- SHA256 `{group[0][1].sha256[:12]}…` ({group[0][1].size_bytes} bytes)\n")
                for doc, img in group:
                    f.write(f"  - {doc_labels[doc]}: `{img.name}`\n")

        f.write("\n## Near-duplicate images (dHash)\n\n")
        if not near_image_groups:
            f.write("- None found (or Pillow not installed).\n")
        else:
            for group in near_image_groups[:50]:
                f.write(f"- dHash `{group[0][1].dhash}`\n")
                for doc, img in group:
                    f.write(f"  - {doc_labels[doc]}: `{img.name}` (sha `{img.sha256[:12]}…`)\n")

        f.write("\n## Exact duplicate text blocks\n\n")
        if not exact_text_groups:
            f.write("- None found.\n")
        else:
            for group in exact_text_groups[:50]:
                _, sample = group[0]
                f.write(f"- `{sample.title}` ({sample.char_count} chars)\n")
                f.write(f"  - Excerpt: {excerpt(sample.text)}\n")
                for doc, chunk in group:
                    f.write(f"  - {doc_labels[doc]}: `{chunk.title}`\n")

        f.write("\n## Near-duplicate text blocks\n\n")
        if not near_pairs:
            f.write("- None found.\n")
        else:
            for a, b, ca, cb, dist, ratio in near_pairs[:80]:
                f.write(f"- {doc_labels[a]} ↔ {doc_labels[b]} (sim={ratio:.2f}, dist={dist})\n")
                f.write(f"  - A: `{ca.title}` — {excerpt(ca.text)}\n")
                f.write(f"  - B: `{cb.title}` — {excerpt(cb.text)}\n")

        f.write("\n## Notes\n\n")
        f.write("- Some tender-required tables/forms may be legitimately identical across bids; focus on technical narrative and figures.\n")
        f.write("- Do not change factual values just to reduce similarity; rewrite for specificity, evidence, and project context.\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare multiple bid .docx files for duplicate text/images.")
    parser.add_argument("docx", nargs="+", help="2+ .docx files to compare")
    parser.add_argument("--out", required=True, help="Output report path (markdown)")
    args = parser.parse_args()

    docs = [str(Path(p)) for p in args.docx]
    if len(docs) < 2:
        raise SystemExit("Provide at least 2 .docx files.")

    chunks_by_doc: Dict[str, List[DocxChunk]] = {doc: extract_docx_chunks(doc) for doc in docs}
    images_by_doc: Dict[str, List[DocxImageHash]] = {doc: extract_docx_images(doc) for doc in docs}

    write_report(args.out, docs, chunks_by_doc, images_by_doc)
    print(f"Wrote report -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

