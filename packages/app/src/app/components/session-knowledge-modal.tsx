import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Search, X } from "lucide-solid";
import Button from "./button";
import type { OpenworkRagflowDataset, OpenworkRagflowStatus } from "../lib/openwork-server";

export type SessionKnowledgeModalProps = {
  open: boolean;
  status: OpenworkRagflowStatus | null;
  busy: boolean;
  datasets: OpenworkRagflowDataset[];
  error: string | null;
  query: string;
  setQuery: (value: string) => void;
  selectedDatasetIds: string[];
  onClose: () => void;
  onSave: (selection: { datasetIds: string[]; datasetNames: string[] }) => Promise<void> | void;
};

export default function SessionKnowledgeModal(props: SessionKnowledgeModalProps) {
  const [draftIds, setDraftIds] = createSignal<string[]>(props.selectedDatasetIds);
  const [saving, setSaving] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    setDraftIds(props.selectedDatasetIds);
  });

  const filteredDatasets = createMemo(() => {
    const query = props.query.trim().toLowerCase();
    const selected = new Set(draftIds());
    const ranked = [...props.datasets].sort((a, b) => {
      const aSelected = selected.has(a.id) ? 1 : 0;
      const bSelected = selected.has(b.id) ? 1 : 0;
      if (aSelected !== bSelected) return bSelected - aSelected;
      return a.name.localeCompare(b.name);
    });
    if (!query) return ranked;
    return ranked.filter((dataset) => {
      const haystack = [dataset.name, dataset.description, dataset.embeddingModel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  });

  const toggleDataset = (id: string) => {
    setDraftIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return [...next];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const selected = new Set(draftIds());
      const selectedDatasets = props.datasets.filter((dataset) => selected.has(dataset.id));
      await props.onSave({
        datasetIds: selectedDatasets.map((dataset) => dataset.id),
        datasetNames: selectedDatasets.map((dataset) => dataset.name),
      });
      props.onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
        <div class="w-full max-w-3xl rounded-3xl border border-dls-border bg-dls-sidebar shadow-2xl shadow-black/10">
          <div class="flex items-start justify-between gap-4 border-b border-dls-border px-6 py-5">
            <div>
              <div class="text-lg font-semibold text-dls-text">Attach knowledge bases</div>
              <div class="mt-1 text-sm text-dls-secondary">
                Pick one or more RAGFlow datasets. OpenWork will search them automatically for each prompt in this session.
              </div>
            </div>
            <Button variant="ghost" class="h-9 w-9 !px-0 rounded-full" onClick={props.onClose} title="Close">
              <X size={16} />
            </Button>
          </div>

          <div class="space-y-4 px-6 py-5">
            <Show when={props.status?.available} fallback={
              <div class="rounded-2xl border border-amber-7 bg-amber-3/60 px-4 py-3 text-sm text-amber-11">
                {props.status?.reason ?? "Knowledge search is not configured on this server."}
              </div>
            }>
              <label class="flex items-center gap-3 rounded-2xl border border-dls-border bg-dls-surface px-4 py-3">
                <Search size={16} class="text-dls-secondary" />
                <input
                  value={props.query}
                  onInput={(event) => props.setQuery(event.currentTarget.value)}
                  placeholder="Search datasets"
                  class="w-full bg-transparent text-sm text-dls-text outline-none placeholder:text-dls-secondary"
                />
              </label>

              <Show when={props.error}>
                <div class="rounded-2xl border border-red-7 bg-red-3/60 px-4 py-3 text-sm text-red-11">
                  {props.error}
                </div>
              </Show>

              <div class="max-h-[50vh] overflow-y-auto rounded-2xl border border-dls-border bg-dls-surface/70">
                <Show
                  when={!props.busy}
                  fallback={<div class="px-4 py-8 text-center text-sm text-dls-secondary">Loading datasets…</div>}
                >
                  <Show
                    when={filteredDatasets().length > 0}
                    fallback={<div class="px-4 py-8 text-center text-sm text-dls-secondary">No datasets matched this search.</div>}
                  >
                    <div class="divide-y divide-dls-border">
                      <For each={filteredDatasets()}>
                        {(dataset) => {
                          const checked = () => draftIds().includes(dataset.id);
                          return (
                            <label class="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-dls-hover/70">
                              <input
                                type="checkbox"
                                checked={checked()}
                                onChange={() => toggleDataset(dataset.id)}
                                class="mt-1 h-4 w-4 rounded border-dls-border"
                              />
                              <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                  <div class="text-sm font-medium text-dls-text">{dataset.name}</div>
                                  <Show when={typeof dataset.documentCount === "number"}>
                                    <div class="rounded-full border border-dls-border bg-dls-hover px-2 py-0.5 text-[11px] text-dls-secondary">
                                      {dataset.documentCount} docs
                                    </div>
                                  </Show>
                                  <Show when={dataset.embeddingModel}>
                                    <div class="rounded-full border border-dls-border bg-dls-hover px-2 py-0.5 text-[11px] text-dls-secondary">
                                      {dataset.embeddingModel}
                                    </div>
                                  </Show>
                                </div>
                                <Show when={dataset.description}>
                                  <div class="mt-1 text-xs leading-relaxed text-dls-secondary">{dataset.description}</div>
                                </Show>
                              </div>
                            </label>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>
          </div>

          <div class="flex items-center justify-between gap-3 border-t border-dls-border px-6 py-4">
            <div class="text-sm text-dls-secondary">
              {draftIds().length > 0 ? `${draftIds().length} dataset(s) selected` : "No dataset selected"}
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setDraftIds([])}
                disabled={saving() || props.busy || !draftIds().length}
              >
                Clear
              </Button>
              <Button variant="outline" onClick={props.onClose} disabled={saving()}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving() || props.busy || !props.status?.available}>
                {saving() ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
