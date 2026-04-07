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

## 当前台账的用途

后续只要发生下面任一类变化，就应追加新轮次：

- 对第二阶段优先级判断产生影响
- 对 `common-work` / `document-writer` 的改写方向产生影响
- 对 harness 第一刀落点产生影响
- 对“当前结构是否过度拆分”的判断产生影响
