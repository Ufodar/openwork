import { expect, test } from "bun:test";

import {
  detectStalledPendingTools,
  shouldTreatFingerprintChangeAsProgress,
  summarizePendingToolStates,
} from "./session-settle-guards.mjs";

test("summarizePendingToolStates captures pending tool shape", () => {
  const messages = [{
    parts: [
      {
        type: "tool",
        tool: "write",
        state: {
          status: "pending",
          input: { filePath: "outputs/demo.md" },
          raw: "{\"filePath\":\"outputs/demo.md\"}",
        },
      },
    ],
  }];

  expect(summarizePendingToolStates(messages)).toEqual([
    {
      tool: "write",
      status: "pending",
      raw: "{\"filePath\":\"outputs/demo.md\"}",
      inputKeys: ["filePath"],
      malformed: false,
      delegated: false,
    },
  ]);
});

test("detectStalledPendingTools flags malformed pending tools on the short timeout", () => {
  const messages = [{
    parts: [
      {
        type: "tool",
        tool: "bash",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    ],
  }];

  expect(
    detectStalledPendingTools({
      messages,
      lastProgressAt: 0,
      now: 31_000,
      malformedPendingToolTimeoutMs: 30_000,
      stalledPendingToolTimeoutMs: 120_000,
    }),
  ).toEqual({
    kind: "malformed-pending-tool",
    pendingTools: [
      {
        tool: "bash",
        status: "pending",
        raw: "",
        inputKeys: [],
        malformed: true,
        delegated: false,
      },
    ],
  });
});

test("detectStalledPendingTools keeps the default malformed timeout at 60 seconds", () => {
  const messages = [{
    parts: [
      {
        type: "tool",
        tool: "bash",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    ],
  }];

  expect(
    detectStalledPendingTools({
      messages,
      lastProgressAt: 0,
      now: 31_000,
      stalledPendingToolTimeoutMs: 120_000,
    }),
  ).toBeNull();
});

test("detectStalledPendingTools flags generic stalled pending tools on the long timeout", () => {
  const messages = [{
    parts: [
      {
        type: "tool",
        tool: "write",
        state: {
          status: "running",
          input: { filePath: "outputs/demo.md" },
          raw: "{\"filePath\":\"outputs/demo.md\"}",
        },
      },
    ],
  }];

  expect(
    detectStalledPendingTools({
      messages,
      lastProgressAt: 0,
      now: 121_000,
      malformedPendingToolTimeoutMs: 30_000,
      stalledPendingToolTimeoutMs: 120_000,
    }),
  ).toEqual({
    kind: "stalled-pending-tool",
    pendingTools: [
      {
        tool: "write",
        status: "running",
        raw: "{\"filePath\":\"outputs/demo.md\"}",
        inputKeys: ["filePath"],
        malformed: false,
        delegated: false,
      },
    ],
  });
});

test("detectStalledPendingTools does not fast-fail delegated task tools", () => {
  const messages = [{
    parts: [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "running",
          input: {
            description: "Compile source documents into state",
            prompt: "subagent prompt",
            subagent_type: "doc-intake",
          },
          raw: "",
        },
      },
    ],
  }];

  expect(
    detectStalledPendingTools({
      messages,
      lastProgressAt: 0,
      now: 300_000,
      malformedPendingToolTimeoutMs: 30_000,
      stalledPendingToolTimeoutMs: 120_000,
    }),
  ).toBeNull();
});

test("detectStalledPendingTools ignores malformed delegated task placeholders on the short timeout", () => {
  const messages = [{
    parts: [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    ],
  }];

  expect(
    detectStalledPendingTools({
      messages,
      lastProgressAt: 0,
      now: 31_000,
      malformedPendingToolTimeoutMs: 30_000,
      stalledPendingToolTimeoutMs: 120_000,
    }),
  ).toBeNull();
});

test("detectStalledPendingTools ignores malformed glob placeholders on the short timeout", () => {
  const messages = [{
    parts: [
      {
        type: "tool",
        tool: "glob",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    ],
  }];

  expect(
    detectStalledPendingTools({
      messages,
      lastProgressAt: 0,
      now: 31_000,
      malformedPendingToolTimeoutMs: 30_000,
      stalledPendingToolTimeoutMs: 120_000,
    }),
  ).toBeNull();
});

test("detectStalledPendingTools stays quiet when no pending tools exist", () => {
  const messages = [{
    parts: [
      {
        type: "tool",
        tool: "write",
        state: {
          status: "completed",
          input: { filePath: "outputs/demo.md" },
          raw: "{\"filePath\":\"outputs/demo.md\"}",
        },
      },
    ],
  }];

  expect(
    detectStalledPendingTools({
      messages,
      lastProgressAt: 0,
      now: 999_999,
      malformedPendingToolTimeoutMs: 30_000,
      stalledPendingToolTimeoutMs: 120_000,
    }),
  ).toBeNull();
});

test("shouldTreatFingerprintChangeAsProgress treats malformed placeholder steps as progress until they actually stall", () => {
  const messages = [{
    role: "assistant",
    parts: [
      {
        type: "tool",
        tool: "write",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    ],
  }];

  expect(shouldTreatFingerprintChangeAsProgress(messages)).toBe(true);
});

test("shouldTreatFingerprintChangeAsProgress treats placeholder reads as progress", () => {
  const messages = [{
    role: "assistant",
    parts: [
      {
        type: "tool",
        tool: "read",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    ],
  }];

  expect(shouldTreatFingerprintChangeAsProgress(messages)).toBe(true);
});

test("shouldTreatFingerprintChangeAsProgress treats placeholder globs as progress", () => {
  const messages = [{
    role: "assistant",
    parts: [
      {
        type: "tool",
        tool: "glob",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    ],
  }];

  expect(shouldTreatFingerprintChangeAsProgress(messages)).toBe(true);
});

test("shouldTreatFingerprintChangeAsProgress treats placeholder writes as progress", () => {
  const messages = [{
    role: "assistant",
    parts: [
      {
        type: "tool",
        tool: "write",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    ],
  }];

  expect(shouldTreatFingerprintChangeAsProgress(messages)).toBe(true);
});

test("shouldTreatFingerprintChangeAsProgress treats placeholder bash steps as progress", () => {
  const messages = [{
    role: "assistant",
    parts: [
      {
        type: "tool",
        tool: "bash",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    ],
  }];

  expect(shouldTreatFingerprintChangeAsProgress(messages)).toBe(true);
});

test("shouldTreatFingerprintChangeAsProgress still counts well-formed tool activity as progress", () => {
  const messages = [{
    role: "assistant",
    parts: [
      {
        type: "tool",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "echo ok", description: "demo" },
          raw: "",
        },
      },
    ],
  }];

  expect(shouldTreatFingerprintChangeAsProgress(messages)).toBe(true);
});
