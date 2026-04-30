import { For, Show } from "solid-js";
import { FolderPlus } from "lucide-solid";

import type { OpenworkBidWorkbenchSourceType, OpenworkInboxItem } from "../../lib/openwork-server";
import { CATEGORY_LABELS, FILE_CATEGORY_ROOTS } from "./shared";
import type { BidWorkbenchFileCategory } from "./shared";

type BidWorkbenchFileCategoryPanelProps = {
  category: BidWorkbenchFileCategory;
  files: OpenworkInboxItem[];
  uploading: boolean;
  currentOutlineSourcePath: string | null | undefined;
  currentRootOutputPath: string | null | undefined;
  displayInboxPath: (file: OpenworkInboxItem) => string;
  onUpload: (category: BidWorkbenchFileCategory, files: FileList | null) => void | Promise<void>;
  onSetOutlineSource: (path: string, sourceType: OpenworkBidWorkbenchSourceType) => void | Promise<void>;
  onSetRootOutput: (path: string | null) => void | Promise<void>;
};

export default function BidWorkbenchFileCategoryPanel(props: BidWorkbenchFileCategoryPanelProps) {
  return (
    <section class="rounded-2xl border border-dls-border bg-dls-surface p-3">
      <div class="mb-3 flex items-center justify-between gap-2">
        <div>
          <div class="text-sm font-semibold">{CATEGORY_LABELS[props.category]}</div>
          <div class="text-[11px] text-dls-secondary">{FILE_CATEGORY_ROOTS[props.category]}</div>
        </div>
        <div class="flex items-center gap-2">
          <label class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dls-border bg-dls-hover px-2 py-1 text-[11px] text-dls-text">
            <FolderPlus size={12} />
            上传文件
            <input type="file" multiple class="hidden" onChange={(event) => void props.onUpload(props.category, event.currentTarget.files)} />
          </label>
          <label class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dls-border bg-dls-hover px-2 py-1 text-[11px] text-dls-text">
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
              onChange={(event) => void props.onUpload(props.category, event.currentTarget.files)}
            />
          </label>
        </div>
      </div>

      <Show when={props.uploading}>
        <div class="mb-2 rounded-lg bg-dls-hover px-2 py-1 text-xs text-dls-secondary">上传中...</div>
      </Show>

      <div class="space-y-2 text-xs">
        <For each={props.files}>
          {(file) => {
            const path = () => props.displayInboxPath(file);
            const isOutlineSource = () => props.currentOutlineSourcePath === path();
            const isRootOutput = () => props.currentRootOutputPath === path();
            return (
              <div class="rounded-lg border border-dls-border bg-dls-background px-2 py-2">
                <div class="truncate font-medium">{path()}</div>
                <div class="mt-1 flex items-center justify-between gap-2 text-[11px] text-dls-secondary">
                  <span>{file.size ?? 0} B</span>
                  <div class="flex items-center gap-2">
                    <button
                      class={`rounded-md px-2 py-1 ${
                        isOutlineSource()
                          ? "bg-dls-accent text-white"
                          : "border border-dls-border bg-dls-hover text-dls-text"
                      }`}
                      onClick={() => void props.onSetOutlineSource(path(), props.category as OpenworkBidWorkbenchSourceType)}
                    >
                      {isOutlineSource() ? "章节主源" : "设为主源"}
                    </button>
                    <Show when={props.category === "output"}>
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
        <Show when={props.files.length === 0}>
          <div class="rounded-lg border border-dashed border-dls-border px-2 py-3 text-dls-secondary">暂无文件</div>
        </Show>
      </div>
    </section>
  );
}
