#!/usr/bin/env python3
"""
Tender facts extraction + optional template fill (MVP).

Goal: deterministically extract "hard facts" from a tender document (招标文件)
and (optionally) fill them into a target bid template DOCX.

This is designed to reduce hallucination and ensure critical business fields
are sourced from the tender (source of truth).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

try:
    import defusedxml.ElementTree as DET  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    # `defusedxml` is optional in many environments. Fall back to stdlib so the
    # script runs out-of-the-box; install `defusedxml` for hardened XML parsing.
    import xml.etree.ElementTree as DET  # type: ignore

import xml.etree.ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def _cell_text(node) -> str:
    parts: list[str] = []
    for t in node.iter(w("t")):
        if t.text:
            parts.append(t.text)
    return "".join(parts)


def _norm(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[：:（）()【】\\[\\]<>《》“”\"'、,，。;；/\\\\|·•●]+", "", text)
    return text


def _squeeze_ws(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


@dataclass(frozen=True)
class Candidate:
    label_raw: str
    label_norm: str
    value: str
    excerpt: str
    locator: str
    kind: str  # table|paragraph|pattern


FACT_SPECS: dict[str, dict[str, object]] = {
    "projectName": {"label": "项目名称", "aliases": ["项目名称"]},
    "projectCode": {"label": "项目编号", "aliases": ["项目编号", "招标编号", "项目编号/招标编号"]},
    "budget": {"label": "预算金额", "aliases": ["预算金额", "采购预算", "预算金额（万元）", "预算"]},
    "agency": {"label": "采购代理机构", "aliases": ["采购代理机构", "代理机构"]},
    "deadline": {"label": "投标截止/开标时间", "aliases": ["投标截止开标时间", "投标截止时间", "开标时间"]},
    "openPlace": {"label": "开标地点", "aliases": ["开标地点", "开标地址"]},
    "delivery": {"label": "交货期/工期", "aliases": ["交货期工期", "交货期", "工期", "交货期/工期"]},
    "validity": {"label": "投标有效期", "aliases": ["投标有效期"]},
    "bidBond": {"label": "投标保证金", "aliases": ["投标保证金"]},
    "performanceBond": {"label": "履约保证金", "aliases": ["履约保证金"]},
    "payment": {"label": "付款方式", "aliases": ["付款方式", "付款方式摘要", "付款方式（摘要）"]},
}

# Common bid template anchors where we prefer to insert the "project info" block.
# This is intentionally small and deterministic; when anchors are missing we fall back
# to inserting near the start of the document body.
PROJECT_INFO_INSERT_ANCHORS = (
    "开标一览表",
    "开标分项一览表",
    "投标产品点对点应答表",
    "投标产品配置清单",
    "售后服务承诺",
)


def _match_quality(label_norm: str, aliases: list[str]) -> int:
    """
    Returns:
      3 = exact match
      2 = startswith
      1 = contains
      0 = no match
    """
    for a in aliases:
        an = _norm(a)
        if not an:
            continue
        if label_norm == an:
            return 3
        if label_norm.startswith(an):
            return 2
        if an in label_norm:
            return 1
    return 0


def _parse_docx_body(docx_path: Path):
    with zipfile.ZipFile(docx_path) as zf:
        xml = zf.read("word/document.xml")
    root = DET.fromstring(xml)
    body = root.find(w("body"))
    if body is None:
        raise SystemExit("Missing w:body in DOCX")
    return root, body


def _table_kv_candidates(body) -> list[Candidate]:
    """
    Extract (label_norm -> Candidate) from 2+ column table rows.
    """
    out: list[Candidate] = []
    tbls = body.findall(w("tbl"))
    for ti, tbl in enumerate(tbls):
        trs = list(tbl.findall(w("tr")))
        for ri, tr in enumerate(trs):
            tcs = list(tr.findall(w("tc")))
            if len(tcs) < 2:
                continue
            label_raw = _squeeze_ws(_cell_text(tcs[0]))
            value_raw = _squeeze_ws(" ".join(_cell_text(tc) for tc in tcs[1:]))
            if not label_raw:
                continue
            if not value_raw:
                continue
            ln = _norm(label_raw)
            if not ln:
                continue
            excerpt = f"{label_raw}: {value_raw}"
            locator = f"table[{ti}]/row[{ri}]"
            out.append(
                Candidate(
                    label_raw=label_raw,
                    label_norm=ln,
                    value=value_raw,
                    excerpt=excerpt,
                    locator=locator,
                    kind="table",
                )
            )
    return out


def _paragraph_candidates(body) -> list[Candidate]:
    out: list[Candidate] = []
    ps = body.findall(w("p"))
    for pi, p in enumerate(ps):
        raw = _squeeze_ws(_cell_text(p))
        if not raw:
            continue
        # Extremely lightweight patterns; table extraction is preferred.
        for key, spec in FACT_SPECS.items():
            aliases = list(spec.get("aliases", []))  # type: ignore[assignment]
            label = str(spec.get("label", ""))
            patterns = [label, *aliases]
            for pat in patterns:
                pat = (pat or "").strip()
                if not pat:
                    continue
                # e.g. "项目名称：xxx"
                m = re.search(rf"{re.escape(pat)}\s*[:：]\s*(.+)$", raw)
                if not m:
                    continue
                value = _squeeze_ws(m.group(1))
                if not value:
                    continue
                excerpt = raw[:200]
                locator = f"p[{pi}]"
                out.append(
                    Candidate(
                        label_raw=pat,
                        label_norm=_norm(pat),
                        value=value,
                        excerpt=excerpt,
                        locator=locator,
                        kind="paragraph",
                    )
                )
    return out


def _extract_invitation_facts(full_text: str) -> dict[str, Candidate]:
    """
    Best-effort extraction from the common invitation sentence:
    "...应在 <agency>(<address>) 获取招标文件，并于 <deadline> 前递交投标文件。"

    This tends to be the most reliable place to extract:
    - agency
    - openPlace (address)
    - deadline (submission/open time)
    """
    text = _squeeze_ws(full_text)
    # Make it resilient to different punctuation/whitespace.
    m = re.search(
        r"应在(?P<agency>[^（(]{4,80}?)(?:（(?P<address>[^）)]{5,220})）)?获取招标文件，?并于(?P<deadline>\d{4}年\d{1,2}月\d{1,2}日\d{1,2}点\d{1,2}分(?:（[^）]{1,20}）)?)前递交投标文件",
        text,
    )
    out: dict[str, Candidate] = {}
    if not m:
        return out
    agency = _squeeze_ws(m.group("agency"))
    address = _squeeze_ws(m.group("address") or "")
    deadline = _squeeze_ws(m.group("deadline"))

    if agency:
        out["agency"] = Candidate(
            label_raw="采购代理机构",
            label_norm=_norm("采购代理机构"),
            value=agency,
            excerpt=m.group(0)[:220],
            locator="regex:invitation",
            kind="pattern",
        )
    if address:
        out["openPlace"] = Candidate(
            label_raw="开标地点",
            label_norm=_norm("开标地点"),
            value=address,
            excerpt=m.group(0)[:260],
            locator="regex:invitation",
            kind="pattern",
        )
    if deadline:
        out["deadline"] = Candidate(
            label_raw="投标截止/开标时间",
            label_norm=_norm("投标截止/开标时间"),
            value=deadline,
            excerpt=m.group(0)[:260],
            locator="regex:invitation",
            kind="pattern",
        )
    return out


def _regex_candidate(*, key: str, label: str, locator: str, text: str, pattern: str) -> Candidate | None:
    m = re.search(pattern, text)
    if not m:
        return None
    value = _squeeze_ws(m.group("val") if "val" in m.groupdict() else m.group(1))
    if not value:
        return None
    excerpt = _squeeze_ws(m.group(0))[:260]
    return Candidate(
        label_raw=label,
        label_norm=_norm(label),
        value=value,
        excerpt=excerpt,
        locator=locator,
        kind="pattern",
    )


def _extract_special_facts(full_text: str) -> dict[str, list[Candidate]]:
    """
    Patterns that don't appear as simple 'Label: value' pairs.
    Keep these patterns tight to avoid false positives.
    """
    text = _squeeze_ws(full_text)
    out: dict[str, list[Candidate]] = {}

    def add(key: str, cand: Candidate | None) -> None:
        if not cand:
            return
        out.setdefault(key, []).append(cand)

    # 投标有效期: e.g. "本项目投标有效期为60天。" / "投标有效期为开标之日起60天"
    add(
        "validity",
        _regex_candidate(
            key="validity",
            label="投标有效期",
            locator="regex:validity",
            text=text,
            pattern=r"(?:本项目)?投标有效期(?:为|：)?\s*(?P<val>(?:开标之日起)?\s*\d{1,4}\s*天)",
        ),
    )

    # 履约保证金: prefer amounts/percent, avoid yes/no toggles.
    add(
        "performanceBond",
        _regex_candidate(
            key="performanceBond",
            label="履约保证金",
            locator="regex:performanceBond:amount",
            text=text,
            pattern=r"收取履约保证金金额\s*[:：]\s*(?P<val>[^，。；;]{1,120}?)(?=履约担保期限|$)",
        ),
    )
    add(
        "performanceBond",
        _regex_candidate(
            key="performanceBond",
            label="履约保证金",
            locator="regex:performanceBond:attachedPercent",
            text=text,
            pattern=r"(?P<val>(?:合同(?:总额|金额)[^，。；;]{0,10})?\d{1,3}\s*%)\s*的?\s*履约保证金",
        ),
    )
    add(
        "performanceBond",
        _regex_candidate(
            key="performanceBond",
            label="履约保证金",
            locator="regex:performanceBond:percent",
            text=text,
            pattern=r"履约保证金(?:金额)?(?:为|：)?\s*(?P<val>(?:合同(?:总额|金额)[^，。]{0,20})?\d{1,3}\s*%)",
        ),
    )

    # 付款方式: many tenders describe payment terms as a sentence, e.g. "全额付款：..."
    add(
        "payment",
        _regex_candidate(
            key="payment",
            label="付款方式",
            locator="regex:payment:full",
            text=text,
            pattern=r"全额付款\s*[:：]\s*(?P<val>[^。]{10,260})",
        ),
    )
    add(
        "payment",
        _regex_candidate(
            key="payment",
            label="付款方式",
            locator="regex:payment:pay100",
            text=text,
            pattern=r"(?P<val>[^。]{0,80}支付合同总额[^。]{0,180})",
        ),
    )

    return out


def _score_candidate(key: str, candidate: Candidate, aliases: list[str]) -> int:
    value = _squeeze_ws(candidate.value)
    if not value:
        return -10_000

    quality = _match_quality(candidate.label_norm, aliases)
    if quality <= 0:
        return -10_000

    score = quality * 100
    if candidate.kind == "pattern":
        score += 20
    if candidate.kind == "table":
        score += 10

    # Penalties for common junk values
    if re.fullmatch(r"(是|否)(\s*(是|否))?", value):
        score -= 1_000
    if any(token in value for token in ["公章", "经办人", "负责人"]):
        score -= 200

    if key == "projectName":
        if "项目" in value:
            score += 20
        if len(value) > 120:
            score -= 50
    elif key == "projectCode":
        if re.search(r"[A-Za-z]{1,6}-?\d{2,}", value):
            score += 30
        if len(value) > 40:
            score -= 20
    elif key == "budget":
        if re.search(r"\d", value) and any(unit in value for unit in ["万", "元"]):
            score += 30
    elif key == "agency":
        if any(word in value for word in ["招标", "代理", "公司", "有限公司"]):
            score += 30
        if "采购人" in value:
            score -= 80
    elif key == "deadline":
        if re.search(r"\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日", value):
            score += 40
        if re.search(r"\d{1,2}\s*[点时]\s*\d{1,2}\s*分", value):
            score += 10
    elif key == "openPlace":
        if any(word in value for word in ["市", "区", "路", "号", "楼", "室", "大厦"]):
            score += 20
    elif key == "delivery":
        if re.search(r"\d", value) and any(word in value for word in ["天", "日", "期限"]):
            score += 20
    elif key == "validity":
        if re.search(r"\d", value) and "天" in value:
            score += 20
    elif key == "bidBond":
        if re.search(r"\d", value) and any(unit in value for unit in ["元", "万"]):
            score += 30
    elif key == "performanceBond":
        if re.search(r"\d", value) and any(unit in value for unit in ["%", "元", "万"]):
            score += 30
        # Prefer short, declarative values like "合同总额10%" over long clauses.
        if len(value) <= 20:
            score += 40
        if "%" in value:
            score += 20
        if "是否" in value or "是 否" in value or "是否收取" in value:
            score -= 200
        if any(token in value for token in ["履约担保期限", "分期履行", "风险处置", "到货", "安装", "验收"]):
            score -= 200
        if len(value) > 60:
            score -= 200
    elif key == "payment":
        if any(word in value for word in ["支付", "付款", "结算"]):
            score += 20

    return score


def extract_facts(tender_docx: Path) -> tuple[dict[str, dict[str, object]], list[str]]:
    _, body = _parse_docx_body(tender_docx)
    full_text = _cell_text(body)
    table = _table_kv_candidates(body)
    paras = _paragraph_candidates(body)
    pattern = _extract_invitation_facts(full_text)
    special = _extract_special_facts(full_text)

    warnings: list[str] = []
    result: dict[str, dict[str, object]] = {}

    for key, spec in FACT_SPECS.items():
        label = str(spec.get("label", key))
        aliases = list(spec.get("aliases", []))  # type: ignore[assignment]
        alias_list = [label, *aliases]

        cands: list[Candidate] = []
        if key in pattern:
            cands.append(pattern[key])
        cands.extend(special.get(key, []))
        cands.extend(table)
        cands.extend(paras)

        # Filter + score + pick the best candidate.
        scored = [(c, _score_candidate(key, c, alias_list)) for c in cands]
        scored = [(c, s) for (c, s) in scored if s > -10_000]
        scored.sort(key=lambda x: x[1], reverse=True)
        cands = [c for (c, _) in scored]

        if not cands:
            result[key] = {"label": label, "value": None, "source": None}
            continue

        unique_values: list[str] = []
        for c in cands:
            v = _squeeze_ws(c.value)
            if not v:
                continue
            if all(_squeeze_ws(u) != v for u in unique_values):
                unique_values.append(v)

        chosen = cands[0]
        if len(unique_values) > 1:
            warnings.append(f"Multiple candidates for {label}: " + "; ".join(unique_values[:5]))

        result[key] = {
            "label": label,
            "value": _squeeze_ws(chosen.value),
            "source": {
                "kind": chosen.kind,
                "locator": chosen.locator,
                "excerpt": chosen.excerpt,
                "label": chosen.label_raw,
            },
            "candidates": [
                {
                    "label": c.label_raw,
                    "value": _squeeze_ws(c.value),
                    "kind": c.kind,
                    "locator": c.locator,
                    "excerpt": c.excerpt,
                }
                for c in cands[:10]
            ],
        }

    # Try to parse deadline and warn if it's in the past (best-effort).
    deadline = result.get("deadline", {}).get("value")
    if isinstance(deadline, str) and deadline:
        m = re.search(
            r"(?P<y>\d{4})\s*年\s*(?P<m>\d{1,2})\s*月\s*(?P<d>\d{1,2})\s*日(?:\s*(?P<h>\d{1,2})\s*[点时]\s*(?P<min>\d{1,2})\s*分?)?",
            deadline,
        )
        if m:
            y = int(m.group("y"))
            mo = int(m.group("m"))
            d = int(m.group("d"))
            h = int(m.group("h") or 0)
            mi = int(m.group("min") or 0)
            try:
                parsed_date = date(y, mo, d)
                result["deadline"]["parsedDate"] = parsed_date.isoformat()
                if parsed_date < datetime.now().date():
                    warnings.append(f"Deadline appears to be in the past: {deadline}")
            except Exception:
                pass

    return result, warnings


def _replace_tc_text(tc, new_text: str) -> None:
    ts = list(tc.iter(w("t")))
    if not ts:
        # Create a minimal paragraph/run/text if missing
        p = ET.Element(w("p"))
        r = ET.Element(w("r"))
        t = ET.Element(w("t"))
        t.text = new_text
        r.append(t)
        p.append(r)
        tc.append(p)
        return
    ts[0].text = new_text
    for t in ts[1:]:
        t.text = ""


def _replace_p_text(p, new_text: str) -> None:
    ts = list(p.iter(w("t")))
    if not ts:
        r = ET.Element(w("r"))
        t = ET.Element(w("t"))
        t.text = new_text
        r.append(t)
        p.append(r)
        return
    ts[0].text = new_text
    for t in ts[1:]:
        t.text = ""


def _is_placeholder_text(text: str) -> bool:
    value = (text or "").strip()
    if not value:
        return True
    if bool(re.search(r"<<\s*TBD\s*:", value, flags=re.IGNORECASE)):
        return True
    return value in {"-", "—", "— —"}


def _make_run(text: str, *, bold: bool = False) -> ET.Element:
    r = ET.Element(w("r"))
    if bold:
        rpr = ET.Element(w("rPr"))
        rpr.append(ET.Element(w("b")))
        r.append(rpr)
    t = ET.Element(w("t"))
    t.text = text
    r.append(t)
    return r


def _make_para(text: str, *, bold: bool = False) -> ET.Element:
    p = ET.Element(w("p"))
    p.append(_make_run(text, bold=bold))
    return p


def _make_cell(text: str, *, bold: bool = False) -> ET.Element:
    tc = ET.Element(w("tc"))
    tc.append(_make_para(text, bold=bold))
    return tc


def _find_insert_index(body) -> int:
    children = list(body)
    end = len(children)
    if end and children[-1].tag == w("sectPr"):
        end -= 1

    anchors = {_norm(a) for a in PROJECT_INFO_INSERT_ANCHORS}
    for idx, child in enumerate(children[:end]):
        if child.tag != w("p"):
            continue
        raw = _squeeze_ws(_cell_text(child))
        if not raw:
            continue
        if _norm(raw) in anchors:
            return idx

    # Fallback: insert after leading empty/bookmark paragraphs.
    idx = 0
    while idx < end:
        child = children[idx]
        if child.tag != w("p"):
            break
        if _squeeze_ws(_cell_text(child)):
            break
        idx += 1
    return idx


def _is_project_info_heading(text: str) -> bool:
    normalized = _norm(text)
    return bool(normalized) and ("项目基本信息" in normalized) and ("自动提取" in normalized)


def _is_project_info_table(tbl: ET.Element) -> bool:
    trs = list(tbl.findall(w("tr")))
    if not trs:
        return False
    tcs = list(trs[0].findall(w("tc")))
    if len(tcs) < 2:
        return False
    left = _norm(_cell_text(tcs[0]))
    right = _norm(_cell_text(tcs[1]))
    return left == _norm("项目属性") and right == _norm("内容")


def _build_project_info_table(lines: list[str]) -> ET.Element:
    # Render a compact, two-column table (more professional than raw paragraphs).
    tbl = ET.Element(w("tbl"))

    tbl_pr = ET.Element(w("tblPr"))
    tbl_borders = ET.Element(w("tblBorders"))
    for side in ["top", "left", "bottom", "right", "insideH", "insideV"]:
        border = ET.Element(w(side))
        border.set(w("val"), "single")
        border.set(w("sz"), "4")
        border.set(w("space"), "0")
        border.set(w("color"), "auto")
        tbl_borders.append(border)
    tbl_pr.append(tbl_borders)
    tbl.append(tbl_pr)

    # Header row
    tr0 = ET.Element(w("tr"))
    tr0.append(_make_cell("项目属性", bold=True))
    tr0.append(_make_cell("内容", bold=True))
    tbl.append(tr0)

    for line in lines:
        if "：" in line:
            label, val = line.split("：", 1)
        else:
            label, val = line, ""
        tr = ET.Element(w("tr"))
        tr.append(_make_cell(label.strip(), bold=True))
        tr.append(_make_cell(val.strip(), bold=False))
        tbl.append(tr)

    return tbl


def apply_facts_to_target(
    target_docx: Path,
    facts: dict[str, dict[str, object]],
    *,
    force: bool,
    insert_block: bool,
) -> tuple[list[str], list[str], bool]:
    """
    Fill a "project info" key/value table in the target doc.
    Returns (updated_fields, skipped_fields).
    """
    root, body = _parse_docx_body(target_docx)
    children = list(body)

    existing_block_heading: ET.Element | None = None
    existing_block_heading_idx: int | None = None
    existing_block_table: ET.Element | None = None
    existing_block_table_idx: int | None = None
    for idx, child in enumerate(children):
        if child.tag != w("p"):
            continue
        raw = _squeeze_ws(_cell_text(child))
        if not raw:
            continue
        if not _is_project_info_heading(raw):
            continue
        existing_block_heading = child
        existing_block_heading_idx = idx
        for j in range(idx + 1, min(idx + 12, len(children))):
            if children[j].tag != w("tbl"):
                continue
            if _is_project_info_table(children[j]):
                existing_block_table = children[j]
                existing_block_table_idx = j
                break
        break

    label_to_key: dict[str, str] = {}
    for key, spec in FACT_SPECS.items():
        aliases = list(spec.get("aliases", []))  # type: ignore[assignment]
        label = str(spec.get("label", ""))
        for a in [label, *aliases]:
            an = _norm(a)
            if an:
                label_to_key[an] = key

    tbls = body.findall(w("tbl"))
    best_tbl = None
    best_score = 0
    for tbl in tbls:
        # Use *unique* fact keys to score a candidate key/value table.
        # (A table that repeats "项目名称" multiple times should not outscore
        # a real project-info table with diverse fields.)
        found_keys: set[str] = set()
        trs = list(tbl.findall(w("tr")))
        for tr in trs:
            tcs = list(tr.findall(w("tc")))
            if len(tcs) < 2:
                continue
            ln = _norm(_cell_text(tcs[0]))
            if not ln:
                continue
            key = label_to_key.get(ln)
            if key:
                found_keys.add(key)
        score = len(found_keys)
        if score > best_score:
            best_score = score
            best_tbl = tbl

    updated: list[str] = []
    skipped: list[str] = []

    dirty = False
    saw_placeholder_slot = False

    # 1) Prefer filling a key/value table if we can reliably detect one.
    if best_tbl is not None and best_score >= 3:
        for tr in list(best_tbl.findall(w("tr"))):
            tcs = list(tr.findall(w("tc")))
            if len(tcs) < 2:
                continue
            ln = _norm(_cell_text(tcs[0]))
            if not ln:
                continue
            key = label_to_key.get(ln)
            if not key:
                continue
            saw_placeholder_slot = True
            value = facts.get(key, {}).get("value")
            if not isinstance(value, str) or not value.strip():
                continue
            current = _squeeze_ws(_cell_text(tcs[1]))
            if current and not _is_placeholder_text(current) and not force:
                if key not in skipped and key not in updated:
                    skipped.append(key)
                continue
            _replace_tc_text(tcs[1], value)
            if key not in updated:
                updated.append(key)
            dirty = True

    # 2) Fallback: fill standalone "项目名称：xxx" style lines (only when the paragraph *starts* with the label).
    # This is a best-effort helper for templates that store project info as plain text, not a table.
    for key, spec in FACT_SPECS.items():
        if key in updated:
            continue
        value = facts.get(key, {}).get("value")
        if not isinstance(value, str) or not value.strip():
            continue
        label = str(spec.get("label", key))
        # Only attempt these on common "project info" facts to avoid accidental edits throughout the doc.
        if key not in {"projectName", "projectCode", "budget", "agency", "deadline", "openPlace", "delivery"}:
            continue
        pattern = re.compile(rf"^\s*{re.escape(label)}\s*[:：]\s*(?P<val>.*)$")
        for p in body.findall(w("p")):
            raw = _squeeze_ws(_cell_text(p))
            m = pattern.match(raw)
            if not m:
                continue
            saw_placeholder_slot = True
            current = _squeeze_ws(m.group("val") or "")
            if current and not _is_placeholder_text(current) and not force:
                if key not in skipped and key not in updated:
                    skipped.append(key)
                break
            colon = "：" if "：" in raw else ":"
            _replace_p_text(p, f"{label}{colon} {value}")
            if key not in updated:
                updated.append(key)
            dirty = True
            break

    inserted_block = False
    # Only suppress auto-block insertion when we have strong evidence the template
    # already contains a real project-info key/value table (diverse fields).
    has_dedicated_kv_table = best_tbl is not None and best_score >= 4

    # 3) Ensure a filled "项目基本信息（自动提取）" block exists.
    #
    # This is intentionally *not* tied to placeholder detection. In real bids the
    # template (or copied partner forms) may already contain hardcoded values,
    # which would otherwise cause us to skip insertion and hide the extracted facts.
    #
    # To avoid cluttering professional templates that already provide a dedicated
    # project-info key/value table, we only insert the block when such a table is
    # not detected. If the auto block already exists, we update it in-place.
    if insert_block:
        ordered_keys = [
            "projectName",
            "projectCode",
            "budget",
            "agency",
            "deadline",
            "openPlace",
            "delivery",
            "validity",
            "bidBond",
            "performanceBond",
            "payment",
        ]

        block_keys: list[str] = []
        lines: list[str] = []
        for key in ordered_keys:
            value = facts.get(key, {}).get("value")
            if not isinstance(value, str) or not value.strip():
                continue
            label = str(FACT_SPECS.get(key, {}).get("label", key))
            lines.append(f"{label}：{_squeeze_ws(value)}")
            block_keys.append(key)

        if lines:
            tbl = _build_project_info_table(lines)
            applied_block = False

            if existing_block_heading is not None:
                # Update existing auto block.
                raw_heading = _squeeze_ws(_cell_text(existing_block_heading))
                if raw_heading != "项目基本信息（自动提取）":
                    _replace_p_text(existing_block_heading, "项目基本信息（自动提取）")
                    dirty = True
                    applied_block = True

                if existing_block_table is not None:
                    # Replace the existing table in-place.
                    try:
                        idx = list(body).index(existing_block_table)
                    except ValueError:
                        idx = None
                    if idx is not None:
                        body.remove(existing_block_table)
                        body.insert(idx, tbl)
                        dirty = True
                        applied_block = True
                else:
                    insert_at = (existing_block_heading_idx + 1) if existing_block_heading_idx is not None else _find_insert_index(body)
                    body.insert(insert_at, ET.Element(w("p")))
                    body.insert(insert_at + 1, tbl)
                    body.insert(insert_at + 2, ET.Element(w("p")))
                    dirty = True
                    applied_block = True

            elif not has_dedicated_kv_table:
                insert_at = _find_insert_index(body)
                block: list[ET.Element] = [
                    ET.Element(w("p")),
                    _make_para("项目基本信息（自动提取）", bold=True),
                    ET.Element(w("p")),
                    tbl,
                    ET.Element(w("p")),
                ]
                for elem in reversed(block):
                    body.insert(insert_at, elem)
                dirty = True
                inserted_block = True
                applied_block = True

            if applied_block:
                for key in block_keys:
                    if key not in updated:
                        updated.append(key)

    if dirty:
        # Write back document.xml
        xml_bytes = DET.tostring(root, encoding="utf-8", xml_declaration=True)
        tmp = target_docx.with_suffix(target_docx.suffix + ".tmp")
        with zipfile.ZipFile(target_docx) as src, zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as dst:
            for item in src.infolist():
                if item.filename == "word/document.xml":
                    dst.writestr(item, xml_bytes)
                else:
                    dst.writestr(item, src.read(item.filename))
        tmp.replace(target_docx)

    return (updated, skipped, inserted_block)


def render_report(
    tender_docx: Path,
    target_docx: Path | None,
    facts: dict[str, dict[str, object]],
    warnings: list[str],
    updated: list[str],
    skipped: list[str],
    forced: bool,
    inserted_block: bool,
) -> str:
    lines: list[str] = []
    lines.append(f"# Tender facts report: {tender_docx.name}")
    lines.append("")
    lines.append(f"- extractedAt: `{datetime.now(timezone.utc).isoformat()}`")
    if target_docx is not None:
        lines.append(f"- target: `{target_docx.name}`")
        lines.append(f"- forceOverwrite: `{forced}`")
    lines.append("")

    lines.append("## Extracted facts")
    for key, spec in FACT_SPECS.items():
        label = str(spec.get("label", key))
        entry = facts.get(key, {})
        value = entry.get("value")
        src = entry.get("source")
        if value is None:
            lines.append(f"- {label}: **MISSING**")
            continue
        lines.append(f"- {label}: {value}")
        if isinstance(src, dict):
            excerpt = str(src.get("excerpt", "")).strip()
            locator = str(src.get("locator", "")).strip()
            if excerpt:
                lines.append(f"  - source: `{locator}`")
                lines.append(f"  - excerpt: {excerpt}")
    lines.append("")

    if target_docx is not None:
        lines.append("## Template fill")
        if not updated and not skipped:
            lines.append("- No suitable placeholders detected in target (nothing filled).")
        else:
            lines.append(f"- Filled: {len(updated)} fields")
            for k in updated:
                lines.append(f"  - {FACT_SPECS[k]['label']}")
            if skipped:
                skipped_and_filled = [k for k in skipped if k in updated]
                skipped_only = [k for k in skipped if k not in updated]

                if skipped_only:
                    lines.append(f"- Skipped (already filled): {len(skipped_only)} fields")
                    for k in skipped_only:
                        lines.append(f"  - {FACT_SPECS[k]['label']}")

                if skipped_and_filled and inserted_block:
                    lines.append(f"- Skipped overwrite in template slots (also included in auto block): {len(skipped_and_filled)} fields")
                    for k in skipped_and_filled:
                        lines.append(f"  - {FACT_SPECS[k]['label']}")
        if inserted_block:
            lines.append("- Inserted a filled project info block into the template.")
        lines.append("")

    if warnings:
        lines.append("## Warnings")
        for wline in warnings:
            lines.append(f"- {wline}")
        lines.append("")

    lines.append("## Next steps")
    lines.append("- Run `QC gate` to ensure placeholders and required tables pass the MVP checks.")
    lines.append("- Use `PDF preview` for a print-style sanity check (LibreOffice render).")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract tender facts and optionally fill a target DOCX template")
    parser.add_argument("--tender-docx", required=True, help="Tender DOCX path (source of truth)")
    parser.add_argument("--target-docx", help="Target DOCX to fill (optional)")
    parser.add_argument("--out-facts", required=True, help="Where to write facts JSON")
    parser.add_argument("--out-report", help="Where to write markdown report (optional)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing (non-placeholder) target values")
    parser.add_argument("--insert-block", action="store_true", help="Insert a filled project info block if the template has no placeholders")
    args = parser.parse_args()

    tender = Path(args.tender_docx)
    if not tender.is_file() or tender.suffix.lower() != ".docx":
        raise SystemExit(f"--tender-docx must be an existing .docx file: {tender}")

    target: Path | None = None
    if args.target_docx:
        target = Path(args.target_docx)
        if not target.is_file() or target.suffix.lower() != ".docx":
            raise SystemExit(f"--target-docx must be an existing .docx file: {target}")

    out_facts = Path(args.out_facts)
    out_facts.parent.mkdir(parents=True, exist_ok=True)

    out_report: Path | None = None
    if args.out_report:
        out_report = Path(args.out_report)
        out_report.parent.mkdir(parents=True, exist_ok=True)

    facts, warnings = extract_facts(tender)

    updated: list[str] = []
    skipped: list[str] = []
    inserted_block = False
    if target is not None:
        updated, skipped, inserted_block = apply_facts_to_target(
            target,
            facts,
            force=bool(args.force),
            insert_block=bool(args.insert_block),
        )

    payload = {
        "schemaVersion": 1,
        "extractedAtUtc": datetime.now(timezone.utc).isoformat(),
        "source": {"file": tender.name},
        "facts": facts,
        "warnings": warnings,
        "appliedToTarget": bool(target is not None),
        "updatedFields": updated,
        "skippedFields": skipped,
        "insertedProjectInfoBlock": inserted_block,
    }

    out_facts.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")

    report = render_report(
        tender_docx=tender,
        target_docx=target,
        facts=facts,
        warnings=warnings,
        updated=updated,
        skipped=skipped,
        forced=bool(args.force),
        inserted_block=inserted_block,
    )

    if out_report is not None:
        out_report.write_text(report, "utf-8")
    else:
        sys.stdout.write(report + "\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
