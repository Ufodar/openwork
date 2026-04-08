import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = "./.opencode/runtime-support/document-state/merge_doc_state.py";

test("merge_doc_state.py merges compiled artifacts without domain-specific filtering", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-merge-neutral-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "index.json"),
      JSON.stringify({
        summary: "整理上传文档中的事实和待确认点。",
        target_doc: "outputs/summary.docx",
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "整理上传文档中的事实和待确认点。",
        target_doc: "outputs/summary.docx",
        sources: [
          { docId: "src-001", title: "资料一", relativePath: "资料一.docx" },
          { docId: "src-002", title: "资料二", relativePath: "资料二.docx" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "src-001.json"),
      JSON.stringify({
        docId: "src-001",
        title: "资料一",
        relativePath: "资料一.docx",
        section_briefs: [
          {
            title: "平台概述",
            locator: "paragraph:5",
            summary: "概述平台支持统一纳管和接口对接。",
            topic: "architecture-design",
            key_points: [
              { statement: "平台支持统一纳管。", locator: "paragraph:6" },
            ],
          },
          {
            title: "商务说明",
            locator: "paragraph:20",
            summary: "说明收费与优惠活动。",
            key_points: [
              { statement: "平台支持充值券抵扣。", locator: "paragraph:21" },
            ],
          },
        ],
        facts: [
          {
            statement: "平台支持统一纳管。",
            locator: "paragraph:6",
            evidence: "平台支持统一纳管。",
            topic: "architecture-design",
          },
          {
            statement: "平台支持充值券抵扣。",
            locator: "paragraph:21",
            evidence: "平台支持充值券抵扣。",
          },
        ],
        claims: [],
        gaps: ["缺少最新版本发布日期。"],
        open_questions: ["是否需要补充外部参考资料？"],
        conflicts: [
          {
            topic: "pricing",
            competing_values: [
              { statement: "材料一写明按月订阅。", docId: "src-001" },
            ],
            rationale: "材料之间的收费方式不一致。",
            unresolved: true,
          },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "src-002.json"),
      JSON.stringify({
        docId: "src-002",
        title: "资料二",
        relativePath: "资料二.docx",
        facts: [
          {
            statement: "平台支持统一纳管。",
            locator: "paragraph:10",
            evidence: "平台支持统一纳管。",
          },
          {
            statement: "材料二写明按次计费。",
            locator: "paragraph:22",
            evidence: "材料二写明按次计费。",
            topic: "pricing",
          },
        ],
        claims: [],
        gaps: ["缺少最新版本发布日期。"],
        open_questions: ["是否需要补充外部参考资料？"],
        conflicts: [],
      }, null, 2),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--goal", "整理上传文档中的事实和待确认点。",
      "--target-doc", "outputs/summary.docx",
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const facts = JSON.parse(await readFile(join(workspace, ".worktree", "facts.json"), "utf8"));
    const conflicts = JSON.parse(await readFile(join(workspace, ".worktree", "merge", "conflicts.json"), "utf8"));

    expect(facts.goal).toBe("整理上传文档中的事实和待确认点。");
    expect(facts.target_doc).toBe("outputs/summary.docx");
    expect(facts.canonical_facts).toHaveLength(3);
    expect(facts.canonical_facts.find((item) => item.statement === "平台支持统一纳管。")?.topic).toBe("architecture-design");
    expect(facts.canonical_facts.find((item) => item.statement === "平台支持充值券抵扣。")?.topic).toBe("general");
    expect(facts.evidence_index.filter((item) => item.statement === "平台支持统一纳管。")).toHaveLength(2);
    expect(facts.gaps).toEqual(["缺少最新版本发布日期。"]);
    expect(facts.source_briefs[0].sections.map((item) => item.title)).toEqual(["平台概述", "商务说明"]);
    expect(facts.source_briefs[0].sections[0].topic).toBe("architecture-design");
    expect(facts.source_briefs[0].sections[1].topic).toBeUndefined();

    expect(conflicts.conflicts).toHaveLength(1);
    expect(conflicts.conflicts[0].topic).toBe("pricing");
    expect(conflicts.open_questions).toEqual(["是否需要补充外部参考资料？"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("merge_doc_state.py falls back to general topics instead of inventing domain labels", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-merge-general-topic-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });
    await writeFile(join(workspace, ".worktree", "index.json"), JSON.stringify({ summary: "整理事实" }, null, 2), "utf8");
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "整理事实",
        sources: [{ docId: "src-001", title: "原文", relativePath: "原文.md" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "src-001.json"),
      JSON.stringify({
        docId: "src-001",
        title: "原文",
        relativePath: "原文.md",
        facts: [
          {
            statement: "系统使用了一种新的资源组织方式。",
            locator: "line:3",
            evidence: "系统使用了一种新的资源组织方式。",
          },
        ],
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

    const facts = JSON.parse(await readFile(join(workspace, ".worktree", "facts.json"), "utf8"));
    expect(facts.canonical_facts).toHaveLength(1);
    expect(facts.canonical_facts[0].topic).toBe("general");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
