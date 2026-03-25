import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const scriptPath = "./.opencode/skills/openwork-core/scripts/verify_doc_state.py";

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
