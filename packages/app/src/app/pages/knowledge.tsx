import { For, Show, createEffect, createSignal, on } from "solid-js";
import { Loader2, Plus, RefreshCw } from "lucide-solid";

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

export default function KnowledgeView(props: KnowledgeViewProps) {
  let uploadInputEl: HTMLInputElement | undefined;

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
      setError("Connect to an OpenWork server to manage knowledge bases.");
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
      setError(nextError instanceof Error ? nextError.message : "Failed to load knowledge bases.");
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
      setCreateError("Enter a name for the knowledge base.");
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
      setCreateError(nextError instanceof Error ? nextError.message : "Failed to create the knowledge base.");
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
      setUploadError(nextError instanceof Error ? nextError.message : "Failed to upload knowledge files.");
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
            <div class="text-sm font-medium text-dls-secondary">Knowledge</div>
            <div class="text-2xl font-semibold text-dls-text">Manage session-external knowledge bases</div>
            <div class="max-w-2xl text-sm leading-6 text-dls-secondary">
              Create reusable knowledge bases outside sessions, upload source files, then attach one or more knowledge
              bases inside a session when retrieval is needed.
            </div>
            <div class="text-xs text-dls-secondary">
              Default parsing uses RAGFlow general chunking with a chunk size of 2000.
            </div>
          </div>
          <Button variant="outline" onClick={() => void loadKnowledge()} disabled={loading()}>
            <Show when={loading()} fallback={<RefreshCw size={14} />}>
              <Loader2 size={14} class="animate-spin" />
            </Show>
            <span class="ml-2">Refresh</span>
          </Button>
        </div>
      </div>

      <div class="rounded-3xl border border-dls-border bg-dls-surface p-6 shadow-sm space-y-4">
        <div>
          <div class="text-lg font-semibold text-dls-text">Create a knowledge base</div>
          <div class="mt-1 text-sm text-dls-secondary">
            Knowledge bases are owned in OpenWork by user, even though the current server uses one shared RAGFlow API key.
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label class="space-y-2">
            <div class="text-xs font-medium uppercase tracking-wide text-dls-secondary">Name</div>
            <input
              value={createTitle()}
              onInput={(event) => setCreateTitle(event.currentTarget.value)}
              placeholder="For example: Commercial qualifications"
              class="w-full rounded-2xl border border-dls-border bg-dls-background px-4 py-3 text-sm text-dls-text outline-none transition focus:border-dls-accent"
            />
          </label>
          <label class="space-y-2">
            <div class="text-xs font-medium uppercase tracking-wide text-dls-secondary">Description</div>
            <input
              value={createDescription()}
              onInput={(event) => setCreateDescription(event.currentTarget.value)}
              placeholder="Optional note for teammates"
              class="w-full rounded-2xl border border-dls-border bg-dls-background px-4 py-3 text-sm text-dls-text outline-none transition focus:border-dls-accent"
            />
          </label>
          <div class="flex items-end">
            <Button onClick={() => void handleCreateKnowledge()} disabled={createBusy()}>
              <Show when={createBusy()} fallback={<Plus size={14} />}>
                <Loader2 size={14} class="animate-spin" />
              </Show>
              <span class="ml-2">{createBusy() ? "Creating..." : "Create"}</span>
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
            <div class="text-lg font-semibold text-dls-text">My knowledge bases</div>
            <div class="mt-1 text-sm text-dls-secondary">
              Upload files here, then attach the knowledge base inside any session.
            </div>
          </div>
          <Show
            when={mineItems().length > 0}
            fallback={<div class="rounded-2xl border border-dls-border bg-dls-background px-4 py-6 text-sm text-dls-secondary">No knowledge bases yet in {props.workspaceName}.</div>}
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
                        {item.status}
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2 text-xs text-dls-secondary">
                      <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
                        {item.documentCount} docs
                      </div>
                      <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
                        {item.chunkCount} chunks
                      </div>
                      <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
                        {item.chunkMethod || "naive"}
                      </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => openUploadPicker(item.knowledgeId)}
                        disabled={uploadBusyKnowledgeId() === item.knowledgeId}
                      >
                        <Show when={uploadBusyKnowledgeId() === item.knowledgeId} fallback={<>Upload files</>}>
                          <span class="inline-flex items-center gap-2">
                            <Loader2 size={14} class="animate-spin" />
                            Uploading...
                          </span>
                        </Show>
                      </Button>
                      <div class="text-xs text-dls-secondary">
                        Files stay session-external. Sessions only attach knowledge scopes, they do not create hidden datasets.
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
            <div class="text-lg font-semibold text-dls-text">Others</div>
            <div class="mt-1 text-sm text-dls-secondary">
              These knowledge bases are visible for attachment in sessions. Ownership is shown so users know whose corpus they are using.
            </div>
          </div>
          <Show
            when={othersItems().length > 0}
            fallback={<div class="rounded-2xl border border-dls-border bg-dls-background px-4 py-6 text-sm text-dls-secondary">No shared knowledge bases are visible yet.</div>}
          >
            <div class="space-y-3">
              <For each={othersItems()}>
                {(item) => (
                  <div class="rounded-2xl border border-dls-border bg-dls-background p-4 space-y-3">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="space-y-1">
                        <div class="text-base font-semibold text-dls-text">{item.title}</div>
                        <div class="text-xs text-dls-secondary">Owner: {item.ownerDisplayName}</div>
                        <Show when={item.description}>
                          <div class="text-sm text-dls-secondary">{item.description}</div>
                        </Show>
                      </div>
                      <div class={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(item.status)}`}>
                        {item.status}
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2 text-xs text-dls-secondary">
                      <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
                        {item.documentCount} docs
                      </div>
                      <div class="rounded-full border border-dls-border bg-dls-hover px-2.5 py-1">
                        {item.chunkCount} chunks
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
