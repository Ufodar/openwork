import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { refreshBootstrapDocumentState } from "./document.js";

describe("refreshBootstrapDocumentState", () => {
  test("creates minimal .worktree state from uploaded source files", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "openwork-doc-bootstrap-"));
    await writeFile(join(runtimeDir, "临沂招标文件正文.pdf"), "pdf", "utf8");
    await writeFile(join(runtimeDir, "环投数科临沂项目第一包v20250508终版文件.docx"), "docx", "utf8");

    await refreshBootstrapDocumentState(runtimeDir);

    const index = JSON.parse(await readFile(join(runtimeDir, ".worktree", "index.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(runtimeDir, ".worktree", "sources", "manifest.json"), "utf8"));
    const conventions = await readFile(join(runtimeDir, ".worktree", "conventions.md"), "utf8");

    expect(index.phase).toBe("intake");
    expect(index.summary).toContain("Uploaded 2 source documents");
    expect(index.current_focus).toContain("Compile uploaded documents");
    expect(manifest.sources).toHaveLength(2);
    expect(manifest.sources.map((item: any) => item.relativePath)).toEqual([
      "环投数科临沂项目第一包v20250508终版文件.docx",
      "临沂招标文件正文.pdf",
    ]);
    expect(manifest.sources.map((item: any) => item.status)).toEqual(["uploaded", "uploaded"]);
    expect(conventions).toContain("Document State Conventions");
    expect(conventions).toContain("临沂招标文件正文.pdf");
  });

  test("preserves richer existing state while refreshing the source inventory", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "openwork-doc-bootstrap-merge-"));
    await mkdir(join(runtimeDir, ".worktree", "sources"), { recursive: true });
    await writeFile(join(runtimeDir, "a.docx"), "docx", "utf8");
    await writeFile(join(runtimeDir, ".worktree", "index.json"), JSON.stringify({
      version: 3,
      project: "existing-project",
      target_doc: "outputs/custom.md",
      phase: "planner",
      summary: "existing summary",
      current_focus: "existing focus",
      conventions_ref: ".worktree/conventions.md",
      children: ["child-a"],
    }, null, 2), "utf8");
    await writeFile(join(runtimeDir, ".worktree", "sources", "manifest.json"), JSON.stringify({
      generated_at: "2026-03-23T00:00:00.000Z",
      goal: "existing goal",
      target_doc: "outputs/custom.md",
      sources: [
        {
          docId: "doc-existing",
          title: "existing title",
          relativePath: "a.docx",
          kind: "docx",
          role: "existing role",
          status: "compiled",
        },
      ],
      blockers: ["none"],
    }, null, 2), "utf8");
    await writeFile(join(runtimeDir, "b.pdf"), "pdf", "utf8");

    await refreshBootstrapDocumentState(runtimeDir);

    const index = JSON.parse(await readFile(join(runtimeDir, ".worktree", "index.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(runtimeDir, ".worktree", "sources", "manifest.json"), "utf8"));

    expect(index.version).toBe(3);
    expect(index.project).toBe("existing-project");
    expect(index.target_doc).toBe("outputs/custom.md");
    expect(index.phase).toBe("planner");
    expect(index.children).toEqual(["child-a"]);
    expect(manifest.goal).toBe("existing goal");
    expect(manifest.blockers).toEqual(["none"]);
    expect(manifest.sources).toHaveLength(2);
    expect(manifest.sources.find((item: any) => item.relativePath === "a.docx")).toMatchObject({
      docId: "doc-existing",
      title: "existing title",
      role: "existing role",
      status: "compiled",
    });
  });

test("refreshes bootstrap narration while the workspace is still in intake", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "openwork-doc-bootstrap-refresh-"));
  await writeFile(join(runtimeDir, "a.docx"), "docx", "utf8");

    await refreshBootstrapDocumentState(runtimeDir);

    await writeFile(join(runtimeDir, "b.pdf"), "pdf", "utf8");
    await refreshBootstrapDocumentState(runtimeDir);

    const index = JSON.parse(await readFile(join(runtimeDir, ".worktree", "index.json"), "utf8"));
  expect(index.phase).toBe("intake");
  expect(index.summary).toContain("Uploaded 2 source documents");
  expect(index.current_focus).toContain("Compile uploaded documents");
});

test("ignores hosted runtime internals when building bootstrap source inventory", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "openwork-doc-bootstrap-hosted-"));

  await mkdir(join(runtimeDir, ".openwork-runtime", "opencode", "config", "node_modules", "fixture"), { recursive: true });
  await mkdir(join(runtimeDir, ".tmp", "system"), { recursive: true });
  await mkdir(join(runtimeDir, ".opencode", "skills", "docx"), { recursive: true });

  await writeFile(join(runtimeDir, "真实源文档.docx"), "docx", "utf8");
  await writeFile(join(runtimeDir, "参考资料.pdf"), "pdf", "utf8");
  await writeFile(
    join(runtimeDir, ".openwork-runtime", "opencode", "config", "node_modules", "fixture", "README.txt"),
    "should-not-be-indexed",
    "utf8",
  );
  await writeFile(join(runtimeDir, ".tmp", "system", "scratch.md"), "temporary", "utf8");
  await writeFile(join(runtimeDir, ".opencode", "skills", "docx", "LICENSE.txt"), "skill-license", "utf8");

  await refreshBootstrapDocumentState(runtimeDir);

  const index = JSON.parse(await readFile(join(runtimeDir, ".worktree", "index.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(runtimeDir, ".worktree", "sources", "manifest.json"), "utf8"));

  expect(index.summary).toContain("Uploaded 2 source documents");
  expect(manifest.sources.map((item: any) => item.relativePath)).toEqual([
    "参考资料.pdf",
    "真实源文档.docx",
  ]);
});

test("preserves original upload metadata for machine-named session sources when bootstrap state refreshes", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "openwork-doc-bootstrap-original-name-"));
  await mkdir(join(runtimeDir, ".worktree", "sources"), { recursive: true });
  await writeFile(join(runtimeDir, "src-001.docx"), "docx", "utf8");
  await writeFile(join(runtimeDir, ".worktree", "sources", "manifest.json"), JSON.stringify({
    generated_at: "2026-03-30T00:00:00.000Z",
    goal: "",
    target_doc: null,
    sources: [
      {
        docId: "doc-src-001",
        title: "天河监控运维一体化平台软件介绍 v0.3",
        relativePath: "src-001.docx",
        originalName: "天河监控运维一体化平台软件介绍 v0.3.docx",
        originalRelativePath: "资料 2026/天河监控运维一体化平台软件介绍 v0.3.docx",
        kind: "docx",
        role: "参考材料",
        status: "uploaded",
      },
    ],
    blockers: [],
  }, null, 2), "utf8");
  await writeFile(join(runtimeDir, "src-002.pdf"), "pdf", "utf8");

  await refreshBootstrapDocumentState(runtimeDir);

  const manifest = JSON.parse(await readFile(join(runtimeDir, ".worktree", "sources", "manifest.json"), "utf8"));
  const first = manifest.sources.find((item: any) => item.relativePath === "src-001.docx");
  expect(first).toMatchObject({
    title: "天河监控运维一体化平台软件介绍 v0.3",
    originalName: "天河监控运维一体化平台软件介绍 v0.3.docx",
    originalRelativePath: "资料 2026/天河监控运维一体化平台软件介绍 v0.3.docx",
  });
});

test("records a workspace-local text extract for supported uploaded sources", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "openwork-doc-bootstrap-text-ref-"));
  await writeFile(join(runtimeDir, "src-001.docx"), "docx", "utf8");

  await refreshBootstrapDocumentState(runtimeDir, {
    runCommand(command, args) {
      expect(command).toBe("pandoc");
      expect(args).toEqual([
        join(runtimeDir, "src-001.docx"),
        "-t",
        "plain",
        "-o",
        join(runtimeDir, ".worktree", "text", "src-001.txt"),
      ]);
      writeFileSync(join(runtimeDir, ".worktree", "text", "src-001.txt"), "extracted plain text\n", "utf8");
      return {
        status: 0,
        stdout: "",
        stderr: "",
      } as any;
    },
  });

  const manifest = JSON.parse(await readFile(join(runtimeDir, ".worktree", "sources", "manifest.json"), "utf8"));
  expect(manifest.sources).toHaveLength(1);
  expect(manifest.sources[0]).toMatchObject({
    relativePath: "src-001.docx",
    textRelativePath: ".worktree/text/src-001.txt",
    textStatus: "ready",
    textExtractor: "pandoc",
  });
  expect(await readFile(join(runtimeDir, ".worktree", "text", "src-001.txt"), "utf8")).toContain("extracted plain text");
});
});
