#!/usr/bin/env python3
import argparse
import json
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


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_sections(goal: str):
    lowered = goal.lower()
    if "点对点" in goal or "solution" in lowered or "方案" in goal:
        return [
            {
                "id": "project-understanding",
                "title": "项目理解与目标",
                "purpose": "Summarize the project scope, stakeholder objective, and success target from the merged fact surface.",
                "acceptance": "Explains the project background, target outcome, and the solution framing in Chinese.",
                "evidence_topics": ["commercial-baseline", "timeline", "general"],
            },
            {
                "id": "requirement-mapping",
                "title": "需求拆解与点对点对应",
                "purpose": "Map the core tender requirements or user asks to the proposed response line-by-line.",
                "acceptance": "Explicitly links requirement points to corresponding response actions or capabilities.",
                "evidence_topics": ["ai-nodes", "hpc", "xinchuang-cloud", "fp16-capability", "fp64-capability"],
            },
            {
                "id": "solution-route",
                "title": "解决路径与实施方案",
                "purpose": "Describe the practical implementation route, delivery path, and collaboration model.",
                "acceptance": "Contains concrete execution steps rather than generic sales language.",
                "evidence_topics": ["timeline", "hpc", "ai-nodes", "xinchuang-cloud"],
            },
            {
                "id": "evidence-assumptions",
                "title": "证据来源与关键假设",
                "purpose": "Show which facts are supported by source artifacts and which assumptions remain provisional.",
                "acceptance": "Includes explicit evidence references and labels assumptions conservatively.",
                "evidence_topics": ["general", "commercial-baseline", "payment"],
            },
            {
                "id": "risk-open-questions",
                "title": "风险与待确认事项",
                "purpose": "Expose unresolved conflicts, deviations, and missing details that still affect confidence.",
                "acceptance": "Calls out unresolved issues and the next confirmation action for each.",
                "evidence_topics": ["cooling-method", "rack-power", "fp64-capability"],
            },
        ]
    return [
        {
            "id": "executive-summary",
            "title": "执行摘要",
            "purpose": "Summarize the task and the recommended answer structure.",
            "acceptance": "Gives a concise high-signal overview.",
            "evidence_topics": ["general"],
        },
        {
            "id": "body",
            "title": "主体内容",
            "purpose": "Carry the main response using the merged fact surface.",
            "acceptance": "Uses specific evidence-backed points instead of generalities.",
            "evidence_topics": ["general"],
        },
        {
            "id": "open-questions",
            "title": "待确认事项",
            "purpose": "Preserve remaining uncertainty for follow-up.",
            "acceptance": "Lists missing information and blockers.",
            "evidence_topics": ["general"],
        },
    ]


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
    manifest = load_json(workspace / ".worktree" / "sources" / "manifest.json", {}) or {}
    facts = load_json(workspace / ".worktree" / "facts.json", {}) or {}
    conflicts = load_json(workspace / ".worktree" / "merge" / "conflicts.json", {}) or {}

    goal = (
        args.goal.strip()
        or str(facts.get("goal") or "").strip()
        or str(manifest.get("goal") or "").strip()
        or str(index.get("summary") or "").strip()
        or "Prepare a structured document response from the merged fact surface"
    )
    target_doc = (
        args.target_doc.strip()
        or str(facts.get("target_doc") or "").strip()
        or str(manifest.get("target_doc") or "").strip()
        or str(index.get("target_doc") or "").strip()
        or None
    )

    canonical_facts = facts.get("canonical_facts") if isinstance(facts.get("canonical_facts"), list) else []
    gaps = facts.get("gaps") if isinstance(facts.get("gaps"), list) else []
    open_questions = conflicts.get("open_questions") if isinstance(conflicts.get("open_questions"), list) else []
    conflict_items = conflicts.get("conflicts") if isinstance(conflicts.get("conflicts"), list) else []
    sections = build_sections(goal)

    plan_payload = {
        "version": 1,
        "goal": goal,
        "target_doc": target_doc,
        "recommended_route": [
            "Draft from plan and canonical facts first",
            "Do not reopen raw source files unless the plan is missing evidence for a specific claim",
            "Carry unresolved conflicts forward as explicit assumptions or risks",
            "Refresh coverage after writing, then run verification",
        ],
        "sections": sections,
        "dependencies": [
            ".worktree/facts.json",
            ".worktree/merge/conflicts.json",
            ".worktree/sources/manifest.json",
        ],
        "required_evidence": [
            {
                "topic": item.get("topic"),
                "statement": item.get("statement"),
                "source_count": len(item.get("sources") or []),
            }
            for item in canonical_facts[:24]
            if isinstance(item, dict)
        ],
        "open_questions": open_questions[:12],
        "writer_instructions": [
            "Use the section order in this plan unless the target document already has stable structure that must be preserved.",
            "Prefer canonical facts and conflict artifacts over reopening source artifacts.",
            "If a section cannot be fully supported, write the supported portion and mark the rest as assumptions or pending confirmation.",
            "Keep the tone practical and evidence-aware rather than speculative.",
        ],
        "updated_at": iso_now(),
    }

    coverage_payload = {
        "version": 1,
        "goal": goal,
        "target_doc": target_doc,
        "targets": [
            {
                "id": section["id"],
                "title": section["title"],
            }
            for section in sections
        ],
        "covered": [],
        "missing": [section["title"] for section in sections],
        "risks": [
            {
                "topic": item.get("topic"),
                "reason": item.get("rationale"),
            }
            for item in conflict_items[:12]
            if isinstance(item, dict)
        ] + [
            {
                "topic": "gap",
                "reason": gap,
            }
            for gap in gaps[:12]
            if isinstance(gap, str)
        ],
        "next_checks": [
            "doc-writer drafts the target deliverable from the plan and facts",
            "doc-verifier checks section coverage, evidence support, and unresolved blockers",
        ],
        "updated_at": plan_payload["updated_at"],
    }

    write_json(workspace / args.plan_out, plan_payload)
    write_json(workspace / args.coverage_out, coverage_payload)


if __name__ == "__main__":
    main()
