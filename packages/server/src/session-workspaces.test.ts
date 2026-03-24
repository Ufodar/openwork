import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  provisionSessionWorkspace,
  writeRuntimeDocumentStateCarrierConfig,
  writeRuntimeKnowledgeCarrierConfig,
} from "./session-workspaces.js";
import { exists } from "./utils.js";

describe("provisionSessionWorkspace", () => {
  test("creates a runtime directory and mirrors required .opencode support files", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-"));
    await mkdir(join(workspacePath, ".opencode", "prompts"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "references"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "commands"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "docx"), { recursive: true });
    await writeFile(join(workspacePath, "opencode.json"), JSON.stringify({ model: "test" }), "utf8");
    await writeFile(join(workspacePath, ".opencode", "prompts", "doc-orchestrator.md"), "prompt", "utf8");
    await writeFile(join(workspacePath, ".opencode", "references", "doc-state-schema.md"), "reference", "utf8");
    await writeFile(join(workspacePath, ".opencode", "commands", "hello.md"), "---\n---\nhello\n", "utf8");
    await writeFile(join(workspacePath, ".opencode", "skills", "docx", "SKILL.md"), "# skill\n", "utf8");

    const result = await provisionSessionWorkspace(workspacePath);

    expect(result.runtimeDir.startsWith(join(workspacePath, "documents", "sessions"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "opencode.json"))).toBe(false);
    expect(await exists(join(result.runtimeDir, ".opencode", "commands", "hello.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "prompts", "doc-orchestrator.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "references", "doc-state-schema.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "skills", "docx", "SKILL.md"))).toBe(true);
  });

  test("writes a runtime knowledge carrier config by preserving parent config and adding the MCP", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-overlay-"));
    const runtime = await provisionSessionWorkspace(workspacePath);
    await writeFile(
      join(workspacePath, "opencode.jsonc"),
      JSON.stringify({
        model: "test-model",
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
          },
          memory: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
          },
          ragflow: {
            type: "remote",
            url: "https://ragflow.example.invalid",
          },
        },
      }, null, 2),
      "utf8",
    );

    const configPath = await writeRuntimeKnowledgeCarrierConfig({
      workspacePath,
      runtimeDir: runtime.runtimeDir,
      mcpUrl: "http://127.0.0.1:8789/workspace/ws_1/knowledge/mcp",
      runtimeToken: "owkrt_test",
    });

    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as {
      model?: string;
      mcp?: Record<string, unknown>;
      instructions?: string[];
    };
    const instructionRaw = await readFile(join(runtime.runtimeDir, ".opencode", "openwork-knowledge.md"), "utf8");

    expect(parsed.model).toBe("test-model");
    expect(parsed.mcp?.filesystem).toBeTruthy();
    expect(parsed.mcp?.memory).toBeTruthy();
    expect(parsed.mcp?.ragflow).toBeUndefined();
    expect(parsed.mcp?.["openwork-knowledge"]).toMatchObject({
      type: "remote",
      url: "http://127.0.0.1:8789/workspace/ws_1/knowledge/mcp",
      headers: {
        Authorization: "Bearer owkrt_test",
      },
    });
    expect(parsed.instructions).toContain(".opencode/openwork-knowledge.md");
    expect(instructionRaw).toContain("openwork_knowledge_search");
    expect(instructionRaw).toContain("Never use `memory_search_nodes` or `memory_read_graph`");
    expect(instructionRaw).toContain("(none attached yet)");
  });

  test("writes a runtime document-state carrier config by preserving parent config and adding the MCP", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-doc-state-overlay-"));
    const runtime = await provisionSessionWorkspace(workspacePath);
    await writeFile(
      join(workspacePath, "opencode.jsonc"),
      JSON.stringify({
        model: "test-model",
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
          },
        },
      }, null, 2),
      "utf8",
    );

    const configPath = await writeRuntimeDocumentStateCarrierConfig({
      workspacePath,
      runtimeDir: runtime.runtimeDir,
      mcpUrl: "http://127.0.0.1:8789/workspace/ws_1/doc-state/mcp",
      runtimeToken: "owdst_test",
    });

    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as {
      model?: string;
      mcp?: Record<string, unknown>;
      instructions?: string[];
    };
    const instructionRaw = await readFile(join(runtime.runtimeDir, ".opencode", "doc-state.md"), "utf8");

    expect(parsed.model).toBe("test-model");
    expect(parsed.mcp?.filesystem).toBeTruthy();
    expect(parsed.mcp?.doc_state).toMatchObject({
      type: "remote",
      url: "http://127.0.0.1:8789/workspace/ws_1/doc-state/mcp",
      headers: {
        Authorization: "Bearer owdst_test",
      },
    });
    expect(parsed.instructions).toContain(".opencode/doc-state.md");
    expect(instructionRaw).toContain("doc_state_state_get_brief");
    expect(instructionRaw).toContain("doc_state_state_get_facts");
  });

  test("updates the runtime knowledge instructions with the current attached titles", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-knowledge-state-"));
    const runtime = await provisionSessionWorkspace(workspacePath);
    await writeFile(
      join(workspacePath, "opencode.jsonc"),
      JSON.stringify({
        model: "test-model",
        mcp: {
          memory: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
          },
          ragflow: {
            type: "remote",
            url: "https://ragflow.example.invalid",
          },
        },
      }, null, 2),
      "utf8",
    );

    const configPath = await writeRuntimeKnowledgeCarrierConfig({
      workspacePath,
      runtimeDir: runtime.runtimeDir,
      mcpUrl: "http://127.0.0.1:8789/workspace/ws_1/knowledge/mcp",
      runtimeToken: "owkrt_test",
      attachedKnowledge: [
        {
          knowledgeId: "kb_alpha",
          title: "商业资质库",
          ownerDisplayName: "alice",
          description: "企业证照与资质材料",
        },
      ],
    });

    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as {
      mcp?: Record<string, unknown>;
    };
    const instructionRaw = await readFile(join(runtime.runtimeDir, ".opencode", "openwork-knowledge.md"), "utf8");
    expect(parsed.mcp?.ragflow).toBeUndefined();
    expect(parsed.mcp?.memory).toMatchObject({ enabled: false });
    expect(instructionRaw).toContain("商业资质库");
    expect(instructionRaw).toContain("knowledge_id=kb_alpha");
    expect(instructionRaw).toContain("owner=alice");
  });
});
