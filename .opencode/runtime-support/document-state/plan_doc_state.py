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

GENERIC_TECHNICAL_TOPICS = [
    "architecture-design",
    "implementation-path",
    "integration-interface",
    "security-governance",
    "compute-capability",
    "compute-platform",
    "compatibility-requirements",
    "facility-design",
    "facility-capacity",
    "resource-aggregation",
    "scheduling",
    "security-monitoring",
    "api-interoperability",
    "identifier-system",
    "general",
]

GENERIC_SUPPORT_TOPICS = [
    "requirement-scope",
    "delivery-planning",
    "timeline",
    "warranty",
    "commercial-baseline",
    "general",
]

GENERIC_RISK_TOPICS = [
    "risk-constraint",
    "compatibility-requirements",
    "general",
    "timeline",
    "warranty",
    "commercial-baseline",
    "payment",
    "bid-security",
]

REFERENCE_SECTION_KEYWORDS = {
    "参考与依据",
    "联网补充依据",
    "参考资料",
    "依据",
    "参考",
    "联网",
    "政策",
    "标准",
    "规范",
}


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
    return explicit or "Prepare a structured document response from the merged fact surface"


def dedupe_preserve_order(values: list[str]) -> list[str]:
    seen = set()
    result: list[str] = []
    for value in values:
        cleaned = str(value or "").strip()
        if not cleaned:
            continue
        lowered = normalize_text(cleaned)
        if lowered in seen:
            continue
        seen.add(lowered)
        result.append(cleaned)
    return result


def extract_explicit_system_titles(goal: str) -> list[str]:
    candidates = re.findall(r"[\u4e00-\u9fffA-Za-z0-9（）()·\-/]{2,40}?系统", goal or "")
    filtered = []
    for candidate in candidates:
        cleaned = candidate.strip(" ，,；;：:。")
        cleaned = re.sub(r"^(围绕|聚焦|针对|面向|关于|以)\s*", "", cleaned)
        if cleaned in {"系统", "本系统", "该系统", "目标系统", "业务系统"}:
            continue
        filtered.append(cleaned)
    return dedupe_preserve_order(filtered)


def extract_explicit_heading_titles(goal: str) -> list[str]:
    text = goal or ""
    patterns = [
        r"Markdown\s*标题[:：]\s*([^\n]+)",
        r"标题[:：]\s*([^\n]+)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            raw = match.group(1).strip()
            candidate = re.split(r"[。\n]", raw, maxsplit=1)[0]
            headings = dedupe_preserve_order(
                [
                    part.strip(" `\"'“”‘’")
                    for part in re.split(r"[，,、；;]", candidate)
                ]
            )
            if len(headings) >= 2:
                return headings
    return []


def has_named_system_contract(goal: str) -> bool:
    return len(extract_explicit_system_titles(goal)) >= 2


def should_add_reference_section(goal: str) -> bool:
    lowered = normalize_text(goal)
    return any(keyword.lower() in lowered for keyword in REFERENCE_SECTION_KEYWORDS)


def infer_generic_heading_topics(title: str) -> list[str]:
    lowered = normalize_text(title)
    if any(keyword in lowered for keyword in ["风险", "待确认", "问题", "缺口", "约束"]):
        return GENERIC_RISK_TOPICS
    if any(keyword in lowered for keyword in ["计划", "里程碑", "分工", "协作", "排期", "阶段"]):
        return dedupe_preserve_order([*GENERIC_SUPPORT_TOPICS, "implementation-path"])
    if any(keyword in lowered for keyword in ["证据", "依据", "参考", "来源"]):
        return dedupe_preserve_order([*GENERIC_TECHNICAL_TOPICS, *GENERIC_SUPPORT_TOPICS])
    if any(keyword in lowered for keyword in ["路径", "方案", "设计", "实施", "架构", "重组", "协同", "对应"]):
        return GENERIC_TECHNICAL_TOPICS
    if any(keyword in lowered for keyword in ["理解", "目标", "背景", "概述", "需求"]):
        return dedupe_preserve_order([*GENERIC_SUPPORT_TOPICS, *GENERIC_TECHNICAL_TOPICS])
    return GENERIC_TECHNICAL_TOPICS


def build_explicit_heading_sections(goal: str) -> list[dict]:
    sections = []
    for title in extract_explicit_heading_titles(goal):
        lowered = normalize_text(title)
        if any(keyword in lowered for keyword in ["风险", "待确认", "问题", "缺口"]):
            purpose = f"围绕 `{title}` 明确当前草稿中的风险、待确认事项与后续动作。"
            acceptance = f"保留 `{title}` 这个精确标题，并明确列出剩余风险、待确认点与下一步动作。"
        elif any(keyword in lowered for keyword in ["证据", "依据", "参考", "来源"]):
            purpose = f"围绕 `{title}` 说明正文使用的证据来源、约束边界与外部补充。"
            acceptance = f"保留 `{title}` 这个精确标题，并明确区分上传文档证据、外部补充与仍待核实内容。"
        elif any(keyword in lowered for keyword in ["路径", "方案", "设计", "实施", "架构", "重组"]):
            purpose = f"围绕 `{title}` 说明结构重组、实现路径或实施方案。"
            acceptance = f"保留 `{title}` 这个精确标题，并给出可执行的结构化方案而不是泛化表述。"
        elif any(keyword in lowered for keyword in ["理解", "目标", "背景", "概述", "需求"]):
            purpose = f"围绕 `{title}` 说明项目背景、目标、需求或重构范围。"
            acceptance = f"保留 `{title}` 这个精确标题，并用证据支撑关键判断。"
        else:
            purpose = f"围绕 `{title}` 组织正文的该部分内容。"
            acceptance = f"保留 `{title}` 这个精确标题，并确保该部分内容可直接用于最终交付物。"
        sections.append(
            {
                "id": title,
                "title": title,
                "purpose": purpose,
                "acceptance": acceptance,
                "evidence_topics": infer_generic_heading_topics(title),
            }
        )
    return sections


def infer_system_section_topics(title: str) -> list[str]:
    lowered = normalize_text(title)
    if any(keyword in lowered for keyword in ["调度", "协同", "选路", "路径", "推荐"]):
        primary = "scheduling"
    elif any(keyword in lowered for keyword in ["监测", "监控", "安全", "审计", "告警", "风控"]):
        primary = "security-monitoring"
    else:
        primary = "resource-aggregation"
    return dedupe_preserve_order([primary, "api-interoperability", "identifier-system"])


def build_named_system_sections(goal: str) -> list[dict]:
    sections = []
    for title in extract_explicit_system_titles(goal):
        sections.append(
            {
                "id": title,
                "title": title,
                "purpose": f"围绕 `{title}` 说明功能定位、技术架构、技术路线、互联互通机制、标识系统构建与 API 调用示例。",
                "acceptance": f"保留 `{title}` 这个精确标题，并覆盖功能定位、技术架构、技术路线、互联互通机制、标识系统构建与 API 调用示例。",
                "required_subsections": SYSTEM_SUBSECTIONS,
                "evidence_topics": infer_system_section_topics(title),
            }
        )

    if should_add_reference_section(goal):
        sections.append(
            {
                "id": "参考与依据",
                "title": "参考与依据",
                "purpose": "说明源文档、联网补充依据与行业通用假设边界。",
                "acceptance": "明确区分来源于上传文档的事实和联网补充的行业通用信息。",
                "evidence_topics": ["general"],
            }
        )

    return sections


def build_sections(goal: str, manifest: dict, canonical_facts: list[dict]):
    if len(extract_explicit_heading_titles(goal)) >= 2:
        return build_explicit_heading_sections(goal)

    if has_named_system_contract(goal):
        return build_named_system_sections(goal)

    lowered = goal.lower()
    if "点对点" in goal or "solution" in lowered or "方案" in goal:
        return [
            {
                "id": "project-understanding",
                "title": "项目理解",
                "purpose": "Summarize the project scope, stakeholder objective, and success target from the merged fact surface.",
                "acceptance": "Explains the project background, target outcome, and the solution framing in Chinese.",
                "evidence_topics": dedupe_preserve_order([*GENERIC_SUPPORT_TOPICS, *GENERIC_TECHNICAL_TOPICS]),
            },
            {
                "id": "requirement-mapping",
                "title": "需求拆解",
                "purpose": "Map the core requirements or user asks to the proposed response structure.",
                "acceptance": "Explains the main requirement groups and how the response will address them.",
                "evidence_topics": dedupe_preserve_order([*GENERIC_TECHNICAL_TOPICS, *GENERIC_SUPPORT_TOPICS]),
            },
            {
                "id": "solution-route",
                "title": "点对点解决路径" if "点对点" in goal else "解决路径",
                "purpose": "Describe the practical implementation route, delivery path, and collaboration model.",
                "acceptance": "Contains concrete execution steps rather than generic sales language.",
                "evidence_topics": GENERIC_TECHNICAL_TOPICS,
            },
            {
                "id": "evidence-constraints",
                "title": "证据与约束",
                "purpose": "Show which claims are supported by source artifacts and which constraints or assumptions still matter.",
                "acceptance": "Includes explicit evidence references and labels constraints or assumptions conservatively.",
                "evidence_topics": dedupe_preserve_order([*GENERIC_TECHNICAL_TOPICS, *GENERIC_SUPPORT_TOPICS]),
            },
            {
                "id": "risk-open-questions",
                "title": "待确认事项" if "点对点" in goal else "风险与待确认事项",
                "purpose": "Expose unresolved conflicts, deviations, and missing details that still affect confidence.",
                "acceptance": "Calls out unresolved issues and the next confirmation action for each.",
                "evidence_topics": GENERIC_RISK_TOPICS,
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

    if has_named_system_contract(goal):
        keywords.update({
            "算力", "资源", "纳管", "k8s", "虚拟机", "裸金属", "gpu", "标签", "调度", "时延", "带宽",
            "丢包", "路径", "算网", "监控", "告警", "审计", "安全", "等保", "api", "rest", "grpc",
            "互联互通", "标识", "认证", "ldap", "oauth", "rbac", "prometheus", "grafana", "网关",
            "架构", "模块", "组件", "实施", "部署", "流程", "集成", "对接", "数据", "治理",
            "需求", "约束", "目标", "能力", "规范", "标准",
        })
        preferred_topics.update({
            "architecture-design", "implementation-path", "integration-interface", "security-governance",
            "compute-capability", "compute-platform", "compatibility-requirements",
            "facility-design", "facility-capacity", "requirement-scope", "delivery-planning",
            "resource-aggregation", "scheduling", "security-monitoring", "api-interoperability", "identifier-system",
        })
    elif "点对点" in goal or "solution" in lowered or "方案" in goal:
        keywords.update({
            "需求", "方案", "实施", "技术", "项目", "系统", "接口", "架构", "风险", "约束",
            "模块", "组件", "部署", "集成", "对接", "数据", "协同", "交付", "计划",
        })
        preferred_topics.update([*GENERIC_TECHNICAL_TOPICS, *GENERIC_SUPPORT_TOPICS, *GENERIC_RISK_TOPICS])
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
