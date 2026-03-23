import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeAttachmentService } from "./knowledge-attachments.js";

describe("KnowledgeAttachmentService", () => {
  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-knowledge-attachments-"));
    process.env.OPENWORK_DATA_DIR = root;
  });

  test("starts empty for a new session and replaces the attached set on save", async () => {
    const store = new KnowledgeAttachmentService();

    expect(await store.get("ws_1", "ses_1")).toEqual([]);

    await store.set("ws_1", "ses_1", "rt_1", ["kb_a", "kb_b"]);

    expect(await store.get("ws_1", "ses_1")).toEqual(["kb_a", "kb_b"]);
  });

  test("persists runtime id alongside attached knowledge ids", async () => {
    const store = new KnowledgeAttachmentService();
    await store.set("ws_1", "ses_1", "rt_1", ["kb_a"]);

    const entry = await store.getEntry("ws_1", "ses_1");

    expect(entry?.runtimeId).toBe("rt_1");
    expect(entry?.knowledgeIds).toEqual(["kb_a"]);
  });

  test("removes a session attachment record cleanly", async () => {
    const store = new KnowledgeAttachmentService();
    await store.set("ws_1", "ses_1", "rt_1", ["kb_a"]);

    await store.remove("ws_1", "ses_1");

    expect(await store.get("ws_1", "ses_1")).toEqual([]);
    expect(await store.getEntry("ws_1", "ses_1")).toBeNull();
  });
});
