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
      key = normalize_text(cleaned)
      if key in seen:
        continue
      seen.add(key)
      result.append(cleaned)
    return result


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
    if "fp64" in lowered:
        return "fp64-capability"
    if "fp16" in lowered:
        return "fp16-capability"
    if "液冷" in statement or "风冷" in statement:
        return "cooling-method"
    if "机柜" in statement and ("40kw" in lowered or "150kw" in lowered):
        return "rack-power"
    if "预算" in statement or "控制价" in statement:
        return "commercial-baseline"
    if "工期" in statement or "交付" in statement or "调试完成" in statement:
        return "timeline"
    if "质保" in statement or "保修" in statement:
        return "warranty"
    if "保证金" in statement:
        return "bid-security"
    if "付款" in statement or "预付" in statement:
        return "payment"
    if "节点" in statement and ("gpu" in lowered or "智算" in statement):
        return "ai-nodes"
    if "超算" in statement:
        return "hpc"
    if "信创" in statement:
        return "xinchuang-cloud"
    return "general"


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
    evidence_index = []
    gaps = []
    open_questions = []
    conflict_map = {}

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
                    "evidence": evidence or None,
                    "statement": statement,
                }
                canonical["sources"].append(evidence_item)
                evidence_index.append(
                    {
                        "id": make_id("ev", doc_id, statement, locator),
                        **evidence_item,
                    }
                )
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

    facts_payload = {
        "version": 1,
        "goal": args.goal.strip() or manifest.get("goal") or index.get("summary") or "Merge compiled source artifacts into canonical document state",
        "target_doc": args.target_doc.strip() or manifest.get("target_doc") or index.get("target_doc") or None,
        "source_count": len(source_records),
        "canonical_facts": sorted(canonical_map.values(), key=lambda item: (item.get("topic") or "", item.get("statement") or "")),
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
