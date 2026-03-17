import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { ArrowLeft, AtSign, Check, ChevronDown, ChevronRight, Download, FileText, Folder, FolderOpen, FolderPlus, ListTodo, Minimize2, MoveRight, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Trash2 } from "lucide-solid";
import { useNavigate } from "@solidjs/router";

import type { ComposerDraft, SlashCommandOption } from "../types";
import type { SessionViewProps } from "./session";
import OnlyOfficeEditor from "../components/onlyoffice-editor";
import MessageList from "../components/session/message-list";
import Composer from "../components/session/composer";
import ToolMonitorPanel from "../components/tool-monitor/tool-monitor-panel";
import { DOCUMENT_UPLOAD_ACCEPT } from "../lib/documents";
import { currentLocale, t as i18n } from "../../i18n";
import {
  buildToolMonitorTurnReport,
  selectLatestAssistantTurn,
  selectNearestUserMessage,
  shouldAnalyzeForAgent,
} from "../lib/tool-monitor/analyze";
import type { ToolMonitorTurnReport } from "../lib/tool-monitor/types";
import { renderToolMonitorMarkdown } from "../lib/tool-monitor/markdown";
import { uploadSessionMarkdownReport } from "../lib/tool-monitor/persist";
import { requestToolMonitorModelRetrospective } from "../lib/tool-monitor/reflect";

type DocumentItem = {
  name: string;
  updatedAt: number;
  size: number;
  type: string;
};

type DocumentListResult = {
  items: DocumentItem[];
  dirs: string[];
};

type UploadProgressState = {
  phase: "preparing" | "uploading" | "processing";
  done: number;
  total: number;
  preserveRelativePath: boolean;
};

type DocumentWriterUiState = {
  schemaVersion: 1;
  activeDoc?: string;
  leftPaneWidth?: number;
  rightPaneWidth?: number;
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

const LEFT_PANEL_COLLAPSED_WIDTH = 56;
const LEFT_PANEL_DEFAULT_WIDTH = 256;
const LEFT_PANEL_MIN_WIDTH = 220;
const RIGHT_PANEL_DEFAULT_WIDTH = 500;
const RIGHT_PANEL_MIN_WIDTH = 360;
const CENTER_PANEL_MIN_WIDTH = 520;
const STREAM_SCROLL_MIN_INTERVAL_MS = 90;
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
const ONLYOFFICE_IMPORT_EXTENSIONS = new Set(
  DOCUMENT_UPLOAD_ACCEPT.split(",")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean),
);

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const getFileExtension = (value: string) => {
  const base = value.split("/").pop() ?? value;
  const match = base.toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
};
const getFileBaseName = (value: string) => (value.split("/").pop() ?? value).toLowerCase();
const isOnlyOfficeImportable = (path: string) => ONLYOFFICE_IMPORT_EXTENSIONS.has(getFileExtension(path));
const isImagePreviewable = (path: string) => IMAGE_PREVIEW_EXTENSIONS.has(getFileExtension(path));
const isMarkdownPreviewable = (path: string) => MARKDOWN_PREVIEW_EXTENSIONS.has(getFileExtension(path));
const isTargetDocumentCandidate = (path: string) =>
  isOnlyOfficeImportable(path) || isMarkdownPreviewable(path) || isTextPreviewable(path);
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

type FileTreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children: FileTreeNode[];
  size?: number;
  updatedAt?: number;
  type?: string;
};

const normalizeRelativePath = (value: string, fallback = "") => {
  const cleaned = value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  const parts = cleaned
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return parts.length ? parts.join("/") : fallback;
};

const joinRelativePath = (...parts: Array<string | null | undefined>) =>
  normalizeRelativePath(parts.filter(Boolean).join("/"), "");

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

const parentDirPath = (path: string) => {
  const normalized = normalizeRelativePath(path, "");
  if (!normalized) return "";
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
};

const remapPathAfterMove = (
  value: string | null,
  fromPath: string,
  toPath: string,
  options?: { isDirectory?: boolean },
) => {
  const normalized = normalizeRelativePath(value ?? "", "");
  if (!normalized) return null;
  if (normalized === fromPath) return toPath;
  if (!options?.isDirectory) return normalized;
  const prefix = `${fromPath}/`;
  if (!normalized.startsWith(prefix)) return normalized;
  const suffix = normalized.slice(prefix.length);
  return suffix ? `${toPath}/${suffix}` : toPath;
};

function buildFileTree(items: DocumentItem[], directories: string[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", isDirectory: true, children: [] };
  const foldersByPath = new Map<string, FileTreeNode>([["", root]]);

  const ensureFolder = (folderPath: string): FileTreeNode => {
    const normalized = normalizeRelativePath(folderPath, "");
    if (!normalized) return root;
    const parts = normalized.split("/");
    let current = root;
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let folder = foldersByPath.get(currentPath);
      if (!folder) {
        folder = { name: part, path: currentPath, isDirectory: true, children: [] };
        current.children.push(folder);
        foldersByPath.set(currentPath, folder);
      }
      current = folder;
    }
    return current;
  };

  for (const directory of directories) {
    const normalized = normalizeRelativePath(directory, "");
    if (!normalized) continue;
    ensureFolder(normalized);
  }

  for (const item of items) {
    const normalized = normalizeRelativePath(item.name, "");
    if (!normalized) continue;
    const parts = normalized.split("/");
    const fileName = parts.pop();
    if (!fileName) continue;
    const folderPath = parts.join("/");
    const parent = ensureFolder(folderPath);
    if (parent.children.some((child) => !child.isDirectory && child.path === normalized)) {
      continue;
    }
    parent.children.push({
      name: fileName,
      path: normalized,
      isDirectory: false,
      children: [],
      size: item.size,
      updatedAt: item.updatedAt,
      type: item.type,
    });
  }

  const sortTree = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.isDirectory) sortTree(n.children);
  };
  sortTree(root.children);
  return root.children;
}

export default function DocumentAgentView(props: SessionViewProps) {
  const navigate = useNavigate();
  const tr = (key: string) => i18n(key, currentLocale());
  const trf = (key: string, vars?: Record<string, string | number>) => {
    let value = tr(key);
    if (vars) {
      for (const [name, token] of Object.entries(vars)) {
        value = value.replaceAll(`{${name}}`, String(token));
      }
    }
    return value;
  };
  let uploadInputEl: HTMLInputElement | undefined;
  let uploadFolderInputEl: HTMLInputElement | undefined;
  let documentsScrollEl: HTMLDivElement | undefined;
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
        const suffix = reportPath ? `\n\nReport: ${reportPath}` : "";
        throw new Error((message || `Request failed (${response.status})`) + suffix);
      } catch {
        throw new Error(text || `Request failed (${response.status})`);
      }
    }
    return await response.json();
  };

  const parseErrorMessage = async (response: Response) => {
    const text = await response.text().catch(() => "");
    if (!text) return `Request failed (${response.status})`;
    try {
      const parsed = JSON.parse(text) as { message?: unknown } | null;
      if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message;
      }
    } catch {
      // ignore JSON parse errors and fallback to raw text
    }
    return text;
  };

  const parseDownloadFilename = (response: Response, fallback: string) => {
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename\\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
    const raw = match?.[1] ?? match?.[2] ?? "";
    if (!raw) return fallback;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };

  const triggerBrowserDownload = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename || "download";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  };

  const docWriterStateKey = createMemo(() => {
    const w = workspaceId();
    const s = sessionId();
    if (!w || !s) return "";
    return `openwork.document-agent.ui.v1:${w}:${s}`;
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
  const [todoExpanded, setTodoExpanded] = createSignal(false);
  const [toolMonitorExpanded, setToolMonitorExpanded] = createSignal(false);
  const [toolMonitorReports, setToolMonitorReports] = createSignal<ToolMonitorTurnReport[]>([]);
  const [toolMonitorManualTriggerBusy, setToolMonitorManualTriggerBusy] = createSignal(false);
  let lastToolMonitorAssistantMessageId: string | null = null;
  const todoList = createMemo(() => (props.todos ?? []).filter((todo) => todo.content.trim()));
  const todoCount = createMemo(() => todoList().length);
  const todoCompletedCount = createMemo(() => todoList().filter((todo) => todo.status === "completed").length);
  const todoLabel = createMemo(() => {
    const total = todoCount();
    if (!total) return "";
    return `${todoCompletedCount()} / ${total} ${tr("docwriter.tasks_completed")}`;
  });
  const [leftPaneWidth, setLeftPaneWidth] = createSignal(LEFT_PANEL_DEFAULT_WIDTH);
  const [rightPaneWidth, setRightPaneWidth] = createSignal(RIGHT_PANEL_DEFAULT_WIDTH);
  const [resizingPane, setResizingPane] = createSignal<"left" | "right" | null>(null);
  const [configSeq, setConfigSeq] = createSignal(0);
  const [uploadBusy, setUploadBusy] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal<UploadProgressState | null>(null);
  const [deleteBusyPath, setDeleteBusyPath] = createSignal<string | null>(null);
  const [downloadBusyPath, setDownloadBusyPath] = createSignal<string | null>(null);
  const [moveBusyPath, setMoveBusyPath] = createSignal<string | null>(null);
  const [activeFolder, setActiveFolder] = createSignal("");
  const [lastSessionStatus, setLastSessionStatus] = createSignal(props.sessionStatus ?? "idle");
  const [nearBottom, setNearBottom] = createSignal(true);
  let paneResizeCleanup: (() => void) | null = null;

  const [documents, { refetch: refetchDocuments }] = createResource(apiConfig, async (cfg) => {
    if (!cfg) return { items: [], dirs: [] } satisfies DocumentListResult;
    const query = new URLSearchParams();
    query.set("session", cfg.sessionId);
    const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/documents", query);
    const data = (await fetchJson(url, cfg.token)) as { items?: DocumentItem[]; dirs?: string[] };
    return {
      items: Array.isArray(data.items) ? data.items : [],
      dirs: Array.isArray(data.dirs) ? data.dirs : [],
    } satisfies DocumentListResult;
  });

  const documentsList = createMemo(() => documents()?.items ?? []);
  const documentDirs = createMemo(() => documents()?.dirs ?? []);
  const documentFileSet = createMemo(
    () =>
      new Set(
        documentsList()
          .map((item) => normalizeRelativePath(item.name, ""))
          .filter(Boolean),
      ),
  );
  const documentDirSet = createMemo(
    () =>
      new Set(
        documentDirs()
          .map((dir) => normalizeRelativePath(dir, ""))
          .filter(Boolean),
      ),
  );
  const documentPathExists = (path: string) => {
    const normalized = normalizeRelativePath(path, "");
    if (!normalized) return false;
    return documentFileSet().has(normalized) || documentDirSet().has(normalized);
  };
  const refreshDocumentsKeepingScroll = async () => {
    const previousScrollTop = documentsScrollEl?.scrollTop ?? 0;
    await refetchDocuments();
    if (!documentsScrollEl) return;
    requestAnimationFrame(() => {
      if (!documentsScrollEl) return;
      documentsScrollEl.scrollTop = previousScrollTop;
    });
  };
  const uploadProgressLabel = createMemo(() => {
    const progress = uploadProgress();
    if (!progress) return "";
    if (progress.phase === "preparing") {
      return trf("docagent.preparing_upload_count", { count: progress.total });
    }
    if (progress.phase === "processing") {
      return tr("docagent.processing_uploaded_documents");
    }
    return progress.preserveRelativePath
      ? trf("docagent.uploading_folder_progress", { done: progress.done, total: progress.total })
      : trf("docagent.uploading_documents_progress", { done: progress.done, total: progress.total });
  });

  const fileTree = createMemo(() => buildFileTree(documentsList(), documentDirs()));
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set());

  const expandFolderPath = (folderPath: string) => {
    const normalized = normalizeRelativePath(folderPath, "");
    if (!normalized) return;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      const parts = normalized.split("/");
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        next.add(current);
      }
      return next;
    });
  };

  function TreeNodeView(nodeProps: { node: FileTreeNode; depth: number }) {
    const expanded = createMemo(() => expandedFolders().has(nodeProps.node.path));
    const isActive = createMemo(() =>
      nodeProps.node.isDirectory ? activeFolder() === nodeProps.node.path : activeDoc() === nodeProps.node.path,
    );
    const workspacePath = createMemo(() =>
      toWorkspaceRelativeDocumentPath(nodeProps.node.path, { directory: nodeProps.node.isDirectory }),
    );
    const toggleExpand = () => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(nodeProps.node.path)) next.delete(nodeProps.node.path);
        else next.add(nodeProps.node.path);
        return next;
      });
    };
    return (
      <div>
        <div
          class={`w-full flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-gray-4 ${
            isActive() ? "bg-gray-5 text-gray-12 font-medium" : "text-gray-11"
          }`}
          style={{ "padding-left": `${8 + nodeProps.depth * 16}px` }}
        >
          <button
            type="button"
            class="min-w-0 flex-1 flex items-center gap-1.5 text-left"
            onClick={() => {
              if (nodeProps.node.isDirectory) {
                setActiveFolder(nodeProps.node.path);
                toggleExpand();
              } else {
                setActiveFolder(parentDirPath(nodeProps.node.path));
                setActiveDoc(nodeProps.node.path);
                if (isTargetDocumentCandidate(nodeProps.node.path)) {
                  setTargetDoc(nodeProps.node.path);
                }
                setConfigSeq((v) => v + 1);
              }
            }}
            title={workspacePath()}
          >
            <Show when={nodeProps.node.isDirectory}
              fallback={<FileText size={14} class="shrink-0" />}>
              <Show when={expanded()} fallback={<ChevronRight size={14} class="shrink-0" />}>
                <ChevronDown size={14} class="shrink-0" />
              </Show>
              <Show when={expanded()} fallback={<Folder size={14} class="shrink-0" />}>
                <FolderOpen size={14} class="shrink-0" />
              </Show>
            </Show>
            <span class="truncate">{nodeProps.node.name}</span>
          </button>
          <button
            type="button"
            class="p-1 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text"
            onClick={(event) => {
              event.stopPropagation();
              insertReferenceInPrompt(workspacePath());
            }}
            title={tr("docagent.use_in_prompt")}
            aria-label={tr("docagent.use_in_prompt")}
          >
            <AtSign size={12} />
          </button>
          <button
            type="button"
            class="p-1 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text disabled:opacity-50"
            onClick={(event) => {
              event.stopPropagation();
              if (nodeProps.node.isDirectory) {
                void downloadDocumentFolder(nodeProps.node.path);
              } else {
                void downloadDocumentFile(nodeProps.node.path);
              }
            }}
            disabled={Boolean(downloadBusyPath())}
            title={nodeProps.node.isDirectory ? tr("docagent.download_folder") : tr("docagent.download_file")}
            aria-label={nodeProps.node.isDirectory ? tr("docagent.download_folder") : tr("docagent.download_file")}
          >
            <Download size={12} />
          </button>
          <button
            type="button"
            class="p-1 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text disabled:opacity-50"
            onClick={(event) => {
              event.stopPropagation();
              void moveDocumentNode(nodeProps.node.path, { isDirectory: nodeProps.node.isDirectory });
            }}
            disabled={Boolean(moveBusyPath())}
            title={nodeProps.node.isDirectory ? tr("docagent.move_folder") : tr("docagent.move_file")}
            aria-label={nodeProps.node.isDirectory ? tr("docagent.move_folder") : tr("docagent.move_file")}
          >
            <MoveRight size={12} />
          </button>
          <button
            type="button"
            class="p-1 rounded hover:bg-dls-active text-dls-secondary hover:text-red-11 disabled:opacity-50"
            onClick={(event) => {
              event.stopPropagation();
              if (nodeProps.node.isDirectory) {
                void deleteDocumentFolder(nodeProps.node.path);
              } else {
                void deleteDocumentFile(nodeProps.node.path);
              }
            }}
            disabled={Boolean(deleteBusyPath())}
            title={nodeProps.node.isDirectory ? tr("docagent.delete_folder") : tr("docagent.delete_file")}
            aria-label={nodeProps.node.isDirectory ? tr("docagent.delete_folder") : tr("docagent.delete_file")}
          >
            <Trash2 size={12} />
          </button>
        </div>
        <Show when={nodeProps.node.isDirectory && expanded()}>
          <For each={nodeProps.node.children}>
            {(child) => <TreeNodeView node={child} depth={nodeProps.depth + 1} />}
          </For>
        </Show>
      </div>
    );
  }

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
    return {
      ...cfg,
      doc,
      seq: configSeq(),
      readonly: isAgentRunning(),
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

  const documentWorkspaceRoot = createMemo(() => {
    return "";
  });

  const toWorkspaceRelativeDocumentPath = (path: string, options?: { directory?: boolean }) => {
    const normalized = normalizeRelativePath(path, "");
    const base = documentWorkspaceRoot();
    const joined = base ? (normalized ? `${base}/${normalized}` : base) : normalized;
    return options?.directory ? `${joined}/` : joined;
  };

  const insertReferenceInPrompt = (workspaceRelativePath: string) => {
    const tag = `@${workspaceRelativePath}`;
    const existing = props.prompt.trim();
    const next = existing ? `${existing}\n${tag}` : tag;
    props.setPrompt(next);
  };

  const uploadDocuments = async (
    files: File[],
    options?: { baseDir?: string; preserveRelativePath?: boolean },
  ) => {
    const cfg = apiConfig();
    if (!cfg || !files.length) return;
    if (uploadBusy()) return;

    const baseDir = normalizeRelativePath(options?.baseDir ?? activeFolder(), "");
    const preserveRelativePath = options?.preserveRelativePath ?? false;
    const hiddenSkipMessage = (count: number) =>
      tr("docagent.skipped_hidden_documents_count").replace("{count}", String(count));

    setUploadBusy(true);
    setUploadProgress({ phase: "preparing", done: 0, total: files.length, preserveRelativePath });
    setToastMessage(null);
    let skippedHiddenCount = 0;
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/upload", query);
      const uploadEntries = files
        .map((file) => {
          const relativePath = preserveRelativePath
            ? uploadRelativePath(file)
            : normalizeRelativePath(file.name, file.name || "file");
          const destination = joinRelativePath(baseDir, relativePath);
          return { file, destination };
        })
        .filter((entry) => {
          if (hasHiddenPathSegment(entry.destination)) {
            skippedHiddenCount += 1;
            return false;
          }
          return true;
        });

      if (!uploadEntries.length) {
        setUploadProgress(null);
        setToastMessage(hiddenSkipMessage(skippedHiddenCount));
        return;
      }

      setUploadProgress({
        phase: "uploading",
        done: 0,
        total: uploadEntries.length,
        preserveRelativePath,
      });
      let done = 0;
      for (const entry of uploadEntries) {
        const form = new FormData();
        form.append("file", entry.file);
        if (entry.destination) {
          form.append("path", entry.destination);
        }
        await fetchJson(url, cfg.token, {
          method: "POST",
          body: form,
        });
        done += 1;
        setUploadProgress({
          phase: "uploading",
          done,
          total: uploadEntries.length,
          preserveRelativePath,
        });
      }
      setUploadProgress({
        phase: "processing",
        done: uploadEntries.length,
        total: uploadEntries.length,
        preserveRelativePath,
      });
      await refetchDocuments();
      const uploadedMessage =
        uploadEntries.length === 1
          ? tr("docagent.uploaded_one_document")
          : tr("docagent.uploaded_documents_count").replace("{count}", String(uploadEntries.length));
      setToastMessage(
        skippedHiddenCount > 0 ? `${uploadedMessage}\n${hiddenSkipMessage(skippedHiddenCount)}` : uploadedMessage,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_upload_documents");
      setToastMessage(skippedHiddenCount > 0 ? `${message}\n${hiddenSkipMessage(skippedHiddenCount)}` : message);
    } finally {
      setUploadProgress(null);
      setUploadBusy(false);
    }
  };

  const createFolder = async () => {
    const cfg = apiConfig();
    if (!cfg) return;
    if (uploadBusy()) return;

    const seed = activeFolder() ? `${activeFolder()}/` : "";
    const input = window.prompt(tr("docagent.create_folder_prompt"), seed);
    if (input == null) return;
    const folderPath = normalizeRelativePath(input, "");
    if (!folderPath) {
      setToastMessage(tr("docagent.folder_path_required"));
      return;
    }

    setUploadBusy(true);
    setToastMessage(null);
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/mkdir", query);
      await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
      });
      expandFolderPath(folderPath);
      setActiveFolder(folderPath);
      await refetchDocuments();
      setToastMessage(tr("docagent.created_folder").replace("{path}", folderPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_create_folder");
      setToastMessage(message);
    } finally {
      setUploadBusy(false);
    }
  };

  const moveDocumentNode = async (from: string, options?: { isDirectory?: boolean }) => {
    const cfg = apiConfig();
    const fromPath = normalizeRelativePath(from, "");
    if (!cfg || !fromPath) return;
    if (moveBusyPath()) return;

    const isDirectory = Boolean(options?.isDirectory);
    const promptLabel = isDirectory
      ? trf("docagent.move_folder_prompt", { path: fromPath })
      : trf("docagent.move_file_prompt", { path: fromPath });
    const input = window.prompt(promptLabel, fromPath);
    if (input == null) return;
    const toPath = normalizeRelativePath(input, "");
    if (!toPath) {
      setToastMessage(tr("docagent.move_path_required"));
      return;
    }
    if (toPath === fromPath) {
      setToastMessage(tr("docagent.move_path_same"));
      return;
    }
    if (documentPathExists(toPath)) {
      setToastMessage(tr("docagent.move_target_exists"));
      return;
    }
    if (isDirectory && (toPath === fromPath || toPath.startsWith(`${fromPath}/`))) {
      setToastMessage(tr("docagent.move_folder_into_self"));
      return;
    }

    const moveRouteMissing = (error: unknown) => {
      if (!(error instanceof Error)) return false;
      const raw = error.message.trim();
      if (!raw) return false;
      if (raw.toLowerCase() === "not found") return true;
      try {
        const parsed = JSON.parse(raw) as { code?: unknown; message?: unknown } | null;
        const code = typeof parsed?.code === "string" ? parsed.code.trim().toLowerCase() : "";
        const message = typeof parsed?.message === "string" ? parsed.message.trim().toLowerCase() : "";
        return code === "not_found" && message === "not found";
      } catch {
        return false;
      }
    };

    const copyFileViaApi = async (sourcePath: string, destinationPath: string) => {
      const query = new URLSearchParams();
      query.set("docId", sourcePath);
      query.set("session", cfg.sessionId);
      const downloadUrl = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/file", query);
      const headers = new Headers();
      if (cfg.token) headers.set("Authorization", `Bearer ${cfg.token}`);
      const response = await fetch(downloadUrl, { headers });
      if (!response.ok) {
        throw new Error(await parseErrorMessage(response));
      }
      const blob = await response.blob();
      const uploadQuery = new URLSearchParams();
      uploadQuery.set("session", cfg.sessionId);
      const uploadUrl = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/upload", uploadQuery);
      const form = new FormData();
      form.append("file", blob, destinationPath.split("/").pop() ?? "file");
      form.append("path", destinationPath);
      await fetchJson(uploadUrl, cfg.token, {
        method: "POST",
        body: form,
      });
    };

    const deleteFileViaApi = async (filePath: string) => {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/delete", query);
      await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
    };

    const createFolderViaApi = async (folderPath: string) => {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/mkdir", query);
      await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
      });
    };

    const removeFolderViaApi = async (folderPath: string) => {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/rmdir", query);
      await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
      });
    };

    const fallbackMoveFile = async () => {
      await copyFileViaApi(fromPath, toPath);
      await deleteFileViaApi(fromPath);
    };

    const fallbackMoveFolder = async () => {
      await createFolderViaApi(toPath);
      const fromPrefix = `${fromPath}/`;
      const files = documentsList()
        .map((item) => normalizeRelativePath(item.name, ""))
        .filter((name) => Boolean(name) && name.startsWith(fromPrefix))
        .sort((a, b) => a.localeCompare(b));
      for (const source of files) {
        const suffix = source.slice(fromPrefix.length);
        if (!suffix) continue;
        const destination = `${toPath}/${suffix}`;
        if (documentPathExists(destination)) {
          throw new Error(tr("docagent.move_target_exists"));
        }
        await copyFileViaApi(source, destination);
      }
      await removeFolderViaApi(fromPath);
    };

    setMoveBusyPath(fromPath);
    setToastMessage(null);
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/move", query);
      try {
        await fetchJson(url, cfg.token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: fromPath, to: toPath }),
        });
      } catch (error) {
        if (!moveRouteMissing(error)) throw error;
        if (isDirectory) {
          await fallbackMoveFolder();
        } else {
          await fallbackMoveFile();
        }
      }

      const remap = (value: string | null) => remapPathAfterMove(value, fromPath, toPath, { isDirectory });
      const nextTarget = remap(targetDoc());
      const nextActive = remap(activeDoc());
      const nextFolder = remap(activeFolder());

      setTargetDoc(nextTarget);
      setActiveDoc(nextActive);
      setActiveFolder(nextFolder ?? parentDirPath(toPath));

      if (isDirectory) {
        setExpandedFolders((prev) => {
          const next = new Set<string>();
          for (const path of prev) {
            const mapped = remapPathAfterMove(path, fromPath, toPath, { isDirectory: true });
            if (!mapped) continue;
            next.add(mapped);
          }
          return next;
        });
        expandFolderPath(toPath);
      } else {
        const toParent = parentDirPath(toPath);
        if (toParent) expandFolderPath(toParent);
      }

      await refetchDocuments();
      setToastMessage(
        (isDirectory ? tr("docagent.moved_folder") : tr("docagent.moved_file")).replace("{path}", toPath),
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : isDirectory
          ? tr("docagent.failed_move_folder")
          : tr("docagent.failed_move_file");
      setToastMessage(message);
    } finally {
      setMoveBusyPath(null);
    }
  };

  const downloadDocumentFile = async (docPath: string) => {
    const cfg = apiConfig();
    const normalized = normalizeRelativePath(docPath, "");
    if (!cfg || !normalized) return;
    if (downloadBusyPath()) return;

    setDownloadBusyPath(normalized);
    setToastMessage(null);
    try {
      const query = new URLSearchParams();
      query.set("docId", normalized);
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/file", query);
      const headers = new Headers();
      if (cfg.token) headers.set("Authorization", `Bearer ${cfg.token}`);
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(await parseErrorMessage(response));
      }
      const blob = await response.blob();
      const fallbackName = normalized.split("/").pop() ?? "download";
      const filename = parseDownloadFilename(response, fallbackName);
      triggerBrowserDownload(blob, filename);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_download_file");
      setToastMessage(message);
    } finally {
      setDownloadBusyPath(null);
    }
  };

  const downloadDocumentFolder = async (folderPath: string) => {
    const cfg = apiConfig();
    const normalized = normalizeRelativePath(folderPath, "");
    if (!cfg || !normalized) return;
    if (downloadBusyPath()) return;

    setDownloadBusyPath(normalized);
    setToastMessage(null);
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/folder/download", query);
      const headers = new Headers({ "Content-Type": "application/json" });
      if (cfg.token) headers.set("Authorization", `Bearer ${cfg.token}`);
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ path: normalized }),
      });
      if (!response.ok) {
        throw new Error(await parseErrorMessage(response));
      }
      const blob = await response.blob();
      const fallbackName = `${normalized.split("/").pop() ?? "folder"}.zip`;
      const filename = parseDownloadFilename(response, fallbackName);
      triggerBrowserDownload(blob, filename);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_download_folder");
      setToastMessage(message);
    } finally {
      setDownloadBusyPath(null);
    }
  };

  const deleteDocumentFile = async (docPath: string) => {
    const cfg = apiConfig();
    const normalized = normalizeRelativePath(docPath, "");
    if (!cfg || !normalized) return;
    if (deleteBusyPath()) return;

    const ok = window.confirm(
      tr("docagent.delete_file_confirm").replace("{path}", normalized),
    );
    if (!ok) return;

    setDeleteBusyPath(normalized);
    setToastMessage(null);
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/delete", query);
      await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: normalized }),
      });
      if (targetDoc() === normalized) setTargetDoc(null);
      if (activeDoc() === normalized) setActiveDoc(null);
      setToastMessage(tr("docagent.deleted_file").replace("{path}", normalized));
      await refetchDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_delete_file");
      setToastMessage(message);
    } finally {
      setDeleteBusyPath(null);
    }
  };

  const deleteDocumentFolder = async (folderPath: string) => {
    const cfg = apiConfig();
    const normalized = normalizeRelativePath(folderPath, "");
    if (!cfg || !normalized) return;
    if (deleteBusyPath()) return;

    const count = documentsList().filter((item) => item.name.startsWith(`${normalized}/`)).length;
    const ok = window.confirm(
      tr("docagent.delete_folder_confirm")
        .replace("{path}", normalized)
        .replace("{count}", String(count)),
    );
    if (!ok) return;

    setDeleteBusyPath(normalized);
    setToastMessage(null);
    try {
      const query = new URLSearchParams();
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/rmdir", query);
      await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: normalized }),
      });
      const prefix = `${normalized}/`;
      const target = targetDoc();
      const active = activeDoc();
      const folder = activeFolder();
      if (target && target.startsWith(prefix)) setTargetDoc(null);
      if (active && active.startsWith(prefix)) setActiveDoc(null);
      if (folder && (folder === normalized || folder.startsWith(prefix))) setActiveFolder("");
      setExpandedFolders((prev) => {
        const next = new Set<string>();
        for (const path of prev) {
          if (path === normalized || path.startsWith(prefix)) continue;
          next.add(path);
        }
        return next;
      });
      setToastMessage(tr("docagent.deleted_folder").replace("{path}", normalized));
      await refetchDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("docagent.failed_delete_folder");
      setToastMessage(message);
    } finally {
      setDeleteBusyPath(null);
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
    setActiveFolder("");
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
    const items = documentsList();
    const loading = documents.loading;
    const latestItems = documents.latest?.items ?? [];
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
      previousTarget && isTargetDocumentCandidate(previousTarget)
        ? items.some((doc) => doc.name === previousTarget) || latestItems.some((doc) => doc.name === previousTarget)
        : false;

    let nextTarget: string | null = targetExists ? previousTarget : null;
    if (!nextTarget && activeExists && currentActive && isTargetDocumentCandidate(currentActive)) {
      nextTarget = currentActive;
    }
    if (!nextTarget) {
      nextTarget =
        items.find((doc) => isTargetDocumentCandidate(doc.name))?.name ??
        latestItems.find((doc) => isTargetDocumentCandidate(doc.name))?.name ??
        null;
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
    const normalizedDirs = new Set(
      documentDirs()
        .map((dir) => normalizeRelativePath(dir, ""))
        .filter(Boolean),
    );
    const current = activeFolder();
    if (!current) return;
    if (!normalizedDirs.has(current)) {
      setActiveFolder("");
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
  });

  const toolMonitorActive = createMemo(() => false);

  const sanitizeReportToken = (value: string) =>
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90);

  const toolMonitorReportPath = (
    assistantMessageId: string,
    createdAt: number,
    options?: { trigger?: "auto" | "manual_excellent" },
  ) => {
    const iso = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
    const safeId = sanitizeReportToken(assistantMessageId) || "assistant";
    const suffix = options?.trigger === "manual_excellent" ? "_excellent" : "";
    return `reports/tool-monitor/${iso}_${safeId}${suffix}.md`;
  };

  const upsertToolMonitorReport = (report: ToolMonitorTurnReport, persisted?: ToolMonitorTurnReport["persisted"]) => {
    setToolMonitorReports((current) => {
      const existing = current.find((item) => item.assistantMessageId === report.assistantMessageId);
      const nextPersisted = persisted ?? existing?.persisted ?? report.persisted;
      const nextReport = nextPersisted ? { ...report, persisted: nextPersisted } : report;
      const rest = current.filter((item) => item.assistantMessageId !== report.assistantMessageId);
      return [nextReport, ...rest].slice(0, 24);
    });
  };

  const updateReportPersisted = (assistantMessageId: string, persisted: ToolMonitorTurnReport["persisted"]) => {
    if (!persisted) return;
    setToolMonitorReports((current) =>
      current.map((report) =>
        report.assistantMessageId === assistantMessageId ? { ...report, persisted } : report,
      ),
    );
  };

  const analyzeAndPersistToolMonitorTurn = async (options?: { force?: boolean; trigger?: "auto" | "manual_excellent" }) => {
    if (!toolMonitorActive()) return;

    const sid = sessionId();
    if (!sid) return;

    const assistantTurn = selectLatestAssistantTurn(props.messages ?? []);
    if (!assistantTurn) return;

    const assistantMessageId = (assistantTurn.message.info as any)?.id;
    if (typeof assistantMessageId !== "string" || !assistantMessageId.trim()) return;
    if (!options?.force && assistantMessageId === lastToolMonitorAssistantMessageId) return;
    lastToolMonitorAssistantMessageId = assistantMessageId;

    const completedAtRaw = (assistantTurn.message.info as any)?.time?.completed;
    const completedAt = typeof completedAtRaw === "number" && Number.isFinite(completedAtRaw) ? completedAtRaw : Date.now();
    const trigger = options?.trigger === "manual_excellent" ? "manual_excellent" : "auto";
    const createdAt = trigger === "manual_excellent" ? Date.now() : completedAt;

    const userTurn = selectNearestUserMessage(props.messages ?? [], assistantTurn.index);
    const userMessageId = (userTurn?.message.info as any)?.id;

    const report = buildToolMonitorTurnReport({
      sessionId: sid,
      agent: props.selectedSessionAgent ?? "unknown",
      messages: props.messages ?? [],
      assistantMessageId,
      userMessageId: typeof userMessageId === "string" ? userMessageId : undefined,
      assistantParts: assistantTurn.message.parts ?? [],
      userParts: userTurn?.message.parts ?? [],
      createdAt,
      developerMode: props.developerMode,
      trigger,
    });

    const path = toolMonitorReportPath(assistantMessageId, createdAt, { trigger });
    const pendingPersisted = { path, status: "pending" as const };
    upsertToolMonitorReport(report, pendingPersisted);

    const cfg = apiConfig();
    if (!cfg) {
      updateReportPersisted(assistantMessageId, { path, status: "error", error: "Server not ready." });
      return;
    }

    const reflected = await requestToolMonitorModelRetrospective({
      baseUrl: cfg.baseUrl,
      token: cfg.token,
      workspaceId: cfg.workspaceId,
      sessionId: sid,
      assistantMessageId,
      agent: props.selectedSessionAgent ?? "unknown",
      messages: props.messages ?? [],
      tools: report.tools,
      fallback: report.retrospective,
    });

    const finalReport: ToolMonitorTurnReport = {
      ...report,
      retrospective: reflected.retrospective,
    };
    finalReport.markdown = renderToolMonitorMarkdown(finalReport, { includeDebug: Boolean(props.developerMode) });
    upsertToolMonitorReport(finalReport, pendingPersisted);

    const persisted = await uploadSessionMarkdownReport({
      baseUrl: cfg.baseUrl,
      token: cfg.token,
      workspaceId: cfg.workspaceId,
      sessionId: cfg.sessionId,
      path,
      content: finalReport.markdown,
    });

    updateReportPersisted(
      assistantMessageId,
      persisted.ok
        ? { path: persisted.path, status: "ok" }
        : { path: persisted.path, status: "error", error: persisted.error ?? "Upload failed." },
    );
  };

  // Tool Monitor auto-trigger is temporarily disabled.
  /*
  createEffect(
    on(
      () => props.sessionStatus ?? "idle",
      (next, prev) => {
        if (!toolMonitorActive()) return;
        if (prev !== "running" || next === "running") return;
        queueMicrotask(() => void analyzeAndPersistToolMonitorTurn());
      },
      { defer: true },
    ),
  );
  */

  const triggerExcellentToolMonitorRun = async () => {
    // Tool Monitor manual trigger is temporarily disabled.
  };

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

  const agentLabel = createMemo(() => props.selectedSessionAgent ?? tr("session.default_agent"));
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
      <input
        ref={(el) => {
          uploadInputEl = el;
        }}
        type="file"
        class="hidden"
        multiple
        onChange={(event) => {
          const list = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
          if (list.length > 0) {
            void uploadDocuments(list, { baseDir: activeFolder() });
          }
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={(el) => {
          const input = el as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean };
          input.webkitdirectory = true;
          input.directory = true;
          uploadFolderInputEl = input;
        }}
        type="file"
        class="hidden"
        multiple
        onChange={(event) => {
          const list = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
          if (list.length > 0) {
            void uploadDocuments(list, { baseDir: activeFolder(), preserveRelativePath: true });
          }
          event.currentTarget.value = "";
        }}
      />

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
                onClick={() => uploadInputEl?.click()}
                disabled={!serverReady() || uploadBusy()}
                title={tr("docagent.upload_documents")}
                aria-label={tr("docagent.upload_documents")}
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => uploadFolderInputEl?.click()}
                disabled={!serverReady() || uploadBusy()}
                title={tr("docagent.upload_folder")}
                aria-label={tr("docagent.upload_folder")}
              >
                <Folder size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void createFolder()}
                disabled={!serverReady() || uploadBusy()}
                title={tr("docagent.create_folder")}
                aria-label={tr("docagent.create_folder")}
              >
                <FolderPlus size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void refreshDocumentsKeepingScroll()}
                disabled={!serverReady() || documents.loading}
                title={tr("docagent.refresh_documents")}
                aria-label={tr("docagent.refresh_documents")}
              >
                <RefreshCw size={16} class={documents.loading ? "animate-spin" : ""} />
              </button>
              <Show when={uploadProgressLabel()}>
                <div
                  class="p-2 rounded bg-dls-hover text-dls-secondary"
                  title={uploadProgressLabel()}
                  aria-label={uploadProgressLabel()}
                >
                  <RefreshCw size={16} class="animate-spin" />
                </div>
              </Show>
            </div>
          }
        >
          <div class="px-3 py-2 border-b border-dls-border space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <h2 class="text-sm font-semibold text-dls-text leading-none">{tr("docagent.documents")}</h2>
                <div class="mt-1 text-[10px] text-dls-secondary truncate">
                  <Show when={activeFolder()} fallback={tr("docagent.folder_root")}>
                    {tr("docagent.folder_label").replace("{path}", activeFolder())}
                  </Show>
                </div>
              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={() => setDocumentsCollapsed(true)}
                title={tr("docagent.collapse_documents")}
                aria-label={tr("docagent.collapse_documents")}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
            <div class="flex items-center gap-1 flex-wrap">
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => uploadInputEl?.click()}
                disabled={!serverReady() || uploadBusy()}
                title={tr("docagent.upload_documents")}
                aria-label={tr("docagent.upload_documents")}
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => uploadFolderInputEl?.click()}
                disabled={!serverReady() || uploadBusy()}
                title={tr("docagent.upload_folder")}
                aria-label={tr("docagent.upload_folder")}
              >
                <Folder size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void createFolder()}
                disabled={!serverReady() || uploadBusy()}
                title={tr("docagent.create_folder")}
                aria-label={tr("docagent.create_folder")}
              >
                <FolderPlus size={16} />
              </button>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text disabled:opacity-50"
                onClick={() => void refreshDocumentsKeepingScroll()}
                disabled={!serverReady() || documents.loading}
                title={tr("docagent.refresh_documents")}
                aria-label={tr("docagent.refresh_documents")}
              >
                <RefreshCw size={16} class={documents.loading ? "animate-spin" : ""} />
              </button>
            </div>
            <Show when={uploadProgressLabel()}>
              <div class="flex items-center gap-1.5 text-[11px] text-dls-secondary">
                <RefreshCw size={12} class="animate-spin" />
                <span class="truncate">{uploadProgressLabel()}</span>
              </div>
            </Show>
          </div>
        </Show>
        <div class="overflow-y-auto flex-1 py-2" ref={(el) => (documentsScrollEl = el)}>
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
              <For each={fileTree()}>
                {(node) => <TreeNodeView node={node} depth={0} />}
              </For>
              <Show when={fileTree().length === 0}>
                <div class="px-4 py-8 text-center text-xs text-gray-10">
                  {tr("docagent.no_documents")}
                </div>
              </Show>
            </Show>
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
              <Show when={targetDoc()} fallback={tr("docagent.select_target_document")}>
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
                const prefix = tr("docagent.target_document_prompt_prefix").replace("{path}", path);
                const existing = props.prompt.trim();
                const next = existing ? `${existing}\n\n${prefix}\n` : `${prefix}\n`;
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
                      {tr("docagent.preview_mode_desc").replace("{target}", targetDoc() ?? "")}{" "}
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
              <Show when={props.selectedSessionAgent} fallback={tr("session.default_agent")}>
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

        <ToolMonitorPanel
          enabled={toolMonitorActive()}
          developerMode={props.developerMode}
          reports={toolMonitorReports()}
          expanded={toolMonitorExpanded()}
          setExpanded={setToolMonitorExpanded}
          openDocument={(path) => setActiveDoc(path)}
        />

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
    </div>
  );
}
