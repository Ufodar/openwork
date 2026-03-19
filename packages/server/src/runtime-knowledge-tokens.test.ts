import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeKnowledgeTokenService } from "./runtime-knowledge-tokens.js";

describe("RuntimeKnowledgeTokenService", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openwork-runtime-knowledge-tokens-"));
    process.env.OPENWORK_DATA_DIR = root;
  });

  test("issues a read-only runtime token bound to one runtime id", async () => {
    const tokens = new RuntimeKnowledgeTokenService();
    const issued = await tokens.issue({ workspaceId: "ws_1", sessionId: "ses_1", runtimeId: "rt_1" });

    const resolved = await tokens.resolve(issued.token);

    expect(issued.token.startsWith("owkrt_")).toBe(true);
    expect(resolved).toMatchObject({
      workspaceId: "ws_1",
      sessionId: "ses_1",
      runtimeId: "rt_1",
    });
  });

  test("does not resolve expired runtime tokens", async () => {
    let now = 1_000;
    const tokens = new RuntimeKnowledgeTokenService({ now: () => now });
    const issued = await tokens.issue({
      workspaceId: "ws_1",
      sessionId: "ses_1",
      runtimeId: "rt_1",
      ttlMs: 50,
    });

    now = 1_100;

    await expect(tokens.resolve(issued.token)).resolves.toBeNull();
  });
});
