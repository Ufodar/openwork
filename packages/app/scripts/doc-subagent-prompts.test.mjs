import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");

test("document-writer entry prompt keeps controller-level phase routing and ownership only", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(prompt).toContain("Phase routing:");
  expect(prompt).toContain("Phase ownership:");
  expect(prompt).toContain("`doc-reader` compiles one source document");
  expect(prompt).toContain("`doc-verifier` owns `.worktree/verify/coverage.json`");
  expect(prompt).not.toContain("extract_doc_state.py");
  expect(prompt).not.toContain("verify_doc_state.py");
  expect(prompt).not.toContain("`.bid/**`");
});

test("document-writer agent entrypoint uses orchestrator-style delegation rules", async () => {
  const agentPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(agentPrompt).toContain("Your job is to keep the control loop coherent");
  expect(agentPrompt).toContain("formal document and multi-document workflow tasks");
  expect(agentPrompt).toContain("正式文档工作流主代理");
  expect(agentPrompt).not.toContain("标书写作助手主代理");
  expect(agentPrompt).not.toContain("bid-writing and formal document work");
  expect(agentPrompt).toContain("call `doc-intake`");
  expect(agentPrompt).toContain("do not delegate document work to `general` or non-`doc-*` agents");
  expect(agentPrompt).toContain("do not edit source documents or the target deliverable yourself");
  expect(agentPrompt).toContain("After `doc-writer`, always call `doc-verifier`");
  expect(agentPrompt).toContain("reuse that exact path");
  expect(agentPrompt).toContain("current user objective");
  expect(agentPrompt).toContain("allowed input files");
  expect(agentPrompt).toContain("required first action");
  expect(agentPrompt).toContain("acceptance criteria");
  expect(agentPrompt).toContain("stop condition");
  expect(agentPrompt).toContain("do not collapse a detailed user objective into a generic paraphrase");
  expect(agentPrompt).toContain("when a later user turn is only a short continuation signal");
  expect(agentPrompt).toContain("exact headings, exact system names, target format, or specific requirements");
  expect(agentPrompt).toContain("carry that wording forward literally into later `doc-*` tasks");
  expect(agentPrompt).toContain("do not invent extra state artifacts, helper reports, or helper scripts");
  expect(agentPrompt).toContain("do not bypass the missing phase");
  expect(agentPrompt).toContain("if a subagent returns partial work, continue from the artifact it produced or relaunch that same subagent");
});

test("document config does not inject doc-state schema globally into every agent lane", async () => {
  for (const configName of ["opencode.json", "opencode.jsonc"]) {
    const config = JSON.parse(await readFile(resolve(root, configName), "utf8"));
    expect(config.instructions ?? []).not.toContain(".opencode/references/doc-state-schema.md");
  }
});

test("document-writer prompt keeps the control loop but drops product and runtime implementation noise", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(prompt).not.toContain("OpenWork");
  expect(prompt).not.toContain("OpenCode");
  expect(prompt).not.toContain("user-facing entrypoint");
  expect(prompt).not.toContain("doc_state_*");
  expect(prompt).not.toContain("extract_doc_state.py");
  expect(prompt).not.toContain("verify_doc_state.py");
  expect(prompt).not.toContain("`.bid/**`");
  expect(prompt).toContain("keep the control loop coherent");
  expect(prompt).toContain("call `doc-intake`");
  expect(prompt).toContain("call `doc-writer`");
  expect(prompt).toContain("call `doc-verifier`");
});

test("doc-state schema stays a file-level reference instead of teaching MCP call sequences", async () => {
  const schema = await readFile(resolve(root, ".opencode/references/doc-state-schema.md"), "utf8");

  expect(schema).toContain("## Canonical state files");
  expect(schema).toContain("## Ownership model");
  expect(schema).not.toContain("doc_state_state_get_brief");
  expect(schema).not.toContain("doc_state_state_get_plan");
  expect(schema).not.toContain("Primary-agent boundary");
  expect(schema).not.toContain("Fallback when the MCP tools are unavailable");
});

test("document-mode bridge stays a thin guardrail instead of a second workflow prompt", async () => {
  const bridge = await readFile(resolve(root, ".opencode/plugins/document-mode-bridge.js"), "utf8");

  expect(bridge).not.toContain("Document mode is active for this workspace because the sampled files look document-heavy");
  expect(bridge).not.toContain("office=${mode.officeCount}");
  expect(bridge).not.toContain("Use writing-plans only");
  expect(bridge).not.toContain("Use systematic-debugging only");
  expect(bridge).not.toContain("Use verification-before-completion only");
  expect(bridge).not.toContain("Do not auto-route to generic brainstorming");
  expect(bridge).toContain("Prefer a readable working surface for binary Office files");
  expect(bridge).toContain("Keep reopenable temp artifacts under \\`<WORKSPACE>/.tmp/system\\`");
  expect(bridge).toContain("run \\`python3 .opencode/references/check_document_delivery.py --target outputs --target reports\\`");
});

test("document-mode bridge does not promote extracted source text as a main-session bootstrap surface", async () => {
  const bridge = await readFile(resolve(root, ".opencode/plugins/document-mode-bridge.js"), "utf8");

  expect(bridge).toContain("\\`.worktree/index.json\\`");
  expect(bridge).toContain("\\`.worktree/sources/manifest.json\\`");
  expect(bridge).toContain("read those narrow control files before doing another broad rediscovery pass");
  expect(bridge).not.toContain("hand control to \\`document-writer\\` early");
});

test("writer and verifier prompts treat user-specified section titles as exact headings", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(writerPrompt).toContain("literal heading contract");
  expect(verifierPrompt).toContain("exact heading contract");
  expect(verifierPrompt).toContain("do not fake verifier outputs");
  expect(entryPrompt).toContain("exact headings, exact names");
  expect(entryPrompt).toContain("do not delegate document work to `general` or non-`doc-*` agents");
  expect(writerPrompt).toContain("real Office document");
  expect(verifierPrompt).toContain("text masquerading as `.docx`");
  expect(entryPrompt).toContain("exact headings, exact system names");
});

test("doc-reader does not allow docx/pdf skills for standard source compilation", async () => {
  const config = JSON.parse(await readFile(resolve(root, "opencode.json"), "utf8"));
  const prompt = await readFile(resolve(root, ".opencode/prompts/doc-reader.md"), "utf8");
  const reader = config.agent?.["doc-reader"] ?? {};
  const skillPermission = config.agent?.["doc-reader"]?.permission?.skill ?? {};

  expect(skillPermission.docx).not.toBe("allow");
  expect(skillPermission.pdf).not.toBe("allow");
  expect(reader.tools?.write).toBeUndefined();
  expect(reader.tools?.edit).toBeUndefined();
  expect(reader.permission?.write).toBeUndefined();
  expect(reader.permission?.edit).toBeUndefined();
  expect(prompt).toContain("resolve the actual extractor path");
  expect(prompt).toContain("./.opencode/runtime-support/document-state/extract_doc_state.py");
  expect(prompt).toContain("do not use `glob`");
  expect(prompt).toContain("do not call `write` or `edit` directly");
  expect(prompt).toContain("return the blocker");
});

test("doc-intake can bootstrap workspace state with bash when direct write permissions are insufficient", async () => {
  const config = JSON.parse(await readFile(resolve(root, "opencode.json"), "utf8"));
  const intakePrompt = await readFile(resolve(root, ".opencode/prompts/doc-intake.md"), "utf8");

  expect(config.agent?.["doc-intake"]?.tools?.bash).toBe(true);
  expect(config.agent?.["doc-intake"]?.permission?.bash).toBe("allow");
  expect(intakePrompt).toContain("init_doc_state.py");
  expect(intakePrompt).toContain("If no init script is available, use `bash`");
  expect(intakePrompt).toContain("Do not write bootstrap artifacts to `/tmp`");
});

test("doc-writer can read runtime state files and write nested outputs in session workspaces", async () => {
  const config = JSON.parse(await readFile(resolve(root, "opencode.json"), "utf8"));
  const readPermission = config.agent?.["doc-writer"]?.permission?.read ?? {};
  const writePermission = config.agent?.["doc-writer"]?.permission?.write ?? {};

  expect(readPermission["**/.worktree/plan/solution-plan.json"]).toBe("allow");
  expect(readPermission[".worktree/facts.json"]).toBe("allow");
  expect(readPermission["**/.worktree/facts.json"]).toBe("allow");
  expect(writePermission["outputs/**"]).toBe("allow");
  expect(writePermission["**/outputs/**"]).toBe("allow");
  expect(config.agent?.["doc-writer"]?.tools?.bash).toBe(true);
  expect(config.agent?.["doc-writer"]?.permission?.bash).toBe("allow");
  expect(config.agent?.["doc-writer"]?.tools?.skill).toBe(false);
  expect(config.agent?.["doc-writer"]?.permission?.skill?.["*"]).toBe("deny");
});

test("doc-planner can reread absolute runtime state paths when refining generated plans", async () => {
  for (const configName of ["opencode.json", "opencode.jsonc"]) {
    const config = JSON.parse(await readFile(resolve(root, configName), "utf8"));
    const readPermission = config.agent?.["doc-planner"]?.permission?.read ?? {};

    expect(readPermission[".worktree/facts.json"]).toBe("allow");
    expect(readPermission["**/.worktree/facts.json"]).toBe("allow");
    expect(readPermission[".worktree/coverage.json"]).toBe("allow");
    expect(readPermission["**/.worktree/coverage.json"]).toBe("allow");
    expect(readPermission[".worktree/plan/solution-plan.json"]).toBe("allow");
    expect(readPermission["**/.worktree/plan/solution-plan.json"]).toBe("allow");
  }
});

test("planner and document-writer prompts preserve the machine-readable plan schema", async () => {
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(plannerPrompt).toContain("do not replace the script-emitted section schema");
  expect(plannerPrompt).toContain("custom `system/modules/key_facts` shape");
  expect(plannerPrompt).toContain("preserve `id`, `title`, `required_subsections`, `required_evidence`, and `source_context_refs`");
  expect(entryPrompt).toContain("`doc-planner` owns `.worktree/plan/solution-plan.json` and `.worktree/coverage.json`");
  expect(entryPrompt).toContain("preserve the user's exact systems, headings, and specific requirements");
});

test("doc-writer preserves the official bocha search capability for external supplements", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  for (const configName of ["opencode.json", "opencode.jsonc"]) {
    const config = JSON.parse(await readFile(resolve(root, configName), "utf8"));
    const writer = config.agent?.["doc-writer"] ?? {};
    const bocha = config.mcp?.["bocha-search"] ?? {};

    expect(writer?.tools?.["bocha-search*"]).toBe(true);
    expect(writer?.tools?.["brave-search*"]).toBeUndefined();
    expect(bocha.command).toEqual(["uv", "--directory", "{env:BOCHA_MCP_DIR}", "run", "bocha-search-mcp"]);
    expect(bocha.environment?.BOCHA_API_KEY).toBe("{env:BOCHA_API_KEY}");
  }

  expect(writerPrompt).toContain("external-supplements.md");
  expect(writerPrompt).toContain("record that topic as a blocker");
  expect(writerPrompt).toContain("source titles");
  expect(writerPrompt).toContain("source URLs");
  expect(writerPrompt).toContain("section-level evidence");
  expect(writerPrompt).not.toContain("web_search_fallback.py");
  expect(writerPrompt).not.toContain("if no web-search tool is available but `bash` is allowed");
  expect(entryPrompt).toContain("After `doc-writer`, always call `doc-verifier`");
});

test("doc-* helper prompts require runtime-local script resolution instead of repo-root fallback", async () => {
  const readerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-reader.md"), "utf8");
  const mergerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-merger.md"), "utf8");
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");

  for (const prompt of [
    readerPrompt,
    mergerPrompt,
    plannerPrompt,
    verifierPrompt,
  ]) {
    expect(prompt).toContain('if [ -f "./.opencode/runtime-support/document-state/');
    expect(prompt).not.toContain("git rev-parse --show-toplevel");
    expect(prompt).not.toContain("REPO_ROOT");
    expect(prompt).toContain("do not use `glob`");
  }
});

test("doc-writer avoids reading the full facts store when section evidence is already available", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");

  expect(writerPrompt).toContain("treat `.worktree/facts.json` as a backing store");
  expect(writerPrompt).toContain("when section-level evidence already exists, do not read the whole facts file into context");
  expect(writerPrompt).toContain("required_evidence");
});

test("hidden doc-* prompts prefer owned state surfaces before narrow source rereads", async () => {
  const mergerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-merger.md"), "utf8");
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");

  expect(mergerPrompt).toContain("merge from compiled state artifacts first");
  expect(mergerPrompt).toContain("exact source slice needed");

  expect(plannerPrompt).toContain("do not fall back to rereading `.worktree/sources/*.json` as the default planning surface");
  expect(plannerPrompt).toContain("reopen only the exact artifact(s) needed");

  expect(writerPrompt).toContain("do not fall back to `.worktree/sources/*.json` or raw source documents as the default drafting surface");
  expect(writerPrompt).toContain("reopen only the exact source artifact needed for that claim");

  expect(verifierPrompt).toContain("do not default to reopening `.worktree/sources/*.json` or raw source documents");
  expect(verifierPrompt).toContain("reopen only the exact source artifact needed to confirm the risk");
});

test("document-writer trusts completed doc-* receipts instead of spawning general to reread phase outputs", async () => {
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(entryPrompt).toContain("treat the completed `task` output as the primary receipt surface");
  expect(entryPrompt).toContain("if the receipt is thin or ambiguous, reopen the owning `doc-*` phase");
});

test("document-writer jumps straight from manifest triage into doc-reader instead of exploratory source reads", async () => {
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(entryPrompt).toContain("If the manifest lists sources without `.worktree/sources/<doc-id>.json`, call `doc-reader`");
  expect(entryPrompt).toContain("avoid repeated exploratory source reads in the main session");
  expect(entryPrompt).toContain("If source understanding, evidence, or online supplements are still missing, reopen the owning `doc-*` phase with a narrow supplement task");
});

test("document-writer prompt examples stay generic and planner wording avoids sample-specific labels", async () => {
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(plannerPrompt).not.toContain("Qin-like");
  expect(plannerPrompt).toContain("keep the fallback structure generic");
  expect(entryPrompt).not.toContain("outputs/ly-solution.md");
  expect(entryPrompt).not.toContain(".bid/**");
  expect(entryPrompt).toContain("outputs/final.docx");
});

test("common-work keeps hosted document isolation to a thin workspace-local contract", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("<WORKSPACE>/.tmp/system");
  expect(prompt).toContain("系统临时目录如 `/tmp`、`/private/tmp` 只可视为 shell-local 中转");
  expect(prompt).toContain("workspace 外绝对路径、父目录、repo 根目录或 `external_directory`");
  expect(prompt).toContain("只报告稳定的 workspace 相对路径");
});

test("common-work keeps a stable text-source rule for long-form docx deliverables without over-teaching implementation", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("目标文档较长、需要多轮修订或重新生成");
  expect(prompt).toContain("稳定可编辑源稿");
  expect(prompt).not.toContain("不要直接拼接超长 JS 字符串");
});

test("common-work keeps document routing generic instead of teaching tool catalogs and extractor recipes", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("优先使用该格式的既有能力或 workspace 内的文本副本");
  expect(prompt).not.toContain("不要把 `docx`、`pdf`、`xlsx`、`pptx` 当成必定存在的同名 tool");
  expect(prompt).not.toContain("pandoc <input>.docx -t plain -o <WORKSPACE>/.tmp/system/<name>.txt");
  expect(prompt).not.toContain("不要先手写新的 `extract_docx.py`");
});

test("common-work keeps durable drafts and final deliverables in stable workspace-relative paths", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("durable draft 和最终交付物都应保存在稳定的 workspace 相对路径里");
  expect(prompt).toContain("最终文件如果只存在于 `.tmp`，不算完成");
});

test("common-work keeps long-form workflow escalation high-level instead of hardcoding route mechanics", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("尽早升级到 `document-writer` workflow");
  expect(prompt).toContain("多源材料、正式交付物、多轮修订或显式覆盖验证");
  expect(prompt).toContain("而不是在主会话里自由直写整份长文");
  expect(prompt).not.toContain("通过 `task` 把控制权交给 `document-writer`");
});

test("document-mode bridge does not hardcode long-form document routing heuristics", async () => {
  const bridge = await readFile(resolve(root, ".opencode/plugins/document-mode-bridge.js"), "utf8");

  expect(bridge).not.toContain("long-form, multi-source, formal deliverable");
  expect(bridge).not.toContain("hand control to \\`document-writer\\` early");
  expect(bridge).not.toContain("open-ended \\`bash\\`/\\`glob\\`/\\`read\\` loop");
  expect(bridge).toContain("read those narrow control files before doing another broad rediscovery pass");
});

test("common-work routes relevant factual tasks through attached knowledge before broad discovery", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("如果当前 session 已附加知识库");
  expect(prompt).toContain("优先使用知识检索能力");
  expect(prompt).toContain("不要在这种场景下先做宽泛 workspace 扫描");
});

test("common-work keeps local-source-first and authority-first behavior while avoiding fabricated evidence", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("在读到至少一份本地文档片段之前，不要把联网搜索当成默认下一步");
  expect(prompt).toContain("起草前先识别权威来源和稳定目标文档 `target_doc`");
  expect(prompt).toContain("如果本地资料还无法补齐关键事实缺口");
  expect(prompt).toContain("不要编造事实、引用或数据");
  expect(prompt).toContain("明确记录 blocker");
});

test("common-work forbids broad unfiltered workspace scans before locating real source documents", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("不要使用 `glob **/*`");
  expect(prompt).toContain("不要对整个 workspace 做无过滤的大范围文件扫描");
  expect(prompt).toContain("开始时只做一次轻量发现");
  expect(prompt).toContain("如果候选源文件是 `.docx`、`.xlsx`、`.pptx`、`.pdf` 等二进制文档");
  expect(prompt).toContain("优先进入一个可读的工作面");
});

test("common-work prefers durable state over rediscovery", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("`.worktree/`");
  expect(prompt).toContain("`reports/**`");
  expect(prompt).toContain("优先恢复面，而不是默认重新扫描");
  expect(prompt).toContain("优先沉淀可复用状态，而不是继续依赖会话记忆");
});

test("common-work asks only blocking user questions", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("## When To Ask The User");
  expect(prompt).toContain("`target_doc` 不明确");
  expect(prompt).toContain("权威规则彼此冲突");
  expect(prompt).toContain("一次只问一个真正阻塞的问题");
});

test("common-work is registered as a real primary agent instead of only existing as a UI alias", async () => {
  for (const configName of ["opencode.json", "opencode.jsonc"]) {
    const config = JSON.parse(await readFile(resolve(root, configName), "utf8"));
    const commonWork = config.agent?.["common-work"] ?? {};

    expect(config.permission).toBe("allow");
    expect(commonWork?.mode).toBe("primary");
    expect(commonWork?.prompt).toBe("{file:./.opencode/agent/common-work.md}");
    expect(commonWork?.permission?.task).toBe("allow");
    expect(commonWork?.permission?.bash).toBe("allow");
    expect(commonWork?.permission?.read?.["*"]).toBe("allow");
    expect(commonWork?.permission?.write?.["*"]).toBe("allow");
    expect(commonWork?.permission?.edit?.["*"]).toBe("allow");
  }
});

test("common-work drops product and implementation noise while keeping document strategy", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).not.toContain("OpenWork");
  expect(prompt).not.toContain("OpenCode");
  expect(prompt).not.toContain("hosted 文档 session");
  expect(prompt).not.toContain(".openwork-runtime");
  expect(prompt).not.toContain("`Context7`");
  expect(prompt).not.toContain("`Playwright`");
  expect(prompt).not.toContain("`doc-coauthoring`");
  expect(prompt).not.toContain("pandoc <input>.docx -t plain -o <WORKSPACE>/.tmp/system/<name>.txt");
  expect(prompt).not.toContain("不要把 `docx`、`pdf`、`xlsx`、`pptx` 当成必定存在的同名 tool");
  expect(prompt).toContain("<WORKSPACE>");
  expect(prompt).toContain(".tmp/system");
  expect(prompt).toContain("先读真实材料");
  expect(prompt).toContain("权威来源");
  expect(prompt).toContain("稳定目标文档 `target_doc`");
});

test("common-work explicitly forbids external-directory detours for hosted document sessions", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("workspace 外绝对路径、父目录、repo 根目录或 `external_directory`");
  expect(prompt).toContain("普通文档 I/O 路线");
  expect(prompt).toContain("目标交付物、可恢复状态和后续要重开的文件都留在 `<WORKSPACE>`");
});

test("docx skill steers extraction artifacts into workspace-local temp paths", async () => {
  const skill = await readFile(resolve(root, ".opencode/skills/docx/SKILL.md"), "utf8");

  expect(skill).toContain(".tmp/docx-read");
  expect(skill).toContain("Never write extraction output to `/tmp`");
  expect(skill).toContain("copy it back into `.tmp/docx-read/`");
  expect(skill).toContain("Do not pass `/tmp` extraction paths back into file tools");
  expect(skill).toContain("pandoc --track-changes=all document.docx -o .tmp/docx-read/document.md");
  expect(skill).toContain("Prefer Markdown -> Pandoc For Long Narrative Docs");
  expect(skill).toContain("pandoc reports/docx-draft/draft.md -o outputs/final.docx");
});

test("writer and verifier prompts require a durable external supplement report when web research is requested", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");

  expect(writerPrompt).toContain("reports/doc-writer/external-supplements.md");
  expect(writerPrompt).toContain("query terms");
  expect(writerPrompt).toContain("source URLs");
  expect(writerPrompt).toContain("surface consumed references");
  expect(writerPrompt).toContain("prefer authoritative sources");
  expect(verifierPrompt).toContain("external-supplements.md");
  expect(verifierPrompt).toContain("requested external support");
  expect(verifierPrompt).toContain("if consumed supplements exist but the deliverable still uses placeholder language instead of concrete citations");
});

test("merger and planner no longer hide sample-specific topic or noise heuristics inside prompts", async () => {
  const mergerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-merger.md"), "utf8");
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");

  expect(mergerPrompt).toContain("do not turn this helper into a hidden task classifier");
  expect(plannerPrompt).toContain("treat it as the canonical section contract");
  expect(plannerPrompt).toContain("keep the fallback structure generic");
  expect(plannerPrompt).not.toContain("named systems are the primary section contract");
});

test("document-writer entry agent has orchestrator task and doc_state permissions", async () => {
  const agentPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  for (const configName of ["opencode.json", "opencode.jsonc"]) {
    const config = JSON.parse(await readFile(resolve(root, configName), "utf8"));
    const writer = config.agent?.["document-writer"] ?? {};
    const orchestrator = config.agent?.["doc-orchestrator"];

    expect(writer?.tools?.task).toBe(true);
    expect(writer?.tools?.["doc_state_*"]).toBe(true);
    expect(writer?.tools?.list).toBeUndefined();
    expect(writer?.tools?.glob).toBeUndefined();
    expect(writer?.tools?.todoread).toBeUndefined();
    expect(writer?.tools?.todowrite).toBeUndefined();
    expect(writer?.permission?.task?.["*"]).toBe("deny");
    expect(writer?.permission?.task?.["doc-*"]).toBe("allow");
    expect(writer?.permission?.bash).toBe("deny");
    expect(writer?.permission?.read?.[".worktree/index.json"]).toBe("allow");
    expect(writer?.permission?.glob).toBeUndefined();
    expect(orchestrator).toBeUndefined();
  }

  expect(agentPrompt).toContain("If `.worktree/index.json` is missing or has no `task_model`, call `doc-intake`");
  expect(agentPrompt).toContain("do not begin a fresh turn with broad glob or workspace-wide reads");
  expect(agentPrompt).toContain("do not maintain a todo list in the main session");
  expect(agentPrompt).toContain("avoid repeated exploratory source reads in the main session");
  expect(agentPrompt).toContain("let the child choose its readable working surface");
  expect(agentPrompt).toContain("when calling `task`, always provide `description`, `subagent_type`, and `prompt`");
  expect(agentPrompt).toContain("Delegation contract:");
});

test("doc-verifier can execute the verification script directly", async () => {
  for (const configName of ["opencode.json", "opencode.jsonc"]) {
    const config = JSON.parse(await readFile(resolve(root, configName), "utf8"));
    const verifier = config.agent?.["doc-verifier"];

    expect(verifier?.tools?.bash).toBe(true);
    expect(verifier?.tools?.list).toBeUndefined();
    expect(verifier?.tools?.glob).toBeUndefined();
    expect(verifier?.permission?.bash).toBe("allow");
    expect(verifier?.permission?.list).toBeUndefined();
    expect(verifier?.permission?.glob).toBeUndefined();
  }
});
