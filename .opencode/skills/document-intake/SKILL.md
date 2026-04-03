---
name: document-intake
description: Use when a document task still lacks a stable target document, source inventory, or initial workspace state for downstream steps.
---

# Document Intake

用于建立最小可恢复起点，而不是直接开始写最终文档。

优先产物：

- `.worktree/index.json`
- `.worktree/sources/manifest.json`

必要动作：

- 标出最可能的源文件和目标交付物
- 记录 workspace 相对路径
- 如果目标文档不唯一或存在冲突，明确记为 blocker，而不是静默拍板

工作方式：

- 读取文件名、元信息、短摘录和已有状态即可，不做深度通读
- 如果已有 `.worktree/index.json` 或 `.worktree/sources/manifest.json`，先增量更新，不要整份重写
- 只建立下游真正要用的清单，不生成无主的 scratch 文件

停止条件：

- 下游已经能明确知道“读哪些来源”和“朝哪个目标交付物推进”
