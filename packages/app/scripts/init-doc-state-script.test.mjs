import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = "./.opencode/runtime-support/document-state/init_doc_state.py";

test("init_doc_state.py bootstraps a document workspace from uploaded source files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-init-state-"));

  try {
    await writeFile(join(workspace, "prompt.txt"), "请基于上传文档撰写项目申报技术材料。", "utf8");
    await writeFile(join(workspace, "融合算力云平台白皮书.docx"), "placeholder", "utf8");
    await writeFile(join(workspace, "天河监控运维一体化平台软件介绍v0.3.docx"), "placeholder", "utf8");
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(join(workspace, ".opencode", "openwork.json"), "{}", "utf8");

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--goal", "请基于上传文档撰写项目申报技术材料。",
      "--target-doc", "outputs/算力网络项目申报技术材料.docx",
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const index = JSON.parse(await readFile(join(workspace, ".worktree", "index.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(workspace, ".worktree", "sources", "manifest.json"), "utf8"));
    const conventions = await readFile(join(workspace, ".worktree", "conventions.md"), "utf8");

    expect(index.phase).toBe("intake_ready");
    expect(index.target_doc).toBe("outputs/算力网络项目申报技术材料.docx");
    expect(index.children).toEqual([]);
    expect(index.summary).toContain("2");

    expect(manifest.goal).toContain("项目申报技术材料");
    expect(manifest.target_doc).toBe("outputs/算力网络项目申报技术材料.docx");
    expect(manifest.sources).toHaveLength(2);
    expect(manifest.sources.map((item) => item.relativePath)).toEqual([
      "天河监控运维一体化平台软件介绍v0.3.docx",
      "融合算力云平台白皮书.docx",
    ]);
    expect(manifest.sources.map((item) => item.docId)).toEqual(["src-001", "src-002"]);
    expect(conventions).toContain("authoritative source hierarchy");
    expect(conventions).toContain("outputs/算力网络项目申报技术材料.docx");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("init_doc_state.py ignores hidden metadata and existing state artifacts when collecting sources", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-init-ignore-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });
    await writeFile(join(workspace, ".worktree", "index.json"), "{}", "utf8");
    await writeFile(join(workspace, "notes.md"), "# 临时说明", "utf8");
    await writeFile(join(workspace, "资料一.docx"), "placeholder", "utf8");
    await writeFile(join(workspace, ".DS_Store"), "", "utf8");

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--goal", "整理参考材料",
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const manifest = JSON.parse(await readFile(join(workspace, ".worktree", "sources", "manifest.json"), "utf8"));
    expect(manifest.sources.map((item) => item.relativePath)).toEqual([
      "notes.md",
      "资料一.docx",
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("init_doc_state.py ignores hosted runtime internals when collecting sources", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-init-hosted-ignore-"));

  try {
    await mkdir(join(workspace, ".openwork-runtime", "opencode", "config", "node_modules", "fixture"), { recursive: true });
    await mkdir(join(workspace, ".tmp", "system"), { recursive: true });
    await mkdir(join(workspace, ".opencode", "skills", "docx"), { recursive: true });

    await writeFile(join(workspace, "真实源文档.docx"), "placeholder", "utf8");
    await writeFile(join(workspace, "参考资料.pdf"), "placeholder", "utf8");
    await writeFile(
      join(workspace, ".openwork-runtime", "opencode", "config", "node_modules", "fixture", "README.txt"),
      "should-not-be-indexed",
      "utf8",
    );
    await writeFile(join(workspace, ".tmp", "system", "scratch.md"), "temporary", "utf8");
    await writeFile(join(workspace, ".opencode", "skills", "docx", "LICENSE.txt"), "skill-license", "utf8");

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--goal", "整理参考材料",
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const manifest = JSON.parse(await readFile(join(workspace, ".worktree", "sources", "manifest.json"), "utf8"));
    expect(manifest.sources.map((item) => item.relativePath)).toEqual([
      "参考资料.pdf",
      "真实源文档.docx",
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
