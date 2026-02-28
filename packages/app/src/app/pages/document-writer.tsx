import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { ArrowRight, AtSign, CheckCircle2, ChevronDown, Download, FileText, Folder, FolderArchive, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Trash2, X } from "lucide-solid";
import { useNavigate } from "@solidjs/router";

import type { ComposerDraft, SlashCommandOption } from "../types";
import type { SessionViewProps } from "./session";
import OnlyOfficeEditor from "../components/onlyoffice-editor";
import MessageList from "../components/session/message-list";
import Composer from "../components/session/composer";
import { DOCUMENT_UPLOAD_ACCEPT } from "../lib/documents";
import { currentLocale, t as i18n } from "../../i18n";

type DocumentItem = {
  name: string;
  updatedAt: number;
  size: number;
  type: string;
};

type DocumentWriterUiState = {
  schemaVersion: 1;
  activeDoc?: string;
  leftPaneWidth?: number;
  rightPaneWidth?: number;
};

type InboxItem = {
  id: string;
  path: string;
  size: number;
  updatedAt: number;
};

type RefFolderNode = {
  name: string;
  path: string;
  folders: RefFolderNode[];
  files: InboxItem[];
};

type OnlyOfficePayload = { documentServerUrl: string; config: any };
type EditorSource = {
  baseUrl: string;
  token: string;
  workspaceId: string;
  sessionId: string;
  doc: string;
  seq: number;
  readonly: boolean;
};

const ONLYOFFICE_IMPORT_EXTENSIONS = new Set(
  DOCUMENT_UPLOAD_ACCEPT.split(",")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean),
);
const IMAGE_PREVIEW_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"]);
const MARKDOWN_PREVIEW_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);
const TEXT_PREVIEW_EXTENSIONS = new Set([
  ".txt",
  ".text",
  ".log",
  ".out",
  ".err",
  ".trace",
  ".csv",
  ".tsv",
  ".psv",
  ".json",
  ".jsonl",
  ".ndjson",
  ".geojson",
  ".jsonc",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".cnf",
  ".cfg",
  ".properties",
  ".props",
  ".dotenv",
  ".env",
  ".xml",
  ".xsd",
  ".xsl",
  ".xslt",
  ".html",
  ".htm",
  ".mhtml",
  ".sql",
  ".ddl",
  ".dml",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".py",
  ".rb",
  ".php",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rs",
  ".swift",
  ".scala",
  ".lua",
  ".r",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".hh",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".proto",
  ".graphql",
  ".gql",
  ".service",
  ".timer",
  ".socket",
  ".mount",
  ".target",
  ".ics",
  ".vcf",
  ".eml",
  ".srt",
  ".vtt",
]);
const TEXT_PREVIEW_BASENAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  ".env",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".npmrc",
  ".gitconfig",
  ".bashrc",
  ".zshrc",
  "jenkinsfile",
  "procfile",
  "kustomization",
  "hosts",
]);
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

const isOnlyOfficeImportable = (path: string) => {
  const base = path.split("/").pop() ?? path;
  const match = base.toLowerCase().match(/\.[^.]+$/);
  if (!match) return false;
  return ONLYOFFICE_IMPORT_EXTENSIONS.has(match[0]);
};

const DOCX_SECTION_COPY_SOURCE_EXTENSIONS = new Set([".docx", ".docm", ".dotx", ".dotm", ".doc"]);
const RUNNING_REFRESH_INTERVAL_MS = 60_000;
const LEFT_PANEL_COLLAPSED_WIDTH = 56;
const LEFT_PANEL_DEFAULT_WIDTH = 256;
const LEFT_PANEL_MIN_WIDTH = 220;
const RIGHT_PANEL_DEFAULT_WIDTH = 500;
const RIGHT_PANEL_MIN_WIDTH = 360;
const CENTER_PANEL_MIN_WIDTH = 520;
const STREAM_SCROLL_MIN_INTERVAL_MS = 90;
const INBOX_PATH_PREFIXES = [".opencode/openwork/inbox/", "opencode/openwork/inbox/", "openwork/inbox/"] as const;

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const normalizeInboxPath = (value: string) => {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
  for (const prefix of INBOX_PATH_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
};

const getFileExtension = (value: string) => {
  const base = value.split("/").pop() ?? value;
  const match = base.toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
};
const getFileBaseName = (value: string) => (value.split("/").pop() ?? value).toLowerCase();
const isImagePreviewable = (path: string) => IMAGE_PREVIEW_EXTENSIONS.has(getFileExtension(path));
const isMarkdownPreviewable = (path: string) => MARKDOWN_PREVIEW_EXTENSIONS.has(getFileExtension(path));
const isTextPreviewable = (path: string) => {
  const ext = getFileExtension(path);
  if (TEXT_PREVIEW_EXTENSIONS.has(ext)) return true;
  const base = getFileBaseName(path);
  if (TEXT_PREVIEW_BASENAMES.has(base)) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  return false;
};
const formatPreviewBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isDocxSectionCopySource = (value: string) => DOCX_SECTION_COPY_SOURCE_EXTENSIONS.has(getFileExtension(value));
const isTemplateDocName = (value: string) => {
  const normalized = value.trim().replace(/^\/+/, "");
  return (
    normalized.startsWith(".refs/templates/") ||
    normalized.startsWith("refs/templates/") ||
    normalized.startsWith("templates/")
  );
};

const normalizeRelativePath = (value: string, fallback = "file") => {
  const cleaned = value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  const parts = cleaned
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return parts.length ? parts.join("/") : fallback;
};

const uploadRelativePath = (file: File) => {
  const candidate = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim() || file.name;
  return normalizeRelativePath(candidate, file.name || "file");
};

const hasHiddenPathSegment = (path: string) => {
  const normalized = normalizeRelativePath(path, "");
  if (!normalized) return false;
  return normalized.split("/").some((segment) => segment.startsWith("."));
};

const createRefFolderNode = (name: string, path: string): RefFolderNode => ({
  name,
  path,
  folders: [],
  files: [],
});

export default function DocumentWriterView(props: SessionViewProps) {
  const navigate = useNavigate();
  const tr = (key: string) => i18n(key, currentLocale());
  let chatContainerEl: HTMLDivElement | undefined;
  let messagesEndEl: HTMLDivElement | undefined;
  let bottomVisibilityEl: HTMLDivElement | undefined;
  let scrollFrame: number | undefined;
  let pendingScrollBehavior: ScrollBehavior = "auto";
  let lastAutoScrollAt = 0;

  const sessionId = createMemo(() => props.selectedSessionId?.trim() ?? "");
  const workspaceId = createMemo(() => props.openworkServerWorkspaceId?.trim() ?? "");
  const isAgentRunning = createMemo(() => (props.sessionStatus ?? "idle") === "running");

  const serverReady = createMemo(
    () =>
      props.openworkServerStatus === "connected" &&
      Boolean(props.openworkServerClient) &&
      Boolean(workspaceId()),
  );

  const apiConfig = createMemo(() => {
    const client = props.openworkServerClient;
    if (!client) return null;
    const workspace = workspaceId();
    const session = sessionId();
    if (!workspace || !session) return null;
    return {
      baseUrl: client.baseUrl,
      token: client.token?.trim() ?? "",
      workspaceId: workspace,
      sessionId: session,
    };
  });

  const buildUrl = (baseUrl: string, workspace: string, pathname: string, query?: URLSearchParams) => {
    const url = new URL(`/w/${encodeURIComponent(workspace)}${pathname}`, baseUrl);
    if (query) {
      url.search = query.toString();
    }
    return url.toString();
  };

  const fetchJson = async (url: string, token: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await fetch(url, { ...init, headers });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      try {
        const parsed = JSON.parse(text) as { message?: unknown; details?: any } | null;
        const message = parsed && typeof parsed.message === "string" ? parsed.message : "";
        const reportPath =
          parsed?.details?.report?.inboxPath && typeof parsed.details.report.inboxPath === "string"
            ? parsed.details.report.inboxPath
            : "";
        const suffix = reportPath ? `\n\nReport: ${reportPath}` : "";
        throw new Error((message || `Request failed (${response.status})`) + suffix);
      } catch {
        throw new Error(text || `Request failed (${response.status})`);
      }
    }
    return await response.json();
  };

  const docWriterStateKey = createMemo(() => {
    const w = workspaceId();
    const s = sessionId();
    if (!w || !s) return "";
    return `openwork.document-writer.ui.v1:${w}:${s}`;
  });

  const readDocWriterState = (key: string): DocumentWriterUiState | null => {
    if (!key || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<DocumentWriterUiState> | null;
      if (!parsed || parsed.schemaVersion !== 1) return null;
      return parsed as DocumentWriterUiState;
    } catch {
      return null;
    }
  };

  const writeDocWriterState = (key: string, state: DocumentWriterUiState) => {
    if (!key || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore
    }
  };

  // "Target" is the document we mutate via agent/tools. "Active" is what OnlyOffice currently displays.
  // Active can temporarily point at a reference preview while the target remains stable.
  const [targetDoc, setTargetDoc] = createSignal<string | null>(null);
  const [activeDoc, setActiveDoc] = createSignal<string | null>(null);
  const [documentsCollapsed, setDocumentsCollapsed] = createSignal(false);
  const [leftPaneWidth, setLeftPaneWidth] = createSignal(LEFT_PANEL_DEFAULT_WIDTH);
  const [rightPaneWidth, setRightPaneWidth] = createSignal(RIGHT_PANEL_DEFAULT_WIDTH);
  const [resizingPane, setResizingPane] = createSignal<"left" | "right" | null>(null);
  const [configSeq, setConfigSeq] = createSignal(0);
  const [archiveBusy, setArchiveBusy] = createSignal(false);
  const [otherDocsExpanded, setOtherDocsExpanded] = createSignal(false);
  const [lastSessionStatus, setLastSessionStatus] = createSignal(props.sessionStatus ?? "idle");
  const [refsExpanded, setRefsExpanded] = createSignal<Record<string, boolean>>({});
  const [refsFolderExpanded, setRefsFolderExpanded] = createSignal<Record<string, boolean>>({});
  const [refsActionMenuKey, setRefsActionMenuKey] = createSignal<string | null>(null);
  const [refsBusy, setRefsBusy] = createSignal(false);
  const [refsError, setRefsError] = createSignal<string | null>(null);
  const [refsUploadProgress, setRefsUploadProgress] = createSignal<{ categoryId: string; done: number; total: number } | null>(null);
  const [refsDeleteBusyId, setRefsDeleteBusyId] = createSignal<string | null>(null);
  const [refsOpenBusyId, setRefsOpenBusyId] = createSignal<string | null>(null);

  const [modulesExpanded, setModulesExpanded] = createSignal(true);
  const [moduleModal, setModuleModal] = createSignal<null | "assemble" | "facts" | "fill" | "dedupe" | "qc" | "preview">(null);
  const [assembleSource, setAssembleSource] = createSignal<InboxItem | null>(null);
  const [assembleMatchMode, setAssembleMatchMode] = createSignal<"contains" | "exact" | "startswith">("contains");
  const [assembleForce, setAssembleForce] = createSignal(false);
  const [assembleSeedTarget, setAssembleSeedTarget] = createSignal(false);
  const [assembleBusy, setAssembleBusy] = createSignal(false);
  const [assembleError, setAssembleError] = createSignal<string | null>(null);
  const [assembleQuery, setAssembleQuery] = createSignal("");
  const [factsTenderSource, setFactsTenderSource] = createSignal<InboxItem | null>(null);
  const [factsApplyToTarget, setFactsApplyToTarget] = createSignal(true);
  const [factsForce, setFactsForce] = createSignal(false);
  const [factsInsertBlock, setFactsInsertBlock] = createSignal(true);
  const [factsBusy, setFactsBusy] = createSignal(false);
  const [factsError, setFactsError] = createSignal<string | null>(null);
  const [fillTechXlsx, setFillTechXlsx] = createSignal<string>("");
  const [fillEquipXlsx, setFillEquipXlsx] = createSignal<string>("");
  const [fillBrand, setFillBrand] = createSignal("新华三");
  const [fillManufacturer, setFillManufacturer] = createSignal("新华三技术有限公司");
  const [fillOrigin, setFillOrigin] = createSignal("中国");
  const [fillUnit, setFillUnit] = createSignal("台");
  const [fillPricePlaceholder, setFillPricePlaceholder] = createSignal("详见报价文件");
  const [fillSpecPlaceholder, setFillSpecPlaceholder] = createSignal("详见开标分项一览表");
  const [fillBusy, setFillBusy] = createSignal(false);
  const [fillError, setFillError] = createSignal<string | null>(null);
  const [dedupeSelected, setDedupeSelected] = createSignal<Set<string>>(new Set());
  const [dedupeQuery, setDedupeQuery] = createSignal("");
  const [dedupeExcludeTables, setDedupeExcludeTables] = createSignal(true);
  const [dedupeSimThreshold, setDedupeSimThreshold] = createSignal(0.92);
  const [dedupeExportMedia, setDedupeExportMedia] = createSignal(false);
  const [dedupeIncludeTitles, setDedupeIncludeTitles] = createSignal("");
  const [dedupeExcludeTitles, setDedupeExcludeTitles] = createSignal("");
  const [dedupeBusy, setDedupeBusy] = createSignal(false);
  const [dedupeError, setDedupeError] = createSignal<string | null>(null);
  const [previewBusy, setPreviewBusy] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [qcBusy, setQcBusy] = createSignal(false);
  const [qcError, setQcError] = createSignal<string | null>(null);
  const [qcMode, setQcMode] = createSignal<"draft" | "submit">("draft");
  const [reportsExpanded, setReportsExpanded] = createSignal(false);
  const [nearBottom, setNearBottom] = createSignal(true);
  let paneResizeCleanup: (() => void) | null = null;

  const [documents, { refetch: refetchDocuments }] = createResource(apiConfig, async (cfg) => {
    if (!cfg) return [] as DocumentItem[];
    const query = new URLSearchParams();
    query.set("session", cfg.sessionId);
    const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/documents", query);
    const data = (await fetchJson(url, cfg.token)) as { items?: DocumentItem[] };
    return Array.isArray(data.items) ? data.items : [];
  });

  const documentsList = createMemo(() => documents() ?? []);
  const targetDocName = createMemo(() => (targetDoc() ?? "").trim());
  const otherDocsList = createMemo(() => {
    const name = targetDocName();
    const items = documentsList() ?? [];
    if (!name) return items;
    return items.filter((doc) => doc.name !== name);
  });

  const REF_CATEGORIES = [
    { id: "tender", label: "招标文件" },
    { id: "templates", label: "模板/格式" },
    { id: "business", label: "商务资料" },
    { id: "technical", label: "技术资料" },
    { id: "history", label: "历史标书" },
    { id: "partners", label: "合作方材料" },
    { id: "images", label: "图片/图纸" },
    { id: "other", label: "其他" },
  ] as const;

  const refsInboxPrefix = createMemo(() => {
    const id = sessionId();
    if (!id) return "";
    return `sessions/${id}/refs`;
  });

  const refsWorkspaceRoot = createMemo(() => {
    const prefix = refsInboxPrefix();
    if (!prefix) return "";
    return `.opencode/openwork/inbox/${prefix}`;
  });

  const refsFetchInput = createMemo(() => {
    const client = props.openworkServerClient;
    const w = workspaceId();
    const prefix = refsInboxPrefix();
    if (!client || !w || !prefix) return null;
    if (props.openworkServerStatus !== "connected") return null;
    return { client, workspaceId: w, prefix };
  });

  const [refs, { refetch: refetchRefs }] = createResource(refsFetchInput, async (input) => {
    if (!input) return [] as InboxItem[];
    const primary = await input.client.listInbox(input.workspaceId, { prefix: input.prefix });
    const primaryItems = Array.isArray(primary.items) ? (primary.items as InboxItem[]) : [];
    if (primaryItems.length > 0) return primaryItems;
    try {
      const fallback = await input.client.listInbox(input.workspaceId);
      const allItems = Array.isArray(fallback.items) ? (fallback.items as InboxItem[]) : [];
      const rootPrefix = `${input.prefix}/`;
      return allItems.filter((item) => normalizeInboxPath(item.path).startsWith(rootPrefix));
    } catch {
      return primaryItems;
    }
  });

  const reportsInboxPrefix = createMemo(() => {
    const id = sessionId();
    if (!id) return "";
    return `sessions/${id}/reports`;
  });

  const reportsWorkspaceRoot = createMemo(() => {
    const prefix = reportsInboxPrefix();
    if (!prefix) return "";
    return `.opencode/openwork/inbox/${prefix}`;
  });

  const reportsFetchInput = createMemo(() => {
    const client = props.openworkServerClient;
    const w = workspaceId();
    const prefix = reportsInboxPrefix();
    if (!client || !w || !prefix) return null;
    if (props.openworkServerStatus !== "connected") return null;
    return { client, workspaceId: w, prefix };
  });

  const refsSessionRemainder = (itemPath: string) => {
    const prefix = refsInboxPrefix();
    if (!prefix) return "";
    const normalized = normalizeInboxPath(itemPath);
    const rootPrefix = `${prefix}/`;
    if (!normalized.startsWith(rootPrefix)) return "";
    return normalized.slice(rootPrefix.length);
  };

  const inboxWorkspacePath = (itemPath: string) => `.opencode/openwork/inbox/${normalizeInboxPath(itemPath)}`;

  const [reports, { refetch: refetchReports }] = createResource(reportsFetchInput, async (input) => {
    if (!input) return [] as InboxItem[];
    const primary = await input.client.listInbox(input.workspaceId, { prefix: input.prefix });
    const primaryItems = Array.isArray(primary.items) ? (primary.items as InboxItem[]) : [];
    const items =
      primaryItems.length > 0
        ? primaryItems
        : await (async () => {
          try {
            const fallback = await input.client.listInbox(input.workspaceId);
            const allItems = Array.isArray(fallback.items) ? (fallback.items as InboxItem[]) : [];
            const rootPrefix = `${input.prefix}/`;
            return allItems.filter((item) => normalizeInboxPath(item.path).startsWith(rootPrefix));
          } catch {
            return primaryItems;
          }
        })();
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return items;
  });

  const refsByCategory = createMemo(() => {
    const items = refs() ?? [];
    const prefix = refsInboxPrefix();
    const result: Record<string, InboxItem[]> = Object.fromEntries(REF_CATEGORIES.map((c) => [c.id, []]));
    if (!prefix) return result;

    for (const item of items) {
      const remainder = refsSessionRemainder(item.path);
      if (!remainder) continue;
      const categoryId = remainder.split("/")[0] ?? "";
      if (!categoryId) continue;
      const bucket = result[categoryId];
      if (bucket) bucket.push(item);
      else result.other.push(item);
    }

    for (const list of Object.values(result)) {
      list.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return result;
  });

  const moduleSources = createMemo(() => {
    const byCategory = refsByCategory();
    const pool: InboxItem[] = [];
    for (const key of ["partners", "history", "templates", "tender", "other"] as const) {
      pool.push(...(byCategory[key] ?? []));
    }
    const seen = new Set<string>();
    return pool
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .filter((item) => isDocxSectionCopySource(item.path));
  });

  const tenderSources = createMemo(() => {
    const byCategory = refsByCategory();
    return (byCategory.tender ?? []).filter((item) => isDocxSectionCopySource(item.path));
  });

  const filteredModuleSources = createMemo(() => {
    const query = assembleQuery().trim().toLowerCase();
    const items = moduleSources();
    if (!query) return items;
    return items.filter((item) => (item.path.split("/").pop() ?? item.path).toLowerCase().includes(query));
  });

  const xlsxRefs = createMemo(() => {
    const items = refs() ?? [];
    return items.filter((item) => {
      const ext = getFileExtension(item.path);
      return ext === ".xlsx" || ext === ".xlsm";
    });
  });

  const xlsxRefsById = createMemo(() => {
    const map = new Map<string, InboxItem>();
    for (const item of xlsxRefs()) map.set(item.id, item);
    return map;
  });

  type DedupeCandidate =
    | {
      key: string;
      kind: "doc";
      name: string;
      updatedAt: number;
      sourceLabel: string;
    }
    | {
      key: string;
      kind: "inbox";
      inboxId: string;
      path: string;
      updatedAt: number;
      sourceLabel: string;
    };

  const dedupeCandidates = createMemo(() => {
    const target = targetDoc();

    const docCandidates: DedupeCandidate[] = (documentsList() ?? [])
      .filter((doc) => doc.name !== target)
      .filter((doc) => isDocxSectionCopySource(doc.name))
      .map((doc) => ({
        key: `doc:${doc.name}`,
        kind: "doc" as const,
        name: doc.name,
        updatedAt: doc.updatedAt,
        sourceLabel: "Session document",
      }));

    const inboxCandidates: DedupeCandidate[] = moduleSources().map((item) => {
      const remainder = refsSessionRemainder(item.path);
      const categoryId = (remainder.split("/")[0] ?? "other").trim() || "other";
      const categoryLabel = REF_CATEGORIES.find((c) => c.id === categoryId)?.label ?? "Reference";
      return {
        key: `inbox:${item.id}`,
        kind: "inbox" as const,
        inboxId: item.id,
        path: item.path,
        updatedAt: item.updatedAt,
        sourceLabel: categoryLabel,
      };
    });

    const combined = [...docCandidates, ...inboxCandidates];
    combined.sort((a, b) => b.updatedAt - a.updatedAt);
    return combined;
  });

  const filteredDedupeCandidates = createMemo(() => {
    const query = dedupeQuery().trim().toLowerCase();
    const items = dedupeCandidates();
    if (!query) return items;
    return items.filter((item) => {
      const name =
        item.kind === "doc"
          ? item.name.split("/").pop() ?? item.name
          : item.path.split("/").pop() ?? item.path;
      return name.toLowerCase().includes(query) || item.sourceLabel.toLowerCase().includes(query);
    });
  });

  const toggleDedupeSelection = (key: string) => {
    setDedupeSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const visibleReports = createMemo(() => {
    const items = reports() ?? [];
    if (reportsExpanded()) return items;
    return items.slice(0, 6);
  });

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    const shown = idx === 0 ? String(Math.trunc(value)) : value.toFixed(value >= 10 ? 1 : 2);
    return `${shown} ${units[idx]}`;
  };

  const downloadInboxFile = async (item: InboxItem, onError: (message: string) => void) => {
    const client = props.openworkServerClient;
    const w = workspaceId();
    if (!client || !w) return;
    try {
      const result = await client.downloadInbox(w, item.id);
      const blob = new Blob([result.data], { type: result.contentType ?? "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename ?? item.path.split("/").pop() ?? "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to download file";
      onError(message);
    }
  };

  const toggleRefsCategory = (categoryId: string) => {
    setRefsExpanded((current) => ({ ...current, [categoryId]: !current[categoryId] }));
  };

  const refsItemRelativePath = (categoryId: string, itemPath: string) => {
    const remainder = refsSessionRemainder(itemPath);
    if (!remainder) return normalizeInboxPath(itemPath);
    const categoryPrefix = `${categoryId}/`;
    if (remainder.startsWith(categoryPrefix)) {
      return remainder.slice(categoryPrefix.length);
    }
    return remainder;
  };

  const buildRefsFolderTree = (categoryId: string, items: InboxItem[]) => {
    const root = createRefFolderNode("", "");
    const folderByPath = new Map<string, RefFolderNode>([["", root]]);
    for (const item of items) {
      const relative = normalizeRelativePath(refsItemRelativePath(categoryId, item.path), item.path.split("/").pop() ?? "file");
      const segments = relative.split("/").filter(Boolean);
      const fileName = segments.pop();
      if (!fileName) continue;

      let parent = root;
      let currentPath = "";
      for (const segment of segments) {
        const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
        let folder = folderByPath.get(nextPath);
        if (!folder) {
          folder = createRefFolderNode(segment, nextPath);
          parent.folders.push(folder);
          folderByPath.set(nextPath, folder);
        }
        parent = folder;
        currentPath = nextPath;
      }
      parent.files.push(item);
    }

    const sortTree = (node: RefFolderNode) => {
      node.folders.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      node.files.sort((a, b) => {
        const an = refsItemRelativePath(categoryId, a.path);
        const bn = refsItemRelativePath(categoryId, b.path);
        return an.localeCompare(bn, "zh-Hans-CN");
      });
      for (const child of node.folders) sortTree(child);
    };
    sortTree(root);
    return root;
  };

  const refsFolderExpandedKey = (categoryId: string, path: string) => `${categoryId}:${path}`;

  const isRefsFolderExpanded = (categoryId: string, path: string) => {
    const key = refsFolderExpandedKey(categoryId, path);
    const value = refsFolderExpanded()[key];
    return value === undefined ? true : value;
  };

  const toggleRefsFolder = (categoryId: string, path: string) => {
    const key = refsFolderExpandedKey(categoryId, path);
    setRefsFolderExpanded((current) => {
      const next = { ...current };
      const value = next[key];
      next[key] = value === undefined ? false : !value;
      return next;
    });
  };

  const refsFileMenuKey = (categoryId: string, itemId: string) => `file:${categoryId}:${itemId}`;
  const refsFolderMenuKey = (categoryId: string, folderPath: string) => `folder:${categoryId}:${folderPath}`;
  const folderPromptPath = (categoryId: string, folderPath: string) => {
    const prefix = refsInboxPrefix();
    const normalized = normalizeRelativePath(folderPath, "");
    const suffix = normalized ? `/${normalized}` : "";
    return `.opencode/openwork/inbox/${prefix}/${categoryId}${suffix}/`;
  };

  const scrollToLatest = (behavior: ScrollBehavior = "auto") => {
    messagesEndEl?.scrollIntoView({ behavior, block: "end" });
  };

  const scheduleScrollToLatest = (behavior: ScrollBehavior = "auto") => {
    if (behavior === "smooth") {
      pendingScrollBehavior = "smooth";
    }
    if (scrollFrame !== undefined) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = undefined;
      const nextBehavior = pendingScrollBehavior;
      pendingScrollBehavior = "auto";
      const now = Date.now();
      if (nextBehavior === "auto" && now - lastAutoScrollAt < STREAM_SCROLL_MIN_INTERVAL_MS) {
        return;
      }
      lastAutoScrollAt = now;
      scrollToLatest(nextBehavior);
    });
  };

  const leftPaneDisplayWidth = createMemo(() =>
    documentsCollapsed() ? LEFT_PANEL_COLLAPSED_WIDTH : leftPaneWidth(),
  );

  const getViewportWidth = () => {
    if (typeof window === "undefined") {
      return LEFT_PANEL_DEFAULT_WIDTH + RIGHT_PANEL_DEFAULT_WIDTH + CENTER_PANEL_MIN_WIDTH;
    }
    return window.innerWidth || LEFT_PANEL_DEFAULT_WIDTH + RIGHT_PANEL_DEFAULT_WIDTH + CENTER_PANEL_MIN_WIDTH;
  };

  const clampPaneWidthsToViewport = () => {
    const viewport = getViewportWidth();
    const effectiveLeft = leftPaneDisplayWidth();

    const maxRight = Math.max(RIGHT_PANEL_MIN_WIDTH, viewport - effectiveLeft - CENTER_PANEL_MIN_WIDTH);
    const nextRight = clampNumber(rightPaneWidth(), RIGHT_PANEL_MIN_WIDTH, maxRight);
    if (nextRight !== rightPaneWidth()) {
      setRightPaneWidth(nextRight);
    }

    if (documentsCollapsed()) return;
    const maxLeft = Math.max(LEFT_PANEL_MIN_WIDTH, viewport - nextRight - CENTER_PANEL_MIN_WIDTH);
    const nextLeft = clampNumber(leftPaneWidth(), LEFT_PANEL_MIN_WIDTH, maxLeft);
    if (nextLeft !== leftPaneWidth()) {
      setLeftPaneWidth(nextLeft);
    }
  };

  const beginPaneResize = (pane: "left" | "right", event: MouseEvent) => {
    if (typeof window === "undefined") return;
    if (pane === "left" && documentsCollapsed()) return;
    paneResizeCleanup?.();
    event.preventDefault();

    const startX = event.clientX;
    const startLeft = leftPaneWidth();
    const startRight = rightPaneWidth();
    const collapsed = documentsCollapsed();

    setRefsActionMenuKey(null);
    setResizingPane(pane);

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const viewport = getViewportWidth();
      if (pane === "left") {
        const maxLeft = Math.max(LEFT_PANEL_MIN_WIDTH, viewport - startRight - CENTER_PANEL_MIN_WIDTH);
        const next = clampNumber(startLeft + delta, LEFT_PANEL_MIN_WIDTH, maxLeft);
        setLeftPaneWidth(next);
        return;
      }

      const effectiveLeft = collapsed ? LEFT_PANEL_COLLAPSED_WIDTH : startLeft;
      const maxRight = Math.max(RIGHT_PANEL_MIN_WIDTH, viewport - effectiveLeft - CENTER_PANEL_MIN_WIDTH);
      const next = clampNumber(startRight - delta, RIGHT_PANEL_MIN_WIDTH, maxRight);
      setRightPaneWidth(next);
    };

    const cleanup = () => {
      setResizingPane(null);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onWindowBlur);
      paneResizeCleanup = null;
    };

    const onMouseUp = () => {
      cleanup();
    };

    const onWindowBlur = () => {
      cleanup();
    };

    paneResizeCleanup = cleanup;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onWindowBlur);
  };

  onCleanup(() => {
    paneResizeCleanup?.();
  });

  const editorSource = createMemo(() => {
    const cfg = apiConfig();
    const doc = activeDoc();
    if (!cfg || !doc || activeDocKind() !== "onlyoffice") return null;
    const manualEditable = isTemplateDocName(doc);
    return {
      ...cfg,
      doc,
      seq: configSeq(),
      readonly: isAgentRunning() || !manualEditable,
    } satisfies EditorSource;
  });

  const [editorPayload] = createResource(editorSource, async (input): Promise<OnlyOfficePayload | null> => {
    if (!input) return null;
    const query = new URLSearchParams();
    query.set("doc", input.doc);
    query.set("session", input.sessionId);
    if (input.readonly) {
      query.set("readonly", "1");
    }
    const url = buildUrl(input.baseUrl, input.workspaceId, "/document/config", query);
    const data = (await fetchJson(url, input.token)) as any;
    if (data && typeof data.documentServerUrl === "string" && data.config) {
      return { documentServerUrl: data.documentServerUrl, config: data.config };
    }
    return { documentServerUrl: "http://localhost:8080", config: data };
  });

  const archiveOtherDocuments = async () => {
    const cfg = apiConfig();
    const keep = targetDoc();
    if (!cfg || !keep) return;
    if (archiveBusy()) return;
    const ok = window.confirm(
      `Archive all other documents in this session?\n\nKeep: ${keep}\n\nThis moves files into a hidden .archive/ folder (they will disappear from the list).`,
    );
    if (!ok) return;

    setArchiveBusy(true);
    setToastMessage(null);
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/archive", query);
      const result = (await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep }),
      })) as { archived?: unknown[] };
      const count = Array.isArray(result.archived) ? result.archived.length : 0;
      setToastMessage(count ? `Archived ${count} documents.` : "No documents to archive.");
      await refetchDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to archive documents";
      setToastMessage(message);
    } finally {
      setArchiveBusy(false);
    }
  };

  const uploadReferenceFiles = async (categoryId: string, files: File[]) => {
    const client = props.openworkServerClient;
    const w = workspaceId();
    const prefix = refsInboxPrefix();
    if (!client || !w || !prefix) return;
    if (!files.length) return;
    if (refsBusy()) return;
    setRefsBusy(true);
    setRefsError(null);
    let skippedHiddenCount = 0;
    try {
      const uploadEntries = files
        .map((file) => ({ file, relative: uploadRelativePath(file) }))
        .filter((entry) => {
          if (hasHiddenPathSegment(entry.relative)) {
            skippedHiddenCount += 1;
            return false;
          }
          return true;
        });

      if (!uploadEntries.length) {
        setRefsError(`Skipped ${skippedHiddenCount} hidden files (for example .DS_Store).`);
        return;
      }

      setRefsUploadProgress({ categoryId, done: 0, total: uploadEntries.length });
      let done = 0;
      for (const entry of uploadEntries) {
        const dest = `${prefix}/${categoryId}/${entry.relative}`;
        await client.uploadInbox(w, entry.file, { path: dest });
        done += 1;
        setRefsUploadProgress({ categoryId, done, total: uploadEntries.length });
      }
      await refetchRefs();
      setRefsExpanded((current) => ({ ...current, [categoryId]: true }));
      if (skippedHiddenCount > 0) {
        setRefsError(`Skipped ${skippedHiddenCount} hidden files (for example .DS_Store).`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload files";
      setRefsError(message);
    } finally {
      setRefsUploadProgress(null);
      setRefsBusy(false);
    }
  };

  const deleteReferenceFile = async (item: InboxItem) => {
    const client = props.openworkServerClient;
    const w = workspaceId();
    if (!client || !w) return;
    if (refsDeleteBusyId()) return;
    const ok = window.confirm(`Delete from reference library?\n\n${item.path}`);
    if (!ok) return;
    setRefsDeleteBusyId(item.id);
    setRefsError(null);
    try {
      await client.deleteInbox(w, item.id);
      await refetchRefs();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete file";
      setRefsError(message);
    } finally {
      setRefsDeleteBusyId(null);
    }
  };

  const downloadReferenceItem = async (item: InboxItem, suggestedFilename?: string) => {
    const client = props.openworkServerClient;
    const w = workspaceId();
    if (!client || !w) return;
    try {
      const result = await client.downloadInbox(w, item.id);
      const blob = new Blob([result.data], { type: result.contentType ?? "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedFilename ?? result.filename ?? item.path.split("/").pop() ?? "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to download file";
      setRefsError(message);
    }
  };

  const downloadReferenceFile = async (item: InboxItem) => {
    await downloadReferenceItem(item);
  };

  const downloadReferenceFolder = async (categoryId: string, folderPath: string, items: InboxItem[]) => {
    if (!items.length) return;
    for (const item of items) {
      const relative = refsItemRelativePath(categoryId, item.path);
      const suffix = folderPath && relative.startsWith(`${folderPath}/`) ? relative.slice(folderPath.length + 1) : relative;
      const filename = normalizeRelativePath(suffix, item.path.split("/").pop() ?? "download").replace(/\//g, "__");
      await downloadReferenceItem(item, filename);
    }
  };

  const deleteReferenceFolder = async (folderPath: string, items: InboxItem[]) => {
    const client = props.openworkServerClient;
    const w = workspaceId();
    if (!client || !w) return;
    if (refsBusy()) return;
    if (!items.length) return;
    const label = folderPath || "(root)";
    const ok = window.confirm(`Delete folder and all files?\n\n${label}\n\nFiles: ${items.length}`);
    if (!ok) return;

    setRefsBusy(true);
    setRefsError(null);
    try {
      for (const item of items) {
        await client.deleteInbox(w, item.id);
      }
      await refetchRefs();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete folder";
      setRefsError(message);
    } finally {
      setRefsBusy(false);
    }
  };

  const insertRefInPrompt = (workspaceRelativePath: string) => {
    const tag = `@${workspaceRelativePath}`;
    const existing = props.prompt.trim();
    const next = existing ? `${existing}\n\n${tag}\n` : `${tag}\n`;
    props.setPrompt(next);
  };

  const openReferenceInEditor = async (item: InboxItem) => {
    const cfg = apiConfig();
    if (!cfg) return;
    if (refsOpenBusyId()) return;
    setRefsOpenBusyId(item.id);
    setRefsError(null);
    try {
      const remainder = refsSessionRemainder(item.path) || normalizeInboxPath(item.path);
      const segments = remainder.split("/").filter(Boolean);
      const categoryId = (segments[0] ?? "other").trim() || "other";
      const relative = normalizeRelativePath(segments.slice(1).join("/"), item.path.split("/").pop() ?? "reference");
      const dest = `.refs/${categoryId}/${relative}`;

      const query = new URLSearchParams();
      query.set("inboxId", item.id);
      query.set("session", cfg.sessionId);
      query.set("dest", dest);
      query.set("mode", "overwrite");
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/import", query);
      const result = (await fetchJson(url, cfg.token, { method: "POST" })) as { doc?: string };
      const doc = typeof result?.doc === "string" ? result.doc.trim() : "";
      if (!doc) throw new Error("Failed to import document");
      if (categoryId === "templates" || isTemplateDocName(doc)) {
        setTargetDoc(doc);
      }
      setActiveDoc(doc);
      setConfigSeq((v) => v + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open file in editor";
      setRefsError(message);
    } finally {
      setRefsOpenBusyId(null);
    }
  };

  const openModule = (key: "assemble" | "facts" | "fill" | "dedupe" | "qc" | "preview") => {
    if (!serverReady()) return;
    if (!targetDoc()) {
      setToastMessage("Select a target document first.");
      return;
    }
    setAssembleError(null);
    setFactsError(null);
    setFillError(null);
    setDedupeError(null);
    setPreviewError(null);
    setQcError(null);

    if (key === "assemble" && !assembleSource()) {
      const first = moduleSources()[0] ?? null;
      setAssembleSource(first);
    }
    if (key === "facts" && !factsTenderSource()) {
      const first = tenderSources()[0] ?? null;
      setFactsTenderSource(first);
    }
    if (key === "dedupe" && dedupeSelected().size === 0) {
      const first = dedupeCandidates()[0];
      if (first) setDedupeSelected(new Set([first.key]));
    }
    setModuleModal(key);
  };

  const closeModule = () => {
    setModuleModal(null);
    setAssembleError(null);
    setFactsError(null);
    setFillError(null);
    setDedupeError(null);
    setPreviewError(null);
    setQcError(null);
  };

  const runAssemble = async () => {
    const cfg = apiConfig();
    const doc = targetDoc();
    const source = assembleSource();
    if (!cfg || !doc || !source) return;
    if (assembleBusy()) return;
    setAssembleBusy(true);
    setAssembleError(null);

    try {
      if (activeDoc() !== doc) {
        setActiveDoc(doc);
      }
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      query.set("doc", doc);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/bid/assemble", query);
      if (assembleSeedTarget()) {
        const ok = window.confirm(
          "This will overwrite the target document by seeding it with the selected source. A hidden snapshot will be saved for rollback.\n\nContinue?",
        );
        if (!ok) return;
      }
      const payload = {
        partnerInboxId: source.id,
        matchMode: assembleMatchMode(),
        force: assembleForce(),
        seedTarget: assembleSeedTarget(),
      };
      const result = (await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as { steps?: unknown[]; report?: { inboxId?: string; inboxPath?: string } };
      const reportPath = typeof result?.report?.inboxPath === "string" ? result.report.inboxPath : "";
      setToastMessage(reportPath ? "Assemble complete (report saved)." : "Assemble complete.");
      closeModule();
      setConfigSeq((v) => v + 1);
      await refetchDocuments();
      await refetchReports();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to assemble bid forms";
      setAssembleError(message);
    } finally {
      setAssembleBusy(false);
    }
  };

  const runFill = async () => {
    const cfg = apiConfig();
    const doc = targetDoc();
    if (!cfg || !doc) return;
    if (fillBusy()) return;
    setFillBusy(true);
    setFillError(null);

    try {
      if (activeDoc() !== doc) {
        setActiveDoc(doc);
      }
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      query.set("doc", doc);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/bid/fill", query);
      const payload = {
        techXlsxInboxId: fillTechXlsx().trim() || undefined,
        equipXlsxInboxId: fillEquipXlsx().trim() || undefined,
        brand: fillBrand(),
        manufacturer: fillManufacturer(),
        origin: fillOrigin(),
        unit: fillUnit(),
        pricePlaceholder: fillPricePlaceholder(),
        specPlaceholder: fillSpecPlaceholder(),
      };
      const result = (await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as { report?: { inboxId?: string; inboxPath?: string } };
      const reportPath = typeof result?.report?.inboxPath === "string" ? result.report.inboxPath : "";
      setToastMessage(reportPath ? "Fill complete (report saved)." : "Fill complete.");
      closeModule();
      setConfigSeq((v) => v + 1);
      await refetchDocuments();
      await refetchReports();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fill bid tables";
      setFillError(message);
    } finally {
      setFillBusy(false);
    }
  };

  const runFacts = async () => {
    const cfg = apiConfig();
    const doc = targetDoc();
    const tender = factsTenderSource();
    if (!cfg || !doc || !tender) return;
    if (factsBusy()) return;
    setFactsBusy(true);
    setFactsError(null);

    try {
      if (activeDoc() !== doc) {
        setActiveDoc(doc);
      }
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      query.set("doc", doc);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/bid/facts", query);
      const payload = {
        tenderInboxId: tender.id,
        applyToTarget: factsApplyToTarget(),
        force: factsForce(),
        ensureProjectInfoBlock: factsInsertBlock(),
      };
      const result = (await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as { report?: { inboxId?: string; inboxPath?: string } };
      const reportPath = typeof result?.report?.inboxPath === "string" ? result.report.inboxPath : "";
      setToastMessage(reportPath ? "Facts complete (report saved)." : "Facts complete.");
      closeModule();
      setConfigSeq((v) => v + 1);
      await refetchDocuments();
      await refetchReports();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to extract tender facts";
      setFactsError(message);
    } finally {
      setFactsBusy(false);
    }
  };

  const runDedupe = async () => {
    const cfg = apiConfig();
    const doc = targetDoc();
    if (!cfg || !doc) return;
    if (dedupeBusy()) return;

    const selected = Array.from(dedupeSelected());
    if (selected.length < 1) {
      setDedupeError("Select at least one document to compare with the target.");
      return;
    }

    setDedupeBusy(true);
    setDedupeError(null);

    try {
      const parseRegexList = (raw: string) =>
        raw
          .split(/[\n,]+/)
          .map((value) => value.trim())
          .filter(Boolean);

      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      query.set("doc", doc);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/bid/dedupe", query);

      const docPaths: string[] = [];
      const inboxIds: string[] = [];
      for (const key of selected) {
        if (key.startsWith("doc:")) docPaths.push(key.slice("doc:".length));
        else if (key.startsWith("inbox:")) inboxIds.push(key.slice("inbox:".length));
      }

      const payload = {
        docPaths,
        inboxIds,
        excludeTables: dedupeExcludeTables(),
        simThreshold: dedupeSimThreshold(),
        exportMedia: dedupeExportMedia(),
        includeTitleRegex: parseRegexList(dedupeIncludeTitles()),
        excludeTitleRegex: parseRegexList(dedupeExcludeTitles()),
      };

      const result = (await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as { report?: { inboxPath?: string }; mediaZip?: { inboxPath?: string } };

      const reportPath = typeof result?.report?.inboxPath === "string" ? result.report.inboxPath : "";
      const mediaPath = typeof result?.mediaZip?.inboxPath === "string" ? result.mediaZip.inboxPath : "";
      const hint = [reportPath ? "Dedupe report saved." : "Dedupe complete.", mediaPath ? "Media zip saved." : ""]
        .filter(Boolean)
        .join(" ");
      setToastMessage(hint);
      closeModule();
      await refetchReports();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run dedupe";
      setDedupeError(message);
    } finally {
      setDedupeBusy(false);
    }
  };

  const runQc = async () => {
    const cfg = apiConfig();
    const doc = targetDoc();
    if (!cfg || !doc) return;
    if (qcBusy()) return;
    setQcBusy(true);
    setQcError(null);

    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      query.set("doc", doc);
      query.set("mode", qcMode());
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/bid/qc", query);
      const result = (await fetchJson(url, cfg.token, { method: "POST" })) as { passed?: boolean; report?: { inboxPath?: string } };
      const passed = Boolean(result?.passed);
      const label = qcMode() === "submit" ? "submit" : "draft";
      setToastMessage(passed ? `QC PASS (${label}, report saved).` : `QC FAIL (${label}, report saved).`);
      closeModule();
      await refetchReports();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run QC";
      setQcError(message);
    } finally {
      setQcBusy(false);
    }
  };

  const runPreviewPdf = async () => {
    const cfg = apiConfig();
    const doc = targetDoc();
    if (!cfg || !doc) return;
    if (previewBusy()) return;
    setPreviewBusy(true);
    setPreviewError(null);

    try {
      if (activeDoc() !== doc) {
        setActiveDoc(doc);
      }
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      query.set("doc", doc);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/bid/preview-pdf", query);
      const result = (await fetchJson(url, cfg.token, { method: "POST" })) as { pdf?: { inboxPath?: string }; report?: { inboxPath?: string } };
      const pdfPath = typeof result?.pdf?.inboxPath === "string" ? result.pdf.inboxPath : "";
      setToastMessage(pdfPath ? "PDF preview saved." : "PDF preview complete.");
      closeModule();
      await refetchReports();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to export PDF preview";
      setPreviewError(message);
    } finally {
      setPreviewBusy(false);
    }
  };

  const activeDocPath = createMemo(() => {
    const doc = targetDoc();
    if (!doc) return "";
    const normalized = doc.trim().replace(/^\/+/, "");
    if (!normalized) return "";
    const session = apiConfig()?.sessionId ?? sessionId();
    if (!session) return "";
    return `documents/sessions/${session}/${normalized}`;
  });
  const activeDocKind = createMemo<"none" | "image" | "pdf" | "markdown" | "text" | "onlyoffice" | "unsupported">(() => {
    const doc = activeDoc();
    if (!doc) return "none";
    if (isImagePreviewable(doc)) return "image";
    if (getFileExtension(doc) === ".pdf") return "pdf";
    if (isMarkdownPreviewable(doc)) return "markdown";
    if (isTextPreviewable(doc)) return "text";
    if (isOnlyOfficeImportable(doc)) return "onlyoffice";
    return "unsupported";
  });
  const activeDocDownloadUrl = createMemo(() => {
    const cfg = apiConfig();
    const doc = activeDoc();
    if (!cfg || !doc) return "";
    const query = new URLSearchParams();
    query.set("docId", doc);
    query.set("session", cfg.sessionId);
    return buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/file", query);
  });
  const textPreviewSource = createMemo(() => {
    const kind = activeDocKind();
    const url = activeDocDownloadUrl();
    if (!url) return null;
    if (kind !== "markdown" && kind !== "text") return null;
    return { url, kind };
  });
  const [textPreview] = createResource(textPreviewSource, async (source) => {
    if (!source) return null;
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const shownBytes = Math.min(blob.size, TEXT_PREVIEW_MAX_BYTES);
    const content = await blob.slice(0, shownBytes).text();
    return {
      content,
      shownBytes,
      totalBytes: blob.size,
      truncated: blob.size > shownBytes,
    };
  });
  const [pdfPreviewUrl, setPdfPreviewUrl] = createSignal<string | null>(null);
  const [pdfPreviewError, setPdfPreviewError] = createSignal<string | null>(null);
  const clearPdfPreviewUrl = () => {
    const current = pdfPreviewUrl();
    if (current) URL.revokeObjectURL(current);
    setPdfPreviewUrl(null);
  };
  createEffect(() => {
    const kind = activeDocKind();
    const url = activeDocDownloadUrl();
    if (kind !== "pdf" || !url) {
      setPdfPreviewError(null);
      clearPdfPreviewUrl();
      return;
    }
    let canceled = false;
    const controller = new AbortController();
    setPdfPreviewError(null);
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (canceled) return;
        const objectUrl = URL.createObjectURL(blob);
        clearPdfPreviewUrl();
        setPdfPreviewUrl(objectUrl);
      } catch (error) {
        if (canceled) return;
        if (error instanceof Error && error.name === "AbortError") return;
        clearPdfPreviewUrl();
        setPdfPreviewError(error instanceof Error ? error.message : tr("docagent.preview_load_failed"));
      }
    })();
    onCleanup(() => {
      canceled = true;
      controller.abort();
    });
  });

  createEffect(() => {
    sessionId();
    setTargetDoc(null);
    setActiveDoc(null);
    setModuleModal(null);
    setAssembleSource(null);
    setAssembleError(null);
    setFillError(null);
    setDedupeSelected(new Set<string>());
    setDedupeError(null);
    setDedupeIncludeTitles("");
    setDedupeExcludeTitles("");
    setPreviewError(null);
    setQcError(null);
    setReportsExpanded(false);
    setRefsFolderExpanded({});
    setRefsActionMenuKey(null);
    setResizingPane(null);
  });

  createEffect(() => {
    const key = docWriterStateKey();
    if (!key) return;
    const state = readDocWriterState(key);
    if (!state) {
      setLeftPaneWidth(LEFT_PANEL_DEFAULT_WIDTH);
      setRightPaneWidth(RIGHT_PANEL_DEFAULT_WIDTH);
      return;
    }
    const nextActive = typeof state?.activeDoc === "string" ? state.activeDoc.trim() : "";
    if (nextActive) setActiveDoc(nextActive);
    const nextLeft = typeof state?.leftPaneWidth === "number" ? state.leftPaneWidth : Number.NaN;
    if (Number.isFinite(nextLeft) && nextLeft > 0) setLeftPaneWidth(nextLeft);
    const nextRight = typeof state?.rightPaneWidth === "number" ? state.rightPaneWidth : Number.NaN;
    if (Number.isFinite(nextRight) && nextRight > 0) setRightPaneWidth(nextRight);
  });

  createEffect(() => {
    const key = docWriterStateKey();
    if (!key) return;
    const a = activeDoc();
    writeDocWriterState(key, {
      schemaVersion: 1,
      activeDoc: a ? a : undefined,
      leftPaneWidth: Math.round(leftPaneWidth()),
      rightPaneWidth: Math.round(rightPaneWidth()),
    });
  });

  createEffect(() => {
    leftPaneWidth();
    rightPaneWidth();
    documentsCollapsed();
    clampPaneWidthsToViewport();
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => clampPaneWidthsToViewport();
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });

  createEffect(() => {
    const items = documents() ?? [];
    if (!items.length) {
      setTargetDoc(null);
      setActiveDoc(null);
      return;
    }

    const previousTarget = targetDoc();
    const currentActive = activeDoc();
    const activeExists = currentActive ? items.some((doc) => doc.name === currentActive) : false;
    const targetExists =
      previousTarget && isTemplateDocName(previousTarget)
        ? items.some((doc) => doc.name === previousTarget)
        : false;

    let nextTarget: string | null = targetExists ? previousTarget : null;
    if (!nextTarget && activeExists && currentActive && isTemplateDocName(currentActive)) {
      nextTarget = currentActive;
    }
    if (!nextTarget) {
      nextTarget = items.find((doc) => isTemplateDocName(doc.name))?.name ?? null;
    }
    if (previousTarget !== nextTarget) {
      setTargetDoc(nextTarget);
    }

    if (!currentActive || !activeExists) {
      setActiveDoc(nextTarget ?? items[0].name);
      return;
    }
  });

  createEffect(() => {
    const prev = lastSessionStatus();
    const next = props.sessionStatus ?? "idle";
    setLastSessionStatus(next);
    if (prev !== "running" || next === "running") return;
    if (!targetDoc()) return;
    if (!serverReady()) return;
    setConfigSeq((v) => v + 1);
    void refetchDocuments();
    void refetchRefs();
  });

  createEffect(() => {
    const running = isAgentRunning();
    const ready = serverReady();
    const doc = targetDoc();
    const id = sessionId();
    if (!running || !ready || !doc || !id) return;
    if (typeof window === "undefined") return;

    const timer = window.setInterval(() => {
      setConfigSeq((v) => v + 1);
    }, RUNNING_REFRESH_INTERVAL_MS);

    onCleanup(() => window.clearInterval(timer));
  });

  onCleanup(() => {
    clearPdfPreviewUrl();
    if (scrollFrame !== undefined) {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = undefined;
    }
  });

  // Composer state (copied in spirit from SessionView but simplified)
  let agentPickerRef: HTMLDivElement | undefined;
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = createSignal(false);
  const [agentPickerBusy, setAgentPickerBusy] = createSignal(false);
  const [agentPickerReady, setAgentPickerReady] = createSignal(false);
  const [agentPickerError, setAgentPickerError] = createSignal<string | null>(null);
  const [agentOptions, setAgentOptions] = createSignal<Agent[]>([]);

  createEffect(() => {
    if (!toastMessage()) return;
    const id = window.setTimeout(() => setToastMessage(null), 2800);
    onCleanup(() => window.clearTimeout(id));
  });

  const agentLabel = createMemo(() => props.selectedSessionAgent ?? "Default agent");

  const loadAgentOptions = async (force = false) => {
    if (agentPickerBusy()) return agentOptions();
    if (agentPickerReady() && !force) return agentOptions();
    setAgentPickerBusy(true);
    setAgentPickerError(null);
    try {
      const agents = await props.listAgents();
      const sorted = agents.slice().sort((a, b) => a.name.localeCompare(b.name));
      setAgentOptions(sorted);
      setAgentPickerReady(true);
      return sorted;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load agents";
      setAgentPickerError(message);
      setAgentOptions([]);
      return [];
    } finally {
      setAgentPickerBusy(false);
    }
  };

  const openAgentPicker = () => {
    setAgentPickerOpen((current) => !current);
    if (!agentPickerReady()) {
      void loadAgentOptions();
    }
  };

  const applySessionAgent = (agent: string | null) => {
    const id = sessionId();
    if (!id) {
      setToastMessage("No session selected");
      return;
    }
    props.setSessionAgent(id, agent);
  };

  createEffect(() => {
    if (!agentPickerOpen()) return;
    const handler = (event: MouseEvent) => {
      if (!agentPickerRef) return;
      if (agentPickerRef.contains(event.target as Node)) return;
      setAgentPickerOpen(false);
    };
    window.addEventListener("mousedown", handler);
    onCleanup(() => window.removeEventListener("mousedown", handler));
  });

  createEffect(() => {
    const menuKey = refsActionMenuKey();
    if (!menuKey) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-refs-action-menu]")) return;
      setRefsActionMenuKey(null);
    };
    window.addEventListener("mousedown", handler);
    onCleanup(() => window.removeEventListener("mousedown", handler));
  });

  createEffect(() => {
    const container = chatContainerEl;
    const sentinel = bottomVisibilityEl;
    if (!container || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setNearBottom(Boolean(entry?.isIntersecting));
      },
      {
        root: container,
        rootMargin: "0px 0px 96px 0px",
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  const chatPartCount = createMemo(() =>
    props.messages.reduce((count, message) => count + message.parts.length, 0),
  );

  createEffect(
    on(
      () => [sessionId(), props.messages.length, chatPartCount()] as const,
      ([nextSessionId], previous) => {
        const previousSessionId = previous?.[0] ?? "";
        if (!nextSessionId) return;
        if (nextSessionId !== previousSessionId) {
          queueMicrotask(() => scheduleScrollToLatest("auto"));
          return;
        }
        if (nearBottom()) {
          scheduleScrollToLatest("auto");
        }
      },
      { defer: true },
    ),
  );

  const isSandboxWorkspace = createMemo(() =>
    Boolean((props.activeWorkspaceDisplay as any)?.sandboxContainerName?.trim()),
  );

  const attachmentsEnabled = createMemo(() => {
    if (props.activeWorkspaceDisplay.workspaceType !== "remote") return true;
    return props.openworkServerStatus === "connected";
  });
  const attachmentsDisabledReason = createMemo(() => {
    if (attachmentsEnabled()) return null;
    if (props.openworkServerStatus === "limited") {
      return "Add a server token to attach files.";
    }
    return "Connect to OpenWork server to attach files.";
  });

  const handleDraftChange = (draft: ComposerDraft) => {
    props.setPrompt(draft.text);
  };

  const handleSendPrompt = (draft: ComposerDraft) => {
    const path = activeDocPath();
    const shouldPrefix = draft.mode === "prompt" && !draft.command && Boolean(path);
    if (!shouldPrefix) {
      props.sendPromptAsync(draft).catch(() => undefined);
      return;
    }

    const prefix = `Target document: ${path}`;
    const baseText = draft.text ?? "";
    const baseResolvedText = draft.resolvedText ?? null;
    const already =
      baseText.includes(prefix) || (typeof baseResolvedText === "string" ? baseResolvedText.includes(prefix) : false);
    const nextDraft = already
      ? draft
      : {
        ...draft,
        text: `${prefix}\n\n${baseText}`.trim(),
        resolvedText: baseResolvedText != null ? `${prefix}\n\n${baseResolvedText}`.trim() : undefined,
      };
    props.sendPromptAsync(nextDraft).catch(() => undefined);
  };

  const cancelRun = () => {
    const id = sessionId().trim();
    if (!id) return;
    props.abortSession(id).catch(() => undefined);
  };

  const listCommands = async (): Promise<SlashCommandOption[]> => {
    try {
      return await props.listCommands();
    } catch {
      return [];
    }
  };

  return (
    <div class="relative isolate flex h-screen w-full bg-dls-surface text-dls-text font-sans overflow-hidden">
      {/* Left: Document list */}
      <div
        class={`relative z-20 shrink-0 border-r border-dls-border flex flex-col bg-dls-sidebar ${resizingPane() === "left" ? "" : "transition-[width] duration-150 ease-out"
          }`}
        style={{ width: `${leftPaneDisplayWidth()}px` }}
      >
        <Show
          when={!documentsCollapsed()}
          fallback={
            <div class="p-2 border-b border-dls-border flex flex-col items-center gap-2">
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={() => setDocumentsCollapsed(false)}
                title="Expand"
                aria-label="Expand documents"
              >
                <PanelLeftOpen size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void refetchDocuments()}
                disabled={!serverReady() || documents.loading}
                title="Refresh"
                aria-label="Refresh documents"
              >
                <RefreshCw size={16} class={documents.loading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void archiveOtherDocuments()}
                disabled={!serverReady() || !targetDoc() || archiveBusy()}
                title="Archive other documents"
                aria-label="Archive other documents"
              >
                <FolderArchive size={16} />
              </button>
            </div>
          }
        >
          <div class="h-12 px-3 border-b border-dls-border flex justify-between items-center">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-dls-text leading-none">文档编写</h2>
              {/* <Show when={activeDocPath()}>
                <div class="mt-1 text-[11px] text-dls-secondary truncate" title={activeDocPath()}>
                  {activeDocPath()}
                </div>
              </Show> */}
            </div>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={() => setDocumentsCollapsed(true)}
                title="Collapse"
                aria-label="Collapse documents"
              >
                <PanelLeftClose size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void refetchDocuments()}
                disabled={!serverReady() || documents.loading}
                title="Refresh"
                aria-label="Refresh documents"
              >
                <RefreshCw size={16} class={documents.loading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void archiveOtherDocuments()}
                disabled={!serverReady() || !targetDoc() || archiveBusy()}
                title="Archive other documents"
                aria-label="Archive other documents"
              >
                <FolderArchive size={16} />
              </button>
            </div>
          </div>
        </Show>
        <div class="flex-1 min-h-0 overflow-y-auto p-2">
          <Show
            when={serverReady()}
            fallback={<div class="p-2 text-xs text-dls-secondary">OpenWork server not connected.</div>}
          >
            <Show
              when={!documents.error}
              fallback={
                <div class="p-2 text-xs text-red-11 whitespace-pre-wrap break-words">
                  {documents.error instanceof Error ? documents.error.message : "Failed to load documents"}
                </div>
              }
            >
              <Show when={targetDocName()}>
                <button
                  class={`w-full rounded flex items-center mb-1 transition-colors ${documentsCollapsed() ? "justify-center p-2" : "text-left p-2 gap-2"
                    } ${activeDoc() === targetDocName()
                      ? "bg-dls-hover text-dls-text"
                      : "text-dls-secondary hover:bg-dls-surface"
                    }`}
                  onClick={() => setActiveDoc(targetDocName())}
                  title={documentsCollapsed() ? targetDocName() : undefined}
                >
                  <FileText size={16} />
                  <Show when={!documentsCollapsed()}>
                    <span class="truncate">
                      {targetDocName()}
                      <span class="ml-2 text-[10px] text-dls-secondary">(target)</span>
                    </span>
                  </Show>
                </button>
              </Show>

              <Show when={otherDocsList().length > 0 && !documentsCollapsed()}>
                <button
                  type="button"
                  class="w-full mt-1 rounded flex items-center justify-between px-2 py-2 text-[11px] text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                  onClick={() => setOtherDocsExpanded((v) => !v)}
                  aria-expanded={otherDocsExpanded()}
                >
                  <span>{targetDocName() ? "Other documents" : "Session documents"}</span>
                  <span class="flex items-center gap-2">
                    <span class="text-[10px]">{otherDocsList().length}</span>
                    <ChevronDown size={14} class={`transition-transform ${otherDocsExpanded() ? "rotate-180" : ""}`} />
                  </span>
                </button>
                <Show when={otherDocsExpanded()}>
                  <div class="mt-1">
                    <For each={otherDocsList()}>
                      {(doc) => (
                        <button
                          type="button"
                          class={`w-full rounded flex items-center mb-1 transition-colors ${documentsCollapsed() ? "justify-center p-2" : "text-left p-2 gap-2"
                            } ${activeDoc() === doc.name
                              ? "bg-dls-hover text-dls-text"
                              : "text-dls-secondary hover:bg-dls-surface"
                            }`}
                          onClick={() => setActiveDoc(doc.name)}
                          title={documentsCollapsed() ? doc.name : undefined}
                        >
                          <FileText size={16} />
                          <Show when={!documentsCollapsed()}>
                            <span class="truncate">{doc.name}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
          </Show>

          <Show when={!documentsCollapsed()}>
            <div class="mt-3 pt-3 border-t border-dls-border">
              {/* <div class="px-2">
                <div class="flex items-center justify-between">
                  <button
                    type="button"
                    class="flex items-center gap-2 min-w-0 text-left flex-1 hover:text-dls-text text-dls-secondary"
                    onClick={() => setModulesExpanded((v) => !v)}
                    aria-expanded={modulesExpanded()}
                  >
                    <ChevronDown size={14} class={`shrink-0 transition-transform ${modulesExpanded() ? "rotate-180" : ""}`} />
                    <span class="text-[10px] uppercase tracking-wider text-dls-secondary">Modules</span>
                  </button>
                  <button
                    type="button"
                    class="p-1.5 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                    onClick={() => void refetchReports()}
                    disabled={!serverReady() || reports.loading}
                    title="Refresh reports"
                    aria-label="Refresh reports"
                  >
                    <RefreshCw size={14} class={reports.loading ? "animate-spin" : ""} />
                  </button>
                </div>

                <Show when={modulesExpanded()}>
                  <div class="mt-2 grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      class="w-full rounded-lg border border-dls-border bg-dls-surface px-2 py-2 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover disabled:opacity-50 flex items-center gap-2"
                      onClick={() => openModule("assemble")}
                      disabled={!serverReady() || !targetDoc() || isAgentRunning()}
                      title="Copy baseline bid forms into the target document"
                    >
                      <Copy size={14} />
                      <span class="truncate">Assemble forms (DOCX→DOCX)</span>
                    </button>
                    <button
                      type="button"
                      class="w-full rounded-lg border border-dls-border bg-dls-surface px-2 py-2 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover disabled:opacity-50 flex items-center gap-2"
                      onClick={() => openModule("facts")}
                      disabled={!serverReady() || !targetDoc() || isAgentRunning() || factsBusy()}
                      title="Extract key facts from the tender and fill the project info table"
                    >
                      <ArrowRight size={14} />
                      <span class="truncate">Tender facts (DOCX→DOCX)</span>
                    </button>
                    <button
                      type="button"
                      class="w-full rounded-lg border border-dls-border bg-dls-surface px-2 py-2 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover disabled:opacity-50 flex items-center gap-2"
                      onClick={() => openModule("fill")}
                      disabled={!serverReady() || !targetDoc() || isAgentRunning()}
                      title="Fill pre-formatted tables from XLSX inputs"
                    >
                      <FileText size={14} />
                      <span class="truncate">Fill tables (XLSX→DOCX)</span>
                    </button>
                    <button
                      type="button"
                      class="w-full rounded-lg border border-dls-border bg-dls-surface px-2 py-2 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover disabled:opacity-50 flex items-center gap-2"
                      onClick={() => openModule("qc")}
                      disabled={!serverReady() || !targetDoc() || qcBusy()}
                      title="Run deterministic QC gate on the target document"
                    >
                      <CheckCircle2 size={14} />
                      <span class="truncate">QC gate</span>
                    </button>
                    <button
                      type="button"
                      class="w-full rounded-lg border border-dls-border bg-dls-surface px-2 py-2 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover disabled:opacity-50 flex items-center gap-2"
                      onClick={() => openModule("dedupe")}
                      disabled={!serverReady() || !targetDoc() || isAgentRunning() || dedupeBusy()}
                      title="Compare multiple DOCX files for duplicate text and images"
                    >
                      <Search size={14} />
                      <span class="truncate">Dedupe (DOCX↔DOCX)</span>
                    </button>
                    <button
                      type="button"
                      class="w-full rounded-lg border border-dls-border bg-dls-surface px-2 py-2 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover disabled:opacity-50 flex items-center gap-2"
                      onClick={() => openModule("preview")}
                      disabled={!serverReady() || !targetDoc() || previewBusy()}
                      title="Export a PDF preview for Word-like review and printing"
                    >
                      <Download size={14} />
                      <span class="truncate">PDF preview (DOCX→PDF)</span>
                    </button>
                  </div>

                  <Show when={reportsWorkspaceRoot()}>
                    <button
                      type="button"
                      class="mt-2 w-full rounded-md border border-dls-border bg-dls-surface px-2 py-1 text-[11px] text-dls-secondary hover:text-dls-text hover:bg-dls-hover flex items-center gap-2"
                      onClick={() => insertRefInPrompt(reportsWorkspaceRoot() + "/")}
                      title="Insert reports directory into the prompt"
                    >
                      <Folder size={14} />
                      <span class="truncate">{reportsWorkspaceRoot()}/</span>
                      <span class="ml-auto text-[10px] text-dls-secondary flex items-center gap-1">
                        <AtSign size={12} />
                        Use
                      </span>
                    </button>
                  </Show>

                  <Show when={visibleReports().length > 0}>
                    <div class="mt-2 rounded-lg border border-dls-border bg-dls-surface overflow-hidden">
                      <div class="flex items-center justify-between px-2 py-1.5">
                        <button
                          type="button"
                          class="flex items-center gap-2 min-w-0 text-left flex-1 hover:text-dls-text text-dls-secondary"
                          onClick={() => setReportsExpanded((v) => !v)}
                          aria-expanded={reportsExpanded()}
                        >
                          <ChevronDown
                            size={14}
                            class={`shrink-0 transition-transform ${reportsExpanded() ? "rotate-180" : ""}`}
                          />
                          <span class="truncate text-[12px]">Reports</span>
                          <span class="ml-auto text-[10px] text-dls-secondary">{(reports() ?? []).length}</span>
                        </button>
                      </div>
                      <div class="px-2 pb-2 space-y-1">
                        <For each={visibleReports()}>
                          {(item) => {
                            const workspacePath = () => inboxWorkspacePath(item.path);
                            const name = () => item.path.split("/").slice(-2).join("/");
                            return (
                              <div class="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-dls-hover">
                                <FileText size={14} class="text-dls-secondary shrink-0" />
                                <button
                                  type="button"
                                  class="min-w-0 flex-1 text-left"
                                  onClick={() => insertRefInPrompt(workspacePath())}
                                  title={workspacePath()}
                                >
                                  <div class="text-[12px] text-dls-text truncate">{name()}</div>
                                  <div class="text-[10px] text-dls-secondary">{formatBytes(item.size)}</div>
                                </button>
                                <button
                                  type="button"
                                  class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text"
                                  onClick={() => insertRefInPrompt(workspacePath())}
                                  title="Use in prompt"
                                  aria-label="Use in prompt"
                                >
                                  <AtSign size={14} />
                                </button>
                                <button
                                  type="button"
                                  class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text"
                                  onClick={() => void downloadInboxFile(item, (msg) => setToastMessage(msg))}
                                  title="Download"
                                  aria-label="Download"
                                >
                                  <Download size={14} />
                                </button>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div> */}

              <div class="flex items-center justify-between px-2">
                <div class="text-[10px] uppercase tracking-wider text-dls-secondary">Reference materials</div>
                <button
                  type="button"
                  class="p-1.5 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                  onClick={() => void refetchRefs()}
                  disabled={!serverReady() || refs.loading}
                  title="Refresh reference files"
                  aria-label="Refresh reference files"
                >
                  <RefreshCw size={14} class={refs.loading ? "animate-spin" : ""} />
                </button>
              </div>

              <Show when={refsError()}>
                <div class="mt-2 px-2 text-xs text-red-11 whitespace-pre-wrap break-words">{refsError()}</div>
              </Show>

              <Show when={refsWorkspaceRoot()}>
                <button
                  type="button"
                  class="mt-2 mx-2 w-[calc(100%-16px)] rounded-md border border-dls-border bg-dls-surface px-2 py-1 text-[11px] text-dls-secondary hover:text-dls-text hover:bg-dls-hover flex items-center gap-2"
                  onClick={() => insertRefInPrompt(refsWorkspaceRoot() + "/")}
                  title="Insert reference library root (directory) into the prompt"
                >
                  <Folder size={14} />
                  <span class="truncate">{refsWorkspaceRoot()}/</span>
                  <span class="ml-auto text-[10px] text-dls-secondary flex items-center gap-1">
                    <AtSign size={12} />
                    Use
                  </span>
                </button>
              </Show>

              <Show when={refsUploadProgress()}>
                <div class="mt-2 px-2 text-[11px] text-dls-secondary">
                  Uploading <span class="text-dls-text">{refsUploadProgress()!.categoryId}</span>: {refsUploadProgress()!.done}/{refsUploadProgress()!.total}
                </div>
              </Show>

              <div class="mt-2 space-y-2">
                <For each={REF_CATEGORIES}>
                  {(category) => {
                    const expanded = () => Boolean(refsExpanded()[category.id]);
                    const items = () => refsByCategory()[category.id] ?? [];
                    const tree = createMemo(() => buildRefsFolderTree(category.id, items()));

                    const fileRow = (item: InboxItem, depth: number) => {
                      const workspacePath = () => inboxWorkspacePath(item.path);
                      const relativePath = () => refsItemRelativePath(category.id, item.path);
                      const name = () => relativePath().split("/").pop() ?? item.path.split("/").pop() ?? item.path;
                      const importable = () => isOnlyOfficeImportable(item.path);
                      const menuKey = refsFileMenuKey(category.id, item.id);
                      const menuOpen = () => refsActionMenuKey() === menuKey;
                      return (
                        <div class="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-dls-hover" style={{ "padding-left": `${8 + depth * 14}px` }}>
                          <FileText size={14} class="text-dls-secondary shrink-0" />
                          <div class="min-w-0 flex-1 text-[12px] text-dls-text truncate" title={workspacePath()}>
                            {name()}
                          </div>
                          <button
                            type="button"
                            class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text"
                            onClick={() => insertRefInPrompt(workspacePath())}
                            title="Use in prompt"
                            aria-label="Use in prompt"
                          >
                            <AtSign size={14} />
                          </button>
                          <div class="relative" data-refs-action-menu>
                            <button
                              type="button"
                              class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text"
                              onClick={(event) => {
                                event.stopPropagation();
                                setRefsActionMenuKey(menuOpen() ? null : menuKey);
                              }}
                              title="More"
                              aria-label="More"
                            >
                              <MoreHorizontal size={14} />
                            </button>
                            <Show when={menuOpen()}>
                              <div class="absolute right-0 top-8 z-20 min-w-[140px] rounded-md border border-dls-border bg-dls-surface shadow-lg p-1">
                                <button
                                  type="button"
                                  class="w-full text-left rounded px-2 py-1.5 text-xs text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:opacity-50"
                                  onClick={() => {
                                    setRefsActionMenuKey(null);
                                    void openReferenceInEditor(item);
                                  }}
                                  disabled={!serverReady() || refsOpenBusyId() === item.id || !importable()}
                                  title={importable() ? "Preview" : "Unsupported file type"}
                                >
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  class="w-full text-left rounded px-2 py-1.5 text-xs text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                                  onClick={() => {
                                    setRefsActionMenuKey(null);
                                    void downloadReferenceFile(item);
                                  }}
                                >
                                  Download
                                </button>
                                <button
                                  type="button"
                                  class="w-full text-left rounded px-2 py-1.5 text-xs text-red-11 hover:bg-red-3/30 disabled:opacity-50"
                                  onClick={() => {
                                    setRefsActionMenuKey(null);
                                    void deleteReferenceFile(item);
                                  }}
                                  disabled={refsDeleteBusyId() === item.id}
                                >
                                  Delete
                                </button>
                              </div>
                            </Show>
                          </div>
                        </div>
                      );
                    };

                    const collectFolderItems = (folder: RefFolderNode): InboxItem[] => [
                      ...folder.files,
                      ...folder.folders.flatMap((child) => collectFolderItems(child)),
                    ];

                    const folderTotalFiles = (folder: RefFolderNode): number =>
                      collectFolderItems(folder).length;

                    const folderBlock = (folder: RefFolderNode, depth: number) => {
                      const expandedFolder = () => isRefsFolderExpanded(category.id, folder.path);
                      const menuKey = refsFolderMenuKey(category.id, folder.path);
                      const menuOpen = () => refsActionMenuKey() === menuKey;
                      const folderItems = () => collectFolderItems(folder);
                      const promptPath = () => folderPromptPath(category.id, folder.path);
                      return (
                        <div class="space-y-1">
                          <div
                            class="w-full flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-dls-hover text-dls-secondary"
                            style={{ "padding-left": `${8 + depth * 14}px` }}
                          >
                            <button
                              type="button"
                              class="min-w-0 flex-1 flex items-center gap-2 rounded-md px-1 py-1 text-left hover:text-dls-text"
                              onClick={() => toggleRefsFolder(category.id, folder.path)}
                              aria-expanded={expandedFolder()}
                              title={folder.path}
                            >
                              <ChevronDown
                                size={14}
                                class={`shrink-0 transition-transform ${expandedFolder() ? "rotate-180" : "-rotate-90"}`}
                              />
                              <Folder size={14} class="shrink-0" />
                              <span class="text-[12px] truncate">{folder.name}</span>
                              <span class="ml-auto text-[10px] text-dls-secondary">{folderTotalFiles(folder)}</span>
                            </button>
                            <button
                              type="button"
                              class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text"
                              onClick={(event) => {
                                event.stopPropagation();
                                insertRefInPrompt(promptPath());
                              }}
                              title="Use in prompt"
                              aria-label="Use in prompt"
                            >
                              <AtSign size={14} />
                            </button>
                            <div class="relative" data-refs-action-menu>
                              <button
                                type="button"
                                class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setRefsActionMenuKey(menuOpen() ? null : menuKey);
                                }}
                                title="More"
                                aria-label="More"
                              >
                                <MoreHorizontal size={14} />
                              </button>
                              <Show when={menuOpen()}>
                                <div class="absolute right-0 top-8 z-20 min-w-[140px] rounded-md border border-dls-border bg-dls-surface shadow-lg p-1">
                                  <button
                                    type="button"
                                    class="w-full text-left rounded px-2 py-1.5 text-xs text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:opacity-50"
                                    onClick={() => {
                                      setRefsActionMenuKey(null);
                                      void downloadReferenceFolder(category.id, folder.path, folderItems());
                                    }}
                                    disabled={refsBusy() || folderItems().length === 0}
                                  >
                                    Download
                                  </button>
                                  <button
                                    type="button"
                                    class="w-full text-left rounded px-2 py-1.5 text-xs text-red-11 hover:bg-red-3/30 disabled:opacity-50"
                                    onClick={() => {
                                      setRefsActionMenuKey(null);
                                      void deleteReferenceFolder(folder.path, folderItems());
                                    }}
                                    disabled={refsBusy() || folderItems().length === 0}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </Show>
                            </div>
                          </div>
                          <Show when={expandedFolder()}>
                            <For each={folder.folders}>
                              {(child) => folderBlock(child, depth + 1)}
                            </For>
                            <For each={folder.files}>
                              {(item) => fileRow(item, depth + 1)}
                            </For>
                          </Show>
                        </div>
                      );
                    };

                    return (
                      <div class="rounded-lg border border-dls-border bg-dls-surface">
                        <div class="flex items-center justify-between px-2 py-1.5">
                          <button
                            type="button"
                            class="flex items-center gap-2 min-w-0 text-left flex-1 hover:text-dls-text text-dls-secondary"
                            onClick={() => toggleRefsCategory(category.id)}
                            aria-expanded={expanded()}
                          >
                            <ChevronDown
                              size={14}
                              class={`shrink-0 transition-transform ${expanded() ? "rotate-180" : ""}`}
                            />
                            <span class="truncate text-[12px]">{category.label}</span>
                            <span class="ml-auto text-[10px] text-dls-secondary">{items().length}</span>
                          </button>
                          <label
                            class={`ml-2 cursor-pointer p-1.5 rounded hover:bg-dls-hover ${!serverReady() || refsBusy() ? "opacity-50 cursor-not-allowed" : ""
                              }`}
                            title={`Upload to ${category.label}`}
                          >
                            <Plus size={14} class="text-dls-secondary" />
                            <input
                              type="file"
                              multiple
                              class="hidden"
                              disabled={!serverReady() || refsBusy()}
                              onChange={(event: Event) => {
                                const target = event.currentTarget as HTMLInputElement;
                                const files = Array.from(target.files ?? []);
                                if (files.length) void uploadReferenceFiles(category.id, files);
                                target.value = "";
                              }}
                            />
                          </label>
                          <label
                            class={`ml-1 cursor-pointer p-1.5 rounded hover:bg-dls-hover ${!serverReady() || refsBusy() ? "opacity-50 cursor-not-allowed" : ""
                              }`}
                            title={`Upload folder to ${category.label}`}
                          >
                            <Folder size={14} class="text-dls-secondary" />
                            <input
                              ref={(el) => {
                                const directoryInput = el as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean };
                                directoryInput.webkitdirectory = true;
                                directoryInput.directory = true;
                              }}
                              type="file"
                              multiple
                              class="hidden"
                              disabled={!serverReady() || refsBusy()}
                              onChange={(event: Event) => {
                                const target = event.currentTarget as HTMLInputElement;
                                const files = Array.from(target.files ?? []);
                                if (files.length) void uploadReferenceFiles(category.id, files);
                                target.value = "";
                              }}
                            />
                          </label>
                        </div>

                        <Show when={expanded()}>
                          <div class="px-2 pb-2 space-y-1">
                            <Show when={items().length > 0} fallback={<div class="py-1 text-[11px] text-dls-secondary">No files.</div>}>
                              <For each={tree().folders}>
                                {(folder) => folderBlock(folder, 0)}
                              </For>
                              <For each={tree().files}>
                                {(item) => fileRow(item, 0)}
                              </For>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <Show when={!documentsCollapsed()}>
        <div
          class={`relative z-30 shrink-0 w-1.5 cursor-col-resize ${resizingPane() === "left" ? "bg-dls-border/80" : "bg-transparent hover:bg-dls-border/60"
            }`}
          onMouseDown={(event) => beginPaneResize("left", event)}
          role="separator"
          aria-label="Resize documents panel"
          aria-orientation="vertical"
        >
          <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-dls-border/60" />
        </div>
      </Show>

      {/* Middle: OnlyOffice */}
      <div class="relative z-0 flex-1 min-w-0 flex flex-col">
        <div class="h-12 border-b border-dls-border flex items-center justify-between px-3">
          <div class="flex items-center gap-2 min-w-0">
            <button
              type="button"
              class="p-2 -ml-1 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
              onClick={() => setDocumentsCollapsed((v) => !v)}
              title={documentsCollapsed() ? "Show documents" : "Hide documents"}
              aria-label={documentsCollapsed() ? "Show documents" : "Hide documents"}
            >
              <Show when={documentsCollapsed()} fallback={<PanelLeftClose size={16} />}>
                <PanelLeftOpen size={16} />
              </Show>
            </button>
            <div class="text-xs text-dls-secondary truncate">
              <Show when={targetDoc()} fallback={"Select a target document from 模板/格式"}>
                Target: <span class="text-dls-text">{targetDoc()}</span>
                <Show when={activeDoc() && activeDoc() !== targetDoc()}>
                  <span class="ml-2 text-dls-secondary">· Viewing:</span>{" "}
                  <span class="text-dls-text">{activeDoc()}</span>
                </Show>
              </Show>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-lg border border-dls-border bg-dls-surface px-2 py-1 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover disabled:opacity-50"
              onClick={() => {
                const path = activeDocPath();
                if (!path) return;
                const existing = props.prompt.trim();
                const next = existing ? `${existing}\n\nTarget document: ${path}\n` : `Target document: ${path}\n`;
                props.setPrompt(next);
              }}
              disabled={!activeDocPath()}
              title="Insert document path into the prompt"
            >
              Use in prompt
            </button>
            <button
              type="button"
              class="rounded-lg border border-dls-border bg-dls-surface px-2 py-1 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover disabled:opacity-50"
              onClick={() => setConfigSeq((v) => v + 1)}
              disabled={!activeDoc() || activeDocKind() !== "onlyoffice"}
              title="Reload OnlyOffice config"
            >
              Reload
            </button>
            <button
              type="button"
              class="rounded-lg border border-dls-border bg-dls-surface px-2 py-1 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover disabled:opacity-50"
              onClick={() => {
                const id = sessionId();
                if (!id) return;
                navigate(`/session/${id}/view/session`);
              }}
              disabled={!sessionId()}
              title="Open session view"
            >
              Session
            </button>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-hidden">
          <Show
            when={activeDoc()}
            fallback={<div class="h-full flex items-center justify-center text-dls-secondary">{tr("docagent.select_document_to_edit")}</div>}
          >
            <div class="relative h-full w-full">
              <Show when={activeDocKind() === "image"}>
                <div class="h-full w-full overflow-auto bg-dls-surface flex items-center justify-center p-4">
                  <img
                    src={activeDocDownloadUrl()}
                    alt={activeDoc() ?? "image"}
                    class="max-h-full max-w-full object-contain rounded-lg border border-dls-border bg-white"
                  />
                </div>
              </Show>
              <Show when={activeDocKind() === "pdf"}>
                <div class="h-full w-full bg-dls-surface">
                  <Show when={!pdfPreviewError()} fallback={<div class="p-4 text-xs text-red-11">{pdfPreviewError()}</div>}>
                    <Show when={pdfPreviewUrl()} fallback={<div class="p-4 text-xs text-dls-secondary">{tr("docagent.loading_pdf_preview")}</div>}>
                      <iframe
                        src={pdfPreviewUrl()!}
                        title={activeDoc() ?? tr("docagent.pdf_preview_title")}
                        class="h-full w-full border-0 bg-white"
                      />
                    </Show>
                  </Show>
                </div>
              </Show>
              <Show when={activeDocKind() === "markdown" || activeDocKind() === "text"}>
                <div class="h-full w-full overflow-auto bg-dls-surface p-4">
                  <Show when={!textPreview.error} fallback={<div class="text-xs text-red-11">{textPreview.error instanceof Error ? textPreview.error.message : tr("docagent.preview_load_failed")}</div>}>
                    <Show when={!textPreview.loading && textPreview()} fallback={<div class="text-xs text-dls-secondary">{tr("docagent.loading_text_preview")}</div>}>
                      <div class="mb-2 text-[11px] text-dls-secondary">
                        <Show when={activeDocKind() === "markdown"} fallback={tr("docagent.text_preview_readonly")}>
                          {tr("docagent.markdown_preview_readonly")}
                        </Show>
                        <Show when={textPreview()!.truncated}>
                          {" "}
                          {tr("docagent.preview_truncated")
                            .replace("{shown}", formatPreviewBytes(textPreview()!.shownBytes))
                            .replace("{total}", formatPreviewBytes(textPreview()!.totalBytes))}
                        </Show>
                      </div>
                      <pre class="text-xs leading-relaxed whitespace-pre-wrap break-words rounded-lg border border-dls-border bg-white p-3 text-dls-text">
                        {textPreview()!.content}
                      </pre>
                    </Show>
                  </Show>
                </div>
              </Show>
              <Show when={activeDocKind() === "onlyoffice"}>
                <Show when={editorPayload()} fallback={<div class="p-4 text-xs text-dls-secondary">{tr("docagent.loading_editor")}</div>}>
                  <OnlyOfficeEditor
                    documentServerUrl={editorPayload()!.documentServerUrl}
                    config={editorPayload()!.config}
                  />
                </Show>
              </Show>
              <Show when={activeDocKind() === "unsupported"}>
                <div class="h-full w-full flex items-center justify-center px-6">
                  <div class="max-w-xl rounded-xl border border-dls-border bg-dls-surface p-4 text-center space-y-3">
                    <div class="text-sm text-dls-text">{tr("docagent.unsupported_preview_title")}</div>
                    <div class="text-xs text-dls-secondary">{tr("docagent.unsupported_preview_desc")}</div>
                    <Show when={activeDocDownloadUrl()}>
                      <a
                        href={activeDocDownloadUrl()}
                        download={activeDoc() ?? "download"}
                        class="inline-flex items-center rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                      >
                        {tr("docagent.download_file")}
                      </a>
                    </Show>
                  </div>
                </div>
              </Show>
              <Show when={targetDoc() && activeDoc() && activeDoc() !== targetDoc()}>
                <div
                  class="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4"
                  role="status"
                  aria-live="polite"
                >
                  <div class="max-w-lg rounded-xl border border-dls-border bg-dls-surface/90 px-4 py-2 shadow-lg backdrop-blur">
                    <div class="text-xs text-dls-secondary">
                      <span class="font-medium text-dls-text">Preview mode</span>{" "}
                      (chat edits <span class="text-dls-text">{targetDoc()}</span>).{" "}
                      <button
                        type="button"
                        class="pointer-events-auto ml-2 underline text-dls-secondary hover:text-dls-text"
                        onClick={() => setActiveDoc(targetDoc())}
                      >
                        Back to target
                      </button>
                    </div>
                  </div>
                </div>
              </Show>
              <Show when={isAgentRunning()}>
                <div
                  class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4"
                  role="status"
                  aria-live="polite"
                >
                  <div class="max-w-lg rounded-xl border border-dls-border bg-dls-surface/90 px-4 py-2 shadow-lg backdrop-blur">
                    <div class="text-xs text-dls-secondary">
                      <span class="font-medium text-dls-text">AI is editing…</span>{" "}
                      You can keep scrolling/previewing, but editing is locked to prevent conflicts. The document will reload when the run finishes.
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div
        class={`relative z-30 shrink-0 w-1.5 cursor-col-resize ${resizingPane() === "right" ? "bg-dls-border/80" : "bg-transparent hover:bg-dls-border/60"
          }`}
        onMouseDown={(event) => beginPaneResize("right", event)}
        role="separator"
        aria-label="Resize chat panel"
        aria-orientation="vertical"
      >
        <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-dls-border/60" />
      </div>

      {/* Right: Chat */}
      <div class="relative z-30 shrink-0 border-l border-dls-border flex flex-col bg-dls-surface" style={{ width: `${rightPaneWidth()}px` }}>
        <div class="h-12 border-b border-dls-border px-3 flex items-center justify-between">
          <div class="min-w-0">
            <div class="text-sm font-medium text-dls-text truncate">Chat</div>
            <div class="text-[11px] text-dls-secondary truncate">
              <Show when={props.selectedSessionAgent} fallback={"Default agent"}>
                @{props.selectedSessionAgent}
              </Show>
            </div>
          </div>
          <div class="text-[11px] text-dls-secondary truncate" title={sessionId()}>
            {sessionId() ? `#${sessionId()}` : "No session"}
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto" ref={(el) => (chatContainerEl = el)}>
          <MessageList
            messages={props.messages}
            developerMode={props.developerMode}
            showThinking={props.showThinking}
            expandedStepIds={props.expandedStepIds}
            setExpandedStepIds={props.setExpandedStepIds}
          />
          <div
            ref={(el) => {
              messagesEndEl = el;
              bottomVisibilityEl = el;
            }}
          />
        </div>

        <Composer
          prompt={props.prompt}
          developerMode={props.developerMode}
          busy={props.busy}
          isStreaming={isAgentRunning()}
          onSend={handleSendPrompt}
          onStop={cancelRun}
          onDraftChange={handleDraftChange}
          selectedModelLabel={props.selectedSessionModelLabel || "Model"}
          onModelClick={props.openSessionModelPicker}
          modelVariantLabel={props.modelVariantLabel}
          modelVariant={props.modelVariant}
          onModelVariantChange={props.setModelVariant}
          agentLabel={agentLabel()}
          selectedAgent={props.selectedSessionAgent}
          agentPickerOpen={agentPickerOpen()}
          agentPickerBusy={agentPickerBusy()}
          agentPickerError={agentPickerError()}
          agentOptions={agentOptions()}
          onToggleAgentPicker={openAgentPicker}
          onSelectAgent={(agent) => {
            applySessionAgent(agent);
            setAgentPickerOpen(false);
          }}
          setAgentPickerRef={(el) => {
            agentPickerRef = el;
          }}
          showNotionBanner={false}
          onNotionBannerClick={() => undefined}
          toast={toastMessage()}
          onToast={(message) => setToastMessage(message)}
          listAgents={props.listAgents}
          recentFiles={props.workingFiles}
          searchFiles={props.searchFiles}
          listCommands={listCommands}
          isRemoteWorkspace={props.activeWorkspaceDisplay.workspaceType === "remote"}
          isSandboxWorkspace={isSandboxWorkspace()}
          attachmentsEnabled={attachmentsEnabled()}
          attachmentsDisabledReason={attachmentsDisabledReason()}
        />
      </div>

      <Show when={Boolean(resizingPane())}>
        <div
          class="fixed inset-0 z-40 cursor-col-resize select-none"
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={(event) => event.preventDefault()}
          onMouseUp={() => paneResizeCleanup?.()}
        />
      </Show>

      <Show when={moduleModal() === "assemble"}>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModule();
          }}
        >
          <div
            class="w-full max-w-4xl rounded-2xl border border-dls-border bg-dls-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div class="flex items-center justify-between px-4 py-3 border-b border-dls-border">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-dls-text truncate">Assemble forms</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  Target: {targetDoc() ?? "—"}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label="Close"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="min-w-0">
                <div class="text-xs font-medium text-dls-text">Source document</div>
                <div class="mt-2">
                  <input
                    type="text"
                    value={assembleQuery()}
                    onInput={(event) => setAssembleQuery(event.currentTarget.value)}
                    placeholder="Search DOCX sources…"
                    class="w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div class="mt-2 rounded-lg border border-dls-border overflow-hidden max-h-[360px] overflow-y-auto">
                  <Show when={!refs.loading} fallback={<div class="p-3 text-xs text-dls-secondary">Loading…</div>}>
                    <Show when={filteredModuleSources().length > 0} fallback={<div class="p-3 text-xs text-dls-secondary">No DOCX sources found.</div>}>
                      <For each={filteredModuleSources()}>
                        {(item) => {
                          const selected = createMemo(() => assembleSource()?.id === item.id);
                          const name = () => item.path.split("/").pop() ?? item.path;
                          return (
                            <button
                              type="button"
                              class={`w-full text-left px-3 py-2 border-b border-dls-border/50 last:border-b-0 hover:bg-dls-hover ${selected() ? "bg-dls-active" : ""}`}
                              onClick={() => setAssembleSource(item)}
                              title={item.path}
                            >
                              <div class="flex items-start gap-2">
                                <FileText size={14} class="shrink-0 text-dls-secondary mt-0.5" />
                                <div class="min-w-0 flex-1">
                                  <div class="text-xs text-dls-text truncate">{name()}</div>
                                  <div class="mt-1 text-[10px] text-dls-secondary">{formatBytes(item.size)}</div>
                                </div>
                              </div>
                            </button>
                          );
                        }}
                      </For>
                    </Show>
                  </Show>
                </div>
              </div>

              <div class="min-w-0 space-y-4">
                <div>
                  <div class="text-xs font-medium text-dls-text">Match mode</div>
                  <div class="mt-2">
                    <select
                      class="w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                      value={assembleMatchMode()}
                      onChange={(event) => setAssembleMatchMode(event.currentTarget.value as any)}
                    >
                      <option value="contains">contains (recommended)</option>
                      <option value="exact">exact</option>
                      <option value="startswith">startsWith</option>
                    </select>
                  </div>
                  <div class="mt-2 text-[11px] text-dls-secondary">
                    Copies baseline forms (开标一览表/开标分项一览表/点对点/配置清单/售后服务承诺) into the target.
                  </div>
                </div>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={assembleForce()}
                    onChange={(event) => setAssembleForce(event.currentTarget.checked)}
                  />
                  Force insert even if the target section appears non-empty
                </label>

                <label class="flex items-start gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={assembleSeedTarget()}
                    onChange={(event) => setAssembleSeedTarget(event.currentTarget.checked)}
                  />
                  <span class="min-w-0">
                    Seed target from source (overwrite target first)
                    <div class="mt-1 text-[11px] text-dls-secondary">
                      Recommended when your target template is blank or lacks a professional skeleton. A hidden snapshot is saved for rollback.
                    </div>
                  </span>
                </label>

                <Show when={assembleError()}>
                  <div class="rounded-lg border border-red-11/30 bg-red-3/20 px-3 py-2 text-xs text-red-11 whitespace-pre-wrap break-words">
                    {assembleError()}
                  </div>
                </Show>
              </div>
            </div>

            <div class="px-4 py-3 border-t border-dls-border flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                onClick={closeModule}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runAssemble()}
                disabled={assembleBusy() || !assembleSource()}
                title={!assembleSource() ? "Select a source document" : "Assemble"}
              >
                <Show when={!assembleBusy()} fallback={"Working…"}>
                  Assemble
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={moduleModal() === "facts"}>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModule();
          }}
        >
          <div
            class="w-full max-w-3xl rounded-2xl border border-dls-border bg-dls-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div class="flex items-center justify-between px-4 py-3 border-b border-dls-border">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-dls-text truncate">Tender facts</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  Target: {targetDoc() ?? "—"}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label="Close"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="min-w-0">
                <div class="text-xs font-medium text-dls-text">Tender document (source of truth)</div>
                <div class="mt-2 rounded-lg border border-dls-border overflow-hidden max-h-[360px] overflow-y-auto">
                  <Show when={!refs.loading} fallback={<div class="p-3 text-xs text-dls-secondary">Loading…</div>}>
                    <Show
                      when={tenderSources().length > 0}
                      fallback={<div class="p-3 text-xs text-dls-secondary">Upload the tender file to 招标文件.</div>}
                    >
                      <For each={tenderSources()}>
                        {(item) => {
                          const selected = createMemo(() => factsTenderSource()?.id === item.id);
                          const name = () => item.path.split("/").pop() ?? item.path;
                          return (
                            <button
                              type="button"
                              class={`w-full text-left px-3 py-2 border-b border-dls-border/50 last:border-b-0 hover:bg-dls-hover ${selected() ? "bg-dls-active" : ""
                                }`}
                              onClick={() => setFactsTenderSource(item)}
                              title={item.path}
                            >
                              <div class="flex items-start gap-2">
                                <FileText size={14} class="shrink-0 text-dls-secondary mt-0.5" />
                                <div class="min-w-0 flex-1">
                                  <div class="text-xs text-dls-text truncate">{name()}</div>
                                  <div class="mt-1 text-[10px] text-dls-secondary">{formatBytes(item.size)}</div>
                                </div>
                              </div>
                            </button>
                          );
                        }}
                      </For>
                    </Show>
                  </Show>
                </div>
              </div>

              <div class="min-w-0 space-y-4">
                <div>
                  <div class="text-xs font-medium text-dls-text">What it does</div>
                  <div class="mt-2 text-[11px] text-dls-secondary">
                    Extracts project name/code, deadlines, amounts, and other hard facts from the tender file, then fills the project info table in your template (optional).
                    Saves a facts.json + markdown report to Reports.
                  </div>
                </div>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={factsApplyToTarget()}
                    onChange={(event) => setFactsApplyToTarget(event.currentTarget.checked)}
                  />
                  Apply to target (fill project info table)
                </label>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={factsForce()}
                    onChange={(event) => setFactsForce(event.currentTarget.checked)}
                    disabled={!factsApplyToTarget()}
                  />
                  Force overwrite existing values
                </label>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={factsInsertBlock()}
                    onChange={(event) => setFactsInsertBlock(event.currentTarget.checked)}
                    disabled={!factsApplyToTarget()}
                  />
                  Insert a filled project info block if the template has no placeholders (recommended)
                </label>

                <Show when={factsError()}>
                  <div class="rounded-lg border border-red-11/30 bg-red-3/20 px-3 py-2 text-xs text-red-11 whitespace-pre-wrap break-words">
                    {factsError()}
                  </div>
                </Show>
              </div>
            </div>

            <div class="px-4 py-3 border-t border-dls-border flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                onClick={closeModule}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runFacts()}
                disabled={factsBusy() || !factsTenderSource()}
                title={!factsTenderSource() ? "Select a tender document" : "Run facts extraction"}
              >
                <Show when={!factsBusy()} fallback={"Working…"}>
                  Run facts
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={moduleModal() === "fill"}>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModule();
          }}
        >
          <div
            class="w-full max-w-3xl rounded-2xl border border-dls-border bg-dls-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div class="flex items-center justify-between px-4 py-3 border-b border-dls-border">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-dls-text truncate">Fill tables</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  Target: {targetDoc() ?? "—"}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label="Close"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div class="text-xs font-medium text-dls-text">Tech response XLSX (optional)</div>
                  <select
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                    value={fillTechXlsx()}
                    onChange={(event) => setFillTechXlsx(event.currentTarget.value)}
                  >
                    <option value="">—</option>
                    <For each={xlsxRefs()}>
                      {(item) => (
                        <option value={item.id}>
                          {item.path.split("/").pop() ?? item.path}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">Equipment list XLSX (optional)</div>
                  <select
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                    value={fillEquipXlsx()}
                    onChange={(event) => setFillEquipXlsx(event.currentTarget.value)}
                  >
                    <option value="">—</option>
                    <For each={xlsxRefs()}>
                      {(item) => (
                        <option value={item.id}>
                          {item.path.split("/").pop() ?? item.path}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div class="text-xs font-medium text-dls-text">Brand</div>
                  <input
                    type="text"
                    value={fillBrand()}
                    onInput={(event) => setFillBrand(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">Manufacturer</div>
                  <input
                    type="text"
                    value={fillManufacturer()}
                    onInput={(event) => setFillManufacturer(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">Origin</div>
                  <input
                    type="text"
                    value={fillOrigin()}
                    onInput={(event) => setFillOrigin(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">Unit</div>
                  <input
                    type="text"
                    value={fillUnit()}
                    onInput={(event) => setFillUnit(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div class="text-xs font-medium text-dls-text">Price placeholder</div>
                  <input
                    type="text"
                    value={fillPricePlaceholder()}
                    onInput={(event) => setFillPricePlaceholder(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">Spec placeholder</div>
                  <input
                    type="text"
                    value={fillSpecPlaceholder()}
                    onInput={(event) => setFillSpecPlaceholder(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
              </div>

              <Show when={fillError()}>
                <div class="rounded-lg border border-red-11/30 bg-red-3/20 px-3 py-2 text-xs text-red-11 whitespace-pre-wrap break-words">
                  {fillError()}
                </div>
              </Show>
            </div>

            <div class="px-4 py-3 border-t border-dls-border flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                onClick={closeModule}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runFill()}
                disabled={fillBusy()}
              >
                <Show when={!fillBusy()} fallback={"Working…"}>
                  Fill
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={moduleModal() === "dedupe"}>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModule();
          }}
        >
          <div
            class="w-full max-w-4xl rounded-2xl border border-dls-border bg-dls-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div class="flex items-center justify-between px-4 py-3 border-b border-dls-border">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-dls-text truncate">Dedupe</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  Target: {targetDoc() ?? "—"} (always included)
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label="Close"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="min-w-0">
                <div class="flex items-center justify-between">
                  <div class="text-xs font-medium text-dls-text">Compare with</div>
                  <div class="text-[11px] text-dls-secondary">{dedupeSelected().size} selected</div>
                </div>
                <div class="mt-2">
                  <input
                    type="text"
                    value={dedupeQuery()}
                    onInput={(event) => setDedupeQuery(event.currentTarget.value)}
                    placeholder="Search documents…"
                    class="w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div class="mt-2 rounded-lg border border-dls-border overflow-hidden max-h-[420px] overflow-y-auto">
                  <Show when={!refs.loading && !documents.loading} fallback={<div class="p-3 text-xs text-dls-secondary">Loading…</div>}>
                    <Show
                      when={filteredDedupeCandidates().length > 0}
                      fallback={<div class="p-3 text-xs text-dls-secondary">No DOCX sources found.</div>}
                    >
                      <For each={filteredDedupeCandidates()}>
                        {(item) => {
                          const displayName = () =>
                            item.kind === "doc"
                              ? item.name.split("/").pop() ?? item.name
                              : item.path.split("/").pop() ?? item.path;
                          const selected = createMemo(() => dedupeSelected().has(item.key));
                          return (
                            <label
                              class={`flex items-start gap-2 px-3 py-2 border-b border-dls-border/50 last:border-b-0 hover:bg-dls-hover cursor-pointer ${selected() ? "bg-dls-active" : ""
                                }`}
                            >
                              <input
                                type="checkbox"
                                checked={selected()}
                                onChange={() => toggleDedupeSelection(item.key)}
                                class="mt-0.5"
                              />
                              <div class="min-w-0 flex-1">
                                <div class="text-xs text-dls-text truncate">{displayName()}</div>
                                <div class="mt-1 text-[10px] text-dls-secondary truncate">{item.sourceLabel}</div>
                              </div>
                            </label>
                          );
                        }}
                      </For>
                    </Show>
                  </Show>
                </div>
              </div>

              <div class="min-w-0 space-y-4">
                <div>
                  <div class="text-xs font-medium text-dls-text">Settings</div>
                  <div class="mt-2 text-[11px] text-dls-secondary">
                    Finds duplicate text blocks (simhash + similarity) and duplicate images (SHA256 / dHash) across documents.
                  </div>
                </div>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={dedupeExcludeTables()}
                    onChange={(event) => setDedupeExcludeTables(event.currentTarget.checked)}
                  />
                  Exclude tables (recommended to reduce form noise)
                </label>

                <div>
                  <div class="text-xs font-medium text-dls-text">Similarity threshold</div>
                  <div class="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={dedupeSimThreshold()}
                      onInput={(event) => setDedupeSimThreshold(Number(event.currentTarget.value))}
                      class="w-28 rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                    />
                    <div class="text-[11px] text-dls-secondary">Default 0.92. Lower = more matches.</div>
                  </div>
                </div>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={dedupeExportMedia()}
                    onChange={(event) => setDedupeExportMedia(event.currentTarget.checked)}
                  />
                  Export media contact sheet (zip)
                </label>

                <div class="rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-xs font-medium text-dls-text">Title filters (optional)</div>
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        class="text-[11px] underline text-dls-secondary hover:text-dls-text"
                        onClick={() => setDedupeIncludeTitles("技术|方案|实施|架构|服务|运维|安全|偏离")}
                      >
                        Tech preset
                      </button>
                      <button
                        type="button"
                        class="text-[11px] underline text-dls-secondary hover:text-dls-text"
                        onClick={() =>
                          setDedupeExcludeTitles("开标|一览表|分项|清单|点对点|授权|资质|证明|商务|报价|保证金|合同")
                        }
                      >
                        Form preset
                      </button>
                      <button
                        type="button"
                        class="text-[11px] underline text-dls-secondary hover:text-dls-text"
                        onClick={() => {
                          setDedupeIncludeTitles("");
                          setDedupeExcludeTitles("");
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div class="mt-1 text-[11px] text-dls-secondary">
                    Filters match detected heading titles. Separate multiple regex with newlines or commas.
                  </div>
                  <div class="mt-2 grid grid-cols-1 gap-2">
                    <div>
                      <div class="text-[11px] text-dls-secondary">Include</div>
                      <textarea
                        rows={2}
                        value={dedupeIncludeTitles()}
                        onInput={(event) => setDedupeIncludeTitles(event.currentTarget.value)}
                        placeholder="e.g. 技术|方案"
                        class="mt-1 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                      />
                    </div>
                    <div>
                      <div class="text-[11px] text-dls-secondary">Exclude</div>
                      <textarea
                        rows={2}
                        value={dedupeExcludeTitles()}
                        onInput={(event) => setDedupeExcludeTitles(event.currentTarget.value)}
                        placeholder="e.g. 开标|商务"
                        class="mt-1 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                      />
                    </div>
                  </div>
                </div>

                <Show when={dedupeError()}>
                  <div class="rounded-lg border border-red-11/30 bg-red-3/20 px-3 py-2 text-xs text-red-11 whitespace-pre-wrap break-words">
                    {dedupeError()}
                  </div>
                </Show>
              </div>
            </div>

            <div class="px-4 py-3 border-t border-dls-border flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                onClick={closeModule}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runDedupe()}
                disabled={dedupeBusy() || dedupeSelected().size < 1}
                title={dedupeSelected().size < 1 ? "Select at least 1 document to compare" : "Run dedupe"}
              >
                <Show when={!dedupeBusy()} fallback={"Working…"}>
                  Run dedupe
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={moduleModal() === "preview"}>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModule();
          }}
        >
          <div
            class="w-full max-w-xl rounded-2xl border border-dls-border bg-dls-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div class="flex items-center justify-between px-4 py-3 border-b border-dls-border">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-dls-text truncate">PDF preview</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  Target: {targetDoc() ?? "—"}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label="Close"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 space-y-3">
              <div class="text-xs text-dls-secondary">
                Exports a PDF using LibreOffice (headless) and saves it to the session inbox for download/printing. This helps spot layout issues that OnlyOffice may render differently from Word.
              </div>
              <Show when={previewError()}>
                <div class="rounded-lg border border-red-11/30 bg-red-3/20 px-3 py-2 text-xs text-red-11 whitespace-pre-wrap break-words">
                  {previewError()}
                </div>
              </Show>
            </div>

            <div class="px-4 py-3 border-t border-dls-border flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                onClick={closeModule}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runPreviewPdf()}
                disabled={previewBusy()}
              >
                <Show when={!previewBusy()} fallback={"Working…"}>
                  Export PDF
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={moduleModal() === "qc"}>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModule();
          }}
        >
          <div
            class="w-full max-w-xl rounded-2xl border border-dls-border bg-dls-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div class="flex items-center justify-between px-4 py-3 border-b border-dls-border">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-dls-text truncate">QC gate</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  Target: {targetDoc() ?? "—"}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label="Close"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 space-y-3">
              <div class="text-xs text-dls-secondary">
                Runs deterministic checks (missing core forms, empty critical cells, unresolved &lt;&lt;TBD&gt;&gt; placeholders). Saves a report to the session inbox.
              </div>
              <div class="grid grid-cols-1 gap-2 rounded-xl border border-dls-border bg-dls-surface p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-xs font-semibold text-dls-text truncate">Mode</div>
                    <div class="mt-1 text-[11px] text-dls-secondary">
                      Draft mode is for iteration; Submit mode is strict for final export.
                    </div>
                  </div>
                  <select
                    value={qcMode()}
                    onChange={(event) => setQcMode(event.currentTarget.value === "submit" ? "submit" : "draft")}
                    class="shrink-0 rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                    aria-label="QC mode"
                    title="QC strictness mode"
                  >
                    <option value="draft">Draft</option>
                    <option value="submit">Submit</option>
                  </select>
                </div>
              </div>
              <Show when={qcError()}>
                <div class="rounded-lg border border-red-11/30 bg-red-3/20 px-3 py-2 text-xs text-red-11 whitespace-pre-wrap break-words">
                  {qcError()}
                </div>
              </Show>
            </div>

            <div class="px-4 py-3 border-t border-dls-border flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                onClick={closeModule}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runQc()}
                disabled={qcBusy()}
              >
                <Show when={!qcBusy()} fallback={"Working…"}>
                  Run QC
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
