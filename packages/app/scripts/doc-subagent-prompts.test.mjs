import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");

test("document-writer entry prompt keeps controller-level phase routing and ownership only", async () => {
  const prompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(prompt).toContain("## Phase 路由");
  expect(prompt).toContain("## Phase 归属");
  expect(prompt).toContain("`doc-reader` 把单份源文档编译成");
  expect(prompt).toContain("`doc-verifier` 负责 `.worktree/verify/coverage.json`");
  expect(prompt).not.toContain("extract_doc_state.py");
  expect(prompt).not.toContain("verify_doc_state.py");
  expect(prompt).not.toContain("`.bid/**`");
});

test("document-writer agent entrypoint uses orchestrator-style delegation rules", async () => {
  const agentPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(agentPrompt).toContain("保持整个控制循环清晰、可恢复、可继续");
  expect(agentPrompt).toContain("长程正式文档和多文档工作流任务");
  expect(agentPrompt).toContain("正式文档工作流主代理");
  expect(agentPrompt).not.toContain("标书写作助手主代理");
  expect(agentPrompt).not.toContain("bid-writing and formal document work");
  expect(agentPrompt).toContain("调用 `doc-intake`");
  expect(agentPrompt).toContain("不要把文档工作委派给 `general` 或非 `doc-*` agent");
  expect(agentPrompt).toContain("不要亲自编辑源文档或目标交付物");
  expect(agentPrompt).toContain("必须先调用 `doc-verifier`");
  expect(agentPrompt).toContain("后续子代理调用必须复用同一路径");
  expect(agentPrompt).toContain("当前用户目标");
  expect(agentPrompt).toContain("允许使用的输入文件");
  expect(agentPrompt).toContain("必需的首要动作");
  expect(agentPrompt).toContain("验收标准");
  expect(agentPrompt).toContain("停止条件");
  expect(agentPrompt).toContain("不要把详细用户目标压缩成泛化转述");
  expect(agentPrompt).toContain("如果后续用户回合只是一个简短继续信号");
  expect(agentPrompt).toContain("精确标题、精确系统名、目标格式或具体要求");
  expect(agentPrompt).toContain("必须原样带上这些措辞");
  expect(agentPrompt).toContain("不要发明额外 state artifact、helper report 或 helper script");
  expect(agentPrompt).toContain("跳过当前缺失的 phase");
  expect(agentPrompt).toContain("如果子代理只完成了部分工作，就从它产出的工件继续");
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
  expect(prompt).toContain("保持整个控制循环清晰、可恢复、可继续");
  expect(prompt).toContain("调用 `doc-intake`");
  expect(prompt).toContain("调用 `doc-writer`");
  expect(prompt).toContain("调用 `doc-verifier`");
});

test("doc-state schema stays a file-level reference instead of teaching MCP call sequences", async () => {
  const schema = await readFile(resolve(root, ".opencode/references/doc-state-schema.md"), "utf8");

  expect(schema).toContain("## 标准状态文件");
  expect(schema).toContain("## 归属模型");
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
  expect(bridge).toContain("优先进入可读工作面");
  expect(bridge).toContain("可重开的临时工件放在 \\`<WORKSPACE>/.tmp/system\\`");
  expect(bridge).toContain("运行 \\`python3 .opencode/references/check_document_delivery.py --target outputs --target reports\\`");
});

test("document-mode bridge does not promote extracted source text as a main-session bootstrap surface", async () => {
  const bridge = await readFile(resolve(root, ".opencode/plugins/document-mode-bridge.js"), "utf8");

  expect(bridge).toContain("\\`.worktree/index.json\\`");
  expect(bridge).toContain("\\`.worktree/sources/manifest.json\\`");
  expect(bridge).toContain("先读这些窄控制文件");
  expect(bridge).not.toContain("hand control to \\`document-writer\\` early");
});

test("writer and verifier prompts treat user-specified section titles as exact headings", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(writerPrompt).toContain("字面 heading 合同");
  expect(verifierPrompt).toContain("精确 heading 合同");
  expect(verifierPrompt).toContain("不要伪造 verifier 输出");
  expect(entryPrompt).toContain("精确标题、精确名称");
  expect(entryPrompt).toContain("不要把文档工作委派给 `general` 或非 `doc-*` agent");
  expect(writerPrompt).toContain("真正的 Office 文档包");
  expect(verifierPrompt).toContain("伪装成 `.docx` 的纯文本");
  expect(entryPrompt).toContain("精确标题、精确系统名");
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
  expect(prompt).toContain("先定位实际 extractor 路径");
  expect(prompt).toContain("./.opencode/runtime-support/document-state/extract_doc_state.py");
  expect(prompt).toContain("不要用 `glob` 或 `list`");
  expect(prompt).toContain("不要直接调用 `write` 或 `edit`");
  expect(prompt).toContain("返回 blocker");
});

test("doc-intake can bootstrap workspace state with bash when direct write permissions are insufficient", async () => {
  const config = JSON.parse(await readFile(resolve(root, "opencode.json"), "utf8"));
  const intakePrompt = await readFile(resolve(root, ".opencode/prompts/doc-intake.md"), "utf8");

  expect(config.agent?.["doc-intake"]?.tools?.bash).toBe(true);
  expect(config.agent?.["doc-intake"]?.permission?.bash).toBe("allow");
  expect(intakePrompt).toContain("init_doc_state.py");
  expect(intakePrompt).toContain("如果没有 init script，就在当前 workspace 内使用 `bash`");
  expect(intakePrompt).toContain("不要把 bootstrap artifact 写到 `/tmp`");
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

  expect(plannerPrompt).toContain("不要把脚本生成的 section schema 换成自定义 `system/modules/key_facts` 形状");
  expect(plannerPrompt).toContain("保留 `id`、`title`、`required_subsections`、`required_evidence`、`source_context_refs`");
  expect(entryPrompt).toContain("`doc-planner` 负责 `.worktree/plan/solution-plan.json` 和 `.worktree/coverage.json`");
  expect(entryPrompt).toContain("保留用户的精确系统名、标题和具体要求");
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
  expect(writerPrompt).toContain("把该主题记录为 blocker");
  expect(writerPrompt).toContain("source titles");
  expect(writerPrompt).toContain("source URLs");
  expect(writerPrompt).toContain("章节级证据");
  expect(writerPrompt).not.toContain("web_search_fallback.py");
  expect(writerPrompt).not.toContain("if no web-search tool is available but `bash` is allowed");
  expect(entryPrompt).toContain("必须先调用 `doc-verifier`");
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
    expect(prompt).toContain("不要用 `glob` 或 `list`");
  }
});

test("doc-writer avoids reading the full facts store when section evidence is already available", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");

  expect(writerPrompt).toContain("把 `.worktree/facts.json` 当成 backing store");
  expect(writerPrompt).toContain("当章节级证据已存在时，不要把整份 facts 文件全部读入上下文");
  expect(writerPrompt).toContain("required_evidence");
});

test("hidden doc-* prompts prefer owned state surfaces before narrow source rereads", async () => {
  const mergerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-merger.md"), "utf8");
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");

  expect(mergerPrompt).toContain("优先基于 compiled state artifact 合并");
  expect(mergerPrompt).toContain("精确 source slice");

  expect(plannerPrompt).toContain("不要再把 `.worktree/sources/*.json` 作为默认 planning surface");
  expect(plannerPrompt).toContain("只重开解决该问题所需的精确 artifact");

  expect(writerPrompt).toContain("不要再把 `.worktree/sources/*.json` 或原始源文档当成默认起草面");
  expect(writerPrompt).toContain("只重开解决该 claim 所需的精确 source artifact");

  expect(verifierPrompt).toContain("不要默认重开 `.worktree/sources/*.json` 或原始源文档");
  expect(verifierPrompt).toContain("只重开确认该风险所需的精确 source artifact");
});

test("document-writer trusts completed doc-* receipts instead of spawning general to reread phase outputs", async () => {
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(entryPrompt).toContain("把已完成的 `task` 输出视为主要回执面");
  expect(entryPrompt).toContain("如果回执过薄或含糊，就用更窄的 follow-up task 重新打开");
});

test("document-writer jumps straight from manifest triage into doc-reader instead of exploratory source reads", async () => {
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(entryPrompt).toContain("如果 manifest 列出了还没有 `.worktree/sources/<doc-id>.json` 的源文件，调用 `doc-reader`");
  expect(entryPrompt).toContain("避免在主会话里重复做探索式源读取");
  expect(entryPrompt).toContain("如果源理解、证据或联网补充仍缺失，就用窄补充任务重新打开");
});

test("document-writer prompt examples stay generic and planner wording avoids sample-specific labels", async () => {
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");
  const entryPrompt = await readFile(resolve(root, ".opencode/agent/document-writer.md"), "utf8");

  expect(plannerPrompt).not.toContain("Qin-like");
  expect(plannerPrompt).toContain("fallback 结构保持通用");
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
  expect(bridge).toContain("先读这些窄控制文件");
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

  expect(prompt).toContain("## 何时向用户提问");
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
  expect(writerPrompt).toContain("把真正消费的参考表面化为具体引用");
  expect(writerPrompt).toContain("优先使用权威来源");
  expect(verifierPrompt).toContain("external-supplements.md");
  expect(verifierPrompt).toContain("当任务要求外部补充时");
  expect(verifierPrompt).toContain("如果补充材料已经被消费，但交付物里仍然是 placeholder 语言");
});

test("merger and planner no longer hide sample-specific topic or noise heuristics inside prompts", async () => {
  const mergerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-merger.md"), "utf8");
  const plannerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-planner.md"), "utf8");

  expect(mergerPrompt).toContain("不要把这个 helper 变成隐藏的任务分类器");
  expect(plannerPrompt).toContain("把它视为规范章节合同");
  expect(plannerPrompt).toContain("fallback 结构保持通用");
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

  expect(agentPrompt).toContain("如果 `.worktree/index.json` 缺失，或其中没有 `task_model`，调用 `doc-intake`");
  expect(agentPrompt).toContain("不要从大范围 `glob` 或全 workspace 读取开始");
  expect(agentPrompt).toContain("不要在主会话里维护 todo list");
  expect(agentPrompt).toContain("避免在主会话里重复做探索式源读取");
  expect(agentPrompt).toContain("可读工作面由子代理自行选择");
  expect(agentPrompt).toContain("调用 `task` 时，始终提供 `description`、`subagent_type` 和 `prompt`");
  expect(agentPrompt).toContain("## 委派合同");
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
