import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { joinVisibleAssistantText } from "../packages/app/scripts/_assistant-text.mjs";
import {
  buildCompactToolTrace,
  shouldStopDiagnosticCapture,
  summarizeConversationDiagnostics,
} from "../packages/app/scripts/openwork-compare-diagnostics.mjs";
import { createHostedOpenworkClient, findFreePort, makeClient, waitForHealthy } from "../packages/app/scripts/_util.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REQUESTED_LANES = new Set(
  String(process.env.QIN_ABC_LANES ?? "raw,local,pod")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const MODEL_REF = process.env.OPENWORK_COMPARE_MODEL ?? "my-company/MiniMax-2.5";
const OPENWORK_BASE = process.env.OPENWORK_BASE ?? "http://192.168.5.10:32765/openwork";
const USERNAME = process.env.OPENWORK_USERNAME ?? "fuda";
const PASSWORD = process.env.OPENWORK_PASSWORD ?? "1";
const COMPARE_MODE = String(process.env.OPENWORK_COMPARE_MODE ?? "full").trim().toLowerCase();
const DIAGNOSTIC_MODE = COMPARE_MODE === "diagnostic";

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const TIMEOUTS = {
  laneTimeoutMs: DIAGNOSTIC_MODE ? readPositiveIntEnv("OPENWORK_COMPARE_DIAGNOSTIC_TIMEOUT_MS", 420_000) : 3_600_000,
  pollMs: 5_000,
  quietMs: DIAGNOSTIC_MODE ? readPositiveIntEnv("OPENWORK_COMPARE_DIAGNOSTIC_QUIET_MS", 8_000) : 20_000,
  noProgressTimeoutMs: DIAGNOSTIC_MODE
    ? readPositiveIntEnv("OPENWORK_COMPARE_DIAGNOSTIC_NO_PROGRESS_TIMEOUT_MS", 180_000)
    : 1_200_000,
  childExitMs: 2_500,
  diagnosticAbortSettledMs: DIAGNOSTIC_MODE ? readPositiveIntEnv("OPENWORK_COMPARE_DIAGNOSTIC_ABORT_SETTLED_MS", 2_000) : 2_000,
};

const DIAGNOSTIC_LIMITS = {
  maxToolCalls: readPositiveIntEnv("OPENWORK_COMPARE_DIAGNOSTIC_MAX_TOOL_CALLS", 8),
  minToolCallsBeforeIssueStop: readPositiveIntEnv("OPENWORK_COMPARE_DIAGNOSTIC_MIN_TOOL_CALLS", 4),
  maxLeadingDiscoveryBurst: readPositiveIntEnv("OPENWORK_COMPARE_DIAGNOSTIC_MAX_DISCOVERY_BURST", 5),
};

const SCENARIOS = {
  qin: {
    id: "qin-abc-minimax",
    title: "秦老师申报材料-ABC-MiniMax",
    promptFile: "qin-user-prompt.txt",
    docs: [
      "/Users/storm/Pictures/秦老师/天河监控运维一体化平台软件介绍v0.3.docx",
      "/Users/storm/Pictures/秦老师/融合算力云平台白皮书.docx",
    ],
    prompt:
      "请你结合参考两篇文档以及查找网络中的一些资料，帮我写一份项目申报所需要的技术材料，围绕以下三部分进行扩充和对应材料补充，生成word文档。分三大系统，给出技术架构、技术路线、互联互通机制、标识系统构建等技术实现的方式方法，面向应用层，给出API调用的示例\n\n| 系统名称 | 功能定位 | 技术实现 |\n| 算力资源汇聚系统 | 具备跨中心纳管算力能力、联动区域IDC资源 | 支持Agent、API、多云网关等多种接入方式，实现K8s、虚拟机、裸金属、GPU资源池化，自动生成资源标签（如地域、卡型、安全等级） |\n| 算力选择与调度系统 | 基于算力度量与网络感知，智能推荐最优算力资源与传输路径 | 融合实时网络时延、带宽、丢包率与算力性能（TPM/RPM）、线性度等多维指标，采用算网融合调度算法，实现“任务-资源-路径”最优匹配 |\n| 算力运行安全监测系统 | 实现全链路安全监控与风险预警 | 部署调度、算力、网络三大运营大盘，支持异常任务识别、资源滥用告警、数据访问审计，符合等保三级要求 |",
  },
  wjw: {
    id: "wjw-raw-vs-pod-minimax",
    title: "卫健委点对点方案-Raw-vs-Pod-MiniMax",
    promptFile: "wjw-user-prompt.txt",
    docs: [
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/招标文件-天津市滨海新区卫生健康委员会天津市滨海新区卫生健康信息化平台项目.docx",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/产品信息/海滨医院点对点应答.docx",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/产品信息/智慧网络医疗服务项目设备参数9.29(1).docx",
    ],
    prompt:
      "请结合当前三份参考文档，输出一份中文点对点解决方案，优先落成可交付的 Markdown 或 Word 文档。正文至少完整覆盖：需求拆解、点对点对应方案、证据与约束、待确认问题。内容要面向正式方案交付，不要写成头脑风暴记录，也不要只列提纲。",
  },
};
const SCENARIO_KEY = String(process.env.OPENWORK_COMPARE_SCENARIO ?? "qin").trim().toLowerCase();
const SCENARIO = SCENARIOS[SCENARIO_KEY];
if (!SCENARIO) throw new Error(`Unknown scenario key: ${SCENARIO_KEY}`);
const OUTPUT_ROOT = join(ROOT, "tmp", "compare-agents", SCENARIO.id);
const SUMMARY_PATH = join(OUTPUT_ROOT, "summary.json");
const RAW_WORKSPACE = join(OUTPUT_ROOT, "raw-opencode-workspace");
const LOCAL_WORKSPACE = join(OUTPUT_ROOT, "local-openwork-workspace");
const LOCAL_DATA_DIR = join(OUTPUT_ROOT, "local-openwork-data");
const DELIVERY_GATE_SCRIPT = join(ROOT, ".opencode", "references", "check_document_delivery.py");

function parseModel(value) {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) throw new Error(`Invalid model ref: ${value}`);
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}

const MODEL = parseModel(MODEL_REF);

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function log(label, payload = {}) {
  const line = {
    ts: new Date().toISOString(),
    label,
    ...payload,
  };
  console.log(JSON.stringify(line));
}

function formatError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause ? { cause: formatError(error.cause) } : {}),
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

function roleOf(message) {
  if (message && typeof message.role === "string") return message.role;
  if (message && message.info && typeof message.info.role === "string") return message.info.role;
  return "";
}

function messageId(message) {
  if (message && typeof message.id === "string") return message.id;
  if (message && message.info && typeof message.info.id === "string") return message.info.id;
  return "";
}

function extractToolPartsFromMessages(messages) {
  return messages
    .flatMap((message) => (Array.isArray(message?.parts) ? message.parts : []))
    .filter((part) => part?.type === "tool");
}

function extractTextFromParts(parts) {
  return joinVisibleAssistantText(parts);
}

function partCompletedAt(part) {
  const candidates = [
    part?.time?.completed,
    part?.time?.end,
    part?.state?.time?.completed,
    part?.state?.time?.end,
  ].filter((value) => typeof value === "number");
  return candidates.length ? Math.max(...candidates) : null;
}

function messageCompletedAtFromParts(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const explicit = list
    .filter((part) => part?.type === "step-finish")
    .map(partCompletedAt)
    .filter((value) => typeof value === "number");
  if (explicit.length) return Math.max(...explicit);
  const fallback = [...list]
    .reverse()
    .map(partCompletedAt)
    .find((value) => typeof value === "number");
  return typeof fallback === "number" ? fallback : null;
}

function countToolsFromParts(parts) {
  const counts = {};
  for (const part of parts) {
    const name = typeof part?.tool === "string" ? part.tool : "unknown";
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function extractToolIssuesFromParts(parts) {
  const issues = [];
  const patterns = [
    { code: "state-error", test: (payload) => Boolean(payload.errorText) },
    { code: "mcp-error", test: (payload) => /mcp error/i.test(payload.outputText) },
    { code: "access-denied", test: (payload) => /access denied/i.test(payload.outputText) },
    { code: "fetch-failed", test: (payload) => /fetch failed/i.test(payload.outputText) || /fetch failed/i.test(payload.errorText) },
    { code: "permission-denied", test: (payload) => /prevents you from using this specific tool call/i.test(payload.errorText) },
  ];

  for (const part of parts) {
    const state = part?.state && typeof part.state === "object" ? part.state : {};
    const input =
      state.input && typeof state.input === "object"
        ? state.input
        : part?.input && typeof part.input === "object"
          ? part.input
          : {};
    const outputText = state.output === undefined || state.output === null ? "" : String(state.output);
    const errorText = state.error === undefined || state.error === null ? "" : String(state.error);
    const payload = { outputText, errorText };
    const matched = patterns.filter((pattern) => pattern.test(payload)).map((pattern) => pattern.code);
    if (!matched.length) continue;
    issues.push({
      tool: typeof part?.tool === "string" ? part.tool : "unknown",
      status: typeof state.status === "string" ? state.status : null,
      filePath:
        typeof input.filePath === "string"
          ? input.filePath
          : typeof input.path === "string"
            ? input.path
            : null,
      query: typeof input.query === "string" ? input.query : null,
      command: typeof input.command === "string" ? input.command : null,
      issueCodes: matched,
      outputPreview: outputText.slice(0, 240) || null,
      errorPreview: errorText.slice(0, 240) || null,
    });
  }

  return issues;
}

function summarizeToolIssues(issues) {
  const counts = {};
  for (const issue of issues) {
    const name = issue.tool || "unknown";
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function extractTaskCallsFromParts(parts) {
  return parts
    .filter((part) => String(part?.tool ?? "").toLowerCase() === "task")
    .map((part) => {
      const input =
        part?.state?.input && typeof part.state.input === "object"
          ? part.state.input
          : part?.input && typeof part.input === "object"
            ? part.input
            : {};
      return {
        agent:
          typeof input.subagent_type === "string"
            ? input.subagent_type
            : typeof input.agent === "string"
              ? input.agent
              : null,
        description:
          typeof input.description === "string"
            ? input.description.slice(0, 240)
            : typeof input.prompt === "string"
              ? input.prompt.slice(0, 240)
              : null,
        status: typeof part?.state?.status === "string" ? part.state.status : null,
      };
    });
}

function hasPendingToolStates(messages) {
  return extractToolPartsFromMessages(messages).some((part) => {
    const status = typeof part?.state?.status === "string" ? part.state.status : "";
    return status === "pending" || status === "running";
  });
}

function findLastCompletedAssistant(messages) {
  return [...messages].reverse().find(
    (message) =>
      roleOf(message) === "assistant" &&
      Array.isArray(message.parts) &&
      message.parts.length > 0 &&
      typeof message?.info?.time?.completed === "number",
  );
}

function hasCompletedAssistantTurn(messages) {
  const assistant = findLastCompletedAssistant(messages);
  if (!assistant) return false;
  const completed = assistant?.info?.time?.completed;
  return typeof completed === "number" && !hasPendingToolStates([assistant]);
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
        tool: part?.tool,
      })),
    ),
  ].join(":");
}

function extractAssistantText(messages) {
  const assistant = findLastCompletedAssistant(messages);
  if (!assistant || !Array.isArray(assistant.parts)) return "";
  return extractTextFromParts(assistant.parts);
}

function spawnLogged(command, args, options) {
  const child = spawn(command, args, options);
  let stdout = "";
  let stderr = "";

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
  }
  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
  }

  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function closeChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    sleep(TIMEOUTS.childExitMs).then(() => false),
  ]);
  if (exited) return;
  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }
  await Promise.race([once(child, "exit").catch(() => undefined), sleep(TIMEOUTS.childExitMs)]);
}

async function runChildWithTimeout(command, args, { cwd, env, timeoutMs }) {
  const proc = spawnLogged(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitPromise = once(proc.child, "exit").then(([code, signal]) => ({
    code,
    signal,
  }));
  const result = await Promise.race([
    exitPromise,
    sleep(timeoutMs).then(() => ({ code: null, signal: "TIMEOUT" })),
  ]);

  if (result.signal === "TIMEOUT") {
    await closeChild(proc.child);
  }

  return {
    ...result,
    stdout: proc.stdout(),
    stderr: proc.stderr(),
  };
}

async function requestJson(url, token, init = {}) {
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
  return text ? JSON.parse(text) : null;
}

async function waitForOpenwork(baseUrl, token) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < 30_000) {
    try {
      const workspaces = await requestJson(`${baseUrl}/workspaces`, token);
      if (Array.isArray(workspaces?.items) && workspaces.items.length > 0) return workspaces;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for OpenWork: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function loginPod() {
  return requestJson(`${OPENWORK_BASE}/auth/login`, null, {
    method: "POST",
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
}

async function createSession({
  baseUrl,
  token,
  workspaceId,
  title,
  enableDocumentState = false,
  preferredView = null,
  preferredAgent = null,
  preferredAgentLock = null,
}) {
  return requestJson(`${baseUrl}/w/${encodeURIComponent(workspaceId)}/opencode/session`, token, {
    method: "POST",
    body: JSON.stringify({
      title,
      openworkEnableDocState: enableDocumentState ? true : undefined,
      openworkPreferredView: preferredView || undefined,
      openworkPreferredAgent: preferredAgent || undefined,
      openworkPreferredAgentLock: preferredAgentLock || undefined,
    }),
  });
}

async function uploadDocument({ baseUrl, token, workspaceId, sessionId, localPath }) {
  const payload = await readFile(localPath);
  const form = new FormData();
  form.append("file", new File([payload], basename(localPath)));
  const response = await fetch(
    `${baseUrl}/w/${encodeURIComponent(workspaceId)}/document/upload?session=${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(text || `upload failed ${response.status}`);
  const parsed = text ? JSON.parse(text) : null;
  return typeof parsed?.name === "string" ? parsed.name : basename(localPath);
}

async function getSessionInfo({ baseUrl, token, workspaceId, sessionId }) {
  return requestJson(
    `${baseUrl}/w/${encodeURIComponent(workspaceId)}/opencode/session/${encodeURIComponent(sessionId)}`,
    token,
  );
}

async function listDocuments({ baseUrl, token, workspaceId, sessionId }) {
  return requestJson(
    `${baseUrl}/w/${encodeURIComponent(workspaceId)}/documents?session=${encodeURIComponent(sessionId)}`,
    token,
  );
}

async function downloadDocument({ baseUrl, token, workspaceId, sessionId, name, outputPath }) {
  const response = await fetch(
    `${baseUrl}/w/${encodeURIComponent(workspaceId)}/document/file?docId=${encodeURIComponent(name)}&session=${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`download ${name} failed ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  return {
    size: bytes.byteLength,
    contentType: response.headers.get("content-type"),
  };
}

async function waitForSessionSettled(client, sessionId, runPrompt, options = {}) {
  const {
    timeoutMs = TIMEOUTS.laneTimeoutMs,
    pollMs = TIMEOUTS.pollMs,
    quietMs = TIMEOUTS.quietMs,
    noProgressTimeoutMs = TIMEOUTS.noProgressTimeoutMs,
    useWorkspaceEventStream = false,
    diagnosticMode = false,
    diagnosticWorkspaceDir = "",
  } = options;
  const observedEvents = new Set();
  let sawIdle = false;
  let sawError = null;
  let controller = null;
  let eventReader = Promise.resolve();

  if (useWorkspaceEventStream) {
    controller = new AbortController();
    const sub = await client.event.subscribe(undefined, { signal: controller.signal });
    eventReader = (async () => {
      try {
        for await (const raw of sub.stream) {
          const evt =
            raw && typeof raw === "object" && typeof raw.type === "string"
              ? raw
              : raw?.payload && typeof raw.payload.type === "string"
                ? raw.payload
                : null;
          if (!evt) continue;
          const props = evt.properties && typeof evt.properties === "object" ? evt.properties : {};
          const eventSessionId =
            typeof props.sessionID === "string"
              ? props.sessionID
              : typeof props.sessionId === "string"
                ? props.sessionId
                : null;
          if (eventSessionId && eventSessionId !== sessionId) continue;
          observedEvents.add(evt.type);
          if (evt.type === "session.error") {
            sawError = new Error(`session.error for ${sessionId}`);
            return;
          }
          if (evt.type === "session.idle") {
            sawIdle = true;
            return;
          }
        }
      } catch {
        // Ignore abort/stream shutdown.
      }
    })();
  }

  try {
    await runPrompt();
    let lastFingerprint = "";
    let lastProgressAt = performance.now();
    const startedAt = performance.now();

    while (performance.now() - startedAt < timeoutMs) {
      if (sawError) throw sawError;
      if (sawIdle) return { events: [...observedEvents] };

      const messages = await client.session.messages({ sessionID: sessionId, limit: 500 });
      const fingerprint = messagesFingerprint(messages);
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        lastProgressAt = performance.now();
      }

      const hasAnyAssistantPayload = messages.some(
        (message) => roleOf(message) === "assistant" && Array.isArray(message.parts) && message.parts.length > 0,
      );
      if (!hasAnyAssistantPayload && performance.now() - lastProgressAt >= noProgressTimeoutMs) {
        throw new Error(`No assistant progress after ${Math.round(performance.now() - startedAt)}ms`);
      }
      if (diagnosticMode) {
        const routingDiagnostics = summarizeConversationDiagnostics(extractToolPartsFromMessages(messages), {
          workspaceDir: diagnosticWorkspaceDir,
        });
        const stopDecision = shouldStopDiagnosticCapture(routingDiagnostics, DIAGNOSTIC_LIMITS);
        if (stopDecision.stop && performance.now() - lastProgressAt >= quietMs) {
          let aborted = false;
          try {
            await client.session.abort({ sessionID: sessionId });
            aborted = true;
          } catch {
            // ignore abort failures; diagnostic snapshots are still useful
          }
          await sleep(TIMEOUTS.diagnosticAbortSettledMs);
          return {
            events: [...observedEvents],
            diagnosticStop: {
              reason: stopDecision.reason,
              aborted,
              routingDiagnostics,
            },
          };
        }
      }
      if (
        hasCompletedAssistantTurn(messages) &&
        !hasPendingToolStates(messages) &&
        performance.now() - lastProgressAt >= quietMs
      ) {
        return { events: [...observedEvents] };
      }
      await sleep(pollMs);
    }

    throw new Error(`Timed out waiting for session ${sessionId}`);
  } finally {
    controller?.abort();
    await Promise.race([eventReader, sleep(500)]);
  }
}

async function ensureCleanDir(dir) {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(dir, { recursive: true });
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runDeliveryQualityGate(targets, { cwd }) {
  const normalizedTargets = [...new Set((targets || []).filter(Boolean))];
  if (!normalizedTargets.length) {
    return {
      ok: false,
      exitCode: null,
      error: { message: "No delivery-gate targets provided." },
    };
  }

  const args = [DELIVERY_GATE_SCRIPT];
  for (const target of normalizedTargets) {
    args.push("--target", target);
  }

  const result = await runChildWithTimeout("python3", args, {
    cwd,
    env: process.env,
    timeoutMs: 60_000,
  });

  try {
    return {
      ok: result.code === 0,
      exitCode: result.code,
      signal: result.signal,
      report: result.stdout.trim() ? JSON.parse(result.stdout) : null,
      stdoutPreview: result.stdout.slice(0, 4000),
      stderrPreview: result.stderr.slice(0, 4000),
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: result.code,
      signal: result.signal,
      parseError: formatError(error),
      stdoutPreview: result.stdout.slice(0, 4000),
      stderrPreview: result.stderr.slice(0, 4000),
    };
  }
}

async function prepareAgentWorkspace(dir, { copyScenarioDocs }) {
  await ensureCleanDir(dir);
  await symlink(join(ROOT, ".opencode"), join(dir, ".opencode"), "dir");
  if (await fileExists(join(ROOT, "opencode.json"))) {
    await copyFile(join(ROOT, "opencode.json"), join(dir, "opencode.json"));
  }
  if (await fileExists(join(ROOT, "opencode.jsonc"))) {
    await copyFile(join(ROOT, "opencode.jsonc"), join(dir, "opencode.jsonc"));
  }
  await writeFile(join(dir, SCENARIO.promptFile), `${SCENARIO.prompt}\n`, "utf8");
  if (copyScenarioDocs) {
    for (const docPath of SCENARIO.docs) {
      await copyFile(docPath, join(dir, basename(docPath)));
    }
  }
}

async function listFilesRecursive(rootDir) {
  const result = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      result.push(relPath);
    }
  }

  await walk(rootDir);
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

function parseRunJsonLines(raw) {
  let sessionId = null;
  let lastType = null;
  let errorObj = null;
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (!sessionId && typeof obj.sessionID === "string") sessionId = obj.sessionID;
      if (typeof obj.type === "string") lastType = obj.type;
      if (obj.type === "error") errorObj = obj.error ?? obj;
    } catch {
      // Ignore non-JSON log lines.
    }
  }
  return { sessionId, lastType, errorObj };
}

function analyzeRunJsonLines(raw, options = {}) {
  const { sessionId, lastType, errorObj } = parseRunJsonLines(raw);
  const messageOrder = [];
  const messageParts = new Map();

  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const part = obj?.part;
    const messageID = typeof part?.messageID === "string" ? part.messageID : null;
    if (!messageID || !part || typeof part !== "object") continue;

    if (!messageParts.has(messageID)) {
      messageParts.set(messageID, []);
      messageOrder.push(messageID);
    }
    messageParts.get(messageID).push(part);
  }

  const messages = messageOrder.map((id) => ({
    id,
    role: "assistant",
    parts: messageParts.get(id) ?? [],
    info: {
      time: {
        completed: messageCompletedAtFromParts(messageParts.get(id) ?? []),
      },
    },
  }));
  const toolParts = messages.flatMap((message) => message.parts).filter((part) => part?.type === "tool");
  const toolIssues = extractToolIssuesFromParts(toolParts);
  const routingDiagnostics = summarizeConversationDiagnostics(toolParts, options);

  return {
    sessionId,
    lastType,
    error: errorObj,
    messageCount: messages.length,
    toolCounts: countToolsFromParts(toolParts),
    toolIssueCounts: summarizeToolIssues(toolIssues),
    toolIssues,
    toolTrace: buildCompactToolTrace(toolParts, options),
    routingDiagnostics,
    taskCalls: extractTaskCallsFromParts(toolParts),
    assistantText: extractAssistantText(messages),
  };
}

function analyzeExport(exportObj, options = {}) {
  const messages = Array.isArray(exportObj?.messages) ? exportObj.messages : [];
  const lastMessage = messages[messages.length - 1];
  const lastParts = Array.isArray(lastMessage?.parts) ? lastMessage.parts : [];
  const allParts = messages.flatMap((message) => (Array.isArray(message?.parts) ? message.parts : []));
  const toolParts = allParts.filter((part) => part?.type === "tool");
  const toolIssues = extractToolIssuesFromParts(toolParts);
  const routingDiagnostics = summarizeConversationDiagnostics(toolParts, options);
  return {
    messageCount: messages.length,
    toolCounts: countToolsFromParts(toolParts),
    toolIssueCounts: summarizeToolIssues(toolIssues),
    toolIssues,
    toolTrace: buildCompactToolTrace(toolParts, options),
    routingDiagnostics,
    taskCalls: extractTaskCallsFromParts(toolParts),
    assistantText: extractTextFromParts(lastParts),
  };
}

function classifyWorkspaceOutputs(files) {
  return files.filter((file) => {
    if (file.startsWith(".opencode/")) return false;
    if (file === "opencode.json" || file === "opencode.jsonc" || file === SCENARIO.promptFile) return false;
    if (SCENARIO.docs.some((doc) => basename(doc) === file)) return false;
    if (file.endsWith(".run.jsonl") || file.endsWith(".export.json")) return false;
    return true;
  });
}

function classifyGeneratedDocuments(items, uploadedNames) {
  const uploaded = new Set(uploadedNames);
  return (items || []).filter((item) => !uploaded.has(item.name));
}

async function writeLaneResult(name, payload) {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(join(OUTPUT_ROOT, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function runRawLane() {
  await prepareAgentWorkspace(RAW_WORKSPACE, { copyScenarioDocs: true });
  const title = `${SCENARIO_KEY}-raw-opencode-${Date.now()}`;
  log("lane.start", { lane: "raw", model: MODEL_REF });
  const startedAt = Date.now();
  const runResult = await runChildWithTimeout(
    "opencode",
    ["run", SCENARIO.prompt, "--format", "json", "-m", MODEL_REF, "--title", title],
    {
      cwd: RAW_WORKSPACE,
      env: {
        ...process.env,
        OPENCODE_CLIENT: `openwork-${SCENARIO_KEY}-raw`,
      },
      timeoutMs: TIMEOUTS.laneTimeoutMs,
    },
  );

  const runPath = join(RAW_WORKSPACE, "raw.run.jsonl");
  await writeFile(runPath, runResult.stdout, "utf8");
  const parsedRun = parseRunJsonLines(runResult.stdout);
  const exportPath = join(RAW_WORKSPACE, "raw.export.json");
  let exportReturn = null;
  let exportObj = null;
  let exportParseError = null;
  if (parsedRun.sessionId) {
    exportReturn = await runChildWithTimeout("opencode", ["export", parsedRun.sessionId], {
      cwd: RAW_WORKSPACE,
      env: process.env,
      timeoutMs: 180_000,
    });
    await writeFile(exportPath, exportReturn.stdout, "utf8");
    try {
      exportObj = JSON.parse(exportReturn.stdout);
    } catch (error) {
      exportParseError = formatError(error);
      exportObj = null;
    }
  }

  const files = await listFilesRecursive(RAW_WORKSPACE);
  const generatedOutputs = classifyWorkspaceOutputs(files);
  const rawDeliverableTargets = generatedOutputs
    .filter((item) => !item.startsWith(".tmp/") && !item.startsWith("tmp/"))
    .filter((item) => /\.(?:docx|md|txt|json|yaml|yml|csv|tsv|xml|html?)$/i.test(item));
  const deliveryQualityGate = await runDeliveryQualityGate(rawDeliverableTargets, { cwd: RAW_WORKSPACE });
  const result = {
    lane: "raw",
    title,
    model: MODEL_REF,
    workspace: RAW_WORKSPACE,
    startedAt: new Date(startedAt).toISOString(),
    elapsedMs: Date.now() - startedAt,
    opencodeVersion: (await runChildWithTimeout("opencode", ["--version"], {
      cwd: RAW_WORKSPACE,
      env: process.env,
      timeoutMs: 15_000,
    })).stdout.trim(),
    permissionMode: "allow (from ~/.config/opencode/opencode.json)",
    copiedDocs: SCENARIO.docs.map((doc) => basename(doc)),
    sessionId: parsedRun.sessionId,
    lastEventType: parsedRun.lastType,
    returncode: runResult.code,
    signal: runResult.signal,
    error: parsedRun.errorObj,
    runPath,
    exportPath: exportReturn?.stdout ? exportPath : null,
    exportReturncode: exportReturn?.code ?? null,
    exportParseError,
    analysisSource: exportObj ? "export" : "run-jsonl",
    stderrPreview: runResult.stderr.slice(0, 8000),
    workspaceFiles: files,
    generatedOutputs,
    deliveryQualityGate,
    ...(exportObj
      ? analyzeExport(exportObj, { workspaceDir: RAW_WORKSPACE })
      : analyzeRunJsonLines(runResult.stdout, { workspaceDir: RAW_WORKSPACE })),
  };
  await writeLaneResult("raw", result);
  log("lane.done", {
    lane: "raw",
    sessionId: result.sessionId,
    returncode: result.returncode,
    signal: result.signal,
    generatedOutputs: result.generatedOutputs.length,
    deliveryGateOk: result.deliveryQualityGate?.ok ?? false,
  });
  return result;
}

async function runOpenWorkCommonWorkLane({
  lane,
  openworkBase,
  token,
  workspaceId,
  directory,
  downloadsDir,
  client,
}) {
  const created = await createSession({
    baseUrl: openworkBase,
    token,
    workspaceId,
    title: `${SCENARIO_KEY}-${lane}-common-work-${Date.now()}`,
    enableDocumentState: false,
    preferredView: "document-agent",
    preferredAgent: "common-work",
    preferredAgentLock: "common-work",
  });
  const sessionId = created.id;
  log("lane.session", { lane, sessionId, workspaceId, directory });
  const sessionInfo = await getSessionInfo({ baseUrl: openworkBase, token, workspaceId, sessionId }).catch(() => null);
  const runtimeDirectory =
    typeof sessionInfo?.directory === "string" && sessionInfo.directory.trim()
      ? sessionInfo.directory.trim()
      : typeof created?.directory === "string" && created.directory.trim()
        ? created.directory.trim()
        : directory;

  const uploaded = [];
  const uploadStarted = Date.now();
  for (const docPath of SCENARIO.docs) {
    log("lane.upload.start", { lane, sessionId, file: basename(docPath) });
    uploaded.push(await uploadDocument({ baseUrl: openworkBase, token, workspaceId, sessionId, localPath: docPath }));
    log("lane.upload.done", { lane, sessionId, file: basename(docPath) });
  }
  const uploadElapsedMs = Date.now() - uploadStarted;

  const runStarted = Date.now();
  const settle = await waitForSessionSettled(
    client,
    sessionId,
    () =>
      client.session.promptAsync({
        sessionID: sessionId,
        agent: "common-work",
        model: MODEL,
        parts: [{ type: "text", text: SCENARIO.prompt }],
      }),
    {
      ...TIMEOUTS,
      diagnosticMode: DIAGNOSTIC_MODE,
      diagnosticWorkspaceDir: runtimeDirectory,
    },
  );
  const messages = await client.session.messages({ sessionID: sessionId, limit: 500 });
  const toolParts = extractToolPartsFromMessages(messages);
  const toolIssues = extractToolIssuesFromParts(toolParts);
  const routingDiagnostics = summarizeConversationDiagnostics(toolParts, {
    workspaceDir: runtimeDirectory,
  });
  const docs = await listDocuments({ baseUrl: openworkBase, token, workspaceId, sessionId });
  const generatedDocuments = classifyGeneratedDocuments(docs.items || [], uploaded);

  const downloaded = [];
  for (const item of generatedDocuments) {
    const targetPath = join(downloadsDir, item.name);
    try {
      const info = await downloadDocument({
        baseUrl: openworkBase,
        token,
        workspaceId,
        sessionId,
        name: item.name,
        outputPath: targetPath,
      });
      downloaded.push({ name: item.name, path: targetPath, ...info });
    } catch (error) {
      downloaded.push({ name: item.name, path: targetPath, error: formatError(error) });
    }
  }

  const deliveryQualityGate = await runDeliveryQualityGate(
    downloaded.filter((item) => !item.error).map((item) => item.path),
    { cwd: ROOT },
  );

  return {
    lane,
    model: MODEL_REF,
    sessionId,
    workspaceId,
    directory: runtimeDirectory,
    permissionMode: lane === "local" ? "auto (local openwork cli --approval auto)" : "hosted current default / user configured",
    compareMode: COMPARE_MODE,
    uploaded,
    uploadElapsedMs,
    elapsedMs: Date.now() - runStarted,
    eventTypes: settle.events,
    diagnosticStop: settle.diagnosticStop ?? null,
    messageCount: messages.length,
    toolCounts: countToolsFromParts(toolParts),
    toolIssueCounts: summarizeToolIssues(toolIssues),
    toolIssues,
    toolTrace: buildCompactToolTrace(toolParts, {
      workspaceDir: runtimeDirectory,
    }),
    routingDiagnostics,
    taskCalls: extractTaskCallsFromParts(toolParts),
    assistantText: extractAssistantText(messages),
    finalDocuments: docs.items || [],
    generatedDocuments,
    downloadedDocuments: downloaded,
    deliveryQualityGate,
    health: await client.global.health(),
  };
}

async function runLocalLane() {
  await prepareAgentWorkspace(LOCAL_WORKSPACE, { copyScenarioDocs: false });
  await ensureCleanDir(LOCAL_DATA_DIR);
  await mkdir(join(OUTPUT_ROOT, "downloads", "local"), { recursive: true });

  const opencodePort = await findFreePort();
  const openworkPort = await findFreePort();
  const token = `${SCENARIO_KEY}-local-token`;
  const hostToken = `${SCENARIO_KEY}-local-host-token`;

  log("lane.start", { lane: "local", model: MODEL_REF, opencodePort, openworkPort });

  const opencodeServer = spawnLogged(
    "opencode",
    ["serve", "--hostname", "127.0.0.1", "--port", String(opencodePort)],
    {
      cwd: LOCAL_WORKSPACE,
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        OPENCODE_CLIENT: `openwork-${SCENARIO_KEY}-local`,
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
      LOCAL_WORKSPACE,
      "--opencode-base-url",
      `http://127.0.0.1:${opencodePort}`,
      "--opencode-directory",
      LOCAL_WORKSPACE,
      "--no-log-requests",
    ],
    {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        OPENWORK_DATA_DIR: LOCAL_DATA_DIR,
      },
    },
  );

  try {
    const directClient = makeClient({ baseUrl: `http://127.0.0.1:${opencodePort}`, directory: LOCAL_WORKSPACE });
    await waitForHealthy(directClient, { timeoutMs: 30_000, pollMs: 500 });

    const openworkBase = `http://127.0.0.1:${openworkPort}`;
    const workspaces = await waitForOpenwork(openworkBase, token);
    const workspaceId = workspaces?.items?.[0]?.id;
    const directory = workspaces?.items?.[0]?.opencode?.directory ?? workspaces?.items?.[0]?.directory ?? LOCAL_WORKSPACE;
    assert.ok(workspaceId, "workspaceId is required");

    const client = createHostedOpenworkClient({ baseUrl: openworkBase, workspaceId, token });

    const result = await runOpenWorkCommonWorkLane({
      lane: "local",
      openworkBase,
      token,
      workspaceId,
      directory,
      downloadsDir: join(OUTPUT_ROOT, "downloads", "local"),
      client,
    });

    result.stderr = {
      opencode: opencodeServer.stderr().slice(0, 12000),
      openwork: openworkServer.stderr().slice(0, 12000),
    };
    await writeLaneResult("local", result);
    log("lane.done", {
      lane: "local",
      sessionId: result.sessionId,
      generatedDocuments: result.generatedDocuments.length,
      deliveryGateOk: result.deliveryQualityGate?.ok ?? false,
    });
    return result;
  } finally {
    await closeChild(openworkServer.child);
    await closeChild(opencodeServer.child);
  }
}

async function runPodLane() {
  await mkdir(join(OUTPUT_ROOT, "downloads", "pod"), { recursive: true });
  log("lane.start", { lane: "pod", model: MODEL_REF, baseUrl: OPENWORK_BASE });
  const auth = await loginPod();
  const token = auth.token;
  const workspaceId = auth.workspace.id;
  const directory = auth.workspace.path;
  const client = createHostedOpenworkClient({ baseUrl: OPENWORK_BASE, workspaceId, token });

  const result = await runOpenWorkCommonWorkLane({
    lane: "pod",
    openworkBase: OPENWORK_BASE,
    token,
    workspaceId,
    directory,
    downloadsDir: join(OUTPUT_ROOT, "downloads", "pod"),
    client,
  });
  await writeLaneResult("pod", result);
  log("lane.done", {
    lane: "pod",
    sessionId: result.sessionId,
    generatedDocuments: result.generatedDocuments.length,
    deliveryGateOk: result.deliveryQualityGate?.ok ?? false,
  });
  return result;
}

async function main() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    model: MODEL_REF,
    scenario: SCENARIO,
    requestedLanes: [...REQUESTED_LANES],
    results: {},
  };

  const lanePromises = [];
  if (REQUESTED_LANES.has("raw")) {
    lanePromises.push(
      runRawLane()
        .then((result) => {
          summary.results.raw = { ok: true, result };
        })
        .catch((error) => {
          summary.results.raw = { ok: false, error: formatError(error) };
        }),
    );
  }
  if (REQUESTED_LANES.has("local")) {
    lanePromises.push(
      runLocalLane()
        .then((result) => {
          summary.results.local = { ok: true, result };
        })
        .catch((error) => {
          summary.results.local = { ok: false, error: formatError(error) };
        }),
    );
  }
  if (REQUESTED_LANES.has("pod")) {
    lanePromises.push(
      runPodLane()
        .then((result) => {
          summary.results.pod = { ok: true, result };
        })
        .catch((error) => {
          summary.results.pod = { ok: false, error: formatError(error) };
        }),
    );
  }

  await Promise.all(lanePromises);
  await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
  const payload = {
    ok: false,
    error: formatError(error),
  };
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(SUMMARY_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
