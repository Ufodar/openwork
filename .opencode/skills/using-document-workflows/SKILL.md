---
name: using-document-workflows
description: Use when a document task is multi-source, long-running, revision-heavy, or likely to benefit from file-backed workflow artifacts instead of chat memory.
---

# Using Document Workflows

在实质性文档任务中，先读到至少一份真实材料或已有状态面，再按当前缺失的工件和任务形状选择下一步。

目标：

- 一次只激活一个 workflow
- 从已有工件恢复，而不是重新发现
- 让每一步都留下下游可复用的状态

先看这些工件：

- `.worktree/index.json`
- `.worktree/sources/manifest.json`
- `.worktree/sources/<doc-id>.json`
- `.worktree/facts.json`
- `.worktree/coverage.json`
- `reports/verify.*`

路由规则：

1. 还没有 workspace 清单、目标文档或来源清单时，用 `document-intake`
2. 已有来源但还没有可靠 source artifact、事实或证据面时，用 `document-evidence`
3. 已经知道目标文档和证据，但还需要起草、改写、扩写或定向修改时，用 `document-compose`
4. 已经有草稿或最终交付物，需要检查章节、事实、缺口或交付路径时，用 `document-verify`

纪律：

- 不要同时混用多个 workflow；完成当前一步，再根据新工件重新判断
- 如果 verifier 返回的只是局部缺口，回到 `document-compose` 做定向修补，再重新验证
- 不要因为用户很着急，就跳过 intake/evidence 直接硬写
- 不要把具体 MCP 名称当成 workflow 名称；workflow 只按任务形状和工件缺口来选
