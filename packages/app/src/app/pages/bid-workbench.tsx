import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal } from "solid-js";
import {
  ArrowLeft,
  Lock,
  RefreshCw,
} from "lucide-solid";
import { useNavigate } from "@solidjs/router";

import type { SessionViewProps } from "./session";
import type {
  OpenworkBidWorkbenchCompositionMode,
  OpenworkBidWorkbenchMark,
  OpenworkBidWorkbenchNode,
  OpenworkBidWorkbenchSourceRangeKind,
  OpenworkBidWorkbenchSourceType,
  OpenworkBidWorkbenchState
} from "../lib/openwork-server";
import BidWorkbenchOverviewTab from "./bid-workbench/overview-tab";
import BidWorkbenchFileCategoryPanel from "./bid-workbench/file-category-panel";
import BidWorkbenchNodeDetailPanel from "./bid-workbench/node-detail-panel";
import BidWorkbenchConstraintsTab from "./bid-workbench/constraints-tab";
import {
  CATEGORY_LABELS,
  DEFAULT_NODE_AUTHOR,
  EMPTY_WORKBENCH_STATE,
  FILE_CATEGORY_ROOTS,
  STRUCTURE_SOURCE_KIND_LABELS,
  TAB_LABELS,
  type BidWorkbenchWorkspaceFile,
  formatTimestamp,
  inferStructureSourceKind,
} from "./bid-workbench/shared";
import type { BidWorkbenchFileCategory, BidWorkbenchTab } from "./bid-workbench/shared";

async function listCategoryFiles(
  client: NonNullable<SessionViewProps["openworkServerClient"]>,
  workspaceId: string,
  category: BidWorkbenchFileCategory,
): Promise<BidWorkbenchWorkspaceFile[]> {
  const data = await client.listWorkspaceDocuments(workspaceId);
  const prefix = `${FILE_CATEGORY_ROOTS[category]}/`;
  return (data.items ?? [])
    .filter((item) => item.name.startsWith(prefix))
    .map((item) => ({
      path: item.name,
      updatedAt: item.updatedAt,
      size: item.size,
      type: item.type,
      originalName: item.name.split("/").pop(),
    }));
}

export default function BidWorkbenchView(props: SessionViewProps) {
  const navigate = useNavigate();
  const workspaceId = createMemo(() => props.openworkServerWorkspaceId?.trim() ?? "");
  const [activeTab, setActiveTab] = createSignal<BidWorkbenchTab>("workspace");
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [uploadingCategory, setUploadingCategory] = createSignal<BidWorkbenchFileCategory | null>(null);
  const [refreshingOutline, setRefreshingOutline] = createSignal(false);
  const [markDraft, setMarkDraft] = createSignal("");
  const [markKind, setMarkKind] = createSignal<OpenworkBidWorkbenchMark["kind"]>("note");
  const [assigneeDraft, setAssigneeDraft] = createSignal("");
  const [rangeSourcePath, setRangeSourcePath] = createSignal("");
  const [rangeKind, setRangeKind] = createSignal<OpenworkBidWorkbenchSourceRangeKind>("page-range");
  const [rangeValueDraft, setRangeValueDraft] = createSignal("");
  const [rangeNoteDraft, setRangeNoteDraft] = createSignal("");
  const [visibleWorkbenchState, setVisibleWorkbenchState] = createSignal<OpenworkBidWorkbenchState>(EMPTY_WORKBENCH_STATE);
  const [visibleTenderFiles, setVisibleTenderFiles] = createSignal<BidWorkbenchWorkspaceFile[]>([]);
  const [visibleReferenceFiles, setVisibleReferenceFiles] = createSignal<BidWorkbenchWorkspaceFile[]>([]);
  const [visibleOutputFiles, setVisibleOutputFiles] = createSignal<BidWorkbenchWorkspaceFile[]>([]);
  const [visibleTemplateFiles, setVisibleTemplateFiles] = createSignal<BidWorkbenchWorkspaceFile[]>([]);
  const [stableWorkspaceId, setStableWorkspaceId] = createSignal<string | null>(null);
  const actorName = createMemo(() => props.sessionUsername?.trim() || DEFAULT_NODE_AUTHOR);

  createEffect(() => {
    const id = workspaceId();
    if (!id) return;
    setStableWorkspaceId((current) => (current === id ? current : id));
  });

  const workspaceResourceKey = createMemo(() => stableWorkspaceId() ?? undefined);

  const [workbenchState, { mutate: mutateWorkbenchState, refetch: refetchWorkbenchState }] = createResource(
    workspaceResourceKey,
    async (currentWorkspaceId): Promise<OpenworkBidWorkbenchState> => {
      const client = props.openworkServerClient;
      if (!currentWorkspaceId) return EMPTY_WORKBENCH_STATE;
      if (!client) return visibleWorkbenchState();
      return client.getBidWorkbench(currentWorkspaceId);
    },
  );

  const [tenderFiles, { refetch: refetchTenderFiles }] = createResource(
    workspaceResourceKey,
    async (currentWorkspaceId) => {
      const client = props.openworkServerClient;
      if (!currentWorkspaceId) return [] as BidWorkbenchWorkspaceFile[];
      if (!client) return visibleTenderFiles();
      return listCategoryFiles(client, currentWorkspaceId, "tender");
    },
  );
  const [referenceFiles, { refetch: refetchReferenceFiles }] = createResource(
    workspaceResourceKey,
    async (currentWorkspaceId) => {
      const client = props.openworkServerClient;
      if (!currentWorkspaceId) return [] as BidWorkbenchWorkspaceFile[];
      if (!client) return visibleReferenceFiles();
      return listCategoryFiles(client, currentWorkspaceId, "reference");
    },
  );
  const [outputFiles, { refetch: refetchOutputFiles }] = createResource(
    workspaceResourceKey,
    async (currentWorkspaceId) => {
      const client = props.openworkServerClient;
      if (!currentWorkspaceId) return [] as BidWorkbenchWorkspaceFile[];
      if (!client) return visibleOutputFiles();
      return listCategoryFiles(client, currentWorkspaceId, "output");
    },
  );
  const [templateFiles, { refetch: refetchTemplateFiles }] = createResource(
    workspaceResourceKey,
    async (currentWorkspaceId) => {
      const client = props.openworkServerClient;
      if (!currentWorkspaceId) return [] as BidWorkbenchWorkspaceFile[];
      if (!client) return visibleTemplateFiles();
      return listCategoryFiles(client, currentWorkspaceId, "templates");
    },
  );

  createEffect(() => {
    const key = workspaceResourceKey();
    const nextState = workbenchState();
    if (!key || !nextState) return;
    setVisibleWorkbenchState(nextState);
  });

  createEffect(() => {
    const key = workspaceResourceKey();
    const files = tenderFiles();
    if (!key || !files) return;
    setVisibleTenderFiles(files);
  });

  createEffect(() => {
    const key = workspaceResourceKey();
    const files = referenceFiles();
    if (!key || !files) return;
    setVisibleReferenceFiles(files);
  });

  createEffect(() => {
    const key = workspaceResourceKey();
    const files = outputFiles();
    if (!key || !files) return;
    setVisibleOutputFiles(files);
  });

  createEffect(() => {
    const key = workspaceResourceKey();
    const files = templateFiles();
    if (!key || !files) return;
    setVisibleTemplateFiles(files);
  });

  const currentWorkbenchState = createMemo(() => {
    const key = workspaceResourceKey();
    const nextState = workbenchState();
    return key && nextState ? nextState : visibleWorkbenchState();
  });

  const currentTenderFiles = createMemo(() => {
    const key = workspaceResourceKey();
    const files = tenderFiles();
    return key && files ? files : visibleTenderFiles();
  });

  const currentReferenceFiles = createMemo(() => {
    const key = workspaceResourceKey();
    const files = referenceFiles();
    return key && files ? files : visibleReferenceFiles();
  });

  const currentOutputFiles = createMemo(() => {
    const key = workspaceResourceKey();
    const files = outputFiles();
    return key && files ? files : visibleOutputFiles();
  });

  const currentTemplateFiles = createMemo(() => {
    const key = workspaceResourceKey();
    const files = templateFiles();
    return key && files ? files : visibleTemplateFiles();
  });

  const nodesById = createMemo(() => {
    const map = new Map<string, OpenworkBidWorkbenchNode>();
    for (const node of currentWorkbenchState().nodes ?? []) map.set(node.id, node);
    return map;
  });

  const rootNodes = createMemo(() => (currentWorkbenchState().nodes ?? []).filter((node) => !node.parentId));
  const selectedNode = createMemo(() => {
    const id = selectedNodeId();
    return id ? nodesById().get(id) ?? null : null;
  });
  const leafNodes = createMemo(() => (currentWorkbenchState().nodes ?? []).filter((node) => node.isLeaf));
  const lockedNodes = createMemo(() => leafNodes().filter((node) => Boolean(node.lockedBy)));
  const nodesWithoutReferences = createMemo(() => leafNodes().filter((node) => node.referencePaths.length === 0));
  const nodesWithoutOutputs = createMemo(() => leafNodes().filter((node) => !node.primaryOutputPath));
  const conflictNodes = createMemo(() => (currentWorkbenchState().nodes ?? []).filter((node) => node.refreshConflictState !== "none"));
  const constraintSourceFiles = createMemo(() => [
    ...(currentTenderFiles() ?? []),
    ...(currentTemplateFiles() ?? []),
    ...(currentReferenceFiles() ?? []),
    ...(currentOutputFiles() ?? []),
  ]);

  const marksForSelectedNode = createMemo(() => {
    const nodeId = selectedNodeId();
    if (!nodeId) return [] as OpenworkBidWorkbenchMark[];
    return (currentWorkbenchState().marks ?? [])
      .filter((item) => item.nodeId === nodeId)
      .sort((a, b) => b.createdAt - a.createdAt);
  });

  const currentOutlineSourceLabel = createMemo(() => {
    const sourceType = currentWorkbenchState().project.outlineSourceType;
    const sourcePath = currentWorkbenchState().project.outlineSourcePath;
    if (!sourceType || !sourcePath) return "未设置章节主源";
    const kind = currentWorkbenchState().project.structureSourceKind;
    const kindLabel = kind ? STRUCTURE_SOURCE_KIND_LABELS[kind] : "未指定";
    return `${CATEGORY_LABELS[sourceType]} · ${kindLabel} · ${sourcePath}`;
  });

  const currentRootOutputLabel = createMemo(() => currentWorkbenchState().project.rootOutputPath ?? "未设置总文档");
  const currentTreeSummary = createMemo(() =>
    [
      `结构版本 ${currentWorkbenchState().project.outlineRevision ?? 0}`,
      `叶子节点 ${leafNodes().length}`,
      `已锁定 ${lockedNodes().length}`,
      `无引用 ${nodesWithoutReferences().length}`,
      `无主产出 ${nodesWithoutOutputs().length}`,
      `待合并 ${leafNodes().filter((node) => node.mergeRequested && !node.mergeApplied).length}`,
    ].join(" · "),
  );

  createEffect(() => {
    const nodes = currentWorkbenchState().nodes ?? [];
    const current = selectedNodeId();
    if (current && nodes.some((node) => node.id === current)) return;
    setSelectedNodeId(nodes[0]?.id ?? null);
  });

  createEffect(() => {
    const node = selectedNode();
    setAssigneeDraft(node?.assignee ?? "");
    const nextRangeSource = node?.referencePaths[0] ?? node?.templatePath ?? node?.sourcePath ?? "";
    setRangeSourcePath((current) => (current && (node?.sourceRanges.some((range) => range.sourcePath === current) || current === nextRangeSource) ? current : nextRangeSource));
  });

  const refreshAll = async () => {
    await Promise.all([
      refetchWorkbenchState(),
      refetchTenderFiles(),
      refetchReferenceFiles(),
      refetchOutputFiles(),
      refetchTemplateFiles(),
    ]);
  };

  const runStateMutation = async (action: () => Promise<OpenworkBidWorkbenchState>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const nextState = await action();
      mutateWorkbenchState(nextState);
      return nextState;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const setOutlineSource = async (path: string, sourceType: OpenworkBidWorkbenchSourceType) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() =>
      client.setBidWorkbenchProjectSource(workspaceId(), {
        sourcePath: path,
        sourceType,
        structureSourceKind: inferStructureSourceKind(sourceType),
      }),
    );
  };

  const refreshOutline = async () => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    setRefreshingOutline(true);
    try {
      await runStateMutation(() => client.refreshBidWorkbench(workspaceId()));
    } finally {
      setRefreshingOutline(false);
    }
  };

  const setRootOutputPath = async (path: string | null) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() => client.setBidWorkbenchProjectRootOutput(workspaceId(), { rootOutputPath: path }));
  };

  const setWorkflowStage = async (workflowStage: "outline" | "mapping" | "drafting" | "merge") => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() =>
      client.setBidWorkbenchProjectWorkflowStage(workspaceId(), { workflowStage }),
    );
  };

  const saveConstraints = async (payload: {
    formatRules: Record<string, unknown>;
    extractedFromPath: string | null;
  }) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() =>
      client.setBidWorkbenchProjectConstraints(workspaceId(), payload),
    );
  };

  const addMark = async () => {
    const nodeId = selectedNodeId();
    const text = markDraft().trim();
    const client = props.openworkServerClient;
    if (!nodeId || !text || !workspaceId() || !client) return;
    const result = await runStateMutation(() =>
      client.addBidWorkbenchSectionMark(workspaceId(), nodeId, {
        author: actorName(),
        kind: markKind(),
        text,
      }),
    );
    if (result) setMarkDraft("");
  };

  const removeMark = async (markId: string) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() => client.deleteBidWorkbenchSectionMark(workspaceId(), markId));
  };

  const addRange = async () => {
    const nodeId = selectedNodeId();
    const client = props.openworkServerClient;
    const sourcePath = rangeSourcePath().trim();
    const rangeValue = rangeValueDraft().trim();
    if (!nodeId || !workspaceId() || !client || !sourcePath || !rangeValue) return;
    const result = await runStateMutation(() =>
      client.addBidWorkbenchSectionRange(workspaceId(), nodeId, {
        sourcePath,
        rangeKind: rangeKind(),
        rangeValue,
        note: rangeNoteDraft().trim() || null,
      }),
    );
    if (result) {
      setRangeValueDraft("");
      setRangeNoteDraft("");
    }
  };

  const removeRange = async (rangeId: string) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() => client.deleteBidWorkbenchSectionRange(workspaceId(), rangeId));
  };

  const createNodeSession = async (node: OpenworkBidWorkbenchNode) => {
    const existingSessionId = node.activeSessionId ?? node.sessionId;
    if (existingSessionId) {
      await Promise.resolve(props.selectSession(existingSessionId)).catch(() => undefined);
      navigate(`/document-agent/${existingSessionId}`);
      return;
    }
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    const created = await client.createWorkspaceOpencodeSession(workspaceId(), {
      title: `投标节点｜${node.title}`,
      openworkPreferredView: "document-agent",
      openworkPreferredAgent: "common-work",
      openworkPreferredAgentLock: "common-work",
      openworkRuntimeProfileId: "bid-workbench-node",
      openworkRuntimeScopeKind: "bid-workbench-node",
      openworkRuntimeScopeKey: node.runtimeScopeKey ?? node.id,
      openworkBidNodeId: node.id,
    });
    const nextSessionId = created.id?.trim();
    if (!nextSessionId) return;
    await runStateMutation(() =>
      client.setBidWorkbenchSectionSession(workspaceId(), node.id, {
        sessionId: nextSessionId,
      }),
    );
    await Promise.resolve(props.selectSession(nextSessionId)).catch(() => undefined);
    navigate(`/document-agent/${nextSessionId}`);
  };

  const toggleLock = async (node: OpenworkBidWorkbenchNode) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() =>
      client.setBidWorkbenchSectionLock(workspaceId(), node.id, {
        lockedBy: node.lockedBy ? null : actorName(),
      }),
    );
  };

  const updateNodeMetadata = async (
    node: OpenworkBidWorkbenchNode,
    patch: {
      compositionMode?: OpenworkBidWorkbenchCompositionMode;
      assignee?: string | null;
    },
  ) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() => client.setBidWorkbenchSectionMetadata(workspaceId(), node.id, patch));
  };

  const markMerged = async (node: OpenworkBidWorkbenchNode) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    const outputPath = node.primaryOutputPath ?? node.lastEditedOutputPath ?? node.outputPaths[0] ?? null;
    const rootOutputPath = currentWorkbenchState().project.rootOutputPath ?? null;
    if (!rootOutputPath) {
      setSaveError("请先设置总文档。");
      return;
    }
    if (!outputPath) {
      setSaveError("请先为当前节点绑定并指定主产出文件。");
      return;
    }
    await runStateMutation(() =>
      client.setBidWorkbenchSectionMergedState(workspaceId(), node.id, {
        mergeRequested: true,
        outputPath,
        rootOutputPath,
      }),
    );
  };

  const bindReference = async (node: OpenworkBidWorkbenchNode, path: string) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() =>
      client.setBidWorkbenchSectionLink(workspaceId(), node.id, {
        kind: "reference",
        path,
        selected: !node.referencePaths.includes(path),
      }),
    );
  };

  const bindOutput = async (node: OpenworkBidWorkbenchNode, path: string) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() =>
      client.setBidWorkbenchSectionLink(workspaceId(), node.id, {
        kind: "output",
        path,
        selected: !node.outputPaths.includes(path),
      }),
    );
  };

  const bindTemplate = async (node: OpenworkBidWorkbenchNode, path: string) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() =>
      client.setBidWorkbenchSectionLink(workspaceId(), node.id, {
        kind: "template",
        path,
        selected: node.templatePath !== path,
      }),
    );
  };

  const setPrimaryOutput = async (node: OpenworkBidWorkbenchNode, primaryOutputPath: string) => {
    const client = props.openworkServerClient;
    if (!workspaceId() || !client) return;
    await runStateMutation(() =>
      client.setBidWorkbenchSectionPrimaryOutput(workspaceId(), node.id, {
        primaryOutputPath,
      }),
    );
  };

  const handleUpload = async (category: BidWorkbenchFileCategory, files: FileList | null) => {
    const currentWorkspaceId = workspaceId();
    const client = props.openworkServerClient;
    if (!currentWorkspaceId || !client || !files?.length) return;
    setUploadingCategory(category);
    try {
      for (const file of Array.from(files)) {
        const relativePath = file.webkitRelativePath?.trim() || file.name;
        await client.uploadWorkspaceDocument(currentWorkspaceId, {
          file,
          baseDir: FILE_CATEGORY_ROOTS[category],
          relativePath,
          overwrite: true,
        });
      }
      await refreshAll();
    } finally {
      setUploadingCategory(null);
    }
  };

  const fileListForCategory = (category: BidWorkbenchFileCategory) => {
    switch (category) {
      case "tender":
        return currentTenderFiles() ?? [];
      case "reference":
        return currentReferenceFiles() ?? [];
      case "output":
        return currentOutputFiles() ?? [];
      case "templates":
        return currentTemplateFiles() ?? [];
    }
  };

  const displayFilePath = (file: BidWorkbenchWorkspaceFile) => file.path.trim();

  const renderNodeTree = (node: OpenworkBidWorkbenchNode): any => (
    <div class="space-y-2">
      <button
        class={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
          selectedNodeId() === node.id
            ? "border-dls-accent bg-dls-hover text-dls-text"
            : "border-dls-border bg-dls-surface text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
        }`}
        onClick={() => setSelectedNodeId(node.id)}
      >
        <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div class="min-w-0">
            <div class="truncate font-medium">{node.title}</div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] opacity-80">
              <span>L{node.level}</span>
              <span>{node.isLeaf ? "叶子节点" : "目录节点"}</span>
              <Show when={node.isLeaf}>
                <span>引用 {node.referencePaths.length}</span>
                <span>产出 {node.outputPaths.length}</span>
                <span>{node.lockedBy ? `编辑中：${node.lockedBy}` : "未锁定"}</span>
              </Show>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2 text-[11px]">
            <Show when={node.lockedBy}>
              <span class="inline-flex items-center gap-1 rounded-full bg-amber-3 px-2 py-0.5 text-amber-11">
                <Lock size={12} />
                {node.lockedBy}
              </span>
            </Show>
            <Show when={node.primaryOutputPath}>
              <span class="rounded-full bg-emerald-3 px-2 py-0.5 text-emerald-11">主产出</span>
            </Show>
            <Show when={node.activeSessionId ?? node.sessionId}>
              <span class="rounded-full bg-blue-3 px-2 py-0.5 text-blue-11">会话</span>
            </Show>
          </div>
        </div>
      </button>
      <Show when={node.children.length > 0}>
        <div class="ml-4 space-y-2 border-l border-dls-border pl-3">
          <For each={node.children.map((id) => nodesById().get(id)).filter(Boolean) as OpenworkBidWorkbenchNode[]}>
            {(child) => renderNodeTree(child)}
          </For>
        </div>
      </Show>
    </div>
  );

  return (
    <div class="flex h-full min-h-0 flex-col bg-dls-background text-dls-text">
      <div class="flex items-center justify-between border-b border-dls-border px-4 py-3">
        <div>
          <div class="text-lg font-semibold">多人协作投标工作台</div>
          <div class="mt-1 text-xs text-dls-secondary">节点级独立对话、显式材料绑定、按章节协作推进</div>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="inline-flex items-center gap-2 rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs"
            onClick={() => navigate("/session")}
          >
            <ArrowLeft size={14} />
            返回
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs"
            onClick={() => void refreshAll()}
          >
            <RefreshCw size={14} />
            刷新文件区
          </button>
        </div>
      </div>

      <div class="border-b border-dls-border px-4 py-2">
        <div class="flex items-center gap-2">
          <For each={["overview", "workspace", "constraints"] as const}>
            {(tab) => (
              <button
                class={`rounded-lg px-3 py-2 text-xs transition-colors ${
                  activeTab() === tab
                    ? "bg-dls-accent text-white"
                    : "border border-dls-border bg-dls-surface text-dls-text"
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            )}
          </For>
        </div>
      </div>

      <Switch>
        <Match when={activeTab() === "overview"}>
          <BidWorkbenchOverviewTab
            outlineSourceLabel={currentOutlineSourceLabel()}
            rootOutputLabel={currentRootOutputLabel()}
            workflowStage={currentWorkbenchState().project.workflowStage ?? "outline"}
            outlineRevision={currentWorkbenchState().project.outlineRevision ?? 0}
            leafNodeCount={leafNodes().length}
            lockedNodeCount={lockedNodes().length}
            conflictNodeCount={conflictNodes().length}
            nodesWithoutReferencesCount={nodesWithoutReferences().length}
            nodesWithoutOutputsCount={nodesWithoutOutputs().length}
            requestedMergeCount={leafNodes().filter((node) => node.mergeRequested && !node.mergeApplied).length}
            appliedMergeCount={leafNodes().filter((node) => node.mergeApplied).length}
            refreshSummary={currentWorkbenchState().refresh?.summary}
            onSetWorkflowStage={setWorkflowStage}
          />
        </Match>

        <Match when={activeTab() === "workspace"}>
          <div class="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_390px]">
            <aside class="min-h-0 overflow-auto border-b border-dls-border bg-dls-surface/60 p-3 xl:border-b-0 xl:border-r">
              <div class="mb-3">
                <div class="text-sm font-semibold">资源区</div>
                <div class="mt-1 text-xs text-dls-secondary">模板、参考资料和产出文件都集中在这里，默认优先维护模板和参考文件。</div>
              </div>
              <div class="space-y-5">
                <For each={["tender", "reference", "output", "templates"] as const}>
                  {(category) => (
                    <BidWorkbenchFileCategoryPanel
                      category={category}
                      files={fileListForCategory(category)}
                      uploading={uploadingCategory() === category}
                      currentOutlineSourcePath={currentWorkbenchState().project.outlineSourcePath}
                      currentRootOutputPath={currentWorkbenchState().project.rootOutputPath}
                      displayFilePath={displayFilePath}
                      onUpload={handleUpload}
                      onSetOutlineSource={setOutlineSource}
                      onSetRootOutput={setRootOutputPath}
                    />
                  )}
                </For>
              </div>
            </aside>

            <main class="min-h-0 overflow-auto p-4">
              <div class="sticky top-0 z-10 mb-4 rounded-2xl border border-dls-border bg-dls-background/95 p-3 backdrop-blur">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-base font-semibold">投标章节树</div>
                    <div class="mt-1 text-xs text-dls-secondary">
                      中间区域是核心工作区。章节树直接展示叶子节点的引用、产出、锁和会话状态。
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span class="rounded-full bg-dls-surface px-3 py-1">主源：{currentWorkbenchState().project.outlineSourcePath ? currentOutlineSourceLabel() : "未设置"}</span>
                      <span class="rounded-full bg-dls-surface px-3 py-1">总文档：{currentWorkbenchState().project.rootOutputPath ?? "未设置"}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                    class="inline-flex items-center gap-2 rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs"
                    onClick={() => void refreshOutline()}
                    disabled={refreshingOutline() || !currentWorkbenchState().project.outlineSourcePath}
                    >
                      <RefreshCw size={14} />
                      {refreshingOutline() ? "刷新中..." : "刷新章节树"}
                    </button>
                    <Show when={saving()}>
                      <div class="text-xs text-dls-secondary">保存中...</div>
                    </Show>
                  </div>
                </div>
              </div>

              <Show when={saveError()}>
                <div class="mb-4 rounded-xl border border-red-6 bg-red-2 px-3 py-2 text-xs text-red-11">{saveError()}</div>
              </Show>

              <Show
                when={(currentWorkbenchState().nodes?.length ?? 0) > 0}
                fallback={<div class="rounded-2xl border border-dashed border-dls-border bg-dls-surface px-4 py-8 text-sm text-dls-secondary">还没有章节树。请先在左侧选择一个文件设为章节主源，再刷新章节树。</div>}
              >
                <div class="min-h-[520px] rounded-2xl border border-dls-border bg-dls-surface">
                  <div class="border-b border-dls-border px-3 py-2 text-[11px] text-dls-secondary">
                    {currentWorkbenchState().refresh?.summary ?? currentTreeSummary()}
                  </div>
                  <div class="grid grid-cols-[minmax(0,1fr)_240px] gap-3 border-b border-dls-border px-3 py-2 text-[11px] font-medium text-dls-secondary">
                    <div>章节节点</div>
                    <div class="text-right">引用 / 产出 / 协作</div>
                  </div>
                  <div class="space-y-3 p-3">
                    <For each={rootNodes()}>{(node) => renderNodeTree(node)}</For>
                  </div>
                </div>
              </Show>
            </main>

            <aside class="min-h-0 overflow-auto border-t border-dls-border bg-dls-surface/60 p-4 xl:border-l xl:border-t-0">
              <div class="mb-3">
                <div class="text-sm font-semibold">节点检查器</div>
                <div class="mt-1 text-xs text-dls-secondary">右侧只处理当前选中节点。高频操作置顶，低频配置折叠。</div>
              </div>
              <Show
                when={selectedNode()}
                fallback={<div class="rounded-2xl border border-dashed border-dls-border px-4 py-8 text-sm text-dls-secondary">请选择一个节点</div>}
              >
                {(nodeAccessor) => {
                  const node = () => nodeAccessor();
                  return (
                    <BidWorkbenchNodeDetailPanel
                      node={node()}
                      assigneeDraft={assigneeDraft()}
                      markDraft={markDraft()}
                      markKind={markKind()}
                      marks={marksForSelectedNode()}
                      rangeSourcePath={rangeSourcePath()}
                      rangeKind={rangeKind()}
                      rangeValueDraft={rangeValueDraft()}
                      rangeNoteDraft={rangeNoteDraft()}
                      referenceFiles={currentReferenceFiles() ?? []}
                      outputFiles={currentOutputFiles() ?? []}
                      templateFiles={currentTemplateFiles() ?? []}
                      displayFilePath={displayFilePath}
                      onSetAssigneeDraft={setAssigneeDraft}
                      onSetMarkDraft={setMarkDraft}
                      onSetMarkKind={setMarkKind}
                      onSetRangeSourcePath={setRangeSourcePath}
                      onSetRangeKind={setRangeKind}
                      onSetRangeValueDraft={setRangeValueDraft}
                      onSetRangeNoteDraft={setRangeNoteDraft}
                      onToggleLock={toggleLock}
                      onUpdateNodeMetadata={updateNodeMetadata}
                      onCreateNodeSession={createNodeSession}
                      onMarkMerged={markMerged}
                      onBindReference={bindReference}
                      onBindOutput={bindOutput}
                      onBindTemplate={bindTemplate}
                      onSetPrimaryOutput={setPrimaryOutput}
                      onAddRange={addRange}
                      onRemoveRange={removeRange}
                      onAddMark={addMark}
                      onRemoveMark={removeMark}
                    />
                  );
                }}
              </Show>
            </aside>
          </div>
        </Match>

        <Match when={activeTab() === "constraints"}>
          <BidWorkbenchConstraintsTab
            constraints={currentWorkbenchState().constraints ?? EMPTY_WORKBENCH_STATE.constraints}
            sourceFiles={constraintSourceFiles()}
            displayFilePath={displayFilePath}
            onSave={saveConstraints}
          />
        </Match>
      </Switch>
    </div>
  );
}
