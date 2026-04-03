# 第二阶段基线说明

## 目的

这份说明用于把第二阶段重构的“正式起点”固定在 `dev` 上。

它不把实验性控制流改动直接吞回主线，而是只保留：

- 第二阶段已经确认的设计结论
- 第二阶段应该存在的结构骨架
- 哪些内容属于后续实现，而不是当前主线事实

这样 `dev` 可以同时满足两件事：

1. 继续作为当前唯一稳定主线
2. 作为第二阶段重新开工时的唯一起点

## 当前主线已经包含什么

在进入第二阶段之前，`dev` 已经完成的第一阶段收口主要包括：

- `common-work` 已经压回薄宪法层
- `document-writer` 已经压成 controller-only
- active prompt/config/server 主链里的 bid 专用残留已经清掉一大部分
- “相关任务不能跳过 attached knowledge” 这条规则已经进入主线
- 一批连接恢复、session 历史、todo、runtime 泄漏、pod 配置漂移等稳定性问题已经修复并上线

这意味着第二阶段不应该再从“止血和清场”开始，而应该从“如何把新结构正式引入系统”开始。

## 第二阶段已经确认的架构结论

截至目前，已经被确认应当进入第二阶段设计基线的结论有：

### 1. `common-work` 是宪法层

它负责：

- workspace 边界
- source-first
- state-first
- authority / target resolution
- verify-before-finish

它不再承担完整 workflow 控制循环。

### 2. `document-writer` 是长程 controller

它的定位是：

- 读 durable control surface
- 选择下一 phase
- 委派给窄职责 `doc-*`
- 收 receipt 再推进

它不应该再吸收新的实现细节，只应该在真正需要 stricter overlay 时继续演化。

### 3. Workflow package 应按操作形状切分

第二阶段的 package 不是按文档题材，而是按操作类型切：

- `using-document-workflows`
- `document-intake`
- `document-evidence`
- `document-compose`
- `document-verify`

这组 skill 的职责是提供可恢复、可切换、可单步激活的 workflow spine。

### 4. Runtime 动态事实应外置为作者可见层

runtime knowledge instruction 和 runtime document-state instruction 不应继续只藏在 TS 字符串里。

它们应有 authored source file，再由 server 在 runtime 中填充和写入。

### 5. 下一步的大杠杆不是继续写厚 prompt

第二阶段后续最可能的关键工作，不是再加更多 prompt prose，而是探索：

- 更清晰的 runtime fact carrier
- 或一个 `docflow inspect` 类的状态摘要面

但这属于后续实验，不是当前主线事实。

## 本次回流到 `dev` 的第二阶段骨架

本次只把下面这些内容回流到 `dev`：

1. 第二阶段实施计划文档
   - [2026-03-31-common-work-document-superpowers-implementation.md](docs/plans/2026-03-31-common-work-document-superpowers-implementation.md)
2. 第二阶段 workflow skill 骨架
   - `.opencode/skills/using-document-workflows/SKILL.md`
   - `.opencode/skills/document-intake/SKILL.md`
   - `.opencode/skills/document-evidence/SKILL.md`
   - `.opencode/skills/document-compose/SKILL.md`
   - `.opencode/skills/document-verify/SKILL.md`
3. 第二阶段 runtime authored instruction 骨架
   - `.opencode/references/runtime-knowledge-instructions.md`
   - `.opencode/references/runtime-document-state-instructions.md`

这些文件的作用是：

- 把第二阶段的结构边界正式放进主线
- 让后续开发不必再依赖 archive 或已删除 worktree 才能看懂方向
- 把“第二阶段的形状”固定下来

当前它们只代表第二阶段骨架，尚未接入主线控制流与 runtime wiring。

## 明确没有回流到 `dev` 的内容

下面这些内容仍然视为实验，不作为当前主线真相：

### 1. `document-writer` 的第二阶段控制流实验

包括但不限于：

- controller 更进一步收窄的 prompt wording
- `using-document-workflows` 与 `document-writer` 的接线实验
- dedicated `document-writer` runtime skill surface 收窄实验

### 2. hidden `doc-*` prompt 的实验性重写

例如：

- `doc-writer` 的更瘦 drafting contract
- `doc-reader` discovery surface 的进一步实验性收窄
- 依赖第二阶段 runtime wiring 的 phase prompt 微调

### 3. runtime wiring 行为改动

例如：

- `session-workspaces.ts` 中针对第二阶段 workflow 的 runtime allowlist 调整
- runtime instruction authored source 的真正接线

这些都还没有足够验证，不应在当前时点作为 `dev` 主线事实。

## 为什么要这么收口

这样做是为了避免两种常见失败：

1. 把“第二阶段设计方向”与“第二阶段实验实现”混为一谈
2. 在 `dev` 还没成为清晰起点前，就把未经充分验证的控制流逻辑带回主线

当前更健康的节奏应该是：

- 先让 `dev` 明确表达第二阶段是什么
- 再在未来从这个明确起点出发，开一个新的单一分支继续做实现实验

## 重新开启第二阶段时的起点

以后如果继续第二阶段，应从当前 `dev` 出发，并遵守：

1. 只开一个新的阶段分支
2. 先决定最小 runtime fact carrier / `docflow inspect` 是否值得做
3. 只有当新结构能减少 controller 复杂度，而不是叠加复杂度，才继续推进
4. 所有实验都要先满足“不会制造第二真相源”

## 结论

从这一刻开始，`dev` 上关于第二阶段的含义应当被理解为：

- 第一阶段已经完成，主线已稳定
- 第二阶段的设计、骨架和边界已经正式进入主线
- 第二阶段的实验性控制流实现还没有进入主线

这就是当前唯一推荐的重新开工起点。
