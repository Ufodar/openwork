#!/usr/bin/env python3
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

GENERIC_GOALS = {
    "compile uploaded source documents into structured state",
    "merge compiled source artifacts into canonical document state",
    "prepare a structured document response from the merged fact surface",
}

SYSTEM_SUBSECTIONS = [
    "功能定位",
    "技术架构",
    "技术路线",
    "互联互通机制",
    "标识系统构建",
    "API调用示例",
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


def is_generic_goal(goal: str) -> bool:
    cleaned = normalize_text(goal)
    return not cleaned or cleaned in GENERIC_GOALS


def manifest_sources(manifest: dict) -> list[dict]:
    return manifest.get("sources") if isinstance(manifest.get("sources"), list) else []


def joined_source_titles(manifest: dict) -> str:
    return " ".join(
        str(item.get("title") or "")
        for item in manifest_sources(manifest)
        if isinstance(item, dict)
    )


def infer_goal(goal: str, manifest: dict, canonical_facts: list[dict]) -> str:
    explicit = (goal or "").strip()
    if explicit and not is_generic_goal(explicit):
        return explicit

    titles = joined_source_titles(manifest)
    fact_text = " ".join(
        str(item.get("statement") or "")
        for item in canonical_facts[:24]
        if isinstance(item, dict)
    )
    context = f"{titles} {fact_text}"
    if "算力" in context and ("监控" in context or "运维" in context or "调度" in context):
        return "撰写三大系统技术材料文档"
    return explicit or "Prepare a structured document response from the merged fact surface"


def is_system_material_goal(goal: str, manifest: dict, canonical_facts: list[dict]) -> bool:
    lowered = normalize_text(goal)
    if any(keyword in lowered for keyword in ["项目申报", "技术材料", "api 调用示例", "三大系统"]):
        return True
    if all(name in goal for name in ["算力资源汇聚系统", "算力选择与调度系统", "算力运行安全监测系统"]):
        return True
    titles = joined_source_titles(manifest)
    if "算力" in titles and ("监控" in titles or "运维" in titles):
        topics = {
            str(item.get("topic") or "")
            for item in canonical_facts
            if isinstance(item, dict)
        }
        if topics & {"resource-aggregation", "scheduling", "security-monitoring", "api-interoperability"}:
            return True
    return False


def build_system_material_sections():
    return [
        {
            "id": "算力资源汇聚系统",
            "title": "算力资源汇聚系统",
            "purpose": "说明跨中心算力纳管、异构资源池化与统一标签体系的实现方式。",
            "acceptance": "覆盖功能定位、资源接入、资源抽象、统一标签、互联互通与 API 调用示例。",
            "required_subsections": SYSTEM_SUBSECTIONS,
            "evidence_topics": ["resource-aggregation", "api-interoperability", "identifier-system"],
        },
        {
            "id": "算力选择与调度系统",
            "title": "算力选择与调度系统",
            "purpose": "说明多维指标驱动的任务-资源-路径联合调度策略。",
            "acceptance": "覆盖功能定位、网络感知、算力建模、调度算法、互联互通与 API 调用示例。",
            "required_subsections": SYSTEM_SUBSECTIONS,
            "evidence_topics": ["scheduling", "api-interoperability", "identifier-system"],
        },
        {
            "id": "算力运行安全监测系统",
            "title": "算力运行安全监测系统",
            "purpose": "说明监控、告警、审计、身份认证与安全合规的实现方式。",
            "acceptance": "覆盖功能定位、安全监控架构、运行风险闭环、互联互通与 API 调用示例。",
            "required_subsections": SYSTEM_SUBSECTIONS,
            "evidence_topics": ["security-monitoring", "api-interoperability", "identifier-system"],
        },
        {
            "id": "参考与依据",
            "title": "参考与依据",
            "purpose": "说明源文档、联网补充依据与行业通用假设边界。",
            "acceptance": "明确区分来源于上传文档的事实和联网补充的行业通用信息。",
            "evidence_topics": ["general"],
        },
    ]


def build_sections(goal: str, manifest: dict, canonical_facts: list[dict]):
    if is_system_material_goal(goal, manifest, canonical_facts):
        return build_system_material_sections()

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


def build_goal_profile(goal: str, manifest: dict, canonical_facts: list[dict]) -> dict:
    lowered = normalize_text(goal)
    keywords = set()
    preferred_topics = set()
    negative_keywords = {
        "充值券", "二维码", "抵扣", "支付结果", "红包", "扫码支付",
        "优惠券", "代金券", "充值", "下架", "续费", "定价模型", "营销",
        "订单", "购物车", "商城", "店铺", "账户余额", "支付平台", "第三方支付",
        "@startuml", "@enduml", "participant",
    }

    if is_system_material_goal(goal, manifest, canonical_facts):
        keywords.update({
            "算力", "资源", "纳管", "k8s", "虚拟机", "裸金属", "gpu", "标签", "调度", "时延", "带宽",
            "丢包", "路径", "算网", "监控", "告警", "审计", "安全", "等保", "api", "rest", "grpc",
            "互联互通", "标识", "认证", "ldap", "oauth", "rbac", "prometheus", "grafana", "网关",
        })
        preferred_topics.update({
            "resource-aggregation", "scheduling", "security-monitoring", "api-interoperability", "identifier-system",
        })
    elif "点对点" in goal or "solution" in lowered or "方案" in goal:
        keywords.update({"需求", "方案", "实施", "技术", "项目", "系统"})
        preferred_topics.update({"general", "commercial-baseline", "timeline"})
    else:
        keywords.update({"项目", "技术", "系统", "平台"})
        preferred_topics.update({"general"})

    for phrase in re.findall(r"[\u4e00-\u9fffA-Za-z0-9\-]{2,}", goal):
        if len(phrase) >= 2:
            keywords.add(phrase.lower())

    return {
        "keywords": keywords,
        "preferred_topics": preferred_topics,
        "negative_keywords": negative_keywords,
    }


def score_fact(item: dict, profile: dict) -> int:
    statement = str(item.get("statement") or "")
    lowered = normalize_text(statement)
    if not lowered:
        return -999
    if "@startuml" in lowered or "@enduml" in lowered or " participant " in lowered or "->" in statement:
        return -999
    score = 0
    keyword_hits = sum(1 for keyword in profile["keywords"] if keyword and keyword in lowered)
    score += keyword_hits * 3
    topic = str(item.get("topic") or "")
    if topic in profile["preferred_topics"]:
        score += 6
    if topic in {"payment", "commercial-baseline", "bid-security"} and "resource-aggregation" in profile["preferred_topics"]:
        score -= 12
    source_count = len(item.get("sources") or [])
    score += min(source_count, 3) * 2
    if any(keyword in statement for keyword in profile["negative_keywords"]):
        score -= 10
    if 24 <= len(statement) <= 240:
        score += 2
    if re.search(r"\d", statement):
        score += 1
    return score


def select_required_evidence(canonical_facts: list[dict], goal: str, manifest: dict) -> list[dict]:
    profile = build_goal_profile(goal, manifest, canonical_facts)
    ranked = []
    for item in canonical_facts:
        if not isinstance(item, dict):
            continue
        score = score_fact(item, profile)
        if score < 2:
            continue
        ranked.append((score, item))
    ranked.sort(key=lambda pair: (-pair[0], pair[1].get("topic") or "", pair[1].get("statement") or ""))

    selected = []
    seen = set()

    for preferred_topic in profile["preferred_topics"]:
        taken = 0
        for _, item in ranked:
            if str(item.get("topic") or "") != preferred_topic:
                continue
            statement = str(item.get("statement") or "").strip()
            if not statement or statement in seen:
                continue
            seen.add(statement)
            selected.append({
                "topic": item.get("topic"),
                "statement": statement,
                "source_count": len(item.get("sources") or []),
            })
            taken += 1
            if taken >= 3:
                break

    for _, item in ranked:
        statement = str(item.get("statement") or "").strip()
        if not statement or statement in seen:
            continue
        seen.add(statement)
        selected.append({
            "topic": item.get("topic"),
            "statement": statement,
            "source_count": len(item.get("sources") or []),
        })
        if len(selected) >= 18:
            break

    if selected:
        return selected

    return [
        {
            "topic": item.get("topic"),
            "statement": item.get("statement"),
            "source_count": len(item.get("sources") or []),
        }
        for item in canonical_facts[:12]
        if isinstance(item, dict)
    ]


def select_section_required_evidence(section: dict, canonical_facts: list[dict], goal: str, manifest: dict) -> list[dict]:
    evidence_topics = {
        str(topic).strip()
        for topic in (section.get("evidence_topics") if isinstance(section.get("evidence_topics"), list) else [])
        if str(topic).strip()
    }
    if not evidence_topics:
        return []

    profile = build_goal_profile(goal, manifest, canonical_facts)
    profile["preferred_topics"] = evidence_topics

    ranked = []
    for item in canonical_facts:
        if not isinstance(item, dict):
            continue
        topic = str(item.get("topic") or "").strip()
        if topic not in evidence_topics:
            continue
        score = score_fact(item, profile)
        if score < 2:
            continue
        ranked.append((score, item))

    ranked.sort(key=lambda pair: (-pair[0], pair[1].get("topic") or "", pair[1].get("statement") or ""))

    selected = []
    seen = set()
    for _, item in ranked:
        statement = str(item.get("statement") or "").strip()
        if not statement or statement in seen:
            continue
        seen.add(statement)
        selected.append({
            "topic": item.get("topic"),
            "statement": statement,
            "source_count": len(item.get("sources") or []),
        })
        if len(selected) >= 6:
            break
    return selected


def select_source_context_refs(section: dict, source_briefs: list[dict]) -> list[dict]:
    evidence_topics = {
        str(topic).strip()
        for topic in (section.get("evidence_topics") if isinstance(section.get("evidence_topics"), list) else [])
        if str(topic).strip()
    }
    if not evidence_topics:
        return []

    ranked_sources: list[tuple[int, dict]] = []
    for source in source_briefs:
        if not isinstance(source, dict):
            continue
        sections = source.get("sections") if isinstance(source.get("sections"), list) else []
        matched_sections = []
        score = 0
        for section_item in sections:
            if not isinstance(section_item, dict):
                continue
            topic = str(section_item.get("topic") or "").strip()
            if topic and topic not in evidence_topics:
                continue
            title = str(section_item.get("title") or "").strip()
            summary = str(section_item.get("summary") or "").strip()
            if not title and not summary:
                continue
            matched_sections.append(title or summary[:60])
            score += 2
            if topic in evidence_topics:
                score += 2
            if len(matched_sections) >= 3:
                break

        if not matched_sections:
            continue

        ranked_sources.append((
            score,
            {
                "docId": str(source.get("docId") or ""),
                "title": str(source.get("title") or ""),
                "relativePath": str(source.get("relativePath") or ""),
                "section_titles": matched_sections,
            },
        ))

    ranked_sources.sort(key=lambda item: (-item[0], item[1].get("title") or ""))
    return [item for _, item in ranked_sources[:3]]


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
    source_briefs = facts.get("source_briefs") if isinstance(facts.get("source_briefs"), list) else []
    gaps = facts.get("gaps") if isinstance(facts.get("gaps"), list) else []
    open_questions = conflicts.get("open_questions") if isinstance(conflicts.get("open_questions"), list) else []
    conflict_items = conflicts.get("conflicts") if isinstance(conflicts.get("conflicts"), list) else []
    goal = infer_goal(goal, manifest, canonical_facts)
    sections = build_sections(goal, manifest, canonical_facts)
    for section in sections:
        section["required_evidence"] = select_section_required_evidence(section, canonical_facts, goal, manifest)
        source_context_refs = select_source_context_refs(section, source_briefs)
        if source_context_refs:
            section["source_context_refs"] = source_context_refs
    required_evidence = select_required_evidence(canonical_facts, goal, manifest)

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
        "required_evidence": required_evidence,
        "open_questions": open_questions[:12],
        "writer_instructions": [
            "Use the section order in this plan unless the target document already has stable structure that must be preserved.",
            "Prefer canonical facts and conflict artifacts over reopening source artifacts.",
            "Use section-level required_evidence and source_context_refs before reopening the global facts store.",
            "If the backing facts store is needed for a missing claim, extract only the relevant records for the current section instead of reading the entire file into context.",
            "If a section cannot be fully supported, write the supported portion and mark the rest as assumptions or pending confirmation.",
            "Keep the tone practical and evidence-aware rather than speculative.",
            "When the user asks for named systems or required headings, keep those exact titles and their required subsections visible in the deliverable.",
            "If a fact is not directly supported by uploaded documents, label it as a network supplement or an industry-general practice instead of presenting it as a source-grounded fact.",
            "If the task explicitly requests联网 research, policy references, standards, or API exemplars beyond the uploaded corpus, do a small number of targeted web searches and label the imported facts as external supplements.",
            "For proposal-style technical materials, drop irrelevant commercial, payment, coupon, recharge, and consumer-checkout facts unless the user explicitly asks for business operations content.",
        ],
        "updated_at": iso_now(),
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
