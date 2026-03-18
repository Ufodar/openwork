import { For, Show } from "solid-js";
import { Database, Link2, X } from "lucide-solid";
import Button from "./button";
import type { OpenworkRagflowStatus } from "../lib/openwork-server";

export type SessionKnowledgeStripProps = {
  sessionId: string | null;
  status: OpenworkRagflowStatus | null;
  busy: boolean;
  selectedDatasets: { id: string; name: string }[];
  retrievalError: string | null;
  onOpen: () => void;
  onClear: () => void;
};

export default function SessionKnowledgeStrip(props: SessionKnowledgeStripProps) {
  const reason = () => props.status?.reason?.trim() ?? "";
  const retrievalError = () => props.retrievalError?.trim() ?? "";
  const disabled = () => !props.sessionId || props.busy;
  const selectedCount = () => props.selectedDatasets.length;

  return (
    <div class="mx-auto w-full max-w-[68ch] px-4">
      <div class="rounded-2xl border border-dls-border bg-dls-surface/80 px-4 py-3 shadow-sm shadow-gray-12/5">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 rounded-xl border border-dls-border bg-dls-hover/60 p-2 text-dls-secondary">
            <Database size={16} />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-sm font-semibold text-dls-text">Knowledge</div>
              <Show when={selectedCount() > 0}>
                <div class="rounded-full border border-dls-border bg-dls-hover px-2 py-0.5 text-[11px] font-medium text-dls-secondary">
                  {selectedCount()} selected
                </div>
              </Show>
              <Show when={props.status?.available}>
                <Show
                  when={!retrievalError()}
                  fallback={
                    <div class="rounded-full border border-amber-7 bg-amber-3/60 px-2 py-0.5 text-[11px] font-medium text-amber-11">
                      Search error
                    </div>
                  }
                >
                  <div class="rounded-full border border-green-7 bg-green-3/60 px-2 py-0.5 text-[11px] font-medium text-green-11">
                    Ready
                  </div>
                </Show>
              </Show>
            </div>
            <div class="mt-1 text-xs leading-relaxed text-dls-secondary">
              <Show
                when={props.sessionId}
                fallback={"Create or open a session first, then attach one or more knowledge bases."}
              >
                <Show
                  when={props.status?.available}
                  fallback={reason() || "Knowledge search is not configured on this server yet."}
                >
                  <Show
                    when={retrievalError()}
                    fallback={
                      <Show
                        when={selectedCount() > 0}
                        fallback={"Select one or more RAGFlow datasets. OpenWork will search them automatically for each prompt in this session."}
                      >
                        OpenWork will search these datasets automatically for each prompt in this session.
                      </Show>
                    }
                  >
                    {`The last knowledge search failed and was skipped: ${retrievalError()}`}
                  </Show>
                </Show>
              </Show>
            </div>
            <Show when={selectedCount() > 0}>
              <div class="mt-3 flex flex-wrap gap-2">
                <For each={props.selectedDatasets}>
                  {(dataset) => (
                    <div class="inline-flex items-center gap-1.5 rounded-full border border-dls-border bg-dls-hover px-2.5 py-1 text-xs text-dls-text">
                      <Link2 size={11} class="text-dls-secondary" />
                      <span class="max-w-[180px] truncate" title={dataset.name}>
                        {dataset.name}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Button variant="outline" class="h-9 px-3 text-xs" onClick={props.onOpen} disabled={disabled()}>
              {selectedCount() > 0 ? "Change" : "Select"}
            </Button>
            <Show when={selectedCount() > 0}>
              <Button
                variant="ghost"
                class="h-9 w-9 !px-0 text-dls-secondary"
                onClick={props.onClear}
                title="Clear selected knowledge bases"
              >
                <X size={14} />
              </Button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
