type BidWorkbenchOverviewTabProps = {
  outlineSourceLabel: string;
  rootOutputLabel: string;
  workflowStage: "outline" | "mapping" | "drafting" | "merge";
  outlineRevision: number;
  leafNodeCount: number;
  lockedNodeCount: number;
  conflictNodeCount: number;
  nodesWithoutReferencesCount: number;
  nodesWithoutOutputsCount: number;
  requestedMergeCount: number;
  appliedMergeCount: number;
  refreshSummary: string | null | undefined;
  onSetWorkflowStage: (value: "outline" | "mapping" | "drafting" | "merge") => void | Promise<void>;
};

export default function BidWorkbenchOverviewTab(props: BidWorkbenchOverviewTabProps) {
  return (
    <div class="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-2 xl:grid-cols-3">
      <section class="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <div class="text-sm font-semibold">项目状态</div>
        <div class="mt-3 space-y-3 text-xs">
          <div class="rounded-xl bg-dls-background px-3 py-2">
            <div class="text-dls-secondary">章节主源</div>
            <div class="mt-1 break-all font-medium text-dls-text">{props.outlineSourceLabel}</div>
          </div>
          <div class="rounded-xl bg-dls-background px-3 py-2">
            <div class="text-dls-secondary">总文档目标</div>
            <div class="mt-1 break-all font-medium text-dls-text">{props.rootOutputLabel}</div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-xl bg-dls-background px-3 py-2">
              <div class="text-dls-secondary">工作阶段</div>
              <select class="mt-1 w-full rounded-lg border border-dls-border bg-dls-surface px-2 py-1 text-xs font-medium text-dls-text" value={props.workflowStage} onInput={(event) => void props.onSetWorkflowStage(event.currentTarget.value as "outline" | "mapping" | "drafting" | "merge")}>
                <option value="outline">outline</option>
                <option value="mapping">mapping</option>
                <option value="drafting">drafting</option>
                <option value="merge">merge</option>
              </select>
            </div>
            <div class="rounded-xl bg-dls-background px-3 py-2">
              <div class="text-dls-secondary">结构版本</div>
              <div class="mt-1 font-medium text-dls-text">{props.outlineRevision}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <div class="text-sm font-semibold">节点统计</div>
        <div class="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div class="rounded-xl bg-dls-background px-3 py-2"><div class="text-dls-secondary">叶子节点</div><div class="mt-1 font-medium text-dls-text">{props.leafNodeCount}</div></div>
          <div class="rounded-xl bg-dls-background px-3 py-2"><div class="text-dls-secondary">已锁定</div><div class="mt-1 font-medium text-dls-text">{props.lockedNodeCount}</div></div>
          <div class="rounded-xl bg-dls-background px-3 py-2"><div class="text-dls-secondary">刷新冲突</div><div class="mt-1 font-medium text-dls-text">{props.conflictNodeCount}</div></div>
        </div>
      </section>

      <section class="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <div class="text-sm font-semibold">关键缺口</div>
        <div class="mt-3 space-y-2 text-xs">
          <div class="flex items-center justify-between rounded-xl bg-dls-background px-3 py-2"><span>未绑定参考资料</span><span>{props.nodesWithoutReferencesCount}</span></div>
          <div class="flex items-center justify-between rounded-xl bg-dls-background px-3 py-2"><span>无主产出</span><span>{props.nodesWithoutOutputsCount}</span></div>
          <div class="flex items-center justify-between rounded-xl bg-dls-background px-3 py-2"><span>待合并</span><span>{props.requestedMergeCount}</span></div>
          <div class="flex items-center justify-between rounded-xl bg-dls-background px-3 py-2"><span>已合并</span><span>{props.appliedMergeCount}</span></div>
        </div>
        {props.refreshSummary ? (
          <div class="mt-3 rounded-xl bg-dls-background px-3 py-2 text-[11px] text-dls-secondary">
            {props.refreshSummary}
          </div>
        ) : null}
      </section>
    </div>
  );
}
