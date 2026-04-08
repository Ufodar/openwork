#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


GENERIC_SECTIONS = [
    {
        "id": "executive-summary",
        "title": "执行摘要",
        "purpose": "Summarize the task and the current recommended response shape.",
        "acceptance": "Gives a concise high-signal overview without overselling certainty.",
    },
    {
        "id": "body",
        "title": "主体内容",
        "purpose": "Carry the main response using the merged fact surface.",
        "acceptance": "Uses specific evidence-backed points instead of vague filler.",
    },
    {
        "id": "open-questions",
        "title": "待确认事项",
        "purpose": "Preserve remaining uncertainty for follow-up.",
        "acceptance": "Lists missing information, blockers, and next confirmation actions.",
    },
]


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return default


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).lower()


def make_id(prefix: str, value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


def build_goal(goal: str, intent: dict, facts: dict, manifest: dict, index: dict) -> str:
    for candidate in [
        goal.strip(),
        str(intent.get("goal") or "").strip(),
        str(facts.get("goal") or "").strip(),
        str(manifest.get("goal") or "").strip(),
        str(index.get("summary") or "").strip(),
    ]:
        if candidate:
            return candidate
    return "Prepare a structured document response from the merged fact surface"


def build_target_doc(target_doc: str, intent: dict, facts: dict, manifest: dict, index: dict) -> str | None:
    for candidate in [
        target_doc.strip(),
        str(intent.get("target_doc") or "").strip(),
        str(facts.get("target_doc") or "").strip(),
        str(manifest.get("target_doc") or "").strip(),
        str(index.get("target_doc") or "").strip(),
    ]:
        if candidate:
            return candidate
    return None


def sanitize_section(section: dict) -> dict | None:
    title = str(section.get("title") or "").strip()
    if not title:
        return None
    sanitized = {
        "id": str(section.get("id") or make_id("section", title)),
        "title": title,
        "purpose": str(section.get("purpose") or f"Organize the `{title}` part of the deliverable.").strip(),
        "acceptance": str(section.get("acceptance") or f"Preserve the exact heading `{title}` and keep this section directly usable in the final deliverable.").strip(),
    }

    required_subsections = section.get("required_subsections") if isinstance(section.get("required_subsections"), list) else []
    cleaned_required_subsections = [str(item).strip() for item in required_subsections if str(item).strip()]
    if cleaned_required_subsections:
        sanitized["required_subsections"] = cleaned_required_subsections

    evidence_topics = section.get("evidence_topics") if isinstance(section.get("evidence_topics"), list) else []
    cleaned_evidence_topics = [str(item).strip() for item in evidence_topics if str(item).strip()]
    if cleaned_evidence_topics:
        sanitized["evidence_topics"] = cleaned_evidence_topics

    source_doc_ids = section.get("source_doc_ids") if isinstance(section.get("source_doc_ids"), list) else []
    cleaned_source_doc_ids = [str(item).strip() for item in source_doc_ids if str(item).strip()]
    if cleaned_source_doc_ids:
        sanitized["source_doc_ids"] = cleaned_source_doc_ids

    return sanitized


def build_sections(intent: dict) -> list[dict]:
    raw_sections = intent.get("sections") if isinstance(intent.get("sections"), list) else []
    sections = []
    for section in raw_sections:
        if not isinstance(section, dict):
            continue
        sanitized = sanitize_section(section)
        if sanitized is not None:
            sections.append(sanitized)
    if sections:
        return sections

    titles = intent.get("must_preserve_titles") if isinstance(intent.get("must_preserve_titles"), list) else []
    cleaned_titles = [str(item).strip() for item in titles if str(item).strip()]
    if cleaned_titles:
        return [
            {
                "id": make_id("section", title),
                "title": title,
                "purpose": f"Organize the `{title}` part of the deliverable.",
                "acceptance": f"Preserve the exact heading `{title}` and keep this section directly usable in the final deliverable.",
            }
            for title in cleaned_titles
        ]

    return [dict(section) for section in GENERIC_SECTIONS]


def rank_facts(canonical_facts: list[dict]) -> list[dict]:
    ranked = []
    for item in canonical_facts:
        if not isinstance(item, dict):
            continue
        statement = str(item.get("statement") or "").strip()
        if not statement:
            continue
        sources = item.get("sources") if isinstance(item.get("sources"), list) else []
        ranked.append((
            -len(sources),
            -len(statement),
            statement,
            item,
        ))
    ranked.sort(key=lambda item: (item[0], item[1], item[2]))
    return [item for _, _, _, item in ranked]


def select_required_evidence(canonical_facts: list[dict], evidence_topics: set[str] | None = None) -> list[dict]:
    selected = []
    for item in rank_facts(canonical_facts):
        topic = str(item.get("topic") or "general").strip() or "general"
        if evidence_topics and topic not in evidence_topics:
            continue
        selected.append({
            "topic": topic,
            "statement": str(item.get("statement") or "").strip(),
            "source_count": len(item.get("sources") if isinstance(item.get("sources"), list) else []),
        })
    limit = 6 if evidence_topics else 12
    return selected[:limit]


def select_source_context_refs(section: dict, source_briefs: list[dict]) -> list[dict]:
    evidence_topics = {
        str(topic).strip()
        for topic in (section.get("evidence_topics") if isinstance(section.get("evidence_topics"), list) else [])
        if str(topic).strip()
    }
    source_doc_ids = {
        str(doc_id).strip()
        for doc_id in (section.get("source_doc_ids") if isinstance(section.get("source_doc_ids"), list) else [])
        if str(doc_id).strip()
    }

    refs = []
    for source in source_briefs:
        if not isinstance(source, dict):
            continue
        doc_id = str(source.get("docId") or "").strip()
        if source_doc_ids and doc_id not in source_doc_ids:
            continue

        section_titles = []
        raw_sections = source.get("sections") if isinstance(source.get("sections"), list) else []
        for item in raw_sections:
            if not isinstance(item, dict):
                continue
            item_topic = str(item.get("topic") or "").strip()
            if evidence_topics and item_topic not in evidence_topics:
                continue
            title = str(item.get("title") or "").strip()
            summary = str(item.get("summary") or "").strip()
            if title:
                section_titles.append(title)
            elif summary:
                section_titles.append(summary[:80])
            if len(section_titles) >= 3:
                break

        if evidence_topics and not section_titles:
            continue

        refs.append({
            "docId": doc_id,
            "title": str(source.get("title") or ""),
            "relativePath": str(source.get("relativePath") or ""),
            "section_titles": section_titles,
        })

    refs.sort(key=lambda item: (item["title"], item["docId"]))
    return refs[:3]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", default=".")
    parser.add_argument("--goal", default="")
    parser.add_argument("--target-doc", default="")
    parser.add_argument("--plan-out", default=".worktree/plan/solution-plan.json")
    parser.add_argument("--coverage-out", default=".worktree/coverage.json")
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    index = load_json(workspace / ".worktree" / "index.json", {}) or {}
    intent = load_json(workspace / ".worktree" / "intent.json", {}) or {}
    manifest = load_json(workspace / ".worktree" / "sources" / "manifest.json", {}) or {}
    facts = load_json(workspace / ".worktree" / "facts.json", {}) or {}
    conflicts = load_json(workspace / ".worktree" / "merge" / "conflicts.json", {}) or {}

    goal = build_goal(args.goal, intent, facts, manifest, index)
    target_doc = build_target_doc(args.target_doc, intent, facts, manifest, index)
    canonical_facts = facts.get("canonical_facts") if isinstance(facts.get("canonical_facts"), list) else []
    source_briefs = facts.get("source_briefs") if isinstance(facts.get("source_briefs"), list) else []
    gaps = facts.get("gaps") if isinstance(facts.get("gaps"), list) else []
    conflict_items = conflicts.get("conflicts") if isinstance(conflicts.get("conflicts"), list) else []
    open_questions = conflicts.get("open_questions") if isinstance(conflicts.get("open_questions"), list) else []

    sections = build_sections(intent)
    for section in sections:
        evidence_topics = {
            str(topic).strip()
            for topic in (section.get("evidence_topics") if isinstance(section.get("evidence_topics"), list) else [])
            if str(topic).strip()
        }
        if evidence_topics:
            section["required_evidence"] = select_required_evidence(canonical_facts, evidence_topics)
        else:
            section["required_evidence"] = []
        refs = select_source_context_refs(section, source_briefs)
        if refs:
            section["source_context_refs"] = refs

    updated_at = iso_now()
    plan_payload = {
        "version": 1,
        "goal": goal,
        "target_doc": target_doc,
        "recommended_route": [
            "Draft from the explicit section contract first.",
            "Use merged facts and source briefs before reopening source artifacts.",
            "Keep unresolved gaps and conflicts visible instead of guessing through them.",
            "Refresh coverage after drafting, then run verification.",
        ],
        "sections": sections,
        "dependencies": [
            ".worktree/intent.json",
            ".worktree/facts.json",
            ".worktree/merge/conflicts.json",
            ".worktree/sources/manifest.json",
        ],
        "required_evidence": select_required_evidence(canonical_facts),
        "open_questions": [str(item).strip() for item in open_questions if str(item).strip()][:12],
        "writer_instructions": [
            "Preserve explicit section titles from intent when they exist.",
            "Prefer merged facts and source briefs over broad source rediscovery.",
            "Treat facts grounded in uploaded materials separately from suggestions or examples added later.",
            "If a section lacks evidence, write the supported portion and surface the remaining gap explicitly.",
            "Do not fabricate a more specialized outline than the intent contract provides.",
        ],
        "updated_at": updated_at,
    }

    coverage_payload = {
        "version": 1,
        "goal": goal,
        "target_doc": target_doc,
        "targets": [
            dict(
                {
                    "id": section["id"],
                    "title": section["title"],
                },
                **(
                    {"required_subsections": section["required_subsections"]}
                    if isinstance(section.get("required_subsections"), list)
                    else {}
                ),
            )
            for section in sections
        ],
        "covered": [],
        "missing": [section["title"] for section in sections],
        "risks": [
            {
                "topic": str(item.get("topic") or "general"),
                "reason": str(item.get("rationale") or "").strip(),
            }
            for item in conflict_items[:12]
            if isinstance(item, dict) and str(item.get("rationale") or "").strip()
        ] + [
            {
                "topic": "gap",
                "reason": str(gap).strip(),
            }
            for gap in gaps[:12]
            if str(gap).strip()
        ],
        "next_checks": [
            "doc-writer drafts the target deliverable from the explicit plan surface",
            "doc-verifier checks section coverage, evidence support, and remaining blockers",
        ],
        "updated_at": updated_at,
    }

    write_json(workspace / args.plan_out, plan_payload)
    write_json(workspace / args.coverage_out, coverage_payload)


if __name__ == "__main__":
    main()
