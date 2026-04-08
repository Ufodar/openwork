import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = "./.opencode/runtime-support/document-state/plan_doc_state.py";

test("plan_doc_state.py preserves explicit section contracts from intent.json", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-plan-intent-contract-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "index.json"),
      JSON.stringify({
        summary: "起草正式材料",
        target_doc: "outputs/final.docx",
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "intent.json"),
      JSON.stringify({
        version: 1,
        goal: "请形成正式技术材料。",
        target_doc: "outputs/final.docx",
        deliverable_format: "docx",
        sections: [
          {
            id: "resource-system",
            title: "统一资源接入系统",
            required_subsections: ["功能定位", "技术架构"],
            evidence_topics: ["resource-aggregation"],
          },
          {
            id: "security-system",
            title: "运行监测与审计系统",
            required_subsections: ["功能定位", "互联互通机制"],
            evidence_topics: ["security-monitoring"],
          },
        ],
        must_preserve_titles: ["统一资源接入系统", "运行监测与审计系统"],
        evidence_posture: "separate-facts-from-examples",
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "请形成正式技术材料。",
        target_doc: "outputs/final.docx",
        sources: [{ title: "正式技术文档" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "facts.json"),
      JSON.stringify({
        canonical_facts: [
          {
            topic: "resource-aggregation",
            statement: "平台支持统一接入多类资源并形成标准目录。",
            sources: [{ title: "正式技术文档", locator: "paragraph:12" }],
          },
          {
            topic: "security-monitoring",
            statement: "平台支持审计日志、异常任务识别和资源滥用告警。",
            sources: [{ title: "正式技术文档", locator: "paragraph:25" }],
          },
          {
            topic: "general",
            statement: "该材料还包含背景说明。",
            sources: [{ title: "正式技术文档", locator: "paragraph:2" }],
          },
        ],
        source_briefs: [
          {
            docId: "src-001",
            title: "正式技术文档",
            relativePath: "正式技术文档.docx",
            sections: [
              {
                title: "资源接入能力",
                summary: "说明统一接入能力。",
                topic: "resource-aggregation",
              },
              {
                title: "安全监测能力",
                summary: "说明审计和监测能力。",
                topic: "security-monitoring",
              },
            ],
          },
        ],
        gaps: ["缺少最新版本号。"],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "merge", "conflicts.json"),
      JSON.stringify({
        conflicts: [
          { topic: "security-monitoring", rationale: "日志保留周期未统一。" },
        ],
        open_questions: ["是否需要单列参考与依据？"],
      }, null, 2),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const plan = JSON.parse(await readFile(join(workspace, ".worktree", "plan", "solution-plan.json"), "utf8"));
    const coverage = JSON.parse(await readFile(join(workspace, ".worktree", "coverage.json"), "utf8"));

    expect(plan.goal).toBe("请形成正式技术材料。");
    expect(plan.target_doc).toBe("outputs/final.docx");
    expect(plan.sections.map((item) => item.title)).toEqual([
      "统一资源接入系统",
      "运行监测与审计系统",
    ]);
    expect(plan.sections[0].required_subsections).toEqual(["功能定位", "技术架构"]);
    expect(plan.sections[0].required_evidence.map((item) => item.statement)).toEqual([
      "平台支持统一接入多类资源并形成标准目录。",
    ]);
    expect(plan.sections[0].source_context_refs[0].section_titles).toEqual(["资源接入能力"]);
    expect(plan.sections[1].required_evidence.map((item) => item.statement)).toEqual([
      "平台支持审计日志、异常任务识别和资源滥用告警。",
    ]);
    expect(coverage.targets.map((item) => item.title)).toEqual([
      "统一资源接入系统",
      "运行监测与审计系统",
    ]);
    expect(coverage.risks.map((item) => item.reason)).toContain("日志保留周期未统一。");
    expect(coverage.risks.map((item) => item.reason)).toContain("缺少最新版本号。");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("plan_doc_state.py falls back to generic sections when no explicit intent contract exists", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-plan-generic-fallback-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });

    await writeFile(join(workspace, ".worktree", "index.json"), JSON.stringify({ summary: "整理一份建设方案" }, null, 2), "utf8");
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "请形成建设方案，围绕多个系统展开，并给出 API 调用示例。",
        sources: [{ title: "项目资料" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "facts.json"),
      JSON.stringify({
        canonical_facts: [
          { topic: "general", statement: "平台支持统一接入能力。", sources: [{ title: "项目资料" }] },
          { topic: "general", statement: "平台支持统一监控能力。", sources: [{ title: "项目资料" }] },
        ],
        source_briefs: [],
        gaps: [],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const plan = JSON.parse(await readFile(join(workspace, ".worktree", "plan", "solution-plan.json"), "utf8"));
    expect(plan.sections.map((item) => item.title)).toEqual([
      "执行摘要",
      "主体内容",
      "待确认事项",
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
