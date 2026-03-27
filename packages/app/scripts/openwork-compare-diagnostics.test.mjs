import { describe, expect, test } from "bun:test";

import {
  shouldStopDiagnosticCapture,
  summarizeConversationDiagnostics,
} from "./openwork-compare-diagnostics.mjs";

function toolPart(tool, input = {}, state = {}) {
  return {
    type: "tool",
    tool,
    state: {
      status: "completed",
      input,
      ...state,
    },
  };
}

describe("summarizeConversationDiagnostics", () => {
  test("flags broad discovery scans before real work starts", () => {
    const summary = summarizeConversationDiagnostics([
      toolPart("glob", { pattern: "**/*" }),
      toolPart("filesystem_list_directory", { path: "." }),
      toolPart("bash", { command: "find . -type f | head -200" }),
      toolPart("read", { filePath: "reports/brief.md" }),
    ], {
      workspaceDir: "/workspace/documents/sessions/rt_1",
    });

    expect(summary.totalToolCalls).toBe(4);
    expect(summary.leadingDiscoveryBurst).toBe(3);
    expect(summary.broadDiscoveryCount).toBe(2);
    expect(summary.issueCounts["broad-discovery"]).toBe(2);
    expect(summary.firstMeaningfulTool).toBe("read");
  });

  test("flags external and system temp paths outside the session workspace", () => {
    const summary = summarizeConversationDiagnostics([
      toolPart("glob", { path: "/root/.openwork/user-workspaces/u1/documents/sessions/rt_other" }),
      toolPart("read", { filePath: "/tmp/docx-draft.md" }),
      toolPart("read", { filePath: "/workspace/documents/sessions/rt_1/reports/brief.md" }),
    ], {
      workspaceDir: "/workspace/documents/sessions/rt_1",
    });

    expect(summary.externalPathTouchCount).toBe(1);
    expect(summary.systemTempTouchCount).toBe(1);
    expect(summary.issueCounts["external-path-touch"]).toBe(1);
    expect(summary.issueCounts["system-temp-touch"]).toBe(1);
  });

  test("flags direct office reads and repeated failures", () => {
    const summary = summarizeConversationDiagnostics([
      toolPart("read", { filePath: "资料.docx" }),
      toolPart("bash", { command: "python bad.py" }, { error: "Access denied" }),
      toolPart("bash", { command: "python bad.py" }, { error: "Access denied" }),
    ], {
      workspaceDir: "/workspace/documents/sessions/rt_1",
    });

    expect(summary.directOfficeReadCount).toBe(1);
    expect(summary.repeatedFailureCount).toBe(1);
    expect(summary.issueCounts["direct-office-read"]).toBe(1);
    expect(summary.issueCounts["access-denied"]).toBe(2);
  });
});

describe("shouldStopDiagnosticCapture", () => {
  test("stops once enough tool calls have accumulated", () => {
    const decision = shouldStopDiagnosticCapture({
      totalToolCalls: 9,
      leadingDiscoveryBurst: 1,
      issueCounts: {},
    }, {
      maxToolCalls: 8,
      minToolCallsBeforeIssueStop: 4,
      maxLeadingDiscoveryBurst: 5,
    });

    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe("max-tool-calls");
  });

  test("stops early when hosted-only drift is already visible", () => {
    const decision = shouldStopDiagnosticCapture({
      totalToolCalls: 4,
      leadingDiscoveryBurst: 2,
      issueCounts: {
        "external-path-touch": 1,
      },
    }, {
      maxToolCalls: 8,
      minToolCallsBeforeIssueStop: 4,
      maxLeadingDiscoveryBurst: 5,
    });

    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe("issue-detected");
  });

  test("stops when the session burns too many discovery-only tool calls", () => {
    const decision = shouldStopDiagnosticCapture({
      totalToolCalls: 5,
      leadingDiscoveryBurst: 5,
      issueCounts: {
        "broad-discovery": 3,
      },
    }, {
      maxToolCalls: 8,
      minToolCallsBeforeIssueStop: 4,
      maxLeadingDiscoveryBurst: 5,
    });

    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe("discovery-drift");
  });
});
