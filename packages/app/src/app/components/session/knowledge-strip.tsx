import { For, Show } from "solid-js";

import { BookOpen, Loader2 } from "lucide-solid";

import Button from "../button";
import type { OpenworkKnowledgeItem } from "../../lib/openwork-server";

export type KnowledgeStripProps = {
  attachedItems: OpenworkKnowledgeItem[];
  loading: boolean;
  error: string | null;
  editingLocked: boolean;
  onManage: () => void;
  tr: (key: string) => string;
};

export default function KnowledgeStrip(props: KnowledgeStripProps) {
  const selectedCountLabel = () =>
    props.tr("session.knowledge_selected_count").replace("{count}", props.attachedItems.length.toLocaleString());

  return (
    <div class="mx-auto w-full max-w-[68ch] px-4 pt-3">
      <div class="rounded-2xl border border-dls-border bg-dls-sidebar/70 shadow-sm shadow-gray-12/5">
        <div class="flex items-start justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-dls-secondary">
              <BookOpen size={14} />
              <span>{props.tr("session.knowledge")}</span>
            </div>
            <div class="mt-1 text-sm font-medium text-dls-text">
              <Show when={props.attachedItems.length > 0} fallback={props.tr("session.knowledge_empty_title")}>
                {selectedCountLabel()}
              </Show>
            </div>
            <Show when={props.editingLocked}>
              <div class="mt-1 text-xs text-amber-11">{props.tr("session.knowledge_edit_locked")}</div>
            </Show>
          </div>

          <Button variant="outline" class="h-8 shrink-0 px-3 py-0 text-xs" onClick={props.onManage}>
            {props.tr("session.knowledge_manage")}
          </Button>
        </div>

        <div class="border-t border-dls-border px-4 py-3">
          <Show
            when={!props.loading}
            fallback={
              <div class="flex items-center gap-2 text-sm text-dls-secondary">
                <Loader2 size={14} class="animate-spin" />
                <span>{props.tr("session.knowledge_loading")}</span>
              </div>
            }
          >
            <Show when={!props.error} fallback={<div class="text-sm text-red-11">{props.error}</div>}>
              <Show
                when={props.attachedItems.length > 0}
                fallback={<div class="text-sm text-dls-secondary">{props.tr("session.knowledge_empty_body")}</div>}
              >
                <div class="flex flex-wrap gap-2">
                  <For each={props.attachedItems}>
                    {(item) => (
                      <div class="inline-flex max-w-full items-center gap-2 rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text">
                        <span class="truncate font-medium">{item.title}</span>
                        <Show when={item.ownerDisplayName}>
                          <span class="shrink-0 rounded-full bg-dls-hover px-2 py-0.5 text-[10px] text-dls-secondary">
                            {item.ownerDisplayName}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
