import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";

import {
  FORMAL_DOCUMENT_BENCHMARKS,
  FORMAL_DOCUMENT_BENCHMARKS_BY_ID,
} from "./document-workflow-benchmarks.mjs";

test("formal document workflow benchmark set covers the three target task shapes", async () => {
  expect(FORMAL_DOCUMENT_BENCHMARKS.length).toBeGreaterThanOrEqual(3);

  const categories = FORMAL_DOCUMENT_BENCHMARKS.map((item) => item.category);
  expect(categories).toContain("single-long-rewrite");
  expect(categories).toContain("multi-doc-synthesis");
  expect(categories).toContain("plan-first-redraft");

  for (const benchmark of FORMAL_DOCUMENT_BENCHMARKS) {
    expect(FORMAL_DOCUMENT_BENCHMARKS_BY_ID[benchmark.id]?.id).toBe(benchmark.id);
    expect(benchmark.docs.length).toBeGreaterThanOrEqual(1);
    expect(benchmark.prompts.length).toBeGreaterThanOrEqual(2);
    expect(benchmark.scoreAxes).toEqual([
      "tool-path-stability",
      "error-free-routing",
      "state-first-execution",
      "deliverable-quality",
    ]);

    for (const docPath of benchmark.docs) {
      const info = await stat(docPath);
      expect(info.isFile()).toBe(true);
    }
  }
});
