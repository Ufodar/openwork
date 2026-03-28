import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DOCUMENT_WORKFLOW_COMPARE_OUTPUT_PATH,
  resolveDocumentWorkflowCompareOutputPath,
  withAsyncTimeout,
} from "./document-workflow-compare-runtime.mjs";

describe("resolveDocumentWorkflowCompareOutputPath", () => {
  test("anchors the default compare output under the repo tmp directory", () => {
    expect(DEFAULT_DOCUMENT_WORKFLOW_COMPARE_OUTPUT_PATH).toBe(
      "/Users/storm/Documents/code/studyProject/opencode-docx/openwork/tmp/compare-agents/document-live-compare.json",
    );
  });

  test("keeps explicit relative overrides relative to the caller cwd", () => {
    expect(
      resolveDocumentWorkflowCompareOutputPath({
        cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/app/scripts",
        outputOverride: "../../tmp/custom.json",
      }),
    ).toBe(
      "/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/tmp/custom.json",
    );
  });
});

describe("withAsyncTimeout", () => {
  test("returns the underlying result when the operation finishes in time", async () => {
    await expect(
      withAsyncTimeout(() => Promise.resolve("ok"), 100, "probe"),
    ).resolves.toBe("ok");
  });

  test("rejects with a clear timeout error when the operation hangs", async () => {
    await expect(
      withAsyncTimeout(
        () => new Promise(() => {}),
        10,
        "session.messages.poll",
      ),
    ).rejects.toThrow("session.messages.poll timed out after 10ms");
  });
});
