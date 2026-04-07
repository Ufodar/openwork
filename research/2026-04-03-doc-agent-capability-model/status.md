# 当前状态

更新时间：2026-04-07

## 当前目标

把 OpenWork 第二阶段拉回到研究目录约束下的正确轨道：

- 保留已经拿到的样例证据
- 撤回把样例观察直接固化成共享产品逻辑的实现
- 先按研究 harness 继续判断 runtime blocker、prompt 边界与真正的 harness 落点

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
- **已完成一轮偏航修正（RL-019）：**
  - 保留了“样例上更早进入 `document-writer` 更稳”的实验性证据
  - 撤回了把该观察直接做成共享产品启发式路由的实现
  - 明确恢复“研究目录是硬约束面”的工作顺序

## 当前最重要的判断

- Phase 2a prompt 改动与研究 harness 仍然成立；偏航的是后续把样例观察直接做成共享产品路由的实现形式，而不是前面的研究框架本身。
- `common-work` 的主风险仍是：
  - 在真实样例上出现空输入 `write`
  - 更广义地说，是长文正式任务下的主循环稳定性不足
- 这个问题已经在 `MiniMax-2.5` 与 `Qwen3.5-397B-A17B` 两条 hosted 样例上都出现过，因此不能简单归为单模型问题。
- `document-writer` 在同类 Qin 样例上当前确实更稳，这是一条重要样例证据；但这条证据当前只支持“后续要继续研究更合适的 workflow entry / harness”，不支持直接把样例驱动路由固化成共享产品默认。
- 在把 `document-writer.permission.task` 收紧为仅允许 `doc-*` 后，同一类 Qin 样例已不再调用 `general`，并且仍能完成 `doc-reader -> doc-reader -> doc-writer -> doc-verifier -> doc-intake` 的闭环；这条配置级收口仍有效。
- 运行时排查的收口原则保持不变：
  - 不为一两步可自我修正的短弯路牺牲通用能力
  - 优先修“默认观察面 / phase ownership / 重复打转”这类会真正破坏主循环的问题
- hosted 排查也继续按两层分开看：
  - 公网入口存在上传/连接毛刺
  - 产品内链路存在 `common-work` 空输入 `write` 等更实质的问题
- compare/debug harness 仍有独立噪音：
  - `/message` 偶发返回坏 JSON
  - 这会让脚本误报失败，但不等于真实 session 没有完成
- RL-017 / RL-018 仍然保留为有效研究证据，但 RL-019 已经明确：
  - 这些证据不能再被当成“当前产品应该自动根据 prompt 关键词/长度改派 agent”的依据
  - 研究目录优先级高于这种样例驱动实现

## 当前还没完成

- **还没有完成对 runtime/tool/perms blocker 的收敛** ← 当前最紧迫
- 还没有给出一个不依赖样例关键词/长度猜测的通用 workflow entry 方案
- 还没有收敛 `document/upload` 的间歇性 `AbortError` 触发条件
- 还没有判断 compare/debug harness 是否要对 `/message` 偶发坏 JSON 做更稳的容错
- 还没有做一轮“排除 runtime 阻塞后的”广义文档任务验证
- 还没有开始真正的 harness 实装（Phase 2b）
- 还没有增强 document-intake/evidence/compose/verify 四个 skill
- 还没有增加自适应流水线深度（变更 5）
- 还没有形成第二阶段的产品级实现计划

## 当前推荐的下一步

1. **继续按研究 harness 排 blocker，而不是继续改路由**
   - 继续查 `common-work` 空输入 `write`
   - 继续把公网入口问题与产品内链路问题分开记录
   - 评估 compare/debug harness 对 `/message` 坏 JSON 的最小必要容错
2. **先做统一面审计，再决定哪一类问题一起改**
   - `common-work`
   - `document-writer`
   - `document-mode-bridge`
   - runtime instructions
   - 必要的 `doc-*` prompts
   - 目标是找出：
     - 哪些属于必要护栏
     - 哪些是过细的动作级纠偏
     - 哪些是技术偏置或样例偏置
3. 在 blocker 与面审计都更清楚之后，再决定：
   - workflow entry 到底应不应该更显式
   - 如果要更显式，应该落在哪一层，而不是先写实现
4. 再做广义文档任务最小验证，并决定 harness 第一刀

## 不建议现在做的事

- 不建议在 runtime blocker 未排清前直接进入 Phase 2b（改大块 schema / carrier）
- 不建议现在继续加更多过程产物
- 不建议把具体业务场景写进基础 prompt
- 不建议继续加任何样例驱动的 prompt 关键词路由、长度路由或结构路由
- 不建议为了压住局部坏习惯，再回到动作级微观禁令堆叠

## 当前目录角色

本目录现在应被视为：

- OpenWork 第二阶段文档重构的当前研究基线
- 后续 coding agent 的 handoff 入口
- Phase 2a 已完成的记录
- 验证轮次和后续改动的上游依据
