---
name: document-evidence
description: Use when a document task needs reusable text extraction, traceable facts, or evidence consolidation before drafting or revision.
---

# Document Evidence

用于把原始材料变成可复用的文本和事实面，避免后续每一步都重新开原文件。

优先产物：

- `.worktree/text/<doc-id>.txt`
- `.worktree/facts.json`

可选辅助产物：

- `.worktree/sources/<doc-id>.json`
- `reports/**` 下的窄范围证据报告

工作方式：

- 优先复用已有文本副本和现有 facts；缺什么补什么
- 一次只编译或补强一个来源，不要把整个语料一次性摊平成长摘要
- 保留定位信息、来源线索和显式不确定项
- 如果多个来源冲突，记录冲突，不要硬合并成“看起来顺”的事实

不要做：

- 不要直接起草最终交付物
- 不要把背景噪音、营销性内容或无关运营细节推进成主事实面
- 不要只把结论留在聊天里而不写回工件

停止条件：

- 下游起草已经可以从 `.worktree/text/` 和 `.worktree/facts.json` 继续，而不必重新发现来源
