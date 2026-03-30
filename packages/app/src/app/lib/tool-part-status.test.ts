import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";

import type { PlaceholderAssistantMessage } from "../types";
import { isToolPartActive, resolveToolPartDisplayStatus } from "./tool-part-status";

const createAssistantMessage = (
  overrides: Partial<PlaceholderAssistantMessage> = {},
): PlaceholderAssistantMessage => ({
  id: "msg_test",
  sessionID: "ses_test",
  role: "assistant",
  time: { created: 1_000 },
  parentID: "msg_parent",
  modelID: "test-model",
  providerID: "test-provider",
  mode: "common-work",
  agent: "common-work",
  path: { cwd: "/tmp", root: "/" },
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
  ...overrides,
});

const createToolPart = (status: string, state: Record<string, unknown> = {}): Part =>
  ({
    id: "prt_test",
    sessionID: "ses_test",
    messageID: "msg_test",
    type: "tool",
    tool: "write",
    state: {
      status,
      ...state,
    },
  }) as Part;

describe("tool part display status", () => {
  test("marks an old pending tool as stale once the session is idle", () => {
    const message = createAssistantMessage({
      time: { created: 10_000 },
    });
    const part = createToolPart("pending", { input: {} });

    expect(
      resolveToolPartDisplayStatus(part, {
        sessionStatus: "idle",
        messageInfo: message,
        now: 320_000,
      }),
    ).toBe("stale");
    expect(
      isToolPartActive(part, {
        sessionStatus: "idle",
        messageInfo: message,
        now: 320_000,
      }),
    ).toBe(false);
  });

  test("keeps a pending tool active while the session is still running", () => {
    const message = createAssistantMessage({
      time: { created: 10_000 },
    });
    const part = createToolPart("pending", { input: { filePath: "/tmp/out.docx" } });

    expect(
      resolveToolPartDisplayStatus(part, {
        sessionStatus: "running",
        messageInfo: message,
        now: 320_000,
      }),
    ).toBe("pending");
    expect(
      isToolPartActive(part, {
        sessionStatus: "running",
        messageInfo: message,
        now: 320_000,
      }),
    ).toBe(true);
  });

  test("keeps an empty pending tool active before the five minute stale threshold", () => {
    const message = createAssistantMessage({
      time: { created: 10_000 },
    });
    const part = createToolPart("pending", { input: {} });

    expect(
      resolveToolPartDisplayStatus(part, {
        sessionStatus: "running",
        messageInfo: message,
        now: 299_000,
      }),
    ).toBe("pending");
    expect(
      isToolPartActive(part, {
        sessionStatus: "running",
        messageInfo: message,
        now: 299_000,
      }),
    ).toBe(true);
  });

  test("marks an unfinished tool on a completed assistant message as stale", () => {
    const message = createAssistantMessage({
      time: { created: 10_000, completed: 15_000 },
    });
    const part = createToolPart("running", { input: { command: "python3 generate.py" } });

    expect(
      resolveToolPartDisplayStatus(part, {
        sessionStatus: "idle",
        messageInfo: message,
        now: 16_000,
      }),
    ).toBe("stale");
  });
});
