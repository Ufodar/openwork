import type {
  OpenworkBidWorkbenchCompositionMode,
  OpenworkBidWorkbenchMark,
  OpenworkBidWorkbenchSourceType,
  OpenworkBidWorkbenchState,
  OpenworkBidWorkbenchStructureSourceKind,
} from "../../lib/openwork-server";

export type BidWorkbenchFileCategory = "tender" | "reference" | "output" | "templates";
export type BidWorkbenchTab = "overview" | "workspace" | "constraints";
export type BidWorkbenchWorkspaceFile = {
  path: string;
  size: number;
  updatedAt: number;
  type: string;
  originalName?: string;
  title?: string;
};

export const FILE_CATEGORY_ROOTS: Record<BidWorkbenchFileCategory, string> = {
  tender: "bid-workbench/tender",
  reference: "bid-workbench/reference",
  output: "bid-workbench/output",
  templates: "bid-workbench/templates",
};

export const CATEGORY_LABELS: Record<BidWorkbenchFileCategory, string> = {
  tender: "招标文件",
  reference: "参考文件",
  output: "产出文件",
  templates: "投标模板文件",
};

export const TAB_LABELS: Record<BidWorkbenchTab, string> = {
  overview: "总览",
  workspace: "工作台",
  constraints: "全局约束",
};

export const STRUCTURE_SOURCE_KIND_LABELS: Record<OpenworkBidWorkbenchStructureSourceKind, string> = {
  template: "模板主导",
  tender: "招标主导",
  "manual-outline": "人工结构主导",
  "derived-outline": "派生结构主导",
};

export const COMPOSITION_MODE_LABELS: Record<OpenworkBidWorkbenchCompositionMode, string> = {
  "strict-reference": "严格引用",
  "reference-guided": "参考生成",
  "free-generation": "自由生成",
};

export const MARK_KIND_LABELS: Record<OpenworkBidWorkbenchMark["kind"], string> = {
  note: "备注",
  risk: "风险",
  todo: "待办",
  decision: "决定",
};

export const DEFAULT_NODE_AUTHOR = "当前用户";

export const EMPTY_WORKBENCH_STATE: OpenworkBidWorkbenchState = {
  schemaVersion: 3,
  project: {
    outlineSourcePath: null,
    outlineSourceType: null,
    structureSourceKind: null,
    rootOutputPath: null,
    workflowStage: "outline",
    outlineRevision: 0,
    updatedAt: 0,
  },
  constraints: {
    formatRules: {},
    extractedFromPath: null,
    updatedAt: 0,
  },
  nodes: [],
  marks: [],
  refresh: null,
  mergeJobs: [],
};

export function formatTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "未记录";
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

export function displayPathTail(path: string, depth = 2): string {
  const segments = String(path ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length <= depth) return segments.join("/");
  return segments.slice(-depth).join("/");
}

export function displayFileName(path: string): string {
  const segments = String(path ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  return segments.at(-1) ?? path;
}

export function formatFileSize(size: number | null | undefined): string {
  const bytes = Number(size ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function inferStructureSourceKind(
  sourceType: OpenworkBidWorkbenchSourceType,
): OpenworkBidWorkbenchStructureSourceKind {
  switch (sourceType) {
    case "templates":
      return "template";
    case "tender":
      return "tender";
    case "output":
      return "manual-outline";
    case "reference":
      return "derived-outline";
  }
}
