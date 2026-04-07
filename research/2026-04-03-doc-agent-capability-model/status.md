# 当前状态

更新时间：2026-04-07

## 当前目标

把 OpenWork 第二阶段文档重构从"有一个明确的实现起点"推进到"用广义文档任务验证 prompt 层改动的效果"。

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

## 当前最重要的判断

- Phase 2a prompt 改动已落地，但还未经过实际文档任务验证。
- 当前改动是保守的"补能力、去偏置、减噪音"，没有改变架构。
- 下一步的关键判断点是：仅通过 prompt 层改动，广义文档任务的质量能提升多少。

## 当前还没完成

- **还没有做"广义文档任务"的验证轮次** ← 当前最紧迫
- 还没有开始真正的 harness 实装（Phase 2b）
- 还没有增强 document-intake/evidence/compose/verify 四个 skill
- 还没有增加自适应流水线深度（变更 5）
- 还没有形成第二阶段的产品级实现计划

## 当前推荐的下一步

1. **用广义文档任务做一次最小验证**
   - 挑 2-3 个不同类型的文档任务（如：会议纪要、对比报告、技术总结）
   - 用重写后的 common-work agent 执行
   - 对照 D1-D8 质量维度评估产出
   - 看任务意图重建和材料角色识别是否真正起作用
2. 根据验证结果决定 harness 的第一刀具体落在哪
3. 增强四个文档 skill（intake/evidence/compose/verify）

## 不建议现在做的事

- 不建议在没验证的情况下直接进入 Phase 2b（改代码/改 schema）
- 不建议现在继续加更多过程产物
- 不建议把具体业务场景写进基础 prompt

## 当前目录角色

本目录现在应被视为：

- OpenWork 第二阶段文档重构的当前研究基线
- 后续 coding agent 的 handoff 入口
- Phase 2a 已完成的记录
- 验证轮次和后续改动的上游依据
