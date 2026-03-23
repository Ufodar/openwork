#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = process.env.OPENWORK_BASE_URL?.trim() || "http://192.168.5.10:32765/openwork";
const username = process.env.OPENWORK_USERNAME?.trim() || "fuda";
const password = process.env.OPENWORK_PASSWORD?.trim() || "1";
const reportPath =
  process.env.RAGFLOW_MATRIX_REPORT?.trim() ||
  path.join(os.tmpdir(), "openwork-ragflow", `matrix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const freshDocPath =
  process.env.RAGFLOW_FRESH_DOC?.trim() ||
  "/Users/storm/Pictures/开发参考文件/智能纪要：新录音 92 2026年2月13日.docx";

function nowStamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

async function req(requestPath, { token, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${base}${requestPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body,
  });
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok) {
    throw new Error(`${method} ${requestPath} -> ${response.status} ${raw}`);
  }
  return data;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function login() {
  return req("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

async function listKnowledge(token, workspaceId, scope) {
  return req(`/workspace/${encodeURIComponent(workspaceId)}/knowledge?scope=${scope}`, { token });
}

async function createKnowledge(token, workspaceId, title, description = "") {
  return req(`/workspace/${encodeURIComponent(workspaceId)}/knowledge`, {
    token,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description }),
  });
}

async function uploadKnowledgeDoc(token, workspaceId, knowledgeId, filePath) {
  const form = new FormData();
  const buffer = fs.readFileSync(filePath);
  form.set("file", new Blob([buffer]), path.basename(filePath));
  return req(`/workspace/${encodeURIComponent(workspaceId)}/knowledge/${encodeURIComponent(knowledgeId)}/documents`, {
    token,
    method: "POST",
    body: form,
  });
}

async function waitKnowledgeReady(token, workspaceId, knowledgeId, scope = "mine", timeoutMs = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const listing = await listKnowledge(token, workspaceId, scope);
    const item = listing.items.find((entry) => entry.knowledgeId === knowledgeId);
    if (item?.status === "ready") return item;
    await sleep(3000);
  }
  throw new Error(`knowledge ${knowledgeId} did not become ready within ${timeoutMs}ms`);
}

async function createSession(token, workspaceId, title) {
  return req(`/w/${encodeURIComponent(workspaceId)}/opencode/session`, {
    token,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

async function attachKnowledge(token, workspaceId, sessionId, knowledgeIds) {
  return req(`/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/knowledge`, {
    token,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ knowledgeIds }),
  });
}

async function promptAsync(token, workspaceId, sessionId, text) {
  return req(`/w/${encodeURIComponent(workspaceId)}/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`, {
    token,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [{ type: "text", text }] }),
  });
}

async function getMessages(token, workspaceId, sessionId) {
  return req(`/w/${encodeURIComponent(workspaceId)}/opencode/session/${encodeURIComponent(sessionId)}/message?limit=200`, { token });
}

function summarizePrompt(messages, promptText) {
  const userIndex = messages.findIndex(
    (message) =>
      message.info?.role === "user" &&
      (message.parts || []).some((part) => part.type === "text" && part.text === promptText),
  );
  if (userIndex < 0) return null;
  const following = messages.slice(userIndex + 1);
  const relevant = [];
  for (const message of following) {
    if (message.info?.role !== "assistant") continue;
    relevant.push(message);
    if (message.info?.finish === "stop") break;
  }
  if (!relevant.length) return null;
  const tools = [];
  const reasoning = [];
  const texts = [];
  for (const message of relevant) {
    for (const part of message.parts || []) {
      if (part.type === "tool") {
        tools.push({
          tool: part.tool,
          status: part.state?.status ?? null,
          input: part.state?.input ?? null,
          output:
            typeof part.state?.output === "string"
              ? part.state.output
              : JSON.stringify(part.state?.output ?? null),
        });
      } else if (part.type === "reasoning" && part.text) {
        reasoning.push(part.text);
      } else if (part.type === "text" && part.text) {
        texts.push(part.text);
      }
    }
  }
  return {
    tools,
    reasoning,
    answer: texts.join("\n").trim(),
  };
}

async function waitPromptResult(token, workspaceId, sessionId, promptText, timeoutMs = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const messages = await getMessages(token, workspaceId, sessionId);
    const summary = summarizePrompt(messages, promptText);
    if (summary?.answer) return { summary, messages };
    await sleep(3000);
  }
  throw new Error(`prompt did not complete within ${timeoutMs}ms: ${promptText}`);
}

function evaluateScenario(summary, { expectedIncludes = [], expectedExcludes = [], expectKnowledgeTool = null } = {}) {
  const toolNames = summary.tools.map((tool) => String(tool.tool));
  const assertions = {
    includes: expectedIncludes.every((value) => summary.answer.includes(value)),
    excludes: expectedExcludes.every((value) => !summary.answer.includes(value)),
    knowledgeTool:
      expectKnowledgeTool === null
        ? true
        : expectKnowledgeTool
          ? toolNames.some((tool) => tool.includes("openwork_knowledge_search"))
          : !toolNames.some((tool) => tool.includes("openwork_knowledge_search")),
  };
  return {
    answer: summary.answer,
    tools: summary.tools.map((tool) => ({
      tool: tool.tool,
      input: tool.input,
    })),
    reasoning: summary.reasoning,
    assertions,
    passed: Object.values(assertions).every(Boolean),
  };
}

async function runScenario(token, workspaceId, config) {
  const session = await createSession(token, workspaceId, config.title);
  if (config.knowledgeIds?.length) {
    await attachKnowledge(token, workspaceId, session.id, config.knowledgeIds);
  }
  await promptAsync(token, workspaceId, session.id, config.prompt);
  const { summary } = await waitPromptResult(token, workspaceId, session.id, config.prompt, config.timeoutMs);
  return {
    sessionId: session.id,
    knowledgeIds: config.knowledgeIds ?? [],
    prompt: config.prompt,
    ...evaluateScenario(summary, config),
  };
}

async function main() {
  const stamp = nowStamp();
  const auth = await login();
  const token = auth.token;
  const workspaceId = auth.workspace.id;

  const [mine, others] = await Promise.all([
    listKnowledge(token, workspaceId, "mine"),
    listKnowledge(token, workspaceId, "others"),
  ]);

  const ownKb = mine.items.find((item) => item.title === "wjw产品信息验收-0323");
  const wrongKb = mine.items.find((item) => item.title === "TLS流程验收-20260323-1215");
  const otherKb = others.items.find((item) => item.title === "kbshare-奇安信-0323");
  if (!ownKb || !wrongKb || !otherKb) {
    throw new Error("required knowledge bases are missing");
  }

  const freshTitle = `智能纪要验收-${stamp}`;
  const freshCreated = await createKnowledge(token, workspaceId, freshTitle, "真实 docx 上传解析验收");
  await uploadKnowledgeDoc(token, workspaceId, freshCreated.item.knowledgeId, freshDocPath);
  const freshReady = await waitKnowledgeReady(token, workspaceId, freshCreated.item.knowledgeId);

  const results = {};
  results.fresh_build_chain = await runScenario(token, workspaceId, {
    title: `矩阵-新建知识库-${stamp}`,
    knowledgeIds: [freshReady.knowledgeId],
    prompt: "依据当前已挂载的知识库，会议主题是什么？只回答主题。",
    expectedIncludes: ["新录音 92"],
    expectKnowledgeTool: true,
  });
  results.own = await runScenario(token, workspaceId, {
    title: `矩阵-own-${stamp}`,
    knowledgeIds: [ownKb.knowledgeId],
    prompt: "依据当前已挂载的知识库，海滨医院的交换机型号有哪些？只列型号，不要解释。",
    expectedIncludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
    expectKnowledgeTool: true,
  });
  results.none = await runScenario(token, workspaceId, {
    title: `矩阵-none-${stamp}`,
    knowledgeIds: [],
    prompt: "依据当前已挂载的知识库，海滨医院的交换机型号有哪些？只列型号，不要解释。",
    expectedExcludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
    expectKnowledgeTool: false,
  });
  results.wrong = await runScenario(token, workspaceId, {
    title: `矩阵-wrong-${stamp}`,
    knowledgeIds: [wrongKb.knowledgeId],
    prompt: "依据当前已挂载的知识库，海滨医院的交换机型号有哪些？只列型号，不要解释。",
    expectedExcludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
    expectKnowledgeTool: true,
  });
  results.other = await runScenario(token, workspaceId, {
    title: `矩阵-other-${stamp}`,
    knowledgeIds: [otherKb.knowledgeId],
    prompt: "依据当前已挂载的知识库，产品名称和规格型号分别是什么？按“产品名称：...；规格型号：...”输出。",
    expectedIncludes: ["奇安信可信浏览器软件(密码模块)", "WS-KXLLO-GM-FL V1.0"],
    expectKnowledgeTool: true,
  });

  const multiSession = await createSession(token, workspaceId, `矩阵-multi-${stamp}`);
  await attachKnowledge(token, workspaceId, multiSession.id, [ownKb.knowledgeId]);
  const turn1Prompt = "依据当前已挂载的知识库，海滨医院的交换机型号有哪些？只列型号，不要解释。";
  await promptAsync(token, workspaceId, multiSession.id, turn1Prompt);
  const turn1 = await waitPromptResult(token, workspaceId, multiSession.id, turn1Prompt);
  const turn2Prompt = "继续依据当前已挂载的知识库，高新区人民医院的交换机型号有哪些？只列型号，不要解释。";
  await promptAsync(token, workspaceId, multiSession.id, turn2Prompt);
  const turn2 = await waitPromptResult(token, workspaceId, multiSession.id, turn2Prompt);
  results.multi_turn = {
    sessionId: multiSession.id,
    turn1: evaluateScenario(turn1.summary, {
      expectedIncludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
      expectKnowledgeTool: true,
    }),
    turn2: evaluateScenario(turn2.summary, {
      expectKnowledgeTool: true,
    }),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    base,
    workspaceId,
    freshKnowledge: {
      knowledgeId: freshReady.knowledgeId,
      title: freshReady.title,
      status: freshReady.status,
      documentCount: freshReady.documentCount,
      chunkCount: freshReady.chunkCount,
    },
    results,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.log(`REPORT_PATH=${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
