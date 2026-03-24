import { For, Show } from "solid-js";

import { BookOpen, ChevronDown, ChevronRight, Loader2 } from "lucide-solid";

import Button from "../button";
import type { OpenworkKnowledgeItem } from "../../lib/openwork-server";

export type KnowledgeStripProps = {
  attachedItems: OpenworkKnowledgeItem[];
  loading: boolean;
  error: string | null;
  editingLocked: boolean;
  expanded: boolean;
  onManage: () => void;
  onToggle: () => void;
  tr: (key: string) => string;
};

export default function KnowledgeStrip(props: KnowledgeStripProps) {
  const selectedCountLabel = () =>
    props.tr("session.knowledge_selected_count").replace("{count}", props.attachedItems.length.toLocaleString());
  const showInlineRefresh = () => props.loading && props.attachedItems.length > 0 && !props.error;

  return (
    <div class="mx-auto w-full max-w-[68ch] px-4 pt-3">
      <div class="rounded-2xl border border-dls-border bg-dls-sidebar/70 shadow-sm shadow-gray-12/5">
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-3 text-left"
            onClick={props.onToggle}
            aria-expanded={props.expanded}
            title={props.expanded ? props.tr("dashboard.collapse") : props.tr("dashboard.expand")}
          >
            <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dls-border bg-dls-surface text-dls-secondary">
              <BookOpen size={16} />
            </span>
            <div class="min-w-0">
              <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-dls-secondary">
                <span>{props.tr("session.knowledge")}</span>
                <Show when={showInlineRefresh()}>
                  <span class="inline-flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal text-dls-secondary">
                    <Loader2 size={11} class="animate-spin" />
                    <span>{props.tr("session.knowledge_loading")}</span>
                  </span>
                </Show>
              </div>
              <div class="mt-1 flex items-center gap-2 text-sm font-medium text-dls-text">
                <Show when={props.attachedItems.length > 0} fallback={props.tr("session.knowledge_empty_title")}>
                  {selectedCountLabel()}
                </Show>
              </div>
              <Show when={props.error && !props.expanded}>
                <div class="mt-1 line-clamp-1 text-xs text-red-11">{props.error}</div>
              </Show>
            </div>
          </button>

          <div class="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              class="h-8 px-3 py-0 text-xs"
              onClick={props.onManage}
              disabled={props.editingLocked}
            >
              {props.tr("session.knowledge_manage")}
            </Button>
            <Button
              variant="ghost"
              class="h-8 w-8 rounded-full !px-0 !py-0 text-dls-secondary"
              onClick={props.onToggle}
              title={props.expanded ? props.tr("dashboard.collapse") : props.tr("dashboard.expand")}
            >
              <Show when={props.expanded} fallback={<ChevronRight size={16} />}>
                <ChevronDown size={16} />
              </Show>
            </Button>
          </div>
        </div>

        <Show when={props.expanded}>
          <div class="border-t border-dls-border px-4 py-3">
            <Show when={!props.error} fallback={<div class="text-sm text-red-11">{props.error}</div>}>
              <Show when={props.editingLocked}>
                <div class="mb-3 text-xs text-amber-11">{props.tr("session.knowledge_edit_locked")}</div>
              </Show>
              <Show when={props.attachedItems.length > 0}>
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
              <Show when={props.loading && props.attachedItems.length === 0}>
                <div class="flex items-center gap-2 text-sm text-dls-secondary">
                  <Loader2 size={14} class="animate-spin" />
                  <span>{props.tr("session.knowledge_loading")}</span>
                </div>
              </Show>
              <Show when={!props.loading && props.attachedItems.length === 0}>
                <div class="text-sm text-dls-secondary">{props.tr("session.knowledge_empty_body")}</div>
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
