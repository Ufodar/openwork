# 当前状态

更新时间：2026-04-07

## 当前目标

把 OpenWork 第二阶段文档重构从“只完成了 prompt 层最小收口”推进到“先排清真实 runtime/tool/perms blocker，再进入广义文档任务验证”。

## 已完成

- 已形成一份中文综合研究报告：
  - [README.md](./README.md)
- 已把研究结论明确拆成两条正交轴：
  - 文档基础能力模型
  - Harness Engineering
- 已把三份分轨研究材料与一份 prompt 审计材料合并进总报告：
  - [track-a-capability-model.md](./track-a-capability-model.md)
  - [track-b-harness-engineering.md](./track-b-harness-engineering.md)
  - [synthesis.md](./synthesis.md)
  - [prompt-surface-audit.md](./prompt-surface-audit.md)
- 已完成两份核心 prompt 的结构审计
- **已完成 Phase 2a prompt 层最小收口（RL-005）：**
  - [common-work.md](../../.opencode/agent/common-work.md) 已重写：补入任务意图重建、材料角色识别、质量维度验证；去除技术偏置和实现耦合
  - [document-writer.md](../../.opencode/agent/document-writer.md) 已清理：精简控制面列举、统一委派合约语言、删除偏置补丁
- **已完成 prompt 契约测试的定位收口：**
  - [doc-subagent-prompts.test.mjs](../../packages/app/scripts/doc-subagent-prompts.test.mjs) 现在以“系统护栏”为主，不再冻结旧 prompt 措辞
- **已完成一轮新的 hosted 真实样例排查（RL-006）：**
  - `common-work` 在 `MiniMax-2.5` 基线下卡在空输入的 `write` tool call
  - `document-writer` 在 `MiniMax-2.5` 基线下暴露出 `.worktree/text/**` 读取权限错位

## 当前最重要的判断

- Phase 2a prompt 改动已落地，但真实样例已经证明：当前第一优先级不是继续争论旧 prompt 文案，而是先排 runtime/tool/perms blocker。
- `common-work` 的最新主风险是运行态生成了空输入的 `write` 调用，而不是简单的“能力不足”。
- `document-writer` 的最新主风险是主代理动作面与 runtime 权限面不对齐，尤其是 `.worktree/text/**` 的读取错位。
- 只有先排清这些 blocker，后面的广义文档质量验证才有意义。

## 当前还没完成

- **还没有完成对 runtime/tool/perms blocker 的收敛** ← 当前最紧迫
- 还没有做一轮“排除 runtime 阻塞后的”广义文档任务验证
- 还没有开始真正的 harness 实装（Phase 2b）
- 还没有增强 document-intake/evidence/compose/verify 四个 skill
- 还没有增加自适应流水线深度（变更 5）
- 还没有形成第二阶段的产品级实现计划

## 当前推荐的下一步

1. **先排 runtime/tool/perms mismatch**
   - 查清 `common-work` 空 `write` 调用的触发条件
   - 查清 `document-writer` 为何会去读 `.worktree/text/**`
   - 判断这条路径是该开放、改写还是应完全交给 `doc-reader`
2. 在 blocker 排清后，再做广义文档任务最小验证
3. 根据验证结果决定 harness 第一刀具体落在哪
4. 再增强四个文档 skill（intake/evidence/compose/verify）

## 不建议现在做的事

- 不建议在 runtime blocker 未排清前直接进入 Phase 2b（改大块 schema / carrier）
- 不建议现在继续加更多过程产物
- 不建议把具体业务场景写进基础 prompt

## 当前目录角色

本目录现在应被视为：

- OpenWork 第二阶段文档重构的当前研究基线
- 后续 coding agent 的 handoff 入口
- Phase 2a 已完成的记录
- 验证轮次和后续改动的上游依据
