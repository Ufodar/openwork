---
name: document-compose
description: Use when a document task already has enough sources or evidence and now needs drafting, revision, expansion, or controlled edits to a target deliverable.
---

# Document Compose

用于起草、改写和定向修补目标文档。

优先输入：

- 现有模板、半成品或用户指定主文件
- `.worktree/facts.json`
- `.worktree/coverage.json`
- 已有文本副本和章节证据

交付纪律：

- 优先保留一份稳定、可重开的源稿，再生成最终交付物
- 长文档通常优先保留 Markdown 之类的可编辑源稿
- 不要把验证和起草混成一个步骤
- 目标路径一旦确定，就持续复用，不要中途改名

工作方式：

- 只修改当前任务真正要求的章节、段落或结构
- 如果用户给了精确标题、系统名、模板结构或交付格式，把它们当成硬约束
- 如果证据不足以高置信写某一段，停下来记录缺口，不要补虚构内容

停止条件：

- 已经形成稳定草稿或更新后的目标文档，并且下一步自然应该进入验证
