import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  createHostedOpenworkClient,
  createHostedOpenworkSession,
  fetchHostedSessionRecord,
} from "./_util.mjs";

import { joinVisibleAssistantText } from "./_assistant-text.mjs";

const OPENWORK_BASE = process.env.OPENWORK_BASE ?? "http://192.168.5.10:32765/openwork";
const USERNAME = process.env.OPENWORK_USERNAME ?? "fuda";
const PASSWORD = process.env.OPENWORK_PASSWORD ?? "1";
const MODEL_REF = process.env.OPENWORK_COMPARE_MODEL ?? "my-company/Qwen3.5-397B-A17B";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH =
  typeof process.env.OPENWORK_COMPARE_OUTPUT === "string" && process.env.OPENWORK_COMPARE_OUTPUT.trim()
    ? resolve(process.cwd(), process.env.OPENWORK_COMPARE_OUTPUT)
    : resolve(SCRIPT_DIR, "../../../tmp/compare-agents/qin-doc-writer-fresh.json");

const DOCS = [
  "/Users/storm/Pictures/秦老师/天河监控运维一体化平台软件介绍v0.3.docx",
  "/Users/storm/Pictures/秦老师/融合算力云平台白皮书.docx",
];

const PROMPTS = [
  "请你结合当前 workspace 已上传的两篇文档，并结合联网检索，先完成材料理解和写作准备：梳理三大系统各自可直接支撑的技术能力、可以扩充的行业通用做法、明显缺口与需要联网补充的点，并把可恢复的中间状态留在 workspace 里。暂时不要写最终稿，只回复你已经形成了哪些关键中间结果，以及下一步准备如何写。",
  "继续推进，生成完整的中文 Markdown 技术材料，写到 outputs/qin-technical-material.md。内容必须围绕算力资源汇聚系统、算力选择与调度系统、算力运行安全监测系统三大系统展开，并且每个系统都要写出技术架构、技术路线、互联互通机制、标识系统构建、API 调用示例。最后增加一节“参考与依据”，说明文档来源和联网补充依据。写完后自检，确保这些部分原样存在。",
];

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

function extractToolParts(messages) {
  return messages.flatMap((message) => (Array.isArray(message?.parts) ? message.parts : [])).filter((part) => part?.type === "tool");
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

function extractText(messages) {
  const assistant = findLastCompletedAssistant(messages);
  if (!assistant || !Array.isArray(assistant.parts)) return "";
  return joinVisibleAssistantText(assistant.parts);
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

async function uploadDocument({ token, workspaceId, sessionId, localPath }) {
  const form = new FormData();
  form.append("file", Bun.file(localPath));
  const response = await fetch(
    `${OPENWORK_BASE}/w/${encodeURIComponent(workspaceId)}/document/upload?session=${encodeURIComponent(sessionId)}`,
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
  const text = await response.text();
  if (!response.ok) throw new Error(text || `download ${name} failed ${response.status}`);
  return text;
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
        // ignore abort/stream shutdown
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

      const messages = await client.session.messages({ sessionID: sessionId, limit: 400 });
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

async function main() {
  if (typeof Bun === "undefined" || typeof Bun.file !== "function") {
    throw new Error(
      "run-qin-doc-writer.mjs must be executed with Bun; this harness uses Bun.file for large document uploads",
    );
  }

  console.error(`[qin-doc-writer] model=${MODEL_REF}`);
  console.error(`[qin-doc-writer] output=${OUTPUT_PATH}`);
  const auth = await login();
  const token = auth.token;
  const workspaceId = auth.workspace.id;
  const client = createHostedOpenworkClient({ baseUrl: OPENWORK_BASE, workspaceId, token });

  const created = await createHostedOpenworkSession({
    baseUrl: OPENWORK_BASE,
    token,
    workspaceId,
    title: `qin-doc-writer-fresh-${Date.now()}`,
    enableDocumentState: true,
    preferredView: "document-writer",
    preferredAgent: "document-writer",
    preferredAgentLock: "document-writer",
  });
  const sessionId = created.id;
  const sessionProfile = await fetchHostedSessionRecord({
    baseUrl: OPENWORK_BASE,
    token,
    workspaceId,
    sessionId,
    workspacePath: auth.workspace.path,
  });
  console.error(`[qin-doc-writer] session=${sessionId}`);
  console.error(`[qin-doc-writer] profile=${JSON.stringify(sessionProfile)}`);

  const uploaded = [];
  for (const path of DOCS) {
    console.error(`[qin-doc-writer] uploading=${basename(path)}`);
    const uploadedName = await uploadDocument({ token, workspaceId, sessionId, localPath: path });
    uploaded.push(uploadedName);
    console.error(`[qin-doc-writer] uploaded=${uploadedName}`);
  }

  let seenMessageCount = 0;
  const promptRuns = [];

  for (const [index, promptText] of PROMPTS.entries()) {
    const startedAt = Date.now();
    console.error(`[qin-doc-writer] prompt_start=${index + 1}/${PROMPTS.length}`);
    const settle = await waitForSessionSettled(
      client,
      sessionId,
      () =>
        client.session.promptAsync({
          sessionID: sessionId,
          agent: "document-writer",
          model: MODEL,
          parts: [{ type: "text", text: promptText }],
        }),
    );
    const elapsedMs = Date.now() - startedAt;
    const messages = await client.session.messages({ sessionID: sessionId, limit: 400 });
    const freshMessages = messages.slice(seenMessageCount);
    seenMessageCount = messages.length;
    const docs = await listDocuments({ token, workspaceId, sessionId });
    let outputPreview = "";
    if ((docs.items || []).some((item) => item.name === "outputs/qin-technical-material.md")) {
      outputPreview = await readDocumentText({
        token,
        workspaceId,
        sessionId,
        name: "outputs/qin-technical-material.md",
      });
    }
    console.error(`[qin-doc-writer] prompt_done=${index + 1}/${PROMPTS.length} elapsedMs=${elapsedMs}`);
    promptRuns.push({
      prompt: promptText,
      elapsedMs,
      eventTypes: settle.events,
      toolCounts: countTools(freshMessages),
      taskCalls: extractTaskCalls(freshMessages),
      assistantText: extractText(freshMessages) || extractText(messages),
      docs: docs.items || [],
      outputPreview: outputPreview.slice(0, 4000),
    });
  }

  const finalDocs = await listDocuments({ token, workspaceId, sessionId });
  const finalText = await readDocumentText({
    token,
    workspaceId,
    sessionId,
    name: "outputs/qin-technical-material.md",
  });
  const verifierText = await readDocumentText({
    token,
    workspaceId,
    sessionId,
    name: "reports/doc-verifier/summary.md",
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    sessionId,
    sessionProfile,
    uploaded,
    promptRuns,
    finalDocs: finalDocs.items || [],
    finalText,
    verifierText,
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.error(`[qin-doc-writer] complete session=${sessionId}`);
  console.log(JSON.stringify(payload, null, 2));
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
