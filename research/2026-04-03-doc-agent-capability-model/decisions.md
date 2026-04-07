# 决策记录

时间：2026-04-07

## D-001 本目录作为第二阶段文档重构的正式 handoff 包

- 决策：
  - 统一以 `research/2026-04-03-doc-agent-capability-model/` 作为当前第二阶段研究与接手入口。
- 原因：
  - 这里已经包含综合结论、分轨研究材料和 prompt 审计。
  - 不再允许把关键判断只留在聊天记录里。

## D-002 第二阶段必须同时沿两条轴推进

- 决策：
  - 后续所有讨论与实现，统一按两条轴判断：
    - 文档基础能力模型
    - Harness Engineering
- 原因：
  - 只谈能力模型，会得到“懂文档但不稳定”的系统。
  - 只谈 harness，会得到“流程很多但文档不够好”的系统。

## D-003 过程产物有价值，但不得被误当成核心

- 决策：
  - 任何新 state、artifact、receipt、summary、carrier，只有在它能显著改善观察面、动作面、检查面、恢复面时，才算值得存在。
- 原因：
  - 当前系统已经在过程支撑上投入很多，但用户真正感知的是最终文档质量与场景广度。

## D-004 当前第二阶段第一刀先落在 prompt 层最小收口

- 决策：
  - 先改 `common-work`
  - 再改 `document-writer`
  - 暂不先做新的 harness 实装
- 原因：
  - 当前最明显的问题先集中在：
    - 基础能力缺失
    - 技术偏置残留
    - controller 仍偏重
  - 先完成最小收口，才能更干净地判断后续 harness 应该落在哪里。

## D-005 `common-work` 必须优先服务广义文档任务

- 决策：
  - `common-work` 不再允许默认技术文档、程序员语境、API/host/凭证一类示例作为基础心智模型。
- 原因：
  - 第二阶段当前目标不是优化某一类专业文档，而是先提高广义文档任务的能力上限与广度。

## D-006 `document-writer` 定位为严格控制器，不是基础能力载体

- 决策：
  - `document-writer` 的长期角色是长程、强约束、多阶段正式文档任务的控制器。
  - 它不负责定义“什么是好文档”的基础能力模型。
- 原因：
  - 基础能力应落在更通用的基础层。
  - controller 应该优先承担流程控制和门控，而不是承载全部内容理解。

## D-007 当前 skills 只能视为 harness hooks，不能视为已完成的 harness

- 决策：
  - 目前 repo 中与第二阶段相关的 skills，只能被视为潜在 harness 挂点，不得在后续讨论里夸大为“问题已解决”。
- 原因：
  - 当前它们还没有充分承担强观察面、强动作面、强检查面的职责。

## D-008 现有 6-phase / 6-subagent 架构暂视为可运行中间态

- 决策：
  - 目前不把它写死成最终正确结构，也不草率判定为错误架构。
- 原因：
  - 它在恢复与流程控制上确实有价值。
  - 但它是否对广义文档质量最优，目前证据还不够。

## D-009 新 agent 接手时，先读 handoff / decisions / status，再读总报告

- 决策：
  - 后续 coding agent 接手本目录工作时，统一按以下顺序进入：
    - `handoff.md`
    - `decisions.md`
    - `status.md`
    - `prompt-surface-audit.md`
    - `README.md`
- 原因：
  - 这样可以先恢复目标、边界、当前状态，再看完整理论框架，降低接手成本。

## D-010 prompt 契约测试只守护系统护栏，不再冻结旧 prompt 措辞

- 决策：
  - `packages/app/scripts/doc-subagent-prompts.test.mjs` 的定位收成“系统护栏测试”。
  - 不再要求它绑定旧 prompt 的固定标题、旧中英混合字段名或过窄示例措辞。
- 原因：
  - 当前 `common-work` 和 `document-writer` 的 prompt 收口方向已经改变。
  - 如果测试继续冻结旧文案，会干扰我们判断真实产品问题。

## D-011 当前 hosted 文档 compare/debug 基线默认使用 `my-company/MiniMax-2.5`

- 决策：
  - 当前 compare/debug 脚本默认模型统一切到 `my-company/MiniMax-2.5`。
  - 若要复跑 `Qwen3.5-397B-A17B`，通过 `OPENWORK_COMPARE_MODEL` 显式覆盖。
- 原因：
  - 当前 pod 默认模型已经切到 `MiniMax-2.5`。
  - 继续让脚本默认 `Qwen` 会制造基线错位，放大调试噪音。

## D-012 不为可自我修正的短弯路牺牲通用能力

- 决策：
  - 不因为模型偶尔先试错一次 `read` / `glob` / 路径选择，就在基础 prompt、bridge、skill 里铺设大量动作级禁令，也不因此全局禁掉通用工具。
  - 约束重点放在：
    - 默认观察面
    - phase ownership
    - 不要在同一种错误上反复打转
- 原因：
  - 一两次可恢复的短弯路，通常是模型能够自我修正的试探行为。
  - 真正会伤害系统的是：
    - controller 被错误观察面吸住
    - 主循环被重复错误吞掉
    - 为了压局部坏习惯而整体缩小 agent 能力
