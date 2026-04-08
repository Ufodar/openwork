#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return default


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")


def normalize_text(value: str) -> str:
    value = (value or "").strip()
    value = re.sub(r"\s+", " ", value)
    return value.lower()


def make_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha1("||".join(parts).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def dedupe_strings(values):
    seen = set()
    result = []
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        if not cleaned:
            continue
        lowered = normalize_text(cleaned)
        if lowered in seen:
            continue
        seen.add(lowered)
        result.append(cleaned)
    return result


def clean_section(section: dict) -> dict | None:
    title = str(section.get("title") or "").strip()
    locator = str(section.get("locator") or "").strip()
    summary = str(section.get("summary") or "").strip()
    raw_points = section.get("key_points") if isinstance(section.get("key_points"), list) else []
    key_points = []
    for item in raw_points[:3]:
        if not isinstance(item, dict):
            continue
        statement = str(item.get("statement") or "").strip()
        if not statement:
            continue
        key_points.append({
            "statement": statement,
            "locator": str(item.get("locator") or "").strip(),
        })

    if not title and not summary and not key_points:
        return None

    cleaned = {
        "title": title,
        "locator": locator,
        "summary": summary,
        "key_points": key_points,
    }
    topic = str(section.get("topic") or "").strip()
    if topic:
        cleaned["topic"] = topic
    return cleaned


def build_source_briefs(source_records: list[dict]) -> list[dict]:
    briefs = []
    for source in source_records:
        raw_sections = source.get("section_briefs") if isinstance(source.get("section_briefs"), list) else []
        cleaned_sections = []
        for section in raw_sections:
            if not isinstance(section, dict):
                continue
            cleaned = clean_section(section)
            if cleaned is None:
                continue
            cleaned_sections.append(cleaned)

        briefs.append({
            "docId": str(source.get("docId") or ""),
            "title": str(source.get("title") or ""),
            "role": str(source.get("role") or ""),
            "relativePath": str(source.get("relativePath") or ""),
            "summary": str(source.get("summary") or ""),
            "sections": cleaned_sections[:5],
        })
    return briefs


def merge_canonical_topic(existing: str, candidate: str) -> str:
    if existing and existing != "general":
        return existing
    if candidate:
        return candidate
    return existing or "general"


def append_fact(
    canonical_map: dict,
    source: dict,
    entry: dict,
    entry_type: str,
):
    statement = str(entry.get("statement") or "").strip()
    if not statement:
        return

    topic = str(entry.get("topic") or "").strip() or "general"
    key = (entry_type, normalize_text(statement))
    canonical = canonical_map.setdefault(
        key,
        {
            "id": make_id("cf", entry_type, statement),
            "type": entry_type,
            "topic": topic,
            "statement": statement,
            "sources": [],
        },
    )
    canonical["topic"] = merge_canonical_topic(str(canonical.get("topic") or ""), topic)
    canonical["sources"].append({
        "docId": str(source.get("docId") or ""),
        "title": str(source.get("title") or ""),
        "role": str(source.get("role") or ""),
        "relativePath": str(source.get("relativePath") or ""),
        "locator": str(entry.get("locator") or "").strip() or None,
        "section": str(entry.get("section") or "").strip() or None,
        "evidence": str(entry.get("evidence") or "").strip() or None,
        "statement": statement,
    })


def dedupe_sources(sources: list[dict]) -> list[dict]:
    seen = set()
    result = []
    for source in sources:
        key = (
            source.get("docId"),
            source.get("locator"),
            source.get("section"),
            source.get("statement"),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(source)
    return result


def build_conflicts(source_records: list[dict]) -> list[dict]:
    conflicts = []
    seen = set()
    for source in source_records:
        raw_conflicts = source.get("conflicts") if isinstance(source.get("conflicts"), list) else []
        for item in raw_conflicts:
            if not isinstance(item, dict):
                continue
            topic = str(item.get("topic") or "").strip() or "general"
            rationale = str(item.get("rationale") or "").strip()
            competing_values = item.get("competing_values") if isinstance(item.get("competing_values"), list) else []
            key = (
                topic,
                normalize_text(rationale),
                json.dumps(competing_values, ensure_ascii=False, sort_keys=True),
            )
            if key in seen:
                continue
            seen.add(key)
            conflicts.append({
                "id": str(item.get("id") or make_id("conflict", topic, rationale or json.dumps(competing_values, ensure_ascii=False))),
                "topic": topic,
                "competing_values": competing_values,
                "preferred_value": item.get("preferred_value"),
                "rationale": rationale or None,
                "unresolved": bool(item.get("unresolved", True)),
            })
    conflicts.sort(key=lambda item: (str(item.get("topic") or ""), str(item.get("id") or "")))
    return conflicts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", default=".")
    parser.add_argument("--goal", default="")
    parser.add_argument("--target-doc", default="")
    parser.add_argument("--facts-out", default=".worktree/facts.json")
    parser.add_argument("--conflicts-out", default=".worktree/merge/conflicts.json")
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    sources_dir = workspace / ".worktree" / "sources"
    manifest = load_json(sources_dir / "manifest.json", {}) or {}
    index = load_json(workspace / ".worktree" / "index.json", {}) or {}
    intent = load_json(workspace / ".worktree" / "intent.json", {}) or {}

    source_records = []
    for path in sorted(sources_dir.glob("*.json")):
        if path.name == "manifest.json":
            continue
        record = load_json(path, {}) or {}
        if isinstance(record, dict):
            source_records.append(record)

    canonical_map = {}
    gaps = []
    open_questions = []

    for source in source_records:
        for field_name, entry_type in (("facts", "fact"), ("claims", "claim")):
            entries = source.get(field_name) if isinstance(source.get(field_name), list) else []
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                append_fact(canonical_map, source, entry, entry_type)
        gaps.extend(source.get("gaps") if isinstance(source.get("gaps"), list) else [])
        open_questions.extend(source.get("open_questions") if isinstance(source.get("open_questions"), list) else [])

    canonical_facts = []
    for item in canonical_map.values():
        item["sources"] = dedupe_sources(item.get("sources") if isinstance(item.get("sources"), list) else [])
        canonical_facts.append(item)

    canonical_facts.sort(key=lambda item: (
        str(item.get("topic") or ""),
        str(item.get("statement") or ""),
    ))

    evidence_index = []
    for item in canonical_facts:
        for source in item.get("sources", []):
            evidence_index.append({
                "id": make_id(
                    "ev",
                    str(source.get("docId") or ""),
                    str(item.get("statement") or ""),
                    str(source.get("locator") or ""),
                ),
                **source,
                "topic": item.get("topic"),
            })

    merged_at = iso_now()
    facts_payload = {
        "version": 1,
        "goal": args.goal.strip() or str(intent.get("goal") or "").strip() or str(manifest.get("goal") or "").strip() or str(index.get("summary") or "").strip() or "Merge compiled source artifacts into canonical document state",
        "target_doc": args.target_doc.strip() or str(intent.get("target_doc") or "").strip() or str(manifest.get("target_doc") or "").strip() or str(index.get("target_doc") or "").strip() or None,
        "source_count": len(source_records),
        "source_briefs": build_source_briefs(source_records),
        "canonical_facts": canonical_facts,
        "evidence_index": evidence_index,
        "gaps": dedupe_strings(gaps),
        "last_merged_at": merged_at,
    }

    conflicts_payload = {
        "version": 1,
        "conflicts": build_conflicts(source_records),
        "open_questions": dedupe_strings(open_questions),
        "last_merged_at": merged_at,
    }

    write_json(workspace / args.facts_out, facts_payload)
    write_json(workspace / args.conflicts_out, conflicts_payload)


if __name__ == "__main__":
    main()
