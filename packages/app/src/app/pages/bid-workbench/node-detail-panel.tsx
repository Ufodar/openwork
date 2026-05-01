import { For, Show } from "solid-js";
import {
  CheckCircle2,
  FileText,
  Folder,
  Lock,
  MessageSquarePlus,
  Unlock,
} from "lucide-solid";

import type {
  OpenworkBidWorkbenchCompositionMode,
  OpenworkBidWorkbenchMark,
  OpenworkBidWorkbenchNode,
  OpenworkBidWorkbenchSourceRange,
  OpenworkBidWorkbenchSourceRangeKind,
} from "../../lib/openwork-server";
import {
  type BidWorkbenchWorkspaceFile,
  COMPOSITION_MODE_LABELS,
  MARK_KIND_LABELS,
} from "./shared";

type BidWorkbenchNodeDetailPanelProps = {
  node: OpenworkBidWorkbenchNode;
  assigneeDraft: string;
  markDraft: string;
  markKind: OpenworkBidWorkbenchMark["kind"];
  marks: OpenworkBidWorkbenchMark[];
  rangeSourcePath: string;
  rangeKind: OpenworkBidWorkbenchSourceRangeKind;
  rangeValueDraft: string;
  rangeNoteDraft: string;
  referenceFiles: BidWorkbenchWorkspaceFile[];
  outputFiles: BidWorkbenchWorkspaceFile[];
  templateFiles: BidWorkbenchWorkspaceFile[];
  displayFilePath: (file: BidWorkbenchWorkspaceFile) => string;
  onSetAssigneeDraft: (value: string) => void;
  onSetMarkDraft: (value: string) => void;
  onSetMarkKind: (value: OpenworkBidWorkbenchMark["kind"]) => void;
  onSetRangeSourcePath: (value: string) => void;
  onSetRangeKind: (value: OpenworkBidWorkbenchSourceRangeKind) => void;
  onSetRangeValueDraft: (value: string) => void;
  onSetRangeNoteDraft: (value: string) => void;
  onToggleLock: (node: OpenworkBidWorkbenchNode) => void | Promise<void>;
  onUpdateNodeMetadata: (
    node: OpenworkBidWorkbenchNode,
    patch: {
      compositionMode?: OpenworkBidWorkbenchCompositionMode;
      assignee?: string | null;
    },
  ) => void | Promise<void>;
  onCreateNodeSession: (node: OpenworkBidWorkbenchNode) => void | Promise<void>;
  onMarkMerged: (node: OpenworkBidWorkbenchNode) => void | Promise<void>;
  onBindReference: (node: OpenworkBidWorkbenchNode, path: string) => void | Promise<void>;
  onBindOutput: (node: OpenworkBidWorkbenchNode, path: string) => void | Promise<void>;
  onBindTemplate: (node: OpenworkBidWorkbenchNode, path: string) => void | Promise<void>;
  onSetPrimaryOutput: (node: OpenworkBidWorkbenchNode, path: string) => void | Promise<void>;
  onAddRange: () => void | Promise<void>;
  onRemoveRange: (rangeId: string) => void | Promise<void>;
  onAddMark: () => void | Promise<void>;
  onRemoveMark: (markId: string) => void | Promise<void>;
};

export default function BidWorkbenchNodeDetailPanel(props: BidWorkbenchNodeDetailPanelProps) {
  const rangeSourceOptions = (): string[] => {
    const values = [props.node.sourcePath, ...props.node.referencePaths];
    if (props.node.templatePath) values.push(props.node.templatePath);
    return Array.from(new Set(values.filter(Boolean)));
  };

  return (
    <div class="space-y-5">
      <section class="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-base font-semibold">{props.node.title}</div>
            <div class="mt-1 text-xs text-dls-secondary">节点 ID：{props.node.id}</div>
          </div>
          <button class="inline-flex items-center gap-1 rounded-lg border border-dls-border bg-dls-hover px-2 py-1 text-xs" onClick={() => void props.onToggleLock(props.node)}>
            <Show when={props.node.lockedBy} fallback={<Unlock size={12} />}><Lock size={12} /></Show>
            {props.node.lockedBy ? "解锁" : "上锁"}
          </button>
        </div>

        <div class="mt-4 flex flex-wrap gap-2 text-[11px]">
          <span class="rounded-full bg-dls-background px-3 py-1">节点：{props.node.isLeaf ? "叶子" : "目录"}</span>
          <span class="rounded-full bg-dls-background px-3 py-1">当前编辑：{props.node.lockedBy ?? "未锁定"}</span>
          <span class="rounded-full bg-dls-background px-3 py-1">会话：{props.node.activeSessionId ?? props.node.sessionId ? "已绑定" : "未创建"}</span>
          <span class="rounded-full bg-dls-background px-3 py-1">合并：{props.node.mergeApplied ? "已合并" : props.node.mergeRequested ? "待合并" : "未登记"}</span>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-3 text-xs">
          <label class="space-y-1">
            <div class="text-dls-secondary">生成模式</div>
            <select class="w-full rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={props.node.compositionMode} onInput={(event) => void props.onUpdateNodeMetadata(props.node, { compositionMode: event.currentTarget.value as OpenworkBidWorkbenchCompositionMode })}>
              <For each={Object.entries(COMPOSITION_MODE_LABELS) as Array<[OpenworkBidWorkbenchCompositionMode, string]>}>
                {([value, label]) => <option value={value}>{label}</option>}
              </For>
            </select>
          </label>
          <label class="space-y-1">
            <div class="text-dls-secondary">负责人</div>
            <div class="flex gap-2">
              <input class="flex-1 rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={props.assigneeDraft} onInput={(event) => props.onSetAssigneeDraft(event.currentTarget.value)} placeholder="填写负责人" />
              <button class="rounded-lg border border-dls-border bg-dls-hover px-3 py-2" onClick={() => void props.onUpdateNodeMetadata(props.node, { assignee: props.assigneeDraft.trim() || null })}>保存</button>
            </div>
          </label>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button class="inline-flex items-center gap-2 rounded-lg border border-dls-border bg-dls-hover px-3 py-2 text-xs" onClick={() => void props.onCreateNodeSession(props.node)}>
            <MessageSquarePlus size={14} />
            {(props.node.activeSessionId ?? props.node.sessionId) ? "打开节点对话" : "创建节点对话"}
          </button>
          <button class="inline-flex items-center gap-2 rounded-lg border border-dls-border bg-dls-hover px-3 py-2 text-xs" onClick={() => void props.onMarkMerged(props.node)}>
            <CheckCircle2 size={14} />
            写入总文档
          </button>
        </div>
      </section>

      <details class="rounded-2xl border border-dls-border bg-dls-surface p-4" open>
        <summary class="mb-3 flex cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Folder size={14} />参考文件绑定</summary>
        <div class="space-y-2 text-xs">
          <For each={props.referenceFiles}>
            {(file) => {
              const path = () => props.displayFilePath(file);
              const selected = () => props.node.referencePaths.includes(path());
              return (
                <button class={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left ${selected() ? "border-dls-accent bg-dls-hover" : "border-dls-border bg-dls-background"}`} onClick={() => void props.onBindReference(props.node, path())}>
                  <span class="truncate pr-3">{path()}</span>
                  <span class="text-dls-secondary">{selected() ? "已关联" : "关联"}</span>
                </button>
              );
            }}
          </For>
        </div>
      </details>

      <details class="rounded-2xl border border-dls-border bg-dls-surface p-4" open>
        <summary class="mb-3 flex cursor-pointer list-none items-center gap-2 text-sm font-semibold"><FileText size={14} />产出文件绑定</summary>
        <div class="space-y-2 text-xs">
          <For each={props.outputFiles}>
            {(file) => {
              const path = () => props.displayFilePath(file);
              const selected = () => props.node.outputPaths.includes(path());
              const isPrimary = () => props.node.primaryOutputPath === path();
              return (
                <div class={`rounded-lg border px-3 py-2 ${selected() ? "border-dls-accent bg-dls-hover" : "border-dls-border bg-dls-background"}`}>
                  <div class="flex items-start justify-between gap-3">
                    <button class="min-w-0 flex-1 text-left" onClick={() => void props.onBindOutput(props.node, path())}>
                      <div class="truncate">{path()}</div>
                      <div class="mt-1 text-[11px] text-dls-secondary">{selected() ? "已关联到当前节点" : "点击关联到当前节点"}</div>
                    </button>
                    <Show when={selected()}>
                      <button class={`rounded-md px-2 py-1 text-[11px] ${isPrimary() ? "bg-emerald-6 text-white" : "border border-dls-border bg-dls-surface text-dls-text"}`} onClick={() => void props.onSetPrimaryOutput(props.node, path())}>
                        {isPrimary() ? "主产出" : "设为主产出"}
                      </button>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </details>

      <details class="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <summary class="mb-3 flex cursor-pointer list-none items-center gap-2 text-sm font-semibold"><CheckCircle2 size={14} />模板文件绑定</summary>
        <div class="space-y-2 text-xs">
          <For each={props.templateFiles}>
            {(file) => {
              const path = () => props.displayFilePath(file);
              const selected = () => props.node.templatePath === path();
              return (
                <button class={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left ${selected() ? "border-dls-accent bg-dls-hover" : "border-dls-border bg-dls-background"}`} onClick={() => void props.onBindTemplate(props.node, path())}>
                  <span class="truncate pr-3">{path()}</span>
                  <span class="text-dls-secondary">{selected() ? "已绑定" : "绑定"}</span>
                </button>
              );
            }}
          </For>
        </div>
      </details>

      <details class="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <summary class="mb-3 flex cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Folder size={14} />范围选择</summary>
        <div class="mb-3 grid grid-cols-1 gap-2 text-xs">
          <select class="rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={props.rangeSourcePath} onInput={(event) => props.onSetRangeSourcePath(event.currentTarget.value)}>
            <For each={rangeSourceOptions()}>
              {(path) => <option value={path}>{path}</option>}
            </For>
          </select>
          <select class="rounded-lg border border-dls-border bg-dls-background px-3 py-2" value={props.rangeKind} onInput={(event) => props.onSetRangeKind(event.currentTarget.value as OpenworkBidWorkbenchSourceRangeKind)}>
            <option value="page-range">页码范围</option>
            <option value="section-ref">章节定位</option>
            <option value="anchor">锚点描述</option>
            <option value="note">备注范围</option>
          </select>
          <input class="rounded-lg border border-dls-border bg-dls-background px-3 py-2" placeholder="例如：12-18 / 3.2.1 / 合同首页+盖章页" value={props.rangeValueDraft} onInput={(event) => props.onSetRangeValueDraft(event.currentTarget.value)} />
          <input class="rounded-lg border border-dls-border bg-dls-background px-3 py-2" placeholder="可选备注" value={props.rangeNoteDraft} onInput={(event) => props.onSetRangeNoteDraft(event.currentTarget.value)} />
          <button class="rounded-lg border border-dls-border bg-dls-hover px-3 py-2" onClick={() => void props.onAddRange()}>添加范围</button>
        </div>

        <div class="space-y-2 text-xs">
          <For each={props.node.sourceRanges}>
            {(range: OpenworkBidWorkbenchSourceRange) => (
              <div class="rounded-xl border border-dls-border bg-dls-background px-3 py-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate font-medium">{range.sourcePath}</div>
                    <div class="mt-1 text-dls-secondary">{range.rangeKind} · {range.rangeValue}</div>
                    <Show when={range.note}>
                      <div class="mt-1 whitespace-pre-wrap text-dls-text">{range.note}</div>
                    </Show>
                  </div>
                  <button class="text-dls-secondary" onClick={() => void props.onRemoveRange(range.id)}>删除</button>
                </div>
              </div>
            )}
          </For>
          <Show when={props.node.sourceRanges.length === 0}>
            <div class="rounded-lg border border-dashed border-dls-border px-3 py-3 text-dls-secondary">当前节点还没有范围选择</div>
          </Show>
        </div>
      </details>

      <details class="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <summary class="mb-3 flex cursor-pointer list-none items-center gap-2 text-sm font-semibold"><FileText size={14} />协作标记</summary>
        <div class="mb-3 grid grid-cols-[120px_1fr_auto] gap-2">
          <select class="rounded-lg border border-dls-border bg-dls-background px-3 py-2 text-xs" value={props.markKind} onInput={(event) => props.onSetMarkKind(event.currentTarget.value as OpenworkBidWorkbenchMark["kind"])}>
            <For each={Object.entries(MARK_KIND_LABELS) as Array<[OpenworkBidWorkbenchMark["kind"], string]>}>
              {([value, label]) => <option value={value}>{label}</option>}
            </For>
          </select>
          <input class="rounded-lg border border-dls-border bg-dls-background px-3 py-2 text-xs" placeholder="记录协作标记、风险、决定或待办" value={props.markDraft} onInput={(event) => props.onSetMarkDraft(event.currentTarget.value)} />
          <button class="rounded-lg border border-dls-border bg-dls-hover px-3 py-2 text-xs" onClick={() => void props.onAddMark()}>添加</button>
        </div>

        <div class="space-y-2 text-xs">
          <For each={props.marks}>
            {(mark) => (
              <div class="rounded-xl border border-dls-border bg-dls-background px-3 py-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="font-medium">{MARK_KIND_LABELS[mark.kind]} · {mark.author}</div>
                  <button class="text-dls-secondary" onClick={() => void props.onRemoveMark(mark.id)}>删除</button>
                </div>
                <div class="mt-2 whitespace-pre-wrap text-dls-text">{mark.text}</div>
              </div>
            )}
          </For>
          <Show when={props.marks.length === 0}>
            <div class="rounded-lg border border-dashed border-dls-border px-3 py-3 text-dls-secondary">当前节点还没有协作标记</div>
          </Show>
        </div>
      </details>
    </div>
  );
}
