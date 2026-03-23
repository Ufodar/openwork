import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseEnvFile(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!key) continue;
    values[key] = value;
  }
  return values;
}

async function loadLatestDevEnv(repoRoot) {
  const tmpDir = join(repoRoot, "tmp");
  const entries = await readdir(tmpDir, { withFileTypes: true });
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(".dev-env-"))
    .map(async (entry) => {
      const filepath = join(tmpDir, entry.name);
      const info = await stat(filepath);
      return { name: entry.name, mtimeMs: info.mtimeMs };
    }));
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!candidates.length) {
    throw new Error("No tmp/.dev-env-* file found. Start the Docker dev stack first.");
  }
  const filename = candidates[0].name;
  const filepath = join(tmpDir, filename);
  const parsed = parseEnvFile(await readFile(filepath, "utf8"));
  const suffix = filename.replace(".dev-env-", "");
  return { filepath, parsed, suffix };
}

function detectDockerPorts(projectSuffix) {
  const output = execFileSync("docker", ["ps", "--format", "{{.Names}} {{.Ports}}"], { encoding: "utf8" });
  const lines = output.split(/\r?\n/).filter(Boolean);
  const orchestrator = lines.find((line) => line.startsWith(`openwork-dev-${projectSuffix}-orchestrator-1 `));
  const web = lines.find((line) => line.startsWith(`openwork-dev-${projectSuffix}-web-1 `));
  if (!orchestrator || !web) {
    throw new Error(`Could not find Docker dev containers for suffix ${projectSuffix}.`);
  }
  const extractPort = (line, target) => {
    const match = line.match(new RegExp(`0\\.0\\.0\\.0:(\\d+)->${target}/tcp`));
    if (!match?.[1]) {
      throw new Error(`Could not parse host port for ${target} from: ${line}`);
    }
    return Number(match[1]);
  };
  return {
    orchestratorContainer: `openwork-dev-${projectSuffix}-orchestrator-1`,
    serverPort: extractPort(orchestrator, 8787),
    webPort: extractPort(web, 5173),
  };
}

async function requestJson(baseUrl, path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}: ${text || response.statusText}`);
  }
  return json;
}

function dockerExec(container, args) {
  return execFileSync("docker", ["exec", container, ...args], { encoding: "utf8" });
}

async function waitForSessionDirectory(baseUrl, token, workspaceId, workspacePath, sessionId) {
  const encodedDirectory = encodeURIComponent(workspacePath);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const sessions = await requestJson(baseUrl, `/w/${encodeURIComponent(workspaceId)}/opencode/session?directory=${encodedDirectory}`, {
      token,
    });
    if (Array.isArray(sessions)) {
      const match = sessions.find((item) => item && item.id === sessionId && typeof item.directory === "string");
      if (match?.directory) {
        return match.directory;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for runtime directory for session ${sessionId}`);
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const { parsed, suffix } = await loadLatestDevEnv(repoRoot);
  const docker = detectDockerPorts(suffix);
  const baseUrl = process.env.OPENWORK_BASE_URL?.trim() || `http://127.0.0.1:${docker.serverPort}`;
  const token = process.env.OPENWORK_TOKEN?.trim() || parsed.OPENWORK_TOKEN;
  if (!token) {
    throw new Error("OPENWORK_TOKEN is missing.");
  }

  const workspaces = await requestJson(baseUrl, "/workspaces", { token });
  const workspaceId = workspaces?.activeId;
  const workspace = Array.isArray(workspaces?.items)
    ? workspaces.items.find((item) => item?.id === workspaceId)
    : null;
  assert.ok(workspaceId && workspace?.path, "Could not resolve active workspace.");

  let createdSessionId = null;
  try {
    const created = await requestJson(baseUrl, `/w/${encodeURIComponent(workspaceId)}/opencode/session`, {
      method: "POST",
      token,
      body: { title: "Knowledge runtime carrier smoke" },
    });
    createdSessionId = typeof created?.id === "string" ? created.id : null;
    assert.ok(createdSessionId, "Session creation did not return an id.");

    const runtimeDir = await waitForSessionDirectory(baseUrl, token, workspaceId, workspace.path, createdSessionId);
    const runtimeConfig = JSON.parse(
      dockerExec(docker.orchestratorContainer, ["cat", join(runtimeDir, "opencode.jsonc")]),
    );
    const parentConfig = JSON.parse(
      dockerExec(docker.orchestratorContainer, ["cat", join(workspace.path, "opencode.jsonc")]),
    );

    const knowledgeMcp = runtimeConfig?.mcp?.["openwork-knowledge"];
    assert.ok(knowledgeMcp, "Runtime knowledge MCP was not written into opencode.jsonc.");
    assert.equal(knowledgeMcp.type, "remote");
    assert.ok(typeof knowledgeMcp.url === "string" && knowledgeMcp.url.includes(`/workspace/${workspaceId}/knowledge/mcp`));
    assert.ok(typeof knowledgeMcp.headers?.Authorization === "string");
    if (parentConfig?.mcp?.filesystem) {
      assert.ok(runtimeConfig?.mcp?.filesystem, "Runtime config did not preserve parent filesystem MCP.");
    }

    const runtimeToken = String(knowledgeMcp.headers.Authorization).replace(/^Bearer\s+/i, "");
    const initialize = await requestJson(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/knowledge/mcp`, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      },
      token: runtimeToken,
    });
    const tools = await requestJson(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/knowledge/mcp`, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
      token: runtimeToken,
    });
    const attached = await requestJson(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/knowledge/mcp`, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "openwork_knowledge_list_attached",
          arguments: {},
        },
      },
      token: runtimeToken,
    });

    assert.equal(initialize?.result?.serverInfo?.name, "openwork-knowledge-mcp");
    assert.ok(Array.isArray(tools?.result?.tools), "tools/list did not return tools.");
    assert.ok(
      tools.result.tools.some((tool) => tool?.name === "openwork_knowledge_list_attached"),
      "knowledge list tool missing",
    );
    assert.equal(attached?.result?.isError, false);

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      webPort: docker.webPort,
      workspaceId,
      sessionId: createdSessionId,
      runtimeDir,
      tools: tools.result.tools.map((tool) => tool.name),
      attachedKnowledgeIds: attached?.result?.structuredContent?.knowledgeIds ?? [],
    }));
  } finally {
    if (createdSessionId) {
      try {
        await requestJson(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(createdSessionId)}`, {
          method: "DELETE",
          token,
        });
      } catch {
        // ignore cleanup failures in smoke mode
      }
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
});
