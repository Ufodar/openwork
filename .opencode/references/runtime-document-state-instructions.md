# Document State

把现有的 `.worktree/**`、`requirements.csv` 和 `reports/**` 工件当成 durable document-state surface。

Canonical runtime-local helper（如果存在）位于：

- `./.opencode/runtime-support/document-state/init_doc_state.py`
- `./.opencode/runtime-support/document-state/extract_doc_state.py`
- `./.opencode/runtime-support/document-state/merge_doc_state.py`
- `./.opencode/runtime-support/document-state/plan_doc_state.py`
- `./.opencode/runtime-support/document-state/verify_doc_state.py`

Helper 和 state 规则：

1. 如果 phase 对应 helper 存在于 canonical runtime-local path，优先运行它，再考虑手工重建该 phase。
2. 直接测试具体 runtime-local helper path；不要为了找 helper 再用 `glob`、`list` 或 repo-root shell probe 做大范围发现。
3. 即使存在 state-tool overlay，`.worktree/**` 仍然是真相源。
4. 如果 helper 缺失或失败，就直接从现有 durable files 继续，或者明确返回 blocker；不要发明平行 summary surface。
5. 更新 owning files 时保持原地增量更新，并坚持使用 workspace 相对路径。

如果当前 state 缺失或已陈旧，应更新 owning files，而不是发明新的平行摘要层。
如果 state-tool overlay 不可用，就直接从文件继续推进。
