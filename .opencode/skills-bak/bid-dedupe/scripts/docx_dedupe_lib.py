from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from xml.etree import ElementTree as ET


W_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

HEADING_STYLE_HINTS = ("heading", "title", "标题", "Heading", "Title")

HEADING_TEXT_PATTERNS = [
    # Numeric headings (allow "1.1 项目背景" and "1.1项目背景"; avoid matching years like 2025年 by requiring next char not digit).
    re.compile(r"^\s*\d{1,3}(?:\.\d{1,3})*(?!\d)(?:\s*[\-—.、．]?\s*)\S.+$"),
    # Chinese numbered headings: 一、 / 二.
    re.compile(r"^\s*[一二三四五六七八九十]+[、.]\s*.+$"),
    # 第三章 / 第一章 (suffix optional)
    re.compile(r"^\s*第[一二三四五六七八九十百千0-9]+[章节](?:\s*.+)?$"),
    # （一） / (1)
    re.compile(r"^\s*[\(（][一二三四五六七八九十0-9]+[\)）]\s*.+$"),
]


def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8", errors="ignore")).hexdigest()


def normalize_text(text: str) -> str:
    text = text.replace("\u00A0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def tokenize_for_simhash(text: str) -> List[str]:
    # Keep Chinese characters as single-character tokens; keep alphanumerics as word tokens.
    tokens: List[str] = []
    for match in re.finditer(r"[A-Za-z0-9]+|[\u4e00-\u9fff]", text):
        tokens.append(match.group(0).lower())
    return tokens


def simhash64(text: str) -> int:
    tokens = tokenize_for_simhash(text)
    if not tokens:
        return 0

    # Simple frequency weighting
    freq: Dict[str, int] = {}
    for token in tokens:
        freq[token] = freq.get(token, 0) + 1

    vector = [0] * 64
    for token, weight in freq.items():
        h = int(hashlib.md5(token.encode("utf-8", errors="ignore")).hexdigest(), 16)
        # Use lower 64 bits
        h64 = h & ((1 << 64) - 1)
        for i in range(64):
            bit = (h64 >> i) & 1
            vector[i] += weight if bit else -weight

    out = 0
    for i, v in enumerate(vector):
        if v >= 0:
            out |= 1 << i
    return out


def hamming_distance64(a: int, b: int) -> int:
    # int.bit_count() is only available in newer Python versions.
    x = a ^ b
    try:
        return x.bit_count()  # type: ignore[attr-defined]
    except AttributeError:
        return bin(x).count("1")


def _node_text(node: ET.Element) -> str:
    parts: List[str] = []
    for t in node.findall(".//w:t", W_NS):
        if t.text:
            parts.append(t.text)
    return "".join(parts)


def _paragraph_style_val(p: ET.Element) -> Optional[str]:
    ppr = p.find("./w:pPr", W_NS)
    if ppr is None:
        return None
    pstyle = ppr.find("./w:pStyle", W_NS)
    if pstyle is None:
        return None
    for key, value in pstyle.attrib.items():
        # Usually {..}val
        if key.endswith("}val") or key == "w:val" or key.endswith(":val"):
            return value
    return None


def _is_heading(text: str, style_val: Optional[str]) -> bool:
    stripped = text.strip()
    if not stripped:
        return False

    if style_val:
        lowered = style_val.lower()
        if any(h.lower() in lowered for h in HEADING_STYLE_HINTS):
            return True

    # Heuristic headings should be short-ish
    if len(stripped) > 60:
        return False

    # Avoid treating full sentences / list items as headings, which would create
    # overly fragmented chunks (and breaks section boundaries for copy tools).
    if stripped.endswith(("。", "；", ";", "!", "！", "?", "？")):
        return False

    return any(pat.match(stripped) for pat in HEADING_TEXT_PATTERNS)


@dataclass
class DocxChunk:
    title: str
    text: str
    char_count: int
    sha256: str
    simhash: int


def extract_docx_chunks(docx_path: str, *, include_tables: bool = True) -> List[DocxChunk]:
    path = Path(docx_path)
    with zipfile.ZipFile(path) as z:
        xml_bytes = z.read("word/document.xml")

    root = ET.fromstring(xml_bytes)
    body = root.find("w:body", W_NS)
    if body is None:
        return []

    chunks: List[DocxChunk] = []
    current_title = "Untitled"
    current_lines: List[str] = []

    def flush():
        nonlocal current_title, current_lines
        text = "\n".join([line for line in current_lines if line is not None]).strip()
        if not text:
            current_lines = []
            return
        normalized = normalize_text(text)
        chunks.append(
            DocxChunk(
                title=current_title,
                text=text,
                char_count=len(normalized),
                sha256=sha256_hex(normalized),
                simhash=simhash64(normalized),
            )
        )
        current_lines = []

    for child in list(body):
        tag = child.tag
        if tag.endswith("}p"):
            text = _node_text(child)
            style_val = _paragraph_style_val(child)
            if _is_heading(text, style_val):
                flush()
                current_title = normalize_text(text) or "Untitled"
                continue
            if text.strip():
                current_lines.append(normalize_text(text))
            else:
                # blank paragraph: treat as separator
                current_lines.append("")
        elif tag.endswith("}tbl"):
            if not include_tables:
                current_lines.append("")
                continue
            # Flatten table rows into lines
            for tr in child.findall(".//w:tr", W_NS):
                cells: List[str] = []
                for tc in tr.findall("./w:tc", W_NS):
                    cell_text = normalize_text(_node_text(tc))
                    if cell_text:
                        cells.append(cell_text)
                if cells:
                    current_lines.append(" | ".join(cells))
            current_lines.append("")

    flush()
    return chunks


@dataclass
class DocxImageHash:
    name: str
    sha256: str
    size_bytes: int
    dhash: Optional[str] = None


def _compute_dhash(image_bytes: bytes) -> Optional[str]:
    try:
        from PIL import Image  # type: ignore
    except Exception:
        return None

    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = img.convert("L")
        try:
            resample = Image.Resampling.LANCZOS  # Pillow>=9
        except Exception:
            resample = Image.ANTIALIAS  # type: ignore
        img = img.resize((9, 8), resample=resample)
        pixels = list(img.getdata())
        bits = 0
        for row in range(8):
            for col in range(8):
                left = pixels[row * 9 + col]
                right = pixels[row * 9 + col + 1]
                bits = (bits << 1) | (1 if left > right else 0)
        return f"{bits:016x}"
    except Exception:
        return None


def extract_docx_images(docx_path: str) -> List[DocxImageHash]:
    path = Path(docx_path)
    images: List[DocxImageHash] = []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not name.startswith("word/media/"):
                continue
            if name.endswith("/"):
                continue
            data = z.read(name)
            images.append(
                DocxImageHash(
                    name=name,
                    sha256=hashlib.sha256(data).hexdigest(),
                    size_bytes=len(data),
                    dhash=_compute_dhash(data),
                )
            )
    return images


def json_dump(obj: Any, path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
