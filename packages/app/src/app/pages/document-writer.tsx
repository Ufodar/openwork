import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { FileText, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw } from "lucide-solid";
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

type OnlyOfficePayload = { documentServerUrl: string; config: any };

export default function DocumentWriterView(props: SessionViewProps) {
  const navigate = useNavigate();

  const sessionId = createMemo(() => props.selectedSessionId?.trim() ?? "");
  const workspaceId = createMemo(() => props.openworkServerWorkspaceId?.trim() ?? "");

  const serverReady = createMemo(
    () =>
      props.openworkServerStatus === "connected" &&
      Boolean(props.openworkServerClient) &&
      Boolean(workspaceId()),
  );

  const apiConfig = createMemo(() => {
    const client = props.openworkServerClient;
    if (!client) return null;
    const id = workspaceId();
    if (!id) return null;
    return {
      baseUrl: client.baseUrl,
      token: client.token?.trim() ?? "",
      workspaceId: id,
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

  const [documents, { refetch: refetchDocuments }] = createResource(apiConfig, async (cfg) => {
    if (!cfg) return [] as DocumentItem[];
    const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/documents");
    const data = (await fetchJson(url, cfg.token)) as { items?: DocumentItem[] };
    return Array.isArray(data.items) ? data.items : [];
  });

  const editorSource = createMemo(() => {
    const cfg = apiConfig();
    const doc = selectedDoc();
    if (!cfg || !doc) return null;
    return { ...cfg, doc, seq: configSeq() };
  });

  const [editorPayload] = createResource(editorSource, async (input): Promise<OnlyOfficePayload | null> => {
    if (!input) return null;
    const query = new URLSearchParams();
    query.set("doc", input.doc);
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

    const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/upload");
    await fetchJson(url, cfg.token, { method: "POST", body: formData });
    input.value = "";
    await refetchDocuments();
  };

  const activeDocPath = createMemo(() => {
    const doc = selectedDoc();
    if (!doc) return "";
    const normalized = doc.trim().replace(/^\/+/, "");
    return normalized ? `documents/${normalized}` : "";
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
    props.sendPromptAsync(draft).catch(() => undefined);
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
        class={`shrink-0 border-r border-dls-border flex flex-col bg-dls-sidebar transition-[width] duration-200 ease-out ${
          documentsCollapsed() ? "w-14" : "w-64"
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
                class={`cursor-pointer p-2 hover:bg-dls-hover rounded ${
                  !serverReady() ? "opacity-50 cursor-not-allowed" : ""
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
                class={`cursor-pointer p-2 hover:bg-dls-hover rounded ${
                  !serverReady() ? "opacity-50 cursor-not-allowed" : ""
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
                      class={`w-full rounded flex items-center mb-1 transition-colors ${
                        documentsCollapsed() ? "justify-center p-2" : "text-left p-2 gap-2"
                      } ${
                        selectedDoc() === doc.name
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
              onClick={() => navigate(`/session/${sessionId()}`)}
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
            <Show when={editorPayload()} fallback={<div class="p-4 text-xs text-dls-secondary">Loading editor...</div>}>
              <OnlyOfficeEditor
                documentServerUrl={editorPayload()!.documentServerUrl}
                config={editorPayload()!.config}
              />
            </Show>
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
    </div>
  );
}
