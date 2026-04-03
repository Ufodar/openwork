---
name: document-verify
description: Use when a draft or deliverable already exists and the next step is to check headings, facts, coverage, blockers, or final delivery readiness.
---

# Document Verify

用于把“写完了”变成“经验证可交付”。

优先检查：

- 目标文件是否存在于稳定路径
- 关键标题、章节边界和格式是否对齐
- 主要事实、引用和证据是否仍然成立
- 已知缺口、冲突和 blocker 是否被显式保留

优先产物：

- `reports/verify.md`
- `reports/verify.json`
- 必要时刷新 `.worktree/coverage.json`

工作方式：

- 重新打开或可靠提取最终交付物，再做判断
- 不要只根据会话记忆宣布完成
- 发现问题时，明确指出是“缺段落 / 标题漂移 / 事实不足 / 路径不稳定 / 格式不符”中的哪一类
- 如果问题只是局部修补项，交回 `document-compose`；如果连事实面都不稳，交回 `document-evidence`

停止条件：

- 已确认目标交付物可重开、主要内容通过检查，或者已把剩余风险准确写入验证报告
