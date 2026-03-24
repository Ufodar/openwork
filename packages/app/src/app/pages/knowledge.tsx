import { ChevronDown, ChevronRight, FileText, Loader2, Plus, RefreshCw, Trash2, Upload } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";

import { currentLocale, t as i18n } from "../../i18n";
import Button from "../components/button";
import { groupKnowledgeItemsByOwner } from "../lib/knowledge-grouping";
import type {
  OpenworkKnowledgeDocumentItem,
  OpenworkKnowledgeItem,
  OpenworkKnowledgeScope,
  OpenworkServerClient,
} from "../lib/openwork-server";

export type KnowledgeViewProps = {
  client: OpenworkServerClient | null;
  workspaceId: string | null | undefined;
  workspaceName: string;
};

function replaceKnowledgeItem(items: OpenworkKnowledgeItem[], nextItem: OpenworkKnowledgeItem): OpenworkKnowledgeItem[] {
  const next = [...items];
  const index = next.findIndex((item) => item.knowledgeId === nextItem.knowledgeId);
  if (index >= 0) {
    next[index] = nextItem;
    return next;
  }
  return [nextItem, ...next];
}

function removeKnowledgeItem(items: OpenworkKnowledgeItem[], knowledgeId: string): OpenworkKnowledgeItem[] {
  return items.filter((item) => item.knowledgeId !== knowledgeId);
}

function statusTone(status: string) {
  switch (status) {
    case "processing":
      return "border-amber-7 bg-amber-3/70 text-amber-11";
    case "degraded":
      return "border-red-7 bg-red-3/70 text-red-11";
    case "ready":
      return "border-green-7 bg-green-3/70 text-green-11";
    default:
      return "border-gray-6 bg-gray-3/70 text-gray-11";
  }
}

function formatStatus(status: string, tr: (key: string) => string) {
  switch (status) {
    case "processing":
      return tr("knowledge.status_processing");
    case "degraded":
      return tr("knowledge.status_degraded");
    case "ready":
      return tr("knowledge.status_ready");
    default:
      return tr("knowledge.status_unknown");
  }
}

function formatChunkMethod(method: string | null | undefined, tr: (key: string) => string) {
  if (!method) return tr("knowledge.chunk_method_naive");
  if (method === "naive") return tr("knowledge.chunk_method_naive");
  return method;
}

function runTone(run: string | null | undefined) {
  const normalized = typeof run === "string" ? run.trim().toUpperCase() : "";
  if (normalized === "DONE") return "border-green-7 bg-green-3/60 text-green-11";
  if (normalized === "FAIL") return "border-red-7 bg-red-3/60 text-red-11";
  if (normalized) return "border-amber-7 bg-amber-3/60 text-amber-11";
  return "border-gray-6 bg-gray-3/60 text-gray-11";
}

function formatRun(run: string | null | undefined, tr: (key: string) => string) {
  const normalized = typeof run === "string" ? run.trim().toUpperCase() : "";
  switch (normalized) {
    case "DONE":
      return tr("knowledge.document_run_done");
    case "FAIL":
      return tr("knowledge.document_run_fail");
    case "UNSTART":
    case "RUNNING":
    case "PENDING":
      return tr("knowledge.document_run_processing");
    default:
      return tr("knowledge.document_run_unknown");
  }
}

function formatBytes(size: number | null | undefined, tr: (key: string) => string) {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return tr("knowledge.file_size_unknown");
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeView(props: KnowledgeViewProps) {
  let uploadInputEl: HTMLInputElement | undefined;
  let knowledgeLoadRequestSeq = 0;
  const tr = (key: string) => i18n(key, currentLocale());

  const [mineItems, setMineItems] = createSignal<OpenworkKnowledgeItem[]>([]);
  const [othersItems, setOthersItems] = createSignal<OpenworkKnowledgeItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [createTitle, setCreateTitle] = createSignal("");
  const [createDescription, setCreateDescription] = createSignal("");
  const [createBusy, setCreateBusy] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [uploadBusyKnowledgeId, setUploadBusyKnowledgeId] = createSignal<string | null>(null);
  const [uploadError, setUploadError] = createSignal<string | null>(null);
  const [pendingUploadKnowledgeId, setPendingUploadKnowledgeId] = createSignal<string | null>(null);
  const [expandedKnowledgeIds, setExpandedKnowledgeIds] = createSignal<string[]>([]);
  const [documentsByKnowledgeId, setDocumentsByKnowledgeId] = createSignal<Record<string, OpenworkKnowledgeDocumentItem[]>>({});
  const [documentsLoadingByKnowledgeId, setDocumentsLoadingByKnowledgeId] = createSignal<Record<string, boolean>>({});
  const [documentErrorsByKnowledgeId, setDocumentErrorsByKnowledgeId] = createSignal<Record<string, string | null>>({});
  const [deletingDocumentKey, setDeletingDocumentKey] = createSignal<string | null>(null);
  const [deletingKnowledgeId, setDeletingKnowledgeId] = createSignal<string | null>(null);
  const groupedOthersItems = createMemo(() =>
    groupKnowledgeItemsByOwner(othersItems(), tr("knowledge.owner_unknown"))
  );

  const knowledgeLoadKey = createMemo(() => {
    const workspaceId = props.workspaceId?.trim() ?? "";
    if (!workspaceId) return props.client ? "connected:" : "";
    return `${props.client ? "connected" : "disconnected"}:${workspaceId}`;
  });

  const updateKnowledgeItem = (scope: OpenworkKnowledgeScope, item: OpenworkKnowledgeItem) => {
    if (scope === "mine") {
      setMineItems((current) => replaceKnowledgeItem(current, item));
      return;
    }
    setOthersItems((current) => replaceKnowledgeItem(current, item));
  };

  const clearKnowledgeLocalState = (knowledgeId: string) => {
    setExpandedKnowledgeIds((current) => current.filter((item) => item !== knowledgeId));
    setDocumentsByKnowledgeId((current) => {
      const next = { ...current };
      delete next[knowledgeId];
      return next;
    });
    setDocumentsLoadingByKnowledgeId((current) => {
      const next = { ...current };
      delete next[knowledgeId];
      return next;
    });
    setDocumentErrorsByKnowledgeId((current) => {
      const next = { ...current };
      delete next[knowledgeId];
      return next;
    });
  };

  const loadKnowledge = async () => {
    const requestId = ++knowledgeLoadRequestSeq;
    const client = props.client;
    const workspaceId = props.workspaceId?.trim() ?? "";
    if (!client || !workspaceId) {
      if (requestId !== knowledgeLoadRequestSeq) return;
      setMineItems([]);
      setOthersItems([]);
      setError(tr("knowledge.connect_required"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [mine, others] = await Promise.all([
        client.listKnowledge(workspaceId, "mine"),
        client.listKnowledge(workspaceId, "others"),
      ]);
      if (requestId !== knowledgeLoadRequestSeq) return;
      setMineItems(mine.items);
      setOthersItems(others.items);
    } catch (nextError) {
      if (requestId !== knowledgeLoadRequestSeq) return;
      setError(nextError instanceof Error ? nextError.message : tr("knowledge.load_failed"));
    } finally {
      if (requestId === knowledgeLoadRequestSeq) {
        setLoading(false);
      }
    }
  };

  createEffect(
    on(
      knowledgeLoadKey,
      () => {
        void loadKnowledge();
      },
      { defer: true },
    ),
  );

  const loadKnowledgeDocuments = async (
    knowledgeId: string,
    scope: OpenworkKnowledgeScope,
    force = false,
  ) => {
    const client = props.client;
    const workspaceId = props.workspaceId?.trim() ?? "";
    if (!client || !workspaceId) return;
    if (!force && documentsByKnowledgeId()[knowledgeId]) return;

    setDocumentsLoadingByKnowledgeId((current) => ({ ...current, [knowledgeId]: true }));
    setDocumentErrorsByKnowledgeId((current) => ({ ...current, [knowledgeId]: null }));
    try {
      const result = await client.listKnowledgeDocuments(workspaceId, knowledgeId);
      setDocumentsByKnowledgeId((current) => ({ ...current, [knowledgeId]: result.documents }));
      updateKnowledgeItem(scope, result.item);
    } catch (nextError) {
      setDocumentErrorsByKnowledgeId((current) => ({
        ...current,
        [knowledgeId]: nextError instanceof Error ? nextError.message : tr("knowledge.files_load_failed"),
      }));
    } finally {
      setDocumentsLoadingByKnowledgeId((current) => ({ ...current, [knowledgeId]: false }));
    }
  };

  const toggleKnowledgeDocuments = async (knowledgeId: string, scope: OpenworkKnowledgeScope) => {
    if (expandedKnowledgeIds().includes(knowledgeId)) {
      setExpandedKnowledgeIds((current) => current.filter((item) => item !== knowledgeId));
      return;
    }
    setExpandedKnowledgeIds((current) => [...current, knowledgeId]);
    await loadKnowledgeDocuments(knowledgeId, scope);
  };

  const handleCreateKnowledge = async () => {
    const client = props.client;
    const workspaceId = props.workspaceId?.trim() ?? "";
    const title = createTitle().trim();
    if (!client || !workspaceId) return;
    if (!title) {
      setCreateError(tr("knowledge.create_name_required"));
      return;
    }

    setCreateBusy(true);
    setCreateError(null);
    try {
      const result = await client.createKnowledge(workspaceId, {
        title,
        description: createDescription().trim() || null,
      });
      setMineItems((current) => replaceKnowledgeItem(current, result.item));
      setCreateTitle("");
      setCreateDescription("");
    } catch (nextError) {
      setCreateError(nextError instanceof Error ? nextError.message : tr("knowledge.create_failed"));
    } finally {
      setCreateBusy(false);
    }
  };

  const openUploadPicker = (knowledgeId: string) => {
    setPendingUploadKnowledgeId(knowledgeId);
    setUploadError(null);
    uploadInputEl?.click();
  };

  const handleUploadFiles = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const knowledgeId = pendingUploadKnowledgeId();
    const client = props.client;
    const workspaceId = props.workspaceId?.trim() ?? "";
    input.value = "";
    if (!files.length || !knowledgeId || !client || !workspaceId) return;

    setUploadBusyKnowledgeId(knowledgeId);
    setUploadError(null);
    try {
      const result = await client.uploadKnowledgeDocuments(workspaceId, knowledgeId, files);
      setMineItems((current) => replaceKnowledgeItem(current, result.item));
      if (expandedKnowledgeIds().includes(knowledgeId)) {
        await loadKnowledgeDocuments(knowledgeId, "mine", true);
      }
    } catch (nextError) {
      setUploadError(nextError instanceof Error ? nextError.message : tr("knowledge.upload_failed"));
    } finally {
      setUploadBusyKnowledgeId(null);
      setPendingUploadKnowledgeId(null);
    }
  };

  const handleDeleteDocument = async (knowledgeId: string, document: OpenworkKnowledgeDocumentItem) => {
    const client = props.client;
    const workspaceId = props.workspaceId?.trim() ?? "";
    const documentId = document.documentId?.trim() ?? "";
    if (!client || !workspaceId || !documentId) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        tr("knowledge.delete_document_confirm").replace("{name}", document.name),
      );
      if (!confirmed) return;
    }

    const busyKey = `${knowledgeId}:${documentId}`;
    setDeletingDocumentKey(busyKey);
    setUploadError(null);
    try {
      const result = await client.deleteKnowledgeDocument(workspaceId, knowledgeId, documentId);
      setMineItems((current) => replaceKnowledgeItem(current, result.item));
      setDocumentsByKnowledgeId((current) => ({
        ...current,
        [knowledgeId]: (current[knowledgeId] ?? []).filter((item) => item.documentId !== documentId),
      }));
      if (expandedKnowledgeIds().includes(knowledgeId)) {
        await loadKnowledgeDocuments(knowledgeId, "mine", true);
      }
    } catch (nextError) {
      setUploadError(nextError instanceof Error ? nextError.message : tr("knowledge.delete_document_failed"));
    } finally {
      setDeletingDocumentKey(null);
    }
  };

  const handleDeleteKnowledge = async (knowledgeId: string, title: string) => {
    const client = props.client;
    const workspaceId = props.workspaceId?.trim() ?? "";
    if (!client || !workspaceId) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        tr("knowledge.delete_knowledge_confirm").replace("{name}", title),
      );
      if (!confirmed) return;
    }

    setDeletingKnowledgeId(knowledgeId);
    setUploadError(null);
    try {
      await client.deleteKnowledge(workspaceId, knowledgeId);
      setMineItems((current) => removeKnowledgeItem(current, knowledgeId));
      clearKnowledgeLocalState(knowledgeId);
    } catch (nextError) {
      setUploadError(nextError instanceof Error ? nextError.message : tr("knowledge.delete_knowledge_failed"));
    } finally {
      setDeletingKnowledgeId(null);
    }
  };

  const renderKnowledgeDocuments = (knowledgeId: string, scope: OpenworkKnowledgeScope, writable: boolean) => {
    const documents = documentsByKnowledgeId()[knowledgeId] ?? [];
    const loadingState = documentsLoadingByKnowledgeId()[knowledgeId] === true;
    const errorMessage = documentErrorsByKnowledgeId()[knowledgeId];

    return (
      <div class="rounded-xl border border-dls-border bg-dls-surface px-3 py-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="text-xs font-medium text-dls-secondary">{tr("knowledge.files_title")}</div>
          <Show when={loadingState}>
            <span class="inline-flex items-center gap-1 text-xs text-dls-secondary">
              <Loader2 size={12} class="animate-spin" />
              {tr("knowledge.files_loading")}
            </span>
          </Show>
        </div>
        <Show when={errorMessage}>
          <div class="rounded-xl border border-red-7 bg-red-3/60 px-3 py-2 text-xs text-red-11">{errorMessage}</div>
        </Show>
        <Show
          when={!loadingState && documents.length > 0}
          fallback={
            <Show when={!loadingState && !errorMessage}>
              <div class="rounded-xl border border-dls-border bg-dls-background px-3 py-3 text-xs text-dls-secondary">
                {tr("knowledge.files_empty")}
              </div>
            </Show>
          }
        >
          <div class="space-y-2">
            <For each={documents}>
              {(document) => {
                const busyKey = `${knowledgeId}:${document.documentId ?? ""}`;
                return (
                  <div class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-dls-border bg-dls-background px-3 py-2">
                    <div class="min-w-0 flex-1 space-y-1">
                      <div class="flex items-center gap-2 min-w-0">
                        <FileText size={14} class="shrink-0 text-dls-secondary" />
                        <div class="truncate text-sm font-medium text-dls-text">{document.name}</div>
                      </div>
                      <div class="flex flex-wrap gap-2 text-xs text-dls-secondary">
                        <span>{formatBytes(document.size, tr)}</span>
                        <span>{tr("knowledge.chunks_count").replace("{count}", document.chunkCount.toLocaleString())}</span>
                        <span>{formatChunkMethod(document.chunkMethod, tr)}</span>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <div class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${runTone(document.run)}`}>
                        {formatRun(document.run, tr)}
                      </div>
                      <Show when={writable}>
                        <Button
                          variant="danger"
                          class="px-2.5 py-1.5"
                          title={tr("knowledge.delete_document_action")}
                          disabled={deletingDocumentKey() === busyKey}
                          onClick={() => void handleDeleteDocument(knowledgeId, document)}
                        >
                          <Show
                            when={deletingDocumentKey() === busyKey}
                            fallback={<Trash2 size={14} />}
                          >
                            <Loader2 size={14} class="animate-spin" />
                          </Show>
                        </Button>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  const renderKnowledgeCard = (item: OpenworkKnowledgeItem, scope: OpenworkKnowledgeScope) => {
    const writable = scope === "mine";
    const expanded = expandedKnowledgeIds().includes(item.knowledgeId);
    const uploadBusy = uploadBusyKnowledgeId() === item.knowledgeId;
    const deletingKnowledge = deletingKnowledgeId() === item.knowledgeId;

    return (
      <div class="rounded-2xl border border-dls-border bg-dls-background p-4 space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <div class="truncate text-base font-semibold text-dls-text">{item.title}</div>
              <div class={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(item.status)}`}>
                {formatStatus(item.status, tr)}
              </div>
            </div>
            <Show when={scope === "others"}>
              <div class="text-xs text-dls-secondary">
                {tr("knowledge.owner").replace("{name}", item.ownerDisplayName)}
              </div>
            </Show>
            <Show when={item.description}>
              <div class="line-clamp-2 text-sm text-dls-secondary">{item.description}</div>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              class="px-3 py-1.5 text-xs"
              onClick={() => void toggleKnowledgeDocuments(item.knowledgeId, scope)}
            >
              <Show when={expanded} fallback={<ChevronRight size={14} />}>
                <ChevronDown size={14} />
              </Show>
              <span>{expanded ? tr("knowledge.files_hide_action") : tr("knowledge.files_action")}</span>
            </Button>
            <Show when={writable}>
              <Button
                variant="outline"
                class="px-3 py-1.5 text-xs"
                onClick={() => openUploadPicker(item.knowledgeId)}
                disabled={uploadBusy}
              >
                <Show when={uploadBusy} fallback={<Upload size={14} />}>
                  <Loader2 size={14} class="animate-spin" />
                </Show>
                <span>{uploadBusy ? tr("knowledge.uploading") : tr("knowledge.upload_action")}</span>
              </Button>
              <Button
                variant="danger"
                class="px-3 py-1.5 text-xs"
                onClick={() => void handleDeleteKnowledge(item.knowledgeId, item.title)}
                disabled={deletingKnowledge}
              >
                <Show when={deletingKnowledge} fallback={<Trash2 size={14} />}>
                  <Loader2 size={14} class="animate-spin" />
                </Show>
                <span>{deletingKnowledge ? tr("knowledge.deleting_knowledge") : tr("knowledge.delete_knowledge_action")}</span>
              </Button>
            </Show>
          </div>
        </div>

        <div class="flex flex-wrap gap-2 text-xs text-dls-secondary">
          <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
            {tr("knowledge.docs_count").replace("{count}", item.documentCount.toLocaleString())}
          </div>
          <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
            {tr("knowledge.chunks_count").replace("{count}", item.chunkCount.toLocaleString())}
          </div>
          <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
            {formatChunkMethod(item.chunkMethod, tr)}
          </div>
        </div>

        <Show when={writable}>
          <div class="text-xs text-dls-secondary">
            {tr("knowledge.session_external_hint")}
          </div>
        </Show>

        <Show when={expanded}>
          {renderKnowledgeDocuments(item.knowledgeId, scope, writable)}
        </Show>
      </div>
    );
  };

  return (
    <div class="space-y-4">
      <input
        ref={uploadInputEl}
        type="file"
        multiple
        class="hidden"
        onChange={handleUploadFiles}
      />

      <div class="rounded-2xl border border-dls-border bg-dls-surface p-4 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-1.5">
            <div class="text-sm font-medium text-dls-secondary">{tr("knowledge.title")}</div>
            <div class="text-xl font-semibold text-dls-text">{tr("knowledge.subtitle")}</div>
            <div class="max-w-3xl text-sm leading-6 text-dls-secondary">
              {tr("knowledge.description")}
            </div>
            <div class="text-xs text-dls-secondary">
              {tr("knowledge.default_chunking")}
            </div>
          </div>
          <Button variant="outline" onClick={() => void loadKnowledge()} disabled={loading()}>
            <Show when={loading()} fallback={<RefreshCw size={14} />}>
              <Loader2 size={14} class="animate-spin" />
            </Show>
            <span>{tr("knowledge.refresh")}</span>
          </Button>
        </div>
      </div>

      <div class="rounded-2xl border border-dls-border bg-dls-surface p-4 shadow-sm space-y-3">
        <div>
          <div class="text-base font-semibold text-dls-text">{tr("knowledge.create_title")}</div>
          <div class="mt-1 text-sm text-dls-secondary">
            {tr("knowledge.create_description")}
          </div>
        </div>
        <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label class="space-y-1.5">
            <div class="text-xs font-medium text-dls-secondary">{tr("knowledge.create_name_label")}</div>
            <input
              value={createTitle()}
              onInput={(event) => setCreateTitle(event.currentTarget.value)}
              placeholder={tr("knowledge.create_name_placeholder")}
              class="w-full rounded-xl border border-dls-border bg-dls-background px-3 py-2.5 text-sm text-dls-text outline-none transition focus:border-dls-accent"
            />
          </label>
          <label class="space-y-1.5">
            <div class="text-xs font-medium text-dls-secondary">{tr("knowledge.create_description_label")}</div>
            <input
              value={createDescription()}
              onInput={(event) => setCreateDescription(event.currentTarget.value)}
              placeholder={tr("knowledge.create_description_placeholder")}
              class="w-full rounded-xl border border-dls-border bg-dls-background px-3 py-2.5 text-sm text-dls-text outline-none transition focus:border-dls-accent"
            />
          </label>
          <div class="flex items-end">
            <Button onClick={() => void handleCreateKnowledge()} disabled={createBusy()}>
              <Show when={createBusy()} fallback={<Plus size={14} />}>
                <Loader2 size={14} class="animate-spin" />
              </Show>
              <span>{createBusy() ? tr("knowledge.creating") : tr("knowledge.create_action")}</span>
            </Button>
          </div>
        </div>
        <Show when={createError()}>
          {(message) => <div class="rounded-xl border border-red-7 bg-red-3/60 px-3 py-2 text-sm text-red-11">{message()}</div>}
        </Show>
      </div>

      <Show when={error()}>
        {(message) => <div class="rounded-xl border border-red-7 bg-red-3/60 px-3 py-2 text-sm text-red-11">{message()}</div>}
      </Show>
      <Show when={uploadError()}>
        {(message) => <div class="rounded-xl border border-red-7 bg-red-3/60 px-3 py-2 text-sm text-red-11">{message()}</div>}
      </Show>

      <div class="grid gap-4 xl:grid-cols-2">
        <section class="rounded-2xl border border-dls-border bg-dls-surface p-4 shadow-sm space-y-3">
          <div>
            <div class="text-base font-semibold text-dls-text">{tr("knowledge.mine_title")}</div>
            <div class="mt-1 text-sm text-dls-secondary">
              {tr("knowledge.mine_description")}
            </div>
          </div>
          <Show
            when={mineItems().length > 0}
            fallback={
              <div class="rounded-xl border border-dls-border bg-dls-background px-3 py-4 text-sm text-dls-secondary">
                {tr("knowledge.mine_empty").replace("{workspace}", props.workspaceName)}
              </div>
            }
          >
            <div class="space-y-3">
              <For each={mineItems()}>
                {(item) => renderKnowledgeCard(item, "mine")}
              </For>
            </div>
          </Show>
        </section>

        <section class="rounded-2xl border border-dls-border bg-dls-surface p-4 shadow-sm space-y-3">
          <div>
            <div class="text-base font-semibold text-dls-text">{tr("knowledge.others_title")}</div>
            <div class="mt-1 text-sm text-dls-secondary">
              {tr("knowledge.others_description")}
            </div>
          </div>
          <Show
            when={othersItems().length > 0}
            fallback={
              <div class="rounded-xl border border-dls-border bg-dls-background px-3 py-4 text-sm text-dls-secondary">
                {tr("knowledge.others_empty")}
              </div>
            }
          >
            <div class="space-y-3">
              <For each={groupedOthersItems()}>
                {(group) => (
                  <div class="rounded-2xl border border-dls-border bg-dls-background/60 p-3 space-y-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="truncate text-sm font-semibold text-dls-text">{group.ownerLabel}</div>
                        <div class="text-xs text-dls-secondary">
                          {tr("knowledge.group_count").replace("{count}", group.items.length.toLocaleString())}
                        </div>
                      </div>
                    </div>
                    <div class="space-y-3">
                      <For each={group.items}>
                        {(item) => renderKnowledgeCard(item, "others")}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
}
