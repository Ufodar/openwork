import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { persistUploadedDocumentFile } from "./document.js";

describe("persistUploadedDocumentFile", () => {
  test("writes uploaded files atomically without leaving temp files behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openwork-document-upload-"));
    const dest = join(dir, "large.docx");
    const file = new File(["hello document"], "large.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await persistUploadedDocumentFile(dest, file);

    expect(await readFile(dest, "utf8")).toBe("hello document");
    const leftovers = await readdir(dir);
    expect(leftovers.filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});
