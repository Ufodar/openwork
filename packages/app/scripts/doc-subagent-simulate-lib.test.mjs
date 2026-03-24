import { describe, expect, test } from "bun:test";

import {
  extractMarkdownHeadings,
  summarizeArtifactFiles,
  validateScenarioResult,
} from "./doc-subagent-simulate-lib.mjs";

const scenario = {
  id: "ly-structured-plan",
  docs: ["a.docx", "b.pdf", "c.docx"],
  expectedOutput: "outputs/ly-solution.md",
  prompts: [() => "", () => "", () => ""],
  requiredHeadingsByPrompt: [
    [],
    ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项"],
    ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项", "实施里程碑与协作分工"],
  ],
};

describe("summarizeArtifactFiles", () => {
  test("counts compiled sources and phase artifacts", () => {
    const summary = summarizeArtifactFiles([
      ".worktree/index.json",
      ".worktree/sources/manifest.json",
      ".worktree/sources/doc-a.json",
      ".worktree/sources/doc-b.json",
      ".worktree/facts.json",
      ".worktree/merge/conflicts.json",
      ".worktree/plan/solution-plan.json",
      ".worktree/coverage.json",
      "outputs/ly-solution.md",
      ".worktree/verify/coverage.json",
    ], scenario.expectedOutput);

    expect(summary.sourceArtifactCount).toBe(2);
    expect(summary.hasFacts).toBe(true);
    expect(summary.hasPlan).toBe(true);
    expect(summary.hasExpectedOutput).toBe(true);
    expect(summary.hasVerifyCoverage).toBe(true);
  });
});

describe("extractMarkdownHeadings", () => {
  test("extracts heading text from markdown", () => {
    expect(extractMarkdownHeadings("# 标题\n\n## 二、项目理解\n正文\n### 2.1 方案")).toEqual([
      "标题",
      "二、项目理解",
      "2.1 方案",
    ]);
  });
});

describe("validateScenarioResult", () => {
  test("fails bootstrap-only runs that never advanced beyond intake", () => {
    const result = {
      scenarioId: scenario.id,
      promptRuns: [
        {
          taskCalls: [],
          assistantText: "",
          toolErrors: [],
          state: summarizeArtifactFiles([
            ".worktree/index.json",
            ".worktree/sources/manifest.json",
          ], scenario.expectedOutput),
        },
      ],
      keyFiles: [
        ".worktree/index.json",
        ".worktree/sources/manifest.json",
      ],
    };

    const validation = validateScenarioResult(scenario, result);

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain(
      "Prompt 1 did not launch any subagent tasks and produced no assistant receipt.",
    );
    expect(validation.errors).toContain(
      "Prompt 1 did not produce all required planning artifacts.",
    );
    expect(validation.errors).toContain(
      "Final workspace snapshot is missing the expected deliverable: outputs/ly-solution.md",
    );
  });

  test("fails provider/system-message runs even if the process itself did not throw", () => {
    const result = {
      scenarioId: scenario.id,
      promptRuns: [
        {
          taskCalls: [],
          assistantText: "System message must be at the beginning.",
          toolErrors: [],
          state: summarizeArtifactFiles([], scenario.expectedOutput),
        },
      ],
      keyFiles: [],
    };

    const validation = validateScenarioResult(scenario, result);

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain(
      'Prompt 1 surfaced a fatal model/runtime error: "System message must be at the beginning."',
    );
  });

  test("passes when all expected phases and artifacts are present", () => {
    const prompt1State = summarizeArtifactFiles([
      ".worktree/index.json",
      ".worktree/sources/manifest.json",
      ".worktree/sources/doc-a.json",
      ".worktree/sources/doc-b.json",
      ".worktree/sources/doc-c.json",
      ".worktree/facts.json",
      ".worktree/merge/conflicts.json",
      ".worktree/plan/solution-plan.json",
      ".worktree/coverage.json",
    ], scenario.expectedOutput);

    const prompt2State = summarizeArtifactFiles([
      ...prompt1State.files,
      "outputs/ly-solution.md",
      ".worktree/verify/coverage.json",
    ], scenario.expectedOutput);

    const result = {
      scenarioId: scenario.id,
      promptRuns: [
        {
          taskCalls: [
            { agent: "doc-reader" },
            { agent: "doc-reader" },
            { agent: "doc-reader" },
            { agent: "doc-merger" },
            { agent: "doc-planner" },
          ],
          assistantText: "已完成 state 生成。",
          toolErrors: [],
          state: prompt1State,
        },
        {
          taskCalls: [
            { agent: "doc-writer" },
            { agent: "doc-verifier" },
          ],
          assistantText: "已完成写作与验证。",
          toolErrors: [],
          state: prompt2State,
          outputHeadings: ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项"],
        },
        {
          taskCalls: [
            { agent: "doc-writer" },
            { agent: "doc-verifier" },
          ],
          assistantText: "已完成 follow-up。",
          toolErrors: [],
          state: prompt2State,
          outputHeadings: ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项", "实施里程碑与协作分工"],
        },
      ],
      keyFiles: prompt2State.files,
    };

    const validation = validateScenarioResult(scenario, result);

    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  test("accepts completed task calls even when the agent name could not be parsed", () => {
    const prompt1State = summarizeArtifactFiles([
      ".worktree/index.json",
      ".worktree/sources/manifest.json",
      ".worktree/sources/doc-a.json",
      ".worktree/sources/doc-b.json",
      ".worktree/sources/doc-c.json",
      ".worktree/facts.json",
      ".worktree/merge/conflicts.json",
      ".worktree/plan/solution-plan.json",
      ".worktree/coverage.json",
    ], scenario.expectedOutput);
    const finalState = summarizeArtifactFiles([
      ...prompt1State.files,
      ".worktree/verify/coverage.json",
      "outputs/ly-solution.md",
    ], scenario.expectedOutput);

    const validation = validateScenarioResult(scenario, {
      scenarioId: scenario.id,
      promptRuns: [
        {
          taskCalls: [{ agent: null }, { agent: null }],
          assistantText: "state complete",
          toolErrors: [],
          state: prompt1State,
        },
        {
          taskCalls: [{ agent: null }],
          assistantText: "draft complete",
          toolErrors: [],
          state: finalState,
          outputHeadings: ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项"],
        },
        {
          taskCalls: [{ agent: null }],
          assistantText: "follow-up complete",
          toolErrors: [],
          state: finalState,
          outputHeadings: ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项", "实施里程碑与协作分工"],
        },
      ],
      keyFiles: finalState.files,
    });

    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  test("fails when output headings do not match required section titles", () => {
    const prompt1State = summarizeArtifactFiles([
      ".worktree/index.json",
      ".worktree/sources/manifest.json",
      ".worktree/sources/doc-a.json",
      ".worktree/sources/doc-b.json",
      ".worktree/sources/doc-c.json",
      ".worktree/facts.json",
      ".worktree/merge/conflicts.json",
      ".worktree/plan/solution-plan.json",
      ".worktree/coverage.json",
    ], scenario.expectedOutput);
    const finalState = summarizeArtifactFiles([
      ...prompt1State.files,
      ".worktree/verify/coverage.json",
      "outputs/ly-solution.md",
    ], scenario.expectedOutput);

    const validation = validateScenarioResult(scenario, {
      scenarioId: scenario.id,
      promptRuns: [
        {
          taskCalls: [{ agent: "doc-reader" }],
          assistantText: "state complete",
          toolErrors: [],
          state: prompt1State,
          outputHeadings: [],
        },
        {
          taskCalls: [{ agent: "doc-writer" }, { agent: "doc-verifier" }],
          assistantText: "draft complete",
          toolErrors: [],
          state: finalState,
          outputHeadings: ["项目理解", "点对点方案", "证据说明", "待确认项"],
        },
        {
          taskCalls: [{ agent: "doc-writer" }, { agent: "doc-verifier" }],
          assistantText: "follow-up complete",
          toolErrors: [],
          state: finalState,
          outputHeadings: ["项目理解", "点对点方案", "证据说明", "待确认项", "实施计划"],
        },
      ],
      keyFiles: finalState.files,
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("Prompt 2 is missing required output heading: 点对点解决路径");
    expect(validation.errors).toContain("Prompt 3 is missing required output heading: 实施里程碑与协作分工");
  });

  test("fails when orchestration drifts into non-doc subagents", () => {
    const prompt1State = summarizeArtifactFiles([
      ".worktree/index.json",
      ".worktree/sources/manifest.json",
      ".worktree/sources/doc-a.json",
      ".worktree/sources/doc-b.json",
      ".worktree/sources/doc-c.json",
      ".worktree/facts.json",
      ".worktree/merge/conflicts.json",
      ".worktree/plan/solution-plan.json",
      ".worktree/coverage.json",
      ".worktree/verify/coverage.json",
      "outputs/ly-solution.md",
    ], scenario.expectedOutput);

    const validation = validateScenarioResult(scenario, {
      scenarioId: scenario.id,
      promptRuns: [
        {
          taskCalls: [{ agent: "doc-reader" }, { agent: "doc-merger" }, { agent: "doc-planner" }],
          assistantText: "state complete",
          toolErrors: [],
          state: prompt1State,
          outputHeadings: [],
        },
        {
          taskCalls: [{ agent: "doc-writer" }, { agent: "general-purpose" }, { agent: "doc-verifier" }],
          assistantText: "draft complete",
          toolErrors: [],
          state: prompt1State,
          outputHeadings: ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项"],
        },
        {
          taskCalls: [{ agent: "doc-writer" }, { agent: "doc-verifier" }],
          assistantText: "follow-up complete",
          toolErrors: [],
          state: prompt1State,
          outputHeadings: ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项", "实施里程碑与协作分工"],
        },
      ],
      keyFiles: prompt1State.files,
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("Observed unexpected non-doc subagents: general-purpose");
  });
});
