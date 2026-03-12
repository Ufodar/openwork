import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { ArrowLeft, ArrowRight, AtSign, Check, CheckCircle2, ChevronDown, Download, FileText, Folder, FolderArchive, ListTodo, Minimize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Trash2, X } from "lucide-solid";
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

type RefFolderNode = {
  name: string;
  path: string;
  folders: RefFolderNode[];
  files: DocumentItem[];
};

type RefsUploadProgress = {
  categoryId: string;
  done: number;
  total: number;
  phase: "uploading" | "processing";
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
const DOC_TOOLBAR_BUTTON_CLASS =
  "rounded-lg border border-dls-border bg-dls-surface px-2 py-1 text-xs text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--dls-accent-rgb),0.2)] disabled:cursor-not-allowed disabled:opacity-50";
const DOC_TOOLBAR_BACK_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-transparent bg-dls-accent px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[var(--dls-accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--dls-accent-rgb),0.25)] disabled:cursor-not-allowed disabled:opacity-50";
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
const LEFT_PANEL_COLLAPSED_WIDTH = 56;
const LEFT_PANEL_DEFAULT_WIDTH = 256;
const LEFT_PANEL_MIN_WIDTH = 220;
const RIGHT_PANEL_DEFAULT_WIDTH = 500;
const RIGHT_PANEL_MIN_WIDTH = 360;
const CENTER_PANEL_MIN_WIDTH = 520;
const STREAM_SCROLL_MIN_INTERVAL_MS = 90;
const BID_MODULES_ENABLED = false;

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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

const ALLOWED_HIDDEN_FILE_NAMES = new Set([
  ".env",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".npmrc",
  ".gitconfig",
  ".bashrc",
  ".zshrc",
]);

const hasHiddenPathSegment = (path: string) => {
  const normalized = normalizeRelativePath(path, "");
  if (!normalized) return false;
  const segments = normalized.split("/");
  return segments.some((segment, index) => {
    if (!segment.startsWith(".")) return false;
    const isLeaf = index === segments.length - 1;
    if (!isLeaf) return true;
    const lower = segment.toLowerCase();
    if (ALLOWED_HIDDEN_FILE_NAMES.has(lower)) return false;
    if (lower.startsWith(".env.")) return false;
    return true;
  });
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
  const trf = (key: string, vars?: Record<string, string | number>) => {
    let template = tr(key);
    if (!vars) return template;
    for (const [name, value] of Object.entries(vars)) {
      template = template.replaceAll(`{${name}}`, String(value));
    }
    return template;
  };
  let chatContainerEl: HTMLDivElement | undefined;
  let messagesEndEl: HTMLDivElement | undefined;
  let bottomVisibilityEl: HTMLDivElement | undefined;
  let scrollFrame: number | undefined;
  let pendingScrollBehavior: ScrollBehavior = "auto";
  let lastAutoScrollAt = 0;

  const sessionId = createMemo(() => props.selectedSessionId?.trim() ?? "");
  const workspaceId = createMemo(() => props.openworkServerWorkspaceId?.trim() ?? "");
  const isAgentRunning = createMemo(() => (props.sessionStatus ?? "idle") === "running");

  // Lock agent to document-writer for document-writer page
  createEffect(() => {
    const sid = sessionId();
    if (sid && props.selectedSessionAgent !== "document-writer") {
      props.setSessionAgent(sid, "document-writer");
    }
  });

  const serverReady = createMemo(
    () =>
      props.openworkServerStatus === "connected" &&
      Boolean(props.openworkServerClient) &&
      Boolean(workspaceId()),
  );

  const apiConfig = createMemo(
    () => {
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
    },
    null,
    {
      // Only trigger downstream refetches when the actual values change,
      // not just the object reference (which changes on every parent render
      // because spread props create new getter closures).
      equals: (prev, next) => {
        if (prev === next) return true;
        if (!prev || !next) return false;
        return (
          prev.baseUrl === next.baseUrl &&
          prev.token === next.token &&
          prev.workspaceId === next.workspaceId &&
          prev.sessionId === next.sessionId
        );
      },
    },
  );

  const buildUrl = (baseUrl: string, workspace: string, pathname: string, query?: URLSearchParams) => {
    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const parsed = new URL(baseUrl);
    const basePath = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = `${basePath}/w/${encodeURIComponent(workspace)}${normalizedPath}`.replace(/\/{2,}/g, "/");
    const url = parsed;
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
    const controller = typeof AbortController !== "undefined" && !init?.signal ? new AbortController() : null;
    const timeoutMs = 12_000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (controller && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }, timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers, ...(controller ? { signal: controller.signal } : {}) });
    } catch (error) {
      const name = (error && typeof error === "object" && "name" in error ? (error as any).name : "") as string;
      if (name === "AbortError") {
        throw new Error("Request timed out.");
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      try {
        const parsed = JSON.parse(text) as { message?: unknown; details?: any } | null;
        const message = parsed && typeof parsed.message === "string" ? parsed.message : "";
        const reportPath =
          parsed?.details?.report?.docPath && typeof parsed.details.report.docPath === "string"
            ? parsed.details.report.docPath
            : "";
        const suffix = reportPath ? `\n\n${trf("docwriter.report_suffix", { path: reportPath })}` : "";
        throw new Error((message || trf("docwriter.request_failed_with_status", { status: response.status })) + suffix);
      } catch {
        throw new Error(text || trf("docwriter.request_failed_with_status", { status: response.status }));
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
  const [refsUploadProgress, setRefsUploadProgress] = createSignal<RefsUploadProgress | null>(null);
  const [refsDeleteBusyId, setRefsDeleteBusyId] = createSignal<string | null>(null);
  const [refsOpenBusyId, setRefsOpenBusyId] = createSignal<string | null>(null);

  const [modulesExpanded, setModulesExpanded] = createSignal(true);
  const [todoExpanded, setTodoExpanded] = createSignal(false);
  const todoList = createMemo(() => (props.todos ?? []).filter((todo) => todo.content.trim()));
  const todoCount = createMemo(() => todoList().length);
  const todoCompletedCount = createMemo(() => todoList().filter((todo) => todo.status === "completed").length);
  const todoLabel = createMemo(() => {
    const total = todoCount();
    if (!total) return "";
    return `${todoCompletedCount()} / ${total} ${tr("docwriter.tasks_completed")}`;
  });
  const [moduleModal, setModuleModal] = createSignal<null | "facts" | "fill" | "dedupe" | "qc" | "preview">(null);
  const [factsTenderSource, setFactsTenderSource] = createSignal<DocumentItem | null>(null);
  const [factsApplyToTarget, setFactsApplyToTarget] = createSignal(true);
  const [factsForce, setFactsForce] = createSignal(false);
  const [factsInsertBlock, setFactsInsertBlock] = createSignal(true);
  const [factsBusy, setFactsBusy] = createSignal(false);
  const [factsError, setFactsError] = createSignal<string | null>(null);
  const [fillTechXlsx, setFillTechXlsx] = createSignal<string>("");
  const [fillEquipXlsx, setFillEquipXlsx] = createSignal<string>("");
  const [fillBrand, setFillBrand] = createSignal(tr("docwriter.fill_default_brand"));
  const [fillManufacturer, setFillManufacturer] = createSignal(tr("docwriter.fill_default_manufacturer"));
  const [fillOrigin, setFillOrigin] = createSignal(tr("docwriter.fill_default_origin"));
  const [fillUnit, setFillUnit] = createSignal(tr("docwriter.fill_default_unit"));
  const [fillPricePlaceholder, setFillPricePlaceholder] = createSignal(tr("docwriter.fill_default_price_placeholder"));
  const [fillSpecPlaceholder, setFillSpecPlaceholder] = createSignal(tr("docwriter.fill_default_spec_placeholder"));
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
    { id: "tender", labelKey: "docwriter.ref_category_tender" },
    { id: "templates", labelKey: "docwriter.ref_category_templates" },
    { id: "business", labelKey: "docwriter.ref_category_business" },
    { id: "technical", labelKey: "docwriter.ref_category_technical" },
    { id: "history", labelKey: "docwriter.ref_category_history" },
    { id: "partners", labelKey: "docwriter.ref_category_partners" },
    { id: "images", labelKey: "docwriter.ref_category_images" },
    { id: "other", labelKey: "docwriter.ref_category_other" },
  ] as const;
  const refCategoryLabel = (categoryId: string) =>
    tr(REF_CATEGORIES.find((c) => c.id === categoryId)?.labelKey ?? "docwriter.ref_category_reference");
  const refsUploadStatusText = createMemo(() => {
    const progress = refsUploadProgress();
    if (!progress) return "";
    if (progress.phase === "processing") {
      return trf("docwriter.processing_category", { category: refCategoryLabel(progress.categoryId) });
    }
    return trf("docwriter.uploading_category", {
      category: refCategoryLabel(progress.categoryId),
      done: progress.done,
      total: progress.total,
    });
  });

  const sessionDocumentsRoot = createMemo(() => {
    return "";
  });

  const refsWorkspaceRoot = createMemo(() => {
    const root = sessionDocumentsRoot();
    if (!root) return "refs";
    return `${root}/refs`;
  });

  const refsList = createMemo(() => {
    const items = documentsList();
    return items.filter((item) => item.name.startsWith("refs/"));
  });

  const refsLoading = () => documents.loading;

  const reportsWorkspaceRoot = createMemo(() => {
    const root = sessionDocumentsRoot();
    if (!root) return "reports";
    return `${root}/reports`;
  });

  const refsItemRemainder = (itemName: string) => {
    if (!itemName.startsWith("refs/")) return "";
    return itemName.slice("refs/".length);
  };

  const reportsList = createMemo(() => {
    const items = documentsList();
    const filtered = items.filter((item) => item.name.startsWith("reports/"));
    filtered.sort((a, b) => b.updatedAt - a.updatedAt);
    return filtered;
  });

  const refsByCategory = createMemo(() => {
    const items = refsList();
    const result: Record<string, DocumentItem[]> = Object.fromEntries(REF_CATEGORIES.map((c) => [c.id, []]));

    for (const item of items) {
      const remainder = refsItemRemainder(item.name);
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

  const tenderSources = createMemo(() => {
    const byCategory = refsByCategory();
    return (byCategory.tender ?? []).filter((item) => isDocxSectionCopySource(item.name));
  });

  const xlsxRefs = createMemo(() => {
    const items = refsList();
    return items.filter((item) => {
      const ext = getFileExtension(item.name);
      return ext === ".xlsx" || ext === ".xlsm";
    });
  });

  const xlsxRefsById = createMemo(() => {
    const map = new Map<string, DocumentItem>();
    for (const item of xlsxRefs()) map.set(item.name, item);
    return map;
  });

  type DedupeCandidate = {
    key: string;
    kind: "doc";
    name: string;
    updatedAt: number;
    sourceLabel: string;
  };

  const dedupeCandidates = createMemo(() => {
    const target = targetDoc();

    const refNames = new Set(refsList().map((r) => r.name));

    const docCandidates: DedupeCandidate[] = (documentsList() ?? [])
      .filter((doc) => doc.name !== target)
      .filter((doc) => isDocxSectionCopySource(doc.name))
      .map((doc) => {
        let sourceLabel = tr("docwriter.source_session_document");
        if (refNames.has(doc.name)) {
          const remainder = refsItemRemainder(doc.name);
          const categoryId = (remainder.split("/")[0] ?? "other").trim() || "other";
          sourceLabel = refCategoryLabel(categoryId);
        }
        return {
          key: `doc:${doc.name}`,
          kind: "doc" as const,
          name: doc.name,
          updatedAt: doc.updatedAt,
          sourceLabel,
        };
      });

    docCandidates.sort((a, b) => b.updatedAt - a.updatedAt);
    return docCandidates;
  });

  const filteredDedupeCandidates = createMemo(() => {
    const query = dedupeQuery().trim().toLowerCase();
    const items = dedupeCandidates();
    if (!query) return items;
    return items.filter((item) => {
      const name = item.name.split("/").pop() ?? item.name;
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
    const items = reportsList();
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

  const downloadDocumentFile = async (item: DocumentItem, onError: (message: string) => void) => {
    const cfg = apiConfig();
    if (!cfg) return;
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      query.set("docId", item.name);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/file", query);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
      if (!response.ok) throw new Error(trf("docwriter.request_failed_with_status", { status: response.status }));
      const blob = await response.blob();
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = item.name.split("/").pop() ?? "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_download_file");
      onError(message);
    }
  };

  const toggleRefsCategory = (categoryId: string) => {
    setRefsExpanded((current) => ({ ...current, [categoryId]: !current[categoryId] }));
  };

  const refsItemRelativePath = (categoryId: string, itemName: string) => {
    const remainder = refsItemRemainder(itemName);
    if (!remainder) return itemName;
    const categoryPrefix = `${categoryId}/`;
    if (remainder.startsWith(categoryPrefix)) {
      return remainder.slice(categoryPrefix.length);
    }
    return remainder;
  };

  const buildRefsFolderTree = (categoryId: string, items: DocumentItem[]) => {
    const root = createRefFolderNode("", "");
    const folderByPath = new Map<string, RefFolderNode>([["", root]]);
    for (const item of items) {
      const relative = normalizeRelativePath(refsItemRelativePath(categoryId, item.name), item.name.split("/").pop() ?? "file");
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
        const an = refsItemRelativePath(categoryId, a.name);
        const bn = refsItemRelativePath(categoryId, b.name);
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
  const categoryPromptPath = (categoryId: string) => {
    const root = refsWorkspaceRoot();
    if (!root) return "";
    return `${root}/${categoryId}/`;
  };
  const folderPromptPath = (categoryId: string, folderPath: string) => {
    const root = refsWorkspaceRoot();
    if (!root) return "";
    const normalized = normalizeRelativePath(folderPath, "");
    const suffix = normalized ? `/${normalized}` : "";
    return `${root}/${categoryId}${suffix}/`;
  };

  const useReferenceInPrompt = async (item: DocumentItem) => {
    if (refsOpenBusyId()) return;
    setRefsOpenBusyId(item.name);
    setRefsError(null);
    try {
      insertRefInPrompt(item.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docwriter.failed_import_document");
      setRefsError(message);
    } finally {
      setRefsOpenBusyId(null);
    }
  };

  const scrollToLatest = (behavior: ScrollBehavior = "auto") => {
    const container = chatContainerEl;
    if (!container) return;
    const top = Math.max(0, container.scrollHeight - container.clientHeight);
    if (behavior === "smooth") {
      container.scrollTo({ top, behavior: "smooth" });
      return;
    }
    container.scrollTop = top;
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
    const ok = window.confirm(trf("docagent.archive_confirm", { keep }));
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
      setToastMessage(count ? trf("docagent.archived_documents", { count }) : tr("docagent.no_documents_to_archive"));
      await refetchDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_archive_documents");
      setToastMessage(message);
    } finally {
      setArchiveBusy(false);
    }
  };

  const uploadReferenceFiles = async (categoryId: string, files: File[]) => {
    const cfg = apiConfig();
    if (!cfg) return;
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
        setRefsError(trf("docagent.skipped_hidden_documents_count", { count: skippedHiddenCount }));
        return;
      }

      setRefsUploadProgress({ categoryId, done: 0, total: uploadEntries.length, phase: "uploading" });
      let done = 0;
      for (const entry of uploadEntries) {
        const dest = `refs/${categoryId}/${entry.relative}`;
        const query = new URLSearchParams();
        query.set("session", cfg.sessionId);
        const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/upload", query);
        const formData = new FormData();
        formData.append("file", entry.file);
        formData.append("path", dest);
        await fetch(url, {
          method: "POST",
          body: formData,
          headers: { Authorization: `Bearer ${cfg.token}` },
        });
        done += 1;
        setRefsUploadProgress({ categoryId, done, total: uploadEntries.length, phase: "uploading" });
      }
      setRefsUploadProgress({ categoryId, done: uploadEntries.length, total: uploadEntries.length, phase: "processing" });
      await refetchDocuments();
      setRefsExpanded((current) => ({ ...current, [categoryId]: true }));
      if (skippedHiddenCount > 0) {
        setRefsError(trf("docagent.skipped_hidden_documents_count", { count: skippedHiddenCount }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docwriter.failed_upload_reference_files");
      setRefsError(message);
    } finally {
      setRefsUploadProgress(null);
      setRefsBusy(false);
    }
  };

  const deleteReferenceFile = async (item: DocumentItem) => {
    const cfg = apiConfig();
    if (!cfg) return;
    if (refsDeleteBusyId()) return;
    const ok = window.confirm(trf("docwriter.confirm_delete_reference_file", { path: item.name }));
    if (!ok) return;
    setRefsDeleteBusyId(item.name);
    setRefsError(null);
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/delete", query);
      await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.name }),
      });
      await refetchDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_delete_file");
      setRefsError(message);
    } finally {
      setRefsDeleteBusyId(null);
    }
  };

  const downloadReferenceItem = async (item: DocumentItem, suggestedFilename?: string) => {
    const cfg = apiConfig();
    if (!cfg) return;
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      query.set("docId", item.name);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/file", query);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
      if (!response.ok) throw new Error(trf("docwriter.request_failed_with_status", { status: response.status }));
      const blob = await response.blob();
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = suggestedFilename ?? item.name.split("/").pop() ?? "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_download_file");
      setRefsError(message);
    }
  };

  const downloadReferenceFile = async (item: DocumentItem) => {
    await downloadReferenceItem(item);
  };

  const downloadReferenceFolder = async (categoryId: string, folderPath: string, items: DocumentItem[]) => {
    if (!items.length) return;
    for (const item of items) {
      const relative = refsItemRelativePath(categoryId, item.name);
      const suffix = folderPath && relative.startsWith(`${folderPath}/`) ? relative.slice(folderPath.length + 1) : relative;
      const filename = normalizeRelativePath(suffix, item.name.split("/").pop() ?? "download").replace(/\//g, "__");
      await downloadReferenceItem(item, filename);
    }
  };

  const deleteReferenceFolder = async (folderPath: string, items: DocumentItem[]) => {
    const cfg = apiConfig();
    if (!cfg) return;
    if (refsBusy()) return;
    if (!items.length) return;
    const label = folderPath || tr("docwriter.ref_folder_root");
    const ok = window.confirm(trf("docagent.delete_folder_confirm", { path: label, count: items.length }));
    if (!ok) return;

    setRefsBusy(true);
    setRefsError(null);
    try {
      for (const item of items) {
        const query = new URLSearchParams();
        query.set("session", cfg.sessionId);
        const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/delete", query);
        await fetchJson(url, cfg.token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: item.name }),
        });
      }
      await refetchDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_delete_folder");
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

  const openReferenceInEditor = async (item: DocumentItem) => {
    if (refsOpenBusyId()) return;
    setRefsOpenBusyId(item.name);
    setRefsError(null);
    try {
      const remainder = refsItemRemainder(item.name);
      const segments = remainder.split("/").filter(Boolean);
      const categoryId = (segments[0] ?? "other").trim() || "other";
      // Files are already in documents/sessions — just open directly.
      if (categoryId === "templates" || isTemplateDocName(item.name)) {
        setTargetDoc(item.name);
      }
      setActiveDoc(item.name);
      setConfigSeq((v) => v + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docwriter.failed_open_in_editor");
      setRefsError(message);
    } finally {
      setRefsOpenBusyId(null);
    }
  };

  const openModule = (key: "facts" | "fill" | "dedupe" | "qc" | "preview") => {
    if (!BID_MODULES_ENABLED) {
      setToastMessage("Bid 独立模块接口已下线，请通过 Agent 对话流程执行。");
      return;
    }
    if (!serverReady()) return;
    if (!targetDoc()) {
      setToastMessage(tr("docwriter.select_target_first"));
      return;
    }
    setFactsError(null);
    setFillError(null);
    setDedupeError(null);
    setPreviewError(null);
    setQcError(null);

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
    setFactsError(null);
    setFillError(null);
    setDedupeError(null);
    setPreviewError(null);
    setQcError(null);
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
        techXlsxDocPath: fillTechXlsx().trim() || undefined,
        equipXlsxDocPath: fillEquipXlsx().trim() || undefined,
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
      })) as { report?: { docPath?: string } };
      const reportPath = typeof result?.report?.docPath === "string" ? result.report.docPath : "";
      setToastMessage(reportPath ? tr("docwriter.fill_complete_saved") : tr("docwriter.fill_complete"));
      closeModule();
      setConfigSeq((v) => v + 1);
      await refetchDocuments();
      await refetchDocuments();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docwriter.failed_fill");
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
        tenderDocPath: tender.name,
        applyToTarget: factsApplyToTarget(),
        force: factsForce(),
        ensureProjectInfoBlock: factsInsertBlock(),
      };
      const result = (await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as { report?: { docPath?: string } };
      const reportPath = typeof result?.report?.docPath === "string" ? result.report.docPath : "";
      setToastMessage(reportPath ? tr("docwriter.facts_complete_saved") : tr("docwriter.facts_complete"));
      closeModule();
      setConfigSeq((v) => v + 1);
      await refetchDocuments();
      await refetchDocuments();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docwriter.failed_facts");
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
      setDedupeError(tr("docwriter.dedupe_select_at_least_one"));
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
      for (const key of selected) {
        if (key.startsWith("doc:")) docPaths.push(key.slice("doc:".length));
      }

      const payload = {
        docPaths,
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
      })) as { report?: { docPath?: string }; mediaZip?: { docPath?: string }; mediaDoc?: { docPath?: string } };

      const reportPath = typeof result?.report?.docPath === "string" ? result.report.docPath : "";
      const mediaPath = typeof result?.mediaZip?.docPath === "string" ? result.mediaZip.docPath : "";
      const mediaDocPath = typeof result?.mediaDoc?.docPath === "string" ? result.mediaDoc.docPath : "";
      const mediaDocWorkspacePath = mediaDocPath;
      const hint = [
        reportPath ? tr("docwriter.dedupe_report_saved") : tr("docwriter.dedupe_complete"),
        mediaPath ? tr("docwriter.dedupe_media_saved") : "",
        mediaDocWorkspacePath ? trf("docwriter.output_suffix", { path: mediaDocWorkspacePath }) : "",
      ]
        .filter(Boolean)
        .join(" ");
      setToastMessage(hint);
      closeModule();
      if (mediaDocPath) {
        await refetchDocuments();
      }
      await refetchDocuments();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docwriter.failed_dedupe");
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
      const result = (await fetchJson(url, cfg.token, { method: "POST" })) as { passed?: boolean; report?: { docPath?: string } };
      const passed = Boolean(result?.passed);
      const label = qcMode() === "submit" ? tr("docwriter.qc_mode_submit") : tr("docwriter.qc_mode_draft");
      setToastMessage(
        passed
          ? trf("docwriter.qc_pass_saved", { mode: label })
          : trf("docwriter.qc_fail_saved", { mode: label }),
      );
      closeModule();
      await refetchDocuments();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docwriter.failed_qc");
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
      const result = (await fetchJson(url, cfg.token, { method: "POST" })) as {
        pdf?: { docPath?: string };
        pdfDoc?: { docPath?: string };
        report?: { docPath?: string };
      };
      const pdfPath = typeof result?.pdf?.docPath === "string" ? result.pdf.docPath : "";
      const pdfDocPath = typeof result?.pdfDoc?.docPath === "string" ? result.pdfDoc.docPath : "";
      const pdfDocWorkspacePath = pdfDocPath;
      setToastMessage(
        pdfPath || pdfDocPath
          ? [tr("docwriter.preview_pdf_saved"), pdfDocWorkspacePath ? trf("docwriter.output_suffix", { path: pdfDocWorkspacePath }) : ""]
            .filter(Boolean)
            .join(" ")
          : tr("docwriter.preview_pdf_complete"),
      );
      closeModule();
      await refetchDocuments();
      if (pdfDocPath) {
        setActiveDoc(pdfDocPath);
      }
      await refetchDocuments();
      setReportsExpanded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docwriter.failed_preview_pdf");
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
    return normalized;
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
    const loading = documents.loading;
    const latestItems = documents.latest ?? [];
    const hasFetchError = Boolean(documents.error);
    // Keep current selection during transient refresh gaps/fetch errors to avoid preview flicker/reset while typing.
    if (!items.length && latestItems.length > 0 && (loading || hasFetchError)) {
      return;
    }
    if (!items.length) {
      setTargetDoc(null);
      setActiveDoc(null);
      return;
    }

    const previousTarget = targetDoc();
    const currentActive = activeDoc();
    const activeExists =
      currentActive
        ? items.some((doc) => doc.name === currentActive) || latestItems.some((doc) => doc.name === currentActive)
        : false;
    const targetExists =
      previousTarget && isTemplateDocName(previousTarget)
        ? items.some((doc) => doc.name === previousTarget) || latestItems.some((doc) => doc.name === previousTarget)
        : false;

    let nextTarget: string | null = targetExists ? previousTarget : null;
    if (!nextTarget && activeExists && currentActive && isTemplateDocName(currentActive)) {
      nextTarget = currentActive;
    }
    if (!nextTarget) {
      nextTarget = items.find((doc) => isTemplateDocName(doc.name))?.name ?? latestItems.find((doc) => isTemplateDocName(doc.name))?.name ?? null;
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
    void refetchDocuments();
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

  const agentLabel = createMemo(() => props.selectedSessionAgent ?? tr("docwriter.default_agent"));
  const agentLock = createMemo(() => props.selectedSessionAgentLock);
  const agentLockTooltip = createMemo(() => {
    const lock = agentLock();
    if (!lock) return null;
    return currentLocale() === "zh" ? `智能体已锁定：@${lock}` : `Agent locked: @${lock}`;
  });

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
      const message = error instanceof Error ? error.message : tr("docagent.failed_load_agents");
      setAgentPickerError(message);
      setAgentOptions([]);
      return [];
    } finally {
      setAgentPickerBusy(false);
    }
  };

  const openAgentPicker = () => {
    if (agentLock()) {
      setToastMessage(agentLockTooltip() ?? "Agent locked");
      return;
    }
    setAgentPickerOpen((current) => !current);
    if (!agentPickerReady()) {
      void loadAgentOptions();
    }
  };

  const applySessionAgent = (agent: string | null) => {
    const lock = agentLock();
    if (lock && agent !== lock) {
      setToastMessage(agentLockTooltip() ?? "Agent locked");
      return;
    }
    const id = sessionId();
    if (!id) {
      setToastMessage(tr("docagent.no_session_selected"));
      return;
    }
    props.setSessionAgent(id, agent);
  };

  createEffect(() => {
    if (!agentLock()) return;
    setAgentPickerOpen(false);
  });

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
      return tr("docagent.add_server_token_to_attach_files");
    }
    return tr("docagent.connect_server_to_attach_files");
  });

  const handleDraftChange = (draft: ComposerDraft) => {
    props.setPrompt(draft.text);
  };

  const handleSendPrompt = (draft: ComposerDraft) => {
    props.sendPromptAsync(draft).catch(() => undefined);
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
                title={tr("docagent.expand_documents")}
                aria-label={tr("docagent.expand_documents")}
              >
                <PanelLeftOpen size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void refetchDocuments()}
                disabled={!serverReady() || documents.loading}
                title={tr("docagent.refresh_documents")}
                aria-label={tr("docagent.refresh_documents")}
              >
                <RefreshCw size={16} class={documents.loading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void archiveOtherDocuments()}
                disabled={!serverReady() || !targetDoc() || archiveBusy()}
                title={tr("docagent.archive_other_documents")}
                aria-label={tr("docagent.archive_other_documents")}
              >
                <FolderArchive size={16} />
              </button>
            </div>
          }
        >
          <div class="h-12 px-3 border-b border-dls-border flex justify-between items-center">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-dls-text leading-none">{tr("docwriter.title")}</h2>
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
                title={tr("docagent.collapse_documents")}
                aria-label={tr("docagent.collapse_documents")}
              >
                <PanelLeftClose size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void refetchDocuments()}
                disabled={!serverReady() || documents.loading}
                title={tr("docagent.refresh_documents")}
                aria-label={tr("docagent.refresh_documents")}
              >
                <RefreshCw size={16} class={documents.loading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void archiveOtherDocuments()}
                disabled={!serverReady() || !targetDoc() || archiveBusy()}
                title={tr("docagent.archive_other_documents")}
                aria-label={tr("docagent.archive_other_documents")}
              >
                <FolderArchive size={16} />
              </button>
            </div>
          </div>
        </Show>
        <div class="flex-1 min-h-0 overflow-y-auto p-2">
          <Show
            when={serverReady()}
            fallback={<div class="p-2 text-xs text-dls-secondary">{tr("docagent.server_not_connected")}</div>}
          >
            <Show
              when={!documents.error}
              fallback={
                <div class="p-2 text-xs text-red-11 whitespace-pre-wrap break-words">
                  {documents.error instanceof Error ? documents.error.message : tr("docagent.failed_load_documents")}
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
                      <span class="ml-2 text-[10px] text-dls-secondary">({tr("docwriter.target_badge")})</span>
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
                  <span>{targetDocName() ? tr("docwriter.other_documents") : tr("docwriter.session_documents")}</span>
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
                    onClick={() => void refetchDocuments()}
                    disabled={!serverReady() || documents.loading}
                    title="Refresh reports"
                    aria-label="Refresh reports"
                  >
                    <RefreshCw size={14} class={documents.loading ? "animate-spin" : ""} />
                  </button>
                </div>

                <Show when={modulesExpanded()}>
                  <div class="mt-2 grid grid-cols-1 gap-2">
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
                          <span class="ml-auto text-[10px] text-dls-secondary">{reportsList().length}</span>
                        </button>
                      </div>
                      <div class="px-2 pb-2 space-y-1">
                        <For each={visibleReports()}>
                          {(item) => {
                            const workspacePath = () => {
                              const root = sessionDocumentsRoot();
                              return root ? `${root}/${item.name}` : item.name;
                            };
                            const name = () => item.name.split("/").slice(-2).join("/");
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
                                  onClick={() => void downloadDocumentFile(item, (msg) => setToastMessage(msg))}
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
                <div class="text-[10px] uppercase tracking-wider text-dls-secondary">{tr("docwriter.reference_materials")}</div>
                <button
                  type="button"
                  class="p-1.5 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                  onClick={() => void refetchDocuments()}
                  disabled={!serverReady() || documents.loading}
                  title={tr("docwriter.refresh_reference_files")}
                  aria-label={tr("docwriter.refresh_reference_files")}
                >
                  <RefreshCw size={14} class={documents.loading ? "animate-spin" : ""} />
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
                  title={tr("docwriter.insert_reference_root_in_prompt")}
                >
                  <Folder size={14} />
                  <span class="truncate">{refsWorkspaceRoot()}/</span>
                  <span class="ml-auto text-[10px] text-dls-secondary flex items-center gap-1">
                    <AtSign size={12} />
                    {tr("docwriter.use_short")}
                  </span>
                </button>
              </Show>

              <Show when={refsUploadProgress()}>
                <div class="mt-2 px-2 text-[11px] text-dls-secondary flex items-center gap-1.5">
                  <RefreshCw size={12} class="animate-spin" />
                  <span class="truncate">{refsUploadStatusText()}</span>
                </div>
              </Show>

              <div class="mt-2 space-y-2">
                <For each={REF_CATEGORIES}>
                  {(category) => {
                    const expanded = () => Boolean(refsExpanded()[category.id]);
                    const items = () => refsByCategory()[category.id] ?? [];
                    const tree = createMemo(() => buildRefsFolderTree(category.id, items()));

                    const fileRow = (item: DocumentItem, depth: number) => {
                      const workspacePath = () => {
                        const root = sessionDocumentsRoot();
                        return root ? `${root}/${item.name}` : item.name;
                      };
                      const relativePath = () => refsItemRelativePath(category.id, item.name);
                      const name = () => relativePath().split("/").pop() ?? item.name.split("/").pop() ?? item.name;
                      const menuKey = refsFileMenuKey(category.id, item.name);
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
                            onClick={() => void useReferenceInPrompt(item)}
                            title={tr("docagent.use_in_prompt")}
                            aria-label={tr("docagent.use_in_prompt")}
                            disabled={refsOpenBusyId() === item.name}
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
                              title={tr("docwriter.more")}
                              aria-label={tr("docwriter.more")}
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
                                  disabled={!serverReady() || refsOpenBusyId() === item.name}
                                  title={tr("docwriter.preview")}
                                >
                                  {tr("docwriter.preview")}
                                </button>
                                <button
                                  type="button"
                                  class="w-full text-left rounded px-2 py-1.5 text-xs text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                                  onClick={() => {
                                    setRefsActionMenuKey(null);
                                    void downloadReferenceFile(item);
                                  }}
                                >
                                  {tr("docagent.download_file")}
                                </button>
                                <button
                                  type="button"
                                  class="w-full text-left rounded px-2 py-1.5 text-xs text-red-11 hover:bg-red-3/30 disabled:opacity-50"
                                  onClick={() => {
                                    setRefsActionMenuKey(null);
                                    void deleteReferenceFile(item);
                                  }}
                                  disabled={refsDeleteBusyId() === item.name}
                                >
                                  {tr("docagent.delete_file")}
                                </button>
                              </div>
                            </Show>
                          </div>
                        </div>
                      );
                    };

                    const collectFolderItems = (folder: RefFolderNode): DocumentItem[] => [
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
                              title={tr("docagent.use_in_prompt")}
                              aria-label={tr("docagent.use_in_prompt")}
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
                                title={tr("docwriter.more")}
                                aria-label={tr("docwriter.more")}
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
                                    {tr("docagent.download_folder")}
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
                                    {tr("docagent.delete_folder")}
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
                            <span class="truncate text-[12px]">{tr(category.labelKey)}</span>
                            <span class="ml-auto text-[10px] text-dls-secondary">{items().length}</span>
                          </button>
                          <button
                            type="button"
                            class="ml-2 p-1.5 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                            onClick={() => {
                              const path = categoryPromptPath(category.id);
                              if (!path) return;
                              insertRefInPrompt(path);
                            }}
                            disabled={!serverReady() || refsBusy() || !categoryPromptPath(category.id)}
                            title={tr("docagent.use_in_prompt")}
                            aria-label={tr("docagent.use_in_prompt")}
                          >
                            <AtSign size={14} />
                          </button>
                          <label
                            class={`ml-2 cursor-pointer p-1.5 rounded hover:bg-dls-hover ${!serverReady() || refsBusy() ? "opacity-50 cursor-not-allowed" : ""
                              }`}
                            title={trf("docwriter.upload_to_category", { category: tr(category.labelKey) })}
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
                            title={trf("docwriter.upload_folder_to_category", { category: tr(category.labelKey) })}
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
                            <Show when={items().length > 0} fallback={<div class="py-1 text-[11px] text-dls-secondary">{tr("docwriter.no_files")}</div>}>
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
          aria-label={tr("docagent.resize_documents_panel")}
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
              title={documentsCollapsed() ? tr("docagent.show_documents") : tr("docagent.hide_documents")}
              aria-label={documentsCollapsed() ? tr("docagent.show_documents") : tr("docagent.hide_documents")}
            >
              <Show when={documentsCollapsed()} fallback={<PanelLeftClose size={16} />}>
                <PanelLeftOpen size={16} />
              </Show>
            </button>
            <div class="text-xs text-dls-secondary truncate">
              <Show when={targetDoc()} fallback={tr("docwriter.select_target_from_templates")}>
                {tr("docagent.target_prefix")} <span class="text-dls-text">{targetDoc()}</span>
                <Show when={activeDoc() && activeDoc() !== targetDoc()}>
                  <span class="ml-2 text-dls-secondary">· {tr("docagent.viewing_prefix")}</span>{" "}
                  <span class="text-dls-text">{activeDoc()}</span>
                </Show>
              </Show>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class={DOC_TOOLBAR_BACK_BUTTON_CLASS}
              onClick={() => {
                navigate("/dashboard/agents");
              }}
              title={tr("docagent.open_session_view")}
              aria-label={tr("docagent.open_session_view")}
            >
              <ArrowLeft size={12} />
              <span>{tr("docagent.session")}</span>
            </button>
            <button
              type="button"
              class={DOC_TOOLBAR_BUTTON_CLASS}
              onClick={() => {
                const path = activeDocPath();
                if (!path) return;
                const existing = props.prompt.trim();
                const targetPrompt = trf("docagent.target_document_prompt_prefix", { path });
                const next = existing ? `${existing}\n\n${targetPrompt}\n` : `${targetPrompt}\n`;
                props.setPrompt(next);
              }}
              disabled={!activeDocPath()}
              title={tr("docagent.insert_document_path_into_prompt")}
            >
              {tr("docagent.use_in_prompt")}
            </button>
            <button
              type="button"
              class={DOC_TOOLBAR_BUTTON_CLASS}
              onClick={() => setConfigSeq((v) => v + 1)}
              disabled={!activeDoc() || activeDocKind() !== "onlyoffice"}
              title={tr("docagent.reload_onlyoffice_config")}
            >
              {tr("docagent.reload")}
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
                    alt={activeDoc() ?? tr("docwriter.image_alt")}
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
                      <pre class="text-xs leading-relaxed whitespace-pre-wrap break-words rounded-lg border border-dls-border bg-dls-sidebar p-3 text-dls-text font-mono">
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
                      <span class="font-medium text-dls-text">{tr("docagent.preview_mode")}</span>{" "}
                      {trf("docagent.preview_mode_desc", { target: targetDoc() ?? "" })}{" "}
                      <button
                        type="button"
                        class="pointer-events-auto ml-2 underline text-dls-secondary hover:text-dls-text"
                        onClick={() => setActiveDoc(targetDoc())}
                      >
                        {tr("docagent.back_to_target")}
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
                      <span class="font-medium text-dls-text">{tr("docagent.ai_is_editing")}</span>{" "}
                      {tr("docagent.ai_is_editing_desc")}
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
        aria-label={tr("docagent.resize_chat_panel")}
        aria-orientation="vertical"
      >
        <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-dls-border/60" />
      </div>

      {/* Right: Chat */}
      <div class="relative z-30 shrink-0 border-l border-dls-border flex flex-col bg-dls-surface" style={{ width: `${rightPaneWidth()}px` }}>
        <div class="h-12 border-b border-dls-border px-3 flex items-center justify-between">
          <div class="min-w-0">
            <div class="text-sm font-medium text-dls-text truncate">{tr("docagent.chat")}</div>
            <div class="text-[11px] text-dls-secondary truncate">
              <Show when={props.selectedSessionAgent} fallback={tr("docwriter.default_agent")}>
                @{props.selectedSessionAgent}
              </Show>
            </div>
          </div>
          <div class="text-[11px] text-dls-secondary truncate" title={sessionId()}>
            {sessionId() ? `#${sessionId().slice(0, 8)}` : tr("docagent.no_session")}
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain" ref={(el) => (chatContainerEl = el)}>
          <MessageList
            messages={props.messages}
            developerMode={props.developerMode}
            showThinking={props.showThinking}
            expandedStepIds={props.expandedStepIds}
            setExpandedStepIds={props.setExpandedStepIds}
            compact
          />
          <div
            ref={(el) => {
              messagesEndEl = el;
              bottomVisibilityEl = el;
            }}
          />
        </div>

        <Show when={todoCount() > 0}>
          <div class="px-4">
            <div class="rounded-t-xl border border-b-0 border-gray-6/70 bg-gray-1/70 shadow-sm shadow-gray-12/5">
              <button
                type="button"
                class="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-9 hover:bg-gray-2/50 transition-colors rounded-t-xl"
                onClick={() => setTodoExpanded((v) => !v)}
              >
                <div class="flex items-center gap-2">
                  <ListTodo size={14} class="text-gray-8" />
                  <span class="text-gray-11 font-medium">{todoLabel()}</span>
                </div>
                <Minimize2
                  size={12}
                  class={`text-gray-8 transition-transform ${todoExpanded() ? "" : "rotate-180"}`}
                />
              </button>
              <Show when={todoExpanded()}>
                <div class="px-4 pb-3 space-y-2.5 max-h-60 overflow-auto border-t border-gray-6/50">
                  <For each={todoList()}>
                    {(todo, index) => {
                      const done = () => todo.status === "completed";
                      const cancelled = () => todo.status === "cancelled";
                      const active = () => todo.status === "in_progress";
                      return (
                        <div class="flex items-start gap-2.5 pt-2.5 first:pt-2.5">
                          <div class="flex items-center gap-1.5 pt-0.5">
                            <div
                              class={`h-4.5 w-4.5 rounded-full border flex items-center justify-center ${
                                done()
                                  ? "border-green-6 bg-green-2 text-green-11"
                                  : active()
                                    ? "border-amber-6 bg-amber-2 text-amber-11"
                                    : cancelled()
                                      ? "border-gray-6 bg-gray-2 text-gray-8"
                                      : "border-gray-6 bg-gray-1 text-gray-8"
                              }`}
                            >
                              <Show when={done()}>
                                <Check size={10} />
                              </Show>
                              <Show when={!done() && active()}>
                                <span class="h-1.5 w-1.5 rounded-full bg-amber-9" />
                              </Show>
                            </div>
                          </div>
                          <div
                            class={`flex-1 text-sm leading-relaxed ${
                              cancelled() ? "text-gray-9 line-through" : "text-gray-12"
                            }`}
                          >
                            <span class="text-gray-9 mr-1.5">{index() + 1}.</span>
                            {todo.content}
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        <Composer
          prompt={props.prompt}
          developerMode={props.developerMode}
          busy={props.busy}
          isStreaming={isAgentRunning()}
          onSend={handleSendPrompt}
          onStop={cancelRun}
          onDraftChange={handleDraftChange}
          selectedModelLabel={props.selectedSessionModelLabel || tr("session.model")}
          onModelClick={props.openSessionModelPicker}
          modelVariantLabel={props.modelVariantLabel}
          modelVariant={props.modelVariant}
          onModelVariantChange={props.setModelVariant}
          agentLabel={agentLabel()}
          selectedAgent={props.selectedSessionAgent}
          agentPickerOpen={agentPickerOpen()}
          agentPickerBusy={agentPickerBusy()}
          agentPickerError={agentPickerError()}
          agentPickerDisabled={Boolean(agentLock())}
          agentPickerDisabledReason={agentLockTooltip()}
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
                <div class="text-sm font-semibold text-dls-text truncate">{tr("docwriter.facts_title")}</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  {tr("docagent.target_prefix")} {targetDoc() ?? "—"}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label={tr("docwriter.close")}
                title={tr("docwriter.close")}
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="min-w-0">
                <div class="text-xs font-medium text-dls-text">{tr("docwriter.facts_tender_source_label")}</div>
                <div class="mt-2 rounded-lg border border-dls-border overflow-hidden max-h-[360px] overflow-y-auto">
                  <Show when={!documents.loading} fallback={<div class="p-3 text-xs text-dls-secondary">{tr("docwriter.loading")}</div>}>
                    <Show
                      when={tenderSources().length > 0}
                      fallback={<div class="p-3 text-xs text-dls-secondary">{tr("docwriter.facts_upload_tender_hint")}</div>}
                    >
                      <For each={tenderSources()}>
                        {(item) => {
                          const selected = createMemo(() => factsTenderSource()?.name === item.name);
                          const name = () => item.name.split("/").pop() ?? item.name;
                          return (
                            <button
                              type="button"
                              class={`w-full text-left px-3 py-2 border-b border-dls-border/50 last:border-b-0 hover:bg-dls-hover ${selected() ? "bg-dls-active" : ""
                                }`}
                              onClick={() => setFactsTenderSource(item)}
                              title={item.name}
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
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.what_it_does")}</div>
                  <div class="mt-2 text-[11px] text-dls-secondary">
                    {tr("docwriter.facts_description")}
                  </div>
                </div>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={factsApplyToTarget()}
                    onChange={(event) => setFactsApplyToTarget(event.currentTarget.checked)}
                  />
                  {tr("docwriter.facts_apply_target")}
                </label>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={factsForce()}
                    onChange={(event) => setFactsForce(event.currentTarget.checked)}
                    disabled={!factsApplyToTarget()}
                  />
                  {tr("docwriter.facts_force_overwrite")}
                </label>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={factsInsertBlock()}
                    onChange={(event) => setFactsInsertBlock(event.currentTarget.checked)}
                    disabled={!factsApplyToTarget()}
                  />
                  {tr("docwriter.facts_insert_block")}
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
                {tr("docwriter.cancel")}
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runFacts()}
                disabled={factsBusy() || !factsTenderSource()}
                title={!factsTenderSource() ? tr("docwriter.select_tender_document") : tr("docwriter.run_facts")}
              >
                <Show when={!factsBusy()} fallback={tr("docwriter.working")}>
                  {tr("docwriter.run_facts")}
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
                <div class="text-sm font-semibold text-dls-text truncate">{tr("docwriter.fill_title")}</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  {tr("docagent.target_prefix")} {targetDoc() ?? "—"}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label={tr("docwriter.close")}
                title={tr("docwriter.close")}
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.fill_tech_xlsx")}</div>
                  <select
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                    value={fillTechXlsx()}
                    onChange={(event) => setFillTechXlsx(event.currentTarget.value)}
                  >
                    <option value="">—</option>
                    <For each={xlsxRefs()}>
                      {(item) => (
                        <option value={item.name}>
                          {item.name.split("/").pop() ?? item.name}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.fill_equip_xlsx")}</div>
                  <select
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                    value={fillEquipXlsx()}
                    onChange={(event) => setFillEquipXlsx(event.currentTarget.value)}
                  >
                    <option value="">—</option>
                    <For each={xlsxRefs()}>
                      {(item) => (
                        <option value={item.name}>
                          {item.name.split("/").pop() ?? item.name}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.fill_brand")}</div>
                  <input
                    type="text"
                    value={fillBrand()}
                    onInput={(event) => setFillBrand(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.fill_manufacturer")}</div>
                  <input
                    type="text"
                    value={fillManufacturer()}
                    onInput={(event) => setFillManufacturer(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.fill_origin")}</div>
                  <input
                    type="text"
                    value={fillOrigin()}
                    onInput={(event) => setFillOrigin(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.fill_unit")}</div>
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
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.fill_price_placeholder")}</div>
                  <input
                    type="text"
                    value={fillPricePlaceholder()}
                    onInput={(event) => setFillPricePlaceholder(event.currentTarget.value)}
                    class="mt-2 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div>
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.fill_spec_placeholder")}</div>
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
                {tr("docwriter.cancel")}
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runFill()}
                disabled={fillBusy()}
              >
                <Show when={!fillBusy()} fallback={tr("docwriter.working")}>
                  {tr("docwriter.fill_action")}
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
                <div class="text-sm font-semibold text-dls-text truncate">{tr("docwriter.dedupe_title")}</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  {trf("docwriter.dedupe_target_always_included", { target: targetDoc() ?? "—" })}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label={tr("docwriter.close")}
                title={tr("docwriter.close")}
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="min-w-0">
                <div class="flex items-center justify-between">
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.dedupe_compare_with")}</div>
                  <div class="text-[11px] text-dls-secondary">{trf("docwriter.dedupe_selected_count", { count: dedupeSelected().size })}</div>
                </div>
                <div class="mt-2">
                  <input
                    type="text"
                    value={dedupeQuery()}
                    onInput={(event) => setDedupeQuery(event.currentTarget.value)}
                    placeholder={tr("docwriter.search_documents")}
                    class="w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div class="mt-2 rounded-lg border border-dls-border overflow-hidden max-h-[420px] overflow-y-auto">
                  <Show when={!documents.loading && !documents.loading} fallback={<div class="p-3 text-xs text-dls-secondary">{tr("docwriter.loading")}</div>}>
                    <Show
                      when={filteredDedupeCandidates().length > 0}
                      fallback={<div class="p-3 text-xs text-dls-secondary">{tr("docwriter.no_docx_sources")}</div>}
                    >
                      <For each={filteredDedupeCandidates()}>
                        {(item) => {
                          const displayName = () =>
                            item.kind === "doc"
                              ? item.name.split("/").pop() ?? item.name
                              : item.name.split("/").pop() ?? item.name;
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
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.settings")}</div>
                  <div class="mt-2 text-[11px] text-dls-secondary">
                    {tr("docwriter.dedupe_description")}
                  </div>
                </div>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={dedupeExcludeTables()}
                    onChange={(event) => setDedupeExcludeTables(event.currentTarget.checked)}
                  />
                  {tr("docwriter.dedupe_exclude_tables")}
                </label>

                <div>
                  <div class="text-xs font-medium text-dls-text">{tr("docwriter.dedupe_similarity_threshold")}</div>
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
                    <div class="text-[11px] text-dls-secondary">{tr("docwriter.dedupe_similarity_help")}</div>
                  </div>
                </div>

                <label class="flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={dedupeExportMedia()}
                    onChange={(event) => setDedupeExportMedia(event.currentTarget.checked)}
                  />
                  {tr("docwriter.dedupe_export_media")}
                </label>

                <div class="rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-xs font-medium text-dls-text">{tr("docwriter.dedupe_title_filters")}</div>
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        class="text-[11px] underline text-dls-secondary hover:text-dls-text"
                        onClick={() => setDedupeIncludeTitles("技术|方案|实施|架构|服务|运维|安全|偏离")}
                      >
                        {tr("docwriter.dedupe_tech_preset")}
                      </button>
                      <button
                        type="button"
                        class="text-[11px] underline text-dls-secondary hover:text-dls-text"
                        onClick={() =>
                          setDedupeExcludeTitles("开标|一览表|分项|清单|点对点|授权|资质|证明|商务|报价|保证金|合同")
                        }
                      >
                        {tr("docwriter.dedupe_form_preset")}
                      </button>
                      <button
                        type="button"
                        class="text-[11px] underline text-dls-secondary hover:text-dls-text"
                        onClick={() => {
                          setDedupeIncludeTitles("");
                          setDedupeExcludeTitles("");
                        }}
                      >
                        {tr("docwriter.clear")}
                      </button>
                    </div>
                  </div>
                  <div class="mt-1 text-[11px] text-dls-secondary">
                    {tr("docwriter.dedupe_title_filters_help")}
                  </div>
                  <div class="mt-2 grid grid-cols-1 gap-2">
                    <div>
                      <div class="text-[11px] text-dls-secondary">{tr("docwriter.include")}</div>
                      <textarea
                        rows={2}
                        value={dedupeIncludeTitles()}
                        onInput={(event) => setDedupeIncludeTitles(event.currentTarget.value)}
                        placeholder={tr("docwriter.dedupe_include_placeholder")}
                        class="mt-1 w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                      />
                    </div>
                    <div>
                      <div class="text-[11px] text-dls-secondary">{tr("docwriter.exclude")}</div>
                      <textarea
                        rows={2}
                        value={dedupeExcludeTitles()}
                        onInput={(event) => setDedupeExcludeTitles(event.currentTarget.value)}
                        placeholder={tr("docwriter.dedupe_exclude_placeholder")}
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
                {tr("docwriter.cancel")}
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runDedupe()}
                disabled={dedupeBusy() || dedupeSelected().size < 1}
                title={dedupeSelected().size < 1 ? tr("docwriter.dedupe_select_at_least_one_short") : tr("docwriter.run_dedupe")}
              >
                <Show when={!dedupeBusy()} fallback={tr("docwriter.working")}>
                  {tr("docwriter.run_dedupe")}
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
                <div class="text-sm font-semibold text-dls-text truncate">{tr("docwriter.preview_pdf_title")}</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  {tr("docagent.target_prefix")} {targetDoc() ?? "—"}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label={tr("docwriter.close")}
                title={tr("docwriter.close")}
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 space-y-3">
              <div class="text-xs text-dls-secondary">
                {tr("docwriter.preview_pdf_description")}
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
                {tr("docwriter.cancel")}
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runPreviewPdf()}
                disabled={previewBusy()}
              >
                <Show when={!previewBusy()} fallback={tr("docwriter.working")}>
                  {tr("docwriter.export_pdf")}
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
                <div class="text-sm font-semibold text-dls-text truncate">{tr("docwriter.qc_title")}</div>
                <div class="mt-1 text-[11px] text-dls-secondary truncate">
                  {tr("docagent.target_prefix")} {targetDoc() ?? "—"}
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeModule}
                aria-label={tr("docwriter.close")}
                title={tr("docwriter.close")}
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 space-y-3">
              <div class="text-xs text-dls-secondary">
                {tr("docwriter.qc_description")}
              </div>
              <div class="grid grid-cols-1 gap-2 rounded-xl border border-dls-border bg-dls-surface p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-xs font-semibold text-dls-text truncate">{tr("docwriter.mode")}</div>
                    <div class="mt-1 text-[11px] text-dls-secondary">
                      {tr("docwriter.qc_mode_description")}
                    </div>
                  </div>
                  <select
                    value={qcMode()}
                    onChange={(event) => setQcMode(event.currentTarget.value === "submit" ? "submit" : "draft")}
                    class="shrink-0 rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                    aria-label={tr("docwriter.qc_mode_label")}
                    title={tr("docwriter.qc_mode_strictness")}
                  >
                    <option value="draft">{tr("docwriter.qc_mode_draft")}</option>
                    <option value="submit">{tr("docwriter.qc_mode_submit")}</option>
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
                {tr("docwriter.cancel")}
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runQc()}
                disabled={qcBusy()}
              >
                <Show when={!qcBusy()} fallback={tr("docwriter.working")}>
                  {tr("docwriter.run_qc")}
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
