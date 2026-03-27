#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


SOURCE_SUFFIXES = {
    ".docx",
    ".doc",
    ".docm",
    ".dotx",
    ".dotm",
    ".pdf",
    ".md",
    ".txt",
    ".rtf",
    ".odt",
    ".pptx",
    ".xlsx",
}

IGNORED_PREFIXES = {
    ".git",
    ".opencode",
    ".tmp",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "reports",
    "outputs",
}

IGNORED_FILENAMES = {
    "prompt.txt",
    "run-glm.json",
    "run-glm.stderr",
}


def normalize_text(value: str) -> str:
    return " ".join((value or "").split())


def is_ignored(path: Path) -> bool:
    for part in path.parts:
        if part.startswith(".worktree"):
            return True
        if part in IGNORED_PREFIXES:
            return True
    return False


def infer_role(relative_path: str) -> str:
    lower = relative_path.lower()
    if "招标" in relative_path or "tender" in lower:
        return "招标文件"
    if "白皮书" in relative_path or "whitepaper" in lower:
        return "产品白皮书"
    if "方案" in relative_path or "plan" in lower:
        return "方案材料"
    if "介绍" in relative_path or "简介" in relative_path or "intro" in lower:
        return "产品介绍"
    return "参考材料"


def collect_sources(workspace: Path) -> list[dict]:
    files: list[Path] = []
    for path in workspace.rglob("*"):
        if not path.is_file():
            continue
        if path.name.startswith("."):
            continue
        if path.name in IGNORED_FILENAMES:
            continue
        if is_ignored(path.relative_to(workspace)):
            continue
        if path.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        files.append(path)

    files.sort(key=lambda item: item.relative_to(workspace).as_posix())

    sources: list[dict] = []
    for index, path in enumerate(files, start=1):
        relative_path = path.relative_to(workspace).as_posix()
        sources.append({
            "docId": f"src-{index:03d}",
            "title": path.stem,
            "relativePath": relative_path,
            "kind": path.suffix.lower().lstrip("."),
            "role": infer_role(relative_path),
            "status": "pending_compile",
        })
    return sources


def build_summary(sources: list[dict], target_doc: str | None) -> str:
    source_count = len(sources)
    if source_count == 0:
        base = "No candidate source documents were found in the workspace."
    else:
        base = f"Bootstrap state is ready with {source_count} candidate source document(s)."
    if target_doc:
        return f"{base} Target deliverable: {target_doc}."
    return base


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--goal", default="")
    parser.add_argument("--target-doc", default="")
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    worktree = workspace / ".worktree"
    sources_dir = worktree / "sources"
    sources_dir.mkdir(parents=True, exist_ok=True)

    goal = normalize_text(args.goal)
    target_doc = normalize_text(args.target_doc) or None
    sources = collect_sources(workspace)
    generated_at = datetime.now(timezone.utc).isoformat()

    index_payload = {
        "version": 1,
        "project": workspace.name,
        "target_doc": target_doc,
        "phase": "intake_ready",
        "summary": build_summary(sources, target_doc),
        "current_focus": "Compile source documents into structured state.",
        "conventions_ref": ".worktree/conventions.md",
        "children": [],
    }
    manifest_payload = {
        "generated_at": generated_at,
        "goal": goal,
        "target_doc": target_doc,
        "sources": sources,
        "blockers": [] if sources else ["No supported source documents found in the workspace."],
    }
    conventions = "\n".join([
        "# Intake Conventions",
        "",
        "## authoritative source hierarchy",
        "- User-uploaded source documents in the current workspace are authoritative.",
        "- Structured `.worktree/sources/*.json` artifacts supersede ad-hoc memory summaries.",
        "",
        "## target document choice or ambiguity",
        f"- Target deliverable: {target_doc or 'not yet fixed'}",
        "",
        "## naming conventions",
        "- Use workspace-relative paths only.",
        "- Keep deliverables under `outputs/` when a target path is known.",
        "",
        "## known deliverable constraints",
        f"- Goal: {goal or 'not yet captured'}",
        f"- Candidate source count: {len(sources)}",
        "",
    ])

    write_json(worktree / "index.json", index_payload)
    write_json(sources_dir / "manifest.json", manifest_payload)
    (worktree / "conventions.md").write_text(conventions, encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
