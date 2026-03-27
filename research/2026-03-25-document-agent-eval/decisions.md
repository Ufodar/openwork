# 决策记录

时间：2026-03-26

## D-001 秦老师样例是压力测试，不是唯一优化目标

- 决策：
  - 允许用该样例压测系统
  - 禁止把系统优化成只会处理这一类“算力平台申报材料”
- 原因：
  - 用户明确要求不能因为这个样例把系统收窄

## D-002 联网补充只允许 `bocha-search`

- 决策：
  - 移除或停用最近两天新增的搜索 fallback 思路
  - `bocha-search` 失败就是系统故障信号
- 原因：
  - fallback 会掩盖关键系统问题
  - 对权威外部证据链来说，假兜底比显式失败更危险

## D-003 `bocha-search` 失败时显式 blocker，禁止编来源

- 决策：
  - `doc-writer` 不允许在 `bocha-search` 失败后伪造来源、伪造标题、伪造 URL
  - 最多允许一次更窄查询重试
  - 再失败则记录 blocker
- 原因：
  - 产物质量比“勉强继续跑下去”更重要

## D-004 先修验证链，再继续跑内容优化

- 决策：
  - 当前优先级高于文稿内容微调的是 verifier 误判修复
- 原因：
  - 如果 verifier 自己大量假阴性，后续所有 A/B/C 对比都会被污染

## D-005 所有关键结论必须落盘

- 决策：
  - 后续继续测试时，必须先更新本目录下的文档，而不是只留在聊天记录里
- 原因：
  - 多轮测试、跨账号接力、上下文压缩时都需要稳定的知识载体

## D-006 本目录作为正式 handoff 包

- 决策：
  - 不再等待“另一个 handoff 文档”
  - 统一以 `research/2026-03-25-document-agent-eval/` 作为跨账号接力入口
- 原因：
  - 仓库内没有额外可复用的 handoff 文档
  - 继续把关键信息散落在聊天记录里，只会让后续继续走回头路

## D-007 严格区分两类 fallback

- 决策：
  - 搜索 fallback：禁止
  - 状态工件 fallback / generic section fallback：允许，但必须按上下文理解，不能混同为联网兜底
- 原因：
  - 当前 prompt 中 `fallback` 一词既可能指状态工件读取面，也可能指规划退化语义
  - 如果不拆清楚，后续很容易继续误判

## D-008 每轮实验先记台账，再开下一轮

- 决策：
  - 任何有效测试在开始下一轮之前，必须先更新 `run-ledger.md`
- 原因：
  - 连续几十轮测试如果没有轮次台账，后面无法判断当前结论来自哪一轮，也无法知道哪次修复真的有效

## D-009 不对未证实的 upload-race 假设做产品修复

- 决策：
  - 在 compare harness 只报 `fetch failed` 的情况下，不把 `document-writer`/`doc_state` 上传竞态当成既定事实
  - 先补测试诊断，再决定是否需要改产品逻辑
- 原因：
  - 已有 isolated fresh run 成功跑通，说明“上传必挂”并不成立
  - 用不充分的错误证据去驱动产品修复，很容易修错对象

## D-010 关键系统能力故障必须显式暴露

- 决策：
  - 对 `bocha-search`、关键 MCP、权限姿态等系统级能力，禁止用本地替身、隐式 alternate path、测试专用兜底去掩盖故障
  - 如果这些能力不可用，要把故障本身当成测试结果记录下来
- 原因：
  - 这类能力本来就是产品真实质量的一部分
  - 一旦偷偷绕过去，后面只会继续误判系统已经可用

## D-011 跨模式对比必须显式记录 OpenCode 版本基线

- 决策：
  - raw OpenCode、本机 OpenWork、pod OpenWork 的比较结果都必须记录实际 OpenCode 版本
  - 在版本明显不一致时，禁止把行为差异直接解释成 prompt/agent 设计优劣
- 原因：
  - 当前已发现 pod 中实际使用 `1.2.6`，而 orchestrator 期望 `1.3.2`
  - 如果不把版本漂移单独拿出来，后续很容易把底层引擎差异误判成产品层问题

## D-012 跨模式对比必须显式记录权限姿态与关键 MCP 可用性

- 决策：
  - raw OpenCode、本机 OpenWork、pod OpenWork 的比较结果都必须记录全局 permission 姿态，以及 `bocha-search`、memory 等关键 MCP 的启用状态
  - 若某一路径因为 `ask` / `deny` 或 MCP 缺失而被拦截，该轮默认视为“基线不对齐”，不能直接拿来做内容质量结论
- 原因：
  - 用户已经明确要求统一权限姿态，避免把系统拦截误当成模型/agent 能力差异
  - 当前已发现本机与 pod 的全局 `opencode.json` 在 permission / MCP 维度并不完全一致

## D-013 pod 上禁止裸跑 `sync-global-opencode-config.py`

- 决策：
  - 在 pod 上审计或重写全局 OpenCode 配置时，必须先加载 runtime env 文件，再运行 `scripts/sync-global-opencode-config.py`
  - 裸跑该脚本只允许作为“证明它有危险”的一次性审计证据，不能作为正常维护路径
- 原因：
  - 当前已实际观察到：裸跑时脚本会把全局 `opencode.json` 写成 `api_key=empty`
  - 如果不把这条纪律写死，后续很容易一边排查一边把运行态基线污染掉

## D-014 文档 agent 长期默认使用 Qwen 基线

- 决策：
  - 长期默认模型仍是 `my-company/Qwen3.5-397B-A17B`
  - `MiniMax-2.5` 作为备选，或在当前阶段这种“Qwen 基线已被兼容问题污染”的情况下，作为临时公平比较基线
  - `Kimi-K2.5` 不进入当前对比与调优链
- 原因：
  - 用户已经明确给出模型选择约束
  - 多模型混跑会让质量差异、工具风格差异与系统问题互相污染

## D-015 A/B/C 是诊断路径，不是路线忠诚测试

- 决策：
  - 当前优化目标是最终产物质量，而不是证明某一条路线必须胜出
  - 如果 raw OpenCode、全局 skills、或 OpenWork 某一条链路暴露出更优且可泛化的行为，应把这类改进吸收进 OpenWork，而不是把它视为“对照组特性”
- 原因：
  - 用户已经明确要求把 A/B/C 当成通向高质量最终交付的手段，而不是目标本身
  - 如果为了守住某条路线而拒绝吸收更好的通用做法，调优方向会越来越偏

## D-016 关键对比必须记录全局 skills / overlays

- 决策：
  - 当 raw OpenCode、本机 OpenWork 或 pod OpenWork 加载了会明显改变交互风格或首轮路由的全局 skills / overlays（例如 brainstorming、superpowers 组合）时，必须把它们记入比较基线
  - 这类差异没有记清楚之前，禁止把“先追问用户”或“路由方式不同”直接归因到 agent prompt 本身
- 原因：
  - 用户已经明确指出本机与 pod 可能都加载了 superpowers 相关 skills
  - 这些全局技能会改变首轮行为，如果不显式入账，就会把环境差异误判成产品差异

## D-017 `bocha-search` 结论必须分本机与 pod 两条环境线记录

- 决策：
  - 当 Qin 等样例涉及联网补充时，本机与 pod 的 `bocha-search` 结果必须分环境记录
  - 禁止把“本机 TLS reset / fetch failed”和“pod 侧 API 200”混成一个统一结论
- 原因：
  - 这次已经确认本机到 `api.bochaai.com` 的网络链路异常，而 pod 侧直连可用
  - 如果不拆开，后续会把环境网络故障误判成 OpenWork prompt / orchestration 缺陷

## D-018 hidden subagent 的运行态配置必须与 prompt 契约一起审计

- 决策：
  - 当 `doc-*` hidden subagent 的 live 行为与 prompt 契约不一致时，必须同时检查对应的 `opencode.json` / `opencode.jsonc` agent 配置
  - 若产品规则已经拍板为 bocha-only，则对应 hidden subagent 不应继续暴露其他搜索工具作为潜在旁路
- 原因：
  - Qin `document-writer` MiniMax-r8 已证明：`doc-writer` prompt 允许把 `.worktree/facts.json` 当 backing store，但真实运行态权限白名单却把它 deny 掉
  - 同一处运行态配置里还保留了 `brave-search*`，这会让“prompt 写 bocha-only、配置留后门”这种问题继续存在

## D-019 hosted 运行态结论必须先核对资产新鲜度

- 决策：
  - 对 hosted 文档链的任何结论，在采信前都必须核对：
    - 本地仓库中的目标资产
    - pod 部署仓库中的对应资产
    - 目标用户 workspace 中的对应资产
  - 如果其中任一层仍是旧版本，该轮 hosted 结果只能先视为“运行态资产未对齐”，不能直接解释为 prompt/脚本逻辑优劣
- 原因：
  - Qin hosted verifier 已实际出现“本地 verifier 会报风险，hosted 却假绿”的情况
  - 根因不是脚本逻辑错，而是 hosted 运行态仍加载旧资产

## D-020 已消费的联网补充必须进入最终交付

- 决策：
  - 只要 `reports/doc-writer/external-supplements.md` 里的补充资料已经被正文消费，最终交付里的 `参考与依据/联网补充依据` 就必须显式呈现这些来源
  - 不允许再用“如需进一步补充”“建议进行针对性联网检索”这类 future-work 占位话术收口
- 原因：
  - 否则会出现“writer 明明已经补过资料，但最终稿看起来像根本没补过”的假缺失
  - 这会直接降低用户对最终交付的可信度判断

## D-021 背景转载与第一方依据必须分级呈现

- 决策：
  - 若最终稿中保留新闻转载、门户摘要或社区二次传播材料，必须明确标注为“背景参考”
  - 第一方/官方/标准组织来源与背景参考不得混为同一权威层级
- 原因：
  - proposal/申报材料场景里，来源层级本身就是专业度的一部分
  - 混同层级会让文稿看起来完整，但实际权威性表达失真

## D-022 当前 raw vs `common-work` 公平基线先统一到 `MiniMax-2.5`

- 决策：
  - 在当前阶段，`raw OpenCode` 与 `OpenWork common-work` 的基线对比先统一使用 `my-company/MiniMax-2.5`
  - 暂不修改本机全局 `superpowers` 插件来强行让 Qwen 对比先跑通
  - `Qwen3.5-397B-A17B` 仍保留为长期首选模型，但要等它在 raw 本机 OpenCode 路径上的 `system message must be at the beginning` 兼容问题被单独定位和修复后，再恢复为公平基线
- 原因：
  - 当前已经实测确认：本机 raw OpenCode 在空目录下对 `Qwen3.5-397B-A17B` 也会直接报 `System message must be at the beginning`
  - 这会污染“raw OpenCode vs OpenWork common-work”这一步的公平比较，使对比结果先被模型兼容问题劫持
  - 用户当前要求先验证 `common-work >= raw OpenCode` 这条前提，因此优先采用零修改、可立即对齐的 `MiniMax-2.5` 作为当前阶段基线

## D-023 “没有主动调 skill”不等于“skill 没加载”

- 决策：
  - 在比较 raw OpenCode、local OpenWork、pod OpenWork 时，如果某一路径没有主动调用 `skill` 工具，先把它视为两类待区分假设：
    - 能力不可见 / 没加载
    - 能力可见，但被当前 agent prompt 的路由策略压住
  - 在下结论前，必须至少补一次显式可见性探针
- 原因：
  - 当前 raw + `common-work` 的本机诊断已经显示：
    - `common-work` 可以知道 `writing-plans` / `brainstorming` 存在
    - 但旧 prompt 仍会让它更少主动走到这条路
  - 如果不先把“可见性”和“路由选择”拆开，后续很容易在错误层修错问题

## D-024 Qin 主基线收窄为 `raw OpenCode` vs `pod common-work`

- 决策：
  - 保留本轮 `local OpenWork common-work` 的完整结果，作为一条有效参考样本
  - 从下一轮 Qin baseline 起，主比较对象收窄为：
    - `raw OpenCode`
    - `pod OpenWork common-work`
  - `local OpenWork common-work` 改为辅助诊断 lane，只在需要定位 host-mode / 本机 wrapper / 本地 runtime 噪声时再启用
- 原因：
  - 用户已明确表示不希望后续继续被 `local common-work` 这条中间态稀释注意力
  - 当前最终目标更接近真实用户使用的 hosted/pod 路径，而不是本机临时拉起的 host-mode
  - `RL-028` 已经完成一轮三条 lane 的 MiniMax 长跑，已经拿到了足够的 `local` 参考点，不需要每轮都把它放在主基线里

## D-025 hosted 文档运行时改成“workspace-local temp + 搜索工具中立”

- 决策：
  - hosted session 的默认临时目录下沉到当前 session workspace 内，例如 `<WORKSPACE>/.tmp/system`
  - `external_directory` 不再对 `/tmp/*`、`/private/tmp/*` 做 hosted 特例放行
  - `common-work` 不再把某个具体搜索 MCP 写成唯一合法入口，只保留“使用可用搜索工具定位权威来源”的通用规则
- 原因：
  - `/tmp` 是否能被后续文件工具读回，不应继续依赖 prompt 自觉或外部目录例外规则
  - 用户已经明确更正：Bocha 是关键 MCP，但当前不应被硬编码成唯一必走路径
- 运行时边界应该由 server/runtime 负责，prompt 只负责语义和质量纪律

## D-026 在 OpenCode 暴露正式 session env 注入位之前，不依赖 undocumented config hack

- 决策：
  - 当前不把“给 session shell 统一注入 `TMPDIR/TMP/TEMP`”作为已存在能力来假设
  - hosted 文档隔离继续依赖：
    - session workspace
    - workspace-local temp root
    - runtime instructions
    - prompt / skill 对外部 temp 路径的 copy-back 约束
- 原因：
  - 官方 config schema 取证已确认当前没有文档化的顶层 session env 注入面
  - 如果现在硬接 undocumented 字段，很容易把测试环境里的偶然行为误当成稳定产品能力

## D-027 reasoning tag 泄漏只在显示/报告层净化，不改原始消息存储

- 决策：
  - 对 `<think>...</think>` 与孤立 `</think>` 这类 reasoning tag，只在用户可见的显示层和测试报告层做净化
  - 不改底层原始 session message 存储
- 原因：
  - 用户可见面不应该继续被泄漏标记污染
  - 但原始消息仍然是定位 provider / runtime 行为的证据，不能在存储层被悄悄改写

## D-028 compare harness 在 raw `export` 损坏时优先保留行为证据

- 决策：
  - 当 raw lane 的 `opencode export` 返回坏 JSON 时，不把该轮直接判成“无行为数据”
  - compare harness 应优先回退到 `raw.run.jsonl`，保留工具调用和可见摘要证据
- 原因：
  - 评测目标是比较真实 agent 行为，不是比较某一种导出格式是否稳定
  - 如果因为 `export` 坏 JSON 就丢掉 raw 行为层数据，会把测试结论系统性偏向 hosted lane

## D-029 `.tmp` 永远不是最终交付目录

- 决策：
  - 对 `common-work` 及其 hosted 文档任务来说，`.tmp/**` 只允许承载中间产物
  - 任何用户可见最终交付物必须回写到 workspace 稳定路径后，才允许在最终总结中声明“已交付”
- 原因：
  - WJW 实测已证明：如果把最终 `.docx` 留在 `.tmp`，agent 会口头宣称已生成，但下载面拿不到
  - 这不是样例特有问题，而是通用交付收口约束

## D-030 session temp-root 硬约束优先走 OpenCode plugin `shell.env`

- 决策：
  - 不再把“给 hosted session 注入 `TMPDIR/TMP/TEMP`”继续作为 `/session` proxy 层能力来假设
  - session temp-root 的硬约束改为优先通过 OpenCode project plugin 的 `shell.env` hook 实现
  - `common-work.md` 继续只保留：
    - 最终交付物必须留在 `<WORKSPACE>`
    - 外部 temp 路径如果要交给文件工具，必须先 copy-back
- 原因：
- 当前可读到的 OpenCode SDK 已确认普通 `/session create` 没有 `env`
- `shell.env` 是现成的原生 hook，语义和目标都更匹配
- 这条路径比继续增加 prompt 纪律或依赖 undocumented env hack 更稳

## D-031 hosted 运行态隔离要下沉到 OpenWork server，不改 OpenCode 源码

- 决策：
  - 不修改 OpenCode 源码来解决 hosted session 的全局状态串扰
  - hosted 路径改由 OpenWork server 负责：
    - per-session OpenCode 进程
    - per-session `OPENCODE_CONFIG_DIR`
    - per-session `XDG_DATA_HOME`
    - per-session `XDG_STATE_HOME`
    - per-session `XDG_CACHE_HOME`
  - `SessionActivityService` 也要从“workspace 级事件流”升级到“shared workspace + isolated session”双轨模式
- 原因：
  - 单靠 session workspace 隔离，只隔离了 cwd，没有隔离 OpenCode 自己的运行态全局目录
  - 继续靠 prompt/路径纪律修补，只能降低噪音，不能根治 shared runtime state
  - 用户明确要求不要碰 OpenCode 源码，而是把改动收敛在 OpenWork 自己的运行架构里
