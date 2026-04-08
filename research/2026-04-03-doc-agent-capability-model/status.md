# 当前状态

更新时间：2026-04-08

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
  - 保留了”样例上更早进入 `document-writer` 更稳”的实验性证据
  - 撤回了把该观察直接做成共享产品启发式路由的实现
  - 明确恢复”研究目录是硬约束面”的工作顺序
- **已完成统一面审计与 D-012 精简（RL-020）：**
  - 审计范围覆盖所有 prompt / bridge / runtime instructions（10 个文件）
  - 审计产物：[unified-surface-audit.md](./unified-surface-audit.md)
  - `doc-writer.md` 从 ~95 行降到 ~65 行，`doc-verifier.md` 从 ~85 行降到 ~60 行
  - `document-writer.md` 从 ~94 行降到 ~78 行
  - 删除/精简约 30 条微观禁令和跨文件重复
- **已完成 runtime/tool/perms blocker 代码排查收敛（RL-021）：**
  - `common-work` 空输入 `write`：模型生成问题，不是 server 缺陷；缓解靠工作流架构
  - `document/upload AbortError`：proxy `keepAliveTimeout=65s` 太短，可修
  - `/message` 坏 JSON：harness 容错问题，不阻塞产品

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

- **runtime/tool/perms blocker 排查已收敛（RL-021）**
  - 三个 blocker 的根因已定位
  - 只有 `document/upload AbortError` 有明确可修的代码根因
  - 其余两个分别是模型问题和 harness 容错问题
- 还没有给出一个不依赖样例关键词/长度猜测的通用 workflow entry 方案
- 还没有收敛 `document/upload` 的间歇性 `AbortError` 触发条件
- 还没有判断 compare/debug harness 是否要对 `/message` 偶发坏 JSON 做更稳的容错
- 还没有做一轮“排除 runtime 阻塞后的”广义文档任务验证
- 还没有开始真正的 harness 实装（Phase 2b）
- 还没有增强 document-intake/evidence/compose/verify 四个 skill
- 还没有增加自适应流水线深度（变更 5）
- 还没有形成第二阶段的产品级实现计划

## 当前推荐的下一步

1. **可选局部修复（低风险）**
   - `serve-web-prod.mjs` 提高 `keepAliveTimeout` 至 120s 以上
   - harness 脚本对 `/message` 坏 JSON 加 retry/try-catch
2. **广义文档任务最小验证**
   - 选 2-3 个广义文档场景（会议纪要、对比分析、技术摘要等）
   - 分别用 `common-work` 和 `document-writer` 跑一遍
   - 判断 RL-020 精简后的 prompt 表面是否仍然稳定
3. **判断 workflow entry 落点**
   - blocker 排查已收敛，RL-017/RL-018 的证据仍然有效
   - 可以重新评估 workflow entry 应该落在哪一层
   - 选项：显式产品入口、用户可见的工作形态选择、非样例绑定的通用 harness
4. **场景 skill 基础设施**
   - RL-020 审计标记了 11 条待下沉的场景特定规则
   - 建立技术方案 / API 文档等场景 skill 来承接这些规则
5. 在以上都更清楚后，再决定是否进入 Phase 2b（改 schema / carrier）

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
