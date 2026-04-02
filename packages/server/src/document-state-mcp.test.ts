import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleDocumentStateMcpRequest } from "./document-state-mcp.js";
import { RuntimeDocumentStateTokenService } from "./runtime-document-state-tokens.js";

describe("document state MCP handler", () => {
  let root: string;
  let workspacePath: string;
  let runtimeTokens: RuntimeDocumentStateTokenService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openwork-doc-state-mcp-"));
    process.env.OPENWORK_DATA_DIR = root;
    workspacePath = await mkdtemp(join(tmpdir(), "openwork-doc-state-workspace-"));
    await mkdir(join(workspacePath, "documents", "sessions", "rt_1", ".worktree", "sources"), { recursive: true });
    await mkdir(join(workspacePath, "documents", "sessions", "rt_1", ".worktree", "plan"), { recursive: true });
    await mkdir(join(workspacePath, "documents", "sessions", "rt_2", ".worktree"), { recursive: true });
    await writeFile(
      join(workspacePath, "documents", "sessions", "rt_1", ".worktree", "index.json"),
      JSON.stringify({
        version: 1,
        phase: "planning",
        summary: { total: 3, done: 1, blocked: 0, in_progress: 1, pending: 1 },
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspacePath, "documents", "sessions", "rt_1", ".worktree", "sources", "doc-a.json"),
      JSON.stringify({
        docId: "doc-a",
        title: "招标文件 A",
        claims: [{ id: "c1", text: "需要不少于 8 核 CPU" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspacePath, "documents", "sessions", "rt_1", ".worktree", "plan", "solution-plan.json"),
      JSON.stringify({
        goal: "plan goal",
        sections: [{ id: "s1", title: "项目理解与目标" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspacePath, "documents", "sessions", "rt_1", ".worktree", "facts.json"),
      JSON.stringify({
        projectName: "多文档测试项目",
        facts: [{ key: "cpu", value: "8 cores" }],
      }, null, 2),
      "utf8",
    );
    runtimeTokens = new RuntimeDocumentStateTokenService();
  });

  async function invoke(token: string, body: Record<string, unknown>) {
    return handleDocumentStateMcpRequest({
      request: new Request("http://openwork.local/workspace/ws_1/doc-state/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
      workspaceId: "ws_1",
      workspacePath,
      runtimeTokens,
      serverVersion: "0.11.121",
    });
  }

  test("lists only the document state tools", async () => {
    const issued = await runtimeTokens.issue({ workspaceId: "ws_1", sessionId: "ses_1", runtimeId: "rt_1" });

    const response = await invoke(issued.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "state_get_brief" },
          { name: "state_list_sources" },
          { name: "state_get_doc" },
          { name: "state_get_facts" },
          { name: "state_get_conflicts" },
          { name: "state_get_plan" },
          { name: "state_get_coverage" },
        ],
      },
    });
  });

  test("runtime token scope resolves state from the bound runtime only", async () => {
    const issued = await runtimeTokens.issue({ workspaceId: "ws_1", sessionId: "ses_1", runtimeId: "rt_1" });

    const response = await invoke(issued.token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "state_get_brief",
        arguments: {},
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        isError: false,
        structuredContent: {
          ok: true,
          workspaceId: "ws_1",
          sessionId: "ses_1",
          runtimeId: "rt_1",
          relativePath: ".worktree/index.json",
          phase: "plan",
          summary: { total: 3, done: 1, blocked: 0, in_progress: 1, pending: 1 },
        },
      },
    });
  });

  test("state_get_facts returns normalized facts payload", async () => {
    const issued = await runtimeTokens.issue({ workspaceId: "ws_1", sessionId: "ses_1", runtimeId: "rt_1" });

    const response = await invoke(issued.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "state_get_facts",
        arguments: {},
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        isError: false,
        structuredContent: {
          projectName: "多文档测试项目",
          facts: [{ key: "cpu", value: "8 cores" }],
        },
      },
    });
  });
});
