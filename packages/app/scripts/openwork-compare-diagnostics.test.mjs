import { describe, expect, test } from "bun:test";

import {
  buildCompactToolTrace,
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
      toolPart("bash", { command: "cd /Users/storm/Documents/code/studyProject/opencode-docx/openwork && bocha-search --query \"算力网络\"" }),
      toolPart("read", { filePath: "/workspace/documents/sessions/rt_1/reports/brief.md" }),
    ], {
      workspaceDir: "/workspace/documents/sessions/rt_1",
    });

    expect(summary.externalPathTouchCount).toBe(2);
    expect(summary.systemTempTouchCount).toBe(1);
    expect(summary.issueCounts["external-path-touch"]).toBe(2);
    expect(summary.issueCounts["system-temp-touch"]).toBe(1);
  });

  test("flags system temp writes embedded in bash commands", () => {
    const summary = summarizeConversationDiagnostics([
      toolPart("bash", { command: "pandoc input.docx -t plain -o /tmp/out.txt" }),
      toolPart("bash", { command: "mkdir -p .tmp/system && pandoc input.docx -t plain -o .tmp/system/out.txt" }),
    ], {
      workspaceDir: "/workspace/documents/sessions/rt_1",
    });

    expect(summary.systemTempTouchCount).toBe(1);
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

  test("tracks when the session has entered the deliverable-writing phase", () => {
    const summary = summarizeConversationDiagnostics([
      toolPart("bash", { command: "mkdir -p outputs" }),
      toolPart("write", { filePath: "/workspace/documents/sessions/rt_1/outputs/final.md" }),
      toolPart("bash", { command: "python3 .opencode/references/check_document_delivery.py --target outputs --target reports" }),
    ], {
      workspaceDir: "/workspace/documents/sessions/rt_1",
    });

    expect(summary.deliverableTouchCount).toBe(3);
  });
});

describe("buildCompactToolTrace", () => {
  test("captures a compact sequence with tool-specific inputs and issue codes", () => {
    const trace = buildCompactToolTrace([
      toolPart("grep", { filePath: "/repo/.opencode/agent/common-work.md", pattern: "bocha-search|webfetch" }),
      toolPart("webfetch", { url: "https://example.com/spec", format: "markdown" }, { error: "fetch failed" }),
      toolPart("bash", { command: "find . -type f | head -20" }),
    ], {
      workspaceDir: "/workspace/documents/sessions/rt_1",
      maxEntries: 2,
    });

    expect(trace).toHaveLength(2);
    expect(trace[0]).toEqual({
      index: 0,
      tool: "grep",
      status: "completed",
      issueCodes: ["external-path-touch"],
      filePath: "/repo/.opencode/agent/common-work.md",
      pattern: "bocha-search|webfetch",
    });
    expect(trace[1]).toEqual({
      index: 1,
      tool: "webfetch",
      status: "completed",
      issueCodes: ["fetch-failed"],
      url: "https://example.com/spec",
    });
  });

  test("records system temp bash writes in compact traces", () => {
    const trace = buildCompactToolTrace([
      toolPart("bash", { command: "pandoc input.docx -o /tmp/out.txt" }),
    ], {
      workspaceDir: "/workspace/documents/sessions/rt_1",
    });

    expect(trace).toEqual([
      {
        index: 0,
        tool: "bash",
        status: "completed",
        issueCodes: ["system-temp-touch"],
        command: "pandoc input.docx -o /tmp/out.txt",
      },
    ]);
  });
});

describe("shouldStopDiagnosticCapture", () => {
  test("stops once enough tool calls have accumulated", () => {
    const decision = shouldStopDiagnosticCapture({
      totalToolCalls: 9,
      leadingDiscoveryBurst: 1,
      deliverableTouchCount: 0,
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
      deliverableTouchCount: 0,
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
      deliverableTouchCount: 0,
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

  test("does not stop on max tool calls after deliverable generation has started", () => {
    const decision = shouldStopDiagnosticCapture({
      totalToolCalls: 26,
      leadingDiscoveryBurst: 0,
      deliverableTouchCount: 2,
      issueCounts: {},
    }, {
      maxToolCalls: 24,
      minToolCallsBeforeIssueStop: 4,
      maxLeadingDiscoveryBurst: 5,
    });

    expect(decision.stop).toBe(false);
    expect(decision.reason).toBeNull();
  });
});
