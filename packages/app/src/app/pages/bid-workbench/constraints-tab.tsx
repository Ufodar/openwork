import { For, createEffect, createMemo, createSignal } from "solid-js";

import type { OpenworkBidWorkbenchConstraints, OpenworkInboxItem } from "../../lib/openwork-server";

type BidWorkbenchConstraintsTabProps = {
  constraints: OpenworkBidWorkbenchConstraints;
  sourceFiles: OpenworkInboxItem[];
  displayInboxPath: (file: OpenworkInboxItem) => string;
  onSave: (payload: {
    formatRules: Record<string, unknown>;
    extractedFromPath: string | null;
  }) => void | Promise<void>;
};

function numberDraftFromValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export default function BidWorkbenchConstraintsTab(props: BidWorkbenchConstraintsTabProps) {
  const [extractedFromPath, setExtractedFromPath] = createSignal("");
  const [bodyFontFamily, setBodyFontFamily] = createSignal("");
  const [bodyFontSizePt, setBodyFontSizePt] = createSignal("");
  const [headingFontFamily, setHeadingFontFamily] = createSignal("");
  const [headingFontSizePt, setHeadingFontSizePt] = createSignal("");
  const [lineSpacing, setLineSpacing] = createSignal("");
  const [pageMarginTopMm, setPageMarginTopMm] = createSignal("");
  const [pageMarginBottomMm, setPageMarginBottomMm] = createSignal("");
  const [pageMarginLeftMm, setPageMarginLeftMm] = createSignal("");
  const [pageMarginRightMm, setPageMarginRightMm] = createSignal("");
  const [notes, setNotes] = createSignal("");

  const sourceOptions = createMemo(() =>
    props.sourceFiles.map((file) => props.displayInboxPath(file)),
  );

  createEffect(() => {
    const rules = props.constraints.formatRules ?? {};
    setExtractedFromPath(props.constraints.extractedFromPath ?? sourceOptions()[0] ?? "");
    setBodyFontFamily(typeof rules.bodyFontFamily === "string" ? rules.bodyFontFamily : "");
    setBodyFontSizePt(numberDraftFromValue(rules.bodyFontSizePt));
    setHeadingFontFamily(typeof rules.headingFontFamily === "string" ? rules.headingFontFamily : "");
    setHeadingFontSizePt(numberDraftFromValue(rules.headingFontSizePt));
    setLineSpacing(numberDraftFromValue(rules.lineSpacing));
    setPageMarginTopMm(numberDraftFromValue(rules.pageMarginTopMm));
    setPageMarginBottomMm(numberDraftFromValue(rules.pageMarginBottomMm));
    setPageMarginLeftMm(numberDraftFromValue(rules.pageMarginLeftMm));
    setPageMarginRightMm(numberDraftFromValue(rules.pageMarginRightMm));
    setNotes(typeof rules.notes === "string" ? rules.notes : "");
  });

  const buildFormatRules = (): Record<string, unknown> => {
    const formatRules: Record<string, unknown> = {};
    const stringFields = [
      ["bodyFontFamily", bodyFontFamily().trim()],
      ["headingFontFamily", headingFontFamily().trim()],
      ["notes", notes().trim()],
    ] as const;
    for (const [key, value] of stringFields) {
      if (value) formatRules[key] = value;
    }

    const numericFields = [
      ["bodyFontSizePt", bodyFontSizePt().trim()],
      ["headingFontSizePt", headingFontSizePt().trim()],
      ["lineSpacing", lineSpacing().trim()],
      ["pageMarginTopMm", pageMarginTopMm().trim()],
      ["pageMarginBottomMm", pageMarginBottomMm().trim()],
      ["pageMarginLeftMm", pageMarginLeftMm().trim()],
      ["pageMarginRightMm", pageMarginRightMm().trim()],
    ] as const;
    for (const [key, value] of numericFields) {
      if (!value) continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) formatRules[key] = parsed;
    }

    return formatRules;
  };

  return (
    <div class="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section class="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <div class="text-sm font-semibold">全局格式约束</div>
        <div class="mt-1 text-xs text-dls-secondary">
          这里保存项目级格式规则，后续节点写作、合并和格式检查都以这里的约束为准。
        </div>

        <div class="mt-4 grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
          <label class="space-y-1">
            <div class="text-dls-secondary">样式来源文件</div>
            <select
              class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2"
              value={extractedFromPath()}
              onInput={(event) => setExtractedFromPath(event.currentTarget.value)}
            >
              <option value="">未指定</option>
              <For each={sourceOptions()}>{(path) => <option value={path}>{path}</option>}</For>
            </select>
          </label>
          <div class="rounded-xl bg-dls-background px-3 py-2">
            <div class="text-dls-secondary">最近更新</div>
            <div class="mt-1 font-medium text-dls-text">
              {props.constraints.updatedAt ? new Date(props.constraints.updatedAt).toLocaleString("zh-CN", { hour12: false }) : "未设置"}
            </div>
          </div>
          <label class="space-y-1">
            <div class="text-dls-secondary">正文字体</div>
            <input class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={bodyFontFamily()} onInput={(event) => setBodyFontFamily(event.currentTarget.value)} placeholder="例如：宋体" />
          </label>
          <label class="space-y-1">
            <div class="text-dls-secondary">正文字号（pt）</div>
            <input class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={bodyFontSizePt()} onInput={(event) => setBodyFontSizePt(event.currentTarget.value)} placeholder="例如：12" />
          </label>
          <label class="space-y-1">
            <div class="text-dls-secondary">标题字体</div>
            <input class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={headingFontFamily()} onInput={(event) => setHeadingFontFamily(event.currentTarget.value)} placeholder="例如：黑体" />
          </label>
          <label class="space-y-1">
            <div class="text-dls-secondary">标题字号（pt）</div>
            <input class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={headingFontSizePt()} onInput={(event) => setHeadingFontSizePt(event.currentTarget.value)} placeholder="例如：14" />
          </label>
          <label class="space-y-1">
            <div class="text-dls-secondary">行间距</div>
            <input class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={lineSpacing()} onInput={(event) => setLineSpacing(event.currentTarget.value)} placeholder="例如：1.5" />
          </label>
          <div />
          <label class="space-y-1">
            <div class="text-dls-secondary">上边距（mm）</div>
            <input class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={pageMarginTopMm()} onInput={(event) => setPageMarginTopMm(event.currentTarget.value)} placeholder="例如：25" />
          </label>
          <label class="space-y-1">
            <div class="text-dls-secondary">下边距（mm）</div>
            <input class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={pageMarginBottomMm()} onInput={(event) => setPageMarginBottomMm(event.currentTarget.value)} placeholder="例如：25" />
          </label>
          <label class="space-y-1">
            <div class="text-dls-secondary">左边距（mm）</div>
            <input class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={pageMarginLeftMm()} onInput={(event) => setPageMarginLeftMm(event.currentTarget.value)} placeholder="例如：30" />
          </label>
          <label class="space-y-1">
            <div class="text-dls-secondary">右边距（mm）</div>
            <input class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={pageMarginRightMm()} onInput={(event) => setPageMarginRightMm(event.currentTarget.value)} placeholder="例如：20" />
          </label>
        </div>

        <label class="mt-3 block space-y-1 text-xs">
          <div class="text-dls-secondary">补充说明</div>
          <textarea
            class="min-h-[120px] w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2"
            value={notes()}
            onInput={(event) => setNotes(event.currentTarget.value)}
            placeholder="记录不能被数字字段覆盖的格式要求，例如目录显示、表格边框、段前段后等。"
          />
        </label>

        <div class="mt-4 flex justify-end">
          <button
            class="rounded-lg border border-dls-border bg-dls-hover px-4 py-2 text-xs"
            onClick={() =>
              void props.onSave({
                formatRules: buildFormatRules(),
                extractedFromPath: extractedFromPath().trim() || null,
              })
            }
          >
            保存全局约束
          </button>
        </div>
      </section>

      <section class="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <div class="text-sm font-semibold">当前约束快照</div>
        <div class="mt-3 rounded-xl bg-dls-background p-3 text-xs text-dls-text">
          <pre class="overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(
              {
                extractedFromPath: props.constraints.extractedFromPath,
                formatRules: props.constraints.formatRules,
              },
              null,
              2,
            )}
          </pre>
        </div>
      </section>
    </div>
  );
}
