# Common-Work Baseline Relaxation

时间：2026-03-26

## 目标

这次修改不是长期产品安全策略调整，而是为了当前 `raw OpenCode` vs `pod OpenWork common-work` 基线测试先扫清非必要障碍，避免比较结果继续被权限拦截和 `/tmp` 路径限制污染。

## 修改内容

### 1. 项目级权限姿态放宽

文件：

- `opencode.json`
- `opencode.jsonc`

调整：

- 新增顶层 `permission = "allow"`
- 给 `common-work` 增加显式 agent permission：
  - `task = allow`
  - `read/write/edit/list/glob/bash/grep/skill = allow`

意图：

- 让当前 `common-work` 基线尽量接近 raw OpenCode 的开放工具姿态
- 避免在这轮测试里继续被 `ask/deny` 打断

### 2. `common-work` prompt 放宽临时路径限制

文件：

- `.opencode/agent/common-work.md`

调整：

- 不再要求中间提取产物只能落在 `<WORKSPACE>/.tmp/` 或 `tmp/`
- 明确允许：
  - `/tmp`
  - `/private/tmp`
  - 工具自然返回的其他系统临时路径
- 改成：
  - 中间产物可以在系统临时目录
  - 最终交付物与可恢复状态优先写回 `<WORKSPACE>`

意图：

- 避免 `common-work` 因为 prompt 自己禁止 `/tmp` 而和当前测试基线冲突
- 先验证它在更接近 raw 的开放环境下，到底能不能把任务做好

### 3. pod 模板已同步

已同步到：

- `/root/ai_staff/openwork/opencode.json`
- `/root/ai_staff/openwork/opencode.jsonc`
- `/root/ai_staff/openwork/.opencode/agent/common-work.md`

### 4. pod 全局配置也已刷成 `allow`

已执行：

- `OPENWORK_GLOBAL_PERMISSION=allow python3 scripts/sync-global-opencode-config.py`

结果：

- `/root/.config/opencode/opencode.json` 当前 `permission = allow`

## 验证

仓库内：

- `python3 -m json.tool opencode.json`
- `python3 -m json.tool opencode.jsonc`
- `bun test packages/app/scripts/doc-subagent-prompts.test.mjs`
- `git diff --check -- ...`

pod 部署面：

- 读回 `/root/ai_staff/openwork/opencode.json`，确认：
  - 顶层 `permission = "allow"`
  - `common-work.permission.* = allow`
- 读回 `/root/ai_staff/openwork/.opencode/agent/common-work.md`，确认：
  - 允许 `/tmp`
  - 不要求先搬回 workspace
- 读回 `/root/.config/opencode/opencode.json`，确认：
  - `permission = allow`

## 备注

这次是测试基线放宽，不代表长期产品安全边界最终拍板。

等 `common-work` 与 raw 基线关系看清后，再决定是否需要把这些放宽策略重新收紧、分环境控制，或者只保留在特定测试/hosted lane 中。
