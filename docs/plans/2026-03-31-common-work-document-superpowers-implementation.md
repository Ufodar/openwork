# Common-Work Document Superpowers 实施计划

## 目的

这份计划把 [2026-03-30-common-work-document-superpowers-design.md](docs/plans/2026-03-30-common-work-document-superpowers-design.md) 里的方向，落成一条可执行的实施顺序。

目标不是继续给当前文档栈叠加更多 overlay，而是围绕更薄的 `common-work`、可复用的 workflow package，以及更小的文件型状态面，重建文档增强能力。

## 产品目标

让 `common-work` 在长文档任务上明显强于 raw OpenCode，同时不要求用户做额外的 prompt engineering，也不要求 agent 学会一套很重的产品实现词汇。

成功的标志应该是：

- agent 能更早进入真实材料
- 长任务能从工件恢复，而不是依赖聊天记忆
- 文档行为能跨多种任务形状提升，而不是只对单一样例好用
- 系统暴露给 agent 的概念更少，但产出更稳定

## 工作原则

1. 文件状态是真相源。
2. workflow skills 是主要的行为放大器。
3. CLI helper 是可选加速器，不是心智模型本身。
4. MCP 只是实现细节，除非某项能力真的必须依赖它。
5. `common-work` 是主引擎；`document-writer` 只是更严格的后续 overlay。
6. 样例特有的名词、结构和阶段逻辑，不进入共享 prompt 或 helper。

## 本切片的非目标

这一轮不做下面这些事：

- 不把 `document-writer` 直接重设计成最终形态
- 不强求兼容所有历史 `doc_state` prompt 模式
- 不先建设一大套新的 MCP surface
- 不引入按某个测试样例长出来的 subagent 树
- 不优先围绕 proposal-only 或 bid-only 场景优化

## 目标终态

`common-work` 最终应该只看到这些核心规则：

- workspace 边界
- source-first 行为
- state-first 行为
- authority 和 target 的解析
- completion 前的验证

其他内容应该下沉到：

- 文档 workflow skill package
- 一组最小 durable artifacts
- 必要时才启用的薄 helper surface

## 最小 durable state surface

新的文档工作流应尽量收敛到这组最小状态面：

- `.worktree/index.json`
- `.worktree/sources/manifest.json`
- `.worktree/text/<doc-id>.txt`
- `.worktree/facts.json`
- `.worktree/coverage.json`
- `reports/verify.*`

规则：

- 每个文件都必须能证明自己可跨任务形状复用
- 不能存在“只服务一个评测样例”的状态文件
- agent 重新打开 workspace 后，应当能只靠这组工件判断下一个缺失步骤

## Workflow Package 形态

第一版 package 应使用按操作类型划分的 skills：

- `using-document-workflows`
- `document-intake`
- `document-evidence`
- `document-compose`
- `document-verify`

后续可选再加：

- `document-rewrite`
- `document-review`

这些 skill 应当按文档操作形状路由，而不是按文档题材路由。

## 薄 Helper Surface

第一版 helper layer 应该优先走 CLI。

目标动作：

- `docflow inspect`
- `docflow refresh-source`
- `docflow refresh-facts`
- `docflow verify-deliverable`

约束：

- prompt 只描述这些动作是干什么的，不教冗长命令教程
- helper 输出必须是文件化、可检查、可复用的
- helper 绝不能变成第二真相源

## 实施顺序

### Phase 1：Constitutional Cleanup

把 `common-work` 压回宪法层，只保留：

- `<WORKSPACE>` 边界
- 尽早读取真实材料
- 优先使用 durable state
- 起草前先解决 authority 和 target
- 完成前先验证

从主 prompt 里移除：

- 实现层词汇
- MCP 产品名
- 隐藏拓扑解释
- 反复出现的长任务补丁式救火规则

### Phase 2：State Contract Reset

明确这几个文件的最小 schema：

- `.worktree/index.json`
- `.worktree/sources/manifest.json`
- `.worktree/facts.json`
- `.worktree/coverage.json`

这一阶段要回答：

- 哪些字段是必需的
- 哪些字段是可选的
- 哪个 workflow step 拥有哪些 artifact
- downstream step 能依赖哪些 artifact

### Phase 3：Workflow Skill Package

建立或重塑 workflow package，使其满足：

- `using-document-workflows` 能按任务形状路由
- 每个 skill 的职责都足够窄
- 每个 skill 产出 1-2 个 durable artifacts
- 每个 skill 都明确 entry / exit / handoff

这一阶段不应该再额外制造新的 hidden orchestrator 复杂度，而应该让 active workflow 更显式、更本地化。

### Phase 4：Helper Surface

为 inspect、refresh、verify 增加最小可行 helper contract。

第一版可以是：

- 薄 shell 命令
- repo 内的小脚本
- 不要求先变成 MCP

这一阶段只应在文件 contract 足够稳定后再做。

### Phase 5：Comparison Runs

用新模型跑至少四类任务：

- 多文件总结
- proposal-style drafting
- 现有文档修订
- 基于证据的验证

比较标准不只是输出质量，还包括：

- workflow 是否仍然容易理解
- artifact 是否真的被复用
- rerun 时是否减少了 rediscovery

## 第一刀代码切片

第一刀要故意做得很小：

1. 先把最小 state contract 固化进文档
2. 把 `common-work` 收成宪法层
3. 定义 `using-document-workflows`
4. 打通一条最小 end-to-end 路径：
   - intake
   - evidence
   - compose
   - verify
5. 在 `common-work` 至少对两种任务形状表现强于 raw OpenCode 之前，不急着大改 `document-writer`

## 迁移规则

迁移过程中：

- 如果其他 lane 还依赖旧 `doc_state` / knowledge plumbing，就先保持它们可用
- 但不要继续把共享 prompt 教成 `doc_state_*` 心智模型
- 不要让 `document-writer` 吞掉本应属于 `common-work` 的新能力
- 与其再加一个新阶段，不如先抽出一个可复用 workflow move

## 开放问题

在第一刀或期间，需要回答这些问题：

1. `using-document-workflows` 应该 always-on，还是只在任务明显属于 document work 时调用？
2. 当前 `.worktree/**` 里哪些文件在重置后仍然有存在理由？
3. 第一版 helper layer 能否纯 CLI 而不损伤本地/pod 一致性？
4. 最小可复用的 verification report 格式应该长什么样？
5. `document-writer` 应该在什么时候成为更严格的 overlay，而不是继续作为救火 lane？

## 验证计划

每个 implementation slice 都应验证：

- prompt surface 变小了，而不是变大了
- artifact 数量保持不变或减少
- 至少有一个 downstream step 能直接消费 upstream artifact 而不 rediscover
- agent 不需要靠产品实现词汇也能成功推进
- 同一 workflow 能覆盖多于一种文档任务形状

## 交付结果

这份计划最终应产出：

1. 一个更薄的 `common-work`
2. 一组文档 workflow skills
3. 一个更小、更清楚的 durable state model
4. 一个薄 helper facade
5. 一个按质量、复用性、可恢复性来评估的 comparison harness

## 直接下一步

先做设计到 contract 的收口：

- 明确最小 state schema
- 判断当前 `.worktree/**` surface 哪些保留
- 起草 `using-document-workflows`
- 在 contract 稳定前，保持实现切口尽量小
