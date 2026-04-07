# 研究台账

时间：2026-04-07

## 记录规则

- 这里只记录对第二阶段判断产生实质影响的研究轮次。
- 没有落进这份台账的分析，默认视为不可追溯。
- 后续如果开始改 prompt 或写 harness 代码，也应继续在这里记关键轮次。

## RL-001 形成能力模型与 harness 的双轴框架

- 目标：
  - 回答第二阶段到底在重构什么，避免继续把问题理解成单纯 prompt 微调或流程堆叠。
- 主要产物：
  - [track-a-capability-model.md](./track-a-capability-model.md)
  - [track-b-harness-engineering.md](./track-b-harness-engineering.md)
- 新结论：
  - 文档系统不能只谈内容能力，也不能只谈流程支撑。
  - 必须同时处理：
    - 文档基础能力模型
    - Harness Engineering

## RL-002 形成综合判断并引入冲突清单

- 目标：
  - 把分轨研究真正合并成一份可作为后续依据的总报告。
- 主要产物：
  - [README.md](./README.md)
  - [synthesis.md](./synthesis.md)
- 新结论：
  - 当前 OpenWork 不是“完全没做对”，而是：
    - 恢复面和过程控制面相对更强
    - 任务建模、观察面、动作面、质量判断相对更弱
  - 研究中存在几类关键冲突，必须先摊开再判断：
    - prompt/skill 优先还是 harness/代码优先
    - 动作面该不该工作化
    - 任务澄清是否显式前置
    - 现有 6-phase / 6-subagent 是否过度拆分
    - 当前 skills 是否已经算成熟 harness

## RL-003 审计 `common-work` 与 `document-writer`

- 目标：
  - 找出当前两份核心 prompt 中，哪些内容真属于基础能力，哪些只是 harness、过程支撑、实现细节或窄场景偏置。
- 主要产物：
  - [prompt-surface-audit.md](./prompt-surface-audit.md)
- 审计对象：
  - [common-work.md](../../.opencode/agent/common-work.md)
  - [document-writer.md](../../.opencode/agent/document-writer.md)
- 新结论：
  - `common-work` 方向基本正确，但缺了关键基础能力内容，并残留少量技术偏置与实现耦合。
  - `document-writer` 已经是控制器形态，但仍然太重，还背着较多 workflow prose 和历史补丁痕迹。

## RL-004 把研究目录收成 handoff-ready harness

- 目标：
  - 让后续 coding agent 能在不依赖聊天上下文的情况下继续推进第二阶段。
- 主要产物：
  - [status.md](./status.md)
  - [decisions.md](./decisions.md)
  - [run-ledger.md](./run-ledger.md)
  - [handoff.md](./handoff.md)
- 新结论：
  - 当前第二阶段的正确起点不是直接写 harness 代码，而是：
    - 先按研究结论收口 `common-work`
    - 再减重 `document-writer`
    - 再用广义文档任务验证

## RL-005 执行 common-work 与 document-writer 的 Phase 2a 最小收口

- 目标：
  - 按 prompt-surface-audit.md 和 synthesis.md 的建议，完成两份核心 prompt 的最小重写。
- 主要变更：
  - [common-work.md](../../.opencode/agent/common-work.md)
    - 新增：任务意图重建协议（infer-then-declare）
    - 新增：材料角色识别框架（约束性 / 权威性 / 参考性 / 示例性）
    - 新增：通用质量维度表（D1-D8 浓缩为 8 行验证检查表）
    - 去除：`openwork_knowledge_search` 具体工具名 → 改为"知识检索能力"
    - 去除：技术偏置示例（API / host / 凭证 / URL）→ 改为通用表述
    - 精简：`.worktree/` 路径逐条枚举 → 改为抽象引用
    - 升级：验证环节从"完成检查"升级为"质量维度验证"
    - 精简：durable state 小节降权、噪音路径列举移除
  - [document-writer.md](../../.opencode/agent/document-writer.md)
    - 精简：durable control surface 从逐条路径列举改为一行概括引用
    - 统一：委派合约字段名全部英文化，去除中英混用
    - 删除：第 52 行 non-proposal 补丁式偏置说明
    - 删除：phase ownership 中 `external-support obligations` 等偏具体场景的表述
    - 调整：verifier 阶段加入 quality dimension failures 作为触发条件
- 不变项：
  - Phase routing 结构保留为中间态（D-008）
  - Loop discipline 保留
  - Phase ownership 原则保留
  - 主会话职责和 guardrails 保留
- 新结论：
  - Phase 2a 的 prompt 层最小收口已完成，下一步应进入广义文档任务验证。

## RL-006 Hosted 真实样例复跑后，主风险收紧为 runtime/tool/perms mismatch

- 目标：
  - 验证当前 `common-work` / `document-writer` 在真实 Qin 样例上的主要问题，到底是 prompt 文案、模型基线，还是 runtime/tool 链路。
- 运行基线：
  - repo / GitHub / Gitee / pod 已统一到 `efb7ba0e`
  - pod 已执行 repo-first `git pull gitee dev` + `bash scripts/restart-pod.sh --force`
  - compare/debug 模型基线使用 `my-company/MiniMax-2.5`
- 新证据：
  - `common-work`
    - 脚本：`packages/app/scripts/qin-common-work-debug.mjs`
    - session：`ses_299cf247dffeDnG0Jld9gKniYR`
    - 先读取本地两篇材料并完成一次 `bocha-search`
    - 然后进入 `todowrite`
    - 最后卡在一个 `write` tool call，状态长期 `pending`
    - 该 `write` 调用的 `input` 为空对象 `{}`，不是正常文件写入请求
  - `document-writer`
    - session：`ses_299ca6bd1ffe4gnAn4wt4FfmqP`
    - intake 与 manifest 读取正常
    - manifest 已明确给出 `.worktree/text/src-001.txt` / `src-002.txt` 为 ready
    - 主代理随后尝试直接 `read(.worktree/text/src-001.txt)`，被当前 runtime read permission deny
    - 后续又尝试 `glob(.worktree/text/*.txt)`，同样被 deny
- 新结论：
  - 当前 `common-work` 的主问题不是旧 prompt 契约丢失，而是模型在真实样例里发出了无效的空 `write` tool call，运行态无法自恢复。
  - 当前 `document-writer` 的主问题不是“不会写”，而是主会话动作面与 runtime 权限面不对齐：
    - intake 产出指向 `.worktree/text/**`
    - 但主代理 runtime 不允许读这些路径
  - 因此当前最值得做的，不是继续围绕旧 prompt 文案争论，而是：
    - 收紧 prompt 测试为真实护栏
    - 排查 runtime/tool/perms mismatch
- 后续动作：
  - 更新 compare/debug 脚本默认模型到 `MiniMax-2.5`
  - 优先定位：
    - `common-work` 空 `write` 调用为什么会出现、怎样在 harness 上避免
    - `document-writer` 为什么会去读 `.worktree/text/**`，以及这条路径究竟该被允许、禁止还是改由 `doc-reader` 消费

## RL-007 把“不要缩能力”收成 prompt/harness 护栏

- 目标：
  - 回答一个新的收口问题：为了纠正模型的局部坏习惯，哪些约束值得写进 prompt / bridge / skill，哪些不值得。
- 主要变更：
  - [document-writer.md](../../.opencode/agent/document-writer.md)
    - 保留 controller 默认观察面与 phase ownership 约束
    - 不再把 child-owned readable artifacts 写成近似全局禁令
  - [document-mode-bridge.js](../../.opencode/plugins/document-mode-bridge.js)
    - 保留“优先 readable working surface / control files”这类高层桥接规则
    - 不再把 `.worktree/text/**` 一类路径当成需要硬封死的默认主题
  - hidden `doc-*` prompts：
    - [doc-merger.md](../../.opencode/prompts/doc-merger.md)
    - [doc-planner.md](../../.opencode/prompts/doc-planner.md)
    - [doc-writer.md](../../.opencode/prompts/doc-writer.md)
    - [doc-verifier.md](../../.opencode/prompts/doc-verifier.md)
    - 统一改成：默认不要回退到重读原始面，但必要时允许 narrow source reread
- 新结论：
  - 可自我修正的一两步短弯路，不值得用大量系统提示词或工具禁用去压。
  - 真正该保护的是：
    - 默认观察面
    - phase ownership
    - 不要在同一种错误上反复打转
  - 因此后续 prompt/harness 收口原则应是：
    - 少做全局禁令
    - 少做动作级微观纠偏
    - 多保护主控制循环和默认工作面

## RL-008 把入口层上传噪音与 common-work 内部写入悬挂分离

- 目标：
  - 弄清 hosted Qin 样例中“长时间无结果”到底是公网入口问题、compare harness 误判，还是 common-work 产品内链路真的挂住。
- 新证据：
  - repo / GitHub / Gitee / pod 统一到 `f05ffd09` 后，公网入口运行 `qin-one-shot-compare` 仍不稳定：
    - 外部 `curl http://192.168.5.10:32765/openwork/health` 仍偶发 `connection reset`
    - pod 日志出现一次文档上传 `POST /document/upload 200 171876ms`
  - 改用 SSH 隧道直连 pod 内部 `127.0.0.1:32765` 后：
    - `qin-common-work-debug.mjs` 的两次上传都在几秒内完成
    - common-work 能稳定进入 assistant payload 连续推进阶段
  - 但在隧道条件下，common-work 仍会进入同一个悬挂点：
    - session：`ses_298b4a5a6ffeh2mOCpVd3rwCzQ`
    - runtime dir：`/root/.openwork/user-workspaces/c503a0f6-a558-41f4-8ba4-899eb1ed6923/documents/sessions/3e37240828d7452199fe0ec69da144fc`
    - `/message` 明确显示 pending tool:
      - `tool=write`
      - `raw=\"\"`
      - `input={}`
      - `inputKeys=[]`
    - 这说明它不是正常文件写入，而是空输入 placeholder write 悬挂
- 新结论：
  - 现在必须把问题拆成两层：
    1. **入口层问题**：公网入口存在上传/连接毛刺，会放大比较脚本与真实样例的噪音
    2. **产品内链路问题**：即使绕开公网入口，common-work 仍会在真实写作阶段卡进空 `write` pending`
  - compare/debug harness 的较长 pending timeout 是必要的，但它只能减少假阳性，不能掩盖 common-work 仍然存在的空写入悬挂
- 后续动作：
  - 入口层：
    - 继续把直连 pod 内部入口的结果与公网入口结果分开记录
  - 产品层：
    - 直接定位 common-work 为什么会在写作阶段发出空输入 `write`
    - 不再把这个问题泛化成“prompt 需要更多微观禁令”

## RL-009 `common-work` 空壳 `write` 不是 MiniMax 特有，`document-writer` 在同类样例上更稳

- 目标：
  - 验证 `common-work` 的空输入 `write` 是不是 `MiniMax-2.5` 特有问题；
  - 对照同一类 Qin 样例下 `document-writer` 的运行路径，判断问题更像模型差异还是长文写入 harness 差异。
- 运行基线：
  - hosted 公网入口：`http://192.168.5.10:32765/openwork`
  - 样例：`/Users/storm/Pictures/秦老师` 下两份 `.docx`
  - `common-work` 对照模型：
    - `my-company/MiniMax-2.5`
    - `my-company/Qwen3.5-397B-A17B`
  - `document-writer` 对照模型：
    - `my-company/MiniMax-2.5`
- 新证据：
  - `common-work + Qwen3.5-397B-A17B`
    - session：`ses_29878b962ffef3h5Nl8WLv9rwj`
    - 先完成上传、一次 `bash`、一次 `glob`、一次 `read`
    - 进入真正写作阶段后，`/message` 明确显示：
      - `tool=write`
      - `status=pending`
      - `raw=""`
      - `input={}`
      - `inputKeys=[]`
      - `partId=prt_d67880f76001Hnk5tUq1w77ANJ`
    - 该 pending `write` 在公网入口下持续超过 100 秒，没有变成 concrete `tool-call`
  - `document-writer + MiniMax-2.5`
    - session：`ses_298749434ffe8Ycacu3ejIq6Wx`
    - 已完成：
      - `doc-reader` 子任务 `编译两个源文档内容`
      - `doc-reader` 子任务 `继续完成文档编译`
    - 当前继续推进到新的 `task`：
      - `title=联网检索补充缺口信息`
      - `child=session ses_29871dc10ffeCV4XJGCRWh734G`
    - 到本轮记录为止，没有出现 `common-work` 那种主会话空输入 `write`
- 新结论：
  - `common-work` 的空壳 `write` 不是 `MiniMax-2.5` 单模型现象；至少 `Qwen3.5-397B-A17B` 在同类样例和同一路径上也会复现。
  - 这更像“长文真正落笔时的 tool-call/streaming 半截停住”，而不是“某个模型特殊退化”。
  - 同一类样例下，`document-writer` 至少当前明显更稳：
    - 它继续走 `doc-reader -> 补充/后续 phase`
    - 而不是主会话直接掉进空壳 `write`
  - 当前更值得优先验证的假设是：
    - `common-work` 在长篇正式交付物上过早进入“大块直接写文件”路径；
    - `document-writer/doc-writer` 这条显式 workflow harness 因为先走 state / phase / staging draft，更不容易触发同类半截 `write`
- 后续动作：
  - 继续观察 `document-writer` 是否能进一步进入 writer/verifier，而不是后面再掉进同类空写入
  - 在不增加微观禁令的前提下，评估是否应让 `common-work` 对“长篇、多源、正式交付物”更早升级到 `document-writer` workflow
  - 如果后续证据继续支持这一点，再把“长文写入 harness 比模型差异更关键”提升为正式决策

## RL-010 `document-writer + MiniMax` 在同样例上完成整轮写作与验证，进一步支持“问题主要在写入 harness”

- 目标：
  - 在 RL-009 的基础上继续验证：`document-writer` 是否只是“暂时没挂”，还是能真正完成长文写作与验证。
- 运行基线：
  - hosted 公网入口：`http://192.168.5.10:32765/openwork`
  - 样例：`/Users/storm/Pictures/秦老师` 下两份 `.docx`
  - agent：`document-writer`
  - 模型：`my-company/MiniMax-2.5`
  - harness：`bun run packages/app/scripts/run-qin-doc-writer.mjs`
- 新证据：
  - session：`ses_298749434ffe8Ycacu3ejIq6Wx`
  - 两轮 prompt 均完成：
    - `prompt 1/2`：`261638ms`
    - `prompt 2/2`：`194048ms`
  - 第一轮完成的主要 phase：
    - `doc-reader`：`编译两个源文档内容`
    - `doc-reader`：`继续完成文档编译`
    - `general`：`联网检索补充缺口信息`
    - `general`：`创建材料理解中间状态`
  - 第二轮完成的主要 phase：
    - `doc-writer`：`生成完整技术文档`
    - `doc-verifier`：`验证技术文档完整性`
  - 最终生成：
    - `outputs/qin-technical-material.md`
    - `.worktree/verify/coverage.json`
  - 该轮没有复现 `common-work` 那种主会话空输入 `write`
- 新结论：
  - 同样例、同 hosted 路径、同 `MiniMax-2.5` 基线下，`document-writer` 可以完成长文任务闭环，而 `common-work` 会在真正落笔时卡进空壳 `write`。
  - 这进一步支持当前更强的解释：
    - 主问题不是“模型整体不会写”
    - 也不是“某个模型单独退化”
    - 而是 `common-work` 在长篇正式交付物上更容易进入脆弱的大块直接写入路径；`document-writer` 这条显式 workflow harness 更能把长文写作拆进可完成的 phase 链
  - 因此接下来的第一优先级，应从“继续给 `common-work` 加局部禁令”转向：
    - 什么时候应该更早升级到 `document-writer`
    - 如何让长文写作默认走更稳的 staging / workflow 路径
- 后续动作：
  - 评估是否把“长篇、多源、正式交付物优先升级到 `document-writer`”提升为正式设计决策
  - 继续检查 `document-writer` 当前是否仍有不必要的 `general` 旁路，避免把这条更稳的 harness 又重新做散
  - 再决定要不要修 `common-work` 的长文直写路径，还是直接把这类任务更早路由出去

## RL-011 `document-writer` 收紧为只允许 `doc-*` 后，Qin 样例在 hosted pod 上已不再调用 `general`

- 目标：
  - 验证将 `document-writer.permission.task` 收紧为仅允许 `doc-*` 之后，真实 hosted 样例是否还能完整完成，同时确认 `general` 旁路是否已经消失。
- 运行基线：
  - repo head：`b252066c`
  - hosted pod head：`b252066c`
  - 部署路径：
    - `git push origin dev`
    - `git push gitee dev`
    - pod 执行 `git pull gitee dev`
    - pod 执行 `bash scripts/restart-pod.sh --force`
  - hosted 公网入口：`http://192.168.5.10:32765/openwork`
  - agent：`document-writer`
  - 模型：`my-company/MiniMax-2.5`
  - 样例：`/Users/storm/Pictures/秦老师` 下两份 `.docx`
  - harness：`bun run packages/app/scripts/run-qin-doc-writer.mjs`
- 新证据：
  - session：`ses_298655890ffe0Uh0yFQC7uNEsc`
  - 第一轮 `prompt 1/2` 完成：`368319ms`
  - 对同一 session 直接查询 `/message`，可见 task 链已经变为：
    - `doc-reader`：`编译两个源文档`
    - `doc-reader`：`联网检索行业能力`
    - `doc-writer`：`生成三大系统技术材料`
    - `doc-verifier`：`验证技术材料完整性`
    - `doc-intake`：`更新工作状态`
  - 本轮没有再出现 `general` task call。
  - 同一 session 已生成：
    - `outputs/qin-technical-material.md`
  - `run-qin-doc-writer.mjs` 本轮曾因 `/message` 的一次坏 JSON 响应退出：
    - `SyntaxError: JSON Parse error: Expected '}'`
  - 但这次脚本失败后，再直接查询同一 session，可见：
    - assistant 最终 turn 已 completed
    - `doc-writer` / `doc-verifier` / `doc-intake` 都已 completed
    - 生成文件已存在
- 新结论：
  - 把 `document-writer` 的 task 权限收紧到仅允许 `doc-*` 后，当前 Qin 样例已不再借道 `general`，并且仍能完成整轮 workflow 闭环。
  - 因此当前更强的解释是：
    - `general` 不是 `document-writer` 完成该类长文任务的必要依赖
    - 真正的新增噪音转移到了 compare/debug harness：
      - `/message` 偶发坏 JSON 会让脚本误报失败
      - 不能再把这种脚本失败直接等价成产品失败
- 后续动作：
  - 将“当前 hosted 基线下，`document-writer` 仅允许 `doc-*` 子代理”提升为正式决策
  - 后续比较需要把 `/message` 坏 JSON 视为 harness 噪音单独记录
  - 继续把主注意力放回：
    - `common-work` 的空输入 `write`
    - 长篇正式交付物何时应更早升级到显式 workflow harness

## 当前台账的用途

后续只要发生下面任一类变化，就应追加新轮次：

- 对第二阶段优先级判断产生影响
- 对 `common-work` / `document-writer` 的改写方向产生影响
- 对 harness 第一刀落点产生影响
- 对“当前结构是否过度拆分”的判断产生影响
