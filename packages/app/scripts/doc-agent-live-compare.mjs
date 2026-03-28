import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createHostedOpenworkClient } from "./_util.mjs";

import { joinVisibleAssistantText } from "./_assistant-text.mjs";

const OPENWORK_BASE = process.env.OPENWORK_BASE ?? "http://192.168.5.10:32765/openwork";
const USERNAME = process.env.OPENWORK_USERNAME ?? "fuda";
const PASSWORD = process.env.OPENWORK_PASSWORD ?? "1";
const MODEL = parseModel(process.env.OPENWORK_COMPARE_MODEL ?? "my-company/Qwen3.5-397B-A17B");
const OUTPUT_PATH = resolve(
  process.cwd(),
  process.env.OPENWORK_COMPARE_OUTPUT ?? "../../tmp/compare-agents/wjw-live-compare.json",
);

const scenarios = {
  qin: {
    id: "qin-live-compare",
    title: "秦老师申报材料-live",
    expectedOutput: "outputs/qin-technical-material.md",
    docs: [
      "/Users/storm/Pictures/秦老师/天河监控运维一体化平台软件介绍v0.3.docx",
      "/Users/storm/Pictures/秦老师/融合算力云平台白皮书.docx",
    ],
    prompts: [
      "请你结合当前 workspace 已上传的两篇文档，并结合联网检索，先完成材料理解和写作准备：梳理三大系统各自可直接支撑的技术能力、可以扩充的行业通用做法、明显缺口与需要联网补充的点，并把可恢复的中间状态留在 workspace 里。暂时不要写最终稿，只回复你已经形成了哪些关键中间结果，以及下一步准备如何写。",
      "继续推进，生成完整的中文 Markdown 技术材料，写到 outputs/qin-technical-material.md。内容必须围绕算力资源汇聚系统、算力选择与调度系统、算力运行安全监测系统三大系统展开，并且每个系统都要写出技术架构、技术路线、互联互通机制、标识系统构建、API 调用示例。最后增加一节“参考与依据”，说明文档来源和联网补充依据。写完后自检，确保这些部分原样存在。",
    ],
  },
  wjw: {
    id: "wjw-live-compare",
    title: "卫健委点对点方案-live",
    expectedOutput: "outputs/wjw-p2p.md",
    docs: [
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/招标文件-天津市滨海新区卫生健康委员会天津市滨海新区卫生健康信息化平台项目.docx",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/产品信息/海滨医院点对点应答.docx",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/产品信息/智慧网络医疗服务项目设备参数9.29(1).docx",
    ],
    prompts: [
      "基于当前 workspace 已上传的三份材料，先梳理需求拆解、可直接支撑的证据、明显冲突与待确认点，并在 workspace 内留下可恢复的中间状态。暂时不要写最终稿，只回复你已经形成了哪些关键中间结果，以及下一步会如何推进。",
      "继续推进，把完整的中文 Markdown 方案写到 outputs/wjw-p2p.md。正文至少必须包含以下四个 Markdown 标题：需求拆解、点对点对应方案、证据与约束、待确认问题。写完后自检，确保这些标题原样存在。",
    ],
  },
  ly: {
    id: "ly-live-compare",
    title: "临沂三文档-live",
    expectedOutput: "outputs/ly-solution.md",
    docs: [
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/备-环投数科临沂项目第一包v20250507v1.0(1)(1).docx",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/ly项目伙伴/临沂招标文件正文.pdf",
      "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/ly项目伙伴/伙伴资料文档/环投数科临沂项目第一包v20250508终版文件.docx",
    ],
    prompts: [
      "基于当前 workspace 已上传的三份材料，先梳理项目理解、可直接支撑的证据、明显冲突与待确认点，并在 workspace 内留下可恢复的中间状态。暂时不要写最终稿，只回复你已经形成了哪些关键中间结果，以及下一步会如何推进。",
      "继续推进，把完整的中文 Markdown 方案写到 outputs/ly-solution.md。正文至少必须包含以下四个 Markdown 标题：项目理解、点对点解决路径、证据来源与假设、风险与待确认事项。写完后自检，确保这些标题原样存在。",
    ],
  },
};

function parseModel(value) {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`Invalid model ref: ${value}`);
  }
  return {
    providerID: value.slice(0, slash),
    modelID: value.slice(slash + 1),
  };
}

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

function messageId(message) {
  return typeof message?.id === "string"
    ? message.id
    : typeof message?.info?.id === "string"
      ? message.info.id
      : "";
}

function extractText(messages) {
  const assistant = [...messages].reverse().find((message) => roleOf(message) === "assistant");
  if (!assistant || !Array.isArray(assistant.parts)) return "";
  return joinVisibleAssistantText(assistant.parts);
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
            ? input.description.slice(0, 200)
            : typeof input.prompt === "string"
              ? input.prompt.slice(0, 200)
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

function extractHeadings(markdown) {
  return String(markdown ?? "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/)?.[1]?.trim())
    .filter(Boolean);
}

function buildStepError({ label, step, sessionId, details, cause }) {
  const lines = [`[${label}] failed at ${step}`];
  if (sessionId) lines.push(`session=${sessionId}`);
  if (details && Object.keys(details).length > 0) {
    lines.push(
      Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" "),
    );
  }
  if (cause instanceof Error) lines.push(`cause=${cause.message}`);
  const error = new Error(lines.join(" | "));
  if (cause instanceof Error) error.cause = cause;
  error.step = step;
  error.label = label;
  error.sessionId = sessionId ?? null;
  error.details = details ?? null;
  return error;
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return { name: "Error", message: String(error) };
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    step: typeof error.step === "string" ? error.step : undefined,
    label: typeof error.label === "string" ? error.label : undefined,
    sessionId: typeof error.sessionId === "string" ? error.sessionId : undefined,
    details: error.details && typeof error.details === "object" ? error.details : undefined,
    cause:
      error.cause instanceof Error
        ? {
            name: error.cause.name,
            message: error.cause.message,
            stack: error.cause.stack,
          }
        : undefined,
  };
}

async function requestJson(url, token, init = {}, context = {}) {
  const method = typeof init.method === "string" ? init.method : "GET";
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (cause) {
    throw buildStepError({
      label: context.label ?? "requestJson",
      step: context.step ?? "fetch",
      details: { method, url },
      cause,
    });
  }
  const text = await response.text();
  if (!response.ok) {
    throw buildStepError({
      label: context.label ?? "requestJson",
      step: context.step ?? "http",
      details: {
        method,
        url,
        status: response.status,
        bodyPreview: (text || "").slice(0, 200),
      },
      cause: new Error(text || `HTTP ${response.status}`),
    });
  }
  return text ? JSON.parse(text) : null;
}

async function login() {
  return requestJson(`${OPENWORK_BASE}/auth/login`, null, {
    method: "POST",
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  }, {
    label: "auth",
    step: "login",
  });
}

async function createSession({ token, workspaceId, title, enableDocumentState }) {
  return requestJson(`${OPENWORK_BASE}/w/${encodeURIComponent(workspaceId)}/opencode/session`, token, {
    method: "POST",
    body: JSON.stringify({
      title,
      openworkEnableDocState: enableDocumentState ? true : undefined,
    }),
  });
}

async function uploadDocument({ token, workspaceId, sessionId, localPath }) {
  const payload = await readFile(localPath);
  const form = new FormData();
  form.append("file", new File([payload], basename(localPath)));
  const response = await fetch(
    `${OPENWORK_BASE}/w/${encodeURIComponent(workspaceId)}/document/upload?session=${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `upload failed ${response.status}`);
  }
  const parsed = text ? JSON.parse(text) : null;
  return typeof parsed?.name === "string" ? parsed.name : basename(localPath);
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
  if (!response.ok) {
    throw new Error(`download ${name} failed ${response.status}`);
  }
  return response.text();
}

async function waitForSessionSettled(
  client,
  sessionId,
  runPrompt,
  {
    timeoutMs = 900_000,
    pollMs = 4_000,
    quietMs = 15_000,
    noProgressTimeoutMs = 180_000,
    label,
    useWorkspaceEventStream = false,
  } = {},
) {
  const observedEvents = new Set();
  let sawIdle = false;
  let sawError = null;
  let controller = null;
  let eventReader = Promise.resolve();

  if (useWorkspaceEventStream) {
    controller = new AbortController();
    let sub;
    try {
      sub = await client.event.subscribe(undefined, { signal: controller.signal });
    } catch (cause) {
      throw buildStepError({
        label: label ?? "session",
        step: "event.subscribe",
        sessionId,
        cause,
      });
    }
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
    try {
      await runPrompt();
    } catch (cause) {
      throw buildStepError({
        label: label ?? "session",
        step: "promptAsync",
        sessionId,
        cause,
      });
    }
    let lastFingerprint = "";
    let lastProgressAt = performance.now();
    const startedAt = performance.now();

    while (performance.now() - startedAt < timeoutMs) {
      if (sawError) throw sawError;
      if (sawIdle) return { events: [...observedEvents] };

      let messages;
      try {
        messages = await client.session.messages({ sessionID: sessionId, limit: 400 });
      } catch (cause) {
        throw buildStepError({
          label: label ?? "session",
          step: "session.messages.poll",
          sessionId,
          cause,
        });
      }
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

async function runVariant({ scenario, label, agent, enableDocumentState, client, token, workspaceId }) {
  let sessionId = null;
  let created;
  try {
    created = await createSession({
      token,
      workspaceId,
      title: `${label}-${Date.now()}`,
      enableDocumentState,
    });
    sessionId = created.id;
  } catch (cause) {
    throw buildStepError({
      label,
      step: "createSession",
      details: { agent, enableDocumentState, workspaceId },
      cause,
    });
  }
  const uploaded = [];
  const uploadStarted = Date.now();
  for (const docPath of scenario.docs) {
    const name = basename(docPath);
    try {
      uploaded.push(await uploadDocument({ token, workspaceId, sessionId, localPath: docPath }));
    } catch (cause) {
      throw buildStepError({
        label,
        step: "uploadDocument",
        sessionId,
        details: { file: name },
        cause,
      });
    }
  }
  const uploadElapsedMs = Date.now() - uploadStarted;

  let seenMessageCount = 0;
  const promptRuns = [];

  for (const promptText of scenario.prompts) {
    const startedAt = Date.now();
    let settle;
    try {
      settle = await waitForSessionSettled(
        client,
        sessionId,
        () =>
          client.session.promptAsync({
            sessionID: sessionId,
            agent,
            model: MODEL,
            parts: [{ type: "text", text: promptText }],
          }),
        { label },
      );
    } catch (cause) {
      if (cause instanceof Error && typeof cause.step === "string") throw cause;
      throw buildStepError({
        label,
        step: "promptAndSettle",
        sessionId,
        details: { promptPreview: promptText.slice(0, 120) },
        cause,
      });
    }
    const elapsedMs = Date.now() - startedAt;
    let messages;
    try {
      messages = await client.session.messages({ sessionID: sessionId, limit: 400 });
    } catch (cause) {
      throw buildStepError({
        label,
        step: "session.messages",
        sessionId,
        details: { promptPreview: promptText.slice(0, 120) },
        cause,
      });
    }
    const freshMessages = messages.slice(seenMessageCount);
    seenMessageCount = messages.length;
    const toolCounts = countTools(freshMessages);
    const taskCalls = extractTaskCalls(freshMessages);
    let docs;
    try {
      docs = await listDocuments({ token, workspaceId, sessionId });
    } catch (cause) {
      throw buildStepError({
        label,
        step: "listDocuments",
        sessionId,
        details: { promptPreview: promptText.slice(0, 120) },
        cause,
      });
    }
    const hasExpectedOutput = (docs.items || []).some((item) => item.name === scenario.expectedOutput);
    let outputText = "";
    let outputHeadings = [];
    if (hasExpectedOutput) {
      try {
        outputText = await readDocumentText({
          token,
          workspaceId,
          sessionId,
          name: scenario.expectedOutput,
        });
      } catch (cause) {
        throw buildStepError({
          label,
          step: "readExpectedOutput",
          sessionId,
          details: { name: scenario.expectedOutput },
          cause,
        });
      }
      outputHeadings = extractHeadings(outputText);
    }
    promptRuns.push({
      prompt: promptText,
      elapsedMs,
      eventTypes: settle.events,
      toolCounts,
      taskCalls,
      assistantText: extractText(freshMessages) || extractText(messages),
      documentCount: Array.isArray(docs.items) ? docs.items.length : 0,
      hasExpectedOutput,
      outputHeadings,
      outputPreview: outputText.slice(0, 1_200),
    });
  }

  let finalDocuments;
  try {
    finalDocuments = await listDocuments({ token, workspaceId, sessionId });
  } catch (cause) {
    throw buildStepError({
      label,
      step: "finalListDocuments",
      sessionId,
      cause,
    });
  }

  return {
    label,
    agent,
    enableDocumentState,
    sessionId,
    uploaded,
    uploadElapsedMs,
    finalDocuments: finalDocuments.items || [],
    promptRuns,
  };
}

async function main() {
  const scenarioKey = process.argv[2] ?? "wjw";
  const scenario = scenarios[scenarioKey];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioKey}`);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    scenario,
  };

  let auth;
  try {
    auth = await login();
  } catch (cause) {
    const error = cause instanceof Error && typeof cause.step === "string"
      ? cause
      : buildStepError({
          label: "main",
          step: "login",
          details: { baseUrl: OPENWORK_BASE, username: USERNAME },
          cause,
        });
    error.partialResult = result;
    throw error;
  }
  const token = auth.token;
  const workspaceId = auth.workspace.id;
  const client = createHostedOpenworkClient({ baseUrl: OPENWORK_BASE, workspaceId, token });
  try {
    result.common = await runVariant({
      scenario,
      label: "cmp-common-work",
      agent: "common-work",
      enableDocumentState: false,
      client,
      token,
      workspaceId,
    });
    result.orchestrated = await runVariant({
      scenario,
      label: "cmp-document-writer",
      agent: "document-writer",
      enableDocumentState: true,
      client,
      token,
      workspaceId,
    });
  } catch (error) {
    error.partialResult = result;
    throw error;
  }
  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(async (error) => {
  const payload = {
    ok: false,
    error: serializeError(error),
    partialResult: error?.partialResult ?? null,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
