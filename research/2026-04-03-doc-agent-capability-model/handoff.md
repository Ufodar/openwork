# Handoff

更新时间：2026-04-08

## 这份 handoff 是给谁的

给后续接手 OpenWork 第二阶段文档重构的 coding agent。

目标不是让新 agent 重新研究一遍，而是让它在最短时间内知道：

- 当前目标是什么
- 哪些结论已经成立
- 哪些东西还没定
- 下一步最合理的动作是什么

## 当前目标

当前不是继续扩展流程，也不是马上进入复杂 harness 实装。

当前目标是：

1. 以广义文档任务为目标，重建基础文档能力模型
2. 结合 harness engineering 的视角，重新审视核心 prompt
3. 先完成 `common-work` 和 `document-writer` 的最小收口
4. 先排清当前 hosted runtime/tool/perms blocker
5. 再为后续真正的 harness 第一刀建立更可靠的起点

## 当前已经确认的结论

- 第二阶段必须同时沿两条轴推进：
  - 文档基础能力模型
  - Harness Engineering
- 过程产物不是没用，但它们不是核心本身。
- 当前系统投入并非全错，但投入重点错位：
  - 恢复与过程控制相对更强
  - 任务建模、观察面、动作面、质量判断相对更弱
- `common-work` 当前更像“方向对，但缺内容”。
- `document-writer` 当前更像“能工作，但太重”。
- 当前 related skills 更适合被视为 harness hooks，而不是已完成的 harness。
- 现有 6-phase / 6-subagent 架构暂时只应视为可运行中间态。
- 当前最新阻塞已经收紧到 runtime/tool/perms mismatch，RL-021 已完成排查收敛：
  - `common-work` 空输入 `write`：模型生成问题，不是 server 缺陷
  - `document/upload` 间歇性 `AbortError`：proxy `keepAliveTimeout` 太短，已修复（65s → 300s）
  - `/message` 坏 JSON：harness 容错问题，不阻塞产品
- `common-work` 的空输入 `write` 不是 `MiniMax-2.5` 单模型现象；`Qwen3.5-397B-A17B` 在同类样例上也能复现。
- `document-writer` 在同一类 Qin 样例上当前明显更稳：
  - 已完成 reader、writer、verifier 的整轮流程
  - 已生成 `outputs/qin-technical-material.md`
  - 到目前为止没有复现 `common-work` 那种主会话空输入 `write`
- 把 `document-writer.permission.task` 收紧为仅允许 `doc-*` 之后，同一类 Qin 样例已不再调用 `general`，并且仍能完成：
  - `doc-reader -> doc-reader -> doc-writer -> doc-verifier -> doc-intake`
- hosted 证据现在必须按两层看：
  - **公网入口层**：上传/连接可能异常慢或 reset
  - **产品内链路层**：即使直连 pod 内部入口，`common-work` 仍会卡进空输入 `write` pending
- compare/debug harness 当前还有一类独立噪音：
  - `/message` 偶发返回坏 JSON
  - 这会让脚本报错退出，但不等于真实 session 没有完成
- RL-017 / RL-018 提供了一条重要的样例证据：
  - 在 Qin 这类长篇、多源、正式交付物样例上，更早进入 `document-writer` workflow，表现明显好于让 `common-work` 自由发挥。
  - 但 RL-019 已经明确：这条证据当前只能保留为研究结论，不能直接被实现成共享产品里的 prompt 关键词 / 长度 / 结构启发式路由。
- 当前研究目录已经被提升为硬约束面：
  - 如果后续代码改动与本目录冲突，默认先停下来修正方向，而不是继续实现。
- 不要把“可自我修正的一两步短弯路”也当成必须用全局禁令消灭的问题。
  - 后续约束重点应放在：
    - 默认观察面
    - phase ownership
    - 不要在同一种错误上反复打转

## 当前最重要的两个文件

1. [README.md](./README.md)
   - 这是总框架。用来回答“问题到底是什么、为什么会这样、下一步应该投在哪些杠杆上”。
2. [prompt-surface-audit.md](./prompt-surface-audit.md)
   - 这是最直接的改写依据。用来回答“`common-work` 和 `document-writer` 里哪些内容该保留、改写、下沉或删除”。

## 进入顺序

建议严格按这个顺序进入：

1. 先读本文件
2. 再读 [decisions.md](./decisions.md)
3. 再读 [status.md](./status.md)
4. 再读 [prompt-surface-audit.md](./prompt-surface-audit.md)
5. 最后再读 [README.md](./README.md)

## 当前不该做的事

- 不要直接继续加新的过程产物
- 不要先写新的 runtime carrier / fact surface
- 不要把第二阶段再次理解成“多加几个 state 文件”
- 不要把基础层 prompt 继续写成技术文档或程序员语境
- 不要现在就把某个业务场景写进共享基础层

## 当前推荐的下一步

Phase 2a prompt 收口（RL-005）、统一面审计（RL-020）、runtime blocker 排查（RL-021）均已完成。
`keepAliveTimeout` 已从 65s 提高到 300s（RL-021 定位的 upload AbortError 根因）。

最合理的下一步是：

1. **广义文档任务最小验证**
   - 选 2-3 个广义文档场景（会议纪要、对比分析、技术摘要等）
   - 分别用 `common-work` 和 `document-writer` 跑一遍
   - 判断 RL-020 精简后的 prompt 表面是否仍然稳定
2. **判断 workflow entry 落点**
   - RL-017/RL-018 的证据仍然有效
   - 可以重新评估 workflow entry 应该落在哪一层
   - 选项：显式产品入口、用户可见的工作形态选择、非样例绑定的通用 harness
3. **场景 skill 基础设施**
   - RL-020 审计标记了 11 条待下沉的场景特定规则
   - 建立技术方案 / API 文档等场景 skill 来承接这些规则
4. 在以上都更清楚后，再决定是否进入 Phase 2b（改 schema / carrier）

## 当前开放问题

这些问题还没有被拍板，不要在后续实现里假装它们已经定了：

- 现有 6-phase / 6-subagent 是否最终应继续保留
- task clarification 是否需要更显式的前置步骤
- 动作面应工作化到什么程度
- 哪个 harness 杠杆应成为第一笔代码改动
- 长篇正式交付物是否应在 `common-work` 中更早路由到显式 `document-writer` harness
- 如果后续确实需要更显式的 workflow entry，应落在什么层，并如何避免再次滑回样例驱动启发式
- 哪些动作级微观禁令其实应该删掉，改成更高层的默认面约束

## 交接纪律

- 后续只要有实质性新判断，先更新 [run-ledger.md](./run-ledger.md)
- 若判断已拍板，再更新 [decisions.md](./decisions.md)
- 若当前优先级或下一步变化，再更新 [status.md](./status.md)
- 不要把关键判断只留在聊天记录里
