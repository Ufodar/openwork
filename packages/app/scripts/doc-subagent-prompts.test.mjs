import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");

test("doc-orchestrator reader tasks are anchored on the deterministic extractor command", async () => {
  const prompt = await readFile(resolve(root, ".opencode/prompts/doc-orchestrator.md"), "utf8");

  expect(prompt).toContain("extract_doc_state.py");
  expect(prompt).toContain("verify_doc_state.py");
  expect(prompt).toContain("git rev-parse --show-toplevel");
  expect(prompt).toContain("SCRIPT_PATH");
  expect(prompt).toContain("--doc-id");
  expect(prompt).toContain("--output");
  expect(prompt).toContain("Do not ask `doc-reader` to use the `docx` or `pdf` skills");
});

test("document-writer agent entrypoint uses orchestrator-style delegation rules", async () => {
  const agentPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(agentPrompt).toContain("Your job is to keep the control loop coherent");
  expect(agentPrompt).toContain("call `doc-intake`");
  expect(agentPrompt).toContain("do not call non-`doc-*` agents");
  expect(agentPrompt).toContain("do not edit source documents or the target deliverable yourself");
  expect(agentPrompt).toContain("do not use the `docx` or `pdf` skills in the main session");
  expect(agentPrompt).toContain("do not call `glob **/*`");
  expect(agentPrompt).toContain("do not stop the control loop there; immediately run `doc-verifier`");
  expect(agentPrompt).toContain("do not invent brand-specific");
  expect(agentPrompt).toContain("reuse that exact path");
  expect(agentPrompt).toContain("do not send a free-form summary prompt");
  expect(agentPrompt).toContain("Current user objective");
  expect(agentPrompt).toContain("`允许的输入文件`");
  expect(agentPrompt).toContain("`必需的首要动作`");
  expect(agentPrompt).toContain("`验收标准`");
  expect(agentPrompt).toContain("`停止条件`");
  expect(agentPrompt).toContain("do not collapse a detailed user objective into a generic paraphrase");
  expect(agentPrompt).toContain("when a later user turn is only `继续`");
  expect(agentPrompt).toContain("never reference a repo helper that does not exist");
  expect(agentPrompt).toContain("`init_doc_state.py`, `extract_doc_state.py`, `merge_doc_state.py`, `plan_doc_state.py`, and `verify_doc_state.py`");
  expect(agentPrompt).toContain("never invent `.worktree/merge/gap-analysis.json`, `create_workspace_index.py`");
  expect(agentPrompt).toContain("never tell `doc-reader` to fall back to `docx` / `pdf` skills");
  expect(agentPrompt).toContain("keep that requirement alive in planner, writer, and verifier tasks");
  expect(agentPrompt).toContain("do not rename them to placeholders like `系统一/系统二/系统三`");
  expect(agentPrompt).toContain("must stay under `reports/doc-writer/**` or `reports/docx-draft/**`");
  expect(agentPrompt).toContain("do not drop the external-support requirement from verifier");
  expect(agentPrompt).toContain("do not ask `doc-merger` to create `.worktree/merge/gap-analysis.json`");
});

test("writer and verifier prompts treat user-specified section titles as exact headings", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");
  const orchestratorPrompt = await readFile(resolve(root, ".opencode/prompts/doc-orchestrator.md"), "utf8");

  expect(writerPrompt).toContain("literal heading contract");
  expect(writerPrompt).toContain("do not invent helper scripts");
  expect(writerPrompt).toContain("run `verify_doc_state.py` or write verifier-owned artifacts");
  expect(verifierPrompt).toContain("exact heading contract");
  expect(verifierPrompt).toContain("execute that verification command directly");
  expect(verifierPrompt).toContain("do not fake verifier outputs");
  expect(orchestratorPrompt).toContain("literal output headings");
  expect(orchestratorPrompt).toContain("do not tell `doc-writer` to \"follow the plan titles\"");
  expect(orchestratorPrompt).toContain("do not invent helper scripts for coverage refresh");
  expect(orchestratorPrompt).toContain("split that into two subagent calls");
  expect(orchestratorPrompt).toContain("If `doc-verifier` reports missing sections");
  expect(orchestratorPrompt).toContain("title mismatch is a failure");
  expect(orchestratorPrompt).toContain("do not call non-`doc-*` agents");
  expect(writerPrompt).toContain("do not pad proposal-style technical materials with unrelated commercial");
  expect(writerPrompt).toContain("do not satisfy that requirement by leaving only a TODO-style");
  expect(writerPrompt).toContain("real Office document");
  expect(writerPrompt).toContain("Do not leave generator source code in the target `.docx` path");
  expect(writerPrompt).toContain("prefer a Markdown staging draft plus `pandoc <draft>.md -o <target>.docx`");
  expect(verifierPrompt).toContain("text masquerading as `.docx`");
});

test("doc-reader does not allow docx/pdf skills for standard source compilation", async () => {
  const config = JSON.parse(await readFile(resolve(root, "opencode.json"), "utf8"));
  const prompt = await readFile(resolve(root, ".opencode/prompts/doc-reader.md"), "utf8");
  const skillPermission = config.agent?.["doc-reader"]?.permission?.skill ?? {};

  expect(skillPermission.docx).not.toBe("allow");
  expect(skillPermission.pdf).not.toBe("allow");
  expect(prompt).toContain("resolve the actual extractor path");
  expect(prompt).toContain("git rev-parse --show-toplevel");
  expect(prompt).toContain("REPO_ROOT");
  expect(prompt).toContain("do not use `glob`");
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

test("planner and orchestrator prompts preserve the machine-readable plan schema", async () => {
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");
  const orchestratorPrompt = await readFile(resolve(root, ".opencode/prompts/doc-orchestrator.md"), "utf8");
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(plannerPrompt).toContain("do not replace the script-emitted section schema");
  expect(plannerPrompt).toContain("custom `system/modules/key_facts` shape");
  expect(plannerPrompt).toContain("preserve `id`, `title`, `required_subsections`, `required_evidence`, and `source_context_refs`");
  expect(orchestratorPrompt).toContain("If a proposal-style plan is missing section titles");
  expect(orchestratorPrompt).toContain("treat the plan as invalid or stale and rerun `doc-planner`");
  expect(entryPrompt).toContain("If a proposal-style plan is missing section titles");
  expect(entryPrompt).toContain("do not send that malformed plan straight to `doc-writer`");
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

  expect(writerPrompt).toContain("bocha-search");
  expect(writerPrompt).toContain("retry once with a narrower query");
  expect(writerPrompt).toContain("record that topic as a blocker");
  expect(writerPrompt).toContain("do not invent source titles");
  expect(writerPrompt).toContain("do not invent URLs");
  expect(writerPrompt).toContain("returns mostly reposts");
  expect(writerPrompt).toContain("at least one higher-authority source");
  expect(writerPrompt).toContain("mirror-hosted");
  expect(writerPrompt).toContain("issuing body domain");
  expect(writerPrompt).toContain("do not use that mirrored URL as the authority anchor");
  expect(writerPrompt).toContain("at least two substantive content blocks");
  expect(writerPrompt).toContain("representative response payload");
  expect(writerPrompt).toContain("section-level evidence contract");
  expect(writerPrompt).toContain("facts.json.source_briefs");
  expect(writerPrompt).not.toContain("web_search_fallback.py");
  expect(writerPrompt).not.toContain("if no web-search tool is available but `bash` is allowed");
  expect(entryPrompt).toContain("at most 3 highest-value targeted searches");
  expect(entryPrompt).toContain("if `bocha-search` fails with a transport or fetch error");
  expect(entryPrompt).toContain("do not fabricate or guess external sources");
  expect(entryPrompt).toContain("do not close the loop on a partial verifier result");
});

test("repo helper prompts require shell-resolved REPO_ROOT instead of literal glob candidates", async () => {
  const readerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-reader.md"), "utf8");
  const mergerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-merger.md"), "utf8");
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");
  const orchestratorPrompt = await readFile(resolve(root, ".opencode/prompts/doc-orchestrator.md"), "utf8");
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  for (const prompt of [
    readerPrompt,
    mergerPrompt,
    plannerPrompt,
    verifierPrompt,
    orchestratorPrompt,
    entryPrompt,
  ]) {
    expect(prompt).toContain('REPO_ROOT="$(git rev-parse --show-toplevel');
    expect(prompt).toContain('if [ -f "$REPO_ROOT/.opencode/skills/openwork-core/scripts/');
    expect(prompt).toContain("do not use `glob`");
  }
});

test("doc-writer avoids reading the full facts store when section evidence is already available", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");

  expect(writerPrompt).toContain("do not call `read` on the whole `.worktree/facts.json`");
  expect(writerPrompt).toContain("treat `.worktree/facts.json` as a backing store");
  expect(writerPrompt).toContain("use `solution-plan.json.sections[*].required_evidence`");
  expect(writerPrompt).toContain("targeted `bash` extraction");
});

test("doc-writer keeps proposal-style deliverables readable and flags mirrored authority in verification", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(writerPrompt).toContain("avoid raw ASCII box-drawing");
  expect(writerPrompt).toContain("use prose, tables, or structured bullets instead");
  expect(writerPrompt).toContain("policy, standards, or compliance claims");
  expect(writerPrompt).toContain("record the gap instead of upgrading the mirror");
  expect(writerPrompt).toContain("proposal register");
  expect(writerPrompt).toContain("拟采用");
  expect(writerPrompt).toContain("brochure-style");
  expect(writerPrompt).toContain("建设对象/核心组件");
  expect(verifierPrompt).toContain("mirror-hosted");
  expect(verifierPrompt).toContain("issuing body");
  expect(verifierPrompt).toContain("remaining risk");
  expect(verifierPrompt).toContain("product brochure");
  expect(verifierPrompt).toContain("thin implementation detail");
  expect(verifierPrompt).toContain("register mismatch");
  expect(writerPrompt).toContain("create a durable Markdown staging draft");
  expect(writerPrompt).toContain("do not start by hand-writing a monolithic `python-docx` program");
  expect(writerPrompt).toContain("keep headings semantic and unprefixed");
  expect(writerPrompt).toContain("do not manually type chapter/section numbering markers");
  expect(writerPrompt).toContain("strip any leading chapter/section numbering markers from heading text");
  expect(writerPrompt).toContain("keep those URLs out of the consumed-supplement list");
  expect(writerPrompt).toContain("subsection opening sentence explicitly return to the current system name");
  expect(writerPrompt).toContain("prefer concise explained examples or compact tables");
  expect(entryPrompt).toContain("create a durable Markdown staging draft");
  expect(entryPrompt).toContain("low-authority reposts");
  expect(entryPrompt).toContain("not to record low-authority URLs");
  expect(entryPrompt).toContain("must not drift into another named system");
  expect(entryPrompt).toContain("manual heading numbering");
  expect(entryPrompt).toContain("duplicate heading numbering");
  expect(verifierPrompt).toContain("duplicate heading numbering");
  expect(verifierPrompt).toContain("manual chapter/section numbering markers");
  expect(verifierPrompt).toContain("even when the paragraph style is a real Heading style");
  expect(verifierPrompt).toContain("section drift");
  expect(verifierPrompt).toContain("long raw code dump");
  expect(writerPrompt).toContain("do not invent administrative cover metadata");
  expect(writerPrompt).toContain("项目编号");
  expect(writerPrompt).toContain("申报单位");
  expect(verifierPrompt).toContain("manual audit is additive");
  expect(verifierPrompt).toContain("never clear or downgrade a script-detected remaining risk");
  expect(verifierPrompt).toContain("do not rewrite the verification JSON/report into a greener verdict");
});

test("common-work keeps hosted document temp artifacts workspace-local and treats external temp paths as shell-only", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("<WORKSPACE>/.tmp/system");
  expect(prompt).toContain("<WORKSPACE>/.tmp/**` 只用于中间产物");
  expect(prompt).toContain("默认临时目录");
  expect(prompt).toContain("不要把输出目标、重定向目标或工作目录写成 `/tmp`");
  expect(prompt).toContain("`pandoc input.docx -o /tmp/foo.md` 这种 hosted 会话里的新命令，直接视为错误路线");
  expect(prompt).toContain("不要把这些外部临时路径直接交给");
  expect(prompt).toContain("必须先复制或重新输出到 `<WORKSPACE>/.tmp/system/`");
  expect(prompt).toContain("不要新写 `/tmp/*.md`、`/tmp/*.xml`、`/tmp/*.txt` 这类命令");
  expect(prompt).toContain("把 `/tmp/*.md`、`/private/tmp/*.md` 这类路径视为 hosted session 中文件工具不可直接重开的 shell-only 路径");
  expect(prompt).toContain("如果已经在 `.tmp` 下生成了用户最终需要的");
  expect(prompt).toContain("在最终总结里只引用这份稳定路径");
  expect(prompt).toContain("如果最终交付物仍只存在于 `.tmp`，不算完成");
});

test("common-work prefers markdown-plus-pandoc over giant js generators for long prose docx deliverables", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("长篇技术材料");
  expect(prompt).toContain("优先先写 Markdown 草稿");
  expect(prompt).toContain("pandoc");
  expect(prompt).toContain("不要直接拼接超长 JS 字符串");
});

test("common-work defaults to shipping both markdown source and docx for formal prose deliverables when docx is acceptable", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("如果用户接受 Word、`.docx` 或“Markdown / Word 二选一”");
  expect(prompt).toContain("默认同时保留一份稳定的 Markdown 源稿");
  expect(prompt).toContain("再生成并交付 `.docx`");
  expect(prompt).toContain("不要在这种场景下只以 Markdown 收口");
  expect(prompt).toContain("最终 `.docx` 交付件优先直接生成到 `<WORKSPACE>/outputs/`");
  expect(prompt).toContain("不要把 `.tmp/system/*.docx` 当成默认 `target_doc`");
  expect(prompt).toContain("用 `pandoc` 直接把最终 `.docx` 生成到 `<WORKSPACE>/outputs/`");
});

test("common-work reports only stable workspace-relative deliverable paths to users", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("只引用 workspace 内稳定交付路径的相对表示");
  expect(prompt).toContain("不要暴露 hosted pod 的绝对路径");
  expect(prompt).toContain("不要暴露 hosted pod 的绝对路径、user workspace ID、runtime 目录");
  expect(prompt).toContain("如果最终总结里要提到 Markdown 源稿");
  expect(prompt).toContain("不要一边把 `.tmp/system/*.md` 视为临时文件，一边又在最终总结里把它报成“源稿位置”");
  expect(prompt).toContain("不要暴露绝对 pod 路径或 `.tmp/system` 草稿路径");
});

test("common-work prefers search-backed authoritative sources over guessed aggregator URLs", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("优先使用可用的搜索工具");
  expect(prompt).toContain("不要把某个具体 MCP 写死成唯一合法入口");
  expect(prompt).toContain("官方文档");
  expect(prompt).toContain("不要先凭记忆猜测资讯站 URL");
  expect(prompt).toContain("不要把“模拟搜索结果”");
  expect(prompt).toContain("不要因为搜索工具报错");
  expect(prompt).toContain("`webfetch` 只用于读取已经由搜索工具、其他工具结果或用户明确给出的具体 URL");
  expect(prompt).toContain("不要拿无关主页抓取");
  expect(prompt).toContain("先明确报告阻塞和缺失");
  expect(prompt).toContain("不要自动降级使用二级来源");
  expect(prompt).toContain("只有在用户明确允许的情况下");
  expect(prompt).toContain("明确记录 blocker");
  expect(prompt).toContain("不要把低权威背景材料混成主依据");
  expect(prompt).toContain("不要静默切回“基于常识先写一版”");
});

test("common-work forbids broad unfiltered workspace scans before locating real source documents", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("不要使用 `glob **/*`");
  expect(prompt).toContain("不要对整个 workspace 做无过滤的大范围文件扫描");
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

test("common-work enforces system-by-system proposal coherence checks before completion", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("多个命名系统 × 多个固定子章节");
  expect(prompt).toContain("每个子章节的开头段落必须回到当前系统");
  expect(prompt).toContain("proposal-style 文档");
  expect(prompt).toContain("API 示例要嵌入当前系统的小节语义");
  expect(prompt).toContain("标题是否仍保持语义化");
});

test("common-work defaults API examples to relative paths and hostless placeholders instead of absolute placeholder URLs", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("API 示例默认优先写相对路径");
  expect(prompt).toContain("`POST /api/v1/resources`");
  expect(prompt).toContain("不要为了把示例写完整就编造生产环境域名");
  expect(prompt).toContain("只有在用户或权威来源明确给出了真实 host");
  expect(prompt).toContain("默认省略 host");
  expect(prompt).toContain("`Host: <SERVICE_HOST>`、`BASE_URL=<SERVICE_HOST>`");
  expect(prompt).toContain("不要在正文里写 `https://<API_HOST>/...`");
  expect(prompt).toContain("统一使用 `<SERVICE_HOST>`");
  expect(prompt).toContain("不要再自造 `<API_HOST>`");
  expect(prompt).toContain("不要把自造 host/域名混成“可直接调用的真实接口地址”");
  expect(prompt).toContain("即使在 JSON 字段、回调地址、节点地址、对象存储端点");
  expect(prompt).toContain("也优先使用 `<CALLBACK_URL>`、`<NODE_ID>`、`<NODE_ADDRESS>`、`<SERVICE_HOST>`、`<OBJECT_STORAGE_ENDPOINT>`、`<OPS_EMAIL_GROUP>`");
  expect(prompt).toContain("不要随手填 `app.example.com`");
  expect(prompt).toContain("`gpu-cluster-01.internal.example.com`");
  expect(prompt).toContain("`s3.example.com`");
  expect(prompt).toContain("`ops-team@example.com`");
  expect(prompt).toContain("`<LOGIN_USERNAME>`、`<CONTACT_EMAIL>`、`<PHONE_NUMBER>`、`<ACCOUNT_ID>`");
  expect(prompt).toContain("`<NODE_ADDRESS>`");
  expect(prompt).toContain("`<OBJECT_STORAGE_ENDPOINT>`");
  expect(prompt).toContain("不要写 `user@example.com`");
  expect(prompt).toContain("不要写 `https://<APP_HOST>/callback/...`");
  expect(prompt).toContain("把回调地址直接写成 `<CALLBACK_URL>`");
  expect(prompt).toContain("不要写 `https://callback.example.com/...`");
  expect(prompt).toContain("把日志链接写成 `<LOG_STREAM_URL>`");
  expect(prompt).toContain("不要写 `https://logs.example.com/...`");
  expect(prompt).toContain("不要写 `ops-team@example.com`");
  expect(prompt).toContain("不要写 `net-team@example.com`");
  expect(prompt).toContain("不要在 `recipients`、`emailGroups`、`to`、`cc`、`bcc`");
  expect(prompt).toContain('`["ops-team@example.com"]`');
  expect(prompt).toContain('`["<OPS_EMAIL_GROUP>"]`');
});

test("common-work adds a concrete final sweep for suspicious internal paths and placeholder hosts", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("完成前做一次显式扫描");
  expect(prompt).toContain("`example.com`");
  expect(prompt).toContain("`@example.com`");
  expect(prompt).toContain("`https://<`");
  expect(prompt).toContain("`<API_HOST>`");
  expect(prompt).toContain("`<APP_HOST>`");
  expect(prompt).toContain("`/root/.openwork`");
  expect(prompt).toContain("`documents/sessions/`");
  expect(prompt).toContain("`.tmp/system`");
  expect(prompt).toContain("如果命中这些高风险残留");
});

test("common-work keeps helper generator scripts out of user-visible deliverable paths", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("不要把 `generate-docx.js`");
  expect(prompt).toContain("workspace 根目录");
  expect(prompt).toContain("如果使用了辅助生成脚本");
  expect(prompt).toContain("必须放在 `<WORKSPACE>/.tmp/`、`reports/`");
  expect(prompt).toContain("不要把脚本本身报成生成产物或最终交付物");
});

test("common-work stays document-first without blanket-disabling planning skills after real file reads", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("还没读到真实文件前，不要默认调用泛化写作类 skill");
  expect(prompt).toContain("读到至少一个真实文件后");
  expect(prompt).toContain("应优先考虑调用合适的规划类 skill");
  expect(prompt).toContain("不要因为自己是文档 agent 就把这类能力一刀切禁掉");
  expect(prompt).toContain("不要求必须等用户点名");
  expect(prompt).toContain("优先考虑它，而不是直接手写长计划");
});

test("common-work routes document sessions through a small document-focused supplement skill set", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("只有在当前阶段确实需要时");
  expect(prompt).toContain("`doc-coauthoring`");
  expect(prompt).toContain("`content-research-writer`");
  expect(prompt).toContain("`internal-comms`");
  expect(prompt).toContain("`image-enhancer`");
  expect(prompt).toContain("补充 skill 只作为阶段性增强");
  expect(prompt).toContain("不要一次同时拉起多个“看起来都可能有用”的 skill");
});

test("common-work keeps the MCP stack small and document-oriented instead of enabling every available connector", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/common-work.md"), "utf8");

  expect(prompt).toContain("MCP 只保留少数高价值增强");
  expect(prompt).toContain("`Context7`");
  expect(prompt).toContain("`Notion`");
  expect(prompt).toContain("`GitHub`");
  expect(prompt).toContain("`Playwright`");
  expect(prompt).toContain("不要因为某个 MCP 很流行就默认接入");
  expect(prompt).toContain("`filesystem` 这类与当前 workspace 文件能力重叠的 MCP");
  expect(prompt).toContain("memory / sequential-thinking");
  expect(prompt).toContain("优先依赖 workspace 内状态文件");
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
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(writerPrompt).toContain("reports/doc-writer/external-supplements.md");
  expect(writerPrompt).toContain("query terms");
  expect(writerPrompt).toContain("source URLs");
  expect(writerPrompt).toContain("surface those consumed references in the final deliverable's `参考与依据/联网补充依据` section");
  expect(writerPrompt).toContain("prefer authoritative external supplements");
  expect(writerPrompt).toContain("avoid content farms");
  expect(writerPrompt).toContain("do not introduce concrete product names");
  expect(verifierPrompt).toContain("external-supplements.md");
  expect(verifierPrompt).toContain("requested external support");
  expect(verifierPrompt).toContain("external support not surfaced into the final deliverable");
  expect(verifierPrompt).toContain("official or authoritative domains");
  expect(verifierPrompt).toContain("repost sites");
  expect(writerPrompt).toContain("keep layer/component labels unique");
  expect(verifierPrompt).toContain("duplicate architecture labeling");
  expect(entryPrompt).toContain("reports/doc-writer/external-supplements.md");
});

test("merger and planner filter out goal-irrelevant commercial or operations noise", async () => {
  const mergerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-merger.md"), "utf8");
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");

  expect(mergerPrompt).toContain("goal relevance");
  expect(mergerPrompt).toContain("payment");
  expect(mergerPrompt).toContain("coupon");
  expect(mergerPrompt).toContain("recharge");
  expect(plannerPrompt).toContain("named systems are the primary section contract");
  expect(plannerPrompt).toContain("do not promote irrelevant commercial");
  expect(plannerPrompt).toContain("consumer checkout");
});

test("document-writer entry agent has orchestrator task and doc_state permissions", async () => {
  const agentPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");
  const orchestratorPrompt = await readFile(resolve(root, ".opencode/prompts/doc-orchestrator.md"), "utf8");

  for (const configName of ["opencode.json", "opencode.jsonc"]) {
    const config = JSON.parse(await readFile(resolve(root, configName), "utf8"));
    const writer = config.agent?.["document-writer"] ?? {};

    expect(writer?.tools?.task).toBe(true);
    expect(writer?.tools?.["doc_state_*"]).toBe(true);
    expect(writer?.tools?.todoread).toBeUndefined();
    expect(writer?.tools?.todowrite).toBeUndefined();
    expect(writer?.permission?.task?.["doc-*"]).toBe("allow");
    expect(writer?.permission?.bash).toBe("deny");
    expect(writer?.permission?.read?.[".worktree/index.json"]).toBe("allow");
    expect(writer?.permission?.glob?.["**/*.{docx,doc,pdf,md}"]).toBe("allow");
  }

  expect(agentPrompt).toContain("If `.worktree/index.json` or `.worktree/sources/manifest.json` is missing, call `doc-intake`");
  expect(agentPrompt).toContain("do a targeted existence check with `glob` or `list`");
  expect(agentPrompt).toContain("do not maintain a todo list in the main session");
  expect(agentPrompt).toContain("do not read or glob the raw workspace before `doc-intake` creates the initial state");
  expect(orchestratorPrompt).toContain("first do a targeted existence check for `.worktree/index.json` and `.worktree/sources/manifest.json`");
  expect(orchestratorPrompt).toContain("do not maintain a todo list in the main session");
});

test("doc-verifier can execute the verification script directly", async () => {
  const config = JSON.parse(await readFile(resolve(root, "opencode.json"), "utf8"));
  const verifier = config.agent?.["doc-verifier"];

  expect(verifier?.tools?.bash).toBe(true);
  expect(verifier?.permission?.bash).toBe("allow");
});
