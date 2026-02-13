import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import OnlyOfficeEditor from "../components/onlyoffice-editor";
import { FileText, Plus } from "lucide-solid";
import type { OpenworkServerClient, OpenworkServerStatus } from "../lib/openwork-server";
import { DOCUMENT_UPLOAD_ACCEPT } from "../lib/documents";

interface DocumentItem {
    name: string;
    updatedAt: number;
    size: number;
    type: string;
}

type OnlyOfficeConfigResponse =
  | { documentServerUrl: string; config: any }
  | any;

export type DocumentViewProps = {
  openworkServerStatus: OpenworkServerStatus;
  openworkServerClient: OpenworkServerClient | null;
  openworkServerWorkspaceId: string | null;
};

export default function DocumentView(props: DocumentViewProps) {
    const params = useParams(); // gets workspace id from route /w/:id/...
    const workspaceId = createMemo(() => {
      const explicit = props.openworkServerWorkspaceId?.trim() ?? "";
      if (explicit) return explicit;
      const fromRoute = (params.id ?? "").trim();
      if (fromRoute) return fromRoute;
      return "";
    });

    const [selectedDoc, setSelectedDoc] = createSignal<string | null>(null);

    const serverReady = createMemo(
      () => props.openworkServerStatus === "connected" && Boolean(props.openworkServerClient),
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

    // Fetch documents
    const [documents, { refetch }] = createResource(apiConfig, async (cfg) => {
      if (!cfg) return [] as DocumentItem[];
      const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/documents");
      const data = (await fetchJson(url, cfg.token)) as { items?: DocumentItem[] };
      return Array.isArray(data.items) ? data.items : [];
    });

    // Fetch config for selected doc
    const [editorPayload] = createResource(
      () => {
        const cfg = apiConfig();
        const doc = selectedDoc();
        if (!cfg || !doc) return null;
        return { ...cfg, doc };
      },
      async (input) => {
        if (!input) return null;
        const query = new URLSearchParams();
        query.set("doc", input.doc);
        const url = buildUrl(input.baseUrl, input.workspaceId, "/document/config", query);
        const data = (await fetchJson(url, input.token)) as OnlyOfficeConfigResponse;

        if (
          data &&
          typeof (data as any).documentServerUrl === "string" &&
          (data as any).config
        ) {
          return data as { documentServerUrl: string; config: any };
        }

        return { documentServerUrl: "http://localhost:8080", config: data };
      },
    );

    const handleUpload = async (e: Event) => {
        const cfg = apiConfig();
        if (!cfg) return;

        const input = e.target as HTMLInputElement;
        if (!input.files?.length) return;
        const file = input.files[0];

        const formData = new FormData();
        formData.append("file", file);

        const url = buildUrl(cfg.baseUrl, cfg.workspaceId, "/document/upload");
        await fetchJson(url, cfg.token, {
          method: "POST",
          body: formData,
          headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : undefined,
        });
        input.value = "";
        await refetch();
    };

    return (
        <div class="flex h-full bg-dls-background">
            {/* Sidebar - Document List */}
            <div class="w-64 border-r border-dls-border flex flex-col">
                <div class="p-4 border-b border-dls-border flex justify-between items-center">
                    <h2 class="font-semibold text-dls-text">Documents</h2>
                    <label class="cursor-pointer p-1 hover:bg-dls-hover rounded">
                        <Plus size={16} />
                        <input type="file" class="hidden" onChange={handleUpload} accept={DOCUMENT_UPLOAD_ACCEPT} />
                    </label>
                </div>
                <div class="flex-1 overflow-y-auto p-2">
                    <Show
                      when={serverReady()}
                      fallback={<div class="p-2 text-xs text-dls-secondary">OpenWork server not connected.</div>}
                    >
                      <For each={documents() ?? []}>
                        {(doc) => (
                            <button
                                class={`w-full text-left p-2 rounded flex items-center gap-2 mb-1 ${selectedDoc() === doc.name
                                        ? "bg-dls-hover text-dls-text"
                                        : "text-dls-secondary hover:bg-dls-surface"
                                    }`}
                                onClick={() => setSelectedDoc(doc.name)}
                            >
                                <FileText size={16} />
                                <span class="truncate">{doc.name}</span>
                            </button>
                        )}
                      </For>
                    </Show>
                </div>
            </div>

            {/* Main Area - Editor */}
            <div class="flex-1 flex flex-col">
                <Show when={selectedDoc()} fallback={
                    <div class="flex-1 flex items-center justify-center text-dls-secondary">
                        Select a document to edit
                    </div>
                }>
                    <Show when={editorPayload()} fallback={<div>Loading editor...</div>}>
                        <OnlyOfficeEditor
                            documentServerUrl={editorPayload()!.documentServerUrl}
                            config={editorPayload()!.config}
                        />
                    </Show>
                </Show>
            </div>
        </div>
    );
}
