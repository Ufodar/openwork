#!/usr/bin/env python3
"""Maintain bids/<bid_id>/source-index.json for DOCX reference materials.

This script builds/updates a persistent index for a batch of .docx files:
- File fingerprint (sha256, size, mtimeMs)
- Heading list (via bid-drafting's docx_copy_lib.list_headings)

It is designed to prevent stale caches across multi-round chats and repeated
uploads, without relying on LLM memory.

Example:
  python3 .opencode/skills/bid-intake/scripts/update_source_index.py \\
    --index bids/demo/source-index.json \\
    .opencode/openwork/inbox/sessions/<sessionId>/refs
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def _iter_docx_paths(inputs: Iterable[Path]) -> Iterable[Path]:
    for inp in inputs:
        if inp.is_dir():
            yield from inp.rglob("*.docx")
            yield from inp.rglob("*.DOCX")
            continue
        if inp.is_file() and inp.suffix.lower() == ".docx":
            yield inp


def _safe_relpath(path: Path, root: Path) -> str:
    try:
        rel = path.resolve().relative_to(root.resolve())
        return rel.as_posix()
    except Exception:
        return str(path.resolve())


def _read_index(index_path: Path) -> Dict[str, Any]:
    if not index_path.exists():
        return {}
    try:
        return json.loads(index_path.read_text(encoding="utf-8"))
    except Exception:
        # Corrupt or non-JSON; keep a backup and start fresh.
        backup = index_path.with_suffix(index_path.suffix + ".bak")
        try:
            backup.write_bytes(index_path.read_bytes())
        except Exception:
            pass
        return {}


def _atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="._source_index_", suffix=".tmp", dir=str(path.parent))
    os.close(tmp_fd)
    tmp = Path(tmp_path)
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(str(tmp), str(path))
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass


def _load_heading_lister() -> Any:
    # Import list_headings from bid-drafting scripts without requiring installation.
    script_dir = Path(__file__).resolve().parent
    skills_dir = script_dir.parent.parent  # .opencode/skills
    copy_scripts_dir = skills_dir / "bid-drafting" / "scripts"
    sys.path.insert(0, str(copy_scripts_dir))
    try:
        from docx_copy_lib import list_headings  # type: ignore
    except Exception as e:
        raise RuntimeError(
            f"Failed to import docx_copy_lib.list_headings from {copy_scripts_dir}: {e}"
        ) from e
    return list_headings


def _stat_fingerprint(path: Path) -> Tuple[int, int]:
    st = path.stat()
    return int(st.st_size), int(st.st_mtime * 1000)


def main() -> None:
    parser = argparse.ArgumentParser(description="Update bid source-index.json (hash + headings).")
    parser.add_argument(
        "--index",
        required=True,
        help="Path to source-index.json (e.g., bids/<bid_id>/source-index.json).",
    )
    parser.add_argument(
        "--workspace-root",
        default=".",
        help="Workspace root used to store stable relative paths (default: cwd).",
    )
    parser.add_argument(
        "--hash-all",
        action="store_true",
        help="Compute sha256 for every file even when size/mtime matches cache (slower).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-analyzing headings even if the file fingerprint matches (slower).",
    )
    parser.add_argument(
        "--prune-missing",
        action="store_true",
        help="Remove cached entries whose files no longer exist under workspace-root.",
    )
    parser.add_argument(
        "paths",
        nargs="+",
        help="Files or directories to scan for .docx.",
    )
    args = parser.parse_args()

    workspace_root = Path(args.workspace_root).resolve()
    index_path = Path(args.index)
    index_data = _read_index(index_path)
    if not isinstance(index_data, dict):
        index_data = {}

    list_headings = _load_heading_lister()

    inputs = [Path(p) for p in args.paths]
    docx_paths = sorted({p.resolve() for p in _iter_docx_paths(inputs)})

    updated_at = _now_iso()
    changed = 0
    skipped = 0
    errored = 0

    for docx_path in docx_paths:
        key = _safe_relpath(docx_path, workspace_root)
        existing = index_data.get(key, {})
        if not isinstance(existing, dict):
            existing = {}

        size, mtime_ms = _stat_fingerprint(docx_path)
        same_stat = existing.get("size") == size and existing.get("mtimeMs") == mtime_ms

        need_hash = args.hash_all or not same_stat or not isinstance(existing.get("sha256"), str)
        sha = existing.get("sha256")
        if need_hash:
            try:
                sha = _sha256_file(docx_path)
            except Exception as e:
                index_data[key] = {
                    "updatedAt": updated_at,
                    "size": size,
                    "mtimeMs": mtime_ms,
                    "error": f"hash_failed: {e}",
                }
                errored += 1
                continue

        same_hash = isinstance(sha, str) and sha and existing.get("sha256") == sha
        if same_hash and same_stat and not args.force:
            # Keep existing headings if present.
            existing.update({"updatedAt": updated_at, "size": size, "mtimeMs": mtime_ms, "sha256": sha})
            index_data[key] = existing
            skipped += 1
            continue

        # (Re)analyze headings
        try:
            headings = list_headings(str(docx_path))
            headings_json = [
                {"level": int(h.level), "text": str(h.text), "elementCount": int(h.element_count)}
                for h in headings
            ]
            index_data[key] = {
                "updatedAt": updated_at,
                "analyzedAt": updated_at,
                "sha256": sha,
                "size": size,
                "mtimeMs": mtime_ms,
                "headings": headings_json,
            }
            changed += 1
        except Exception as e:
            index_data[key] = {
                "updatedAt": updated_at,
                "sha256": sha,
                "size": size,
                "mtimeMs": mtime_ms,
                "error": f"heading_failed: {e}",
            }
            errored += 1

    if args.prune_missing:
        keys = list(index_data.keys())
        for key in keys:
            if not isinstance(key, str):
                continue
            # Only prune relative keys; keep absolute keys (unknown location).
            if os.path.isabs(key):
                continue
            candidate = (workspace_root / key).resolve()
            if not candidate.exists():
                del index_data[key]

    _atomic_write_json(index_path, index_data)

    print(
        json.dumps(
            {
                "index": str(index_path),
                "workspaceRoot": str(workspace_root),
                "filesFound": len(docx_paths),
                "updated": changed,
                "skipped": skipped,
                "errors": errored,
                "updatedAt": updated_at,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

