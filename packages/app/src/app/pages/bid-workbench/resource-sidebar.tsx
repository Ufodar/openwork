import { For, Show } from "solid-js";
import { FolderPlus, FolderTree, Files, FileText, Package, Target } from "lucide-solid";

import type { OpenworkBidWorkbenchSourceType } from "../../lib/openwork-server";
import {
  CATEGORY_LABELS,
  FILE_CATEGORY_ROOTS,
  displayFileName,
  displayPathTail,
  formatFileSize,
} from "./shared";
import type { BidWorkbenchFileCategory, BidWorkbenchWorkspaceFile } from "./shared";

const CATEGORY_ICONS = {
  tender: Target,
  reference: Files,
  output: FileText,
  templates: FolderTree,
} satisfies Record<BidWorkbenchFileCategory, typeof Target>;

type BidWorkbenchResourceSidebarProps = {
  categories: Array<{
    category: BidWorkbenchFileCategory;
    files: BidWorkbenchWorkspaceFile[];
  }>;
  activeCategory: BidWorkbenchFileCategory;
  uploading: boolean;
  currentOutlineSourcePath: string | null | undefined;
  currentRootOutputPath: string | null | undefined;
  onSelectCategory: (category: BidWorkbenchFileCategory) => void;
  onUpload: (category: BidWorkbenchFileCategory, files: FileList | null) => void | Promise<void>;
  onSetOutlineSource: (path: string, sourceType: OpenworkBidWorkbenchSourceType) => void | Promise<void>;
  onSetRootOutput: (path: string | null) => void | Promise<void>;
};

export default function BidWorkbenchResourceSidebar(props: BidWorkbenchResourceSidebarProps) {
  const activeFiles = () =>
    props.categories.find((item) => item.category === props.activeCategory)?.files ?? [];

  return (
    <div class="flex h-full min-h-0 flex-col bg-dls-surface/60">
      <div class="border-b border-dls-border px-3 py-3">
        <div class="text-sm font-semibold">资源导航</div>
        <div class="mt-1 text-xs text-dls-secondary">
          只保留一个活跃资源视图，避免四类文件同时挤压工作台。
        </div>
      </div>

      <div class="border-b border-dls-border px-3 py-3">
        <div class="grid grid-cols-2 gap-2">
          <For each={props.categories}>
            {(entry) => {
              const Icon = CATEGORY_ICONS[entry.category];
              const active = () => props.activeCategory === entry.category;
              return (
                <button
                  class={`rounded-xl border px-3 py-3 text-left transition-colors ${
                    active()
                      ? "border-dls-accent bg-dls-hover text-dls-text"
                      : "border-dls-border bg-dls-background text-dls-secondary hover:text-dls-text"
                  }`}
                  onClick={() => props.onSelectCategory(entry.category)}
                >
                  <div class="flex items-center gap-2">
                    <Icon size={14} />
                    <div class="truncate text-xs font-medium">{CATEGORY_LABELS[entry.category]}</div>
                  </div>
                  <div class="mt-2 flex items-center justify-between text-[11px]">
                    <span class="truncate">{displayPathTail(FILE_CATEGORY_ROOTS[entry.category])}</span>
                    <span class="rounded-full bg-dls-surface px-2 py-0.5 text-dls-text">
                      {entry.files.length}
                    </span>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </div>

      <div class="border-b border-dls-border px-3 py-3">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-xs font-medium">{CATEGORY_LABELS[props.activeCategory]}</div>
            <div class="mt-1 text-[11px] text-dls-secondary">{FILE_CATEGORY_ROOTS[props.activeCategory]}</div>
          </div>
          <span class="rounded-full bg-dls-background px-2 py-1 text-[11px] text-dls-secondary">
            {activeFiles().length} 个
          </span>
        </div>
        <div class="mt-3 flex items-center gap-2">
          <label class="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border border-dls-border bg-dls-hover px-2 py-2 text-[11px] text-dls-text">
            <FolderPlus size={12} />
            上传文件
            <input
              type="file"
              multiple
              class="hidden"
              onChange={(event) => {
                const input = event.currentTarget;
                void Promise.resolve(props.onUpload(props.activeCategory, input.files)).finally(() => {
                  input.value = "";
                });
              }}
            />
          </label>
          <label class="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border border-dls-border bg-dls-hover px-2 py-2 text-[11px] text-dls-text">
            <FolderPlus size={12} />
            上传目录
            <input
              type="file"
              multiple
              class="hidden"
              ref={(element) => {
                element.setAttribute("webkitdirectory", "");
                element.setAttribute("directory", "");
              }}
              onChange={(event) => {
                const input = event.currentTarget;
                void Promise.resolve(props.onUpload(props.activeCategory, input.files)).finally(() => {
                  input.value = "";
                });
              }}
            />
          </label>
        </div>
        <Show when={props.uploading}>
          <div class="mt-2 rounded-lg bg-dls-hover px-2 py-1 text-xs text-dls-secondary">上传中...</div>
        </Show>
      </div>

      <div class="min-h-0 flex-1 overflow-auto px-3 py-3">
        <div class="space-y-2">
          <For each={activeFiles()}>
            {(file) => {
              const path = () => file.path.trim();
              const isOutlineSource = () => props.currentOutlineSourcePath === path();
              const isRootOutput = () => props.currentRootOutputPath === path();
              return (
                <div class="rounded-xl border border-dls-border bg-dls-background px-3 py-3">
                  <div class="truncate text-xs font-medium">{displayFileName(path())}</div>
                  <div class="mt-1 truncate text-[11px] text-dls-secondary">{displayPathTail(path(), 3)}</div>
                  <div class="mt-2 flex items-center justify-between gap-2 text-[11px] text-dls-secondary">
                    <span>{formatFileSize(file.size)}</span>
                    <div class="flex items-center gap-2">
                      <button
                        class={`rounded-md px-2 py-1 ${
                          isOutlineSource()
                            ? "bg-dls-accent text-white"
                            : "border border-dls-border bg-dls-hover text-dls-text"
                        }`}
                        onClick={() =>
                          void props.onSetOutlineSource(path(), props.activeCategory as OpenworkBidWorkbenchSourceType)
                        }
                      >
                        {isOutlineSource() ? "章节主源" : "设为主源"}
                      </button>
                      <Show when={props.activeCategory === "output"}>
                        <button
                          class={`rounded-md px-2 py-1 ${
                            isRootOutput()
                              ? "bg-emerald-6 text-white"
                              : "border border-dls-border bg-dls-hover text-dls-text"
                          }`}
                          onClick={() => void props.onSetRootOutput(isRootOutput() ? null : path())}
                        >
                          {isRootOutput() ? "总文档" : "设为总文档"}
                        </button>
                      </Show>
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={activeFiles().length === 0}>
            <div class="rounded-xl border border-dashed border-dls-border bg-dls-background px-3 py-6 text-center text-xs text-dls-secondary">
              当前资源分类还没有文件
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
