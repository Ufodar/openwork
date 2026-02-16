#!/usr/bin/env python3
"""
Bid Writer MVP - automated smoke test + QC report.

Goal:
- Make bid generation *repeatable* (red/green loop) against a real folder of materials.
- Produce:
  1) a generated draft docx (deterministic)
  2) a QC report (deterministic checks)

This script intentionally avoids third-party dependencies.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional
from xml.etree import ElementTree as ET


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def read_docx_text(docx_path: Path) -> str:
    with zipfile.ZipFile(docx_path) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    parts: list[str] = []
    for t in root.iter(_w("t")):
        if t.text:
            parts.append(t.text)
    return "".join(parts)


def normalize_text(s: str) -> str:
    # Drop whitespace + common punctuation for robust substring checks across DOCX/Excel variants.
    out = re.sub(r"\s+", "", s or "")
    out = re.sub(r"[，。,．；;:：、/\\\\（）()\\[\\]【】《》〈〉“”\"'‘’·•…—-]+", "", out)
    return out


def extract_search_terms(requirement: str) -> list[str]:
    """
    Extract a few stable terms from a requirement string for best-effort evidence scanning.

    Heuristics:
    - keep longer CJK/ASCII chunks (>=3 chars)
    - keep uppercase tokens like API/SDK (>=2 chars)
    - drop very short / generic tokens to reduce noise
    """
    cleaned = re.sub(r"[，。,．；;:：、/\\\\（）()\\[\\]【】《》〈〉“”\"'‘’·•…—-]+", " ", requirement or "")
    parts = [p.strip() for p in cleaned.split() if p.strip()]
    terms: list[str] = []
    for part in parts:
        if len(part) >= 3:
            terms.append(part)
            continue
        if re.fullmatch(r"[A-Z]{2,}", part):
            terms.append(part)
            continue
    # De-dup preserving order
    out: list[str] = []
    seen: set[str] = set()
    for t in terms:
        if t in seen:
            continue
        out.append(t)
        seen.add(t)
    return out


def read_pdf_text(pdf_path: Path, *, max_chars: int = 500_000) -> str:
    """
    Best-effort text extraction using `pdftotext` if available.
    Returns empty string when extraction isn't possible.
    """
    try:
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            subprocess.run(
                ["pdftotext", str(pdf_path), str(tmp_path)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            text = tmp_path.read_text(encoding="utf-8", errors="ignore")
            return text[:max_chars]
        finally:
            try:
                tmp_path.unlink()
            except FileNotFoundError:
                pass
    except Exception:
        return ""


def read_text_file(path: Path, *, max_chars: int = 500_000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:max_chars]
    except Exception:
        return ""


def list_files(root: Path, *, max_files: int = 500) -> list[Path]:
    files: list[Path] = []
    try:
        for dirpath, _, filenames in os.walk(root):
            for name in filenames:
                if name in {".DS_Store", "Thumbs.db"}:
                    continue
                files.append(Path(dirpath) / name)
                if len(files) >= max_files:
                    return files
    except Exception:
        return files
    return files


def scan_evidence_files(
    *,
    root: Path,
    rows: list[dict[str, str]],
    max_files: int = 200,
    max_bytes_per_file: int = 250_000_000,  # 250MB
) -> dict[str, list[str]]:
    """
    Best-effort evidence scanning across the session reference library.

    Returns: { requirement_id: [relative file paths that contain any extracted term] }
    """
    files = list_files(root, max_files=max_files)
    if not files:
        return {}

    # Prepare term queries per requirement row.
    queries: dict[str, list[str]] = {}
    for row in rows:
        req_id = (row.get("ID") or "").strip()
        req_text = (row.get("Requirement") or "").strip()
        if not req_id or not req_text:
            continue
        terms = extract_search_terms(req_text)
        if terms:
            queries[req_id] = terms

    if not queries:
        return {}

    # Cache normalized text per file to avoid repeated extraction.
    norm_cache: dict[Path, str] = {}

    def load_norm(p: Path) -> str:
        if p in norm_cache:
            return norm_cache[p]
        try:
            info = p.stat()
        except Exception:
            norm_cache[p] = ""
            return ""
        if info.is_dir() or not info.is_file():
            norm_cache[p] = ""
            return ""
        if info.size > max_bytes_per_file:
            norm_cache[p] = ""
            return ""

        ext = p.suffix.lower()
        text = ""
        if ext == ".docx":
            try:
                text = read_docx_text(p)
            except Exception:
                text = ""
        elif ext == ".pdf":
            text = read_pdf_text(p)
        elif ext in {".txt", ".md", ".csv", ".tsv", ".json"}:
            text = read_text_file(p)
        else:
            text = ""

        norm_cache[p] = normalize_text(text)
        return norm_cache[p]

    results: dict[str, list[str]] = {req_id: [] for req_id in queries.keys()}

    for p in files:
        rel = str(p.relative_to(root))
        norm = load_norm(p)
        if not norm:
            continue
        for req_id, terms in queries.items():
            if results[req_id]:
                # Keep a small cap per requirement to avoid huge reports.
                if len(results[req_id]) >= 6:
                    continue
            if any(normalize_text(t) in norm for t in terms):
                results[req_id].append(rel)

    # Remove empty hits
    return {k: v for k, v in results.items() if v}


def read_requirements(requirements_csv: Path) -> list[dict[str, str]]:
    with requirements_csv.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows: list[dict[str, str]] = []
        for row in reader:
            rows.append({k: (v or "").strip() for k, v in row.items()})
        return rows


def write_requirements(requirements_csv: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with requirements_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def list_docx_headings(copy_script: Path, docx_path: Path) -> list[str]:
    cmd = [sys.executable, str(copy_script), "--source", str(docx_path), "--list-headings", "--json"]
    out = subprocess.check_output(cmd)
    payload = json.loads(out.decode("utf-8"))
    if not isinstance(payload, list):
        return []
    headings: list[str] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        text = (item.get("text") or "").strip()
        if text:
            headings.append(text)
    return headings


def pick_headings(headings: list[str], want: list[str], *, max_per_want: int = 3) -> list[str]:
    """
    Select headings from `headings` that best match each `want` pattern.
    Strategy:
      1) exact match
      2) contains match (first N)
    """
    out: list[str] = []
    seen: set[str] = set()

    for pattern in want:
        pattern = (pattern or "").strip()
        if not pattern:
            continue

        chosen = [h for h in headings if h == pattern][:max_per_want]
        if not chosen:
            chosen = [h for h in headings if pattern in h][:max_per_want]

        for h in chosen:
            if h in seen:
                continue
            out.append(h)
            seen.add(h)

    return out


def auto_resolve_requirements(
    *,
    requirements_csv: Path,
    draft_docx: Path,
    copied_headings: list[str],
) -> None:
    """
    Best-effort status updates to reduce "missing materials" noise when we've already
    appended evidence from a reference document.

    Conservative policy:
    - Only changes away from '待提供' / '待填写' when the *draft doc* contains strong anchors.
    - Marks as '需核对' instead of '已提供' to preserve reviewer safety.
    """
    rows = read_requirements(requirements_csv)
    if not rows:
        return

    doc_text = read_docx_text(draft_docx)
    doc_n = normalize_text(doc_text)

    def _has_any(needles: list[str]) -> bool:
        return any(normalize_text(n) in doc_n for n in needles if n)

    def _set(row: dict[str, str], status: str, location: str) -> None:
        row["Status"] = status
        if location:
            row["ResponseLocation"] = location

    copied_n = {normalize_text(h) for h in copied_headings if h}

    # Qualification evidence anchors (common bid attachments)
    qual_anchors = [
        "营业执照",
        "审计报告",
        "资信证明",
        "税收证明",
        "纳税",
        "社保证明",
        "社会保障",
        "中小企业声明函",
        "重大税收违法失信主体",
    ]

    # Scoring/support evidence anchors (cases + acceptance + staffing)
    support_anchors = [
        "投标人主要业绩表",
        "合同一",
        "合同二",
        "合同三",
        "验收单",
        "项目人员名单",
        "项目人员社保证明",
    ]

    for row in rows:
        status = (row.get("Status") or "").strip()
        cat = (row.get("Category") or "").strip()
        req = (row.get("Requirement") or "").strip()

        if status == "待提供":
            if cat == "资格要求":
                needs: list[str] = []
                if "营业执照" in req:
                    needs += ["营业执照"]
                if ("审计" in req) or ("财务" in req) or ("资信" in req):
                    needs += ["审计报告", "资信证明", "财务报告"]
                if ("税收" in req) or ("纳税" in req):
                    needs += ["税收证明", "纳税"]
                if ("社会保障" in req) or ("社保" in req):
                    needs += ["社保证明", "社会保障"]
                if "中小企业声明函" in req:
                    needs += ["中小企业声明函"]
                if "重大税收违法失信" in req:
                    needs += ["重大税收违法失信主体"]

                # Combined proof: require both tax + social signals.
                needs_tax = ("税收" in req) or ("纳税" in req)
                needs_social = ("社会保障" in req) or ("社保" in req)
                ok = False
                if needs_tax and needs_social:
                    ok = _has_any(["税收证明", "纳税"]) and _has_any(["社保证明", "社会保障"])
                else:
                    ok = _has_any(needs) if needs else _has_any(qual_anchors)

                if ok and copied_n:
                    if any(normalize_text(k) in copied_n for k in needs if k) or any(
                        normalize_text(k) in copied_n for k in qual_anchors
                    ):
                        _set(row, "已提供(需核对)", "资质附件（来自参考材料，需核对日期/主体）")
                continue

            if _has_any(support_anchors) and any(normalize_text(k) in copied_n for k in support_anchors):
                _set(row, "已提供(需核对)", "支撑材料附件（来自参考材料）")
                continue

        if status == "待填写":
            if ("报价" in req) and _has_any(["开标一览表", "开标分项一览表"]):
                _set(row, "已包含模板(待填)", "商务标-报价表")
                continue

    write_requirements(requirements_csv, rows)


def parse_cn_datetime(value: str) -> Optional[datetime]:
    """
    Parse strings like:
      - 2025年11月4日9点30分（北京时间）
      - 2025年11月4日9:30
    Returns an aware datetime in Asia/Shanghai (+08:00) when possible.
    """
    raw = (value or "").strip()
    if not raw:
        return None

    m = re.search(
        r"(?P<y>20\d{2})年(?P<mo>\d{1,2})月(?P<d>\d{1,2})日\s*(?P<h>\d{1,2})[点:：](?P<mi>\d{1,2})",
        raw,
    )
    if not m:
        return None

    try:
        y = int(m.group("y"))
        mo = int(m.group("mo"))
        d = int(m.group("d"))
        h = int(m.group("h"))
        mi = int(m.group("mi"))
    except ValueError:
        return None

    # Asia/Shanghai is fixed +08:00; use a fixed offset to avoid tz database dependency.
    tz = timezone(timedelta(hours=8))
    return datetime(y, mo, d, h, mi, tzinfo=tz)


def build_qc_report(
    *,
    bid_id: str,
    draft_docx: Path,
    facts_json: Path,
    requirements_csv: Path,
    tender_text: Optional[str],
    refs_root: Optional[Path],
) -> str:
    now = datetime.now().astimezone()
    facts = json.loads(facts_json.read_text(encoding="utf-8"))
    reqs = read_requirements(requirements_csv)

    doc_text = read_docx_text(draft_docx)
    doc_n = normalize_text(doc_text)

    def has(s: str) -> bool:
        return normalize_text(s) in doc_n

    blockers: list[str] = []
    highs: list[str] = []
    mediums: list[str] = []
    lows: list[str] = []

    # 1) Doc integrity checks
    placeholders = re.findall(r"<<TBD[^>]*>>", doc_text)
    if placeholders:
        blockers.append(f"发现占位符 {len(placeholders)} 处（<<TBD: ...>>），投标文件不可直接提交。")

    # 2) Facts presence checks
    tender = facts.get("tender") or {}
    project_name = tender.get("projectName") or ""
    project_number = tender.get("projectNumber") or ""
    budget = tender.get("budget") or ""
    agency = (facts.get("procurementAgency") or {}).get("name") or ""
    bid_deadline = facts.get("bidDeadline") or ""
    bid_open_loc = (facts.get("bidOpening") or {}).get("location") or ""

    for label, value in [
        ("项目名称", project_name),
        ("项目编号", project_number),
        ("预算金额", budget),
        ("采购代理机构", agency),
        ("投标截止/开标时间", bid_deadline),
        ("开标地点", bid_open_loc),
    ]:
        if value and not has(str(value)):
            highs.append(f"草稿中未找到关键事实：{label}={value}（疑似未写入或格式被破坏）。")

    # 3) Deadline sanity (best-effort)
    parsed_deadline = parse_cn_datetime(str(bid_deadline))
    if parsed_deadline:
        if parsed_deadline < now:
            lows.append(
                f"投标截止时间（{parsed_deadline.isoformat()}）早于当前时间（{now.isoformat()}）。"
                "如果这是历史项目样例可忽略；若为真实投标则必须更新招标文件/事实提取。"
            )

    # 4) Section presence checks (stable, low-noise)
    # We avoid per-requirement fuzzy matching here; `requirements.csv` is the source-of-truth matrix.
    expected_sections = [
        ("资格/商务清单", "资格要求与商务要求（清单）"),
        ("评分摘要", "评标方法（摘要）"),
        ("点对点应答", "技术参数响应与偏离说明（点对点）"),
        ("设备清单", "设备清单（摘要）"),
        ("售后承诺", "售后与服务承诺（摘要）"),
        ("待确认问题", "待确认问题清单"),
    ]
    for label, anchor in expected_sections:
        if not has(anchor):
            highs.append(f"草稿中未找到关键章节：{label}（{anchor}）。")

    # 5) Submission-critical missing items (based on requirements Status)
    def _status(row: dict[str, str]) -> str:
        return (row.get("Status") or "").strip()

    need_provide = [r for r in reqs if "待提供" in _status(r)]
    need_fill = [r for r in reqs if _status(r) in {"待填写"}]
    need_verify = [r for r in reqs if "需核对" in _status(r)]
    need_template_fill = [
        r for r in reqs if ("待填" in _status(r)) and _status(r) not in {"待填写"}
    ]

    need_provide_qual = [r for r in need_provide if (r.get("Category") or "") == "资格要求"]
    need_provide_nonqual = [r for r in need_provide if (r.get("Category") or "") != "资格要求"]

    if need_provide_qual:
        blockers.append(
            "存在待提供的资格审查材料（可能一票否决）。示例："
            + "；".join(f"{r.get('ID')} {r.get('Requirement')}" for r in need_provide_qual[:4])
            + ("；..." if len(need_provide_qual) > 4 else "")
        )
    if need_provide_nonqual:
        highs.append(
            "存在待提供的支撑材料/证明材料（影响得分或合规，但通常非一票否决）。示例："
            + "；".join(f"{r.get('ID')} {r.get('Category')}" for r in need_provide_nonqual[:6])
            + ("；..." if len(need_provide_nonqual) > 6 else "")
        )
    if need_fill:
        highs.append(
            "存在待填写的条目（通常是报价/商务表单）。示例："
            + "；".join(f"{r.get('ID')} {r.get('Category')}" for r in need_fill[:6])
            + ("；..." if len(need_fill) > 6 else "")
        )
    if need_template_fill:
        mediums.append(
            "存在“已包含模板但仍需人工填写”的条目。示例："
            + "；".join(f"{r.get('ID')} {r.get('Category')}" for r in need_template_fill[:6])
            + ("；..." if len(need_template_fill) > 6 else "")
        )
    if need_verify:
        mediums.append(
            "存在“已提供但需核对有效性/日期/主体”的材料（不可盲目提交）。示例："
            + "；".join(f"{r.get('ID')} {r.get('Category')}" for r in need_verify[:8])
            + ("；..." if len(need_verify) > 8 else "")
        )

    # 6) Tender-required structure hints (cheap keyword gate)
    # We don't try to fully parse the tender; just check a few must-have forms.
    must_forms = [
        "开标一览表",
        "开标分项一览表",
        "法定代表人授权书",
        "法定代表人身份证明书",
        "无重大违法记录声明",
        "中小企业声明函",
        "投标产品点对点应答表",
        "投标产品配置清单",
        "售后服务承诺",
    ]
    missing_forms = [name for name in must_forms if not has(name)]
    if missing_forms:
        mediums.append(
            "草稿未包含常见投标文件表单/章节（专业度不足，且可能不符合招标文件附件格式）。缺失："
            + "、".join(missing_forms[:8])
            + ("…" if len(missing_forms) > 8 else "")
        )

    # 7) Tender composition clause (when tender_text provided)
    if tender_text:
        tender_n = normalize_text(tender_text)
        if "投标文件应包括以下内容" in tender_n:
            # If the tender explicitly requires these buckets, ensure our draft at least references them.
            buckets = ["报价文件", "资格文件", "技术文件", "承诺文件", "其他补充文件"]
            missing_buckets = [b for b in buckets if not has(b)]
            if missing_buckets:
                mediums.append(
                    "招标文件明确要求投标文件组成（报价/资格/技术/承诺/其他），草稿中未明显体现："
                    + "、".join(missing_buckets)
                )

    evidence_hits: dict[str, list[str]] = {}
    if refs_root and need_provide_nonqual:
        try:
            evidence_hits = scan_evidence_files(root=refs_root, rows=need_provide_nonqual)
        except Exception:
            evidence_hits = {}

    ok = not blockers and not highs

    def render_list(items: Iterable[str]) -> str:
        return "\n".join(f"- {item}" for item in items) if items else "- （无）"

    lines: list[str] = []
    lines.append(f"# Bid MVP QC Report — {bid_id}")
    lines.append("")
    lines.append(f"- Generated at: {now.isoformat()}")
    lines.append(f"- Draft: `{draft_docx}`")
    lines.append(f"- Facts: `{facts_json}`")
    lines.append(f"- Requirements: `{requirements_csv}`")
    lines.append("")
    lines.append(f"## Result: {'PASS' if ok else 'FAIL'}")
    lines.append("")
    lines.append("## Blockers")
    lines.append(render_list(blockers))
    lines.append("")
    lines.append("## High")
    lines.append(render_list(highs))
    lines.append("")
    lines.append("## Medium")
    lines.append(render_list(mediums))
    lines.append("")
    lines.append("## Low")
    lines.append(render_list(lows))
    lines.append("")
    if refs_root:
        lines.append("## Evidence scan (refs/)")
        if evidence_hits:
            for row in need_provide_nonqual:
                req_id = (row.get("ID") or "").strip()
                if not req_id:
                    continue
                hits = evidence_hits.get(req_id)
                if not hits:
                    continue
                terms = extract_search_terms((row.get("Requirement") or "").strip())
                lines.append(f"- {req_id}: terms={ '、'.join(terms[:6]) if terms else '（无）' }")
                lines.append("  - hits: " + "；".join(hits[:6]) + ("；..." if len(hits) > 6 else ""))
        else:
            lines.append("- （无匹配；可能缺少证明材料或材料为扫描件需 OCR）")
        lines.append("")
    lines.append("## Next actions (suggested)")
    actions: list[str] = []
    if need_provide_qual:
        actions.append("收集并补齐资格/资质材料（营业执照/审计/纳税社保/中小企业声明函等），否则存在废标风险。")
    if need_provide_nonqual:
        actions.append("补齐待提供的支撑/证明材料（含星号条款证明材料、案例合同/验收/人员社保等），否则可能失分或不满足实质性要求。")
        if refs_root and evidence_hits:
            actions.append("已在 refs/ 中发现疑似相关材料（见 Evidence scan），可优先人工核对并补充到投标附件/证明材料页码。")
    if missing_forms:
        actions.append("用模板/历史标书补齐招标文件附件格式（开标一览表、授权书、声明函、点对点应答表、配置清单等）。")
    if placeholders:
        actions.append("消灭所有 <<TBD: ...>> 占位符，缺失信息写入 questions.md 并向用户确认。")
    if not actions:
        actions.append("进入人工复核：OnlyOffice 打开草稿，按招标文件附件格式逐项核对。")
    lines.append(render_list(actions))
    lines.append("")

    return "\n".join(lines)


def read_tender_text_quick(docx_path: Path, max_lines: int = 4000) -> str:
    # Cheap extraction for QC keyword checks.
    with zipfile.ZipFile(docx_path) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    lines: list[str] = []
    for p in root.iter(_w("p")):
        ts = [t.text or "" for t in p.iter(_w("t"))]
        if not ts:
            continue
        text = " ".join("".join(ts).split())
        if text:
            lines.append(text)
        if len(lines) >= max_lines:
            break
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Bid MVP automated smoke test + QC")
    parser.add_argument("--bid-id", required=True, help="bids/<bid_id> directory name")
    parser.add_argument("--session-id", help="Session id (used for default inbox refs lookup)")
    parser.add_argument("--target-doc", required=True, help="Target template .docx")
    parser.add_argument("--out-doc", required=True, help="Output .docx path")
    parser.add_argument("--tender-doc", help="Tender .docx path (for QC keyword hints)")
    parser.add_argument("--tech-xlsx", required=True, help="Technical response table .xlsx")
    parser.add_argument("--equip-xlsx", required=True, help="Equipment list .xlsx")
    parser.add_argument("--brand-xls", help="Brand deviation .xls/.xlsx (optional)")
    parser.add_argument(
        "--forms-source-doc",
        help="Optional .docx containing tender/partner form templates (e.g. 开标一览表、授权书等) to append",
    )
    parser.add_argument(
        "--forms-heading",
        action="append",
        default=[],
        help="Heading to copy from --forms-source-doc (repeatable). Defaults to a standard set when omitted.",
    )
    args = parser.parse_args()

    workspace = Path.cwd()
    bid_dir = workspace / "bids" / args.bid_id
    facts_json = bid_dir / "facts.json"
    requirements_csv = bid_dir / "requirements.csv"
    questions_md = bid_dir / "questions.md"

    for p in [facts_json, requirements_csv, questions_md]:
        if not p.exists():
            raise SystemExit(f"Missing required bid artifact: {p}")

    target_doc = Path(args.target_doc)
    out_doc = Path(args.out_doc)
    out_doc.parent.mkdir(parents=True, exist_ok=True)

    draft_script = workspace / ".opencode" / "skills" / "bid-drafting" / "scripts" / "draft_bid_mvp.py"
    if not draft_script.exists():
        raise SystemExit(f"Missing drafting script: {draft_script}")

    cmd = [
        sys.executable,
        str(draft_script),
        "--target",
        str(target_doc),
        "--output",
        str(out_doc),
        "--facts",
        str(facts_json),
        "--requirements",
        str(requirements_csv),
        "--questions",
        str(questions_md),
        "--tech-xlsx",
        str(Path(args.tech_xlsx)),
        "--equip-xlsx",
        str(Path(args.equip_xlsx)),
    ]
    if args.brand_xls:
        cmd += ["--brand-xls", str(Path(args.brand_xls))]

    subprocess.check_call(cmd)

    # Optionally append form templates from a reference document (usually tender attachments
    # or a partner bid). This improves "professional completeness" without relying on LLM.
    copied_headings: list[str] = []
    if args.forms_source_doc:
        forms_doc = Path(args.forms_source_doc)
        if not forms_doc.exists():
            raise SystemExit(f"Missing forms source document: {forms_doc}")
        copy_script = workspace / ".opencode" / "skills" / "bid-drafting" / "scripts" / "copy_docx_section.py"
        if not copy_script.exists():
            raise SystemExit(f"Missing section copy script: {copy_script}")

        if args.forms_heading:
            headings = args.forms_heading
        else:
            available = list_docx_headings(copy_script, forms_doc)

            # P0: common tender-required forms (always try to include)
            want_forms = [
                "开标一览表",
                "开标分项一览表",
                "法定代表人授权书",
                "法定代表人身份证明书",
                "无重大违法记录声明",
                "中小企业声明函",
                "投标产品点对点应答表",
                "投标产品配置清单",
                "售后服务承诺",
            ]

            # P0: qualification attachments (try to include when present)
            want_qual = [
                "营业执照",
                "审计报告",
                "资信证明",
                "税收证明",
                "纳税证明",
                "社保证明",
                "重大税收违法失信主体",
                "项目人员社保证明",
            ]

            # P1: scoring/support evidence (cases + acceptance + staffing)
            want_support = [
                "投标人主要业绩表",
                "合同",
                "验收单",
                "项目人员名单",
            ]

            headings = []
            headings += pick_headings(available, want_forms, max_per_want=1)
            headings += pick_headings(available, want_qual, max_per_want=2)
            headings += pick_headings(available, want_support, max_per_want=3)

        failures: list[str] = []
        for heading in headings:
            copy_cmd = [
                sys.executable,
                str(copy_script),
                "--source",
                str(forms_doc),
                "--target",
                str(out_doc),
                "--output",
                str(out_doc),
                "--source-heading",
                heading,
                "--match-mode",
                "exact",
            ]
            try:
                subprocess.check_call(copy_cmd)
                copied_headings.append(heading)
            except subprocess.CalledProcessError as error:
                failures.append(f"{heading} (exit {error.returncode})")
        if failures:
            print("WARNING: failed to append some form sections:", ", ".join(failures), file=sys.stderr)

    tender_text = None
    if args.tender_doc:
        tender_text = read_tender_text_quick(Path(args.tender_doc))

    if copied_headings:
        auto_resolve_requirements(
            requirements_csv=requirements_csv,
            draft_docx=out_doc,
            copied_headings=copied_headings,
        )

    refs_root = None
    if args.session_id:
        candidate = workspace / ".opencode" / "openwork" / "inbox" / "sessions" / args.session_id / "refs"
        if candidate.exists():
            refs_root = candidate

    qc_report = build_qc_report(
        bid_id=args.bid_id,
        draft_docx=out_doc,
        facts_json=facts_json,
        requirements_csv=requirements_csv,
        tender_text=tender_text,
        refs_root=refs_root,
    )

    qc_path = bid_dir / "qc-report.md"
    qc_path.write_text(qc_report, encoding="utf-8")

    print(f"OK: wrote draft: {out_doc}")
    print(f"OK: wrote qc report: {qc_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
