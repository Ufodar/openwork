import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

import {
  createHostedOpenworkClient,
  createHostedOpenworkSession,
  fetchHostedSessionRecord,
  uploadHostedDocument,
} from "./_util.mjs";

import { joinVisibleAssistantText } from "./_assistant-text.mjs";

const OPENWORK_BASE = process.env.OPENWORK_BASE ?? "http://192.168.5.10:32765/openwork";
const USERNAME = process.env.OPENWORK_USERNAME ?? "fuda";
const PASSWORD = process.env.OPENWORK_PASSWORD ?? "1";
const MODEL_REF = process.env.OPENWORK_COMPARE_MODEL ?? "my-company/MiniMax-2.5";
const OUTPUT_PATH = resolve(
  process.cwd(),
  process.env.OPENWORK_COMPARE_OUTPUT ?? "../../tmp/compare-agents/qin-one-shot-compare.json",
);

const SCENARIO = {
  title: "秦老师-算力项目申报-oneshot",
  docs: [
    "/Users/storm/Pictures/秦老师/天河监控运维一体化平台软件介绍v0.3.docx",
    "/Users/storm/Pictures/秦老师/融合算力云平台白皮书.docx",
  ],
  prompt:
    "请你结合参考两篇文档以及查找网络中的一些资料，帮我写一份项目申报所需要的技术材料，围绕以下三部分进行扩充和对应材料补充，生成word文档。分三大系统，给出技术架构、技术路线、互联互通机制、标识系统构建等技术实现的方式方法，面向应用层，给出API调用的示例\n\n| 系统名称 | 功能定位 | 技术实现 |\n| 算力资源汇聚系统 | 具备跨中心纳管算力能力、联动区域IDC资源 | 支持Agent、API、多云网关等多种接入方式，实现K8s、虚拟机、裸金属、GPU资源池化，自动生成资源标签（如地域、卡型、安全等级） |\n| 算力选择与调度系统 | 基于算力度量与网络感知，智能推荐最优算力资源与传输路径 | 融合实时网络时延、带宽、丢包率与算力性能（TPM/RPM）、线性度等多维指标，采用算网融合调度算法，实现“任务-资源-路径”最优匹配 |\n| 算力运行安全监测系统 | 实现全链路安全监控与风险预警 | 部署调度、算力、网络三大运营大盘，支持异常任务识别、资源滥用告警、数据访问审计，符合等保三级要求 |",
};

function parseModel(value) {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) throw new Error(`Invalid model ref: ${value}`);
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}

const MODEL = parseModel(MODEL_REF);

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function roleOf(message) {
  return typeof message?.role === "string"
    ? message.role
    : typeof message?.info?.role === "string"
      ? message.info.role
      : "";
}

function extractToolParts(messages) {
  return messages
    .flatMap((message) => (Array.isArray(message?.parts) ? message.parts : []))
    .filter((part) => part?.type === "tool");
}

function countTools(messages) {
  const counts = {};
  for (const part of extractToolParts(messages)) {
    const name = typeof part?.tool === "string" ? part.tool : "unknown";
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function extractTaskCalls(messages) {
  return extractToolParts(messages)
    .filter((part) => String(part?.tool ?? "").toLowerCase() === "task")
    .map((part) => {
      const input = part?.state?.input && typeof part.state.input === "object"
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
  return extractToolParts(messages).some((part) => {
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

function hasAnyAssistantMessage(messages) {
  return messages.some((message) => roleOf(message) === "assistant");
}

function messagesFingerprint(messages) {
  if (!messages.length) return "empty";
  const last = messages[messages.length - 1];
  return [
    messages.length,
    last?.id ?? last?.info?.id ?? "",
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
  return joinVisibleAssistantText(assistant.parts);
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

async function login() {
  return requestJson(`${OPENWORK_BASE}/auth/login`, null, {
    method: "POST",
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
}

async function listDocuments({ token, workspaceId, sessionId }) {
  return requestJson(
    `${OPENWORK_BASE}/w/${encodeURIComponent(workspaceId)}/documents?session=${encodeURIComponent(sessionId)}`,
    token,
  );
}

async function readDocumentText({ token, workspaceId, sessionId, name }) {
  const response = await fetch(
    `${OPENWORK_BASE}/w/${encodeURIComponent(workspaceId)}/document/file?docId=${encodeURIComponent(name)}&session=${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`download ${name} failed ${response.status}`);
  return response.text();
}

async function waitForSessionSettled(client, sessionId, runPrompt, options = {}) {
  const {
    timeoutMs = 1_200_000,
    pollMs = 5_000,
    quietMs = 20_000,
    noProgressTimeoutMs = 240_000,
    useWorkspaceEventStream = false,
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
          const evt = raw && typeof raw === "object" && typeof raw.type === "string"
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
        // Ignore abort/stream termination errors.
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

      if (!hasAnyAssistantMessage(messages) && performance.now() - lastProgressAt >= noProgressTimeoutMs) {
        throw new Error(`No assistant progress after ${Math.round(performance.now() - startedAt)}ms`);
      }
      if (hasCompletedAssistantTurn(messages) && !hasPendingToolStates(messages) && performance.now() - lastProgressAt >= quietMs) {
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

function classifyGeneratedDocuments(items, uploadedNames) {
  const uploaded = new Set(uploadedNames);
  return (items || []).filter((item) => !uploaded.has(item.name));
}

async function runVariant({
  label,
  agent,
  enableDocumentState,
  preferredView,
  preferredAgent,
  preferredAgentLock,
  client,
  token,
  workspacePath,
  workspaceId,
}) {
  const requireStrictProfile = enableDocumentState || preferredView === "document-writer";
  const created = await createHostedOpenworkSession({
    baseUrl: OPENWORK_BASE,
    token,
    workspaceId,
    title: `${label}-${Date.now()}`,
    enableDocumentState,
    preferredView,
    preferredAgent,
    preferredAgentLock,
  });
  const sessionId = created.id;
  const sessionProfile = await fetchHostedSessionRecord({
    baseUrl: OPENWORK_BASE,
    token,
    workspaceId,
    sessionId,
    workspacePath,
    preferredView: requireStrictProfile ? preferredView : undefined,
    preferredAgent: requireStrictProfile ? preferredAgent : undefined,
    preferredAgentLock: requireStrictProfile ? preferredAgentLock : undefined,
  });
  if (
    requireStrictProfile &&
    (
      sessionProfile?.openworkPreferredView !== preferredView ||
      sessionProfile?.openworkPreferredAgent !== preferredAgent ||
      sessionProfile?.openworkPreferredAgentLock !== preferredAgentLock
    )
  ) {
    throw new Error(
      `profile mismatch view=${sessionProfile?.openworkPreferredView} agent=${sessionProfile?.openworkPreferredAgent} lock=${sessionProfile?.openworkPreferredAgentLock}`,
    );
  }
  const uploaded = [];
  // Hosted runtimes need a short window to finish carrier/workspace setup
  // before large multipart uploads start, otherwise upload probes can stall
  // in the session bootstrap window and never materialize as documents.
  await sleep(8_000);
  const uploadStarted = Date.now();
  for (const docPath of SCENARIO.docs) {
    console.log(`[${label}] uploading ${basename(docPath)}`);
    uploaded.push(
      await uploadHostedDocument({
        baseUrl: OPENWORK_BASE,
        token,
        workspaceId,
        sessionId,
        localPath: docPath,
        attempts: Number.parseInt(process.env.OPENWORK_UPLOAD_ATTEMPTS ?? "4", 10),
        retryDelayMs: Number.parseInt(process.env.OPENWORK_UPLOAD_RETRY_DELAY_MS ?? "1500", 10),
      }),
    );
  }
  const uploadElapsedMs = Date.now() - uploadStarted;
  console.log(`[${label}] uploaded ${uploaded.length} docs in ${uploadElapsedMs}ms`);
  const startedAt = Date.now();
  const settle = await waitForSessionSettled(
    client,
    sessionId,
    () =>
      client.session.promptAsync({
        sessionID: sessionId,
        agent,
        model: MODEL,
        parts: [{ type: "text", text: SCENARIO.prompt }],
      }),
  );
  const elapsedMs = Date.now() - startedAt;
  const messages = await client.session.messages({ sessionID: sessionId, limit: 500 });
  const toolCounts = countTools(messages);
  const taskCalls = extractTaskCalls(messages);
  const docs = await listDocuments({ token, workspaceId, sessionId });
  const generatedDocs = classifyGeneratedDocuments(docs.items || [], uploaded);
  const previews = {};
  for (const item of generatedDocs) {
    if (!/\.md$/i.test(item.name)) continue;
    try {
      previews[item.name] = (await readDocumentText({ token, workspaceId, sessionId, name: item.name })).slice(0, 4000);
    } catch {
      previews[item.name] = "(failed to read preview)";
    }
  }
  return {
    label,
    agent,
    enableDocumentState,
    sessionId,
    sessionProfile,
    uploaded,
    uploadElapsedMs,
    elapsedMs,
    eventTypes: settle.events,
    toolCounts,
    taskCalls,
    assistantText: extractAssistantText(messages),
    finalDocuments: docs.items || [],
    generatedDocuments: generatedDocs,
    previews,
  };
}

async function main() {
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  const auth = await login();
  const token = auth.token;
  const workspaceId = auth.workspace.id;
  const workspacePath = auth.workspace.path;
  const client = createHostedOpenworkClient({ baseUrl: OPENWORK_BASE, workspaceId, token });

  const common = await runVariant({
    label: "qin-common-work",
    agent: "common-work",
    enableDocumentState: false,
    preferredView: "document-agent",
    preferredAgent: "common-work",
    preferredAgentLock: "common-work",
    client,
    token,
    workspacePath,
    workspaceId,
  });
  const orchestrated = await runVariant({
    label: "qin-document-writer",
    agent: "document-writer",
    enableDocumentState: true,
    preferredView: "document-writer",
    preferredAgent: "document-writer",
    preferredAgentLock: "document-writer",
    client,
    token,
    workspacePath,
    workspaceId,
  });

  const result = {
    generatedAt: new Date().toISOString(),
    model: MODEL_REF,
    scenario: SCENARIO,
    common,
    orchestrated,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(async (error) => {
  const payload = {
    ok: false,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
