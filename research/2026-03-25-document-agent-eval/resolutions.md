# 解决记录

时间：2026-03-26

## R-001 verifier 对双前缀标题的假阴性

### 问题

- verifier 会把 `1.2 第一章 算力资源汇聚系统` 误判为缺失 `算力资源汇聚系统`
- 也会把 `1.3 技术路线` 误判为缺失 `技术路线`

### 根因

- `normalize_heading()` 只去掉一层前缀
- 对“数字前缀 + 章节前缀”或“多次数字前缀”这种真实 Word 标题样式处理不完整

### 解决方式

- 将标题归一化改成迭代剥离前缀，而不是只做一轮正则替换

### 为什么这样解决

- 这是通用标题规范化能力，不依赖具体样例
- 修 verifier 比强迫 writer 改标题样式更稳，因为真实 Office 文档天然会带编号体系

### 验证

- 新增测试：
  - `verify_doc_state.py accepts nested numeric prefixes before chapter labels and subsection titles`
- 当前通过

## R-002 verifier 对 `NVIDIA MIG` 的弱支撑误判

### 问题

- 文中出现 `NVIDIA MIG`
- 外部补充已经有 `docs.nvidia.com` 的 `MIG User Guide`
- verifier 仍报 `weakly-supported-concrete-term`

### 根因

- 原逻辑只做整串字符串包含
- 不能接受“同一支持文本里 vendor 与 capability 分离出现”的情况

### 解决方式

- 增加 `support_contains_term()`，先做整串匹配，再对复合 ASCII 技术词做 token 级匹配

### 为什么这样解决

- 比给 `NVIDIA MIG` 单独写特判更通用
- 适用于其他类似的复合英文技术词

### 验证

- 新增测试：
  - `verify_doc_state.py accepts composite technology terms when support text contains the same vendor and capability tokens`
- 当前通过

## R-003 低权威来源识别不完整

### 问题

- `baike.baidu.com`、`blog.csdn.net`、`juejin.cn`、`developer.baidu.com/article/*` 等没有被完整识别

### 根因

- 低权威域名表和 host/path 规则不完整

### 解决方式

- 扩展 `LOW_AUTHORITY_DOMAINS`
- 扩展 `LOW_AUTHORITY_HOST_PATH_PATTERNS`

### 为什么这样解决

- verifier 的职责就是识别“看起来像补充资料、实际上不该当权威依据”的来源
- 把这些规则放在 verifier，而不是靠模型自觉，能更稳定地挡住污染

### 验证

- 新增测试：
  - `verify_doc_state.py flags low-authority supplement domains and community article paths seen in real proposal runs`
- 当前通过

## R-004 文档链的搜索策略改成 bocha-only

### 问题

- 最近新增过 `web_search_fallback` 思路
- 它会把“搜索工具坏了”伪装成“还能继续补资料”

### 根因

- 试图提高“可用性”时引入了错误的产品优先级
- 对权威证据链来说，假兜底比显式失败更危险

### 解决方式

- `doc-writer` prompt 改成：
  - 联网补充只允许 `bocha-search`
  - 失败最多只允许一次更窄查询重试
  - 再失败直接记 blocker
  - 明确禁止编来源、编标题、编 URL
- `document-writer` / `doc-orchestrator` 入口规则同步收紧

### 为什么这样解决

- 用户明确要求不要用 fallback 掩盖关键系统问题
- 这能把注意力重新拉回真正要修的系统工具

### 验证

- 更新测试：
  - `doc-writer preserves the raw opencode bocha search capability for external supplements`
- 当前通过

## R-005 搜索 fallback 原型残留已清理

### 问题

- 最近两天试探性添加过搜索 fallback 原型文件
- 即使这些文件没有再被当前 prompt 使用，它们留在仓库里也会继续误导后续排查

### 根因

- 先前为了“不要卡死”而尝试过错误方向的兜底方案
- 后来策略已经改成 bocha-only，但原型文件还没及时清掉

### 解决方式

- 删除未跟踪原型工件：
  - `.opencode/skills/openwork-core/scripts/web_search_fallback.py`
  - `packages/app/scripts/web-search-fallback.test.mjs`
  - `packages/app/scripts/fixtures/duckduckgo-search-sample.html`

### 为什么这样解决

- 用户已经明确要求不要用 fallback 掩盖关键系统问题
- 把原型文件继续留着，只会让后续继续怀疑当前设计仍在偷偷走 fallback

### 验证

- 通过 repo 关键字审计确认搜索 fallback 原型不再作为当前实现的一部分保留

## R-006 `common-work` 禁止模拟搜索结果

### 问题

- `common-work` 在 Qin 样例的联网补充阶段，会写出“模拟搜索结果（因为 bocha 搜索需要特定环境）”
- 同一轮还伴随 `bash` 硬编码行业实践、厂商清单和缺口列表

### 根因

- 旧 prompt 对“联网失败后如何继续”的纪律不够硬
- 在 `bocha-search` 失败时，模型仍有空间把常识性补写伪装成“外部补充”

### 解决方式

- 收紧 `.opencode/agent/common-work.md`：
  - 搜索失败只能显式 blocker
  - 禁止模拟搜索结果
  - 禁止硬编码行业清单冒充外部证据
  - 禁止拿 generic `webfetch` 页面冒充权威来源

### 为什么这样解决

- 这个问题的危害不是“质量稍差”，而是直接污染证据链
- 从规则层面封住危险行为，比继续在结果里做人工甄别更稳

### 验证

- `packages/app/scripts/doc-subagent-prompts.test.mjs` 当前通过
- 后续 Qin 重跑需要继续确认 live 行为不再复发

## R-007 OpenWork pod 运行态恢复

### 问题

- 外部 `healthz`、`openwork/health`、`auth/login` 同时返回 `Empty reply from server`
- Qin compare harness 连 `login` 都会随机 `fetch failed`

### 根因

- pod 内当时没有任何 OpenWork 相关进程在运行
- 这是基础服务中断，不是 agent prompt 本身先坏了

### 解决方式

- 通过 pod 内仓库自带的 `scripts/restart-pod.sh` 拉起：
  - production web server
  - public web server
  - openwork orchestrator
  - openwork-server

### 为什么这样解决

- 这是 repo 官方运行路径，能最大程度保持运行参数、环境加载和健康检查的一致性
- 手工拼启动命令更容易把服务起偏，导致继续污染对比结果

### 验证

- `GET http://192.168.5.10:32765/healthz` -> `200`
- `GET http://192.168.5.10:32765/openwork/health` -> `200`
- `POST http://192.168.5.10:32765/openwork/auth/login` -> `200`

## R-008 全局 OpenCode config 同步链收紧

### 问题

- pod 与本机的全局 OpenCode 基线在 permission 上不一致
- `scripts/sync-global-opencode-config.py` 在没加载 runtime env 时会把已有 provider `apiKey` 改写成空值
- 这会直接污染后续 raw / OpenWork 对比

### 根因

- 同步脚本此前只覆盖 provider/model/bocha 等字段，没有显式支持全局 permission 基线
- 同步脚本对 `MY_COMPANY_API_KEY` 采取“空就写空”，没有保留已有配置
- pod 启动/重启脚本也没有明确给出当前测试所需的 `permission=allow` 基线

### 解决方式

- `scripts/sync-global-opencode-config.py`
  - 增加 `OPENWORK_GLOBAL_PERMISSION`
  - 当运行环境没提供新的 `MY_COMPANY_API_KEY` 时，保留现有 provider `apiKey`
- `scripts/start-pod.sh`
  - 默认导出 `OPENWORK_GLOBAL_PERMISSION=allow`
- `scripts/restart-pod.sh`
  - 默认导出 `OPENWORK_GLOBAL_PERMISSION=allow`
- `scripts/sync-global-opencode-config.test.ts`
  - 新增 permission 基线测试
  - 新增“未加载 runtime env 时保留现有 apiKey”测试

### 为什么这样解决

- 这是“基线对齐”和“防止运维误伤”的修正，不是为了绕过真实产品故障
- permission 显式写入后，raw 与 hosted 对比至少不会被 `ask/deny` 干扰
- 保留已有 `apiKey` 能避免调试时把全局配置意外写坏

### 验证

- `python3 -m py_compile scripts/sync-global-opencode-config.py`
- `bun test scripts/sync-global-opencode-config.test.ts packages/app/scripts/sync-global-opencode-config.test.mjs`
- 当前通过

## R-009 手写编号标题改成显式风险，并要求 writer 在最终渲染前清理

### 问题

- Qin 最新 `document-writer` 产物里，标题段落已经使用真实 `Heading 1/2/3/4`
- 但标题文本仍是：
  - `一、算力资源汇聚系统`
  - `1.1 功能定位`
  - `1.3.1 异构资源接入`
- 旧 verifier 只会把这种情况写成“格式需确认”，无法把问题明确打成风险

### 根因

- 旧 `verify_doc_state.py` 只识别“双层编号叠加”，不识别“有 Heading 样式但 heading text 仍手写编号”
- `doc-writer` / `document-writer` prompt 虽然已有“不要手写编号”的规则，但还缺少“最终渲染前主动剥离标题前缀”的明确动作指令
- `doc-verifier` prompt 没有把“Heading 样式正确但标题文本仍带人工编号”定性成明确风险

### 解决方式

- `verify_doc_state.py`
  - 新增 `manual-heading-numbering` 风险识别
  - 保留 `duplicate-heading-numbering` 作为更重的叠加编号问题
- `.opencode/prompts/doc-writer.md`
  - 增加“最终渲染前剥离标题前缀”的明确规则
- `.opencode/agent/document-writer.md`
  - 把 `manual heading numbering` 加入 verifier 触发的返工条件
  - 明确“真实 Heading 样式并不能为标题里的手写编号开绿灯”
- `.opencode/prompts/doc-verifier.md`
  - 明确要求把这类问题记为风险，而不是“仅需确认”

### 为什么这样解决

- 这是通用文档语义治理，不依赖 Qin 这个样例
- 仅靠“有 Heading 样式”无法保证最终目录、导航和文稿观感符合申报材料要求
- 把 writer 约束与 verifier 风险识别同时收紧，才能避免“writer 继续写错、verifier 继续放过”

### 验证

- `python3 -m py_compile .opencode/skills/openwork-core/scripts/verify_doc_state.py`
- `bun test packages/app/scripts/verify-doc-state-script.test.mjs`
- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
- 当前通过

## R-010 planner/schema 约束已从测试验证推进到真实运行态验证

### 问题

- 旧 Qin 轮次里，`doc-planner` 或其后续消费阶段会把 canonical plan 漂移成：
  - `system`
  - `modules`
  - `key_facts`
- 这会直接让 `doc-writer` 偏离脚本约定的机器可读结构

### 根因

- prompt 对 canonical schema 的强调不够硬
- orchestrator / document-writer 在拿到“看起来像 plan、实际结构已漂移”的对象时，没有把它当成无效计划处理

### 解决方式

- 收紧：
  - `.opencode/prompts/doc-planner.md`
  - `.opencode/prompts/doc-orchestrator.md`
  - `.opencode/agent/document-writer.md`
- 明确要求：
  - planner 不得把脚本 schema 改写成 `system/modules/key_facts`
  - orchestrator / document-writer 如果发现 plan 已漂移，必须视为无效并重跑 planner
- 同时在 verifier 侧增加：
  - `plan-schema-mismatch`
  - 自定义 schema 下的 required section 推导

### 为什么这样解决

- 这是通用的“机器可读契约保护”，不是 Qin 样例特判
- 只靠 writer “尽量理解”错误 schema 会把结构问题延后到正文阶段，代价更高
- 提前把 drift 识别成无效计划，才能稳定约束多子 agent 协作

### 验证

- 测试验证：
  - `bun test packages/app/scripts/doc-subagent-prompts.test.mjs packages/app/scripts/verify-doc-state-script.test.mjs`
  - 当前通过
- 真实运行态验证：
  - `tmp/qin-local-document-writer-minimax-r5/.worktree/plan/solution-plan.json`
  - 第一层 section key 已恢复为：
    - `id`
    - `title`
    - `required_subsections`
    - `source_context_refs`
  - 未再出现 `system/modules/key_facts`

## R-011 hidden `doc-writer` 运行态配置与 bocha-only 策略对齐

### 问题

- Qin `document-writer` MiniMax-r8 的 live 运行表明：
  - hidden `doc-writer` 对 `.worktree/facts.json` 的 `read` 会被权限规则直接拒绝
  - 同时运行态配置里仍保留了 `brave-search*`
- 这与当前 prompt/决策里的两条契约冲突：
  - `.worktree/facts.json` 是允许按需回看的 backing store
  - 联网补充只允许 `bocha-search`

### 根因

- hidden subagent 的真实配置漂移到了旧约束：
  - `doc-writer.permission.read` 漏掉了 `.worktree/facts.json`
  - `doc-writer.tools` 没有跟随 bocha-only 决策一起收紧
- 现有配置测试还把“`doc-writer` 不应有 facts 读权限”当成正确预期，导致这个 runtime 漏洞没有被及时拦住

### 解决方式

- 更新：
  - `opencode.json`
  - `opencode.jsonc`
  - `packages/app/scripts/doc-subagent-prompts.test.mjs`
- 具体改动：
  - 为 hidden `doc-writer` 增加：
    - `.worktree/facts.json`
    - `**/.worktree/facts.json`
    的读权限
  - 从 hidden `doc-writer` 的工具面移除 `brave-search*`
  - 把配置测试改为：
    - 断言 `doc-writer` 可读 `.worktree/facts.json`
    - 断言 `doc-writer` 不再暴露 `brave-search*`

### 为什么这样解决

- 这是“运行态契约对齐”而不是能力兜底：
  - prompt 已经允许把 facts 当 backing store，只是实际白名单没兑现
- 去掉 `brave-search*` 是为了让 bocha-only 成为真实运行边界，而不是纸面约束
- 如果继续让 prompt 与配置分裂，后续再多做内容调优也会被 runtime 漏洞抵消

### 验证

- live 证据：
  - `doc-writer` session `ses_2d9f41ea4ffe6hk9S2nVYv40jt`
  - SQLite 记录到 `.worktree/facts.json` 的 `read` 被 deny
- 配置/测试验证：
  - `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
  - 当前通过：`23 pass / 0 fail`
  - `node -e "JSON.parse(...opencode.json); JSON.parse(...opencode.jsonc)"`
  - 当前通过

## R-012 hosted verifier 假绿根因定位为运行态资产陈旧

### 问题

- Qin hosted 旧 rerun 的最终稿仍有明显问题，但 hosted verifier 报告却给出假绿

### 根因

- pod 部署仓库与目标用户 workspace 中的：
  - `.opencode/prompts/doc-verifier.md`
  - `.opencode/skills/openwork-core/scripts/verify_doc_state.py`
  仍停留在旧版本
- 本地仓库里的 verifier 修复并没有自动进入 hosted 运行态

### 解决方式

- 先对同一份 Qin 最终 markdown 在本地用最新 verifier 做单独重跑，确认脚本逻辑本身会报风险
- 再把最新 verifier prompt/script 同步到：
  - pod 部署仓库 `/root/ai_staff/openwork`
  - 目标用户 workspace `/root/.openwork/user-workspaces/c503a0f6-a558-41f4-8ba4-899eb1ed6923`
- 同步后再重新跑 hosted Qin `document-writer`

### 为什么这样解决

- 这能把“脚本逻辑有问题”和“hosted 运行态还没加载新资产”严格区分开
- 如果不先排除 stale runtime，后续所有 hosted 质量结论都会被污染

### 验证

- 本地复现实验目录：
  - `tmp/qin-verifier-repro`
- hosted 重跑：
  - `ses_2d9a510c2ffeBryhBzY3mIH5jm`
- 结果：
  - hosted writer/verifier 已进入真实多轮纠偏，不再维持旧的假绿行为

## R-013 已消费的外补依据必须进入最终稿，并去掉重复架构标签

### 问题

- Qin hosted 中期 rerun 已经生成了真实外补内容，但最终稿仍停留在“建议联网检索”占位表述
- 同时某些 `技术架构` 小节内会重复同一层级标签

### 根因

- 旧规则只要求 writer 产出 `external-supplements.md`
- 没有硬性要求“已消费的外补依据必须回写到最终交付”
- 也没有把“重复架构标签”当成 verifier 必须拦截的问题

### 解决方式

- 更新：
  - `.opencode/prompts/doc-writer.md`
  - `.opencode/prompts/doc-verifier.md`
  - `.opencode/skills/openwork-core/scripts/verify_doc_state.py`
  - `packages/app/scripts/doc-subagent-prompts.test.mjs`
  - `packages/app/scripts/verify-doc-state-script.test.mjs`
- 新增约束：
  - 已消费的补充依据必须出现在最终 `参考与依据/联网补充依据`
  - 不能再用 future-work 占位话术收口
  - 单个 `技术架构` 小节内层级标签必须唯一

### 为什么这样解决

- 用户看的不是中间报告，而是最终交付
- 只有把外补依据和结构一致性直接压到最终稿，才算真正改善用户可见质量

### 验证

- `python3 -m py_compile .opencode/skills/openwork-core/scripts/verify_doc_state.py`
- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs packages/app/scripts/verify-doc-state-script.test.mjs`
- hosted 重跑：
  - `ses_2d98ef4a2ffeuORlceyeIu3c2h`
- 结果：
  - 最终稿已写回具体联网补充依据
  - 重复架构层标签不再复现

## R-014 背景来源显式降级，并继续扩展低权威域名识别

### 问题

- 在把外补依据写回最终稿之后，仍可能出现：
  - 新浪财经
  - IT 之家
  - 其他转载/门户站点
  这类背景来源
- 如果不主动分级，它们看起来会与第一方/标准组织来源同级

### 根因

- 低权威域名表仍不够完整
- 最终稿对“背景参考”和“权威依据”的语义边界表达不够明确

### 解决方式

- 继续扩展 `LOW_AUTHORITY_DOMAINS`，补入 Qin hosted rerun 中暴露出的域名
- 保留背景来源时，要求最终稿明确写出：
  - 哪些是第一方/官方/标准组织
  - 哪些只是背景参考
- 将更新后的 verifier script 再同步到 deployed repo 与 hosted user workspace

### 为什么这样解决

- 彻底删除所有背景来源并不总是现实，但必须防止它们冒充权威依据
- 显式分级比“全部删掉”更符合真实 proposal/申报材料工作流

### 验证

- `python3 -m py_compile .opencode/skills/openwork-core/scripts/verify_doc_state.py`
- `bun test packages/app/scripts/verify-doc-state-script.test.mjs`
- hosted 最新稳定重跑：
  - `ses_2d97dad4dffeDbEf0Q05HVa3U3`
- 结果：
  - 最终稿不再停留在占位外补
  - 已开始把门户/转载来源明确降级为“背景参考”
  - verifier 当前仅剩 `open-question`

## R-015 compare / simulate harness 的进度判定从“assistant payload 可见”改为“assistant message 可见”

### 问题

- `qin-one-shot-compare.mjs` 会把部分实际已完成的 hosted session 误判成：
  - `No assistant progress after ...`
- 典型案例：
  - `ses_2d968fa0dffe2579AFVDOPasYx`
  - 事后核查显示该 session 已生成 `output/融合算力云平台项目申报技术材料.docx`

### 根因

- 旧逻辑把“`session.messages` 中是否已经出现带 parts 的 assistant payload”当成进度门槛
- 诊断重跑表明，运行早期可能先出现空 assistant message，再在后续 poll 才补出 `step-start/reasoning/tool`
- 因此 assistant payload 的可见性延迟会被旧逻辑放大成假阴性超时

### 解决方式

- 更新以下脚本中的等待逻辑：
  - `packages/app/scripts/qin-one-shot-compare.mjs`
  - `packages/app/scripts/run-qin-doc-writer.mjs`
  - `packages/app/scripts/doc-subagent-simulate.mjs`
  - `packages/app/scripts/doc-agent-live-compare.mjs`
- 具体改动：
  - 新增 `hasAnyAssistantMessage(messages)`
  - `noProgressTimeoutMs` 只在“完全看不到 assistant message”时才触发
  - 不再要求先看到带 parts 的 assistant payload
- 同时新增诊断脚本：
  - `packages/app/scripts/qin-common-work-debug.mjs`
  - 用于打印每次 poll 的消息形态和 event 边界

### 为什么这样解决

- 对比脚本的目标是避免把“服务端还在跑”误判成“产品卡死”
- 从调试结果看，空 assistant message 已经足以证明会话起跑，继续要求 payload 可见只会制造不必要的假阴性
- 这属于 harness 可靠性修正，不是掩盖产品问题

### 验证

- 诊断证据：
  - 原失败 session：`ses_2d968fa0dffe2579AFVDOPasYx`
  - 诊断重跑 session：`ses_2d8b30358ffeSdQwx1A8NgeatE`
- 语法校验：
  - `node --check packages/app/scripts/qin-one-shot-compare.mjs`
  - `node --check packages/app/scripts/run-qin-doc-writer.mjs`
  - `node --check packages/app/scripts/doc-subagent-simulate.mjs`
  - `node --check packages/app/scripts/doc-agent-live-compare.mjs`
  - `node --check packages/app/scripts/qin-common-work-debug.mjs`
- diff 检查：
  - `git diff --check -- packages/app/scripts/qin-one-shot-compare.mjs packages/app/scripts/run-qin-doc-writer.mjs packages/app/scripts/doc-subagent-simulate.mjs packages/app/scripts/doc-agent-live-compare.mjs packages/app/scripts/qin-common-work-debug.mjs`

## R-016 `common-work` 不再把规划类 skill 一刀切压出默认路线

### 问题

- 最近基线诊断里，raw OpenCode 在同一工作区 / 同一模型下能主动走到 `skill`
- 切到 `common-work` 后，却更容易退成只靠 `glob/read/bash` 自己硬撑
- 这会让 `common-work >= raw OpenCode` 这条基线前提先被 prompt 路由本身破坏

### 根因

- `.opencode/agent/common-work.md` 旧版虽然强调“先读真实文件”是对的
- 但对泛化规划 / brainstorming 类 skill 的表述过于绝对
- 结果是模型即使看见这些能力，也更容易把它们视作“不该主动用”

### 解决方式

- 收紧并重写 `.opencode/agent/common-work.md` 的相关路由：
  - 保留“未读到真实文件前，不要默认调用泛化写作类 skill”
  - 新增“读到至少一个真实文件后，若任务属于开放式方案设计、长文档结构重组、跨多阶段执行、系统调试或复杂交付统筹，应优先考虑合适的规划类 skill”
  - `Routing` 中把 `writing-plans` 扩展为长文档统筹 / 系统调试场景可主动使用
  - 明确“不要求必须等用户点名”
- 同步更新：
  - `packages/app/scripts/doc-subagent-prompts.test.mjs`

### 为什么这样解决

- 这不是把 `common-work` 改成“先 brainstorm 再干活”
- 而是把“真实文件优先”和“长任务该用规划能力时就用”重新拉回可兼容状态
- 这样才能先验证真正的产品基线，而不是被 prompt 自己的人为抑制拖垮

### 验证

- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
- 当前通过

## R-017 pod `common-work` prompt 资产对齐

### 问题

- MiniMax baseline 短探针里，pod `common-work` 的 `planning_route` lane 最初没有主动调用 `skill`
- assistant 文本还引用了旧版 `common-work.md` 的旧口径与旧行号
- 这说明当前 pod 被测的并不是本地仓库这版 `common-work.md`

### 根因

- pod 部署仓库与目标用户 workspace 里的：
  - `.opencode/agent/common-work.md`
  仍是旧版本
- 结果是本地已经修好的路由规则并没有实际进入被测运行态

### 解决方式

- 将本地最新：
  - `.opencode/agent/common-work.md`
  同步到：
  - `/root/ai_staff/openwork/.opencode/agent/common-work.md`
  - `/root/.openwork/user-workspaces/c503a0f6-a558-41f4-8ba4-899eb1ed6923/.opencode/agent/common-work.md`
- 同步后用同一 MiniMax baseline 探针重跑 pod lane

### 为什么这样解决

- 这是典型的“运行态资产对齐”问题，不是模型/agent 能力本身的对错
- 如果不先把 prompt 资产对齐，后续所有 pod `common-work` 结论都会继续失真

### 验证

- SSH 核对：
  - pod repo 与用户 workspace 的 `common-work.md` 第 158-161 行已与本地一致
- 重跑 session：
  - 同步前：`ses_2d843adcfffet3CXUHIFGFeE45`
  - 同步后：`ses_2d84106faffeVfS0B7nA3MEQ4r`
- 结果：
  - pod `planning_route` 已从“不走 skill”变成 `skill: 1`

## R-018 Qin A/B/C 长跑 harness 修正 `uploadElapsedMs` 统计口径

### 问题

- `tmp/qin-abc-minimax.mjs` 第一版在 `runOpenWorkCommonWorkLane` 中把：
  - `uploadStarted`
  到
  - 整轮 lane 完成
  之间的总时长误记成了 `uploadElapsedMs`
- 这会把 prompt 推理、工具调用和写文档时间都错误归到“上传耗时”里，污染后续台账判断

### 根因

- 脚本在等待 `promptAndSettle` 结束后，才计算：
  - `Date.now() - uploadStarted`
- 因此字段语义与命名不一致

### 解决方式

- 在两份文档上传完成后立即冻结：
  - `const uploadElapsedMs = Date.now() - uploadStarted`
- 再进入 `promptAndSettle`
- 修改文件：
  - `tmp/qin-abc-minimax.mjs`

### 为什么这样解决

- 上传链路和 agent 运行链路是两个不同故障域
- 如果把它们混成一个耗时字段，后续会把内容生成慢、工具调用慢或 host-mode 噪声误判成上传代理问题

### 验证

- `node --check tmp/qin-abc-minimax.mjs`
- `git diff --check -- tmp/qin-abc-minimax.mjs`

## R-019 Qin 长跑 harness 增加“逻辑失败”工具审计

### 问题

- `RL-028` 已确认：
  - raw `bocha-search` 会出现 `status=completed`，但 `output` 实际是 `MCP error 13: 搜索请求失败: fetch failed`
  - pod `filesystem_read_text_file` 会出现 `status=completed`，但 `output` 实际是 `Access denied`
- 仅统计工具次数和 `status` 会把这类“表面成功、实际失败”的调用误判成正常路径

### 根因

- 当前长跑汇总脚本只做：
  - `toolCounts`
  - `taskCalls`
- 没有进一步检查：
  - `state.error`
  - `state.output` 是否包含明显失败信号

### 解决方式

- 在 `tmp/qin-abc-minimax.mjs` 中新增：
  - `extractToolIssuesFromParts`
  - `summarizeToolIssues`
- 对 raw export 与 OpenWork session messages 同时补充：
  - `toolIssueCounts`
  - `toolIssues`
- 当前默认抓的逻辑失败信号包括：
  - `state.error`
  - `MCP error`
  - `Access denied`
  - `fetch failed`
  - 明确的 permission deny 提示

### 为什么这样解决

- 这不是美化测试报告，而是防止后续继续把“失败的搜索/读取”当成“成功能力”
- 只有把真实失败从工具调用总数里拆出来，才能正确判断：
  - raw 与 pod 的联网差异
  - common-work 是否在无谓地踩路径/权限边界
  - 哪些 bug 值得优先修

### 验证

- `node --check tmp/qin-abc-minimax.mjs`
- `git diff --check -- tmp/qin-abc-minimax.mjs`

## R-020 hosted session runtime 切到 workspace-local temp，并去掉 `common-work` 的 Bocha-first 偏置

### 问题

- hosted `common-work` 真实长跑里仍会把中间 Markdown 先落到 `/tmp`
- 后续再切回 `read` / `filesystem_*` 时，会被 session workspace 边界拦住
- 同时 `common-work` 还残留了“Bocha 首选”和“`/tmp` 可作为常规临时目录”的 prompt 口径

### 根因

- session runtime 之前只创建了独立 workspace，但没有给 agent 一个运行时自带的、稳定的 workspace-local temp root
- `external_directory` 又额外放行了 `/tmp/*` 与 `/private/tmp/*`，让 prompt 和运行时边界长期处于半冲突状态
- `common-work` 的联网规则把某个具体搜索 MCP 写得过重，偏离了“系统工具存在，但 agent 是否使用由任务决定”的最新约束

### 解决方式

- 更新：
  - `packages/server/src/session-workspaces.ts`
  - `packages/server/src/session-workspaces.test.ts`
  - `packages/server/src/server.proxy-session-create.test.ts`
  - `.opencode/agent/common-work.md`
  - `packages/app/scripts/doc-subagent-prompts.test.mjs`
- 具体改动：
  - session provision 时自动创建 `<WORKSPACE>/.tmp/system`
  - 新增 `.opencode/openwork-runtime.md`，把 workspace-local temp 规则作为 runtime instruction 注入每个 hosted session
  - runtime config 合并逻辑改成保留 workspace 原始 `model / mcp / instructions`，避免 carrier 覆盖掉父配置
  - `buildSessionPermissionRules()` 移除 `/tmp/*`、`/private/tmp/*` 例外，只保留 hosted `external_directory=* deny`
  - `common-work` 改成：
    - 默认临时目录是 `<WORKSPACE>/.tmp/system`
    - 外部临时路径只允许在同一条 shell/tool 链内即时消费
    - 搜索规则保持“优先使用可用搜索工具”，不再把 Bocha 写死成唯一入口

### 为什么这样解决

- 这次要修的是运行时边界，而不是继续要求模型“记住别用 `/tmp`”
- workspace-local temp root 是跨样例成立的通用能力，不会把系统收窄到秦老师这类文档
- 搜索工具中立能避免把某个 MCP 的存在误写成产品硬依赖，同时仍保留“禁止伪造证据”的核心纪律

### 验证

- `bun test packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts packages/app/scripts/doc-subagent-prompts.test.mjs`
- `git diff --check -- packages/server/src/session-workspaces.ts packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts .opencode/agent/common-work.md packages/app/scripts/doc-subagent-prompts.test.mjs`
- 当前通过：`31 pass / 0 fail`

## R-021 外部 temp 路径改成“先 copy-back 再交给文件工具”

### 问题

- `R-020` 之后，hosted runtime 已有 workspace-local temp root
- 但真实 Qin 长跑仍暴露出一个更细的问题：
  - 某些 shell / office helper 仍会先把中间 Markdown 落到 `/tmp`
  - 然后再把 `/tmp/*.md` 直接交回 `read` / `filesystem_*`
  - 结果触发 session workspace 边界 deny

### 根因

- 仅有“默认 temp 根在 workspace 内”还不够
- 只要外部工具偶发写到 `/tmp`，agent 仍可能把这个外部路径当成后续文件工具输入
- 同时，当前也没有文档化的 OpenCode 顶层 session env 注入面可稳定强制所有 shell helper 改写 `TMPDIR`

### 解决方式

- 继续收紧三层规则：
  - `packages/server/src/session-workspaces.ts`
  - `.opencode/agent/common-work.md`
  - `.opencode/skills/docx/SKILL.md`
- 具体约束：
  - `/tmp/*` 与 `/private/tmp/*` 视为 shell-only transient paths
  - 一旦需要再交给 `read/list/glob/edit/filesystem_*`，必须先 copy 或 re-emit 到 `<WORKSPACE>/.tmp/system/` 或其他 workspace 内路径

### 为什么这样解决

- 这是当前在官方能力面内能稳定落地的通用方案
- 它不依赖未文档化的配置字段，也不会把系统收窄到某个具体样例或某个具体 office helper

### 验证

- `bun test packages/server/src/session-workspaces.test.ts packages/app/scripts/doc-subagent-prompts.test.mjs`
- pod 同步、重启并重跑后：
  - raw：`ses_2d7763f7effevmomFnP77k20go`
  - pod：`ses_2d776285dffeR7NRJxx8WmaK6R`
  - 最新 pod `toolIssueCounts = {}`

## R-022 assistant 可见文本与报告层净化 `<think>` / `</think>` 泄漏

### 问题

- 最新 Qin 主 baseline 里，pod lane 的最终 `assistantText` 仍包含孤立 `</think>`
- 历史 raw export 与模拟报告中也能看到：
  - 完整 `<think>...</think>` block
  - 或孤立 `</think>` 行
- 这会污染：
  - OpenWork 用户可见消息
  - tool monitor 预览
  - 对比脚本输出

### 根因

- 当前显示层和测试脚本都直接把 assistant `text` parts 原样拼接
- 没有把 reasoning tag artifact 当成需要在显示/报告层去噪的内容

### 解决方式

- 新增 app 侧 helper：
  - `packages/app/src/app/lib/assistant-text.ts`
- 新增 script 侧 helper：
  - `packages/app/scripts/_assistant-text.mjs`
- 应用点：
  - `packages/app/src/app/components/part-view.tsx`
  - `packages/app/src/app/lib/tool-monitor/analyze.ts`
  - `packages/app/scripts/qin-one-shot-compare.mjs`
  - `packages/app/scripts/doc-subagent-simulate.mjs`
  - `packages/app/scripts/run-qin-doc-writer.mjs`
  - `packages/app/scripts/doc-agent-live-compare.mjs`
  - `tmp/qin-abc-minimax.mjs`
- 策略：
  - 去掉完整 `<think>...</think>` block
  - 去掉孤立 `</think>` / `<think>` 行
  - 只影响显示/报告文本，不改原始 message 存储

### 为什么这样解决

- 用户可见面不应该继续暴露 reasoning tag artifact
- 但原始消息仍需要保留给后续 provider/runtime 诊断，所以不能在存储层直接篡改

### 验证

- `bun test packages/app/src/app/lib/assistant-text.test.ts packages/app/scripts/assistant-text.test.mjs packages/app/scripts/doc-subagent-prompts.test.mjs packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts`
- `node --check packages/app/scripts/qin-one-shot-compare.mjs packages/app/scripts/doc-subagent-simulate.mjs packages/app/scripts/run-qin-doc-writer.mjs packages/app/scripts/doc-agent-live-compare.mjs tmp/qin-abc-minimax.mjs`
- `bunx tsc -p tsconfig.json --noEmit`
  - 当前被现有无关错误阻塞：
    - `src/app/components/session/sidebar.tsx:487`
    - `src/app/components/session/sidebar.tsx:533`
    - `src/app/components/session/sidebar.tsx:534`
- 最新 live 重跑：
  - raw：`ses_2d763a500ffeTLiSn1P81POga8`
  - pod：`ses_2d7638fc1ffegLzH3pmhEa9GWs`
  - 结果：
    - pod `assistantText` 已不再包含 `</think>`
    - pod `toolIssueCounts` 仍保持 `{}`

## R-023 compare harness 支持多场景切换，并在 raw `export` 损坏时回退到 `run.jsonl`

### 问题

- 当前主 baseline 不能只压 Qin 单一样例，需要至少能复用到第二个真实样例
- WJW raw lane 首次长跑中，`opencode export` 返回的 `raw.export.json` 虽然文件写出成功，但 JSON 本身损坏，导致 harness 丢失 raw 工具统计和可见摘要

### 根因

- `tmp/qin-abc-minimax.mjs` 之前把场景、输出目录和 prompt 文件都写死在 Qin 样例上
- raw lane 之前只信任 `opencode export` 结果；一旦 export JSON 格式损坏，就没有第二条行为证据面

### 解决方式

- 更新 `tmp/qin-abc-minimax.mjs`：
  - 引入 `SCENARIOS` 映射
  - 支持通过 `OPENWORK_COMPARE_SCENARIO` 在 Qin / WJW 间切换
  - 输出目录、prompt 文件、标题、输入文档都跟随场景切换
- 为 raw lane 增加 `analyzeRunJsonLines()`：
  - 当 `opencode export` 解析失败时，自动从 `raw.run.jsonl` 恢复：
    - `toolCounts`
    - `toolIssueCounts`
    - `toolIssues`
    - `taskCalls`
    - `assistantText`
  - 并把：
    - `analysisSource`
    - `exportParseError`
    显式写入结果 JSON

### 为什么这样解决

- 这是评测 harness 的稳健性修正，不会改变被测 agent 行为
- 比较系统时，行为证据比单一导出格式更重要；不能因为 `export` 一次格式损坏，就丢掉整条 raw baseline 的证据
- 同一套脚本支持多样例，能降低“每个样例再写一套测试脚本”带来的样例污染风险

### 验证

- `node --check tmp/qin-abc-minimax.mjs`
- `git diff --check -- tmp/qin-abc-minimax.mjs`
- `OPENWORK_COMPARE_SCENARIO=wjw QIN_ABC_LANES=raw node tmp/qin-abc-minimax.mjs`
- 验证结果：
  - raw rerun session：`ses_2d73347e7ffeZ2hFcTnLP1um3E`
  - `exportParseError` 被显式记录
  - `analysisSource = run-jsonl`
  - raw `toolCounts` 已成功恢复：
    - `glob: 2`
    - `skill: 1`
    - `bash: 5`
    - `read: 5`
    - `write: 1`

## R-024 `common-work` 明确禁止把最终交付物留在 `.tmp`

### 问题

- WJW pod 首轮 session `ses_2d74ac031ffea2GsQFgHpo1lEL` 已经真实生成了：
  - `.tmp/docx-output/点对点解决方案.docx`
- 但 agent 没有把这份最终 `.docx` 回写到 workspace 稳定路径
- 结果是下载面只暴露了 Markdown，形成“文档生成了但没真正交付出去”的错觉

### 根因

- 旧的 `common-work.md` 对 temp 目录的约束主要覆盖：
  - 中间提取物不要落到系统 `/tmp`
  - 外部 temp 路径不要直接交给文件工具
- 但没有明确写死：
  - `.tmp/**` 永远不是最终交付目录
  - 任何用户可见交付物都必须搬回 workspace 稳定路径后才能算完成

### 解决方式

- 更新：
  - `.opencode/agent/common-work.md`
  - `packages/app/scripts/doc-subagent-prompts.test.mjs`
- 新增约束：
  - `<WORKSPACE>/.tmp/**` 只用于中间产物
  - 不允许在最终总结里把 `.tmp` 下文件报成“已交付文件”
  - 如果在 `.tmp` 下生成了最终 `.docx/.md/.pdf/.xlsx/.pptx`，完成前必须复制或移动到：
    - `<WORKSPACE>/outputs/`
    - `<WORKSPACE>/reports/`
    - workspace 根目录
    - 或用户明确指定的稳定路径
  - 如果最终交付物仍只存在于 `.tmp`，任务不算完成

### 为什么这样解决

- 这是通用收口规则，不依赖 Qin/WJW 任一样例的具体内容
- `.tmp` 本来就是中间层；如果把它当正式交付面，用户体验和下载面就会系统性失真
- 这条约束既能保护 hosted 下载链，也不会影响 raw / local 的正常文档生成

### 验证

- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
- `git diff --check -- .opencode/agent/common-work.md packages/app/scripts/doc-subagent-prompts.test.mjs`
- 同步到 pod：
  - `/root/ai_staff/openwork/.opencode/agent/common-work.md`
  - `/root/.openwork/user-workspaces/c503a0f6-a558-41f4-8ba4-899eb1ed6923/.opencode/agent/common-work.md`
- WJW pod 重跑：
  - session：`ses_2d728a4b1ffeLCwnCzI6dhVi4o`
  - 结果：
    - `generatedDocuments` 已同时包含 `.md + .docx`
    - 下载目录已成功拿到 `点对点解决方案.docx`

## R-025 用 OpenCode project plugin 的 `shell.env` hook 固化 session temp root

### 问题

- 当前 hosted temp 隔离虽然已经有：
  - session workspace
  - `<WORKSPACE>/.tmp/system`
  - runtime instruction
  - `external_directory=* deny`
- 但 shell 侧默认临时目录仍可能落到系统 temp
- 继续只靠 `common-work.md` 约束 temp 路径，仍然会受模型执行漂移影响

### 根因

- 重新核对当前可读到的 OpenCode SDK 后确认：
  - 普通 `/session create` body 没有 `env`
  - 因此不能通过 OpenWork proxy 稳定给每个 session 注入 `TMPDIR/TMP/TEMP`
- 但 OpenCode plugin API 暴露了 `shell.env` hook
  - 这正是 shell 调用前改写环境变量的原生挂点

### 解决方式

- 新增：
  - `.opencode/plugins/session-temp-root.js`
  - `.opencode/plugins/session-temp-root.test.mjs`
- plugin 行为：
  - 在 `shell.env` 中确保 `<WORKSPACE>/.tmp/system` 存在
  - 把：
    - `TMPDIR`
    - `TMP`
    - `TEMP`
    统一指向该目录
- 不改：
  - `common-work.md` 的最终交付物必须留在 `<WORKSPACE>` 的规则
  - hosted `external_directory=* deny` 边界

### 为什么这样解决

- 这是 OpenCode 原生 plugin seam，不是 undocumented hack
- 插件会随 `.opencode/plugins/` 一起进入 session runtime workspace，符合当前 hosted 运行模型
- 它把 temp 目录约束从“模型是否遵守 prompt”下沉到“shell 每次启动前的环境变量”，更接近真正的硬约束

### 验证

- 先写失败测试：
  - `node --test .opencode/plugins/session-temp-root.test.mjs`
  - 初始失败：`expected .opencode/plugins/session-temp-root.js to exist`
- 实现 plugin 后再次验证：
  - `node --test .opencode/plugins/session-temp-root.test.mjs`
  - 当前通过：
    - `TMPDIR/TMP/TEMP` 都被指向 `<WORKSPACE>/.tmp/system`
    - plugin 会确保该目录存在
- 同步到 pod：
  - `/root/ai_staff/openwork/.opencode/plugins/session-temp-root.js`
  - `/root/.openwork/user-workspaces/c503a0f6-a558-41f4-8ba4-899eb1ed6923/.opencode/plugins/session-temp-root.js`
- live probe：
  - `node tmp/pod-session-temp-probe.mjs`
  - session：`ses_2d7035ff3ffeSBIVd0HC9dsa4B`
  - 真实 `bash` 输出：
    - `/root/.openwork/user-workspaces/c503a0f6-a558-41f4-8ba4-899eb1ed6923/documents/sessions/64412fea5d664b51bb81350afbf7e630/.tmp/system`

## R-026 hosted isolated runtime 继续补齐 config-home 与 temp env 隔离

### 问题

- 之前的 hosted per-session OpenCode runtime 已经把：
  - `directory`
  - `XDG_DATA_HOME`
  - `XDG_STATE_HOME`
  - `XDG_CACHE_HOME`
  session 化
- 但仍缺：
  - `OPENCODE_CONFIG_DIR`
  - `XDG_CONFIG_HOME`
  - `TMPDIR/TMP/TEMP`
  - 持久化的 `configHomeDir`
  - 持久化的 `tempDir`

### 根因

- 先前的隔离主要针对 OpenCode 的 data/state/cache 面
- 但 config 与 temp 仍然留在“默认共享或半共享”的路径上
- 这会继续给 session 之间的配置污染、tool-output/temp 文件串扰留下口子

### 解决方式

- 更新：
  - `packages/server/src/session-opencode-runtime.ts`
  - `packages/server/src/session-workspaces.ts`
  - `packages/server/src/session-opencode-runtime.test.ts`
  - `packages/server/src/session-workspaces.test.ts`
  - `packages/server/src/server.proxy-session-create.test.ts`
- 新增 / 调整：
  - isolated runtime 元数据包含：
    - `configHomeDir`
    - `tempDir`
  - spawn isolated `opencode serve` 时显式注入：
    - `OPENCODE_CONFIG_DIR`
    - `XDG_CONFIG_HOME`
    - `TMPDIR`
    - `TMP`
    - `TEMP`
  - runtime seed 时主动创建：
    - `<runtime>/.openwork-runtime/opencode/config-home`
    - `<WORKSPACE>/.tmp/system`
  - `session-workspaces` 读取旧记录时会回填默认推导，保证兼容旧 session 记录

### 为什么这样解决

- 这是“不改 OpenCode 源码前提下，把 OpenCode 进程级家目录进一步 session 化”的必要补全
- 只隔离 cwd 和 data/state/cache 还不够；config / temp 不跟着 session 走，运行态隔离就仍然是不完整的
- 这条修正是通用运行态治理，不依赖 Qin/WJW 任一样例

### 验证

- 本机测试：
  - `bun test packages/server/src/session-opencode-runtime.test.ts packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts`
  - `11 pass / 0 fail`
- 扩展 server 回归：
  - `bun test packages/server/src/session-activity.test.ts packages/server/src/server.proxy-session-activity.test.ts packages/server/src/session-workspaces.test.ts packages/server/src/session-opencode-runtime.test.ts packages/server/src/server.proxy-session-create.test.ts packages/server/src/server.proxy-session-list.test.ts packages/server/src/server.proxy-runtime-control.test.ts packages/server/src/server.knowledge-routes.test.ts packages/server/src/server.admin-user-session-scan.test.ts packages/server/src/server.admin-user-counts.test.ts`
  - `35 pass / 0 fail`
- pod 同步后验证：
  - `corepack pnpm --filter openwork-server build:bin`
  - `bash scripts/restart-pod.sh`
  - `bun test packages/server/src/session-opencode-runtime.test.ts packages/server/src/session-workspaces.test.ts packages/server/src/server.proxy-session-create.test.ts`
  - `11 pass / 0 fail`
- live 取证：
  - session：`ses_2d671b6dfffeJY9ZGO2L030ERe`
  - `session-workspaces/...json` 中已持久化：
    - `configHomeDir`
    - `tempDir`
