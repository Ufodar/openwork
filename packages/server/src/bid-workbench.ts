import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError } from "./errors.js";
import { ensureDir, exists, shortId } from "./utils.js";

export type BidWorkbenchSourceType =
  | "tender"
  | "reference"
  | "output"
  | "templates";

export type BidWorkbenchStructureSourceKind =
  | "template"
  | "tender"
  | "manual-outline"
  | "derived-outline";

export type BidWorkbenchWorkflowStage =
  | "outline"
  | "mapping"
  | "drafting"
  | "merge";

export type BidWorkbenchCompositionMode =
  | "strict-reference"
  | "reference-guided"
  | "free-generation";

export type BidWorkbenchRefreshConflictState =
  | "none"
  | "needs-review"
  | "orphaned";

export type BidWorkbenchOutputKind = "draft" | "candidate" | "final";

export type BidWorkbenchMarkKind =
  | "note"
  | "risk"
  | "todo"
  | "decision";

export type BidWorkbenchOutputState = {
  path: string;
  kind: BidWorkbenchOutputKind;
  createdBySessionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BidWorkbenchSourceRangeKind =
  | "page-range"
  | "section-ref"
  | "anchor"
  | "note";

export type BidWorkbenchSourceRangeState = {
  id: string;
  sourcePath: string;
  rangeKind: BidWorkbenchSourceRangeKind;
  rangeValue: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BidWorkbenchNodeState = {
  id: string;
  title: string;
  level: number;
  parentId: string | null;
  children: string[];
  isLeaf: boolean;
  sessionId: string | null;
  activeSessionId: string | null;
  lastSessionId: string | null;
  runtimeScopeKey: string | null;
  lockedBy: string | null;
  lockedAt: number | null;
  recentPromptAuthor: string | null;
  recentPromptAt: number | null;
  participants: string[];
  compositionMode: BidWorkbenchCompositionMode;
  assignee: string | null;
  referencePaths: string[];
  sourceRanges: BidWorkbenchSourceRangeState[];
  outputPaths: string[];
  outputs: BidWorkbenchOutputState[];
  primaryOutputPath: string | null;
  lastEditedOutputPath: string | null;
  templatePath: string | null;
  mergedIntoMaster: boolean;
  mergeRequested: boolean;
  mergeApplied: boolean;
  mergeFailed: boolean;
  mergedOutputPath: string | null;
  refreshConflictState: BidWorkbenchRefreshConflictState;
  sourcePath: string;
  sourceLocator: string;
  orderIndex: number;
};

export type BidWorkbenchMarkState = {
  id: string;
  nodeId: string;
  author: string;
  kind: BidWorkbenchMarkKind;
  text: string;
  createdAt: number;
};

export type BidWorkbenchProjectState = {
  outlineSourcePath: string | null;
  outlineSourceType: BidWorkbenchSourceType | null;
  structureSourceKind: BidWorkbenchStructureSourceKind | null;
  rootOutputPath: string | null;
  workflowStage: BidWorkbenchWorkflowStage;
  outlineRevision: number;
  updatedAt: number;
};

export type BidWorkbenchConstraintsState = {
  formatRules: Record<string, unknown>;
  extractedFromPath: string | null;
  updatedAt: number;
};

export type BidWorkbenchConstraintsUpdateInput = {
  formatRules: Record<string, unknown>;
  extractedFromPath: string | null;
};

export type BidWorkbenchRefreshState = {
  runId: string;
  sourcePath: string;
  sourceHash: string;
  status: string;
  summary: string;
  createdAt: number;
} | null;

export type BidWorkbenchMergeJobStatus =
  | "requested"
  | "applied"
  | "failed";

export type BidWorkbenchMergeJobState = {
  id: string;
  sectionId: string;
  outputPath: string;
  rootOutputPath: string;
  status: BidWorkbenchMergeJobStatus;
  errorSummary: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BidWorkbenchState = {
  schemaVersion: 3;
  project: BidWorkbenchProjectState;
  constraints: BidWorkbenchConstraintsState;
  nodes: BidWorkbenchNodeState[];
  marks: BidWorkbenchMarkState[];
  refresh: BidWorkbenchRefreshState;
  mergeJobs: BidWorkbenchMergeJobState[];
};

type ExtractedSection = {
  id: string;
  title: string;
  level: number;
  parentId: string | null;
  orderIndex: number;
  sourcePath: string;
  sourceLocator: string;
  sourceHash: string;
  structuralKey: string;
};

type OutlineItem = {
  title: string;
  level: number;
  sourceLocator: string;
  orderIndex: number;
};

const DOCX_EXTENSIONS = new Set([".docx", ".docm", ".dotx", ".dotm"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);
const NODE_OUTPUT_EXTENSIONS = new Set([".docx", ".xlsx"]);

function resolveExtractOutlineScriptPath(): string {
  const sourceRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const execRoot = resolve(dirname(process.execPath), "..", "..", "..", "..");
  const cwdRoot = resolve(process.cwd());
  const candidateRoots = [sourceRoot, execRoot, cwdRoot];

  for (const root of candidateRoots) {
    const candidate = join(root, ".opencode", "runtime-support", "bid-workbench", "extract_outline.py");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new ApiError(
    500,
    "bid_workbench_outline_extractor_missing",
    "Bid workbench outline extractor script is missing",
    { candidateRoots },
  );
}

function resolveBidWorkbenchRoot(workspacePath: string): string {
  return join(workspacePath, ".openwork", "bid-workbench");
}

function resolveBidWorkbenchDbPath(workspacePath: string): string {
  return join(resolveBidWorkbenchRoot(workspacePath), "state.db");
}

function resolveInboxDir(workspacePath: string): string {
  return join(workspacePath, ".opencode", "openwork", "inbox");
}

function resolveSharedDocumentFilePath(workspacePath: string, relativePath: string): string {
  const docsRoot = resolve(workspacePath, "documents");
  const normalized = String(relativePath ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const absolutePath = resolve(docsRoot, normalized);
  const rel = relative(docsRoot, absolutePath);
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  if (!segments.length || segments.includes("..") || isAbsolute(rel)) {
    throw new ApiError(
      400,
      "bid_workbench_invalid_source_path",
      "Bid workbench source path must stay inside the shared documents root",
      { relativePath },
    );
  }
  return absolutePath;
}

function hashSectionId(sourcePath: string, key: string): string {
  return createHash("sha256")
    .update(`${sourcePath}::${key}`)
    .digest("hex")
    .slice(0, 24);
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function intToBool(value: unknown): boolean {
  return Number(value) === 1;
}

function normalizeOutputKind(value: unknown): BidWorkbenchOutputKind {
  const normalized = String(value ?? "draft").trim();
  return normalized === "candidate" || normalized === "final" ? normalized : "draft";
}

function normalizeCompositionMode(value: unknown): BidWorkbenchCompositionMode {
  const normalized = String(value ?? "strict-reference").trim();
  if (normalized === "reference-guided" || normalized === "free-generation") return normalized;
  return "strict-reference";
}

function normalizeWorkflowStage(value: unknown): BidWorkbenchWorkflowStage {
  const normalized = String(value ?? "outline").trim();
  if (normalized === "mapping" || normalized === "drafting" || normalized === "merge") return normalized;
  return "outline";
}

function normalizeRefreshConflictState(value: unknown): BidWorkbenchRefreshConflictState {
  const normalized = String(value ?? "none").trim();
  if (normalized === "needs-review" || normalized === "orphaned") return normalized;
  return "none";
}

function normalizeSourceRangeKind(value: unknown): BidWorkbenchSourceRangeKind {
  const normalized = String(value ?? "note").trim();
  if (normalized === "page-range" || normalized === "section-ref" || normalized === "anchor") {
    return normalized;
  }
  return "note";
}

function normalizeMergeJobStatus(value: unknown): BidWorkbenchMergeJobStatus {
  const normalized = String(value ?? "requested").trim();
  if (normalized === "applied" || normalized === "failed") return normalized;
  return "requested";
}

function normalizeFormatRules(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseFormatRulesJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return normalizeFormatRules(JSON.parse(value));
  } catch {
    return {};
  }
}

function ensureDocxOutlineSource(sourcePath: string): void {
  const extension = extname(sourcePath).toLowerCase();
  if (!DOCX_EXTENSIONS.has(extension)) {
    throw new ApiError(
      400,
      "bid_workbench_invalid_outline_source",
      "Production bid workbench outline sources must be DOCX files",
      { sourcePath },
    );
  }
}

function ensureRootOutputPath(path: string | null): void {
  if (!path) return;
  const extension = extname(path).toLowerCase();
  if (extension !== ".docx") {
    throw new ApiError(
      400,
      "bid_workbench_invalid_root_output",
      "Bid workbench root output must be a DOCX file",
      { path },
    );
  }
}

function ensureNodeOutputPath(path: string): void {
  const extension = extname(path).toLowerCase();
  if (!NODE_OUTPUT_EXTENSIONS.has(extension)) {
    throw new ApiError(
      400,
      "bid_workbench_invalid_node_output",
      "Bid workbench node outputs must be DOCX or XLSX files",
      { path },
    );
  }
}

function openDb(workspacePath: string): Database {
  const db = new Database(resolveBidWorkbenchDbPath(workspacePath));
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

async function ensureSchema(workspacePath: string): Promise<void> {
  await ensureDir(resolveBidWorkbenchRoot(workspacePath));
  const db = openDb(workspacePath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bid_workbench_project (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        outline_source_path TEXT,
        outline_source_type TEXT,
        structure_source_kind TEXT,
        root_output_path TEXT,
        workflow_stage TEXT NOT NULL DEFAULT 'outline',
        outline_revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bid_workbench_constraints (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        format_rules_json TEXT NOT NULL DEFAULT '{}',
        extracted_from_path TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bid_workbench_sections (
        node_id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        source_locator TEXT NOT NULL,
        structural_key TEXT NOT NULL,
        title TEXT NOT NULL,
        level INTEGER NOT NULL,
        parent_node_id TEXT,
        order_index INTEGER NOT NULL,
        source_hash TEXT NOT NULL,
        is_leaf INTEGER NOT NULL,
        active_session_id TEXT,
        last_session_id TEXT,
        runtime_scope_key TEXT,
        composition_mode TEXT NOT NULL DEFAULT 'strict-reference',
        assignee TEXT,
        locked_by TEXT,
        locked_at INTEGER,
        recent_prompt_author TEXT,
        recent_prompt_at INTEGER,
        merge_requested INTEGER NOT NULL DEFAULT 0,
        merge_applied INTEGER NOT NULL DEFAULT 0,
        merge_failed INTEGER NOT NULL DEFAULT 0,
        primary_output_path TEXT,
        last_edited_output_path TEXT,
        merged_output_path TEXT,
        refresh_conflict_state TEXT NOT NULL DEFAULT 'none',
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bid_workbench_section_links (
        id TEXT PRIMARY KEY,
        section_node_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(section_node_id) REFERENCES bid_workbench_sections(node_id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS bid_workbench_section_links_unique_idx
      ON bid_workbench_section_links(section_node_id, kind, path);

      CREATE TABLE IF NOT EXISTS bid_workbench_section_outputs (
        id TEXT PRIMARY KEY,
        section_node_id TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_by_session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(section_node_id) REFERENCES bid_workbench_sections(node_id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS bid_workbench_section_outputs_unique_idx
      ON bid_workbench_section_outputs(section_node_id, path);

      CREATE TABLE IF NOT EXISTS bid_workbench_section_ranges (
        id TEXT PRIMARY KEY,
        section_node_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        range_kind TEXT NOT NULL,
        range_value TEXT NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(section_node_id) REFERENCES bid_workbench_sections(node_id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS bid_workbench_section_ranges_unique_idx
      ON bid_workbench_section_ranges(section_node_id, source_path, range_kind, range_value);

      CREATE TABLE IF NOT EXISTS bid_workbench_section_marks (
        id TEXT PRIMARY KEY,
        section_node_id TEXT NOT NULL,
        author TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(section_node_id) REFERENCES bid_workbench_sections(node_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bid_workbench_section_participants (
        section_node_id TEXT NOT NULL,
        username TEXT NOT NULL,
        first_prompt_at INTEGER NOT NULL,
        last_prompt_at INTEGER NOT NULL,
        PRIMARY KEY(section_node_id, username),
        FOREIGN KEY(section_node_id) REFERENCES bid_workbench_sections(node_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bid_workbench_message_authors (
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS bid_workbench_refresh_runs (
        id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bid_workbench_merge_jobs (
        id TEXT PRIMARY KEY,
        section_node_id TEXT NOT NULL,
        output_path TEXT NOT NULL,
        root_output_path TEXT NOT NULL,
        status TEXT NOT NULL,
        error_summary TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(section_node_id) REFERENCES bid_workbench_sections(node_id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS bid_workbench_merge_jobs_unique_idx
      ON bid_workbench_merge_jobs(section_node_id, output_path, root_output_path);
    `);
    try {
      db.exec(`ALTER TABLE bid_workbench_sections ADD COLUMN recent_prompt_author TEXT;`);
    } catch {}
    try {
      db.exec(`ALTER TABLE bid_workbench_sections ADD COLUMN recent_prompt_at INTEGER;`);
    } catch {}
    db.exec(`DROP INDEX IF EXISTS bid_workbench_sections_source_locator_idx;`);
    db.exec(`
      CREATE INDEX IF NOT EXISTS bid_workbench_sections_source_locator_idx
      ON bid_workbench_sections(source_path, source_locator);
    `);
  } finally {
    db.close();
  }
}

function buildExtractedSections(
  sourcePath: string,
  items: OutlineItem[],
): ExtractedSection[] {
  const stack: Array<{ id: string; level: number }> = [];
  const structuralCounts: number[] = [];

  return items.map((item) => {
    const level = Math.max(1, Math.round(item.level));
    while (structuralCounts.length < level - 1) {
      structuralCounts.push(1);
    }
    structuralCounts.length = level;
    structuralCounts[level - 1] = (structuralCounts[level - 1] ?? 0) + 1;

    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }

    const structuralPath = structuralCounts.slice(0, level).join(".");
    const id = hashSectionId(sourcePath, structuralPath);
    const parentId = stack[stack.length - 1]?.id ?? null;
    stack.push({ id, level });

    return {
      id,
      title: item.title,
      level,
      parentId,
      orderIndex: item.orderIndex,
      sourcePath,
      sourceLocator: item.sourceLocator,
      structuralKey: structuralPath,
      sourceHash: createHash("sha256")
        .update(`${item.title}::${level}::${structuralPath}`)
        .digest("hex"),
    } satisfies ExtractedSection;
  });
}

function extractMarkdownSections(sourcePath: string, content: string): ExtractedSection[] {
  const lines = content.split(/\r?\n/);
  const items: OutlineItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const level = match[1]?.length ?? 1;
    const title = (match[2] ?? "").trim();
    if (!title) continue;
    items.push({
      title,
      level,
      sourceLocator: `line:${index + 1}`,
      orderIndex: items.length,
    });
  }

  return buildExtractedSections(sourcePath, items);
}

function extractDocxSections(workspacePath: string, sourcePath: string, absolutePath: string): ExtractedSection[] {
  const result = spawnSync("python3", [resolveExtractOutlineScriptPath(), absolutePath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new ApiError(
      400,
      "bid_workbench_outline_extract_failed",
      stderr || stdout || "Failed to extract outline from source document",
      { sourcePath, workspacePath },
    );
  }

  let parsed: Array<{ title?: string; level?: number; locator?: string }> = [];
  try {
    parsed = JSON.parse(String(result.stdout || "[]")) as Array<{
      title?: string;
      level?: number;
      locator?: string;
    }>;
  } catch {
    throw new ApiError(
      500,
      "bid_workbench_outline_extract_invalid",
      "Outline extractor returned invalid JSON",
      { sourcePath },
    );
  }

  const items: OutlineItem[] = parsed
    .map((item, index) => ({
      title: String(item.title ?? "").trim(),
      level: Math.max(1, Math.round(Number(item.level ?? 1))),
      sourceLocator: String(item.locator ?? `paragraph:${index + 1}`).trim(),
      orderIndex: index,
    }))
    .filter((item) => item.title.length > 0);

  return buildExtractedSections(sourcePath, items);
}

async function extractSectionsFromSource(
  workspacePath: string,
  sourcePath: string,
): Promise<{ sections: ExtractedSection[]; sourceHash: string }> {
  const absolutePath = resolveSharedDocumentFilePath(workspacePath, sourcePath);
  if (!(await exists(absolutePath))) {
    throw new ApiError(404, "bid_workbench_source_not_found", "Outline source file not found", {
      sourcePath,
    });
  }

  const info = await stat(absolutePath);
  const sourceHash = createHash("sha256")
    .update(`${sourcePath}:${info.size}:${info.mtimeMs}`)
    .digest("hex");

  const extension = extname(sourcePath).toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    const content = await ((Bun as any).file(absolutePath)).text() as string;
    const sections = extractMarkdownSections(sourcePath, content);
    if (sections.length === 0) {
      throw new ApiError(
        400,
        "bid_workbench_outline_empty",
        "The selected source does not expose a stable heading structure",
        { sourcePath },
      );
    }
    return { sections, sourceHash };
  }

  if (DOCX_EXTENSIONS.has(extension)) {
    const sections = extractDocxSections(workspacePath, sourcePath, absolutePath);
    if (sections.length === 0) {
      throw new ApiError(
        400,
        "bid_workbench_outline_empty",
        "The selected source does not expose a stable heading structure",
        { sourcePath },
      );
    }
    return { sections, sourceHash };
  }

  throw new ApiError(
    400,
    "bid_workbench_unsupported_source",
    "Outline source currently supports Markdown and DOCX files only",
    { sourcePath },
  );
}

function composeNodeState(
  rows: Array<Record<string, unknown>>,
  links: Array<Record<string, unknown>>,
  outputs: Array<Record<string, unknown>>,
  ranges: Array<Record<string, unknown>>,
  participantsRows: Array<Record<string, unknown>>,
): BidWorkbenchNodeState[] {
  const linkMap = new Map<string, { referencePaths: string[]; outputPaths: string[]; templatePath: string | null }>();
  const outputMap = new Map<string, BidWorkbenchOutputState[]>();
  const rangeMap = new Map<string, BidWorkbenchSourceRangeState[]>();
  const participantsMap = new Map<string, string[]>();

  for (const row of rows) {
    const nodeId = String(row.node_id);
    linkMap.set(nodeId, {
      referencePaths: [],
      outputPaths: [],
      templatePath: null,
    });
    outputMap.set(nodeId, []);
    rangeMap.set(nodeId, []);
    participantsMap.set(nodeId, []);
  }

  for (const link of links) {
    const nodeId = String(link.section_node_id);
    const bucket = linkMap.get(nodeId);
    if (!bucket) continue;
    const kind = String(link.kind);
    const path = String(link.path);
    if (kind === "reference") {
      bucket.referencePaths.push(path);
    } else if (kind === "output") {
      bucket.outputPaths.push(path);
    } else if (kind === "template") {
      bucket.templatePath = path;
    }
  }

  for (const output of outputs) {
    const nodeId = String(output.section_node_id);
    const bucket = outputMap.get(nodeId);
    if (!bucket) continue;
    bucket.push({
      path: String(output.path),
      kind: normalizeOutputKind(output.kind),
      createdBySessionId: output.created_by_session_id ? String(output.created_by_session_id) : null,
      createdAt: Number(output.created_at),
      updatedAt: Number(output.updated_at),
    });
  }

  for (const range of ranges) {
    const nodeId = String(range.section_node_id);
    const bucket = rangeMap.get(nodeId);
    if (!bucket) continue;
    bucket.push({
      id: String(range.id),
      sourcePath: String(range.source_path),
      rangeKind: normalizeSourceRangeKind(range.range_kind),
      rangeValue: String(range.range_value),
      note: range.note ? String(range.note) : null,
      createdAt: Number(range.created_at),
      updatedAt: Number(range.updated_at),
    });
  }

  for (const participant of participantsRows) {
    const nodeId = String(participant.section_node_id);
    const author = String(participant.username ?? "").trim();
    if (!author) continue;
    const bucket = participantsMap.get(nodeId);
    if (!bucket) continue;
    if (!bucket.includes(author)) bucket.push(author);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    const parentId = row.parent_node_id ? String(row.parent_node_id) : null;
    if (!parentId) continue;
    const bucket = childrenByParent.get(parentId) ?? [];
    bucket.push(String(row.node_id));
    childrenByParent.set(parentId, bucket);
  }

  return rows.map((row) => {
    const nodeId = String(row.node_id);
    const paths = linkMap.get(nodeId) ?? {
      referencePaths: [],
      outputPaths: [],
      templatePath: null,
    };
    const nodeOutputs = outputMap.get(nodeId) ?? [];
    const nodeRanges = rangeMap.get(nodeId) ?? [];
    const participants = participantsMap.get(nodeId) ?? [];
    const children = childrenByParent.get(nodeId) ?? [];
    return {
      id: nodeId,
      title: String(row.title),
      level: Number(row.level),
      parentId: row.parent_node_id ? String(row.parent_node_id) : null,
      children,
      isLeaf: children.length === 0,
      sessionId: row.active_session_id ? String(row.active_session_id) : null,
      activeSessionId: row.active_session_id ? String(row.active_session_id) : null,
      lastSessionId: row.last_session_id ? String(row.last_session_id) : null,
      runtimeScopeKey: row.runtime_scope_key ? String(row.runtime_scope_key) : null,
      lockedBy: row.locked_by ? String(row.locked_by) : null,
      lockedAt:
        typeof row.locked_at === "number" ? Number(row.locked_at) : row.locked_at ? Number(row.locked_at) : null,
      recentPromptAuthor: row.recent_prompt_author ? String(row.recent_prompt_author) : null,
      recentPromptAt:
        typeof row.recent_prompt_at === "number"
          ? Number(row.recent_prompt_at)
          : row.recent_prompt_at
            ? Number(row.recent_prompt_at)
            : null,
      participants,
      compositionMode: normalizeCompositionMode(row.composition_mode),
      assignee: row.assignee ? String(row.assignee) : null,
      referencePaths: paths.referencePaths,
      sourceRanges: nodeRanges,
      outputPaths: paths.outputPaths,
      outputs: nodeOutputs,
      primaryOutputPath: row.primary_output_path ? String(row.primary_output_path) : null,
      lastEditedOutputPath: row.last_edited_output_path ? String(row.last_edited_output_path) : null,
      templatePath: paths.templatePath,
      mergedIntoMaster: intToBool(row.merge_requested) || intToBool(row.merge_applied),
      mergeRequested: intToBool(row.merge_requested),
      mergeApplied: intToBool(row.merge_applied),
      mergeFailed: intToBool(row.merge_failed),
      mergedOutputPath: row.merged_output_path ? String(row.merged_output_path) : null,
      refreshConflictState: normalizeRefreshConflictState(row.refresh_conflict_state),
      sourcePath: String(row.source_path),
      sourceLocator: String(row.source_locator),
      orderIndex: Number(row.order_index),
    } satisfies BidWorkbenchNodeState;
  });
}

export async function getBidWorkbenchState(workspacePath: string): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const db = openDb(workspacePath);
  try {
    const projectRow = db
      .query(
        `SELECT outline_source_path, outline_source_type, structure_source_kind,
                root_output_path, workflow_stage, outline_revision, updated_at
         FROM bid_workbench_project WHERE id = 1`,
      )
      .get() as Record<string, unknown> | null;

    const constraintsRow = db
      .query(
        `SELECT format_rules_json, extracted_from_path, updated_at
         FROM bid_workbench_constraints WHERE id = 1`,
      )
      .get() as Record<string, unknown> | null;

    const sectionRows = db
      .query(
        `SELECT node_id, source_path, source_locator, structural_key, title, level, parent_node_id, order_index,
                source_hash, is_leaf, active_session_id, last_session_id, runtime_scope_key,
                composition_mode, assignee, locked_by, locked_at, recent_prompt_author, recent_prompt_at,
                merge_requested, merge_applied, merge_failed,
                primary_output_path, last_edited_output_path, merged_output_path, refresh_conflict_state
         FROM bid_workbench_sections
         WHERE active = 1
         ORDER BY order_index ASC, level ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    const links = db
      .query(
        `SELECT id, section_node_id, kind, path, created_at
         FROM bid_workbench_section_links`,
      )
      .all() as Array<Record<string, unknown>>;

    const outputs = db
      .query(
        `SELECT id, section_node_id, path, kind, created_by_session_id, created_at, updated_at
         FROM bid_workbench_section_outputs
         ORDER BY created_at ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    const ranges = db
      .query(
        `SELECT id, section_node_id, source_path, range_kind, range_value, note, created_at, updated_at
         FROM bid_workbench_section_ranges
         ORDER BY created_at ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    const participants = db
      .query(
        `SELECT section_node_id, username, first_prompt_at, last_prompt_at
         FROM bid_workbench_section_participants
         ORDER BY first_prompt_at ASC, username ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    const marks = db
      .query(
        `SELECT m.id, m.section_node_id, m.author, m.kind, m.text, m.created_at
         FROM bid_workbench_section_marks m
         INNER JOIN bid_workbench_sections s
           ON s.node_id = m.section_node_id
         WHERE s.active = 1
         ORDER BY m.created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    const refreshRow = db
      .query(
        `SELECT id, source_path, source_hash, status, summary, created_at
         FROM bid_workbench_refresh_runs
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get() as Record<string, unknown> | null;

    const mergeJobs = db
      .query(
        `SELECT id, section_node_id, output_path, root_output_path, status, error_summary, created_at, updated_at
         FROM bid_workbench_merge_jobs
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    return {
      schemaVersion: 3,
      project: {
        outlineSourcePath: projectRow?.outline_source_path
          ? String(projectRow.outline_source_path)
          : null,
        outlineSourceType: projectRow?.outline_source_type
          ? (String(projectRow.outline_source_type) as BidWorkbenchSourceType)
          : null,
        structureSourceKind: projectRow?.structure_source_kind
          ? (String(projectRow.structure_source_kind) as BidWorkbenchStructureSourceKind)
          : null,
        rootOutputPath: projectRow?.root_output_path
          ? String(projectRow.root_output_path)
          : null,
        workflowStage: normalizeWorkflowStage(projectRow?.workflow_stage),
        outlineRevision: projectRow?.outline_revision
          ? Number(projectRow.outline_revision)
          : 0,
        updatedAt: projectRow?.updated_at ? Number(projectRow.updated_at) : 0,
      },
      constraints: {
        formatRules: parseFormatRulesJson(constraintsRow?.format_rules_json),
        extractedFromPath: constraintsRow?.extracted_from_path
          ? String(constraintsRow.extracted_from_path)
          : null,
        updatedAt: constraintsRow?.updated_at ? Number(constraintsRow.updated_at) : 0,
      },
      nodes: composeNodeState(sectionRows, links, outputs, ranges, participants),
      marks: marks.map((row) => ({
        id: String(row.id),
        nodeId: String(row.section_node_id),
        author: String(row.author),
        kind: String(row.kind) as BidWorkbenchMarkKind,
        text: String(row.text),
        createdAt: Number(row.created_at),
      })),
      refresh: refreshRow
        ? {
            runId: String(refreshRow.id),
            sourcePath: String(refreshRow.source_path),
            sourceHash: String(refreshRow.source_hash),
            status: String(refreshRow.status),
            summary: String(refreshRow.summary),
            createdAt: Number(refreshRow.created_at),
          }
        : null,
      mergeJobs: mergeJobs.map((row) => ({
        id: String(row.id),
        sectionId: String(row.section_node_id),
        outputPath: String(row.output_path),
        rootOutputPath: String(row.root_output_path),
        status: normalizeMergeJobStatus(row.status),
        errorSummary: row.error_summary ? String(row.error_summary) : null,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      })),
    };
  } finally {
    db.close();
  }
}

function buildNodePath(nodeId: string, nodesById: Map<string, BidWorkbenchNodeState>): string {
  const titles: string[] = [];
  const seen = new Set<string>();
  let current = nodesById.get(nodeId) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    titles.push(current.title);
    current = current.parentId ? nodesById.get(current.parentId) ?? null : null;
  }
  return titles.reverse().join(" / ");
}

async function writeBidWorkbenchNodeBrief(
  workspacePath: string,
  sectionId: string,
): Promise<void> {
  const state = await getBidWorkbenchState(workspacePath);
  const nodesById = new Map(state.nodes.map((node) => [node.id, node] as const));
  const node = nodesById.get(sectionId);
  if (!node) return;
  const briefPath = join(resolveBidWorkbenchRoot(workspacePath), "node-briefs", `${sectionId}.md`);
  await ensureDir(join(resolveBidWorkbenchRoot(workspacePath), "node-briefs"));
  const lines = [
    `# 节点任务简报：${node.title}`,
    "",
    `- 节点 ID：${node.id}`,
    `- 章节路径：${buildNodePath(node.id, nodesById) || node.title}`,
    `- 层级：L${node.level}`,
    `- 生成模式：${node.compositionMode}`,
    `- 负责人：${node.assignee ?? "未指定"}`,
    `- 最近发送人：${node.recentPromptAuthor ?? "暂无"}`,
    `- 来源文件：${node.sourcePath}`,
    `- 来源定位：${node.sourceLocator}`,
    `- 当前主产出：${node.primaryOutputPath ?? "未指定"}`,
    `- 模板文件：${node.templatePath ?? "未绑定"}`,
    "",
    "## 参考文件",
    ...(node.referencePaths.length
      ? node.referencePaths.map((path) => `- ${path}`)
      : ["- 暂无参考文件绑定"]),
    "",
    "## 范围选择",
    ...(node.sourceRanges.length
      ? node.sourceRanges.map(
          (range) =>
            `- ${range.sourcePath} | ${range.rangeKind} | ${range.rangeValue}${range.note ? ` | ${range.note}` : ""}`,
        )
      : ["- 暂无范围选择"]),
    "",
    "## 产出文件",
    ...(node.outputs.length
      ? node.outputs.map((output) => `- ${output.path} (${output.kind})`)
      : ["- 暂无节点产出"]),
    "",
    "## 运行约束",
    "- 只处理当前节点对应的章节内容，不要越界修改其他节点。",
    "- 允许基于当前节点的主产出或已有产出继续迭代。",
    "- 不要直接修改总文档正文；需要合并时通过工作台登记合并。",
    "",
  ];
  await writeFile(briefPath, lines.join("\n"), "utf8");
}

export async function setBidWorkbenchOutlineSource(
  workspacePath: string,
  input: {
    sourcePath: string;
    sourceType: BidWorkbenchSourceType;
    structureSourceKind: BidWorkbenchStructureSourceKind;
  },
): Promise<BidWorkbenchState> {
  ensureDocxOutlineSource(input.sourcePath);
  await ensureSchema(workspacePath);
  const now = Date.now();
  const db = openDb(workspacePath);
  try {
    db.run(
      `INSERT INTO bid_workbench_project(
         id, outline_source_path, outline_source_type, structure_source_kind,
         root_output_path, workflow_stage, outline_revision, updated_at
       )
       VALUES (1, ?, ?, ?, NULL, 'outline', 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         outline_source_path = excluded.outline_source_path,
         outline_source_type = excluded.outline_source_type,
         structure_source_kind = excluded.structure_source_kind,
         workflow_stage = 'outline',
         updated_at = excluded.updated_at`,
      [input.sourcePath, input.sourceType, input.structureSourceKind, now],
    );
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}

export async function setBidWorkbenchProjectRootOutput(
  workspacePath: string,
  input: { rootOutputPath: string | null },
): Promise<BidWorkbenchState> {
  ensureRootOutputPath(input.rootOutputPath);
  await ensureSchema(workspacePath);
  const now = Date.now();
  const db = openDb(workspacePath);
  try {
    db.run(
      `INSERT INTO bid_workbench_project(
         id, outline_source_path, outline_source_type, structure_source_kind,
         root_output_path, workflow_stage, outline_revision, updated_at
       )
       VALUES (1, NULL, NULL, NULL, ?, 'outline', 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         root_output_path = excluded.root_output_path,
         updated_at = excluded.updated_at`,
      [input.rootOutputPath, now],
    );
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}

export async function setBidWorkbenchProjectWorkflowStage(
  workspacePath: string,
  input: { workflowStage: BidWorkbenchWorkflowStage },
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const now = Date.now();
  const db = openDb(workspacePath);
  try {
    db.run(
      `INSERT INTO bid_workbench_project(
         id, outline_source_path, outline_source_type, structure_source_kind,
         root_output_path, workflow_stage, outline_revision, updated_at
       )
       VALUES (1, NULL, NULL, NULL, NULL, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         workflow_stage = excluded.workflow_stage,
         updated_at = excluded.updated_at`,
      [input.workflowStage, now],
    );
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}

export async function setBidWorkbenchProjectConstraints(
  workspacePath: string,
  input: BidWorkbenchConstraintsUpdateInput,
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const now = Date.now();
  const db = openDb(workspacePath);
  try {
    db.run(
      `INSERT INTO bid_workbench_constraints(
         id, format_rules_json, extracted_from_path, updated_at
       )
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         format_rules_json = excluded.format_rules_json,
         extracted_from_path = excluded.extracted_from_path,
         updated_at = excluded.updated_at`,
      [
        JSON.stringify(normalizeFormatRules(input.formatRules)),
        input.extractedFromPath,
        now,
      ],
    );
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}

export async function refreshBidWorkbenchState(
  workspacePath: string,
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const db = openDb(workspacePath);
  try {
    const project = db
      .query(
        `SELECT outline_source_path, outline_source_type, structure_source_kind, outline_revision
         FROM bid_workbench_project WHERE id = 1`,
      )
      .get() as Record<string, unknown> | null;

    const outlineSourcePath = project?.outline_source_path
      ? String(project.outline_source_path)
      : null;
    if (!outlineSourcePath) {
      throw new ApiError(
        400,
        "bid_workbench_outline_source_missing",
        "Outline source is not configured",
      );
    }

    const { sections, sourceHash } = await extractSectionsFromSource(
      workspacePath,
      outlineSourcePath,
    );
    const now = Date.now();
    const seen = new Set(sections.map((section) => section.id));

    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      for (const section of sections) {
        db.run(
          `INSERT INTO bid_workbench_sections(
             node_id, source_path, source_locator, structural_key, title, level, parent_node_id, order_index,
             source_hash, is_leaf, active_session_id, last_session_id, runtime_scope_key,
             composition_mode, assignee, locked_by, locked_at, recent_prompt_author, recent_prompt_at,
             merge_requested, merge_applied, merge_failed,
             primary_output_path, last_edited_output_path, merged_output_path,
             refresh_conflict_state, active, created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             NULL, NULL, NULL,
             'strict-reference', NULL, NULL, NULL, NULL, NULL,
             0, 0, 0,
             NULL, NULL, NULL,
             'none', 1, ?, ?
           )
           ON CONFLICT(node_id) DO UPDATE SET
             source_path = excluded.source_path,
             source_locator = excluded.source_locator,
             structural_key = excluded.structural_key,
             title = excluded.title,
             level = excluded.level,
             parent_node_id = excluded.parent_node_id,
             order_index = excluded.order_index,
             source_hash = excluded.source_hash,
             is_leaf = excluded.is_leaf,
             active = 1,
             updated_at = excluded.updated_at`,
          [
            section.id,
            section.sourcePath,
            section.sourceLocator,
            section.structuralKey,
            section.title,
            section.level,
            section.parentId,
            section.orderIndex,
            section.sourceHash,
            0,
            now,
            now,
          ],
        );
      }

      const existing = db
        .query(
          `SELECT node_id, active_session_id, locked_by, merge_requested, merge_applied,
                  primary_output_path, assignee, recent_prompt_author
           FROM bid_workbench_sections`,
        )
        .all() as Array<Record<string, unknown>>;

      const countLinksStmt = db.query(
        `SELECT COUNT(*) AS count
         FROM bid_workbench_section_links
         WHERE section_node_id = ?`,
      );
      const countMarksStmt = db.query(
        `SELECT COUNT(*) AS count
         FROM bid_workbench_section_marks
         WHERE section_node_id = ?`,
      );
      const countOutputsStmt = db.query(
        `SELECT COUNT(*) AS count
         FROM bid_workbench_section_outputs
         WHERE section_node_id = ?`,
      );

      let inactiveCount = 0;
      let deletedCount = 0;
      for (const row of existing) {
        const nodeId = String(row.node_id);
        if (seen.has(nodeId)) continue;
        const linkCountRow = countLinksStmt.get(nodeId) as Record<string, unknown> | null;
        const markCountRow = countMarksStmt.get(nodeId) as Record<string, unknown> | null;
        const outputCountRow = countOutputsStmt.get(nodeId) as Record<string, unknown> | null;
        const linkCount = Number(linkCountRow?.count ?? 0);
        const markCount = Number(markCountRow?.count ?? 0);
        const outputCount = Number(outputCountRow?.count ?? 0);
        const hasState =
          Boolean(row.active_session_id) ||
          Boolean(row.locked_by) ||
          Boolean(row.recent_prompt_author) ||
          intToBool(row.merge_requested) ||
          intToBool(row.merge_applied) ||
          Boolean(row.primary_output_path) ||
          Boolean(row.assignee) ||
          linkCount > 0 ||
          markCount > 0 ||
          outputCount > 0;
        if (hasState) {
          db.run(
            `UPDATE bid_workbench_sections
             SET active = 0, refresh_conflict_state = 'needs-review', updated_at = ?
             WHERE node_id = ?`,
            [now, nodeId],
          );
          inactiveCount += 1;
        } else {
          db.run(`DELETE FROM bid_workbench_sections WHERE node_id = ?`, [nodeId]);
          deletedCount += 1;
        }
      }

      db.run(
        `INSERT INTO bid_workbench_project(
           id, outline_source_path, outline_source_type, structure_source_kind,
           root_output_path, workflow_stage, outline_revision, updated_at
         )
         VALUES (1, ?, ?, ?, NULL, 'outline', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           outline_revision = excluded.outline_revision,
           updated_at = excluded.updated_at`,
        [
          outlineSourcePath,
          project?.outline_source_type ? String(project.outline_source_type) : null,
          project?.structure_source_kind ? String(project.structure_source_kind) : null,
          Number(project?.outline_revision ?? 0) + 1,
          now,
        ],
      );

      const summary = `sections=${sections.length};inactive=${inactiveCount};deleted=${deletedCount}`;
      db.run(
        `INSERT INTO bid_workbench_refresh_runs(id, source_path, source_hash, status, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [shortId(), outlineSourcePath, sourceHash, "ok", summary, now],
      );

      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    db.close();
  }

  return getBidWorkbenchState(workspacePath);
}

export async function setBidWorkbenchSectionSession(
  workspacePath: string,
  input: { sectionId: string; sessionId: string | null },
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const now = Date.now();
  const db = openDb(workspacePath);
  try {
    const runtimeScopeKey = input.sessionId
      ? `bid-workbench/runtime/${input.sectionId}/${input.sessionId}`
      : null;
    db.run(
      `UPDATE bid_workbench_sections
       SET active_session_id = ?,
           last_session_id = COALESCE(?, last_session_id),
           runtime_scope_key = ?,
           updated_at = ?
       WHERE node_id = ?`,
      [input.sessionId, input.sessionId, runtimeScopeKey, now, input.sectionId],
    );
  } finally {
    db.close();
  }
  if (input.sessionId) {
    await writeBidWorkbenchNodeBrief(workspacePath, input.sectionId);
  }
  return getBidWorkbenchState(workspacePath);
}

export async function setBidWorkbenchSectionMetadata(
  workspacePath: string,
  input: {
    sectionId: string;
    compositionMode?: BidWorkbenchCompositionMode;
    assignee?: string | null;
  },
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const db = openDb(workspacePath);
  try {
    if (input.compositionMode !== undefined) {
      db.run(
        `UPDATE bid_workbench_sections
         SET composition_mode = ?, updated_at = ?
         WHERE node_id = ?`,
        [input.compositionMode, Date.now(), input.sectionId],
      );
    }
    if (input.assignee !== undefined) {
      db.run(
        `UPDATE bid_workbench_sections
         SET assignee = ?, updated_at = ?
         WHERE node_id = ?`,
        [input.assignee, Date.now(), input.sectionId],
      );
    }
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}


export async function setBidWorkbenchSectionLock(
  workspacePath: string,
  input: { sectionId: string; lockedBy: string | null },
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const now = Date.now();
  const db = openDb(workspacePath);
  try {
    db.run(
      `UPDATE bid_workbench_sections
       SET locked_by = ?, locked_at = ?, updated_at = ?
       WHERE node_id = ?`,
      [input.lockedBy, input.lockedBy ? now : null, now, input.sectionId],
    );
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}

export async function getBidWorkbenchSectionCollaborationState(
  workspacePath: string,
  sectionId: string,
): Promise<{ lockedBy: string | null; activeSessionId: string | null; bidNodeExists: boolean }> {
  await ensureSchema(workspacePath);
  const db = openDb(workspacePath);
  try {
    const row = db
      .query(
        `SELECT node_id, locked_by, active_session_id
         FROM bid_workbench_sections
         WHERE node_id = ? AND active = 1`,
      )
      .get(sectionId) as Record<string, unknown> | null;
    return {
      lockedBy: row?.locked_by ? String(row.locked_by) : null,
      activeSessionId: row?.active_session_id ? String(row.active_session_id) : null,
      bidNodeExists: Boolean(row?.node_id),
    };
  } finally {
    db.close();
  }
}

export async function acquireBidWorkbenchSectionLock(
  workspacePath: string,
  input: { sectionId: string; actor: string; acquiredAt?: number },
): Promise<{ ok: true } | { ok: false; lockedBy: string }> {
  await ensureSchema(workspacePath);
  const actor = input.actor.trim();
  if (!actor) {
    throw new ApiError(400, "invalid_bid_workbench_actor", "Bid workbench actor is required");
  }
  const now = input.acquiredAt ?? Date.now();
  const db = openDb(workspacePath);
  try {
    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      const row = db
        .query(
          `SELECT node_id, locked_by
           FROM bid_workbench_sections
           WHERE node_id = ? AND active = 1`,
        )
        .get(input.sectionId) as Record<string, unknown> | null;
      if (!row?.node_id) {
        db.exec("ROLLBACK;");
        throw new ApiError(404, "bid_workbench_section_not_found", "Bid workbench section not found");
      }
      const lockedBy = row.locked_by ? String(row.locked_by) : null;
      if (lockedBy && lockedBy !== actor) {
        db.exec("COMMIT;");
        return { ok: false, lockedBy };
      }
      db.run(
        `UPDATE bid_workbench_sections
         SET locked_by = ?, locked_at = ?, updated_at = ?
         WHERE node_id = ?`,
        [actor, now, now, input.sectionId],
      );
      db.exec("COMMIT;");
      return { ok: true };
    } catch (error) {
      try {
        db.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  } finally {
    db.close();
  }
}


export async function recordBidWorkbenchMessageAuthor(
  workspacePath: string,
  input: { sessionId: string; messageId: string; author: string; createdAt?: number },
): Promise<void> {
  await ensureSchema(workspacePath);
  const sessionId = input.sessionId.trim();
  const messageId = input.messageId.trim();
  const author = input.author.trim();
  if (!sessionId || !messageId || !author) return;
  const now = input.createdAt ?? Date.now();
  const db = openDb(workspacePath);
  try {
    db.run(
      `INSERT INTO bid_workbench_message_authors(session_id, message_id, author, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, message_id) DO UPDATE SET
         author = excluded.author`,
      [sessionId, messageId, author, now],
    );
  } finally {
    db.close();
  }
}

export async function listBidWorkbenchMessageAuthors(
  workspacePath: string,
  sessionId: string,
): Promise<Map<string, string>> {
  await ensureSchema(workspacePath);
  const sid = sessionId.trim();
  const result = new Map<string, string>();
  if (!sid) return result;
  const db = openDb(workspacePath);
  try {
    const rows = db.query(
      `SELECT message_id, author FROM bid_workbench_message_authors WHERE session_id = ?`,
    ).all(sid) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const messageId = row.message_id ? String(row.message_id) : "";
      const author = row.author ? String(row.author) : "";
      if (messageId && author) result.set(messageId, author);
    }
  } finally {
    db.close();
  }
  return result;
}
export async function recordBidWorkbenchSectionPromptActivity(
  workspacePath: string,
  input: { sectionId: string; author: string; promptedAt?: number },
): Promise<void> {
  await ensureSchema(workspacePath);
  const author = input.author.trim();
  if (!author) return;
  const now = input.promptedAt ?? Date.now();
  const db = openDb(workspacePath);
  try {
    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      db.run(
        `UPDATE bid_workbench_sections
         SET locked_by = ?, locked_at = ?, recent_prompt_author = ?, recent_prompt_at = ?, updated_at = ?
         WHERE node_id = ?`,
        [author, now, author, now, now, input.sectionId],
      );
      db.run(
        `INSERT INTO bid_workbench_section_participants(
           section_node_id, username, first_prompt_at, last_prompt_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(section_node_id, username)
         DO UPDATE SET
           last_prompt_at = excluded.last_prompt_at`,
        [input.sectionId, author, now, now],
      );
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function setBidWorkbenchSectionMergedState(
  workspacePath: string,
  input: {
    sectionId: string;
    mergeRequested: boolean;
    mergeApplied: boolean;
    mergeFailed: boolean;
    outputPath: string | null;
    rootOutputPath: string | null;
    errorSummary?: string | null;
  },
): Promise<BidWorkbenchState> {
  if (input.outputPath) ensureNodeOutputPath(input.outputPath);
  ensureRootOutputPath(input.rootOutputPath);
  await ensureSchema(workspacePath);
  const now = Date.now();
  const nextMergeStatus: BidWorkbenchMergeJobStatus | null = input.mergeApplied
    ? "applied"
    : input.mergeFailed
      ? "failed"
      : input.mergeRequested
        ? "requested"
        : null;
  const db = openDb(workspacePath);
  try {
    db.run(
      `UPDATE bid_workbench_sections
       SET merge_requested = ?, merge_applied = ?, merge_failed = ?, merged_output_path = ?, updated_at = ?
       WHERE node_id = ?`,
      [
        boolToInt(input.mergeRequested),
        boolToInt(input.mergeApplied),
        boolToInt(input.mergeFailed),
        input.outputPath,
        now,
        input.sectionId,
      ],
    );
    if (nextMergeStatus && input.outputPath && input.rootOutputPath) {
      db.run(
        `INSERT INTO bid_workbench_merge_jobs(
           id, section_node_id, output_path, root_output_path, status, error_summary, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(section_node_id, output_path, root_output_path)
         DO UPDATE SET
           status = excluded.status,
           error_summary = excluded.error_summary,
           updated_at = excluded.updated_at`,
        [
          shortId(),
          input.sectionId,
          input.outputPath,
          input.rootOutputPath,
          nextMergeStatus,
          input.errorSummary?.trim() || null,
          now,
          now,
        ],
      );
    }
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}

export async function setBidWorkbenchSectionPrimaryOutput(
  workspacePath: string,
  input: { sectionId: string; primaryOutputPath: string | null },
): Promise<BidWorkbenchState> {
  if (input.primaryOutputPath) ensureNodeOutputPath(input.primaryOutputPath);
  await ensureSchema(workspacePath);
  const db = openDb(workspacePath);
  try {
    db.run(
      `UPDATE bid_workbench_sections
       SET primary_output_path = ?, last_edited_output_path = ?, updated_at = ?
       WHERE node_id = ?`,
      [input.primaryOutputPath, input.primaryOutputPath, Date.now(), input.sectionId],
    );
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}

export async function addBidWorkbenchSectionRange(
  workspacePath: string,
  input: {
    sectionId: string;
    sourcePath: string;
    rangeKind: BidWorkbenchSourceRangeKind;
    rangeValue: string;
    note?: string | null;
  },
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const now = Date.now();
  const rangeValue = input.rangeValue.trim();
  if (!rangeValue) {
    throw new ApiError(400, "invalid_payload", "Range value is required");
  }
  const db = openDb(workspacePath);
  try {
    db.run(
      `INSERT OR IGNORE INTO bid_workbench_section_ranges(
         id, section_node_id, source_path, range_kind, range_value, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shortId(),
        input.sectionId,
        input.sourcePath,
        input.rangeKind,
        rangeValue,
        input.note?.trim() || null,
        now,
        now,
      ],
    );
  } finally {
    db.close();
  }
  await writeBidWorkbenchNodeBrief(workspacePath, input.sectionId);
  return getBidWorkbenchState(workspacePath);
}

export async function deleteBidWorkbenchSectionRange(
  workspacePath: string,
  rangeId: string,
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  let sectionId: string | null = null;
  const db = openDb(workspacePath);
  try {
    const row = db
      .query(`SELECT section_node_id FROM bid_workbench_section_ranges WHERE id = ?`)
      .get(rangeId) as Record<string, unknown> | null;
    sectionId = row?.section_node_id ? String(row.section_node_id) : null;
    db.run(`DELETE FROM bid_workbench_section_ranges WHERE id = ?`, [rangeId]);
  } finally {
    db.close();
  }
  if (sectionId) {
    await writeBidWorkbenchNodeBrief(workspacePath, sectionId);
  }
  return getBidWorkbenchState(workspacePath);
}

export async function setBidWorkbenchSectionLink(
  workspacePath: string,
  input: {
    sectionId: string;
    kind: "reference" | "output" | "template" | "master-output";
    path: string;
    selected: boolean;
  },
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const db = openDb(workspacePath);
  try {
    if (input.kind === "output") {
      ensureNodeOutputPath(input.path);
    }
    if (!input.selected) {
      db.run(
        `DELETE FROM bid_workbench_section_links
         WHERE section_node_id = ? AND kind = ? AND path = ?`,
        [input.sectionId, input.kind, input.path],
      );
      if (input.kind === "output") {
        db.run(
          `DELETE FROM bid_workbench_section_outputs
           WHERE section_node_id = ? AND path = ?`,
          [input.sectionId, input.path],
        );
      }
    } else {
      if (input.kind === "template") {
        db.run(
          `DELETE FROM bid_workbench_section_links
           WHERE section_node_id = ? AND kind = 'template'`,
          [input.sectionId],
        );
      }
      db.run(
        `INSERT OR IGNORE INTO bid_workbench_section_links(id, section_node_id, kind, path, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [shortId(), input.sectionId, input.kind, input.path, Date.now()],
      );
      if (input.kind === "output") {
        db.run(
          `INSERT OR IGNORE INTO bid_workbench_section_outputs(
             id, section_node_id, path, kind, created_by_session_id, created_at, updated_at
           ) VALUES (?, ?, ?, 'draft', NULL, ?, ?)`,
          [shortId(), input.sectionId, input.path, Date.now(), Date.now()],
        );
      }
    }
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}

export async function addBidWorkbenchSectionMark(
  workspacePath: string,
  input: {
    sectionId: string;
    author: string;
    kind: BidWorkbenchMarkKind;
    text: string;
  },
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const db = openDb(workspacePath);
  try {
    db.run(
      `INSERT INTO bid_workbench_section_marks(id, section_node_id, author, kind, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [shortId(), input.sectionId, input.author, input.kind, input.text, Date.now()],
    );
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}

export async function deleteBidWorkbenchSectionMark(
  workspacePath: string,
  markId: string,
): Promise<BidWorkbenchState> {
  await ensureSchema(workspacePath);
  const db = openDb(workspacePath);
  try {
    db.run(`DELETE FROM bid_workbench_section_marks WHERE id = ?`, [markId]);
  } finally {
    db.close();
  }
  return getBidWorkbenchState(workspacePath);
}
