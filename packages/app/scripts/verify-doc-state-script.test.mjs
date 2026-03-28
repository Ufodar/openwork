import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const scriptPath = "./.opencode/runtime-support/document-state/verify_doc_state.py";

test("verify_doc_state.py writes verifier state and a report for a drafted markdown deliverable", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });
    await mkdir(join(workspace, "reports", "doc-verifier"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        sections: [
          { id: "project-understanding", title: "项目理解" },
          { id: "solution-route", title: "点对点解决路径" },
          { id: "evidence-assumptions", title: "证据来源与假设" },
          { id: "risk-open-questions", title: "风险与待确认项" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "coverage.json"),
      JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "facts.json"),
      JSON.stringify({ canonical_facts: [{ id: "cf-1", topic: "general", statement: "项目背景" }] }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "merge", "conflicts.json"),
      JSON.stringify({
        conflicts: [{ id: "conflict-1", topic: "液冷要求", unresolved: true }],
        open_questions: ["评分标准需要确认"],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 项目理解",
        "",
        "正文",
        "",
        "# 点对点解决路径",
        "",
        "正文",
        "",
        "# 证据来源与假设",
        "",
        "假设：部分评分细则待补充。",
        "",
        "# 风险与待确认项",
        "",
        "存在风险。",
        "",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--report-out", "reports/doc-verifier/check.md",
      "--required-section", "项目理解",
      "--required-section", "点对点解决路径",
      "--required-section", "证据来源与假设",
      "--required-section", "风险与待确认项",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );
    const report = await readFile(join(workspace, "reports", "doc-verifier", "check.md"), "utf8");

    expect(verifyState.required_sections).toEqual([
      "项目理解",
      "点对点解决路径",
      "证据来源与假设",
      "风险与待确认项",
    ]);
    expect(verifyState.ok).toBe(true);
    expect(verifyState.missing_sections).toEqual([]);
    expect(verifyState.confirmed_sections).toEqual([
      "项目理解",
      "点对点解决路径",
      "证据来源与假设",
      "风险与待确认项",
    ]);
    expect(report).toContain("已检查章节");
    expect(report).toContain("检测到的标题");
    expect(report).toContain("液冷要求");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py requires exact heading matches for required sections", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-strict-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(join(workspace, ".worktree", "plan", "solution-plan.json"), JSON.stringify({ sections: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 项目理解",
        "",
        "## 需求拆解与点对点对应",
        "",
        "文中提到证据与约束，但不是标题。",
        "",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "项目理解",
      "--required-section", "需求拆解",
      "--required-section", "点对点对应方案",
      "--required-section", "证据与约束",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("\"ok\": false");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(verifyState.ok).toBe(false);
    expect(verifyState.confirmed_sections).toEqual(["项目理解"]);
    expect(verifyState.missing_sections).toEqual(["需求拆解", "点对点对应方案", "证据与约束"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py accepts numbered chapter prefixes when the required system title remains intact", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-numbered-headings-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        sections: [
          { id: "aggregation", title: "算力资源汇聚系统" },
          { id: "scheduling", title: "算力选择与调度系统" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 第一章 算力资源汇聚系统",
        "",
        "正文",
        "",
        "# 第二章 算力选择与调度系统",
        "",
        "正文",
        "",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "算力资源汇聚系统",
      "--required-section", "算力选择与调度系统",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );
    const riskTopics = verifyState.remaining_risks.map((item) => item.topic);

    expect(verifyState.ok).toBe(true);
    expect(verifyState.missing_sections).toEqual([]);
    expect(verifyState.confirmed_sections).toEqual([
      "算力资源汇聚系统",
      "算力选择与调度系统",
    ]);
    expect(riskTopics).toContain("manual-heading-numbering");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags duplicate heading numbering when manual prefixes stack on structural headings", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-duplicate-heading-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        sections: [
          { id: "aggregation", title: "算力资源汇聚系统" },
          { id: "architecture", title: "技术架构" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 1.2 第一章 算力资源汇聚系统",
        "",
        "正文",
        "",
        "## 1.2.1 1.1 技术架构",
        "",
        "正文",
        "",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "算力资源汇聚系统",
      "--required-section", "技术架构",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );
    const riskTopics = verifyState.remaining_risks.map((item) => item.topic);

    expect(verifyState.ok).toBe(true);
    expect(riskTopics).toContain("duplicate-heading-numbering");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py accepts nested numeric prefixes before chapter labels and subsection titles", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-double-prefix-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        sections: [
          { id: "aggregation", title: "算力资源汇聚系统" },
          { id: "route", title: "技术路线" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 1.2 第一章 算力资源汇聚系统",
        "",
        "正文",
        "",
        "## 1.3 技术路线",
        "",
        "正文",
        "",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "算力资源汇聚系统",
      "--required-section", "技术路线",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );
    const riskTopics = verifyState.remaining_risks.map((item) => item.topic);

    expect(verifyState.ok).toBe(true);
    expect(verifyState.missing_sections).toEqual([]);
    expect(verifyState.confirmed_sections).toEqual([
      "算力资源汇聚系统",
      "技术路线",
    ]);
    expect(riskTopics).toContain("manual-heading-numbering");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags manual heading numbering even when a docx uses real heading styles", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-docx-manual-heading-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        sections: [
          { id: "aggregation", title: "算力资源汇聚系统" },
          { id: "positioning", title: "功能定位" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");

    const buildDoc = Bun.spawn([
      "python3",
      "-c",
      [
        "from docx import Document",
        "doc = Document()",
        "doc.add_heading('一、算力资源汇聚系统', level=1)",
        "doc.add_heading('1.1 功能定位', level=2)",
        "doc.add_paragraph('正文')",
        `doc.save(r'${join(workspace, "outputs", "sample.docx")}')`,
      ].join("; "),
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildExitCode = await buildDoc.exited;
    expect(buildExitCode).toBe(0);

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.docx",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "算力资源汇聚系统",
      "--required-section", "功能定位",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );
    const riskTopics = verifyState.remaining_risks.map((item) => item.topic);

    expect(verifyState.ok).toBe(true);
    expect(verifyState.confirmed_sections).toEqual([
      "算力资源汇聚系统",
      "功能定位",
    ]);
    expect(riskTopics).toContain("manual-heading-numbering");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags unsourced administrative cover metadata in proposal-style docx deliverables", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-docx-cover-meta-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "请结合参考文档生成项目申报技术材料。",
        sections: [
          { id: "aggregation", title: "算力资源汇聚系统" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, ".worktree", "facts.json"),
      JSON.stringify({
        canonical_facts: [
          { id: "cf-1", statement: "方案围绕算力资源汇聚系统展开。", sources: [] },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");

    const buildDoc = Bun.spawn([
      "python3",
      "-c",
      [
        "from docx import Document",
        "doc = Document()",
        "doc.add_heading('项目申报技术材料', level=1)",
        "doc.add_paragraph('项目编号：TH-CPC-2026-001')",
        "doc.add_paragraph('申报单位：天河算力技术研究院')",
        "doc.add_paragraph('申报日期：2026年3月')",
        "doc.add_heading('算力资源汇聚系统', level=1)",
        "doc.add_paragraph('正文')",
        `doc.save(r'${join(workspace, "outputs", "sample.docx")}')`,
      ].join("; "),
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildExitCode = await buildDoc.exited;
    expect(buildExitCode).toBe(0);

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.docx",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "算力资源汇聚系统",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(
      verifyState.remaining_risks.some((item) => item.topic === "unsourced-administrative-metadata"),
    ).toBe(true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py rejects text masquerading as a .docx deliverable", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-fake-docx-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({ sections: [{ id: "summary", title: "执行摘要" }] }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "fake.docx"),
      "const { Document } = require('docx');\nconsole.log('not a zip package');\n",
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/fake.docx",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "执行摘要",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": false");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(verifyState.ok).toBe(false);
    expect(verifyState.target_format_valid).toBe(false);
    expect(verifyState.remaining_risks.some((item) => String(item.reason || "").includes("不是合法的 .docx"))).toBe(true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags low-authority external supplement sources when联网补充 was requested", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-supplements-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });
    await mkdir(join(workspace, "reports", "doc-writer"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "请结合参考文档并联网补充政策依据，生成项目申报材料。",
        sections: [{ id: "summary", title: "执行摘要" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(join(workspace, "outputs", "sample.md"), "# 执行摘要\n\n正文\n", "utf8");
    await writeFile(
      join(workspace, "reports", "doc-writer", "external-supplements.md"),
      [
        "# 外部补充",
        "",
        "- 来源 1: https://www.zhihu.com/question/123456",
        "- 来源 2: https://max.book118.com/html/2023/0101/123456.shtm",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "执行摘要",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(
      verifyState.remaining_risks.some((item) => item.topic === "low-authority-external-sources"),
    ).toBe(true);
    expect(
      verifyState.remaining_risks.some((item) => JSON.stringify(item.domains ?? []).includes("zhihu.com")),
    ).toBe(true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags concrete technology terms that are not backed by facts or supplements", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-concrete-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "请结合参考文档生成技术材料。",
        sections: [{ id: "summary", title: "执行摘要" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, ".worktree", "facts.json"),
      JSON.stringify({
        canonical_facts: [
          { id: "cf-1", statement: "系统采用 RESTful API 与统一资源模型。", sources: [] },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 执行摘要",
        "",
        "系统通过消息队列和事件总线实现跨系统数据同步，并暴露 OpenAPI 3.0 文档。",
        "",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "执行摘要",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(
      verifyState.remaining_risks.some((item) => item.topic === "weakly-supported-concrete-term" && item.term === "消息队列"),
    ).toBe(true);
    expect(
      verifyState.remaining_risks.some((item) => item.topic === "weakly-supported-concrete-term" && item.term === "OpenAPI 3.0"),
    ).toBe(true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py accepts composite technology terms when support text contains the same vendor and capability tokens", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-supported-composite-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });
    await mkdir(join(workspace, "reports", "doc-writer"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "请结合参考文档并联网补充官方资料生成技术材料。",
        sections: [{ id: "summary", title: "执行摘要" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 执行摘要",
        "",
        "平台可基于 NVIDIA MIG 对 GPU 进行细粒度资源切分与隔离。",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(workspace, "reports", "doc-writer", "external-supplements.md"),
      [
        "# 外部补充",
        "",
        "- 标题: MIG User Guide — NVIDIA Multi-Instance GPU User Guide",
        "- URL: https://docs.nvidia.com/datacenter/tesla/mig-user-guide/index.html",
        "- 摘要: NVIDIA 官方文档介绍 MIG 的资源切分机制。",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "执行摘要",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(
      verifyState.remaining_risks.some((item) => item.topic === "weakly-supported-concrete-term" && item.term === "NVIDIA MIG"),
    ).toBe(false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags plan schema mismatch and still derives required sections from custom system/module targets", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-plan-schema-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "请结合参考文档生成项目申报技术材料。",
        sections: [
          {
            system: "算力资源汇聚系统",
            modules: [
              { name: "技术架构", key_facts: ["中心-机房-终端三级架构"] },
            ],
          },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "coverage.json"),
      JSON.stringify({
        targets: [
          {
            system: "算力资源汇聚系统",
            modules: [{ name: "技术架构", required: true }],
          },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 算力资源汇聚系统",
        "",
        "## 技术架构",
        "",
        "正文",
        "",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(verifyState.required_sections).toEqual([
      "算力资源汇聚系统",
      "技术架构",
    ]);
    expect(
      verifyState.remaining_risks.some((item) => item.topic === "plan-schema-mismatch"),
    ).toBe(true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags commercial noise in proposal-style technical materials", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-commercial-noise-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "请结合参考文档生成项目申报技术材料。",
        sections: [{ id: "summary", title: "算力资源汇聚系统" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 算力资源汇聚系统",
        "",
        "平台上的每一个商品对应背后一个特定资源池，用户充值后即可按需调用算力服务。",
        "",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "算力资源汇聚系统",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(
      verifyState.remaining_risks.some((item) => item.topic === "commercial-noise"),
    ).toBe(true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags low-authority supplement domains and community article paths seen in real proposal runs", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-real-low-authority-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });
    await mkdir(join(workspace, "reports", "doc-writer"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "请结合参考文档并联网补充政策依据，生成项目申报技术材料。",
        sections: [{ id: "system-1", title: "算力资源汇聚系统" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(join(workspace, "outputs", "sample.md"), "# 算力资源汇聚系统\n\n正文\n", "utf8");
    await writeFile(
      join(workspace, "reports", "doc-writer", "external-supplements.md"),
      [
        "# 外部资料补充记录",
        "",
        "- https://baike.baidu.com/item/等保三级/67350064",
        "- https://blog.csdn.net/2403_86962125/article/details/148107683",
        "- https://developer.baidu.com/article/detail.html?id=4618723",
        "- https://juejin.cn/post/7400195628846137380",
        "- https://www.imooc.com/article/338969",
        "- https://cloud.tencent.com/developer/article/2395622",
        "- https://www.360doc.cn/article/0_1116989168.md",
        "- https://www.163.com/dy/article/JBV915H105567RPH.html",
        "- https://www.sohu.com/a/841851819_121798711",
        "- https://new.qq.com/rain/a/20250530A056SE00",
        "- https://www.safehoo.com/Standard/Trade/Electric/202407/5742031.shtml",
        "- http://www.txrjy.com/thread-1365861-1-1.html",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "算力资源汇聚系统",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("\"ok\": true");

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    const lowAuthority = verifyState.remaining_risks.find((item) => item.topic === "low-authority-external-sources");
    expect(lowAuthority).toBeTruthy();
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("baike.baidu.com");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("blog.csdn.net");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("developer.baidu.com");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("juejin.cn");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("imooc.com");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("cloud.tencent.com");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("360doc.cn");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("163.com");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("sohu.com");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("new.qq.com");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("safehoo.com");
    expect(JSON.stringify(lowAuthority.domains ?? [])).toContain("txrjy.com");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags a generic future-search placeholder when concrete supplements were already gathered", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-unsurfaced-supplements-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });
    await mkdir(join(workspace, "reports", "doc-writer"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "请结合参考文档以及联网补充资料生成项目申报技术材料。",
        sections: [{ id: "system-1", title: "参考与依据" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 参考与依据",
        "",
        "## 联网补充依据",
        "",
        "本文档在编写过程中，主要基于已上传文档整理。如需进一步补充，建议进行针对性联网检索。",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(workspace, "reports", "doc-writer", "external-supplements.md"),
      [
        "# 外部补充",
        "",
        "- 标题: 算力基础设施高质量发展行动计划",
        "- URL: https://www.miit.gov.cn/zwgk/zcwj/wjfb/tz/art/2023/art_fcb3aa793e674960b1c00d7e3b6ad448.html",
        "- 标题: OAuth 2.0 Authorization Framework",
        "- URL: https://datatracker.ietf.org/doc/html/rfc6749",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "参考与依据",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(
      verifyState.remaining_risks.some((item) => item.topic === "external-support-not-surfaced"),
    ).toBe(true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verify_doc_state.py flags duplicate layer labels inside one technical architecture subsection", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-verify-duplicate-architecture-label-"));

  try {
    await mkdir(join(workspace, ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });
    await mkdir(join(workspace, "outputs"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "请结合参考文档生成项目申报技术材料。",
        sections: [
          { id: "system-1", title: "算力选择与调度系统" },
          { id: "architecture", title: "技术架构" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "coverage.json"), JSON.stringify({ targets: [], covered: [], missing: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "facts.json"), JSON.stringify({ canonical_facts: [] }, null, 2), "utf8");
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");
    await writeFile(
      join(workspace, "outputs", "sample.md"),
      [
        "# 算力选择与调度系统",
        "",
        "## 技术架构",
        "",
        "**资源管理层**：负责资源建模与状态更新。",
        "",
        "**服务管理层**：负责服务编排与自动化部署。",
        "",
        "**服务管理层**：负责计量与服务目录治理。",
        "",
      ].join("\n"),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--target", "outputs/sample.md",
      "--verify-out", ".worktree/verify/coverage.json",
      "--required-section", "算力选择与调度系统",
      "--required-section", "技术架构",
    ], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const verifyState = JSON.parse(
      await readFile(join(workspace, ".worktree", "verify", "coverage.json"), "utf8"),
    );

    expect(
      verifyState.remaining_risks.some((item) => item.topic === "duplicate-architecture-label"),
    ).toBe(true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
