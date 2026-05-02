import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  addBidWorkbenchSectionRange,
  deleteBidWorkbenchSectionRange,
  getBidWorkbenchState,
  refreshBidWorkbenchState,
  recordBidWorkbenchSectionPromptActivity,
  setBidWorkbenchOutlineSource,
  setBidWorkbenchProjectRootOutput,
  setBidWorkbenchProjectWorkflowStage,
  setBidWorkbenchProjectConstraints,
  setBidWorkbenchSectionMetadata,
  setBidWorkbenchSectionLink,
  setBidWorkbenchSectionLock,
  setBidWorkbenchSectionMergedState,
  setBidWorkbenchSectionPrimaryOutput,
  setBidWorkbenchSectionSession,
} from "./bid-workbench.js";
import { ApiError } from "./errors.js";

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "openwork-bid-workbench-"));
  await mkdir(join(workspace, "documents"), { recursive: true });
  return workspace;
}

async function writeOutlineDocx(
  workspacePath: string,
  relativePath: string,
  items: Array<{ text: string; level?: number }>,
) {
  const absolutePath = join(
    workspacePath,
    "documents",
    relativePath,
  );
  await mkdir(dirname(absolutePath), { recursive: true });
  const script = `
import json
import sys
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

def set_outline(paragraph, level):
    pPr = paragraph._p.get_or_add_pPr()
    outline = OxmlElement("w:outlineLvl")
    outline.set(qn("w:val"), str(level - 1))
    pPr.append(outline)

target = sys.argv[1]
items = json.loads(sys.argv[2])
document = Document()
for item in items:
    paragraph = document.add_paragraph(item["text"])
    level = item.get("level")
    if isinstance(level, int):
        set_outline(paragraph, level)
document.save(target)
`;
  const result = spawnSync("python3", [ "-c", script, absolutePath, JSON.stringify(items)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "failed to write docx"));
  }
}

describe("bid-workbench", () => {
  test("returns empty state before project source is configured", async () => {
    const workspacePath = await createWorkspace();
    const state = await getBidWorkbenchState(workspacePath);

    expect(state.project.outlineSourcePath).toBeNull();
    expect(state.project.outlineSourceType).toBeNull();
    expect(state.project.structureSourceKind).toBeNull();
    expect(state.project.workflowStage).toBe("outline");
    expect(state.nodes).toEqual([]);
    expect(state.marks).toEqual([]);
    expect(state.refresh).toBeNull();
  });

  test("persists project root output path independently of outline refresh", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/outline.docx";

    await writeOutlineDocx(workspacePath, sourcePath, [{ text: "第一章", level: 1 }]);
    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });

    let state = await setBidWorkbenchProjectRootOutput(workspacePath, {
      rootOutputPath: "bid-workbench/output/master.docx",
    });
    expect(state.project.rootOutputPath).toBe("bid-workbench/output/master.docx");

    state = await refreshBidWorkbenchState(workspacePath);
    expect(state.project.rootOutputPath).toBe("bid-workbench/output/master.docx");
  });

  test("persists project constraints independently of outline refresh", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/outline.docx";

    await writeOutlineDocx(workspacePath, sourcePath, [{ text: "第一章", level: 1 }]);
    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });

    let state = await setBidWorkbenchProjectConstraints(workspacePath, {
      formatRules: {
        bodyFontFamily: "宋体",
        bodyFontSizePt: 12,
        lineSpacingMode: "multiple",
        lineSpacingValue: 1.5,
      },
      extractedFromPath: "bid-workbench/templates/style-source.docx",
    });
    expect(state.constraints.extractedFromPath).toBe("bid-workbench/templates/style-source.docx");
    expect(state.constraints.formatRules).toMatchObject({
      bodyFontFamily: "宋体",
      bodyFontSizePt: 12,
      lineSpacingMode: "multiple",
      lineSpacingValue: 1.5,
    });

    state = await refreshBidWorkbenchState(workspacePath);
    expect(state.constraints.extractedFromPath).toBe("bid-workbench/templates/style-source.docx");
    expect(state.constraints.formatRules).toMatchObject({
      bodyFontFamily: "宋体",
      bodyFontSizePt: 12,
      lineSpacingMode: "multiple",
      lineSpacingValue: 1.5,
    });
  });

  test("updates workflow stage explicitly and preserves it across refresh", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/outline.docx";

    await writeOutlineDocx(workspacePath, sourcePath, [{ text: "第一章", level: 1 }]);
    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });

    let state = await setBidWorkbenchProjectWorkflowStage(workspacePath, {
      workflowStage: "mapping",
    });
    expect(state.project.workflowStage).toBe("mapping");

    state = await refreshBidWorkbenchState(workspacePath);
    expect(state.project.workflowStage).toBe("mapping");

    state = await setBidWorkbenchProjectRootOutput(workspacePath, {
      rootOutputPath: "bid-workbench/output/master.docx",
    });
    expect(state.project.workflowStage).toBe("mapping");
  });

  test("refresh derives tree from tender markdown and preserves collaboration state across title edits", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/tender-outline.docx";

    await writeOutlineDocx(
      workspacePath,
      sourcePath,
      [
        { text: "第一章 总则", level: 1 },
        { text: "1.1 项目概况", level: 2 },
        { text: "1.1.1 建设目标", level: 3 },
        { text: "1.2 实施要求", level: 2 },
      ],
    );

    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });

    let state = await refreshBidWorkbenchState(workspacePath);

    expect(state.project.outlineSourcePath).toBe(sourcePath);
    expect(state.project.outlineSourceType).toBe("tender");
    expect(state.project.structureSourceKind).toBe("tender");
    expect(state.nodes.map((node) => node.title)).toEqual([
      "第一章 总则",
      "1.1 项目概况",
      "1.1.1 建设目标",
      "1.2 实施要求",
    ]);

    const chapter = state.nodes.find((node) => node.title === "第一章 总则");
    const section = state.nodes.find((node) => node.title === "1.1 项目概况");
    const leaf = state.nodes.find((node) => node.title === "1.1.1 建设目标");
    const sibling = state.nodes.find((node) => node.title === "1.2 实施要求");
    expect(chapter).toBeDefined();
    expect(section).toBeDefined();
    expect(leaf).toBeDefined();
    expect(sibling).toBeDefined();
    expect(chapter?.parentId).toBeNull();
    expect(section?.parentId).toBe(chapter?.id ?? null);
    expect(leaf?.parentId).toBe(section?.id ?? null);
    expect(sibling?.parentId).toBe(chapter?.id ?? null);

    await setBidWorkbenchSectionSession(workspacePath, {
      sectionId: leaf!.id,
      sessionId: "ses_leaf",
    });
    await setBidWorkbenchSectionMetadata(workspacePath, {
      sectionId: leaf!.id,
      compositionMode: "reference-guided",
      assignee: "storm",
    });
    await recordBidWorkbenchSectionPromptActivity(workspacePath, {
      sectionId: leaf!.id,
      author: "storm",
    });
    await setBidWorkbenchSectionLock(workspacePath, {
      sectionId: leaf!.id,
      lockedBy: "storm",
    });
    await setBidWorkbenchSectionLink(workspacePath, {
      sectionId: leaf!.id,
      kind: "reference",
      path: "bid-workbench/reference/ref-a.docx",
      selected: true,
    });
    await setBidWorkbenchSectionLink(workspacePath, {
      sectionId: leaf!.id,
      kind: "output",
      path: "bid-workbench/output/out-a.docx",
      selected: true,
    });
    await setBidWorkbenchSectionPrimaryOutput(workspacePath, {
      sectionId: leaf!.id,
      primaryOutputPath: "bid-workbench/output/out-a.docx",
    });
    await setBidWorkbenchSectionMergedState(workspacePath, {
      sectionId: leaf!.id,
      mergeRequested: true,
      mergeApplied: false,
      mergeFailed: false,
      outputPath: "bid-workbench/output/out-a.docx",
      rootOutputPath: "bid-workbench/output/master.docx",
    });

    await writeOutlineDocx(
      workspacePath,
      sourcePath,
      [
        { text: "第一章 总则", level: 1 },
        { text: "1.1 项目概况", level: 2 },
        { text: "1.1.1 建设目标（更新）", level: 3 },
        { text: "1.2 实施要求", level: 2 },
      ],
    );

    state = await refreshBidWorkbenchState(workspacePath);

    const refreshedLeaf = state.nodes.find(
      (node) => node.sourceLocator === leaf!.sourceLocator,
    );
    expect(refreshedLeaf?.title).toBe("1.1.1 建设目标（更新）");
    expect(refreshedLeaf?.sessionId).toBe("ses_leaf");
    expect(refreshedLeaf?.activeSessionId).toBe("ses_leaf");
    expect(refreshedLeaf?.lastSessionId).toBe("ses_leaf");
    expect(refreshedLeaf?.lockedBy).toBe("storm");
    expect(refreshedLeaf?.compositionMode).toBe("reference-guided");
    expect(refreshedLeaf?.assignee).toBe("storm");
    expect(refreshedLeaf?.recentPromptAuthor).toBe("storm");
    expect(refreshedLeaf?.participants).toEqual(["storm"]);
    expect(refreshedLeaf?.referencePaths).toEqual([
      "bid-workbench/reference/ref-a.docx",
    ]);
    expect(refreshedLeaf?.outputPaths).toEqual([
      "bid-workbench/output/out-a.docx",
    ]);
    expect(refreshedLeaf?.primaryOutputPath).toBe("bid-workbench/output/out-a.docx");
    expect(refreshedLeaf?.mergeRequested).toBe(true);
    expect(refreshedLeaf?.mergeApplied).toBe(false);
    expect(refreshedLeaf?.mergedOutputPath).toBe(
      "bid-workbench/output/out-a.docx",
    );
    expect(refreshedLeaf?.runtimeScopeKey).toBe(
      `bid-workbench/runtime/${leaf!.id}/ses_leaf`,
    );
    expect(state.mergeJobs).toHaveLength(1);
    expect(state.mergeJobs[0]).toMatchObject({
      sectionId: leaf!.id,
      outputPath: "bid-workbench/output/out-a.docx",
      rootOutputPath: "bid-workbench/output/master.docx",
      status: "requested",
    });
    const briefPath = join(
      workspacePath,
      ".openwork",
      "bid-workbench",
      "node-briefs",
      `${leaf!.id}.md`,
    );
    const brief = await readFile(briefPath, "utf8");
    expect(brief).toContain("节点任务简报");
    expect(brief).toContain("运行约束");
    expect(brief).toContain("最近发送人：storm");
    expect(brief).toContain("当前主产出：bid-workbench/output/out-a.docx");
    expect(brief).toContain("- bid-workbench/output/out-a.docx (draft)");
    expect(brief).not.toContain("- 暂无节点产出");
  });

  test("persists structure source kind and rejects non-docx root outputs", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/outline.docx";

    await writeOutlineDocx(workspacePath, sourcePath, [{ text: "第一章", level: 1 }]);
    const state = await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "template",
    });
    expect(state.project.structureSourceKind).toBe("template");

    await expect(
      setBidWorkbenchProjectRootOutput(workspacePath, {
        rootOutputPath: "bid-workbench/output/master.xlsx",
      }),
    ).rejects.toMatchObject({
      code: "bid_workbench_invalid_root_output",
      status: 400,
    } satisfies Partial<ApiError>);
  });

  test("accepts legacy .doc files as outline sources", async () => {
    const workspacePath = await createWorkspace();
    const state = await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath: "bid-workbench/templates/template.doc",
      sourceType: "templates",
      structureSourceKind: "template",
    });

    expect(state.project.outlineSourcePath).toBe("bid-workbench/templates/template.doc");
    expect(state.project.outlineSourceType).toBe("templates");
    expect(state.project.structureSourceKind).toBe("template");
  });

  test("tracks multiple outputs and primary output separately", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/outline.docx";

    await writeOutlineDocx(workspacePath, sourcePath, [
      { text: "第一章", level: 1 },
      { text: "1.1 节点", level: 2 },
    ]);
    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });

    let state = await refreshBidWorkbenchState(workspacePath);
    const node = state.nodes.find((item) => item.title === "1.1 节点");
    expect(node).toBeDefined();

    await setBidWorkbenchSectionLink(workspacePath, {
      sectionId: node!.id,
      kind: "output",
      path: "bid-workbench/output/node-a-draft.docx",
      selected: true,
    });
    await setBidWorkbenchSectionLink(workspacePath, {
      sectionId: node!.id,
      kind: "output",
      path: "bid-workbench/output/node-a-final.docx",
      selected: true,
    });
    state = await setBidWorkbenchSectionPrimaryOutput(workspacePath, {
      sectionId: node!.id,
      primaryOutputPath: "bid-workbench/output/node-a-final.docx",
    });

    const refreshed = state.nodes.find((item) => item.id === node!.id);
    expect(refreshed?.outputPaths).toEqual([
      "bid-workbench/output/node-a-draft.docx",
      "bid-workbench/output/node-a-final.docx",
    ]);
    expect(refreshed?.primaryOutputPath).toBe("bid-workbench/output/node-a-final.docx");
    expect(refreshed?.outputs.map((item) => item.path)).toEqual([
      "bid-workbench/output/node-a-draft.docx",
      "bid-workbench/output/node-a-final.docx",
    ]);
  });

  test("upserts merge jobs by section, output, and root output instead of creating duplicates", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/outline.docx";

    await writeOutlineDocx(workspacePath, sourcePath, [
      { text: "第一章", level: 1 },
      { text: "1.1 节点", level: 2 },
    ]);
    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });
    await setBidWorkbenchProjectRootOutput(workspacePath, {
      rootOutputPath: "bid-workbench/output/master.docx",
    });

    let state = await refreshBidWorkbenchState(workspacePath);
    const node = state.nodes.find((item) => item.title === "1.1 节点");
    expect(node).toBeDefined();

    await setBidWorkbenchSectionLink(workspacePath, {
      sectionId: node!.id,
      kind: "output",
      path: "bid-workbench/output/node-a-final.docx",
      selected: true,
    });
    await setBidWorkbenchSectionPrimaryOutput(workspacePath, {
      sectionId: node!.id,
      primaryOutputPath: "bid-workbench/output/node-a-final.docx",
    });

    state = await setBidWorkbenchSectionMergedState(workspacePath, {
      sectionId: node!.id,
      mergeRequested: true,
      mergeApplied: false,
      mergeFailed: false,
      outputPath: "bid-workbench/output/node-a-final.docx",
      rootOutputPath: "bid-workbench/output/master.docx",
    });
    expect(state.mergeJobs).toHaveLength(1);
    expect(state.mergeJobs[0]?.status).toBe("requested");

    state = await setBidWorkbenchSectionMergedState(workspacePath, {
      sectionId: node!.id,
      mergeRequested: false,
      mergeApplied: true,
      mergeFailed: false,
      outputPath: "bid-workbench/output/node-a-final.docx",
      rootOutputPath: "bid-workbench/output/master.docx",
    });
    expect(state.mergeJobs).toHaveLength(1);
    expect(state.mergeJobs[0]?.status).toBe("applied");
    expect(state.nodes.find((item) => item.id === node!.id)?.mergeApplied).toBe(true);
  });

  test("stores and removes explicit source ranges for a node", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/outline.docx";

    await writeOutlineDocx(workspacePath, sourcePath, [
      { text: "第一章", level: 1 },
      { text: "1.1 节点", level: 2 },
    ]);
    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });

    let state = await refreshBidWorkbenchState(workspacePath);
    const node = state.nodes.find((item) => item.title === "1.1 节点");
    expect(node).toBeDefined();

    await setBidWorkbenchSectionLink(workspacePath, {
      sectionId: node!.id,
      kind: "reference",
      path: "bid-workbench/reference/ref-a.pdf",
      selected: true,
    });

    state = await addBidWorkbenchSectionRange(workspacePath, {
      sectionId: node!.id,
      sourcePath: "bid-workbench/reference/ref-a.pdf",
      rangeKind: "page-range",
      rangeValue: "12-18",
      note: "只看盖章页",
    });

    const rangedNode = state.nodes.find((item) => item.id === node!.id);
    expect(rangedNode?.sourceRanges).toHaveLength(1);
    expect(rangedNode?.sourceRanges[0]).toMatchObject({
      sourcePath: "bid-workbench/reference/ref-a.pdf",
      rangeKind: "page-range",
      rangeValue: "12-18",
      note: "只看盖章页",
    });

    const rangeId = rangedNode?.sourceRanges[0]?.id;
    expect(rangeId).toBeTruthy();

    state = await deleteBidWorkbenchSectionRange(workspacePath, rangeId!);
    expect(state.nodes.find((item) => item.id === node!.id)?.sourceRanges).toEqual([]);
  });

  test("removes stateless deleted sections and inactivates stateful deleted sections on refresh", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/outline.docx";

    await writeOutlineDocx(
      workspacePath,
      sourcePath,
      [
        { text: "A", level: 1 },
        { text: "B", level: 2 },
        { text: "C", level: 2 },
      ],
    );

    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });

    let state = await refreshBidWorkbenchState(workspacePath);
    const nodeB = state.nodes.find((node) => node.title === "B");
    const nodeC = state.nodes.find((node) => node.title === "C");
    expect(nodeB).toBeDefined();
    expect(nodeC).toBeDefined();

    await setBidWorkbenchSectionLock(workspacePath, {
      sectionId: nodeB!.id,
      lockedBy: "alice",
    });

    await writeOutlineDocx(workspacePath, sourcePath, [{ text: "A", level: 1 }]);

    state = await refreshBidWorkbenchState(workspacePath);

    expect(state.nodes.some((node) => node.title === "B")).toBe(false);
    expect(state.nodes.some((node) => node.title === "C")).toBe(false);
    expect(state.refresh?.summary).toContain("inactive=1");
    expect(state.refresh?.summary).toContain("deleted=1");
  });

  test("refresh rejects a source file that has no stable heading structure", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/no-outline.docx";

    await writeOutlineDocx(
      workspacePath,
      sourcePath,
      [
        { text: "这里只是正文" },
        { text: "没有标题层级" },
        { text: "也没有结构节点" },
      ],
    );

    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });

    await expect(refreshBidWorkbenchState(workspacePath)).rejects.toMatchObject({
      code: "bid_workbench_outline_empty",
      status: 400,
    } satisfies Partial<ApiError>);
  });

  test("refresh preserves node state when only body text shifts heading line numbers", async () => {
    const workspacePath = await createWorkspace();
    const sourcePath = "bid-workbench/tender/line-shift.docx";

    await writeOutlineDocx(
      workspacePath,
      sourcePath,
      [
        { text: "第一章", level: 1 },
        { text: "正文 A" },
        { text: "1.1 章节", level: 2 },
        { text: "原始正文" },
      ],
    );

    await setBidWorkbenchOutlineSource(workspacePath, {
      sourcePath,
      sourceType: "tender",
      structureSourceKind: "tender",
    });

    let state = await refreshBidWorkbenchState(workspacePath);
    const node = state.nodes.find((item) => item.title === "1.1 章节");
    expect(node).toBeDefined();

    await setBidWorkbenchSectionSession(workspacePath, {
      sectionId: node!.id,
      sessionId: "ses_shift",
    });
    await setBidWorkbenchSectionLock(workspacePath, {
      sectionId: node!.id,
      lockedBy: "bob",
    });

    await writeOutlineDocx(
      workspacePath,
      sourcePath,
      [
        { text: "第一章", level: 1 },
        { text: "正文 A" },
        { text: "补充正文 1" },
        { text: "补充正文 2" },
        { text: "1.1 章节", level: 2 },
        { text: "原始正文" },
      ],
    );

    state = await refreshBidWorkbenchState(workspacePath);

    const shiftedNode = state.nodes.find((item) => item.title === "1.1 章节");
    expect(shiftedNode?.sessionId).toBe("ses_shift");
    expect(shiftedNode?.lockedBy).toBe("bob");
  });
});
