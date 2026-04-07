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

## 当前台账的用途

后续只要发生下面任一类变化，就应追加新轮次：

- 对第二阶段优先级判断产生影响
- 对 `common-work` / `document-writer` 的改写方向产生影响
- 对 harness 第一刀落点产生影响
- 对“当前结构是否过度拆分”的判断产生影响
