#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


SYSTEM_MATERIAL_HINTS = {
    "技术材料",
    "建设方案",
    "实施方案",
    "解决方案",
    "技术方案",
    "需求说明",
    "系统架构",
    "接口规范",
    "api调用示例",
    "api 调用示例",
}

SYSTEM_MATERIAL_KEYWORDS = {
    "算力", "资源", "纳管", "k8s", "kubernetes", "虚拟机", "裸金属", "gpu", "标签",
    "调度", "时延", "带宽", "丢包", "路径", "算网", "监控", "告警", "审计",
    "安全", "等保", "api", "rest", "restful", "grpc", "互联互通", "标识",
    "认证", "ldap", "oauth", "rbac", "prometheus", "grafana", "网关", "多云",
    "agent", "拓扑", "资源池", "集群", "架构", "模块", "组件", "部署",
    "集成", "对接", "接口", "实施", "交付", "数据流", "控制流", "流程",
    "需求", "约束", "适配", "兼容", "治理", "监测", "监控",
}

GENERAL_SYSTEM_FACT_KEYWORDS = {
    "架构", "展示层", "业务层", "中间层", "通信层", "目标层", "容器化", "前后端分离",
    "prometheus", "zabbix", "influxdb", "elasticsearch", "kafka", "mysql", "redis",
    "gpu", "虚拟机", "k8s", "ldap", "oauth", "rbac", "审计", "告警", "拓扑", "协议",
    "模块", "组件", "接口", "集成", "部署", "数据流", "控制流", "流程", "需求", "约束",
}

TOPIC_ORDER = {
    "architecture-design": 0,
    "implementation-path": 1,
    "integration-interface": 2,
    "security-governance": 3,
    "compute-capability": 4,
    "compute-platform": 5,
    "compatibility-requirements": 6,
    "facility-design": 7,
    "facility-capacity": 8,
    "resource-aggregation": 9,
    "scheduling": 10,
    "security-monitoring": 11,
    "api-interoperability": 12,
    "identifier-system": 13,
    "general": 14,
}

NOISE_KEYWORDS = {
    "充值", "充值券", "支付", "支付平台", "二维码", "扫码", "抵扣", "优惠券", "代金券",
    "订单", "购物车", "店铺", "商城", "账户余额", "充值金额", "第三方支付", "下架",
    "上架", "促销", "红包", "账户充值", "续费", "支付结果", "收银", "售卖",
}

GENERIC_AUTH_NOISE = {
    "authorization-code",
    "implicit",
    "client credentials",
    "客户端凭证",
    "授权码",
    "密码式",
    "隐藏式",
}


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
      key = normalize_text(cleaned)
      if key in seen:
        continue
      seen.add(key)
      result.append(cleaned)
    return result


def extract_explicit_system_titles(goal: str) -> list[str]:
    candidates = re.findall(r"[\u4e00-\u9fffA-Za-z0-9（）()·\-/]{2,40}?系统", goal or "")
    titles = []
    seen = set()
    for candidate in candidates:
        cleaned = candidate.strip(" ，,；;：:。")
        cleaned = re.sub(r"^(围绕|聚焦|针对|面向|关于|以)\s*", "", cleaned)
        if cleaned in {"系统", "本系统", "该系统", "业务系统", "目标系统"}:
            continue
        lowered = normalize_text(cleaned)
        if lowered in seen:
            continue
        seen.add(lowered)
        titles.append(cleaned)
    return titles


def is_system_material_goal(goal: str) -> bool:
    lowered = normalize_text(goal)
    return any(keyword in lowered for keyword in SYSTEM_MATERIAL_HINTS) or len(extract_explicit_system_titles(goal)) >= 2


def build_goal_profile(goal: str):
    lowered = normalize_text(goal)
    profile = {
        "system_material": is_system_material_goal(goal),
        "keywords": set(),
        "negative_keywords": set(NOISE_KEYWORDS),
    }
    if profile["system_material"]:
        profile["keywords"].update(SYSTEM_MATERIAL_KEYWORDS)
    elif any(keyword in lowered for keyword in ["方案", "solution", "点对点"]):
        profile["keywords"].update({"方案", "系统", "技术", "实施", "项目"})
    else:
        profile["keywords"].update({"项目", "系统", "技术", "平台"})

    for phrase in re.findall(r"[\u4e00-\u9fffA-Za-z0-9\-]{2,}", goal or ""):
        profile["keywords"].add(phrase.lower())
    return profile


def infer_topic(statement: str) -> str:
    lowered = normalize_text(statement)
    if any(keyword in lowered for keyword in ["ldap", "oauth", "rbac", "sso", "审计", "告警", "等保", "安全", "访问控制"]):
        return "security-monitoring"
    if any(keyword in lowered for keyword in ["k8s", "kubernetes", "虚拟机", "裸金属", "gpu", "资源池", "纳管", "多云", "网关", "标签", "agent"]):
        return "resource-aggregation"
    if any(keyword in lowered for keyword in ["调度", "时延", "带宽", "丢包", "路径", "算网", "tpm", "rpm", "线性度", "推荐最优"]):
        return "scheduling"
    if any(keyword in lowered for keyword in ["api", "grpc", "rest", "restful", "接口", "协议", "protobuf"]):
        return "api-interoperability"
    if any(keyword in lowered for keyword in ["标识", "编码", "资源描述符", "ontology", "本体", "标签体系"]):
        return "identifier-system"
    if any(keyword in lowered for keyword in ["架构", "模块", "组件", "分层", "拓扑", "部署结构"]):
        return "architecture-design"
    if any(keyword in lowered for keyword in ["实施", "落地", "交付", "联调", "协同", "流程", "步骤", "里程碑"]):
        return "implementation-path"
    if any(keyword in lowered for keyword in ["集成", "对接", "交换", "同步", "调用链", "互通", "接口适配"]):
        return "integration-interface"
    if any(keyword in lowered for keyword in ["治理", "风控", "约束", "风险", "合规", "规范"]):
        return "security-governance"
    if "fp64" in lowered:
        return "compute-capability"
    if "fp16" in lowered:
        return "compute-capability"
    if "液冷" in statement or "风冷" in statement:
        return "facility-design"
    if "机柜" in statement and ("40kw" in lowered or "150kw" in lowered):
        return "facility-capacity"
    if "预算" in statement or "控制价" in statement:
        return "commercial-baseline"
    if "工期" in statement or "交付" in statement or "调试完成" in statement:
        return "timeline"
    if "质保" in statement or "保修" in statement:
        return "warranty"
    if "保证金" in statement:
        return "commercial-baseline"
    if "付款" in statement or "预付" in statement:
        return "payment"
    if "节点" in statement and ("gpu" in lowered or "智算" in statement):
        return "compute-platform"
    if "超算" in statement:
        return "compute-platform"
    if "信创" in statement:
        return "compatibility-requirements"
    return "general"


def is_noise_statement(statement: str, topic: str, profile: dict) -> bool:
    lowered = normalize_text(statement)
    if not lowered:
        return True
    if "@startuml" in lowered or "@enduml" in lowered or " participant " in lowered or "->" in statement:
        return True
    if any(keyword in statement for keyword in profile["negative_keywords"]):
        return True
    if profile["system_material"] and any(keyword in lowered for keyword in GENERIC_AUTH_NOISE):
        positive_hits = sum(1 for keyword in SYSTEM_MATERIAL_KEYWORDS if keyword in lowered)
        if positive_hits <= 2:
            return True
    if profile["system_material"] and topic in {"payment", "commercial-baseline"}:
        return True
    return False


def score_fact(statement: str, topic: str, source_count: int, profile: dict) -> int:
    lowered = normalize_text(statement)
    if not lowered:
        return -999
    if is_noise_statement(statement, topic, profile):
        return -999
    keyword_hits = sum(1 for keyword in profile["keywords"] if keyword and keyword in lowered)
    if profile["system_material"] and topic == "general":
        if len(statement.strip()) < 24:
            return -999
        if keyword_hits < 3:
            return -999
        if not any(keyword in lowered for keyword in GENERAL_SYSTEM_FACT_KEYWORDS):
            return -999

    score = 0
    score += keyword_hits * 3
    if profile["system_material"] and topic in {
        "resource-aggregation",
        "scheduling",
        "security-monitoring",
        "api-interoperability",
        "identifier-system",
    }:
        score += 8
    elif topic != "general":
        score += 3
    score += min(source_count, 3) * 2
    if 24 <= len(statement) <= 260:
        score += 2
    if re.search(r"\d", statement):
        score += 1
    return score


def score_source_section(section: dict, profile: dict) -> tuple[int, str]:
    title = str(section.get("title") or "").strip()
    summary = str(section.get("summary") or "").strip()
    key_points = section.get("key_points") if isinstance(section.get("key_points"), list) else []
    key_text = " ".join(
        str(item.get("statement") or "").strip()
        for item in key_points
        if isinstance(item, dict)
    )
    combined = " ".join(part for part in [title, summary, key_text] if part).strip()
    topic = infer_topic(combined or title or summary)
    score = score_fact(combined, topic, 1, profile)
    return score, topic


def build_source_briefs(source_records: list[dict], profile: dict) -> list[dict]:
    briefs: list[dict] = []

    for source in source_records:
        doc_id = str(source.get("docId") or "")
        title = str(source.get("title") or "")
        role = str(source.get("role") or "")
        relative_path = str(source.get("relativePath") or "")
        summary = str(source.get("summary") or "")
        raw_sections = source.get("section_briefs") if isinstance(source.get("section_briefs"), list) else []

        ranked_sections: list[tuple[int, dict]] = []
        fallback_sections: list[dict] = []
        for section in raw_sections:
            if not isinstance(section, dict):
                continue
            cleaned = {
                "title": str(section.get("title") or ""),
                "locator": str(section.get("locator") or ""),
                "summary": str(section.get("summary") or ""),
                "key_points": [
                    {
                        "statement": str(item.get("statement") or ""),
                        "locator": str(item.get("locator") or ""),
                    }
                    for item in (section.get("key_points") if isinstance(section.get("key_points"), list) else [])
                    if isinstance(item, dict) and str(item.get("statement") or "").strip()
                ][:3],
            }
            fallback_sections.append(cleaned)
            score, topic = score_source_section(section, profile)
            if profile["system_material"] and score < 5:
                continue
            if not profile["system_material"] and score < 1:
                continue
            ranked_sections.append((score, dict(cleaned, topic=topic)))

        ranked_sections.sort(
            key=lambda item: (
                -item[0],
                TOPIC_ORDER.get(str(item[1].get("topic") or ""), 99),
                str(item[1].get("title") or ""),
            )
        )
        selected_sections = [item for _, item in ranked_sections[:8]]
        if not selected_sections:
            selected_sections = fallback_sections[:5]

        briefs.append(
            {
                "docId": doc_id,
                "title": title,
                "role": role,
                "relativePath": relative_path,
                "summary": summary,
                "sections": selected_sections,
            }
        )

    return briefs


def is_conflict_signal(statement: str) -> bool:
    keywords = [
        "负偏离",
        "正偏离",
        "不支持",
        "低于",
        "高于",
        "超过要求",
        "不满足",
        "风冷",
        "液冷",
    ]
    return any(keyword in statement for keyword in keywords)


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

    source_records = []
    for path in sorted(sources_dir.glob("*.json")):
        if path.name == "manifest.json":
            continue
        record = load_json(path, {}) or {}
        if not isinstance(record, dict):
            continue
        source_records.append(record)

    canonical_map = {}
    gaps = []
    open_questions = []
    conflict_map = {}
    goal = args.goal.strip() or manifest.get("goal") or index.get("summary") or ""
    profile = build_goal_profile(goal)

    for source in source_records:
        doc_id = str(source.get("docId") or "")
        title = str(source.get("title") or "")
        role = str(source.get("role") or "")
        relative_path = str(source.get("relativePath") or "")

        for field_name, entry_type in (("facts", "fact"), ("claims", "claim")):
            entries = source.get(field_name) if isinstance(source.get(field_name), list) else []
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                statement = str(entry.get("statement") or "").strip()
                if not statement:
                    continue
                locator = str(entry.get("locator") or "").strip()
                evidence = str(entry.get("evidence") or "").strip()
                key = normalize_text(statement)
                topic = infer_topic(statement)
                canonical = canonical_map.setdefault(
                    key,
                    {
                        "id": make_id("cf", topic, statement),
                        "type": entry_type,
                        "topic": topic,
                        "statement": statement,
                        "sources": [],
                    },
                )
                evidence_item = {
                    "docId": doc_id,
                    "title": title,
                    "role": role,
                    "relativePath": relative_path,
                    "locator": locator or None,
                    "section": str(entry.get("section") or "").strip() or None,
                    "evidence": evidence or None,
                    "statement": statement,
                }
                canonical["sources"].append(evidence_item)
                if is_conflict_signal(statement):
                    bucket = conflict_map.setdefault(
                        topic,
                        {
                            "id": make_id("conflict", topic),
                            "topic": topic,
                            "competing_values": [],
                            "preferred_value": None,
                            "rationale": "Flagged by explicit deviation or requirement-language mismatch in the compiled source artifacts.",
                            "unresolved": True,
                        },
                    )
                    bucket["competing_values"].append(
                        {
                            "docId": doc_id,
                            "title": title,
                            "statement": statement,
                            "locator": locator or None,
                        }
                    )

        gaps.extend(source.get("gaps") if isinstance(source.get("gaps"), list) else [])
        open_questions.extend(source.get("open_questions") if isinstance(source.get("open_questions"), list) else [])

    selected_facts = []
    seen_fact_ids = set()
    for item in canonical_map.values():
        sources = item.get("sources") if isinstance(item.get("sources"), list) else []
        deduped_sources = []
        seen_sources = set()
        for source in sources:
            dedupe_key = (
                source.get("docId"),
                source.get("locator"),
                source.get("statement"),
            )
            if dedupe_key in seen_sources:
                continue
            seen_sources.add(dedupe_key)
            deduped_sources.append(source)
        item["sources"] = deduped_sources
        score = score_fact(
            str(item.get("statement") or ""),
            str(item.get("topic") or ""),
            len(deduped_sources),
            profile,
        )
        if profile["system_material"] and score < 5:
            continue
        if not profile["system_material"] and score < 1:
            continue
        if item["id"] in seen_fact_ids:
            continue
        seen_fact_ids.add(item["id"])
        item["_merge_score"] = score
        selected_facts.append(item)

    selected_facts.sort(
        key=lambda item: (
            -int(item.get("_merge_score") or 0),
            TOPIC_ORDER.get(str(item.get("topic") or ""), 99),
            item.get("statement") or "",
        )
    )
    for item in selected_facts:
        item.pop("_merge_score", None)

    evidence_index = []
    for item in selected_facts:
        for source in item.get("sources", []):
            evidence_index.append(
                {
                    "id": make_id(
                        "ev",
                        str(source.get("docId") or ""),
                        str(item.get("statement") or ""),
                        str(source.get("locator") or ""),
                    ),
                    **source,
                    "topic": item.get("topic"),
                }
            )

    source_briefs = build_source_briefs(source_records, profile)

    facts_payload = {
        "version": 1,
        "goal": goal or "Merge compiled source artifacts into canonical document state",
        "target_doc": args.target_doc.strip() or manifest.get("target_doc") or index.get("target_doc") or None,
        "source_count": len(source_records),
        "source_briefs": source_briefs,
        "canonical_facts": selected_facts,
        "evidence_index": evidence_index,
        "gaps": dedupe_strings(gaps),
        "last_merged_at": iso_now(),
    }

    conflicts_payload = {
        "version": 1,
        "conflicts": sorted(conflict_map.values(), key=lambda item: item.get("topic") or ""),
        "open_questions": dedupe_strings(open_questions),
        "last_merged_at": facts_payload["last_merged_at"],
    }

    write_json(workspace / args.facts_out, facts_payload)
    write_json(workspace / args.conflicts_out, conflicts_payload)


if __name__ == "__main__":
    main()
