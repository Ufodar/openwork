#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def normalize(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _first_child(element: Any, local_name: str) -> Any | None:
    if element is None:
        return None
    for child in getattr(element, "iterchildren", lambda: [])():
        if getattr(child, "tag", "").endswith(f"}}{local_name}"):
            return child
    return None


def _attribute_value(element: Any) -> str | None:
    if element is None:
        return None
    values = getattr(element, "attrib", {}) or {}
    for key, value in values.items():
        if str(key).endswith("}val"):
            return str(value)
    return None


def _paragraph_outline_level(paragraph: Any) -> int | None:
    paragraph_props = _first_child(getattr(paragraph, "_p", None), "pPr")
    outline = _first_child(paragraph_props, "outlineLvl")
    if outline is not None:
        value = _attribute_value(outline)
        if value is not None and value.isdigit():
            return int(value) + 1

    style = getattr(paragraph, "style", None)
    visited: set[int] = set()
    while style is not None and id(style) not in visited:
        visited.add(id(style))
        style_element = getattr(style, "element", None)
        style_props = _first_child(style_element, "pPr")
        outline = _first_child(style_props, "outlineLvl")
        if outline is not None:
            value = _attribute_value(outline)
            if value is not None and value.isdigit():
                return int(value) + 1
        style = getattr(style, "base_style", None)

    return None


def extract_docx_outline(path: Path) -> list[dict]:
    try:
        from docx import Document
    except Exception as exc:
        raise RuntimeError(f"python-docx unavailable: {exc}") from exc

    document = Document(str(path))
    items: list[dict] = []
    for index, paragraph in enumerate(document.paragraphs, start=1):
        text = normalize(paragraph.text)
        if not text:
            continue

        level = _paragraph_outline_level(paragraph)
        if level is None:
            continue

        items.append(
            {
                "title": text,
                "level": level,
                "locator": f"paragraph:{index}",
            }
        )
    return items


def main() -> int:
    if len(sys.argv) != 2:
        print("[]")
        return 1

    path = Path(sys.argv[1]).expanduser().resolve()
    items = extract_docx_outline(path)
    sys.stdout.write(json.dumps(items, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
