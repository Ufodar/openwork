import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { ArrowRight, AtSign, CheckCircle2, ChevronDown, Copy, Download, FileText, Folder, FolderArchive, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Trash2, X } from "lucide-solid";
import { useNavigate } from "@solidjs/router";

import type { ComposerDraft, SlashCommandOption } from "../types";
import type { SessionViewProps } from "./session";
import OnlyOfficeEditor from "../components/onlyoffice-editor";
import MessageList from "../components/session/message-list";
import Composer from "../components/session/composer";
import { DOCUMENT_UPLOAD_ACCEPT } from "../lib/documents";

type DocumentItem = {
  name: string;
  updatedAt: number;
  size: number;
  type: string;
};

type DocumentWriterUiState = {
  schemaVersion: 1;
  targetDoc?: string;
  activeDoc?: string;
};

type InboxItem = {
  id: string;
  path: string;
  size: number;
  updatedAt: number;
};

type OnlyOfficePayload = { documentServerUrl: string; config: any };
type DocHeading = {
  level: number;
  text: string;
  elementCount: number;
};
type HeadingChoice = DocHeading & { occurrence: number };
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

const isOnlyOfficeImportable = (path: string) => {
  const base = path.split("/").pop() ?? path;
  const match = base.toLowerCase().match(/\.[^.]+$/);
  if (!match) return false;
  return ONLYOFFICE_IMPORT_EXTENSIONS.has(match[0]);
};

const DOCX_SECTION_COPY_TARGET_EXTENSIONS = new Set([".docx", ".docm", ".dotx", ".dotm"]);
const DOCX_SECTION_COPY_SOURCE_EXTENSIONS = new Set([...DOCX_SECTION_COPY_TARGET_EXTENSIONS, ".doc"]);

const getFileExtension = (value: string) => {
  const base = value.split("/").pop() ?? value;
  const match = base.toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
};

const isDocxSectionCopyTarget = (value: string) => DOCX_SECTION_COPY_TARGET_EXTENSIONS.has(getFileExtension(value));
const isDocxSectionCopySource = (value: string) => DOCX_SECTION_COPY_SOURCE_EXTENSIONS.has(getFileExtension(value));

export default function DocumentWriterView(props: SessionViewProps) {
  const navigate = useNavigate();

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
  const [configSeq, setConfigSeq] = createSignal(0);
  const [archiveBusy, setArchiveBusy] = createSignal(false);
  const [otherDocsExpanded, setOtherDocsExpanded] = createSignal(false);
  const [lastSessionStatus, setLastSessionStatus] = createSignal(props.sessionStatus ?? "idle");
  const [refsExpanded, setRefsExpanded] = createSignal<Record<string, boolean>>({});
  const [refsBusy, setRefsBusy] = createSignal(false);
  const [refsError, setRefsError] = createSignal<string | null>(null);
  const [refsUploadProgress, setRefsUploadProgress] = createSignal<{ categoryId: string; done: number; total: number } | null>(null);
  const [refsDeleteBusyId, setRefsDeleteBusyId] = createSignal<string | null>(null);
  const [refsOpenBusyId, setRefsOpenBusyId] = createSignal<string | null>(null);
  const [sectionCopyOpen, setSectionCopyOpen] = createSignal(false);
  const [sectionCopySource, setSectionCopySource] = createSignal<InboxItem | null>(null);
  const [sectionCopySourceHeading, setSectionCopySourceHeading] = createSignal<HeadingChoice | null>(null);
  const [sectionCopyTargetHeading, setSectionCopyTargetHeading] = createSignal<HeadingChoice | null>(null);
  const [sectionCopyExcludeHeading, setSectionCopyExcludeHeading] = createSignal(true);
  const [sectionCopyBusy, setSectionCopyBusy] = createSignal(false);
  const [sectionCopyError, setSectionCopyError] = createSignal<string | null>(null);
  const [sectionCopySourceQuery, setSectionCopySourceQuery] = createSignal("");
  const [sectionCopyTargetQuery, setSectionCopyTargetQuery] = createSignal("");

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

  const [documents, { refetch: refetchDocuments }] = createResource(apiConfig, async (cfg) => {
    if (!cfg) return [] as DocumentItem[];
    const query = new URLSearchParams();
    query.set("session", cfg.sessionId);
    const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/documents", query);
    const data = (await fetchJson(url, cfg.token)) as { items?: DocumentItem[] };
    return Array.isArray(data.items) ? data.items : [];
  });

  const documentsList = createMemo(() => documents() ?? []);
  const targetDocInList = createMemo(() => {
    const name = (targetDoc() ?? "").trim();
    if (!name) return null;
    return (documentsList() ?? []).find((doc) => doc.name === name) ?? null;
  });
  const otherDocsList = createMemo(() => {
    const name = (targetDoc() ?? "").trim();
    if (!name) return [] as DocumentItem[];
    return (documentsList() ?? []).filter((doc) => doc.name !== name);
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
    const data = await input.client.listInbox(input.workspaceId, { prefix: input.prefix });
    return Array.isArray(data.items) ? (data.items as InboxItem[]) : [];
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

  const [reports, { refetch: refetchReports }] = createResource(reportsFetchInput, async (input) => {
    if (!input) return [] as InboxItem[];
    const data = await input.client.listInbox(input.workspaceId, { prefix: input.prefix });
    const items = Array.isArray(data.items) ? (data.items as InboxItem[]) : [];
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return items;
  });

  const refsByCategory = createMemo(() => {
    const items = refs() ?? [];
    const prefix = refsInboxPrefix();
    const result: Record<string, InboxItem[]> = Object.fromEntries(REF_CATEGORIES.map((c) => [c.id, []]));
    if (!prefix) return result;

    const rootPrefix = `${prefix}/`;
    for (const item of items) {
      if (!item.path.startsWith(rootPrefix)) continue;
      const remainder = item.path.slice(rootPrefix.length);
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
      const prefix = refsInboxPrefix();
      const rootPrefix = prefix ? `${prefix}/` : "";
      const remainder = rootPrefix && item.path.startsWith(rootPrefix) ? item.path.slice(rootPrefix.length) : item.path;
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

  const editorSource = createMemo(() => {
    const cfg = apiConfig();
    const doc = activeDoc();
    const target = targetDoc();
    if (!cfg || !doc) return null;
    return {
      ...cfg,
      doc,
      seq: configSeq(),
      readonly: isAgentRunning() || (Boolean(target) && doc !== target),
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

  const handleUpload = async (e: Event) => {
    const cfg = apiConfig();
    if (!cfg) return;

    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    const formData = new FormData();
    formData.append("file", file);

    const query = new URLSearchParams();
    query.set("session", cfg.sessionId);
    const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/upload", query);
    const result = (await fetchJson(url, cfg.token, { method: "POST", body: formData })) as { name?: string };
    input.value = "";
    await refetchDocuments();
    const name = typeof result?.name === "string" ? result.name.trim() : "";
    if (name) {
      setTargetDoc(name);
      setActiveDoc(name);
      setConfigSeq((v) => v + 1);
    }
  };

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
    setRefsUploadProgress({ categoryId, done: 0, total: files.length });
    try {
      let done = 0;
      for (const file of files) {
        const dest = `${prefix}/${categoryId}/${file.name}`;
        await client.uploadInbox(w, file, { path: dest });
        done += 1;
        setRefsUploadProgress({ categoryId, done, total: files.length });
      }
      await refetchRefs();
      setRefsExpanded((current) => ({ ...current, [categoryId]: true }));
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

  const downloadReferenceFile = async (item: InboxItem) => {
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
      setRefsError(message);
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
    if (!targetDoc()) {
      setRefsError("Upload/select a target document first. Reference files are preview-only.");
      return;
    }
    setRefsOpenBusyId(item.id);
    setRefsError(null);
    try {
      const prefix = refsInboxPrefix();
      const rootPrefix = prefix ? `${prefix}/` : "";
      const remainder = rootPrefix && item.path.startsWith(rootPrefix) ? item.path.slice(rootPrefix.length) : item.path;
      const categoryId = (remainder.split("/")[0] ?? "other").trim() || "other";
      const filename = item.path.split("/").pop() ?? "reference";
      const dest = `.refs/${categoryId}/${filename}`;

      const query = new URLSearchParams();
      query.set("inboxId", item.id);
      query.set("session", cfg.sessionId);
      query.set("dest", dest);
      query.set("mode", "overwrite");
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/import", query);
      const result = (await fetchJson(url, cfg.token, { method: "POST" })) as { doc?: string };
      const doc = typeof result?.doc === "string" ? result.doc.trim() : "";
      if (!doc) throw new Error("Failed to import document");
      setActiveDoc(doc);
      setConfigSeq((v) => v + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open file in editor";
      setRefsError(message);
    } finally {
      setRefsOpenBusyId(null);
    }
  };

  const withHeadingOccurrences = (items: DocHeading[]): HeadingChoice[] => {
    const seen = new Map<string, number>();
    return items.map((item) => {
      const prev = seen.get(item.text) ?? 0;
      const next = prev + 1;
      seen.set(item.text, next);
      return { ...item, occurrence: next };
    });
  };

  const sectionCopySourceHeadingsRequest = createMemo(() => {
    const cfg = apiConfig();
    const source = sectionCopySource();
    if (!cfg || !source || !sectionCopyOpen()) return null;
    const query = new URLSearchParams();
    query.set("inboxId", source.id);
    query.set("session", cfg.sessionId);
    const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/headings", query);
    return { url, token: cfg.token };
  });

  const sectionCopyTargetHeadingsRequest = createMemo(() => {
    const cfg = apiConfig();
    const doc = targetDoc();
    if (!cfg || !doc || !sectionCopyOpen()) return null;
    if (!isDocxSectionCopyTarget(doc)) return null;
    const query = new URLSearchParams();
    query.set("doc", doc);
    query.set("session", cfg.sessionId);
    const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/headings", query);
    return { url, token: cfg.token };
  });

  const [sectionCopySourceHeadings] = createResource(sectionCopySourceHeadingsRequest, async (input) => {
    if (!input) return [] as HeadingChoice[];
    const data = (await fetchJson(input.url, input.token)) as { items?: DocHeading[] };
    const items = Array.isArray(data.items) ? data.items : [];
    return withHeadingOccurrences(items);
  });

  const [sectionCopyTargetHeadings] = createResource(sectionCopyTargetHeadingsRequest, async (input) => {
    if (!input) return [] as HeadingChoice[];
    const data = (await fetchJson(input.url, input.token)) as { items?: DocHeading[] };
    const items = Array.isArray(data.items) ? data.items : [];
    return withHeadingOccurrences(items);
  });

  const filteredSectionCopySourceHeadings = createMemo(() => {
    const query = sectionCopySourceQuery().trim().toLowerCase();
    const items = sectionCopySourceHeadings() ?? [];
    if (!query) return items;
    return items.filter((item) => item.text.toLowerCase().includes(query));
  });

  const filteredSectionCopyTargetHeadings = createMemo(() => {
    const query = sectionCopyTargetQuery().trim().toLowerCase();
    const items = sectionCopyTargetHeadings() ?? [];
    if (!query) return items;
    return items.filter((item) => item.text.toLowerCase().includes(query));
  });

  const openSectionCopyModal = (item: InboxItem) => {
    if (!serverReady()) return;
    const doc = targetDoc();
    if (!doc) {
      setToastMessage("Select a target document first.");
      return;
    }
    if (!isDocxSectionCopyTarget(doc)) {
      setToastMessage("Target document must be .docx/.docm/.dotx/.dotm for section copy.");
      return;
    }
    if (!isDocxSectionCopySource(item.path)) {
      setToastMessage("Source file must be .docx/.docm/.dotx/.dotm (or .doc with LibreOffice).");
      return;
    }
    setSectionCopySource(item);
    setSectionCopySourceHeading(null);
    setSectionCopyTargetHeading(null);
    setSectionCopyExcludeHeading(true);
    setSectionCopySourceQuery("");
    setSectionCopyTargetQuery("");
    setSectionCopyError(null);
    setSectionCopyOpen(true);
  };

  const closeSectionCopyModal = () => {
    setSectionCopyOpen(false);
    setSectionCopyError(null);
  };

  const runSectionCopy = async () => {
    const cfg = apiConfig();
    const doc = targetDoc();
    const source = sectionCopySource();
    const sourceHeading = sectionCopySourceHeading();
    if (!cfg || !doc || !source || !sourceHeading) return;
    if (sectionCopyBusy()) return;
    setSectionCopyBusy(true);
    setSectionCopyError(null);

    try {
      const query = new URLSearchParams();
      query.set("doc", doc);
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/copy-section", query);
      const payload: Record<string, unknown> = {
        sourceInboxId: source.id,
        sourceHeading: sourceHeading.text,
        sourceHeadingIndex: sourceHeading.occurrence,
        matchMode: "exact",
        excludeSourceHeading: sectionCopyExcludeHeading(),
      };
      const targetHeading = sectionCopyTargetHeading();
      if (targetHeading) {
        payload.targetHeading = targetHeading.text;
        payload.targetHeadingIndex = targetHeading.occurrence;
      }

      const result = (await fetchJson(url, cfg.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as { stats?: { paragraphs: number; tables: number; images: number; styles: number } | null; warnings?: string[] };

      const stats = result?.stats ?? null;
      const summary = stats
        ? `Inserted (${stats.paragraphs}p, ${stats.tables}t, ${stats.images}i)`
        : "Inserted section";
      setToastMessage(summary);
      closeSectionCopyModal();
      setConfigSeq((v) => v + 1);
      await refetchDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to insert section";
      setSectionCopyError(message);
    } finally {
      setSectionCopyBusy(false);
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
  });

  createEffect(() => {
    const key = docWriterStateKey();
    if (!key) return;
    const state = readDocWriterState(key);
    const nextTarget = typeof state?.targetDoc === "string" ? state.targetDoc.trim() : "";
    const nextActive = typeof state?.activeDoc === "string" ? state.activeDoc.trim() : "";
    if (nextTarget) setTargetDoc(nextTarget);
    if (nextActive) setActiveDoc(nextActive);
  });

  createEffect(() => {
    const key = docWriterStateKey();
    if (!key) return;
    const t = targetDoc();
    const a = activeDoc();
    writeDocWriterState(key, {
      schemaVersion: 1,
      targetDoc: t ? t : undefined,
      activeDoc: a ? a : undefined,
    });
  });

  createEffect(() => {
    const items = documents() ?? [];
    if (!items.length) return;

    if (!targetDoc()) {
      const preferred = items.find((doc) => !doc.name.startsWith("refs/")) ?? items[0];
      setTargetDoc(preferred.name);
      if (!activeDoc()) setActiveDoc(preferred.name);
      return;
    }

    if (targetDoc() && !activeDoc()) {
      setActiveDoc(targetDoc());
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

  // Composer state (copied in spirit from SessionView but simplified)
  let agentPickerRef: HTMLDivElement | undefined;
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = createSignal(false);
  const [agentPickerBusy, setAgentPickerBusy] = createSignal(false);
  const [agentPickerReady, setAgentPickerReady] = createSignal(false);
  const [agentPickerError, setAgentPickerError] = createSignal<string | null>(null);
  const [agentOptions, setAgentOptions] = createSignal<Agent[]>([]);

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
        class={`relative z-20 shrink-0 border-r border-dls-border flex flex-col bg-dls-sidebar transition-[width] duration-200 ease-out ${documentsCollapsed() ? "w-14" : "w-64"
          }`}
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
              <label
                class={`cursor-pointer p-2 hover:bg-dls-hover rounded ${!serverReady() ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                title="Upload"
              >
                <Plus size={16} />
                <input
                  type="file"
                  class="hidden"
                  disabled={!serverReady()}
                  onChange={handleUpload}
                  accept={DOCUMENT_UPLOAD_ACCEPT}
                />
              </label>
            </div>
          }
        >
          <div class="h-12 px-3 border-b border-dls-border flex justify-between items-center">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-dls-text leading-none">Document Writer</h2>
              <Show when={activeDocPath()}>
                <div class="mt-1 text-[11px] text-dls-secondary truncate" title={activeDocPath()}>
                  {activeDocPath()}
                </div>
              </Show>
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
              <label
                class={`cursor-pointer p-2 hover:bg-dls-hover rounded ${!serverReady() ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                title="Upload"
              >
                <Plus size={16} />
                <input
                  type="file"
                  class="hidden"
                  disabled={!serverReady()}
                  onChange={handleUpload}
                  accept={DOCUMENT_UPLOAD_ACCEPT}
                />
              </label>
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
              <Show
                when={(documentsList() ?? []).length > 0}
                fallback={<div class="p-2 text-xs text-dls-secondary">No documents yet.</div>}
              >
                <Show
                  when={Boolean(targetDocInList())}
                  fallback={
                    <For each={documentsList()}>
                      {(doc) => (
                        <button
                          class={`w-full rounded flex items-center mb-1 transition-colors ${documentsCollapsed() ? "justify-center p-2" : "text-left p-2 gap-2"
                            } ${activeDoc() === doc.name
                              ? "bg-dls-hover text-dls-text"
                              : "text-dls-secondary hover:bg-dls-surface"
                            }`}
                          onClick={() => {
                            setTargetDoc(doc.name);
                            setActiveDoc(doc.name);
                          }}
                          title={documentsCollapsed() ? doc.name : undefined}
                        >
                          <FileText size={16} />
                          <Show when={!documentsCollapsed()}>
                            <span class="truncate">{doc.name}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  }
                >
                  <button
                    class={`w-full rounded flex items-center mb-1 transition-colors ${documentsCollapsed() ? "justify-center p-2" : "text-left p-2 gap-2"
                      } ${activeDoc() === targetDocInList()!.name
                        ? "bg-dls-hover text-dls-text"
                        : "text-dls-secondary hover:bg-dls-surface"
                      }`}
                    onClick={() => setActiveDoc(targetDocInList()!.name)}
                    title={documentsCollapsed() ? targetDocInList()!.name : undefined}
                  >
                    <FileText size={16} />
                    <Show when={!documentsCollapsed()}>
                      <span class="truncate">
                        {targetDocInList()!.name}
                        <span class="ml-2 text-[10px] text-dls-secondary">(target)</span>
                      </span>
                    </Show>
                  </button>

                  <Show when={otherDocsList().length > 0 && !documentsCollapsed()}>
                    <button
                      type="button"
                      class="w-full mt-1 rounded flex items-center justify-between px-2 py-2 text-[11px] text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                      onClick={() => setOtherDocsExpanded((v) => !v)}
                      aria-expanded={otherDocsExpanded()}
                    >
                      <span>Other documents</span>
                      <span class="flex items-center gap-2">
                        <span class="text-[10px]">{otherDocsList().length}</span>
                        <ChevronDown size={14} class={`transition-transform ${otherDocsExpanded() ? "rotate-180" : ""}`} />
                      </span>
                    </button>
                    <Show when={otherDocsExpanded()}>
                      <div class="mt-1">
                        <For each={otherDocsList()}>
                          {(doc) => (
                            <div
                              class={`w-full rounded flex items-center mb-1 transition-colors ${activeDoc() === doc.name
                                ? "bg-dls-hover text-dls-text"
                                : "text-dls-secondary hover:bg-dls-surface"
                                }`}
                            >
                              <button
                                type="button"
                                class={`flex-1 flex items-center transition-colors ${documentsCollapsed() ? "justify-center p-2" : "text-left p-2 gap-2"
                                  }`}
                                onClick={() => setActiveDoc(doc.name)}
                                title={documentsCollapsed() ? doc.name : undefined}
                              >
                                <FileText size={16} />
                                <Show when={!documentsCollapsed()}>
                                  <span class="truncate">{doc.name}</span>
                                </Show>
                              </button>
                              <Show when={!documentsCollapsed()}>
                                <button
                                  type="button"
                                  class="p-2 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text"
                                  onClick={() => {
                                    setTargetDoc(doc.name);
                                    setActiveDoc(doc.name);
                                    setConfigSeq((v) => v + 1);
                                  }}
                                  title="Set as target"
                                  aria-label={`Set ${doc.name} as target`}
                                >
                                  <ArrowRight size={16} />
                                </button>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </Show>
                </Show>
              </Show>
            </Show>
          </Show>

          <Show when={!documentsCollapsed()}>
            <div class="mt-3 pt-3 border-t border-dls-border">
              <div class="px-2">
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
                            const workspacePath = () => `.opencode/openwork/inbox/${item.path}`;
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
              </div>

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
                        </div>

                        <Show when={expanded()}>
                          <div class="px-2 pb-2 space-y-1">
                            <Show when={items().length > 0} fallback={<div class="py-1 text-[11px] text-dls-secondary">No files.</div>}>
                              <For each={items()}>
                                {(item) => {
                                  const workspacePath = () => `.opencode/openwork/inbox/${item.path}`;
                                  const name = () => item.path.split("/").pop() ?? item.path;
                                  const importable = () => isOnlyOfficeImportable(item.path);
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
                                        <div class="text-[10px] text-dls-secondary">
                                          {formatBytes(item.size)}
                                        </div>
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
                                        class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text disabled:opacity-50"
                                        onClick={() => void openReferenceInEditor(item)}
                                        disabled={!serverReady() || refsOpenBusyId() === item.id || !importable()}
                                        title={importable() ? "Open in editor" : "Unsupported file type"}
                                        aria-label="Open in editor"
                                      >
                                        <ArrowRight size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text disabled:opacity-50"
                                        onClick={() => openSectionCopyModal(item)}
                                        disabled={
                                          !serverReady() ||
                                          isAgentRunning() ||
                                          !targetDoc() ||
                                          !isDocxSectionCopyTarget(targetDoc() ?? "") ||
                                          !isDocxSectionCopySource(item.path)
                                        }
                                        title="Insert section into target"
                                        aria-label="Insert section into target"
                                      >
                                        <Copy size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-dls-text"
                                        onClick={() => void downloadReferenceFile(item)}
                                        title="Download"
                                        aria-label="Download"
                                      >
                                        <Download size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        class="p-1.5 rounded hover:bg-dls-active text-dls-secondary hover:text-red-11 disabled:opacity-50"
                                        onClick={() => void deleteReferenceFile(item)}
                                        disabled={refsDeleteBusyId() === item.id}
                                        title="Delete"
                                        aria-label="Delete"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  );
                                }}
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
	              <Show when={targetDoc()} fallback={"Upload/select a target document"}>
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
	              disabled={!activeDoc()}
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
	            fallback={<div class="h-full flex items-center justify-center text-dls-secondary">Select a document to edit</div>}
	          >
	            <div class="relative h-full w-full">
	              <Show when={editorPayload()} fallback={<div class="p-4 text-xs text-dls-secondary">Loading editor...</div>}>
	                <OnlyOfficeEditor
	                  documentServerUrl={editorPayload()!.documentServerUrl}
	                  config={editorPayload()!.config}
	                />
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

      {/* Right: Chat */}
      <div class="relative z-30 shrink-0 w-[420px] border-l border-dls-border flex flex-col bg-dls-surface">
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

        <div class="flex-1 min-h-0 overflow-y-auto">
          <MessageList
            messages={props.messages}
            developerMode={props.developerMode}
            showThinking={props.showThinking}
            expandedStepIds={props.expandedStepIds}
            setExpandedStepIds={props.setExpandedStepIds}
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

      <Show when={sectionCopyOpen()}>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSectionCopyModal();
          }}
        >
          <div
            class="w-full max-w-4xl rounded-2xl border border-dls-border bg-dls-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
	            <div class="flex items-center justify-between px-4 py-3 border-b border-dls-border">
	              <div class="min-w-0">
	                <div class="text-sm font-semibold text-dls-text truncate">Insert section</div>
	                <div class="mt-1 text-[11px] text-dls-secondary truncate">
	                  Target: {targetDoc() ?? "—"}
	                </div>
	              </div>
              <button
                type="button"
                class="p-2 rounded hover:bg-dls-hover text-dls-secondary hover:text-dls-text"
                onClick={closeSectionCopyModal}
                aria-label="Close"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="min-w-0">
                <div class="text-xs font-medium text-dls-text">Source heading</div>
                <div class="mt-2">
                  <input
                    type="text"
                    value={sectionCopySourceQuery()}
                    onInput={(event) => setSectionCopySourceQuery(event.currentTarget.value)}
                    placeholder="Search headings…"
                    class="w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
                  />
                </div>
                <div class="mt-2 rounded-lg border border-dls-border overflow-hidden max-h-[360px] overflow-y-auto">
                  <Show when={!sectionCopySourceHeadings.loading} fallback={<div class="p-3 text-xs text-dls-secondary">Loading…</div>}>
                    <Show
                      when={filteredSectionCopySourceHeadings().length > 0}
                      fallback={<div class="p-3 text-xs text-dls-secondary">No headings found.</div>}
                    >
                      <For each={filteredSectionCopySourceHeadings()}>
                        {(heading) => {
                          const selected = createMemo(() => {
                            const current = sectionCopySourceHeading();
                            if (!current) return false;
                            return current.text === heading.text && current.occurrence === heading.occurrence;
                          });
                          return (
                            <button
                              type="button"
                              class={`w-full text-left px-3 py-2 border-b border-dls-border/50 last:border-b-0 hover:bg-dls-hover ${selected() ? "bg-dls-active" : ""
                                }`}
                              onClick={() => setSectionCopySourceHeading(heading)}
                              title={heading.text}
                            >
                              <div class="flex items-start gap-2">
                                <div class="shrink-0 text-[10px] text-dls-secondary w-6 pt-0.5">
                                  {heading.level}
                                </div>
                                <div class="min-w-0 flex-1">
                                  <div
                                    class="text-xs text-dls-text truncate"
                                    style={{ "padding-left": `${Math.max(0, heading.level - 1) * 12}px` }}
                                  >
                                    {heading.text}
                                  </div>
                                  <div class="mt-1 text-[10px] text-dls-secondary">
                                    {heading.elementCount} elements
                                    <Show when={heading.occurrence > 1}>
                                      {" "}
                                      · #{heading.occurrence}
                                    </Show>
                                  </div>
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

              <div class="min-w-0">
                <div class="flex items-center justify-between">
                  <div class="text-xs font-medium text-dls-text">Insert after (optional)</div>
                  <button
                    type="button"
                    class="text-[11px] text-dls-secondary hover:text-dls-text disabled:opacity-50"
                    disabled={!sectionCopyTargetHeading()}
                    onClick={() => setSectionCopyTargetHeading(null)}
                  >
                    Clear
                  </button>
                </div>
                <div class="mt-2">
                  <input
                    type="text"
                    value={sectionCopyTargetQuery()}
                    onInput={(event) => setSectionCopyTargetQuery(event.currentTarget.value)}
	                    placeholder="Search target headings…"
	                    class="w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/40"
	                    disabled={!targetDoc() || !isDocxSectionCopyTarget(targetDoc() ?? "")}
	                  />
	                </div>
                <div class="mt-2 rounded-lg border border-dls-border overflow-hidden max-h-[360px] overflow-y-auto">
                  <Show when={!sectionCopyTargetHeadings.loading} fallback={<div class="p-3 text-xs text-dls-secondary">Loading…</div>}>
                    <Show
                      when={filteredSectionCopyTargetHeadings().length > 0}
                      fallback={<div class="p-3 text-xs text-dls-secondary">No headings found.</div>}
                    >
                      <For each={filteredSectionCopyTargetHeadings()}>
                        {(heading) => {
                          const selected = createMemo(() => {
                            const current = sectionCopyTargetHeading();
                            if (!current) return false;
                            return current.text === heading.text && current.occurrence === heading.occurrence;
                          });
                          return (
                            <button
                              type="button"
                              class={`w-full text-left px-3 py-2 border-b border-dls-border/50 last:border-b-0 hover:bg-dls-hover ${selected() ? "bg-dls-active" : ""
                                }`}
                              onClick={() => setSectionCopyTargetHeading(heading)}
                              title={heading.text}
                            >
                              <div class="flex items-start gap-2">
                                <div class="shrink-0 text-[10px] text-dls-secondary w-6 pt-0.5">
                                  {heading.level}
                                </div>
                                <div class="min-w-0 flex-1">
                                  <div
                                    class="text-xs text-dls-text truncate"
                                    style={{ "padding-left": `${Math.max(0, heading.level - 1) * 12}px` }}
                                  >
                                    {heading.text}
                                  </div>
                                  <div class="mt-1 text-[10px] text-dls-secondary">
                                    {heading.elementCount} elements
                                    <Show when={heading.occurrence > 1}>
                                      {" "}
                                      · #{heading.occurrence}
                                    </Show>
                                  </div>
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
            </div>

            <div class="px-4 pb-4 space-y-3">
              <label class="flex items-center gap-2 text-xs text-dls-secondary">
                <input
                  type="checkbox"
                  checked={sectionCopyExcludeHeading()}
                  onChange={(event) => setSectionCopyExcludeHeading(event.currentTarget.checked)}
                />
                Exclude source heading (copy content only)
              </label>

              <Show when={sectionCopyError() || sectionCopySourceHeadings.error || sectionCopyTargetHeadings.error}>
                <div class="rounded-lg border border-red-11/30 bg-red-3/20 px-3 py-2 text-xs text-red-11">
                  {sectionCopyError() ||
                    (sectionCopySourceHeadings.error instanceof Error
                      ? sectionCopySourceHeadings.error.message
                      : sectionCopyTargetHeadings.error instanceof Error
                        ? sectionCopyTargetHeadings.error.message
                        : "Something went wrong.")}
                </div>
              </Show>
            </div>

            <div class="px-4 py-3 border-t border-dls-border flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                onClick={closeSectionCopyModal}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text hover:bg-dls-hover disabled:opacity-50"
                onClick={() => void runSectionCopy()}
                disabled={sectionCopyBusy() || !sectionCopySourceHeading()}
                title={!sectionCopySourceHeading() ? "Select a source heading" : "Insert"}
              >
                <Show when={!sectionCopyBusy()} fallback={"Working…"}>
                  Insert
                </Show>
              </button>
            </div>
          </div>
        </div>
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
