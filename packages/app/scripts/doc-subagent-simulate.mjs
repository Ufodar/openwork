import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHostedOpenworkClient,
  createHostedOpenworkSession,
  fetchHostedSessionRecord,
  makeClient,
} from "./_util.mjs";

import {
  extractMarkdownHeadings,
  summarizeArtifactFiles,
  validateScenarioResult,
} from "./doc-subagent-simulate-lib.mjs";
import { joinVisibleAssistantText } from "./_assistant-text.mjs";
import { resolveSimulationModel } from "./doc-subagent-model-config.mjs";

import {
  findFreePort,
  normalizeEvent,
  parseArgs,
  waitForHealthy,
} from "./_util.mjs";

const args = parseArgs(process.argv.slice(2));
const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..", "..");
const model = await resolveSimulationModel({
  explicitModel: args.get("model"),
  envModel: process.env.DOC_SUBAGENT_SIM_MODEL,
  workspaceRoot: root,
});
const modelRef = parseModelRefStrict(model);
const scenarioFilter = args.get("scenario")?.trim() ?? "";
const outputRoot = join(root, "packages", "app", "pr", "doc-subagent-orchestration");
const simulationRoot = join(outputRoot, "simulations");
const openworkDataDir = join(root, "tmp", "doc-subagent-sim", "openwork-data");

const scenarios = [
  {
    id: "ly-structured-plan",
    title: "临沂三文档结构化规划",
    expectedOutput: "outputs/ly-solution.md",
    docs: [
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/备-环投数科临沂项目第一包v20250507v1.0(1)(1).docx",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/ly项目伙伴/临沂招标文件正文.pdf",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/ly项目伙伴/伙伴资料文档/环投数科临沂项目第一包v20250508终版文件.docx",
    ],
    prompts: [
      ({ uploaded }) => `当前 workspace 已上传三份文档：\n- ${uploaded.join("\n- ")}\n\n任务：不要直接通读所有原文。先通过子代理完成 intake、source compilation、facts/conflicts、solution plan，并把中间产物写入 .worktree。最终交付目标先设为 outputs/ly-solution.md，但这一轮不要写最终稿。请在回复里列出已生成的关键状态文件和下一步建议。`,
      () => "继续推进。基于已有 state，把一份中文 Markdown 方案写到 outputs/ly-solution.md，至少包含：项目理解、点对点解决路径、证据来源与假设、风险与待确认事项。以上四个标题必须原样作为 Markdown 标题出现，不能合并、改写或替换成 plan 里的近义标题。写完后调用 verifier，并更新 coverage/verify state。",
      () => "用户追加要求：在现有 outputs/ly-solution.md 中补一个“实施里程碑与协作分工”章节。这个标题也必须原样作为 Markdown 标题出现。优先基于已有 state 推进，只有 state 缺证时才回看原文。完成后再次刷新 coverage 与 verify 结果。",
    ],
    requiredHeadingsByPrompt: [
      [],
      ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项"],
      ["项目理解", "点对点解决路径", "证据来源与假设", "风险与待确认事项", "实施里程碑与协作分工"],
    ],
  },
  {
    id: "wjw-p2p-solution",
    title: "卫健委点对点方案",
    expectedOutput: "outputs/wjw-p2p.md",
    docs: [
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/招标文件-天津市滨海新区卫生健康委员会天津市滨海新区卫生健康信息化平台项目.docx",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/产品信息/海滨医院点对点应答.docx",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/产品信息/智慧网络医疗服务项目设备参数9.29(1).docx",
    ],
    prompts: [
      ({ uploaded }) => `当前 workspace 已上传三份文档：\n- ${uploaded.join("\n- ")}\n\n用户要求：根据这三份材料，产出一份可行的点对点解决方案。主会话请尽量做编排，不要自己直接通读全部原文。先建立 .worktree 中间产物，并把交付目标定为 outputs/wjw-p2p.md。这一轮先不要写最终稿，只需要完成 state、facts、plan，并在回复中列出关键状态文件和下一步建议。`,
      () => "继续推进，把完整的点对点解决方案写到 outputs/wjw-p2p.md。正文至少要有：需求拆解、点对点对应方案、证据与约束、待确认问题。以上四个标题必须原样作为 Markdown 标题出现，不能合并成 plan 标题，也不能改写成近义标题。写完后运行 verifier。",
      () => "再做一轮 follow-up：给 outputs/wjw-p2p.md 增补“实施风险与缓解动作”章节，并确保 coverage/verify 状态同步更新。这个新标题也必须原样作为 Markdown 标题出现。",
    ],
    requiredHeadingsByPrompt: [
      [],
      ["需求拆解", "点对点对应方案", "证据与约束", "待确认问题"],
      ["需求拆解", "点对点对应方案", "证据与约束", "待确认问题", "实施风险与缓解动作"],
    ],
  },
];

const selectedScenarios = scenarioFilter
  ? scenarios.filter((scenario) => scenario.id === scenarioFilter)
  : scenarios;

if (!selectedScenarios.length) {
  throw new Error(`Unknown scenario: ${scenarioFilter}`);
}

function spawnLogged(cmd, argv, options) {
  const child = spawn(cmd, argv, options);
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    child,
    stderr: () => stderr,
  };
}

async function closeChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

async function waitForOpenwork(baseUrl) {
  let lastError = null;
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for OpenWork server health: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function requestJson(url, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Request failed (${response.status})`);
  }
  return text ? JSON.parse(text) : null;
}

async function uploadDocument({ baseUrl, token, workspaceId, sessionId, localPath, destPath }) {
  const payload = await readFile(localPath);
  const form = new FormData();
  form.append("file", new File([payload], basename(localPath)));
  if (destPath) {
    form.append("path", destPath);
  }
  const response = await fetch(
    `${baseUrl}/w/${encodeURIComponent(workspaceId)}/document/upload?session=${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Document upload failed (${response.status})`);
  }
  const parsed = text ? JSON.parse(text) : null;
  return typeof parsed?.name === "string" ? parsed.name : basename(localPath);
}

function parseModelRefStrict(raw) {
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) {
    throw new Error(`Invalid model ref: ${raw}`);
  }
  return {
    providerID: raw.slice(0, slash),
    modelID: raw.slice(slash + 1),
  };
}

function messageRole(message) {
  return typeof message?.role === "string"
    ? message.role
    : typeof message?.info?.role === "string"
      ? message.info.role
      : "";
}

function messageId(message) {
  return typeof message?.id === "string"
    ? message.id
    : typeof message?.info?.id === "string"
      ? message.info.id
      : "";
}

function messageCompletedAt(message) {
  const completed = message?.info?.time?.completed;
  return typeof completed === "number" ? completed : null;
}

function messagesFingerprint(messages) {
  if (!messages.length) return "empty";
  const last = messages[messages.length - 1];
  return [
    messages.length,
    messageId(last),
    Array.isArray(last?.parts) ? last.parts.length : 0,
    JSON.stringify(
      (Array.isArray(last?.parts) ? last.parts : []).map((part) => ({
        type: part?.type,
        id: part?.id,
        status: part?.state?.status,
      })),
    ),
  ].join(":");
}

function hasPendingToolStates(messages) {
  return extractToolParts(messages).some((part) => {
    const status = typeof part?.state?.status === "string" ? part.state.status : "";
    return status === "pending" || status === "running";
  });
}

function findLastCompletedAssistant(messages) {
  return [...messages].reverse().find(
    (message) =>
      messageRole(message) === "assistant" &&
      Array.isArray(message.parts) &&
      message.parts.length > 0 &&
      messageCompletedAt(message) !== null,
  );
}

function hasCompletedAssistantTurn(messages) {
  const assistant = findLastCompletedAssistant(messages);
  if (!assistant) return false;
  return messageCompletedAt(assistant) !== null && !hasPendingToolStates([assistant]);
}

function hasAnyAssistantMessage(messages) {
  return messages.some((message) => messageRole(message) === "assistant");
}

async function waitForSessionSettled(client, sessionId, runPrompt, {
  timeoutMs = 600_000,
  pollMs = 3_000,
  quietMs = 10_000,
  noProgressTimeoutMs = 120_000,
  useWorkspaceEventStream = false,
} = {}) {
  const observed = new Set();
  let sawIdle = false;
  let sawError = null;
  const now = () => performance.now();
  let controller = null;
  let reader = Promise.resolve();

  if (useWorkspaceEventStream) {
    controller = new AbortController();
    const sub = await client.event.subscribe(undefined, { signal: controller.signal });
    reader = (async () => {
      try {
        for await (const raw of sub.stream) {
          const evt = normalizeEvent(raw);
          if (!evt) continue;
          const properties = evt.properties && typeof evt.properties === "object" ? evt.properties : {};
          const eventSessionId =
            typeof properties.sessionID === "string"
              ? properties.sessionID
              : typeof properties.sessionId === "string"
              ? properties.sessionId
                : null;
          if (eventSessionId && eventSessionId !== sessionId) continue;
          observed.add(evt.type);
          if (evt.type === "session.error") {
            sawError = new Error(`session.error for ${sessionId}`);
            return;
          }
          if (evt.type === "session.idle") {
            sawIdle = true;
            return;
          }
        }
      } finally {
        // Let the polling loop decide when to abort.
      }
    })();
  }

  try {
    await runPrompt();
    let lastProgressAt = now();
    let lastFingerprint = "";
    const startedAt = now();

    while (now() - startedAt < timeoutMs) {
      if (sawError) {
        throw sawError;
      }
      if (sawIdle) {
        return Array.from(observed);
      }

      const messages = await client.session.messages({ sessionID: sessionId, limit: 300 });
      const fingerprint = messagesFingerprint(messages);
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        lastProgressAt = now();
      }

      if (!hasAnyAssistantMessage(messages) && now() - lastProgressAt >= noProgressTimeoutMs) {
        throw new Error(`No assistant progress after ${Math.round(now() - startedAt)}ms`);
      }

      if (hasCompletedAssistantTurn(messages) && !hasPendingToolStates(messages) && now() - lastProgressAt >= quietMs) {
        return Array.from(observed);
      }

      await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs));
    }

    throw new Error(`Timed out waiting for session to settle after ${Math.round(now() - startedAt)}ms`);
  } finally {
    controller?.abort();
    await Promise.race([
      reader,
      new Promise((resolveDelay) => setTimeout(resolveDelay, 500)),
    ]);
  }
}

function extractToolParts(messages) {
  return messages.flatMap((message) => (Array.isArray(message.parts) ? message.parts : [])).filter((part) => part?.type === "tool");
}

function extractTaskSummary(messages) {
  const taskParts = extractToolParts(messages).filter((part) => String(part.tool ?? "").toLowerCase() === "task");
  return taskParts.map((part) => {
    const stateInput = part?.state?.input && typeof part.state.input === "object" ? part.state.input : null;
    const input = part.input && typeof part.input === "object" ? part.input : {};
    const mergedInput = stateInput ?? input;
    return {
      agent:
        typeof mergedInput.subagent_type === "string"
          ? mergedInput.subagent_type
          : typeof mergedInput.agent === "string"
            ? mergedInput.agent
            : null,
      sessionId:
        typeof mergedInput.session_id === "string"
          ? mergedInput.session_id
          : typeof part.sessionID === "string"
            ? part.sessionID
            : null,
      description:
        typeof mergedInput.description === "string"
          ? mergedInput.description
          : typeof mergedInput.prompt === "string"
            ? mergedInput.prompt.slice(0, 200)
            : null,
    };
  });
}

function extractAssistantText(messages) {
  const assistant = [...messages].reverse().find((message) => messageRole(message) === "assistant");
  if (!assistant || !Array.isArray(assistant.parts)) return "";
  return joinVisibleAssistantText(assistant.parts);
}

function extractToolErrors(messages) {
  return extractToolParts(messages)
    .filter((part) => part?.state?.status === "error")
    .map((part) => {
      const tool = typeof part.tool === "string" ? part.tool : "tool";
      const output = typeof part?.state?.output === "string"
        ? part.state.output
        : typeof part?.state?.error === "string"
          ? part.state.error
          : "";
      return output ? `${tool}: ${output}` : `${tool}: error`;
    });
}

async function resolveRuntimeDir(workspaceId, sessionId) {
  const path = join(openworkDataDir, "session-workspaces", `${workspaceId}.json`);
  for (let i = 0; i < 40; i += 1) {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      const runtimeDir = parsed?.workspaces?.[sessionId]?.runtimeDir;
      if (typeof runtimeDir === "string" && runtimeDir.trim()) {
        return runtimeDir;
      }
    } catch {
      // retry
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`runtimeDir not found for ${sessionId}`);
}

async function copyIfExists(source, target) {
  try {
    await stat(source);
  } catch {
    return false;
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
  return true;
}

async function listFiles(rootDir, prefix = "") {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        items.push(...await listFiles(abs, rel));
      } else if (entry.isFile()) {
        items.push(rel);
      }
    }
    return items.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function snapshotRuntimeArtifacts(runtimeDir, scenarioId) {
  const scenarioDir = join(simulationRoot, scenarioId);
  await rm(scenarioDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(scenarioDir, { recursive: true });

  await copyIfExists(join(runtimeDir, ".worktree"), join(scenarioDir, ".worktree"));
  await copyIfExists(join(runtimeDir, "outputs"), join(scenarioDir, "outputs"));
  await copyIfExists(join(runtimeDir, "reports"), join(scenarioDir, "reports"));
  await copyIfExists(join(runtimeDir, ".bid"), join(scenarioDir, ".bid"));

  return {
    files: await listFiles(scenarioDir),
    scenarioDir,
  };
}

async function summarizeRuntimeArtifacts(runtimeDir, expectedOutput) {
  const files = [];

  for (const relativeDir of [".worktree", "outputs", "reports", ".bid"]) {
    const absoluteDir = join(runtimeDir, relativeDir);
    const dirFiles = await listFiles(absoluteDir);
    for (const file of dirFiles) {
      files.push(`${relativeDir}/${file}`.replaceAll("//", "/"));
    }
  }

  return summarizeArtifactFiles(files, expectedOutput);
}

async function readExpectedOutput(runtimeDir, expectedOutput) {
  if (!expectedOutput) {
    return { outputText: "", outputHeadings: [] };
  }

  const targetPath = join(runtimeDir, expectedOutput);
  try {
    const outputText = await readFile(targetPath, "utf8");
    return {
      outputText,
      outputHeadings: extractMarkdownHeadings(outputText),
    };
  } catch {
    return { outputText: "", outputHeadings: [] };
  }
}

async function runScenario({ baseUrl, token, workspaceId, client, scenario }) {
  const session = await createHostedOpenworkSession({
    baseUrl,
    token,
    workspaceId,
    title: scenario.title,
    enableDocumentState: true,
    preferredView: "document-writer",
    preferredAgent: "document-writer",
    preferredAgentLock: "document-writer",
  });
  const sessionProfile = await fetchHostedSessionRecord({
    baseUrl,
    token,
    workspaceId,
    sessionId: session.id,
    workspacePath: workspace.path,
    preferredView: "document-writer",
    preferredAgent: "document-writer",
    preferredAgentLock: "document-writer",
  });
  assert.equal(sessionProfile?.openworkPreferredView, "document-writer");
  assert.equal(sessionProfile?.openworkPreferredAgent, "document-writer");
  assert.equal(sessionProfile?.openworkPreferredAgentLock, "document-writer");
  const uploaded = [];
  for (const docPath of scenario.docs) {
    const name = await uploadDocument({
      baseUrl,
      token,
      workspaceId,
      sessionId: session.id,
      localPath: docPath,
    });
    uploaded.push(name);
  }

  const runtimeDir = await resolveRuntimeDir(workspaceId, session.id);

  const perPrompt = [];
  let seenMessageCount = 0;
  for (const promptFactory of scenario.prompts) {
    const promptText = promptFactory({ uploaded, sessionId: session.id });
    const eventTypes = await waitForSessionSettled(
      client,
      session.id,
      () =>
        client.session.promptAsync({
          sessionID: session.id,
          agent: "document-writer",
          model: modelRef,
          parts: [{ type: "text", text: promptText }],
        }),
      { timeoutMs: 900_000 },
    );

    const messages = await client.session.messages({ sessionID: session.id, limit: 300 });
    const freshMessages = messages.slice(seenMessageCount);
    seenMessageCount = messages.length;
    const outputSummary = await readExpectedOutput(runtimeDir, scenario.expectedOutput);
    perPrompt.push({
      prompt: promptText,
      eventTypes,
      taskCalls: extractTaskSummary(freshMessages),
      assistantText: extractAssistantText(freshMessages) || extractAssistantText(messages),
      toolErrors: extractToolErrors(freshMessages),
      state: await summarizeRuntimeArtifacts(runtimeDir, scenario.expectedOutput),
      outputHeadings: outputSummary.outputHeadings,
      outputPreview: outputSummary.outputText.slice(0, 1000),
    });
  }

  const snapshot = await snapshotRuntimeArtifacts(runtimeDir, scenario.id);
  const keyFiles = snapshot.files.filter((file) =>
    file.startsWith(".worktree/") ||
    file.startsWith("outputs/") ||
    file.startsWith("reports/") ||
    file.startsWith(".bid/"),
  );

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    sessionId: session.id,
    sessionProfile,
    expectedOutput: scenario.expectedOutput,
    uploaded,
    runtimeDir: relative(root, runtimeDir),
    promptRuns: perPrompt,
    keyFiles,
    scenarioDir: relative(root, snapshot.scenarioDir),
  };
}

function isRetriableScenarioError(error) {
  if (!(error instanceof Error)) return false;
  return (
    /No assistant progress/i.test(error.message) ||
    /Timed out waiting for session to settle/i.test(error.message)
  );
}

async function runScenarioWithRetries(context, scenario, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await runScenario({ ...context, scenario });
      result.attempt = attempt;
      return result;
    } catch (error) {
      lastError = error;
      if (!isRetriableScenarioError(error) || attempt === maxAttempts) {
        throw error;
      }
      console.warn(`[doc-subagent-simulate] scenario ${scenario.id} attempt ${attempt} failed: ${error.message}. Retrying...`);
    }
  }
  throw lastError ?? new Error(`Scenario ${scenario.id} failed without an error object`);
}

function buildMarkdownReport(results) {
  const lines = [
    "# Doc Subagent Simulation Report",
    "",
    `- model: \`${model}\``,
    `- generated_at: \`${new Date().toISOString()}\``,
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.title}`);
    lines.push("");
    lines.push(`- scenario: \`${result.scenarioId}\``);
    lines.push(`- session: \`${result.sessionId}\``);
    lines.push(`- runtime: \`${result.runtimeDir}\``);
    lines.push(`- snapshot: \`${result.scenarioDir}\``);
    lines.push(`- uploaded: ${result.uploaded.map((item) => `\`${item}\``).join(", ")}`);
    lines.push(`- key files: ${result.keyFiles.length}`);
    if (result.validation) {
      lines.push(`- validation: ${result.validation.ok ? "pass" : "fail"}`);
      if (result.validation.observedAgents.length) {
        lines.push(`- observed agents: ${result.validation.observedAgents.map((item) => `\`${item}\``).join(", ")}`);
      }
      if (result.validation.errors.length) {
        lines.push(`- validation errors: ${result.validation.errors.map((item) => `\`${item}\``).join("; ")}`);
      }
    }
    lines.push("");

    result.promptRuns.forEach((promptRun, index) => {
      const agents = Array.from(new Set(promptRun.taskCalls.map((task) => task.agent).filter(Boolean)));
      lines.push(`### Prompt ${index + 1}`);
      lines.push("");
      lines.push(`- task agents: ${agents.length ? agents.map((item) => `\`${item}\``).join(", ") : "(none observed)"}`);
      lines.push(`- event types: ${promptRun.eventTypes.map((item) => `\`${item}\``).join(", ")}`);
      lines.push(`- assistant excerpt: ${promptRun.assistantText.slice(0, 240).replace(/\s+/g, " ") || "(empty)"}`);
      if (promptRun.toolErrors?.length) {
        lines.push(`- tool errors: ${promptRun.toolErrors.map((item) => `\`${item}\``).join(", ")}`);
      }
      if (promptRun.state) {
        lines.push(
          `- state: sources=${promptRun.state.sourceArtifactCount}, facts=${promptRun.state.hasFacts}, conflicts=${promptRun.state.hasConflicts}, plan=${promptRun.state.hasPlan}, coverage=${promptRun.state.hasCoverage}, output=${promptRun.state.hasExpectedOutput}, verify=${promptRun.state.hasVerifyCoverage}`,
        );
      }
      lines.push("");
    });
  }

  return lines.join("\n") + "\n";
}

function formatError(error) {
  if (error instanceof Error) {
    const extra = {};
    for (const key of ["statusCode", "responseBody", "cause", "data"]) {
      if (key in error) {
        extra[key] = error[key];
      }
    }
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...extra,
    };
  }
  if (error && typeof error === "object") {
    try {
      return JSON.parse(JSON.stringify(error));
    } catch {
      return { message: String(error) };
    }
  }
  return { message: String(error) };
}

await rm(openworkDataDir, { recursive: true, force: true }).catch(() => undefined);
await rm(join(root, "documents", "sessions"), { recursive: true, force: true }).catch(() => undefined);
await mkdir(simulationRoot, { recursive: true });

const opencodePort = await findFreePort();
const openworkPort = await findFreePort();
const token = "doc-subagent-client-token";
const hostToken = "doc-subagent-host-token";

const opencodeServer = spawnLogged(
  "opencode",
  ["serve", "--hostname", "127.0.0.1", "--port", String(opencodePort)],
  {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      OPENCODE_CLIENT: "openwork-doc-subagent-sim",
    },
  },
);

const openworkServer = spawnLogged(
  "bun",
  [
    "packages/server/src/cli.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(openworkPort),
    "--token",
    token,
    "--host-token",
    hostToken,
    "--approval",
    "auto",
    "--workspace",
    root,
    "--opencode-base-url",
    `http://127.0.0.1:${opencodePort}`,
    "--opencode-directory",
    root,
    "--no-log-requests",
  ],
  {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      OPENWORK_DATA_DIR: openworkDataDir,
    },
  },
);

try {
  const directClient = makeClient({ baseUrl: `http://127.0.0.1:${opencodePort}`, directory: root });
  await waitForHealthy(directClient);

  const openworkBase = `http://127.0.0.1:${openworkPort}`;
  await waitForOpenwork(openworkBase);
  const workspaces = await requestJson(`${openworkBase}/workspaces`, token);
  const workspaceId = workspaces?.items?.[0]?.id;
  const directory = workspaces?.items?.[0]?.opencode?.directory ?? workspaces?.items?.[0]?.directory ?? root;
  assert.ok(workspaceId, "workspaceId is required");

  const client = createHostedOpenworkClient({ baseUrl: openworkBase, workspaceId, token });

  const results = [];
  for (const scenario of selectedScenarios) {
    const result = await runScenarioWithRetries({ baseUrl: openworkBase, token, workspaceId, client }, scenario);
    result.validation = validateScenarioResult(scenario, result);
    results.push(result);
  }

  const ok = results.every((result) => result.validation?.ok);

  const summary = {
    ok,
    model,
    workspaceId,
    results,
  };

  await writeFile(join(simulationRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  await writeFile(join(simulationRoot, "summary.md"), buildMarkdownReport(results), "utf8");
  if (!ok) {
    await writeFile(join(simulationRoot, "failure.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
    console.error(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
} catch (error) {
  const summary = {
    ok: false,
    model,
    error: formatError(error),
    opencodeStderr: opencodeServer.stderr(),
    openworkStderr: openworkServer.stderr(),
  };
  await mkdir(simulationRoot, { recursive: true });
  await writeFile(join(simulationRoot, "failure.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
} finally {
  await closeChild(openworkServer.child);
  await closeChild(opencodeServer.child);
}
