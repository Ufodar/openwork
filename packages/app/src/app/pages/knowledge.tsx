import { For, Show, createEffect, createSignal, on } from "solid-js";
import { Loader2, Plus, RefreshCw } from "lucide-solid";

import { currentLocale, t as i18n } from "../../i18n";
import Button from "../components/button";
import type { OpenworkKnowledgeItem, OpenworkServerClient } from "../lib/openwork-server";

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

export default function KnowledgeView(props: KnowledgeViewProps) {
  let uploadInputEl: HTMLInputElement | undefined;
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

  const loadKnowledge = async () => {
    const client = props.client;
    const workspaceId = props.workspaceId?.trim() ?? "";
    if (!client || !workspaceId) {
      setMineItems([]);
      setOthersItems([]);
      setError(tr("knowledge.connect_required"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [mine, others] = await Promise.all([
        client.listKnowledge(workspaceId, "mine"),
        client.listKnowledge(workspaceId, "others"),
      ]);
      setMineItems(mine.items);
      setOthersItems(others.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("knowledge.load_failed"));
    } finally {
      setLoading(false);
    }
  };

  createEffect(
    on(
      () => [props.client, props.workspaceId] as const,
      () => {
        void loadKnowledge();
      },
      { defer: true },
    ),
  );

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
    } catch (nextError) {
      setUploadError(nextError instanceof Error ? nextError.message : tr("knowledge.upload_failed"));
    } finally {
      setUploadBusyKnowledgeId(null);
      setPendingUploadKnowledgeId(null);
    }
  };

  return (
    <div class="space-y-6">
      <input
        ref={uploadInputEl}
        type="file"
        multiple
        class="hidden"
        onChange={handleUploadFiles}
      />

      <div class="rounded-3xl border border-dls-border bg-dls-surface p-6 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-2">
            <div class="text-sm font-medium text-dls-secondary">{tr("knowledge.title")}</div>
            <div class="text-2xl font-semibold text-dls-text">{tr("knowledge.subtitle")}</div>
            <div class="max-w-2xl text-sm leading-6 text-dls-secondary">
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
            <span class="ml-2">{tr("knowledge.refresh")}</span>
          </Button>
        </div>
      </div>

      <div class="rounded-3xl border border-dls-border bg-dls-surface p-6 shadow-sm space-y-4">
        <div>
          <div class="text-lg font-semibold text-dls-text">{tr("knowledge.create_title")}</div>
          <div class="mt-1 text-sm text-dls-secondary">
            {tr("knowledge.create_description")}
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label class="space-y-2">
            <div class="text-xs font-medium uppercase tracking-wide text-dls-secondary">{tr("knowledge.create_name_label")}</div>
            <input
              value={createTitle()}
              onInput={(event) => setCreateTitle(event.currentTarget.value)}
              placeholder={tr("knowledge.create_name_placeholder")}
              class="w-full rounded-2xl border border-dls-border bg-dls-background px-4 py-3 text-sm text-dls-text outline-none transition focus:border-dls-accent"
            />
          </label>
          <label class="space-y-2">
            <div class="text-xs font-medium uppercase tracking-wide text-dls-secondary">{tr("knowledge.create_description_label")}</div>
            <input
              value={createDescription()}
              onInput={(event) => setCreateDescription(event.currentTarget.value)}
              placeholder={tr("knowledge.create_description_placeholder")}
              class="w-full rounded-2xl border border-dls-border bg-dls-background px-4 py-3 text-sm text-dls-text outline-none transition focus:border-dls-accent"
            />
          </label>
          <div class="flex items-end">
            <Button onClick={() => void handleCreateKnowledge()} disabled={createBusy()}>
              <Show when={createBusy()} fallback={<Plus size={14} />}>
                <Loader2 size={14} class="animate-spin" />
              </Show>
              <span class="ml-2">{createBusy() ? tr("knowledge.creating") : tr("knowledge.create_action")}</span>
            </Button>
          </div>
        </div>
        <Show when={createError()}>
          {(message) => <div class="rounded-2xl border border-red-7 bg-red-3/60 px-4 py-3 text-sm text-red-11">{message()}</div>}
        </Show>
      </div>

      <Show when={error()}>
        {(message) => <div class="rounded-2xl border border-red-7 bg-red-3/60 px-4 py-3 text-sm text-red-11">{message()}</div>}
      </Show>
      <Show when={uploadError()}>
        {(message) => <div class="rounded-2xl border border-red-7 bg-red-3/60 px-4 py-3 text-sm text-red-11">{message()}</div>}
      </Show>

      <div class="grid gap-6 xl:grid-cols-2">
        <section class="rounded-3xl border border-dls-border bg-dls-surface p-6 shadow-sm space-y-4">
          <div>
            <div class="text-lg font-semibold text-dls-text">{tr("knowledge.mine_title")}</div>
            <div class="mt-1 text-sm text-dls-secondary">
              {tr("knowledge.mine_description")}
            </div>
          </div>
          <Show
            when={mineItems().length > 0}
            fallback={
              <div class="rounded-2xl border border-dls-border bg-dls-background px-4 py-6 text-sm text-dls-secondary">
                {tr("knowledge.mine_empty").replace("{workspace}", props.workspaceName)}
              </div>
            }
          >
            <div class="space-y-3">
              <For each={mineItems()}>
                {(item) => (
                  <div class="rounded-2xl border border-dls-border bg-dls-background p-4 space-y-3">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="space-y-1">
                        <div class="text-base font-semibold text-dls-text">{item.title}</div>
                        <Show when={item.description}>
                          <div class="text-sm text-dls-secondary">{item.description}</div>
                        </Show>
                      </div>
                      <div class={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(item.status)}`}>
                        {formatStatus(item.status, tr)}
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
                    <div class="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => openUploadPicker(item.knowledgeId)}
                        disabled={uploadBusyKnowledgeId() === item.knowledgeId}
                      >
                        <Show when={uploadBusyKnowledgeId() === item.knowledgeId} fallback={<>{tr("knowledge.upload_action")}</>}>
                          <span class="inline-flex items-center gap-2">
                            <Loader2 size={14} class="animate-spin" />
                            {tr("knowledge.uploading")}
                          </span>
                        </Show>
                      </Button>
                      <div class="text-xs text-dls-secondary">
                        {tr("knowledge.session_external_hint")}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="rounded-3xl border border-dls-border bg-dls-surface p-6 shadow-sm space-y-4">
          <div>
            <div class="text-lg font-semibold text-dls-text">{tr("knowledge.others_title")}</div>
            <div class="mt-1 text-sm text-dls-secondary">
              {tr("knowledge.others_description")}
            </div>
          </div>
          <Show
            when={othersItems().length > 0}
            fallback={
              <div class="rounded-2xl border border-dls-border bg-dls-background px-4 py-6 text-sm text-dls-secondary">
                {tr("knowledge.others_empty")}
              </div>
            }
          >
            <div class="space-y-3">
              <For each={othersItems()}>
                {(item) => (
                  <div class="rounded-2xl border border-dls-border bg-dls-background p-4 space-y-3">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="space-y-1">
                        <div class="text-base font-semibold text-dls-text">{item.title}</div>
                        <div class="text-xs text-dls-secondary">
                          {tr("knowledge.owner").replace("{name}", item.ownerDisplayName)}
                        </div>
                        <Show when={item.description}>
                          <div class="text-sm text-dls-secondary">{item.description}</div>
                        </Show>
                      </div>
                      <div class={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(item.status)}`}>
                        {formatStatus(item.status, tr)}
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2 text-xs text-dls-secondary">
                      <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
                        {tr("knowledge.docs_count").replace("{count}", item.documentCount.toLocaleString())}
                      </div>
                      <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
                        {tr("knowledge.chunks_count").replace("{count}", item.chunkCount.toLocaleString())}
                      </div>
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
