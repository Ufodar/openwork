# Handoff

更新时间：2026-04-07

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
- 当前最新阻塞已经收紧到 runtime/tool/perms mismatch：
  - `common-work` 在真实 Qin 样例里卡在空输入的 `write`
  - compare/debug harness 会把 `/message` 的偶发坏 JSON 误报成产品失败
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
- `common-work` 新增“尽早升级到 `document-writer`”规则后，第一次 hosted 复验还没能进入真实消息循环，就又被第二个大文件上传的 `AbortError` 挡住了。
  - 这说明当前还有一条需要单独排查的 upload blocker，不能直接拿来判断 `common-work` 新路由是否有效。
- 但后续 upload-only 对照又显示：
  - 直连 `8789` 与经过 `32765` proxy 的“两份文件顺序上传”都能成功
  - 所以当前 `document/upload AbortError` 还不能被当成已经定位的稳定代码根因
- 小材料路由探针进一步证明：
  - 当前 `common-work` 即便面对“多源 + 正式技术材料 + 明确结构要求”，也不会主动升级到 `document-writer`
  - 它仍然会先走自己的 `bash/glob` 自由工具面
- 在进一步补强 `common-work` 与 bridge 的升级文案后，新的 follow-up probe 仍然表明：
  - `common-work` 不会稳定发出 `task(document-writer)`
  - 它仍优先走自己的自由工具面，最新可见链路是：
    - `bocha-search -> todowrite -> write`
  - 因此不能再把希望放在“只靠提示词把路由语气写得更重”
- 当前本地代码已经有一个更硬、且通过测试的下一步方案：
  - server 可在首条 `prompt/prompt_async` 时识别“长篇 + 正式交付物 + 多源综合 + 明确结构覆盖”的 `common-work` 请求
  - 然后把这次请求升级成 `document-writer`
  - 同时把 session 元数据与 runtime profile 一起切到 `document-writer`
  - 这条路线目前还没做 hosted 复验
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

`common-work.md` 和 `document-writer.md` 的 Phase 2a 最小收口已完成（见 RL-005）。
但在继续做广义文档质量验证前，先要处理 RL-006 暴露出的 runtime blocker。

最合理的下一步是：

1. **先排 runtime/tool/perms mismatch**
   - 先把当前本地已通过测试的 server-side 首条 prompt 路由部署到 hosted pod
   - 先用小材料 probe 和 Qin 样例复验：它能不能真实把 `common-work` 切进 `document-writer`
   - 再回头看 `common-work` 空 `write` 是否因为路由改变而明显收敛
   - 继续记录 `document/upload` 的间歇性 `AbortError`，但在拿到稳定复现前不要贸然改 upload 代码
   - 评估长篇正式交付物是否应更早升级到 `document-writer` workflow，而不是让 `common-work` 先直接大块写文件；当前证据已经明显支持这条方向
   - 判断 compare/debug harness 是否需要对 `/message` 偶发坏 JSON 做容错，避免脚本失败污染产品判断
2. 在 blocker 排清后，再做 2-3 个广义文档任务验证 prompt 改动效果
3. 根据验证结果增强四个文档 skill（intake/evidence/compose/verify）
4. 再决定 harness 第一刀的落点

## 当前开放问题

这些问题还没有被拍板，不要在后续实现里假装它们已经定了：

- 现有 6-phase / 6-subagent 是否最终应继续保留
- task clarification 是否需要更显式的前置步骤
- 动作面应工作化到什么程度
- 哪个 harness 杠杆应成为第一笔代码改动
- `common-work` 的自由工具面是否需要增加一层“无效空写入”保护
- 长篇正式交付物是否应在 `common-work` 中更早路由到显式 `document-writer` harness
- 这条路由已经有一个本地通过测试的 server-side 版本；当前未决的是它在 hosted 真实样例上是否足够稳、是否需要继续收紧或放宽分类条件
- 如果继续保留 `common-work` 的大工具面，怎样才能只约束“第一动作路由”，而不是再次滑回微观工具禁令
- `document/upload` 的间歇性 `AbortError` 到底由什么稳定触发
- compare/debug harness 对 `/message` 偶发坏 JSON 应该做多强的容错，才不会掩盖真实产品问题
- 哪些动作级微观禁令其实应该删掉，改成更高层的默认面约束

## 交接纪律

- 后续只要有实质性新判断，先更新 [run-ledger.md](./run-ledger.md)
- 若判断已拍板，再更新 [decisions.md](./decisions.md)
- 若当前优先级或下一步变化，再更新 [status.md](./status.md)
- 不要把关键判断只留在聊天记录里
