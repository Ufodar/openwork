import { describe, expect, test } from "bun:test";

import {
  buildDocumentWorkflowCompareStagePlan,
  normalizeDocumentWorkflowCompareStage,
  validateDocumentWorkflowCompareStageResult,
} from "./document-workflow-compare-stages.mjs";

const scenario = {
  id: "formal-example",
  title: "正式文档样例",
  expectedOutput: "outputs/final.md",
  docs: ["a.docx", "b.docx"],
  prompts: ["first prompt", "second prompt"],
};

describe("normalizeDocumentWorkflowCompareStage", () => {
  test("defaults empty input to full and normalizes casing", () => {
    expect(normalizeDocumentWorkflowCompareStage()).toBe("full");
    expect(normalizeDocumentWorkflowCompareStage(" Plan ")).toBe("plan");
    expect(normalizeDocumentWorkflowCompareStage("RUNTIME")).toBe("runtime");
  });

  test("rejects unsupported stage names", () => {
    expect(() => normalizeDocumentWorkflowCompareStage("writer-only")).toThrow(
      'Unsupported compare stage "writer-only"',
    );
  });
});

describe("buildDocumentWorkflowCompareStagePlan", () => {
  test("builds an upload-only probe that isolates transport cost from agent work", () => {
    const plan = buildDocumentWorkflowCompareStagePlan({ scenario, stage: "upload" });

    expect(plan.id).toBe("upload");
    expect(plan.uploadDocs).toBe(true);
    expect(plan.prompts).toEqual([]);
    expect(plan.requireUploadedDocuments).toBe(true);
    expect(plan.expectDeliverable).toBe(false);
    expect(plan.settleOptions.timeoutMs).toBeLessThan(600_000);
  });

  test("builds a runtime-only probe that skips uploads and prompts", () => {
    const plan = buildDocumentWorkflowCompareStagePlan({ scenario, stage: "runtime" });

    expect(plan.id).toBe("runtime");
    expect(plan.uploadDocs).toBe(false);
    expect(plan.prompts).toEqual([]);
    expect(plan.expectedPromptCount).toBe(0);
    expect(plan.settleOptions.useWorkspaceEventStream).toBe(false);
    expect(plan.settleOptions.timeoutMs).toBeLessThan(60_000);
  });

  test("builds an intake-only probe that stops before planning or drafting", () => {
    const plan = buildDocumentWorkflowCompareStagePlan({ scenario, stage: "intake" });

    expect(plan.prompts).toHaveLength(1);
    expect(plan.prompts[0]).toContain(".worktree/index.json");
    expect(plan.prompts[0]).toContain(".worktree/sources/manifest.json");
    expect(plan.prompts[0]).toContain("必须现在就实际执行");
    expect(plan.prompts[0]).toContain("不要继续到 facts");
    expect(plan.prompts[0]).toContain("不要写 outputs/**");
    expect(plan.prompts[0]).toContain("只有当上述 intake artifacts 已实际存在时才允许结束本轮");
    expect(plan.requiredArtifacts).toEqual([
      ".worktree/index.json",
      ".worktree/sources/manifest.json",
    ]);
    expect(plan.settleOptions.useWorkspaceEventStream).toBe(true);
    expect(plan.settleOptions.noProgressTimeoutMs).toBeLessThan(90_000);
  });

  test("builds a plan-only probe that requires planning artifacts but forbids drafting", () => {
    const plan = buildDocumentWorkflowCompareStagePlan({ scenario, stage: "plan" });

    expect(plan.prompts).toHaveLength(1);
    expect(plan.prompts[0]).toContain("这不是盘点题，也不是咨询题");
    expect(plan.prompts[0]).toContain(".worktree/facts.json");
    expect(plan.prompts[0]).toContain(".worktree/merge/conflicts.json");
    expect(plan.prompts[0]).toContain(".worktree/plan/solution-plan.json");
    expect(plan.prompts[0]).toContain(".worktree/coverage.json");
    expect(plan.prompts[0]).toContain("doc-intake / doc-reader / doc-merger / doc-planner");
    expect(plan.prompts[0]).toContain("不要生成最终 deliverable");
    expect(plan.prompts[0]).toContain("不要写 outputs/**");
    expect(plan.prompts[0]).toContain("不要询问是否继续");
    expect(plan.requiredArtifacts).toEqual([
      ".worktree/index.json",
      ".worktree/sources/manifest.json",
      ".worktree/facts.json",
      ".worktree/merge/conflicts.json",
      ".worktree/plan/solution-plan.json",
      ".worktree/coverage.json",
    ]);
    expect(plan.settleOptions.useWorkspaceEventStream).toBe(true);
    expect(plan.settleOptions.timeoutMs).toBeLessThan(600_000);
  });
});

describe("validateDocumentWorkflowCompareStageResult", () => {
  test("accepts a successful plan-stage result and flags overshoot as a warning", () => {
    const stagePlan = buildDocumentWorkflowCompareStagePlan({ scenario, stage: "plan" });
    const validation = validateDocumentWorkflowCompareStageResult({
      stagePlan,
      expectedOutput: scenario.expectedOutput,
      promptRuns: [
        {
          artifactTouches: {
            files: [
              ".worktree/index.json",
              ".worktree/sources/manifest.json",
              ".worktree/facts.json",
              ".worktree/merge/conflicts.json",
              ".worktree/plan/solution-plan.json",
              ".worktree/coverage.json",
              "outputs/final.md",
            ],
          },
        },
      ],
      finalDocuments: [{ name: "outputs/final.md" }],
    });

    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toContain(
      "Stage plan produced a downstream deliverable earlier than expected: outputs/final.md",
    );
  });

  test("fails when a required stage artifact is missing", () => {
    const stagePlan = buildDocumentWorkflowCompareStagePlan({ scenario, stage: "plan" });
    const validation = validateDocumentWorkflowCompareStageResult({
      stagePlan,
      expectedOutput: scenario.expectedOutput,
      promptRuns: [
        {
          artifactTouches: {
            files: [
              ".worktree/index.json",
              ".worktree/sources/manifest.json",
              ".worktree/facts.json",
              ".worktree/coverage.json",
            ],
          },
        },
      ],
      finalDocuments: [],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain(
      "Stage plan is missing required artifact: .worktree/merge/conflicts.json",
    );
    expect(validation.errors).toContain(
      "Stage plan is missing required artifact: .worktree/plan/solution-plan.json",
    );
  });

  test("fails upload stage when hosted documents never appeared in the session", () => {
    const stagePlan = buildDocumentWorkflowCompareStagePlan({ scenario, stage: "upload" });
    const validation = validateDocumentWorkflowCompareStageResult({
      stagePlan,
      expectedOutput: scenario.expectedOutput,
      expectedDocumentCount: scenario.docs.length,
      promptRuns: [],
      finalDocuments: [],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain(
      "Stage upload observed 0/2 uploaded session documents.",
    );
  });
});
