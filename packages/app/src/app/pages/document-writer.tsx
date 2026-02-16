import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { ArrowRight, AtSign, ChevronDown, Copy, Download, FileText, Folder, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Trash2, X } from "lucide-solid";
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
      throw new Error(text || `Request failed (${response.status})`);
    }
    return await response.json();
  };

  const [selectedDoc, setSelectedDoc] = createSignal<string | null>(null);
  const [documentsCollapsed, setDocumentsCollapsed] = createSignal(false);
  const [configSeq, setConfigSeq] = createSignal(0);
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

  const [documents, { refetch: refetchDocuments }] = createResource(apiConfig, async (cfg) => {
    if (!cfg) return [] as DocumentItem[];
    const query = new URLSearchParams();
    query.set("session", cfg.sessionId);
    const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/documents", query);
    const data = (await fetchJson(url, cfg.token)) as { items?: DocumentItem[] };
    return Array.isArray(data.items) ? data.items : [];
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

  const toggleRefsCategory = (categoryId: string) => {
    setRefsExpanded((current) => ({ ...current, [categoryId]: !current[categoryId] }));
  };

  const editorSource = createMemo(() => {
    const cfg = apiConfig();
    const doc = selectedDoc();
    if (!cfg || !doc) return null;
    return { ...cfg, doc, seq: configSeq(), readonly: isAgentRunning() } satisfies EditorSource;
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
    await fetchJson(url, cfg.token, { method: "POST", body: formData });
    input.value = "";
    await refetchDocuments();
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
    setRefsOpenBusyId(item.id);
    setRefsError(null);
    try {
      const query = new URLSearchParams();
      query.set("inboxId", item.id);
      query.set("session", cfg.sessionId);
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/import", query);
      const result = (await fetchJson(url, cfg.token, { method: "POST" })) as { doc?: string };
      const doc = typeof result?.doc === "string" ? result.doc.trim() : "";
      if (!doc) throw new Error("Failed to import document");
      setSelectedDoc(doc);
      await refetchDocuments();
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
    const doc = selectedDoc();
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
    const doc = selectedDoc();
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
    const doc = selectedDoc();
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

  const activeDocPath = createMemo(() => {
    const doc = selectedDoc();
    if (!doc) return "";
    const normalized = doc.trim().replace(/^\/+/, "");
    if (!normalized) return "";
    const session = apiConfig()?.sessionId ?? sessionId();
    if (!session) return "";
    return `documents/sessions/${session}/${normalized}`;
  });

  createEffect(() => {
    sessionId();
    setSelectedDoc(null);
  });

  createEffect(() => {
    const prev = lastSessionStatus();
    const next = props.sessionStatus ?? "idle";
    setLastSessionStatus(next);
    if (prev !== "running" || next === "running") return;
    if (!selectedDoc()) return;
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

  const listCommands = async (): Promise<SlashCommandOption[]> => {
    try {
      return await props.listCommands();
    } catch {
      return [];
    }
  };

  return (
    <div class="flex h-screen w-full bg-dls-surface text-dls-text font-sans overflow-hidden">
      {/* Left: Document list */}
      <div
        class={`shrink-0 border-r border-dls-border flex flex-col bg-dls-sidebar transition-[width] duration-200 ease-out ${documentsCollapsed() ? "w-14" : "w-64"
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
              <Show when={(documents() ?? []).length > 0} fallback={<div class="p-2 text-xs text-dls-secondary">No documents yet.</div>}>
                <For each={documents() ?? []}>
                  {(doc) => (
                    <button
                      class={`w-full rounded flex items-center mb-1 transition-colors ${documentsCollapsed() ? "justify-center p-2" : "text-left p-2 gap-2"
                        } ${selectedDoc() === doc.name
                          ? "bg-dls-hover text-dls-text"
                          : "text-dls-secondary hover:bg-dls-surface"
                        }`}
                      onClick={() => setSelectedDoc(doc.name)}
                      title={documentsCollapsed() ? doc.name : undefined}
                    >
                      <FileText size={16} />
                      <Show when={!documentsCollapsed()}>
                        <span class="truncate">{doc.name}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </Show>
          </Show>

          <Show when={!documentsCollapsed()}>
            <div class="mt-3 pt-3 border-t border-dls-border">
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
                                          !selectedDoc() ||
                                          !isDocxSectionCopyTarget(selectedDoc() ?? "") ||
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
      <div class="flex-1 min-w-0 flex flex-col">
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
              <Show when={selectedDoc()} fallback={"Select a document"}>
                Editing: <span class="text-dls-text">{selectedDoc()}</span>
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
              disabled={!selectedDoc()}
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
                navigate(`/session/${id}?view=session`);
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
            when={selectedDoc()}
            fallback={<div class="h-full flex items-center justify-center text-dls-secondary">Select a document to edit</div>}
          >
            <div class="relative h-full w-full">
              <Show when={editorPayload()} fallback={<div class="p-4 text-xs text-dls-secondary">Loading editor...</div>}>
                <OnlyOfficeEditor
                  documentServerUrl={editorPayload()!.documentServerUrl}
                  config={editorPayload()!.config}
                />
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
                      View-only mode is enabled to prevent conflicts. The document will reload when the run finishes.
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* Right: Chat */}
      <div class="shrink-0 w-[420px] border-l border-dls-border flex flex-col bg-dls-surface">
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
          busy={props.busy}
          onSend={handleSendPrompt}
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
                  Target: {selectedDoc() ?? "—"}
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
                    disabled={!selectedDoc() || !isDocxSectionCopyTarget(selectedDoc() ?? "")}
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
    </div>
  );
}
