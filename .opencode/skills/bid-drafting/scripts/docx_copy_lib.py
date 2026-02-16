"""Cross-document section copy library for DOCX files.

Copies a heading-delimited section from one DOCX to another while preserving
formatting, images, styles, and numbering. Works at the OOXML (ZIP + XML)
level.

Security note: DOCX inputs are untrusted. XML parsing uses `defusedxml`.

Usage:
    from docx_copy_lib import list_headings, copy_section
"""

from __future__ import annotations

import copy
import hashlib
import os
import re
import secrets
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from xml.etree import ElementTree as ET

from defusedxml import ElementTree as DET

# ---------------------------------------------------------------------------
# XML namespaces used in OOXML Word documents
# ---------------------------------------------------------------------------

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
    "w14": "http://schemas.microsoft.com/office/word/2010/wordml",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "v": "urn:schemas-microsoft-com:vml",
}

# Register all namespaces so ET.tostring preserves prefixes
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)

# Also register common namespaces that appear in DOCX but we don't query
_EXTRA_NS = {
    "wpc": "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
    "cx": "http://schemas.microsoft.com/office/drawing/2014/chartex",
    "cx1": "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex",
    "w15": "http://schemas.microsoft.com/office/word/2012/wordml",
    "w16se": "http://schemas.microsoft.com/office/word/2015/wordml/symex",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "wne": "http://schemas.microsoft.com/office/word/2006/wordml",
    "wp14": "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing14",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "o": "urn:schemas-microsoft-com:office:office",
}
for prefix, uri in _EXTRA_NS.items():
    ET.register_namespace(prefix, uri)

W_TAG_P = f"{{{NS['w']}}}p"
W_TAG_TBL = f"{{{NS['w']}}}tbl"
W_TAG_SECTPR = f"{{{NS['w']}}}sectPr"

# ---------------------------------------------------------------------------
# Heading detection (reuses logic from docx_dedupe_lib)
# ---------------------------------------------------------------------------

HEADING_STYLE_HINTS = ("heading", "title", "标题", "Heading", "Title", "TOC")

HEADING_TEXT_PATTERNS: List[Tuple[re.Pattern, int]] = [
    # 第X部分 → level 1
    (re.compile(r"^\s*第[一二三四五六七八九十百千\d]+部分(?:\s*.+)?$"), 1),
    # 第X章 → level 1
    (re.compile(r"^\s*第[一二三四五六七八九十百千\d]+章(?:\s*.+)?$"), 1),
    # 第X节 → level 2
    (re.compile(r"^\s*第[一二三四五六七八九十百千\d]+节(?:\s*.+)?$"), 2),
    # 一、 / 二. → level 2
    (re.compile(r"^\s*[一二三四五六七八九十]+[、.]\s*.+$"), 2),
    # （一） / (1) → level 3
    (re.compile(r"^\s*[\(（][一二三四五六七八九十\d]+[\)）]\s*.+$"), 3),
    # 1.2.3 style → level = dot_count + 1
    # Supports both "1.1 项目背景" and "1.1项目背景".
    # Limit the first segment to 1-3 digits to avoid misclassifying dates like 2025年...
    # Also require the number prefix not to be immediately followed by another digit
    # (so "2025年..." won't match by capturing only "202").
    (re.compile(r"^\s*(\d{1,3}(?:\.\d{1,3})*)(?!\d)(?:\s*[\-—.、．]?\s*)\S.+$"), -1),  # -1 = dynamic
]


def _node_text(node: ET.Element) -> str:
    """Extract concatenated w:t text from a paragraph or run."""
    parts: List[str] = []
    for t in node.iter(f"{{{NS['w']}}}t"):
        if t.text:
            parts.append(t.text)
    return "".join(parts)


def _paragraph_style_val(p: ET.Element) -> Optional[str]:
    ppr = p.find("w:pPr", NS)
    if ppr is None:
        return None
    pstyle = ppr.find("w:pStyle", NS)
    if pstyle is None:
        return None
    return pstyle.get(f"{{{NS['w']}}}val") or pstyle.get("w:val") or pstyle.attrib.get(
        next((k for k in pstyle.attrib if k.endswith("}val") or k.endswith(":val")), ""), None
    )


def _heading_level(text: str, style_val: Optional[str]) -> Optional[int]:
    """Return heading level (1-based) or None if not a heading."""
    stripped = text.strip()
    if not stripped:
        return None

    # Style-based detection
    if style_val:
        lowered = style_val.lower()
        # HeadingN / heading N / 标题 N
        for hint in HEADING_STYLE_HINTS:
            if hint.lower() in lowered:
                # Try to extract the level number
                m = re.search(r"(\d+)", style_val)
                if m:
                    return int(m.group(1))
                return 1  # Style says heading but no number → level 1

    # Avoid treating full sentences / list items as headings.
    # This is especially important for tender documents where requirements are
    # written as numbered sentences ending with "；"/"。" which would otherwise
    # break section boundaries (elementCount becomes 0 for real headings).
    if stripped.endswith(("。", "；", ";", "!", "！", "?", "？")):
        return None

    # Too long to be a heading (heuristic)
    if len(stripped) > 80:
        return None

    # Pattern-based detection
    for pat, level in HEADING_TEXT_PATTERNS:
        m = pat.match(stripped)
        if m:
            if level == -1:
                # Dynamic: count dots in the number prefix
                number_part = m.group(1)
                return number_part.count(".") + 1
            return level

    return None


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class HeadingInfo:
    level: int
    text: str
    element_count: int  # number of body children in this section
    index: int  # position in body children list


@dataclass
class SectionBounds:
    start: int  # inclusive index in body children
    end: int  # exclusive index in body children
    heading: HeadingInfo


@dataclass
class DependencySet:
    rel_ids: Set[str] = field(default_factory=set)
    style_ids: Set[str] = field(default_factory=set)
    num_ids: Set[str] = field(default_factory=set)
    bookmark_ids: Set[str] = field(default_factory=set)


@dataclass
class CopyResult:
    paragraphs: int = 0
    tables: int = 0
    images: int = 0
    styles: int = 0
    warnings: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Heading listing
# ---------------------------------------------------------------------------

def list_headings(docx_path: str) -> List[HeadingInfo]:
    """List all headings in a DOCX file with their levels and element counts."""
    with zipfile.ZipFile(docx_path) as z:
        doc_xml = z.read("word/document.xml")

    root = DET.fromstring(doc_xml)
    body = root.find("w:body", NS)
    if body is None:
        return []

    children = list(body)
    headings: List[HeadingInfo] = []

    for i, child in enumerate(children):
        tag = child.tag
        if tag == W_TAG_P:
            text = _node_text(child)
            style = _paragraph_style_val(child)
            level = _heading_level(text, style)
            if level is not None:
                headings.append(HeadingInfo(level=level, text=text.strip(), element_count=0, index=i))
        # Tables and other elements are not headings

    # Calculate element counts (elements between this heading and the next)
    for idx, h in enumerate(headings):
        if idx + 1 < len(headings):
            h.element_count = headings[idx + 1].index - h.index - 1
        else:
            # Last heading: count to end of body (excluding sectPr)
            end = len(children)
            if children and children[-1].tag == W_TAG_SECTPR:
                end -= 1
            h.element_count = end - h.index - 1

    return headings


# ---------------------------------------------------------------------------
# Section boundary detection
# ---------------------------------------------------------------------------

def _find_section(headings: List[HeadingInfo], heading_text: str,
                  match_mode: str = "contains",
                  match_index: Optional[int] = None) -> Optional[HeadingInfo]:
    """Find a heading by text, optionally selecting a specific match.

    match_mode: 'exact', 'contains', 'startswith'
    match_index: 1-based index into matches (useful when multiple headings match)
    """
    matches: List[HeadingInfo] = []
    for h in headings:
        if match_mode == "exact" and h.text == heading_text:
            matches.append(h)
        elif match_mode == "contains" and heading_text in h.text:
            matches.append(h)
        elif match_mode == "startswith" and h.text.startswith(heading_text):
            matches.append(h)

    if not matches:
        return None

    if match_index is not None:
        if match_index < 1 or match_index > len(matches):
            raise ValueError(
                f"Heading match index out of range: {match_index} (matches={len(matches)}). "
                f"Use --list-headings to inspect available headings."
            )
        return matches[match_index - 1]

    if len(matches) == 1:
        return matches[0]

    preview = "; ".join(f"[{m.level}] {m.text}" for m in matches[:8])
    more = "" if len(matches) <= 8 else f" (+{len(matches) - 8} more)"
    raise ValueError(
        f"Ambiguous heading match for '{heading_text}' (mode={match_mode}). "
        f"Matches: {preview}{more}. "
        "Provide a more specific --*-heading string or use --*-heading-index."
    )


def _section_bounds(headings: List[HeadingInfo], target: HeadingInfo,
                    total_children: int, has_final_sectpr: bool) -> SectionBounds:
    """Get the start/end indices for a section (heading to next same-or-higher level)."""
    start = target.index
    end = total_children
    if has_final_sectpr:
        end -= 1  # Exclude final sectPr

    target_idx = headings.index(target)
    for h in headings[target_idx + 1:]:
        if h.level <= target.level:
            end = h.index
            break

    return SectionBounds(start=start, end=end, heading=target)


# ---------------------------------------------------------------------------
# Dependency scanning
# ---------------------------------------------------------------------------

def _scan_dependencies(elements: List[ET.Element]) -> DependencySet:
    """Scan XML elements for referenced resource IDs."""
    deps = DependencySet()

    for elem in elements:
        xml_str = ET.tostring(elem, encoding="unicode")

        # Relationship IDs (r:id, r:embed, r:link)
        for m in re.finditer(r'r:(?:id|embed|link)="(rId\d+)"', xml_str):
            deps.rel_ids.add(m.group(1))

        # Style references
        for child in elem.iter():
            tag = child.tag
            if tag.endswith("}pStyle") or tag.endswith("}rStyle") or tag.endswith("}tblStyle"):
                val = child.get(f"{{{NS['w']}}}val")
                if val:
                    deps.style_ids.add(val)

        # Numbering references
        for numid_elem in elem.iter(f"{{{NS['w']}}}numId"):
            val = numid_elem.get(f"{{{NS['w']}}}val")
            if val and val != "0":
                deps.num_ids.add(val)

        # Bookmark IDs
        for bm in elem.iter(f"{{{NS['w']}}}bookmarkStart"):
            bid = bm.get(f"{{{NS['w']}}}id")
            if bid:
                deps.bookmark_ids.add(bid)
        for bm in elem.iter(f"{{{NS['w']}}}bookmarkEnd"):
            bid = bm.get(f"{{{NS['w']}}}id")
            if bid:
                deps.bookmark_ids.add(bid)

    return deps


# ---------------------------------------------------------------------------
# ID remapping
# ---------------------------------------------------------------------------

def _max_numeric_id(xml_bytes: bytes, pattern: str) -> int:
    """Find the maximum numeric ID matching a regex pattern in XML content."""
    text = xml_bytes.decode("utf-8", errors="ignore")
    ids = [int(m.group(1)) for m in re.finditer(pattern, text)]
    return max(ids) if ids else 0


def _build_rel_id_map(source_rel_ids: Set[str], target_rels_xml: bytes) -> Dict[str, str]:
    """Map source rIds to new rIds that don't conflict with the target."""
    max_id = _max_numeric_id(target_rels_xml, r'Id="rId(\d+)"')
    mapping: Dict[str, str] = {}
    counter = max_id + 1
    for old_id in sorted(source_rel_ids):
        mapping[old_id] = f"rId{counter}"
        counter += 1
    return mapping


def _build_num_id_map(source_num_ids: Set[str], target_numbering_xml: Optional[bytes]) -> Dict[str, str]:
    """Map source numIds to new numIds that don't conflict."""
    max_id = 0
    if target_numbering_xml:
        max_id = max(
            _max_numeric_id(target_numbering_xml, r'w:numId="(\d+)"'),
            _max_numeric_id(target_numbering_xml, r'w:val="(\d+)"'),
        )
    mapping: Dict[str, str] = {}
    counter = max_id + 1
    for old_id in sorted(source_num_ids, key=lambda x: int(x) if x.isdigit() else 0):
        mapping[old_id] = str(counter)
        counter += 1
    return mapping


def _build_bookmark_id_map(source_bm_ids: Set[str], target_doc_xml: bytes) -> Dict[str, str]:
    """Map source bookmark IDs to non-conflicting ones."""
    max_id = _max_numeric_id(target_doc_xml, r'w:id="(\d+)"')
    mapping: Dict[str, str] = {}
    counter = max_id + 1
    for old_id in sorted(source_bm_ids, key=lambda x: int(x) if x.isdigit() else 0):
        mapping[old_id] = str(counter)
        counter += 1
    return mapping


def _remap_element(elem: ET.Element, rel_map: Dict[str, str],
                   num_map: Dict[str, str], bm_map: Dict[str, str]) -> None:
    """Apply ID remapping to a deep-copied element, in place."""
    for node in elem.iter():
        # Remap relationship IDs
        for attr_name in list(node.attrib.keys()):
            if attr_name.endswith("}id") or attr_name.endswith("}embed") or attr_name.endswith("}link"):
                old_val = node.attrib[attr_name]
                if old_val in rel_map:
                    node.attrib[attr_name] = rel_map[old_val]

        # Remap numId
        if node.tag.endswith("}numId"):
            val = node.get(f"{{{NS['w']}}}val")
            if val and val in num_map:
                node.set(f"{{{NS['w']}}}val", num_map[val])

        # Remap bookmark IDs
        if node.tag.endswith("}bookmarkStart") or node.tag.endswith("}bookmarkEnd"):
            bid = node.get(f"{{{NS['w']}}}id")
            if bid and bid in bm_map:
                node.set(f"{{{NS['w']}}}id", bm_map[bid])

        # Regenerate w14:paraId and w14:textId
        w14_paraid = f"{{{NS['w14']}}}paraId"
        w14_textid = f"{{{NS['w14']}}}textId"
        if w14_paraid in node.attrib:
            node.attrib[w14_paraid] = f"{secrets.randbelow(0x7FFFFFFF):08X}"
        if w14_textid in node.attrib:
            node.attrib[w14_textid] = f"{secrets.randbelow(0x7FFFFFFF):08X}"


# ---------------------------------------------------------------------------
# Style merging
# ---------------------------------------------------------------------------

def _merge_styles(source_zip: zipfile.ZipFile, target_zip_path: str,
                  style_ids: Set[str], work_dir: str) -> int:
    """Copy missing styles from source to target. Returns count of styles added."""
    try:
        source_styles_xml = source_zip.read("word/styles.xml")
    except KeyError:
        return 0

    target_styles_path = os.path.join(work_dir, "word", "styles.xml")
    if not os.path.exists(target_styles_path):
        return 0

    source_root = DET.fromstring(source_styles_xml)
    target_tree = DET.parse(target_styles_path)
    target_root = target_tree.getroot()

    # Build set of existing style IDs in target
    existing_ids: Set[str] = set()
    for style_elem in target_root.findall("w:style", NS):
        sid = style_elem.get(f"{{{NS['w']}}}styleId")
        if sid:
            existing_ids.add(sid)

    # Collect styles to copy (including basedOn chain)
    to_copy: Set[str] = set()
    queue = list(style_ids)
    while queue:
        sid = queue.pop()
        if sid in to_copy or sid in existing_ids:
            continue
        to_copy.add(sid)
        # Find the style in source and check basedOn
        for s in source_root.findall("w:style", NS):
            if s.get(f"{{{NS['w']}}}styleId") == sid:
                based_on = s.find("w:basedOn", NS)
                if based_on is not None:
                    parent_id = based_on.get(f"{{{NS['w']}}}val")
                    if parent_id and parent_id not in existing_ids:
                        queue.append(parent_id)
                break

    # Copy styles
    added = 0
    for sid in to_copy:
        for s in source_root.findall("w:style", NS):
            if s.get(f"{{{NS['w']}}}styleId") == sid:
                target_root.append(copy.deepcopy(s))
                added += 1
                break

    if added > 0:
        target_tree.write(target_styles_path, xml_declaration=True, encoding="UTF-8")

    return added


# ---------------------------------------------------------------------------
# Numbering merging
# ---------------------------------------------------------------------------

def _merge_numbering(source_zip: zipfile.ZipFile, target_zip_path: str,
                     num_ids: Set[str], num_map: Dict[str, str],
                     work_dir: str) -> int:
    """Copy referenced numbering definitions from source to target."""
    try:
        source_num_xml = source_zip.read("word/numbering.xml")
    except KeyError:
        return 0

    target_num_path = os.path.join(work_dir, "word", "numbering.xml")
    if not os.path.exists(target_num_path):
        # Create a minimal numbering.xml
        with open(target_num_path, "w", encoding="utf-8") as f:
            f.write('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n')
            f.write(f'<w:numbering xmlns:w="{NS["w"]}">\n</w:numbering>\n')

    source_root = DET.fromstring(source_num_xml)
    target_tree = DET.parse(target_num_path)
    target_root = target_tree.getroot()

    # Find max abstractNumId in target
    max_abstract = 0
    for an in target_root.findall("w:abstractNum", NS):
        aid = an.get(f"{{{NS['w']}}}abstractNumId")
        if aid:
            max_abstract = max(max_abstract, int(aid))

    added = 0
    abstract_map: Dict[str, str] = {}

    # Copy abstractNum definitions referenced by our numIds
    for num_id in num_ids:
        # Find the w:num element in source
        for num_elem in source_root.findall("w:num", NS):
            if num_elem.get(f"{{{NS['w']}}}numId") == num_id:
                # Get the abstractNumId it references
                abstract_ref = num_elem.find("w:abstractNumId", NS)
                if abstract_ref is not None:
                    old_abstract_id = abstract_ref.get(f"{{{NS['w']}}}val")
                    if old_abstract_id and old_abstract_id not in abstract_map:
                        # Copy the abstractNum
                        for abstract_elem in source_root.findall("w:abstractNum", NS):
                            if abstract_elem.get(f"{{{NS['w']}}}abstractNumId") == old_abstract_id:
                                max_abstract += 1
                                new_abstract = copy.deepcopy(abstract_elem)
                                new_abstract.set(f"{{{NS['w']}}}abstractNumId", str(max_abstract))
                                target_root.append(new_abstract)
                                abstract_map[old_abstract_id] = str(max_abstract)
                                added += 1
                                break

                # Copy the w:num element with remapped IDs
                new_num = copy.deepcopy(num_elem)
                new_num_id = num_map.get(num_id, num_id)
                new_num.set(f"{{{NS['w']}}}numId", new_num_id)
                # Update abstractNumId reference
                new_abstract_ref = new_num.find("w:abstractNumId", NS)
                if new_abstract_ref is not None:
                    old_aid = new_abstract_ref.get(f"{{{NS['w']}}}val")
                    if old_aid and old_aid in abstract_map:
                        new_abstract_ref.set(f"{{{NS['w']}}}val", abstract_map[old_aid])
                target_root.append(new_num)
                added += 1
                break

    if added > 0:
        target_tree.write(target_num_path, xml_declaration=True, encoding="UTF-8")

    return added


# ---------------------------------------------------------------------------
# Image / media copying
# ---------------------------------------------------------------------------

def _copy_images(source_zip: zipfile.ZipFile, work_dir: str,
                 source_rels_root: ET.Element, rel_map: Dict[str, str],
                 deps: DependencySet) -> Tuple[int, List[str]]:
    """Copy referenced images from source to target work directory.

    Returns (count_copied, list_of_warnings).
    """
    copied = 0
    warnings: List[str] = []
    target_media_dir = os.path.join(work_dir, "word", "media")
    os.makedirs(target_media_dir, exist_ok=True)

    # Build a set of existing image hashes in target
    existing_hashes: Dict[str, str] = {}  # sha256 -> filename
    if os.path.isdir(target_media_dir):
        for fname in os.listdir(target_media_dir):
            fpath = os.path.join(target_media_dir, fname)
            if os.path.isfile(fpath):
                with open(fpath, "rb") as f:
                    h = hashlib.sha256(f.read()).hexdigest()
                    existing_hashes[h] = fname

    # Find image relationships in source
    rels_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    image_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    hyperlink_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"

    # Build target rels file path and parse it
    target_rels_path = os.path.join(work_dir, "word", "_rels", "document.xml.rels")
    if os.path.exists(target_rels_path):
        target_rels_tree = DET.parse(target_rels_path)
        target_rels_root = target_rels_tree.getroot()
    else:
        os.makedirs(os.path.dirname(target_rels_path), exist_ok=True)
        target_rels_root = ET.Element(f"{{{rels_ns}}}Relationships")
        target_rels_tree = ET.ElementTree(target_rels_root)

    for rel in source_rels_root:
        old_id = rel.get("Id", "")
        if old_id not in deps.rel_ids:
            continue

        rel_type = rel.get("Type", "")
        target_path = rel.get("Target", "")

        if rel_type != image_type:
            # Only copy safe non-image relationships (external hyperlinks).
            if rel_type != hyperlink_type:
                continue
            if old_id in rel_map:
                new_rel = ET.SubElement(target_rels_root, f"{{{rels_ns}}}Relationship")
                new_rel.set("Id", rel_map[old_id])
                new_rel.set("Type", rel_type)
                new_rel.set("Target", target_path)
                if rel.get("TargetMode"):
                    new_rel.set("TargetMode", rel.get("TargetMode", ""))
            continue

        # It's an image — copy the file
        source_media_path = f"word/{target_path}" if not target_path.startswith("word/") else target_path
        # Normalize path (remove leading ../ if present)
        if target_path.startswith("../"):
            source_media_path = target_path[3:]
        elif not target_path.startswith("word/"):
            source_media_path = f"word/{target_path}"
        else:
            source_media_path = target_path

        try:
            image_data = source_zip.read(source_media_path)
        except KeyError:
            warnings.append(f"Image not found in source: {source_media_path}")
            continue

        # Check if identical image already exists in target
        img_hash = hashlib.sha256(image_data).hexdigest()
        if img_hash in existing_hashes:
            # Reuse existing image
            existing_name = existing_hashes[img_hash]
            dest_target = f"media/{existing_name}"
        else:
            # Determine destination filename
            base_name = os.path.basename(target_path)
            dest_file = os.path.join(target_media_dir, base_name)
            if os.path.exists(dest_file):
                # Add suffix to avoid conflict
                name, ext = os.path.splitext(base_name)
                counter = 1
                while os.path.exists(dest_file):
                    base_name = f"{name}_{counter}{ext}"
                    dest_file = os.path.join(target_media_dir, base_name)
                    counter += 1

            with open(dest_file, "wb") as f:
                f.write(image_data)
            existing_hashes[img_hash] = base_name
            dest_target = f"media/{base_name}"
            copied += 1

        # Add relationship entry in target
        if old_id in rel_map:
            new_rel = ET.SubElement(target_rels_root, f"{{{rels_ns}}}Relationship")
            new_rel.set("Id", rel_map[old_id])
            new_rel.set("Type", image_type)
            new_rel.set("Target", dest_target)

    # Write updated rels. Use the default namespace (no prefixes) to match
    # Word/OOXML conventions and minimize compatibility risk.
    ET.register_namespace("", rels_ns)
    try:
        target_rels_tree.write(target_rels_path, xml_declaration=True, encoding="UTF-8")
    finally:
        ET.register_namespace("pr", rels_ns)

    return copied, warnings


# ---------------------------------------------------------------------------
# Content Types update
# ---------------------------------------------------------------------------

def _update_content_types(work_dir: str) -> None:
    """Ensure [Content_Types].xml has entries for all media file extensions."""
    ct_path = os.path.join(work_dir, "[Content_Types].xml")
    if not os.path.exists(ct_path):
        return

    tree = DET.parse(ct_path)
    root = tree.getroot()
    ct_ns = "http://schemas.openxmlformats.org/package/2006/content-types"

    # Collect existing extensions
    existing_exts: Set[str] = set()
    for default in root.findall(f"{{{ct_ns}}}Default"):
        ext = default.get("Extension", "").lower()
        if ext:
            existing_exts.add(ext)

    # Extension -> MIME type mapping
    ext_mime = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "bmp": "image/bmp",
        "tiff": "image/tiff",
        "tif": "image/tiff",
        "emf": "image/x-emf",
        "wmf": "image/x-wmf",
        "svg": "image/svg+xml",
    }

    # Check media directory for new extensions
    media_dir = os.path.join(work_dir, "word", "media")
    if os.path.isdir(media_dir):
        for fname in os.listdir(media_dir):
            ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
            if ext and ext not in existing_exts and ext in ext_mime:
                elem = ET.SubElement(root, f"{{{ct_ns}}}Default")
                elem.set("Extension", ext)
                elem.set("ContentType", ext_mime[ext])
                existing_exts.add(ext)

    # Write using the default namespace (no prefixes) to match OOXML conventions.
    ET.register_namespace("", ct_ns)
    try:
        tree.write(ct_path, xml_declaration=True, encoding="UTF-8")
    finally:
        ET.register_namespace("ct", ct_ns)


# ---------------------------------------------------------------------------
# Main copy operation
# ---------------------------------------------------------------------------

def copy_section(source_path: str, target_path: str, output_path: str,
                 source_heading: str, target_heading: Optional[str] = None,
                 match_mode: str = "contains",
                 source_heading_index: Optional[int] = None,
                 target_heading_index: Optional[int] = None,
                 exclude_source_heading: bool = False) -> CopyResult:
    """Copy a section from source DOCX to target DOCX.

    Args:
        source_path: Path to source .docx
        target_path: Path to target .docx
        output_path: Path to write the result .docx
        source_heading: Text to match the source section heading
        source_heading_index: 1-based index for disambiguating heading matches.
        target_heading: Text to match insertion point in target (insert after this heading's section).
                       If None, append at the end.
        target_heading_index: 1-based index for disambiguating target heading matches.
        match_mode: 'exact', 'contains', or 'startswith'
        exclude_source_heading: If true, copy section content without the source heading paragraph.

    Returns:
        CopyResult with counts and warnings.
    """
    result = CopyResult()

    # --- Parse source ---
    with zipfile.ZipFile(source_path, "r") as source_zip:
        return _copy_section_impl(source_zip, source_path, target_path, output_path,
                                  source_heading, target_heading, match_mode, result,
                                  source_heading_index, target_heading_index,
                                  exclude_source_heading)


def _copy_section_impl(source_zip: zipfile.ZipFile, source_path: str,
                       target_path: str, output_path: str,
                       source_heading: str, target_heading: Optional[str],
                       match_mode: str, result: CopyResult,
                       source_heading_index: Optional[int],
                       target_heading_index: Optional[int],
                       exclude_source_heading: bool) -> CopyResult:
    """Internal implementation of copy_section with source_zip already open."""
    source_doc_xml = source_zip.read("word/document.xml")
    source_root = DET.fromstring(source_doc_xml)
    source_body = source_root.find("w:body", NS)
    if source_body is None:
        raise ValueError("Source document has no body element")

    source_children = list(source_body)
    source_headings = list_headings(source_path)

    # Find source section
    source_h = _find_section(source_headings, source_heading, match_mode, source_heading_index)
    if source_h is None:
        raise ValueError(f"Heading '{source_heading}' not found in source document. "
                         f"Available: {[h.text for h in source_headings]}")

    has_final_sectpr = bool(source_children) and source_children[-1].tag == W_TAG_SECTPR
    bounds = _section_bounds(source_headings, source_h, len(source_children), has_final_sectpr)

    # Extract section elements (excluding sectPr)
    section_elements: List[ET.Element] = []
    for i in range(bounds.start + (1 if exclude_source_heading else 0), bounds.end):
        child = source_children[i]
        if child.tag == W_TAG_SECTPR:
            continue
        section_elements.append(child)

    if not section_elements:
        raise ValueError(f"Section '{source_heading}' is empty in source document")

    # Strip section properties embedded in paragraph properties.
    #
    # These often reference header/footer parts via relationships (r:id) which we
    # intentionally do not copy across documents. Keeping them would either:
    # - trigger "unsupported relationship" errors, or
    # - risk producing a corrupt output if we attempted to copy them partially.
    #
    # For cross-document section copy, dropping embedded sectPr is the safer
    # default (the target document's section settings remain in effect).
    stripped_sectpr = 0
    for elem in section_elements:
        for p in elem.iter(W_TAG_P):
            ppr = p.find("w:pPr", NS)
            if ppr is None:
                continue
            for sectpr in list(ppr.findall("w:sectPr", NS)):
                ppr.remove(sectpr)
                stripped_sectpr += 1
    if stripped_sectpr:
        result.warnings.append(
            f"Stripped {stripped_sectpr} embedded section properties (w:sectPr) from copied content "
            "to avoid unsafe header/footer relationships."
        )

    # Count paragraphs and tables
    for elem in section_elements:
        if elem.tag == W_TAG_P:
            result.paragraphs += 1
        elif elem.tag == W_TAG_TBL:
            result.tables += 1

    # --- Scan dependencies ---
    deps = _scan_dependencies(section_elements)

    # --- Validate unsupported constructs early (avoid corrupt output) ---
    section_xml = "".join(ET.tostring(e, encoding="unicode") for e in section_elements)
    if "footnoteReference" in section_xml:
        raise ValueError("Section contains footnotes (w:footnoteReference). Footnotes are not supported by this copier.")
    if "endnoteReference" in section_xml:
        raise ValueError("Section contains endnotes (w:endnoteReference). Endnotes are not supported by this copier.")
    if "commentReference" in section_xml or "commentRangeStart" in section_xml or "commentRangeEnd" in section_xml:
        raise ValueError("Section contains comments (w:comment*). Comments are not supported by this copier.")
    if "altChunk" in section_xml:
        raise ValueError("Section contains altChunk content. altChunk is not supported by this copier.")

    # Relationship types validation (images + external hyperlinks only)
    image_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    hyperlink_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
    allowed_rel_types = {image_type, hyperlink_type}

    try:
        source_rels_xml = source_zip.read("word/_rels/document.xml.rels")
        source_rels_root = DET.fromstring(source_rels_xml)
    except KeyError:
        source_rels_root = ET.Element("Relationships")

    rel_by_id: Dict[str, Dict[str, str]] = {}
    for rel in list(source_rels_root):
        rid = rel.get("Id")
        if not rid:
            continue
        rel_by_id[rid] = {
            "Type": rel.get("Type", ""),
            "Target": rel.get("Target", ""),
            "TargetMode": rel.get("TargetMode", ""),
        }

    unsupported: Dict[str, str] = {}
    for rid in sorted(deps.rel_ids):
        info = rel_by_id.get(rid)
        if not info:
            unsupported[rid] = "missing relationship entry"
            continue
        rtype = info.get("Type", "")
        if rtype not in allowed_rel_types:
            unsupported[rid] = rtype or "unknown relationship type"
            continue

        # Disallow external/linked images. We only support embedded images that
        # exist as parts inside the DOCX package.
        if rtype == image_type:
            target_mode = (info.get("TargetMode") or "").strip()
            target = (info.get("Target") or "").strip()
            if target_mode.lower() == "external" or target.startswith(("http://", "https://")):
                unsupported[rid] = f"{rtype} (external target)"
                continue
            if target.startswith("../../") or target.startswith("..\\.."):
                unsupported[rid] = f"{rtype} (suspicious relative target: {target})"
                continue

    if unsupported:
        details = "; ".join(f"{rid}:{rtype}" for rid, rtype in list(unsupported.items())[:12])
        more = "" if len(unsupported) <= 12 else f" (+{len(unsupported) - 12} more)"
        raise ValueError(
            "Section contains unsupported embedded objects/relationships (not copied). "
            f"Only images and external hyperlinks are supported. Found: {details}{more}"
        )

    # --- Prepare target (unpack to temp dir) ---
    work_dir = tempfile.mkdtemp(prefix="docx_copy_")
    try:
        with zipfile.ZipFile(target_path, "r") as tz:
            tz.extractall(work_dir)

        # Read target document.xml
        target_doc_path = os.path.join(work_dir, "word", "document.xml")
        target_tree = DET.parse(target_doc_path)
        target_root = target_tree.getroot()
        target_body = target_root.find("w:body", NS)
        if target_body is None:
            raise ValueError("Target document has no body element")

        target_children = list(target_body)

        # --- Build ID mappings ---
        target_rels_path = os.path.join(work_dir, "word", "_rels", "document.xml.rels")
        target_rels_xml = b""
        if os.path.exists(target_rels_path):
            with open(target_rels_path, "rb") as f:
                target_rels_xml = f.read()

        target_doc_xml_bytes = ET.tostring(target_root, encoding="unicode").encode("utf-8")

        rel_map = _build_rel_id_map(deps.rel_ids, target_rels_xml)

        target_num_xml = None
        target_num_path = os.path.join(work_dir, "word", "numbering.xml")
        if os.path.exists(target_num_path):
            with open(target_num_path, "rb") as f:
                target_num_xml = f.read()
        num_map = _build_num_id_map(deps.num_ids, target_num_xml)

        bm_map = _build_bookmark_id_map(deps.bookmark_ids, target_doc_xml_bytes)

        # --- Deep copy and remap elements ---
        copied_elements: List[ET.Element] = []
        for elem in section_elements:
            new_elem = copy.deepcopy(elem)
            _remap_element(new_elem, rel_map, num_map, bm_map)
            copied_elements.append(new_elem)

        # --- Find insertion point in target ---
        target_headings = list_headings(target_path)
        insert_index = len(target_children)

        # Don't insert after the final sectPr
        if target_children and target_children[-1].tag == W_TAG_SECTPR:
            insert_index = len(target_children) - 1

        if target_heading:
            target_h = _find_section(target_headings, target_heading, match_mode, target_heading_index)
            if target_h is not None:
                # Insert after this heading's section
                has_target_sectpr = bool(target_children) and target_children[-1].tag == W_TAG_SECTPR
                target_bounds = _section_bounds(target_headings, target_h,
                                                len(target_children), has_target_sectpr)
                insert_index = target_bounds.end
            else:
                result.warnings.append(
                    f"Target heading '{target_heading}' not found. Appending at end.")

        # --- Insert elements into target body ---
        for i, elem in enumerate(copied_elements):
            target_body.insert(insert_index + i, elem)

        # Write updated document.xml
        target_tree.write(target_doc_path, xml_declaration=True, encoding="UTF-8")

        # --- Merge styles ---
        result.styles = _merge_styles(source_zip, target_path, deps.style_ids, work_dir)

        # --- Merge numbering ---
        if deps.num_ids:
            _merge_numbering(source_zip, target_path, deps.num_ids, num_map, work_dir)

        # --- Copy images and safe relationships (hyperlinks) ---
        img_count, img_warnings = _copy_images(
            source_zip, work_dir, source_rels_root, rel_map, deps)
        result.images = img_count
        result.warnings.extend(img_warnings)

        # --- Update Content_Types ---
        _update_content_types(work_dir)

        # --- Extra warnings (best-effort) ---
        if "chart" in section_xml.lower() or "dgm:" in section_xml:
            result.warnings.append("Section may contain charts/diagrams; copier supports images only.")

        # --- Repack to output ---
        _repack_docx(work_dir, output_path)

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    return result


def _repack_docx(work_dir: str, output_path: str) -> None:
    """Pack a directory back into a DOCX ZIP file."""
    # Ensure output directory exists
    out_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(out_dir, exist_ok=True)

    # Write to a temp file first, then atomically replace the output.
    # This avoids corrupting the target when --output == --target and the
    # process crashes mid-write.
    fd, tmp_path = tempfile.mkstemp(prefix=".docx_copy_", suffix=".tmp", dir=out_dir)
    os.close(fd)

    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for dirpath, dirnames, filenames in os.walk(work_dir):
                for filename in filenames:
                    file_path = os.path.join(dirpath, filename)
                    arcname = os.path.relpath(file_path, work_dir)
                    zout.write(file_path, arcname)
        os.replace(tmp_path, output_path)
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass
