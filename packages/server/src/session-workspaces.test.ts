import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSessionPermissionRules,
  provisionSessionWorkspace,
  SessionWorkspaceService,
  writeRuntimeDocumentStateCarrierConfig,
  writeRuntimeKnowledgeCarrierConfig,
} from "./session-workspaces.js";
import { exists } from "./utils.js";

const originalOpenworkDataDir = process.env.OPENWORK_DATA_DIR;

afterEach(() => {
  if (typeof originalOpenworkDataDir === "string") process.env.OPENWORK_DATA_DIR = originalOpenworkDataDir;
  else delete process.env.OPENWORK_DATA_DIR;
});

describe("provisionSessionWorkspace", () => {
  test("denies external directories and system-temp document outputs for hosted session runtimes", () => {
    const rules = buildSessionPermissionRules();

    expect(rules).toHaveLength(41);
    expect(rules).toContainEqual({ permission: "bash", pattern: "*-o /tmp/*.md*", action: "deny" });
    expect(rules).toContainEqual({ permission: "bash", pattern: "*> /tmp/*.md*", action: "deny" });
    expect(rules).toContainEqual({ permission: "bash", pattern: "*-o /private/tmp/*.docx*", action: "deny" });
    expect(rules).toContainEqual({ permission: "bash", pattern: "*> /private/tmp/*.pptx*", action: "deny" });
    expect(rules).toContainEqual({ permission: "external_directory", pattern: "*", action: "deny" });
  });

  test("drops unsafe absolute filesystem MCP roots from the runtime carrier config", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-host-fs-"));
    await writeFile(
      join(workspacePath, "opencode.jsonc"),
      JSON.stringify({
        model: "test-model",
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/storm/Documents/code"],
          },
          memory: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
          },
        },
      }, null, 2),
      "utf8",
    );

    const result = await provisionSessionWorkspace(workspacePath);
    const raw = await readFile(join(result.runtimeDir, "opencode.jsonc"), "utf8");
    const parsed = JSON.parse(raw) as {
      mcp?: Record<string, unknown>;
    };

    expect(parsed.mcp?.filesystem).toBeUndefined();
    expect(parsed.mcp?.memory).toMatchObject({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    });
  });

  test("creates a runtime directory, a workspace-local temp root, and mirrors required .opencode support files", async () => {
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
    const runtimeConfigRaw = await readFile(join(result.runtimeDir, "opencode.jsonc"), "utf8");
    const runtimeConfig = JSON.parse(runtimeConfigRaw) as {
      model?: string;
      instructions?: string[];
    };
    const runtimeInstructionRaw = await readFile(join(result.runtimeDir, ".opencode", "openwork-runtime.md"), "utf8");

    expect(result.runtimeDir.startsWith(join(workspacePath, "documents", "sessions"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "opencode.json"))).toBe(false);
    expect(await exists(join(result.runtimeDir, "opencode.jsonc"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".tmp", "system"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "commands", "hello.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "prompts", "doc-orchestrator.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "references", "doc-state-schema.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "skills", "docx", "SKILL.md"))).toBe(true);
    expect(runtimeConfig.model).toBe("test");
    expect(runtimeConfig.instructions).toContain(".opencode/openwork-runtime.md");
    expect(runtimeInstructionRaw).toContain("<WORKSPACE>/.tmp/system");
    expect(runtimeInstructionRaw).toContain("copy or re-emit the needed artifact into `<WORKSPACE>/.tmp/system/`");
    expect(runtimeInstructionRaw).toContain("Treat `/tmp/*` and `/private/tmp/*` as shell-only transient paths");
  });

  test("prunes runtime skills and unrelated MCP entries for document-agent sessions", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-doc-agent-"));
    await mkdir(join(workspacePath, ".opencode", "skills", "docx"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "doc-normalize"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "openwork-debug"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "skill-creator"), { recursive: true });
    await writeFile(join(workspacePath, ".opencode", "skills", "docx", "SKILL.md"), "# docx\n", "utf8");
    await writeFile(join(workspacePath, ".opencode", "skills", "doc-normalize", "SKILL.md"), "# doc-normalize\n", "utf8");
    await writeFile(join(workspacePath, ".opencode", "skills", "openwork-debug", "SKILL.md"), "# debug\n", "utf8");
    await writeFile(join(workspacePath, ".opencode", "skills", "skill-creator", "SKILL.md"), "# skill-creator\n", "utf8");
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
          "sequential-thinking": {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
          },
          "bocha-search": {
            type: "local",
            command: ["uv", "--directory", "/tmp/bocha", "run", "bocha-search-mcp"],
          },
          ragflow: {
            type: "remote",
            url: "https://ragflow.example.invalid",
          },
        },
      }, null, 2),
      "utf8",
    );

    const runtime = await provisionSessionWorkspace(workspacePath, {
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
    });

    expect(await exists(join(runtime.runtimeDir, ".opencode", "skills", "docx", "SKILL.md"))).toBe(true);
    expect(await exists(join(runtime.runtimeDir, ".opencode", "skills", "doc-normalize", "SKILL.md"))).toBe(true);
    expect(await exists(join(runtime.runtimeDir, ".opencode", "skills", "openwork-debug", "SKILL.md"))).toBe(false);
    expect(await exists(join(runtime.runtimeDir, ".opencode", "skills", "skill-creator", "SKILL.md"))).toBe(false);

    await writeRuntimeKnowledgeCarrierConfig({
      workspacePath,
      runtimeDir: runtime.runtimeDir,
      mcpUrl: "http://127.0.0.1:8789/workspace/ws_1/knowledge/mcp",
      runtimeToken: "owkrt_test",
      attachedKnowledge: [],
    });

    const raw = await readFile(join(runtime.runtimeDir, "opencode.jsonc"), "utf8");
    const parsed = JSON.parse(raw) as {
      openwork?: Record<string, unknown>;
      mcp?: Record<string, unknown>;
    };

    expect((parsed.openwork?.runtimeSessionProfile as Record<string, unknown> | undefined)?.id).toBe("document-agent");
    expect(parsed.mcp?.filesystem).toBeTruthy();
    expect(parsed.mcp?.["bocha-search"]).toBeTruthy();
    expect(parsed.mcp?.["openwork-knowledge"]).toBeTruthy();
    expect(parsed.mcp?.memory).toBeUndefined();
    expect(parsed.mcp?.["sequential-thinking"]).toBeUndefined();
    expect(parsed.mcp?.ragflow).toBeUndefined();
  });

  test("keeps openwork-core for document-writer runtime sessions", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-doc-writer-"));
    await mkdir(join(workspacePath, ".opencode", "skills", "docx"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "openwork-core", "scripts"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "openwork-debug"), { recursive: true });
    await writeFile(join(workspacePath, ".opencode", "skills", "docx", "SKILL.md"), "# docx\n", "utf8");
    await writeFile(join(workspacePath, ".opencode", "skills", "openwork-core", "SKILL.md"), "# openwork-core\n", "utf8");
    await writeFile(join(workspacePath, ".opencode", "skills", "openwork-core", "scripts", "extract_doc_state.py"), "print('ok')\n", "utf8");
    await writeFile(join(workspacePath, ".opencode", "skills", "openwork-debug", "SKILL.md"), "# debug\n", "utf8");

    const runtime = await provisionSessionWorkspace(workspacePath, {
      preferredView: "document-writer",
      preferredAgent: "document-writer",
      preferredAgentLock: "document-writer",
    });

    expect(await exists(join(runtime.runtimeDir, ".opencode", "skills", "docx", "SKILL.md"))).toBe(true);
    expect(await exists(join(runtime.runtimeDir, ".opencode", "skills", "openwork-core", "SKILL.md"))).toBe(true);
    expect(await exists(join(runtime.runtimeDir, ".opencode", "skills", "openwork-core", "scripts", "extract_doc_state.py"))).toBe(
      true,
    );
    expect(await exists(join(runtime.runtimeDir, ".opencode", "skills", "openwork-debug", "SKILL.md"))).toBe(false);
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
    expect(parsed.mcp?.memory).toMatchObject({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    });
    expect((parsed.mcp?.memory as Record<string, unknown> | undefined)?.enabled).toBeUndefined();
    expect(parsed.mcp?.ragflow).toBeUndefined();
    expect(parsed.mcp?.["openwork-knowledge"]).toMatchObject({
      type: "remote",
      url: "http://127.0.0.1:8789/workspace/ws_1/knowledge/mcp",
      headers: {
        Authorization: "Bearer owkrt_test",
      },
    });
    expect(parsed.instructions).toContain(".opencode/openwork-runtime.md");
    expect(parsed.instructions).toContain(".opencode/openwork-knowledge.md");
    expect(instructionRaw).toContain("openwork_knowledge_search");
    expect(instructionRaw).toContain("Attached knowledge count: 0");
    expect(instructionRaw).toContain("do not call `openwork_knowledge_search`");
    expect(instructionRaw).toContain("Never use `memory_search_nodes` or `memory_read_graph`");
    expect(instructionRaw).toContain("do not use `memory_search_nodes` or `memory_read_graph` as a substitute for knowledge retrieval");
    expect(instructionRaw).toContain("(none attached yet; do not substitute session memory for knowledge retrieval)");
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
    expect(parsed.instructions).toContain(".opencode/openwork-runtime.md");
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
    expect(parsed.mcp?.memory).toMatchObject({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    });
    expect((parsed.mcp?.memory as Record<string, unknown> | undefined)?.enabled).toBeUndefined();
    expect(instructionRaw).toContain("商业资质库");
    expect(instructionRaw).toContain("Attached knowledge count: 1");
    expect(instructionRaw).toContain("If attachments changed earlier in the conversation");
    expect(instructionRaw).toContain("knowledge_id=kb_alpha");
    expect(instructionRaw).toContain("owner=alice");
  });

  test("persists isolated opencode runtime metadata through the session workspace store", async () => {
    process.env.OPENWORK_DATA_DIR = await mkdtemp(join(tmpdir(), "openwork-session-workspace-store-"));
    const service = new SessionWorkspaceService();

    await service.setWorkspace("ws_1", "ses_1", {
      runtimeId: "runtime_1",
      runtimeDir: "/tmp/runtime-1",
      createdAt: 1,
      opencodeRuntime: {
        mode: "isolated_process",
        rootDir: "/tmp/runtime-1/.openwork-runtime/opencode",
        configDir: "/tmp/runtime-1/.openwork-runtime/opencode/config",
        configHomeDir: "/tmp/runtime-1/.openwork-runtime/opencode/config-home",
        dataDir: "/tmp/runtime-1/.openwork-runtime/opencode/data",
        stateDir: "/tmp/runtime-1/.openwork-runtime/opencode/state",
        cacheDir: "/tmp/runtime-1/.openwork-runtime/opencode/cache",
        tempDir: "/tmp/runtime-1/.tmp/system",
        bindHost: "127.0.0.1",
      },
    });

    const stored = await service.getWorkspace("ws_1", "ses_1");
    const listed = await service.listWorkspaces("ws_1");
    expect(stored?.opencodeRuntime?.mode).toBe("isolated_process");
    expect(stored?.opencodeRuntime?.configDir).toBe("/tmp/runtime-1/.openwork-runtime/opencode/config");
    expect(stored?.opencodeRuntime?.configHomeDir).toBe("/tmp/runtime-1/.openwork-runtime/opencode/config-home");
    expect(stored?.opencodeRuntime?.tempDir).toBe("/tmp/runtime-1/.tmp/system");
    expect(listed.ses_1?.opencodeRuntime?.mode).toBe("isolated_process");
  });
});
