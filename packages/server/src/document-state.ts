import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { exists } from "./utils.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function buildPayload(relativePath: string, value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (record) return { relativePath, ...record };
  return { relativePath, value: value as JsonValue };
}

async function readJson(path: string): Promise<unknown | null> {
  if (!(await exists(path))) return null;
  try {
    const raw = await readFile(path, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function listJsonEntries(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function readFirstAvailable(runtimeDir: string, relativePaths: string[]): Promise<Record<string, unknown> | null> {
  for (const relativePath of relativePaths) {
    const parsed = await readJson(join(runtimeDir, relativePath));
    if (parsed === null) continue;
    return buildPayload(relativePath, parsed);
  }
  return null;
}

async function inferDocumentStatePhase(runtimeDir: string, fallback: string | null): Promise<string | null> {
  if (await exists(join(runtimeDir, ".worktree", "verify", "coverage.json"))) return "verify";
  if (await exists(join(runtimeDir, ".worktree", "plan", "solution-plan.json"))) return "plan";
  if (
    await exists(join(runtimeDir, ".worktree", "facts.json")) ||
    await exists(join(runtimeDir, ".worktree", "merge", "conflicts.json"))
  ) {
    return "merge";
  }
  const sourceFiles = await listJsonEntries(join(runtimeDir, ".worktree", "sources"));
  if (sourceFiles.some((path) => basename(path) !== "manifest.json")) return "source-compilation";
  return fallback;
}

export async function readDocumentStateBrief(runtimeDir: string): Promise<Record<string, unknown> | null> {
  const relativePath = ".worktree/index.json";
  const parsed = await readJson(join(runtimeDir, relativePath));
  const record = asRecord(parsed);
  if (!record) return null;
  const rawPhase = typeof record.phase === "string" ? record.phase : null;
  return {
    relativePath,
    version: typeof record.version === "number" ? record.version : 1,
    project: typeof record.project === "string" ? record.project : null,
    phase: await inferDocumentStatePhase(runtimeDir, rawPhase),
    targetDoc: typeof record.target_doc === "string" ? record.target_doc : null,
    currentFocus: typeof record.current_focus === "string" ? record.current_focus : null,
    summary: typeof record.summary === "string"
      ? record.summary
      : asRecord(record.summary),
  };
}

export async function listDocumentStateSources(runtimeDir: string): Promise<Array<Record<string, unknown>>> {
  const roots = [
    { relativeRoot: ".worktree/sources", absRoot: join(runtimeDir, ".worktree", "sources") },
    { relativeRoot: ".worktree/nodes", absRoot: join(runtimeDir, ".worktree", "nodes") },
  ];
  const items: Array<Record<string, unknown>> = [];
  for (const root of roots) {
    const files = await listJsonEntries(root.absRoot);
    for (const absPath of files) {
      const parsed = await readJson(absPath);
      const record = asRecord(parsed) ?? {};
      const fileName = basename(absPath);
      if (fileName === "manifest.json" && typeof record.docId !== "string" && typeof record.id !== "string") {
        continue;
      }
      const relativePath = `${root.relativeRoot}/${fileName}`;
      const claimLike = Array.isArray(record.claims)
        ? record.claims
        : Array.isArray(record.facts)
          ? record.facts
          : Array.isArray(record.materials)
            ? record.materials
            : [];
      const gapLike = Array.isArray(record.gaps)
        ? record.gaps
        : Array.isArray(record.open_questions)
          ? record.open_questions
          : [];
      items.push({
        docId: typeof record.docId === "string"
          ? record.docId
          : typeof record.id === "string"
            ? record.id
            : fileName.replace(/\.json$/, ""),
        title: typeof record.title === "string"
          ? record.title
          : typeof record.name === "string"
            ? record.name
            : null,
        relativePath,
        claimCount: claimLike.length,
        gapCount: gapLike.length,
      });
    }
  }
  return items;
}

export async function readDocumentStateDoc(runtimeDir: string, docId: string): Promise<Record<string, unknown> | null> {
  const normalized = docId.trim();
  if (!normalized) return null;
  const roots = [
    { relativeRoot: ".worktree/sources", absRoot: join(runtimeDir, ".worktree", "sources") },
    { relativeRoot: ".worktree/nodes", absRoot: join(runtimeDir, ".worktree", "nodes") },
  ];
  for (const root of roots) {
    const files = await listJsonEntries(root.absRoot);
    for (const absPath of files) {
      const parsed = await readJson(absPath);
      const record = asRecord(parsed) ?? {};
      const fileName = basename(absPath);
      const derivedId = typeof record.docId === "string"
        ? record.docId
        : typeof record.id === "string"
          ? record.id
          : fileName.replace(/\.json$/, "");
      if (derivedId !== normalized && fileName !== `${normalized}.json`) continue;
      return buildPayload(`${root.relativeRoot}/${fileName}`, record);
    }
  }
  return null;
}

export async function readDocumentStateFacts(runtimeDir: string): Promise<Record<string, unknown> | null> {
  return readFirstAvailable(runtimeDir, [
    ".worktree/facts.json",
    ".bid/facts.json",
  ]);
}

export async function readDocumentStateConflicts(runtimeDir: string): Promise<Record<string, unknown> | null> {
  return readFirstAvailable(runtimeDir, [
    ".worktree/merge/conflicts.json",
    ".worktree/conflicts.json",
  ]);
}

export async function readDocumentStatePlan(runtimeDir: string): Promise<Record<string, unknown> | null> {
  return readFirstAvailable(runtimeDir, [
    ".worktree/plan/solution-plan.json",
    ".worktree/plan/plan.json",
    ".worktree/plan.json",
  ]);
}

export async function readDocumentStateCoverage(runtimeDir: string): Promise<Record<string, unknown> | null> {
  const direct = await readFirstAvailable(runtimeDir, [
    ".worktree/coverage.json",
    ".worktree/plan/coverage.json",
    ".worktree/verify/coverage.json",
  ]);
  if (direct) return direct;

  const reportsDir = join(runtimeDir, "reports");
  if (!(await exists(reportsDir))) return null;
  const entries = await readdir(reportsDir, { withFileTypes: true });
  const modules = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  return { relativePath: "reports", modules };
}
