import { For, Show, createEffect, createMemo } from "solid-js";

import { BookOpen, Check, Loader2, X } from "lucide-solid";

import Button from "../button";
import type { OpenworkKnowledgeItem, OpenworkKnowledgeScope } from "../../lib/openwork-server";

export type KnowledgePickerModalProps = {
  open: boolean;
  scope: OpenworkKnowledgeScope;
  selectedIds: string[];
  selectedItems: OpenworkKnowledgeItem[];
  mineItems: OpenworkKnowledgeItem[];
  othersItems: OpenworkKnowledgeItem[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveDisabled: boolean;
  editingLocked: boolean;
  onScopeChange: (scope: OpenworkKnowledgeScope) => void;
  onToggle: (knowledgeId: string, checked: boolean) => void;
  onClose: () => void;
  onSave: () => void;
  tr: (key: string) => string;
};

function formatKnowledgeMeta(item: OpenworkKnowledgeItem, tr: (key: string) => string) {
  if (item.documentCount > 0 || item.chunkCount > 0) {
    return tr("session.knowledge_docs_chunks")
      .replace("{docs}", item.documentCount.toLocaleString())
      .replace("{chunks}", item.chunkCount.toLocaleString());
  }
  return item.status;
}

export default function KnowledgePickerModal(props: KnowledgePickerModalProps) {
  const activeItems = createMemo(() => (props.scope === "others" ? props.othersItems : props.mineItems));
  const title = createMemo(() =>
    props.scope === "others"
      ? props.tr("session.knowledge_picker_empty_others")
      : props.tr("session.knowledge_picker_empty_mine"),
  );

  createEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!props.open) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 bg-gray-1/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
        <div class="bg-gray-2 border border-gray-6/70 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col">
          <div class="p-6 border-b border-gray-6/70 flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-dls-secondary">
                <BookOpen size={14} />
                <span>{props.tr("session.knowledge")}</span>
              </div>
              <h3 class="mt-2 text-lg font-semibold text-dls-text">
                {props.tr("session.knowledge_picker_title")}
              </h3>
              <p class="mt-1 text-sm text-dls-secondary">
                {props.tr("session.knowledge_picker_description")}
              </p>
            </div>

            <Button variant="ghost" class="!p-2 rounded-full shrink-0" onClick={props.onClose}>
              <X size={16} />
            </Button>
          </div>

          <div class="flex-1 overflow-y-auto p-6 space-y-5">
            <Show when={props.editingLocked}>
              <div class="rounded-xl border border-amber-7/40 bg-amber-3/30 px-4 py-3 text-sm text-amber-11">
                {props.tr("session.knowledge_edit_locked")}
              </div>
            </Show>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  props.scope === "mine"
                    ? "bg-dls-active text-dls-text"
                    : "bg-dls-surface text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                }`}
                onClick={() => props.onScopeChange("mine")}
              >
                {props.tr("session.knowledge_picker_scope_mine")}
              </button>
              <button
                type="button"
                class={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  props.scope === "others"
                    ? "bg-dls-active text-dls-text"
                    : "bg-dls-surface text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                }`}
                onClick={() => props.onScopeChange("others")}
              >
                {props.tr("session.knowledge_picker_scope_others")}
              </button>
            </div>

            <div class="space-y-3">
              <div class="text-xs font-semibold uppercase tracking-[0.16em] text-dls-secondary">
                {props.tr("session.knowledge_picker_selected")}
              </div>
              <Show
                when={props.selectedItems.length > 0}
                fallback={<div class="text-sm text-dls-secondary">{props.tr("session.knowledge_picker_none_selected")}</div>}
              >
                <div class="flex flex-wrap gap-2">
                  <For each={props.selectedItems}>
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
            </div>

            <Show when={!props.error} fallback={<div class="text-sm text-red-11">{props.error}</div>}>
              <Show
                when={!props.loading}
                fallback={
                  <div class="flex items-center gap-2 rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-sm text-dls-secondary">
                    <Loader2 size={14} class="animate-spin" />
                    <span>{props.tr("session.knowledge_picker_loading")}</span>
                  </div>
                }
              >
                <Show
                  when={activeItems().length > 0}
                  fallback={
                    <div class="rounded-2xl border border-dls-border bg-dls-surface px-4 py-6 text-center text-sm text-dls-secondary">
                      {title()}
                    </div>
                  }
                >
                  <div class="space-y-3">
                    <For each={activeItems()}>
                      {(item) => {
                        const checked = () => props.selectedIds.includes(item.knowledgeId);
                        return (
                          <label class="flex items-start gap-3 rounded-2xl border border-dls-border bg-dls-surface px-4 py-3 text-left transition-colors hover:bg-dls-hover/50">
                            <input
                              type="checkbox"
                              checked={checked()}
                              disabled={props.editingLocked || props.saving}
                              onChange={(event) => props.onToggle(item.knowledgeId, event.currentTarget.checked)}
                              class="mt-1 h-4 w-4 rounded border-dls-border bg-transparent text-dls-accent focus:ring-[rgba(var(--dls-accent-rgb),0.2)]"
                            />
                            <div class="min-w-0 flex-1">
                              <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                  <div class="text-sm font-medium text-dls-text truncate">{item.title}</div>
                                  <Show when={item.description}>
                                    <div class="mt-1 text-xs text-dls-secondary line-clamp-2">{item.description}</div>
                                  </Show>
                                </div>
                                <Show when={checked()}>
                                  <span class="shrink-0 rounded-full bg-green-3 px-2 py-0.5 text-[10px] font-medium text-green-11">
                                    <Check size={12} />
                                  </span>
                                </Show>
                              </div>

                              <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-dls-secondary">
                                <span>{formatKnowledgeMeta(item, props.tr)}</span>
                                <Show when={props.scope === "others" && item.ownerDisplayName}>
                                  <span class="rounded-full bg-dls-hover px-2 py-0.5">
                                    {props.tr("session.knowledge_picker_owner").replace("{name}", item.ownerDisplayName)}
                                  </span>
                                </Show>
                              </div>
                            </div>
                          </label>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>

          <div class="border-t border-gray-6/70 bg-gray-1/40 px-6 py-4 flex items-center justify-between gap-3">
            <div class="text-xs text-dls-secondary">
              {props.tr("session.knowledge_selected_count").replace("{count}", props.selectedItems.length.toLocaleString())}
            </div>
            <div class="flex items-center gap-2">
              <Button variant="outline" onClick={props.onClose}>
                {props.tr("session.knowledge_picker_cancel")}
              </Button>
              <Button onClick={props.onSave} disabled={props.saveDisabled}>
                <Show when={props.saving} fallback={props.tr("session.knowledge_picker_apply")}>
                  <Loader2 size={14} class="animate-spin" />
                </Show>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
