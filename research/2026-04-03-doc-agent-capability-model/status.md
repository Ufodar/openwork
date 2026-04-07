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
- `common-work` 的空输入 `write` 已在 `MiniMax-2.5` 与 `Qwen3.5-397B-A17B` 两条 hosted 样例上复现，因此它不是单模型特有问题。
- `document-writer` 这条 hosted 工作流当前已经明显稳于 `common-work`；它最新需要单独处理的不是产品闭环缺失，而是 compare/debug harness 对 `/message` 坏 JSON 的误报噪音。
- 同一类 Qin 样例下，`document-writer + MiniMax-2.5` 已完成两轮 prompt、`doc-writer` 与 `doc-verifier`，并生成 `outputs/qin-technical-material.md`；到本轮为止，它没有复现 `common-work` 的空输入 `write`。
- 在把 `document-writer.permission.task` 收紧为仅允许 `doc-*` 后，同一类 Qin 样例已不再调用 `general`，并且仍能完成 `doc-reader -> doc-reader -> doc-writer -> doc-verifier -> doc-intake` 的闭环。
- 运行时排查进入新的收口原则：
  - 不为一两步可自我修正的短弯路牺牲通用能力
  - 优先修“默认观察面 / phase ownership / 重复打转”这类会真正破坏主循环的问题
- hosted 排查已进一步分层：
  - 公网入口存在上传/连接毛刺
  - 即使改走 pod 内部入口，`common-work` 仍会在真实写作阶段卡进空输入 `write` pending
- compare/debug harness 当前也确认了一类独立噪音：
  - `/message` 偶发返回坏 JSON
  - 这会让脚本误报失败，但不等于真实 session 没有完成
- `common-work` 新增“尽早升级到 `document-writer`”规则后，第一次 hosted 复验又被第二个大文件上传的 `AbortError` 挡住了；这说明当前还不能把上传链路问题和 `common-work` 路由问题混为一谈。
- 只有先排清这些 blocker，后面的广义文档质量验证才有意义。

## 当前还没完成

- **还没有完成对 runtime/tool/perms blocker 的收敛** ← 当前最紧迫
- 还没有完成“长篇正式交付物是否应更早升级到显式 workflow harness”的判断
- 还没有收敛 `document/upload` 的长时上传 / `AbortError` 是否已经成为新的首要 hosted blocker
- 还没有判断 compare/debug harness 是否要对 `/message` 偶发坏 JSON 做更稳的容错
- 还没有做一轮“排除 runtime 阻塞后的”广义文档任务验证
- 还没有开始真正的 harness 实装（Phase 2b）
- 还没有增强 document-intake/evidence/compose/verify 四个 skill
- 还没有增加自适应流水线深度（变更 5）
- 还没有形成第二阶段的产品级实现计划

## 当前推荐的下一步

1. **先排 runtime/tool/perms mismatch**
   - 查清 `common-work` 空 `write` 调用的触发条件
   - 查清 `document/upload` 长时上传时的 `AbortError` 是否会稳定阻断新的 hosted 验证轮次
   - 把公网入口问题和产品内链路问题继续分开记录，不再混成同一类 hosted 失败
   - 判断“长篇、多源、正式交付物”是否应更早升级到 `document-writer` workflow；当前证据已经明显偏向“是”
   - 评估 compare/debug harness 是否需要对 `/message` 偶发坏 JSON 做防抖或重试，避免把脚本失败误报成产品失败
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
