import { summarizeArtifactFiles } from "./doc-subagent-simulate-lib.mjs";

export const SUPPORTED_DOCUMENT_WORKFLOW_COMPARE_STAGES = [
  "runtime",
  "upload",
  "intake",
  "plan",
  "full",
];

function unique(values) {
  return [...new Set(values)];
}

function normalizePromptText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeDocumentWorkflowCompareStage(value = "full") {
  const normalized = normalizePromptText(value).toLowerCase() || "full";
  if (!SUPPORTED_DOCUMENT_WORKFLOW_COMPARE_STAGES.includes(normalized)) {
    throw new Error(
      `Unsupported compare stage "${value}". Supported stages: ${SUPPORTED_DOCUMENT_WORKFLOW_COMPARE_STAGES.join(", ")}`,
    );
  }
  return normalized;
}

function buildIntakeOnlyPrompt(scenario) {
  return [
    `只做正式文档工作流的 intake bootstrap，当前任务上下文是：${scenario.title ?? scenario.id}。`,
    "必须完成并停在这一步：登记当前已上传材料，写入 .worktree/index.json 和 .worktree/sources/manifest.json。",
    "必须现在就实际执行，不要只汇报现状、不要只给下一步建议、不要询问是否继续。",
    "不要继续到 facts、merge、plan、write、verify。",
    "不要写 outputs/**，不要生成最终 deliverable，也不要先做 verifier。",
    "只有当上述 intake artifacts 已实际存在时才允许结束本轮。",
    "回复只需要简短说明你创建或更新了哪些状态文件，以及建议的下一个 phase。",
  ].join("\n");
}

function buildPlanOnlyPrompt(scenario) {
  return [
    `只推进到正式文档 workflow 的 planning gate，当前任务上下文是：${scenario.title ?? scenario.id}。`,
    "这不是盘点题，也不是咨询题。你必须现在就实际执行，直到 planning gate 所需文件已经写出。",
    "如果 intake state 缺失，先补齐 .worktree/index.json 和 .worktree/sources/manifest.json。",
    "然后继续完成 .worktree/facts.json、.worktree/merge/conflicts.json、.worktree/plan/solution-plan.json、.worktree/coverage.json。",
    "如有必要，必须继续调用对应 phase 或子代理（例如 doc-intake / doc-reader / doc-merger / doc-planner，或等价流程），不要只说“下一步应该做什么”。",
    "不要生成最终 deliverable，不要写 outputs/**，不要进入最终写稿或 verifier。",
    "不要询问是否继续。只有当上述 planning artifacts 都已实际存在时才允许结束本轮。",
    "回复只需要简短说明已经写出的 planning artifacts、仍存在的 blocker（如果有），以及下一步建议。",
  ].join("\n");
}

export function buildDocumentWorkflowCompareStagePlan({ scenario, stage = "full" }) {
  const normalizedStage = normalizeDocumentWorkflowCompareStage(stage);

  if (normalizedStage === "runtime") {
    return {
      id: "runtime",
      description: "Create the hosted session and verify runtime/profile wiring only.",
      uploadDocs: false,
      prompts: [],
      expectedPromptCount: 0,
      requiredArtifacts: [],
      expectDeliverable: false,
      settleOptions: {
        timeoutMs: 30_000,
        noProgressTimeoutMs: 15_000,
        quietMs: 5_000,
        useWorkspaceEventStream: false,
      },
    };
  }

  if (normalizedStage === "upload") {
    return {
      id: "upload",
      description: "Create the hosted session and upload source docs without starting agent work.",
      uploadDocs: true,
      prompts: [],
      expectedPromptCount: 0,
      requiredArtifacts: [],
      requireUploadedDocuments: true,
      expectDeliverable: false,
      settleOptions: {
        timeoutMs: 240_000,
        noProgressTimeoutMs: 120_000,
        quietMs: 5_000,
        useWorkspaceEventStream: false,
      },
    };
  }

  if (normalizedStage === "intake") {
    return {
      id: "intake",
      description: "Upload source docs and stop after intake bootstrap artifacts exist.",
      uploadDocs: true,
      prompts: [buildIntakeOnlyPrompt(scenario)],
      expectedPromptCount: 1,
      requiredArtifacts: [
        ".worktree/index.json",
        ".worktree/sources/manifest.json",
      ],
      requireUploadedDocuments: true,
      expectDeliverable: false,
      settleOptions: {
        timeoutMs: 180_000,
        noProgressTimeoutMs: 60_000,
        quietMs: 8_000,
        useWorkspaceEventStream: true,
      },
    };
  }

  if (normalizedStage === "plan") {
    return {
      id: "plan",
      description: "Upload source docs and stop after planning artifacts exist.",
      uploadDocs: true,
      prompts: [buildPlanOnlyPrompt(scenario)],
      expectedPromptCount: 1,
      requiredArtifacts: [
        ".worktree/index.json",
        ".worktree/sources/manifest.json",
        ".worktree/facts.json",
        ".worktree/merge/conflicts.json",
        ".worktree/plan/solution-plan.json",
        ".worktree/coverage.json",
      ],
      requireUploadedDocuments: true,
      expectDeliverable: false,
      settleOptions: {
        timeoutMs: 300_000,
        noProgressTimeoutMs: 90_000,
        quietMs: 10_000,
        useWorkspaceEventStream: true,
      },
    };
  }

  return {
    id: "full",
    description: "Run the scenario's full hosted A/B prompt sequence.",
    uploadDocs: true,
    prompts: Array.isArray(scenario?.prompts) ? scenario.prompts : [],
    expectedPromptCount: Array.isArray(scenario?.prompts) ? scenario.prompts.length : 0,
    requiredArtifacts: [
      ".worktree/index.json",
      ".worktree/sources/manifest.json",
      ".worktree/facts.json",
      ".worktree/merge/conflicts.json",
      ".worktree/plan/solution-plan.json",
      ".worktree/coverage.json",
      ".worktree/verify/coverage.json",
    ],
    requireUploadedDocuments: true,
    expectDeliverable: true,
    settleOptions: {
      timeoutMs: 900_000,
      noProgressTimeoutMs: 180_000,
      quietMs: 15_000,
      useWorkspaceEventStream: false,
    },
  };
}

export function validateDocumentWorkflowCompareStageResult({
  stagePlan,
  expectedOutput,
  expectedDocumentCount = 0,
  promptRuns,
  finalDocuments,
}) {
  const errors = [];
  const warnings = [];
  const promptRunList = Array.isArray(promptRuns) ? promptRuns : [];
  const documentNames = Array.isArray(finalDocuments)
    ? finalDocuments.map((item) => item?.name).filter((name) => typeof name === "string" && name)
    : [];
  const artifactFiles = unique([
    ...promptRunList.flatMap((promptRun) =>
      Array.isArray(promptRun?.artifactTouches?.files) ? promptRun.artifactTouches.files : []
    ),
    ...documentNames,
  ]);
  const observedState = summarizeArtifactFiles(artifactFiles, expectedOutput);

  if (promptRunList.length !== (stagePlan?.expectedPromptCount ?? promptRunList.length)) {
    errors.push(
      `Stage ${stagePlan?.id ?? "unknown"} expected ${stagePlan?.expectedPromptCount ?? 0} prompt runs, but observed ${promptRunList.length}.`,
    );
  }

  if ((stagePlan?.requireUploadedDocuments ?? false) && documentNames.length < expectedDocumentCount) {
    errors.push(
      `Stage ${stagePlan?.id ?? "unknown"} observed ${documentNames.length}/${expectedDocumentCount} uploaded session documents.`,
    );
  }

  for (const artifactPath of stagePlan?.requiredArtifacts ?? []) {
    if (!observedState.files.includes(artifactPath)) {
      errors.push(`Stage plan is missing required artifact: ${artifactPath}`);
    }
  }

  if (stagePlan?.expectDeliverable) {
    if (expectedOutput && !observedState.hasExpectedOutput) {
      errors.push(`Stage plan is missing the expected deliverable: ${expectedOutput}`);
    }
  } else if (expectedOutput && observedState.hasExpectedOutput) {
    warnings.push(`Stage plan produced a downstream deliverable earlier than expected: ${expectedOutput}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    observedState,
  };
}
