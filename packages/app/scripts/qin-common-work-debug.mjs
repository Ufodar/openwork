import { basename } from "node:path";
import { performance } from "node:perf_hooks";

import {
  createHostedOpenworkClient,
  createHostedOpenworkSession,
  fetchHostedSessionRecord,
  uploadHostedDocument,
} from "./_util.mjs";

const OPENWORK_BASE = process.env.OPENWORK_BASE ?? "http://192.168.5.10:32765/openwork";
const USERNAME = process.env.OPENWORK_USERNAME ?? "fuda";
const PASSWORD = process.env.OPENWORK_PASSWORD ?? "1";
const MODEL_REF = process.env.OPENWORK_COMPARE_MODEL ?? "my-company/Qwen3.5-397B-A17B";

const SCENARIO = {
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

function hasPendingToolStates(messages) {
  return messages
    .flatMap((message) => (Array.isArray(message?.parts) ? message.parts : []))
    .filter((part) => part?.type === "tool")
    .some((part) => {
      const status = typeof part?.state?.status === "string" ? part.state.status : "";
      return status === "pending" || status === "running";
    });
}

function hasCompletedAssistantTurn(messages) {
  const assistant = [...messages].reverse().find((message) => roleOf(message) === "assistant");
  if (!assistant) return false;
  const completed = assistant?.info?.time?.completed;
  return typeof completed === "number" && !hasPendingToolStates([assistant]);
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

function summarizeMessages(messages) {
  const roles = messages.map(roleOf);
  const assistantPayloadCount = messages.filter(
    (message) => roleOf(message) === "assistant" && Array.isArray(message.parts) && message.parts.length > 0,
  ).length;
  const emptyAssistantCount = messages.filter(
    (message) => roleOf(message) === "assistant" && (!Array.isArray(message.parts) || message.parts.length === 0),
  ).length;
  const last = messages[messages.length - 1];
  return {
    messageCount: messages.length,
    roles,
    assistantPayloadCount,
    emptyAssistantCount,
    lastRole: roleOf(last),
    lastPartTypes: Array.isArray(last?.parts) ? last.parts.map((part) => part?.type) : [],
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

async function login() {
  return requestJson(`${OPENWORK_BASE}/auth/login`, null, {
    method: "POST",
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
}

async function debugWaitForSessionSettled(client, sessionId, runPrompt, options = {}) {
  const { timeoutMs = 1_200_000, pollMs = 5_000, quietMs = 20_000, noProgressTimeoutMs = 240_000 } = options;
  const controller = new AbortController();
  const sub = await client.event.subscribe(undefined, { signal: controller.signal });
  let sawIdle = false;
  let sawError = null;
  const eventLog = [];

  const eventReader = (async () => {
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
        eventLog.push({
          t: Date.now(),
          type: evt.type,
          sessionId: eventSessionId,
        });
        console.log("[event]", JSON.stringify(eventLog[eventLog.length - 1]));
        if (evt.type === "session.error") {
          sawError = new Error(`session.error for ${sessionId}`);
          return;
        }
        if (evt.type === "session.idle") {
          sawIdle = true;
          return;
        }
      }
    } catch (error) {
      console.log("[event-reader-exit]", error instanceof Error ? error.message : String(error));
    }
  })();

  try {
    await runPrompt();
    const startedAt = performance.now();
    let lastFingerprint = "";
    let lastProgressAt = performance.now();
    let pollIndex = 0;

    while (performance.now() - startedAt < timeoutMs) {
      pollIndex += 1;
      if (sawError) throw sawError;
      if (sawIdle) return { eventLog };

      const messages = await client.session.messages({ sessionID: sessionId, limit: 500 });
      const fingerprint = messagesFingerprint(messages);
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        lastProgressAt = performance.now();
      }

      const hasAnyAssistantPayload = messages.some(
        (message) => roleOf(message) === "assistant" && Array.isArray(message.parts) && message.parts.length > 0,
      );
      const elapsedMs = Math.round(performance.now() - startedAt);
      const sinceProgressMs = Math.round(performance.now() - lastProgressAt);
      console.log(
        "[poll]",
        JSON.stringify({
          pollIndex,
          elapsedMs,
          sinceProgressMs,
          hasAnyAssistantPayload,
          hasCompletedAssistantTurn: hasCompletedAssistantTurn(messages),
          hasPendingToolStates: hasPendingToolStates(messages),
          fingerprint,
          summary: summarizeMessages(messages),
        }),
      );

      if (!hasAnyAssistantPayload && performance.now() - lastProgressAt >= noProgressTimeoutMs) {
        throw new Error(`No assistant progress after ${elapsedMs}ms`);
      }
      if (hasCompletedAssistantTurn(messages) && !hasPendingToolStates(messages) && performance.now() - lastProgressAt >= quietMs) {
        return { eventLog };
      }
      await sleep(pollMs);
    }

    throw new Error(`Timed out waiting for session ${sessionId}`);
  } finally {
    controller.abort();
    await Promise.race([eventReader, sleep(500)]);
  }
}

async function main() {
  const auth = await login();
  const token = auth.token;
  const workspaceId = auth.workspace.id;
  const client = createHostedOpenworkClient({ baseUrl: OPENWORK_BASE, workspaceId, token });

  const created = await createHostedOpenworkSession({
    baseUrl: OPENWORK_BASE,
    token,
    workspaceId,
    title: `qin-common-work-debug-${Date.now()}`,
    preferredView: "document-agent",
    preferredAgent: "common-work",
    preferredAgentLock: "common-work",
  });
  const sessionId = created.id;
  const sessionProfile = await fetchHostedSessionRecord({
    baseUrl: OPENWORK_BASE,
    token,
    workspaceId,
    sessionId,
    workspacePath: auth.workspace.path,
    preferredView: "document-agent",
    preferredAgent: "common-work",
    preferredAgentLock: "common-work",
  });
  console.log("[session]", sessionId);
  console.log("[session-profile]", JSON.stringify(sessionProfile));
  await sleep(8_000);
  for (const docPath of SCENARIO.docs) {
    console.log("[upload-start]", basename(docPath));
    await uploadHostedDocument({
      baseUrl: OPENWORK_BASE,
      token,
      workspaceId,
      sessionId,
      localPath: docPath,
      attempts: Number.parseInt(process.env.OPENWORK_UPLOAD_ATTEMPTS ?? "4", 10),
      retryDelayMs: Number.parseInt(process.env.OPENWORK_UPLOAD_RETRY_DELAY_MS ?? "1500", 10),
    });
    console.log("[upload-done]", basename(docPath));
  }
  await debugWaitForSessionSettled(
    client,
    sessionId,
    () =>
      client.session.promptAsync({
        sessionID: sessionId,
        agent: "common-work",
        model: MODEL,
        parts: [{ type: "text", text: SCENARIO.prompt }],
      }),
  );
  console.log("[done]", sessionId);
}

main().catch((error) => {
  console.error("[error]", error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
