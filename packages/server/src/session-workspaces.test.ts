import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readlink, readdir, writeFile } from "node:fs/promises";
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

    expect(rules).toHaveLength(43);
    expect(rules).toContainEqual({ permission: "bash", pattern: "*-o /tmp/*.md*", action: "deny" });
    expect(rules).toContainEqual({ permission: "bash", pattern: "*> /tmp/*.md*", action: "deny" });
    expect(rules).toContainEqual({ permission: "bash", pattern: "*-o /private/tmp/*.docx*", action: "deny" });
    expect(rules).toContainEqual({ permission: "bash", pattern: "*> /private/tmp/*.pptx*", action: "deny" });
    expect(rules).toContainEqual({ permission: "glob", pattern: "**/*", action: "deny" });
    expect(rules).toContainEqual({ permission: "external_directory", pattern: `${process.env.HOME ?? "/Users/storm"}/.config/opencode/skills/*`, action: "allow" });
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
    expect(parsed.mcp?.memory).toBeUndefined();
  });

  test("creates a bid-workbench node runtime with shared roots and a private node scope", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-bid-node-"));
    await mkdir(join(workspacePath, ".opencode", "skills", "docx"), { recursive: true });
    await writeFile(
      join(workspacePath, ".opencode", "skills", "docx", "SKILL.md"),
      "# docx\n",
      "utf8",
    );
    await writeFile(join(workspacePath, "opencode.jsonc"), JSON.stringify({ model: "test" }, null, 2), "utf8");

    const result = await provisionSessionWorkspace(workspacePath, {
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
      runtimeProfileId: "bid-workbench-node",
      runtimeScopeKind: "bid-workbench-node",
      runtimeScopeKey: "node-a",
      bidNodeId: "node-a",
    });

    expect(await exists(join(result.runtimeDir, "bid-workbench", "tender"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "bid-workbench", "reference"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "bid-workbench", "templates"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "bid-workbench", "output"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "bid-workbench", "runtime", "node-a", result.runtimeId))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".openwork", "bid-workbench"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "openwork-bid-workbench-node.md"))).toBe(true);

    const runtimeConfigRaw = await readFile(join(result.runtimeDir, "opencode.jsonc"), "utf8");
    const runtimeConfig = JSON.parse(runtimeConfigRaw) as { instructions?: string[] };
    expect(runtimeConfig.instructions).toContain(".opencode/openwork-bid-workbench-node.md");
  });

  test("creates a runtime directory, a workspace-local temp root, and mirrors required .opencode support files", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-"));
    await mkdir(join(workspacePath, ".opencode", "prompts"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "references"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "instructions"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "commands"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "docx"), { recursive: true });
    await writeFile(
      join(workspacePath, "opencode.jsonc"),
      JSON.stringify({
        model: "test",
        instructions: [".opencode/instructions/shared-agent-governance.md"],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspacePath, ".opencode", "prompts", "doc-orchestrator.md"), "prompt", "utf8");
    await writeFile(join(workspacePath, ".opencode", "references", "doc-state-schema.md"), "reference", "utf8");
    await writeFile(join(workspacePath, ".opencode", "instructions", "shared-agent-governance.md"), "instruction", "utf8");
    await writeFile(join(workspacePath, ".opencode", "commands", "hello.md"), "---\n---\nhello\n", "utf8");
    await writeFile(join(workspacePath, ".opencode", "skills", "docx", "SKILL.md"), "# skill\n", "utf8");

    const result = await provisionSessionWorkspace(workspacePath);
    const runtimeConfigRaw = await readFile(join(result.runtimeDir, "opencode.jsonc"), "utf8");
    const runtimeConfig = JSON.parse(runtimeConfigRaw) as {
      model?: string;
      instructions?: string[];
    };
    const runtimeInstructionRaw = await readFile(join(result.runtimeDir, ".opencode", "openwork-runtime.md"), "utf8");
    const runtimeGitignoreRaw = await readFile(join(result.runtimeDir, ".gitignore"), "utf8");

    expect(result.runtimeDir.startsWith(join(workspacePath, "documents", "sessions"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".git"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".gitignore"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "opencode.json"))).toBe(false);
    expect(await exists(join(result.runtimeDir, "opencode.jsonc"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".tmp", "system"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "commands", "hello.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "prompts", "doc-orchestrator.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "references", "doc-state-schema.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "skills", "docx", "SKILL.md"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".opencode", "instructions", "shared-agent-governance.md"))).toBe(true);
    expect(runtimeConfig.model).toBe("test");
    expect(runtimeConfig.instructions).toContain(".opencode/instructions/shared-agent-governance.md");
    expect(runtimeConfig.instructions).toContain(".opencode/openwork-runtime.md");
    expect(runtimeInstructionRaw).toContain("Minimal runtime contract:");
    expect(runtimeInstructionRaw).toContain("<WORKSPACE>/.tmp/system");
    expect(runtimeInstructionRaw).toContain("Keep persisted state, user-visible deliverables");
    expect(runtimeInstructionRaw).toContain("Treat system temp paths such as `/tmp/*` and `/private/tmp/*` as shell-local only");
    expect(runtimeInstructionRaw).toContain("Do not rely on workspace-external absolute paths or `external_directory`");
    expect(runtimeGitignoreRaw).toContain(".openwork-runtime/");
    expect(runtimeGitignoreRaw).toContain(".tmp/");
  });

  test("prepares shared bid-workbench roots and a node-private runtime surface for bid-workbench node sessions", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-bid-node-"));
    await mkdir(join(workspacePath, ".opencode", "skills", "docx"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "pdf"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "xlsx"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "pptx"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "doc-coauthoring"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "doc-normalize"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "skills", "hermes-learning-loop"), { recursive: true });
    await writeFile(join(workspacePath, "opencode.jsonc"), JSON.stringify({ model: "test-bid-node" }, null, 2), "utf8");

    const result = await provisionSessionWorkspace(workspacePath, {
      runtimeProfileId: "bid-workbench-node",
      runtimeScopeKind: "bid-workbench-node",
      runtimeScopeKey: "node-a",
      bidNodeId: "node-a",
    });

    const runtimeConfigRaw = await readFile(join(result.runtimeDir, "opencode.jsonc"), "utf8");
    const runtimeConfig = JSON.parse(runtimeConfigRaw) as { instructions?: string[] };
    const runtimeInstructionRaw = await readFile(
      join(result.runtimeDir, ".opencode", "openwork-bid-workbench-node.md"),
      "utf8",
    );

    expect(await exists(join(result.runtimeDir, "bid-workbench", "runtime", "node-a", result.runtimeId))).toBe(true);
    expect(await exists(join(result.runtimeDir, "bid-workbench", "tender"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "bid-workbench", "reference"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "bid-workbench", "templates"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "bid-workbench", "output"))).toBe(true);
    expect(await exists(join(result.runtimeDir, ".openwork", "bid-workbench"))).toBe(true);
    expect(await readlink(join(result.runtimeDir, "bid-workbench", "tender"))).toContain(
      ".opencode/openwork/inbox/bid-workbench/tender",
    );
    expect(await readlink(join(result.runtimeDir, ".openwork", "bid-workbench"))).toContain(
      ".openwork/bid-workbench",
    );
    expect(runtimeConfig.instructions).toContain(".opencode/openwork-bid-workbench-node.md");
    expect(runtimeInstructionRaw).toContain("Bid Workbench Node Contract");
    expect(runtimeInstructionRaw).toContain("bid-workbench/output/");
    expect(runtimeInstructionRaw).toContain("node-briefs/node-a.md");
  });

  test("prunes runtime skills and unrelated MCP entries for document-agent sessions", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-doc-agent-"));
    const allSkills = [
      "content-research-writer",
      "doc-coauthoring",
      "doc-normalize",
      "docx",
      "hermes-learning-loop",
      "image-enhancer",
      "internal-comms",
      "openwork-debug",
      "pdf",
      "pptx",
      "skill-creator",
      "xlsx",
    ] as const;
    for (const skill of allSkills) {
      await mkdir(join(workspacePath, ".opencode", "skills", skill), { recursive: true });
      await writeFile(join(workspacePath, ".opencode", "skills", skill, "SKILL.md"), `# ${skill}\n`, "utf8");
    }
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
    const runtimeSkillDirs = (await readdir(join(runtime.runtimeDir, ".opencode", "skills"))).sort();

    expect(runtimeSkillDirs).toEqual([
      "doc-coauthoring",
      "doc-normalize",
      "docx",
      "hermes-learning-loop",
      "pdf",
      "pptx",
      "xlsx",
    ]);

    await writeRuntimeKnowledgeCarrierConfig({
      workspacePath,
      runtimeDir: runtime.runtimeDir,
      mcpUrl: "http://127.0.0.1:8789/workspace/ws_1/knowledge/mcp",
      runtimeToken: "owkrt_test",
      attachedKnowledge: [],
    });
    await writeRuntimeDocumentStateCarrierConfig({
      workspacePath,
      runtimeDir: runtime.runtimeDir,
      mcpUrl: "http://127.0.0.1:8789/workspace/ws_1/doc-state/mcp",
      runtimeToken: "owdst_test",
    });

    const raw = await readFile(join(runtime.runtimeDir, "opencode.jsonc"), "utf8");
    const profileRaw = await readFile(join(runtime.runtimeDir, ".opencode", "openwork-runtime-profile.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      mcp?: Record<string, unknown>;
    };
    const profile = JSON.parse(profileRaw) as { id?: string; skillAllowlist?: string[]; mcpAllowlist?: string[] };

    expect(profile.id).toBe("document-agent");
    expect(profile.skillAllowlist?.sort()).toEqual([
      "doc-coauthoring",
      "doc-normalize",
      "docx",
      "hermes-learning-loop",
      "pdf",
      "pptx",
      "xlsx",
    ]);
    expect(profile.mcpAllowlist?.sort()).toEqual([
      "bocha-search",
      "doc_state",
      "openwork-knowledge",
    ]);
    expect(Object.keys(parsed.mcp ?? {}).sort()).toEqual([
      "bocha-search",
      "doc_state",
      "openwork-knowledge",
    ]);
    expect(parsed.mcp?.memory).toBeUndefined();
    expect(parsed.mcp?.filesystem).toBeUndefined();
  });

  test("prunes default hosted session runtimes to the same document-first skill and MCP surface", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-default-doc-surface-"));
    const allSkills = [
      "content-research-writer",
      "doc-coauthoring",
      "doc-normalize",
      "docx",
      "image-enhancer",
      "internal-comms",
      "openwork-debug",
      "pdf",
      "pptx",
      "release",
      "xlsx",
    ] as const;
    for (const skill of allSkills) {
      await mkdir(join(workspacePath, ".opencode", "skills", skill), { recursive: true });
      await writeFile(join(workspacePath, ".opencode", "skills", skill, "SKILL.md"), `# ${skill}\n`, "utf8");
    }
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
          "bocha-search": {
            type: "local",
            command: ["uv", "--directory", "/tmp/bocha", "run", "bocha-search-mcp"],
          },
          "sequential-thinking": {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
          },
        },
      }, null, 2),
      "utf8",
    );

    const runtime = await provisionSessionWorkspace(workspacePath);
    const runtimeSkillDirs = (await readdir(join(runtime.runtimeDir, ".opencode", "skills"))).sort();
    const raw = await readFile(join(runtime.runtimeDir, "opencode.jsonc"), "utf8");
    const parsed = JSON.parse(raw) as {
      mcp?: Record<string, unknown>;
    };

    expect(runtimeSkillDirs).toEqual([
      "doc-coauthoring",
      "doc-normalize",
      "docx",
      "pdf",
      "pptx",
      "xlsx",
    ]);
    expect(Object.keys(parsed.mcp ?? {}).sort()).toEqual([
      "bocha-search",
    ]);
    expect(parsed.mcp?.memory).toBeUndefined();
    expect(parsed.mcp?.filesystem).toBeUndefined();
  });

  test("keeps runtime support helpers but not openwork-core skill for document-writer runtime sessions", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-doc-writer-"));
    const writerSkills = [
      "content-research-writer",
      "doc-coauthoring",
      "doc-normalize",
      "docx",
      "hermes-learning-loop",
      "image-enhancer",
      "internal-comms",
      "openwork-debug",
      "pdf",
      "pptx",
      "xlsx",
    ] as const;
    for (const skill of writerSkills) {
      await mkdir(join(workspacePath, ".opencode", "skills", skill), { recursive: true });
      await writeFile(join(workspacePath, ".opencode", "skills", skill, "SKILL.md"), `# ${skill}\n`, "utf8");
    }
    await mkdir(join(workspacePath, ".opencode", "runtime-support", "document-state"), { recursive: true });
    await writeFile(
      join(workspacePath, ".opencode", "runtime-support", "document-state", "extract_doc_state.py"),
      "print('ok')\n",
      "utf8",
    );

    const runtime = await provisionSessionWorkspace(workspacePath, {
      preferredView: "document-writer",
      preferredAgent: "document-writer",
      preferredAgentLock: "document-writer",
    });
    const runtimeSkillDirs = (await readdir(join(runtime.runtimeDir, ".opencode", "skills"))).sort();
    const profileRaw = await readFile(join(runtime.runtimeDir, ".opencode", "openwork-runtime-profile.json"), "utf8");
    const profile = JSON.parse(profileRaw) as { id?: string; skillAllowlist?: string[] };

    expect(runtimeSkillDirs).toEqual([
      "doc-coauthoring",
      "doc-normalize",
      "docx",
      "hermes-learning-loop",
      "pdf",
      "pptx",
      "xlsx",
    ]);
    expect(profile.id).toBe("document-writer");
    expect(profile.skillAllowlist?.sort()).toEqual([
      "doc-coauthoring",
      "doc-normalize",
      "docx",
      "hermes-learning-loop",
      "pdf",
      "pptx",
      "xlsx",
    ]);
    expect(await exists(join(runtime.runtimeDir, ".opencode", "skills", "openwork-core", "SKILL.md"))).toBe(false);
    expect(
      await exists(join(runtime.runtimeDir, ".opencode", "runtime-support", "document-state", "extract_doc_state.py")),
    ).toBe(true);
  });

  test("mirrors generic plugins to every runtime but keeps profile-specific plugins isolated", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-plugin-isolation-"));
    const pluginNames = [
      "document-mode-bridge.js",
      "document-writer-guard.js",
      "common-work-guard.js",
    ] as const;
    for (const pluginName of pluginNames) {
      await mkdir(join(workspacePath, ".opencode", "plugins"), { recursive: true });
      await writeFile(join(workspacePath, ".opencode", "plugins", pluginName), `// ${pluginName}\n`, "utf8");
    }

    const commonRuntime = await provisionSessionWorkspace(workspacePath, {
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
    });
    const writerRuntime = await provisionSessionWorkspace(workspacePath, {
      preferredView: "document-writer",
      preferredAgent: "document-writer",
      preferredAgentLock: "document-writer",
    });

    const commonPlugins = (await readdir(join(commonRuntime.runtimeDir, ".opencode", "plugins"))).sort();
    const writerPlugins = (await readdir(join(writerRuntime.runtimeDir, ".opencode", "plugins"))).sort();

    expect(commonPlugins).toEqual([
      "common-work-guard.js",
      "document-mode-bridge.js",
    ]);
    expect(writerPlugins).toEqual([
      "document-mode-bridge.js",
      "document-writer-guard.js",
    ]);
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
    expect(parsed.mcp?.filesystem).toBeUndefined();
    expect(parsed.mcp?.memory).toBeUndefined();
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
    expect(instructionRaw).toContain("do not skip it for relevant recall tasks");
    expect(instructionRaw).toContain("use `openwork_knowledge_search` at least once before external search or broad workspace discovery");
    expect(instructionRaw).toContain("For purely local file editing, format conversion, or directed rewriting against already-open local material");
    expect(instructionRaw).toContain("Attached knowledge count: 0");
    expect(instructionRaw).toContain("If no knowledge bases are attached, or attached knowledge is insufficient");
    expect(instructionRaw).toContain("Do not use `memory_search_nodes` or `memory_read_graph` as a substitute for attached knowledge retrieval");
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
    expect(parsed.mcp?.filesystem).toBeUndefined();
    expect(parsed.mcp?.doc_state).toMatchObject({
      type: "remote",
      url: "http://127.0.0.1:8789/workspace/ws_1/doc-state/mcp",
      headers: {
        Authorization: "Bearer owdst_test",
      },
    });
    expect(parsed.instructions).toContain(".opencode/openwork-runtime.md");
    expect(parsed.instructions).toContain(".opencode/doc-state.md");
    expect(instructionRaw).toContain("Use the existing `.worktree/**`, `requirements.csv`, and `reports/**` artifacts");
    expect(instructionRaw).not.toContain("`.bid/**`");
    expect(instructionRaw).toContain("The `.worktree/**` files remain the source of truth");
    expect(instructionRaw).not.toContain("doc_state_state_get_brief");
    expect(instructionRaw).not.toContain("doc_state_state_get_facts");
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
    expect(parsed.mcp?.memory).toBeUndefined();
    expect(instructionRaw).toContain("商业资质库");
    expect(instructionRaw).toContain("Attached knowledge count: 1");
    expect(instructionRaw).toContain("rerun knowledge search if the active attachments changed earlier in the conversation");
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
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
    });

    const stored = await service.getWorkspace("ws_1", "ses_1");
    const listed = await service.listWorkspaces("ws_1");
    expect(stored?.opencodeRuntime?.mode).toBe("isolated_process");
    expect(stored?.opencodeRuntime?.configDir).toBe("/tmp/runtime-1/.openwork-runtime/opencode/config");
    expect(stored?.opencodeRuntime?.configHomeDir).toBe("/tmp/runtime-1/.openwork-runtime/opencode/config-home");
    expect(stored?.opencodeRuntime?.tempDir).toBe("/tmp/runtime-1/.tmp/system");
    expect(stored?.preferredView).toBe("document-agent");
    expect(stored?.preferredAgent).toBe("common-work");
    expect(stored?.preferredAgentLock).toBe("common-work");
    expect(listed.ses_1?.opencodeRuntime?.mode).toBe("isolated_process");
    expect(listed.ses_1?.preferredView).toBe("document-agent");
    expect(listed.ses_1?.preferredAgent).toBe("common-work");
    expect(listed.ses_1?.preferredAgentLock).toBe("common-work");
  });
});
