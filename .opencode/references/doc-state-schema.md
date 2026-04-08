# 文档状态 Schema

当前 workspace 使用一层 document-state，让主文档代理能够监督长任务，而无需反复重开原始源文件。

## 设计意图

- 原始源文件不是主会话的默认记忆面
- 子代理把源材料编译成 durable state 文件
- 主代理先读 state，再委派窄后续工作

## 标准状态文件

### `.worktree/index.json`

当前运行的控制面摘要。

推荐字段：
- `version`
- `project`
- `target_doc`
- `phase`
- `summary`
- `current_focus`
- `conventions_ref`
- `children`

### `.worktree/sources/manifest.json`

当前 workspace 的源文件清单。

推荐字段：
- `generated_at`
- `goal`
- `target_doc`
- `sources`
- `blockers`

每个 source entry 推荐包含：
- `docId`
- `title`
- `relativePath`
- `kind`
- `role`
- `status`

### `.worktree/sources/<doc-id>.json`

单份源文档的编译后读取模型。

推荐字段：
- `docId`
- `title`
- `relativePath`
- `kind`
- `role`
- `summary`
- `sections`
- `claims`
- `facts`
- `gaps`
- `open_questions`

### `.worktree/facts.json`

合并后的规范事实面。

推荐字段：
- `goal`
- `target_doc`
- `canonical_facts`
- `evidence_index`
- `gaps`
- `last_merged_at`

### `.worktree/merge/conflicts.json`

显式记录冲突与未解决问题。

推荐字段：
- `conflicts`
- `open_questions`

### `.worktree/plan/solution-plan.json`

面向 writer 的执行计划。

推荐字段：
- `goal`
- `target_doc`
- `recommended_route`
- `sections`
- `dependencies`
- `required_evidence`
- `open_questions`
- `writer_instructions`

### `.worktree/coverage.json`

当前起草覆盖面。

推荐字段：
- `goal`
- `targets`
- `covered`
- `missing`
- `risks`
- `next_checks`

### `.worktree/verify/coverage.json`

verifier 视角下的真实覆盖情况与剩余风险。

推荐字段：
- `checked_at`
- `verified`
- `partial`
- `missing`
- `risks`
- `recommended_next_action`

## 归属模型

- `doc-intake`
  - 写 `.worktree/index.json`、`.worktree/sources/manifest.json`、`.worktree/conventions.md`
- `doc-reader`
  - 写 `.worktree/sources/<doc-id>.json`
- `doc-merger`
  - 写 `.worktree/facts.json`、`.worktree/merge/conflicts.json`
- `doc-planner`
  - 写 `.worktree/plan/solution-plan.json`、`.worktree/coverage.json`
- `doc-writer`
  - 写目标交付物，并刷新 `.worktree/coverage.json`
- `doc-verifier`
  - 写 `.worktree/verify/coverage.json` 和验证报告
