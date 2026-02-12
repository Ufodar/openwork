#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import itertools
import re
import zipfile
from difflib import SequenceMatcher
from html import escape
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from docx_dedupe_lib import DocxChunk, DocxImageHash, extract_docx_chunks, extract_docx_images, hamming_distance64, normalize_text


def excerpt(text: str, limit: int = 140) -> str:
    t = normalize_text(text)
    if len(t) <= limit:
        return t
    return t[: limit - 1] + "…"


def slugify(value: str) -> str:
    value = value.strip()
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value)
    value = value.strip("-")
    return value or "doc"


def make_unique_labels(paths: List[str]) -> Dict[str, str]:
    used: Dict[str, int] = {}
    out: Dict[str, str] = {}
    for p in paths:
        base = slugify(Path(p).stem or Path(p).name)
        n = used.get(base, 0) + 1
        used[base] = n
        out[p] = base if n == 1 else f"{base}-{n}"
    return out


def export_docx_media(docx_path: str, out_dir: Path, doc_label: str, dhash_by_internal_name: Dict[str, Optional[str]]) -> Dict[str, str]:
    """
    Extract word/media/* files to disk.
    Returns mapping: internalName -> exported relative path (posix).
    """
    target_dir = out_dir / doc_label
    target_dir.mkdir(parents=True, exist_ok=True)

    internal_to_export_rel: Dict[str, str] = {}
    used_names: Dict[str, int] = {}

    with zipfile.ZipFile(docx_path) as z:
        for name in z.namelist():
            if not name.startswith("word/media/"):
                continue
            if name.endswith("/"):
                continue

            data = z.read(name)
            sha = hashlib.sha256(data).hexdigest()
            _ = sha  # keep in scope for debugging if needed

            raw_basename = Path(name).name
            safe_basename = slugify(raw_basename)
            if not Path(safe_basename).suffix and Path(raw_basename).suffix:
                safe_basename = f"{safe_basename}{Path(raw_basename).suffix}"

            n = used_names.get(safe_basename, 0) + 1
            used_names[safe_basename] = n
            filename = safe_basename if n == 1 else f"{Path(safe_basename).stem}-{n}{Path(safe_basename).suffix}"

            file_path = target_dir / filename
            file_path.write_bytes(data)

            internal_to_export_rel[name] = f"{doc_label}/{filename}"

            # Also write a small sidecar json for OCR/dHash workflows (optional)
            # Keeping it minimal: rely on the main markdown + html for human review.
            _ = dhash_by_internal_name.get(name)

    return internal_to_export_rel


def write_media_contact_sheet(out_dir: Path, docs: List[str], doc_folder_labels: Dict[str, str], images_by_doc: Dict[str, List[DocxImageHash]], exported_paths: Dict[Tuple[str, str], str]) -> str:
    """
    Writes out_dir/index.html and returns the path.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "index.html"

    doc_display = {doc: Path(doc).name for doc in docs}

    img_map: Dict[str, List[Tuple[str, DocxImageHash]]] = {}
    dhash_map: Dict[str, List[Tuple[str, DocxImageHash]]] = {}
    for doc, images in images_by_doc.items():
        for img in images:
            img_map.setdefault(img.sha256, []).append((doc, img))
            if img.dhash:
                dhash_map.setdefault(img.dhash, []).append((doc, img))

    exact_groups = [items for _, items in img_map.items() if len(items) > 1]
    exact_groups.sort(key=lambda g: g[0][1].size_bytes, reverse=True)

    near_groups = [items for _, items in dhash_map.items() if len(items) > 1]
    near_groups.sort(key=lambda g: g[0][1].size_bytes, reverse=True)

    def card(doc: str, img: DocxImageHash) -> str:
        rel = exported_paths.get((doc, img.name))
        label = doc_display[doc]
        internal = img.name
        meta = f"{internal} • {img.size_bytes} bytes"
        if not rel:
            return f"""
<div class="card">
  <div class="doc">{escape(label)}</div>
  <div class="missing">(not exported)</div>
  <div class="meta">{escape(meta)}</div>
</div>
"""
        return f"""
<div class="card">
  <div class="doc">{escape(label)}</div>
  <a class="img" href="{escape(rel)}" target="_blank" rel="noreferrer">
    <img src="{escape(rel)}" loading="lazy" alt="{escape(internal)}" />
  </a>
  <div class="meta">{escape(meta)}</div>
</div>
"""

    html = [
        "<!doctype html>",
        "<html>",
        "<head>",
        "  <meta charset=\"utf-8\" />",
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
        "  <title>Bid media dedupe</title>",
        "  <style>",
        "    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; margin:24px; color:#111}",
        "    h1{font-size:20px; margin:0 0 8px 0}",
        "    .hint{color:#555; font-size:12px; margin:0 0 18px 0}",
        "    h2{font-size:16px; margin:18px 0 8px 0}",
        "    h3{font-size:13px; margin:16px 0 8px 0; color:#222}",
        "    .grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px}",
        "    .card{border:1px solid #ddd; border-radius:10px; padding:10px; background:#fff}",
        "    .doc{font-size:12px; font-weight:600; margin-bottom:6px}",
        "    .img{display:block; border-radius:8px; overflow:hidden; background:#fafafa; border:1px solid #eee}",
        "    img{width:100%; height:160px; object-fit:contain; display:block}",
        "    .meta{font-size:11px; color:#666; margin-top:6px; word-break:break-all}",
        "    .missing{font-size:11px; color:#999; height:160px; display:flex; align-items:center; justify-content:center; border:1px dashed #ddd; border-radius:8px}",
        "  </style>",
        "</head>",
        "<body>",
        "  <h1>Bid media contact sheet</h1>",
        "  <p class=\"hint\">Generated from .docx embedded media. Focus on duplicate images across different bids to reduce 串标 risk. Some formats (EMF/WMF) may not render in the browser.</p>",
    ]

    html.append("  <h2>Exact duplicate images (SHA256)</h2>")
    if not exact_groups:
        html.append("  <p class=\"hint\">None found.</p>")
    else:
        for group in exact_groups[:80]:
            sha = group[0][1].sha256
            html.append(f"  <h3>SHA256 {escape(sha[:12])}… (n={len(group)})</h3>")
            html.append("  <div class=\"grid\">")
            for doc, img in group:
                html.append(card(doc, img))
            html.append("  </div>")

    html.append("  <h2>Near-duplicate images (dHash)</h2>")
    if not near_groups:
        html.append("  <p class=\"hint\">None found (or Pillow not installed, so dHash is unavailable).</p>")
    else:
        for group in near_groups[:80]:
            dh = group[0][1].dhash or ""
            html.append(f"  <h3>dHash {escape(dh)} (n={len(group)})</h3>")
            html.append("  <div class=\"grid\">")
            for doc, img in group:
                html.append(card(doc, img))
            html.append("  </div>")

    html.append("</body>")
    html.append("</html>")

    out_path.write_text("\n".join(html), encoding="utf-8")
    return str(out_path)


def write_report(
    out_path: str,
    docs: List[str],
    chunks_by_doc: Dict[str, List[DocxChunk]],
    images_by_doc: Dict[str, List[DocxImageHash]],
    media_dir: Optional[str] = None,
) -> None:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    doc_labels = {doc: Path(doc).name for doc in docs}
    doc_folder_labels = make_unique_labels(docs)

    exported_paths: Dict[Tuple[str, str], str] = {}
    contact_sheet_path: Optional[str] = None
    if media_dir:
        media_out = Path(media_dir)
        dhash_lookup = {
            doc: {img.name: img.dhash for img in images_by_doc.get(doc, [])}
            for doc in docs
        }
        for doc in docs:
            folder = doc_folder_labels[doc]
            rel_map = export_docx_media(doc, media_out, folder, dhash_lookup.get(doc, {}))
            for internal_name, rel in rel_map.items():
                exported_paths[(doc, internal_name)] = rel

        contact_sheet_path = write_media_contact_sheet(media_out, docs, doc_folder_labels, images_by_doc, exported_paths)

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

        if contact_sheet_path:
            f.write("\n## Media exports\n\n")
            f.write(f"- Contact sheet (HTML): `{contact_sheet_path}`\n")

        f.write("\n## Exact duplicate images (highest risk)\n\n")
        if not exact_image_groups:
            f.write("- None found.\n")
        else:
            for group in exact_image_groups[:50]:
                f.write(f"- SHA256 `{group[0][1].sha256[:12]}…` ({group[0][1].size_bytes} bytes)\n")
                for doc, img in group:
                    exported = exported_paths.get((doc, img.name))
                    suffix = f" → `{exported}`" if exported else ""
                    f.write(f"  - {doc_labels[doc]}: `{img.name}`{suffix}\n")

        f.write("\n## Near-duplicate images (dHash)\n\n")
        if not near_image_groups:
            f.write("- None found (or Pillow not installed).\n")
        else:
            for group in near_image_groups[:50]:
                f.write(f"- dHash `{group[0][1].dhash}`\n")
                for doc, img in group:
                    exported = exported_paths.get((doc, img.name))
                    suffix = f" → `{exported}`" if exported else ""
                    f.write(f"  - {doc_labels[doc]}: `{img.name}`{suffix} (sha `{img.sha256[:12]}…`)\n")

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
    parser.add_argument(
        "--media-dir",
        help="If set, export embedded media to this directory and write an HTML contact sheet (index.html) for human review.",
    )
    args = parser.parse_args()

    docs = [str(Path(p)) for p in args.docx]
    if len(docs) < 2:
        raise SystemExit("Provide at least 2 .docx files.")

    chunks_by_doc: Dict[str, List[DocxChunk]] = {doc: extract_docx_chunks(doc) for doc in docs}
    images_by_doc: Dict[str, List[DocxImageHash]] = {doc: extract_docx_images(doc) for doc in docs}

    write_report(args.out, docs, chunks_by_doc, images_by_doc, media_dir=args.media_dir)
    print(f"Wrote report -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
