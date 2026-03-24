import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listDocumentStateSources,
  readDocumentStateBrief,
  readDocumentStateConflicts,
  readDocumentStateCoverage,
  readDocumentStatePlan,
} from "./document-state.js";
import { ensureDir } from "./utils.js";

describe("document state helpers", () => {
  let workspacePath: string | null = null;

  afterEach(async () => {
    if (!workspacePath) return;
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = null;
  });

  test("listDocumentStateSources skips the manifest record and returns compiled sources", async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "document-state-"));
    await ensureDir(join(workspacePath, ".worktree", "sources"));
    await writeFile(
      join(workspacePath, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        generated_at: "2026-03-23T00:00:00Z",
        sources: [{ docId: "alpha", relativePath: "docs/a.docx" }],
      }),
      "utf8",
    );
    await writeFile(
      join(workspacePath, ".worktree", "sources", "alpha.json"),
      JSON.stringify({
        docId: "alpha",
        title: "Alpha source",
        claims: [{ id: "c1" }],
        gaps: [{ id: "g1" }],
      }),
      "utf8",
    );

    const sources = await listDocumentStateSources(workspacePath);

    expect(sources).toEqual([
      {
        docId: "alpha",
        title: "Alpha source",
        relativePath: ".worktree/sources/alpha.json",
        claimCount: 1,
        gapCount: 1,
      },
    ]);
  });

  test("readDocumentStatePlan prefers solution-plan and coverage prefers verify output", async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "document-state-"));
    await ensureDir(join(workspacePath, ".worktree", "plan"));
    await ensureDir(join(workspacePath, ".worktree", "verify"));
    await writeFile(
      join(workspacePath, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({ goal: "write plan", sections: [{ id: "s1" }] }),
      "utf8",
    );
    await writeFile(
      join(workspacePath, ".worktree", "verify", "coverage.json"),
      JSON.stringify({ verified: ["s1"], missing: [] }),
      "utf8",
    );

    const plan = await readDocumentStatePlan(workspacePath);
    const coverage = await readDocumentStateCoverage(workspacePath);

    expect(plan).toEqual({
      relativePath: ".worktree/plan/solution-plan.json",
      goal: "write plan",
      sections: [{ id: "s1" }],
    });
    expect(coverage).toEqual({
      relativePath: ".worktree/verify/coverage.json",
      verified: ["s1"],
      missing: [],
    });
  });

  test("readDocumentStateConflicts returns null when no conflict artifact exists", async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "document-state-"));
    const conflicts = await readDocumentStateConflicts(workspacePath);
    expect(conflicts).toBeNull();
  });

  test("readDocumentStateBrief infers phase from artifacts and keeps string summary", async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "document-state-"));
    await ensureDir(join(workspacePath, ".worktree", "plan"));
    await writeFile(
      join(workspacePath, ".worktree", "index.json"),
      JSON.stringify({
        version: 1,
        project: "demo",
        phase: "intake",
        summary: "bootstrap summary",
        current_focus: "compile",
      }),
      "utf8",
    );
    await writeFile(
      join(workspacePath, ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({ goal: "plan" }),
      "utf8",
    );

    const brief = await readDocumentStateBrief(workspacePath);

    expect(brief).toEqual({
      relativePath: ".worktree/index.json",
      version: 1,
      project: "demo",
      phase: "plan",
      targetDoc: null,
      currentFocus: "compile",
      summary: "bootstrap summary",
    });
  });
});
