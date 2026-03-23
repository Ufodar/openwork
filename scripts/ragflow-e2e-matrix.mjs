#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = process.env.OPENWORK_BASE_URL?.trim() || "http://192.168.5.10:32765/openwork";
const username = process.env.OPENWORK_USERNAME?.trim() || "fuda";
const password = process.env.OPENWORK_PASSWORD?.trim() || "1";
const otherUsername = process.env.OPENWORK_OTHER_USERNAME?.trim() || "kbshare0323";
const otherPassword = process.env.OPENWORK_OTHER_PASSWORD?.trim() || "1";
const reportPath =
  process.env.RAGFLOW_MATRIX_REPORT?.trim() ||
  path.join(os.tmpdir(), "openwork-ragflow", `matrix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const freshDocPath =
  process.env.RAGFLOW_FRESH_DOC?.trim() ||
  "/Users/storm/Pictures/开发参考文件/智能纪要：新录音 92 2026年2月13日.docx";
const ownProductPath =
  process.env.RAGFLOW_OWN_PRODUCT_DOC?.trim() ||
  "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/产品信息/设备型号.xlsx";
const otherProductPath =
  process.env.RAGFLOW_OTHER_PRODUCT_DOC?.trim() ||
  "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件/智能员工资料/wjw项目伙伴/产品信息/奇安信/第一包技术供应商提供-奇安信.docx";

function nowStamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function normalizedComparableText(value) {
  return String(value ?? "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function summarizeToolBehavior(summary) {
  const toolNames = summary.tools.map((tool) => String(tool.tool));
  const knowledgeSearchCount = toolNames.filter((tool) => tool.includes("openwork_knowledge_search")).length;
  const knowledgeListCount = toolNames.filter((tool) => tool.includes("openwork_knowledge_list_attached")).length;
  const memoryToolCount = toolNames.filter((tool) => tool.includes("memory_")).length;
  const readSearchToolCount = toolNames.filter((tool) =>
    ["grep", "glob", "read", "bash", "find"].some((prefix) => tool === prefix || tool.startsWith(`${prefix}:`))
  ).length;
  return {
    toolNames,
    knowledgeSearchCount,
    knowledgeListCount,
    memoryToolCount,
    readSearchToolCount,
  };
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

async function login(loginUsername, loginPassword) {
  return req("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: loginUsername, password: loginPassword }),
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

async function waitKnowledgeVisible(token, workspaceId, knowledgeId, scope = "mine", timeoutMs = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const listing = await listKnowledge(token, workspaceId, scope);
    const item = listing.items.find((entry) => entry.knowledgeId === knowledgeId);
    if (item) return item;
    await sleep(3000);
  }
  throw new Error(`knowledge ${knowledgeId} did not become visible in ${scope} within ${timeoutMs}ms`);
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

async function provisionKnowledge(auth, { title, description, filePath, readyScope = "mine" }) {
  const created = await createKnowledge(auth.token, auth.workspace.id, title, description);
  await uploadKnowledgeDoc(auth.token, auth.workspace.id, created.item.knowledgeId, filePath);
  const readyItem = await waitKnowledgeReady(auth.token, auth.workspace.id, created.item.knowledgeId, readyScope);
  return {
    created: created.item,
    ready: readyItem,
    filePath,
  };
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
  return req(`/w/${encodeURIComponent(workspaceId)}/opencode/session/${encodeURIComponent(sessionId)}/message?limit=200`, {
    token,
  });
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

function evaluateScenario(
  summary,
  {
    expectedIncludes = [],
    expectedExcludes = [],
    expectKnowledgeSearch = null,
    expectListAttached = null,
    expectNoMemoryTools = true,
  } = {},
) {
  const behavior = summarizeToolBehavior(summary);
  const normalizedAnswer = normalizedComparableText(summary.answer);
  const normalizedIncludes = expectedIncludes.map((value) => normalizedComparableText(value));
  const normalizedExcludes = expectedExcludes.map((value) => normalizedComparableText(value));
  const assertions = {
    includes: normalizedIncludes.every((value) => normalizedAnswer.includes(value)),
    excludes: normalizedExcludes.every((value) => !normalizedAnswer.includes(value)),
    knowledgeSearch:
      expectKnowledgeSearch === null
        ? true
        : expectKnowledgeSearch
          ? behavior.knowledgeSearchCount > 0
          : behavior.knowledgeSearchCount === 0,
    listAttached:
      expectListAttached === null
        ? true
        : expectListAttached
          ? behavior.knowledgeListCount > 0
          : behavior.knowledgeListCount === 0,
    noMemoryTools: expectNoMemoryTools ? behavior.memoryToolCount === 0 : true,
  };
  return {
    answer: summary.answer,
    normalizedAnswer,
    tools: summary.tools.map((tool) => ({
      tool: tool.tool,
      input: tool.input,
    })),
    reasoning: summary.reasoning,
    behavior,
    assertions,
    passed: Object.values(assertions).every(Boolean),
  };
}

async function runScenario(token, workspaceId, config) {
  const session = await createSession(token, workspaceId, config.title);
  await attachKnowledge(token, workspaceId, session.id, config.knowledgeIds ?? []);
  await promptAsync(token, workspaceId, session.id, config.prompt);
  const { summary } = await waitPromptResult(token, workspaceId, session.id, config.prompt, config.timeoutMs);
  return {
    sessionId: session.id,
    knowledgeIds: config.knowledgeIds ?? [],
    prompt: config.prompt,
    ...evaluateScenario(summary, config),
  };
}

async function runPromptOnExistingSession(token, workspaceId, sessionId, prompt, evaluation) {
  await promptAsync(token, workspaceId, sessionId, prompt);
  const { summary } = await waitPromptResult(token, workspaceId, sessionId, prompt);
  return {
    prompt,
    ...evaluateScenario(summary, evaluation),
  };
}

async function main() {
  const stamp = nowStamp();
  const primaryAuth = await login(username, password);
  const otherAuth = await login(otherUsername, otherPassword);

  const workspaceId = primaryAuth.workspace.id;

  const freshKnowledge = await provisionKnowledge(primaryAuth, {
    title: `智能纪要验收-${stamp}`,
    description: "真实 docx 上传解析验收",
    filePath: freshDocPath,
  });
  const ownKnowledge = await provisionKnowledge(primaryAuth, {
    title: `海滨医院交换机验收-${stamp}`,
    description: "真实 xlsx 上传解析验收",
    filePath: ownProductPath,
  });
  const otherKnowledgeOwner = await provisionKnowledge(otherAuth, {
    title: `共享奇安信验收-${stamp}`,
    description: "第二用户共享知识库验收",
    filePath: otherProductPath,
  });
  await waitKnowledgeVisible(primaryAuth.token, workspaceId, otherKnowledgeOwner.ready.knowledgeId, "others");
  const otherKnowledgeReady = await waitKnowledgeReady(
    primaryAuth.token,
    workspaceId,
    otherKnowledgeOwner.ready.knowledgeId,
    "others",
  );

  const mineListing = await listKnowledge(primaryAuth.token, workspaceId, "mine");
  const othersListing = await listKnowledge(primaryAuth.token, workspaceId, "others");

  const results = {};
  results.catalog_visibility = {
    mineHasFresh: mineListing.items.some((item) => item.knowledgeId === freshKnowledge.ready.knowledgeId),
    mineHasOwn: mineListing.items.some((item) => item.knowledgeId === ownKnowledge.ready.knowledgeId),
    othersHasShared: othersListing.items.some((item) => item.knowledgeId === otherKnowledgeReady.knowledgeId),
    otherOwnerDisplayName: otherKnowledgeReady.ownerDisplayName,
    passed:
      mineListing.items.some((item) => item.knowledgeId === freshKnowledge.ready.knowledgeId) &&
      mineListing.items.some((item) => item.knowledgeId === ownKnowledge.ready.knowledgeId) &&
      othersListing.items.some((item) => item.knowledgeId === otherKnowledgeReady.knowledgeId),
  };

  results.fresh_build_chain = await runScenario(primaryAuth.token, workspaceId, {
    title: `矩阵-新建知识库-${stamp}`,
    knowledgeIds: [freshKnowledge.ready.knowledgeId],
    prompt: "依据当前已挂载的知识库，会议主题是什么？只回答主题。",
    expectedIncludes: ["新录音 92"],
    expectKnowledgeSearch: true,
  });

  results.own = await runScenario(primaryAuth.token, workspaceId, {
    title: `矩阵-own-${stamp}`,
    knowledgeIds: [ownKnowledge.ready.knowledgeId],
    prompt: "依据当前已挂载的知识库，海滨医院的交换机型号有哪些？只列型号，不要解释。",
    expectedIncludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
    expectKnowledgeSearch: true,
  });

  results.none = await runScenario(primaryAuth.token, workspaceId, {
    title: `矩阵-none-${stamp}`,
    knowledgeIds: [],
    prompt: "依据当前已挂载的知识库，海滨医院的交换机型号有哪些？只列型号，不要解释。",
    expectedIncludes: ["没有挂载知识库"],
    expectedExcludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
    expectKnowledgeSearch: false,
  });

  results.wrong = await runScenario(primaryAuth.token, workspaceId, {
    title: `矩阵-wrong-${stamp}`,
    knowledgeIds: [freshKnowledge.ready.knowledgeId],
    prompt: "依据当前已挂载的知识库，海滨医院的交换机型号有哪些？只列型号，不要解释。",
    expectedExcludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
    expectKnowledgeSearch: true,
  });

  results.other = await runScenario(primaryAuth.token, workspaceId, {
    title: `矩阵-other-${stamp}`,
    knowledgeIds: [otherKnowledgeReady.knowledgeId],
    prompt: "依据当前已挂载的知识库，产品名称和规格型号分别是什么？按“产品名称：...；规格型号：...”输出。",
    expectedIncludes: ["奇安信可信浏览器软件(密码模块)", "WS-KXLLO-GM-FL V1.0"],
    expectKnowledgeSearch: true,
  });

  const multiSession = await createSession(primaryAuth.token, workspaceId, `矩阵-multi-${stamp}`);
  await attachKnowledge(primaryAuth.token, workspaceId, multiSession.id, [ownKnowledge.ready.knowledgeId]);
  const turn1Prompt = "依据当前已挂载的知识库，海滨医院的交换机型号有哪些？只列型号，不要解释。";
  const turn1 = await runPromptOnExistingSession(primaryAuth.token, workspaceId, multiSession.id, turn1Prompt, {
    expectedIncludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
    expectKnowledgeSearch: true,
  });
  const turn2Prompt = "继续依据当前已挂载的知识库，高新区人民医院的交换机型号有哪些？只列型号，不要解释。";
  const turn2 = await runPromptOnExistingSession(primaryAuth.token, workspaceId, multiSession.id, turn2Prompt, {
    expectKnowledgeSearch: true,
  });
  results.multi_turn = {
    sessionId: multiSession.id,
    turn1,
    turn2,
    passed: turn1.passed && turn2.passed,
  };

  const switchSession = await createSession(primaryAuth.token, workspaceId, `矩阵-switch-${stamp}`);
  await attachKnowledge(primaryAuth.token, workspaceId, switchSession.id, [ownKnowledge.ready.knowledgeId]);
  const ownTurn = await runPromptOnExistingSession(
    primaryAuth.token,
    workspaceId,
    switchSession.id,
    "依据当前已挂载的知识库，海滨医院的交换机型号有哪些？只列型号，不要解释。",
    {
      expectedIncludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
      expectKnowledgeSearch: true,
    },
  );
  await attachKnowledge(primaryAuth.token, workspaceId, switchSession.id, [otherKnowledgeReady.knowledgeId]);
  const otherTurn = await runPromptOnExistingSession(
    primaryAuth.token,
    workspaceId,
    switchSession.id,
    "继续依据当前已挂载的知识库，产品名称和规格型号分别是什么？按“产品名称：...；规格型号：...”输出。",
    {
      expectedIncludes: ["奇安信可信浏览器软件(密码模块)", "WS-KXLLO-GM-FL V1.0"],
      expectKnowledgeSearch: true,
    },
  );
  await attachKnowledge(primaryAuth.token, workspaceId, switchSession.id, []);
  const clearedTurn = await runPromptOnExistingSession(
    primaryAuth.token,
    workspaceId,
    switchSession.id,
    "继续依据当前已挂载的知识库，海滨医院的防火墙型号是什么？只列型号，不要解释。",
    {
      expectedIncludes: ["没有挂载知识库"],
      expectedExcludes: ["CE6855-48XS8CQ", "S5755-H24T4Y2CZ"],
      expectKnowledgeSearch: false,
    },
  );
  results.switch_session = {
    sessionId: switchSession.id,
    ownTurn,
    otherTurn,
    clearedTurn,
    passed: ownTurn.passed && otherTurn.passed && clearedTurn.passed,
  };

  const allPass = Object.values(results).every((value) => {
    if (value && typeof value === "object" && "passed" in value) return Boolean(value.passed);
    return true;
  });

  const report = {
    generatedAt: new Date().toISOString(),
    base,
    workspaceId,
    users: {
      primary: username,
      sharedOwner: otherUsername,
    },
    artifacts: {
      freshKnowledge: {
        knowledgeId: freshKnowledge.ready.knowledgeId,
        title: freshKnowledge.ready.title,
        sourcePath: freshKnowledge.filePath,
        status: freshKnowledge.ready.status,
        documentCount: freshKnowledge.ready.documentCount,
        chunkCount: freshKnowledge.ready.chunkCount,
      },
      ownKnowledge: {
        knowledgeId: ownKnowledge.ready.knowledgeId,
        title: ownKnowledge.ready.title,
        sourcePath: ownKnowledge.filePath,
        status: ownKnowledge.ready.status,
        documentCount: ownKnowledge.ready.documentCount,
        chunkCount: ownKnowledge.ready.chunkCount,
      },
      otherKnowledge: {
        knowledgeId: otherKnowledgeReady.knowledgeId,
        title: otherKnowledgeReady.title,
        sourcePath: otherKnowledgeOwner.filePath,
        ownerDisplayName: otherKnowledgeReady.ownerDisplayName,
        status: otherKnowledgeReady.status,
        documentCount: otherKnowledgeReady.documentCount,
        chunkCount: otherKnowledgeReady.chunkCount,
      },
    },
    results,
    passed: allPass,
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
