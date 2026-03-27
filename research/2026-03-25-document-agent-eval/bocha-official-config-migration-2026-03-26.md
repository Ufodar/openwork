# Bocha Official MCP Migration

时间：2026-03-26

## 背景

- 当前仓库模板、本机全局 OpenCode 配置、pod 运行态配置都存在 Bocha MCP 漂移：
  - 使用第三方 `@iflow-mcp/yoko19191-bocha-ai-mcp-server`
  - 同时保留 `BOCAI_*` 与 `BOCHA_*` 双套变量
  - 仓库 `opencode.json` / `opencode.jsonc` 甚至没有显式声明 `bocha-search`
- 这与 BochaAI 官方仓库 `BochaAI/bocha-search-mcp` 的启动方式不一致。

## 官方基线

根据 BochaAI 官方仓库 `BochaAI/bocha-search-mcp`：

- 启动方式：
  - `uv --directory /path/to/bocha-search-mcp run bocha-search-mcp`
- 必需环境变量：
  - `BOCHA_API_KEY`
- 官方仓库是 Python/uv 项目，不是 npm 包。

辅助核对：

- 官方仓库 `pyproject.toml` 中 `project.scripts` 为 `bocha-search-mcp = "bocha_search_mcp:main"`
- 官方 README 中给出的客户端配置也是 `uv --directory ... run bocha-search-mcp` + `BOCHA_API_KEY`

## 本次修改

### 仓库模板

- `opencode.json`
- `opencode.jsonc`

新增官方 `bocha-search` MCP：

- `command = ["uv", "--directory", "{env:BOCHA_MCP_DIR}", "run", "bocha-search-mcp"]`
- `environment = { "BOCHA_API_KEY": "{env:BOCHA_API_KEY}" }`

### 同步/启动链

- `scripts/sync-global-opencode-config.py`
  - 继续兼容读取旧的 `BOCAI_API_KEY`
  - 但写出时统一为官方命令与 `BOCHA_API_KEY`
  - 默认 MCP checkout 目录改为 `~/.config/openwork/bocha-search-mcp`
- `scripts/pod-init-secrets.sh`
  - 改为生成 `BOCHA_API_KEY` 与 `BOCHA_MCP_DIR`
  - 不再生成 `BOCAI_API_URL`
- `scripts/secrets.env.example`
  - 改为官方变量名
- `scripts/start-pod.sh`
  - 增加 `uv` 保障
  - 增加官方 Bocha MCP checkout 缺失时自动 clone

### 测试

- `packages/app/scripts/sync-global-opencode-config.test.mjs`
- `packages/app/scripts/doc-subagent-prompts.test.mjs`
- `packages/orchestrator/src/runtime-env.test.ts`

都已改成官方变量与官方命令形态。

### 运行面

本机：

- `~/.config/opencode/opencode.json` 已切到官方命令
- 官方 checkout 位于 `~/.config/openwork/bocha-search-mcp`

pod：

- `/root/ai_staff/openwork/opencode.json` 已切到官方模板
- `/root/.config/opencode/opencode.json` 已切到官方命令
- `/root/.config/openwork/secrets.env` 已切到 `BOCHA_API_KEY` / `BOCHA_MCP_DIR`
- 官方 checkout 位于 `/root/.config/openwork/bocha-search-mcp`

## 验证

仓库内验证：

- `python3 -m json.tool opencode.json`
- `python3 -m json.tool opencode.jsonc`
- `bash -n scripts/pod-init-secrets.sh`
- `python3 -m py_compile scripts/sync-global-opencode-config.py`
- `bun test packages/app/scripts/sync-global-opencode-config.test.mjs packages/app/scripts/doc-subagent-prompts.test.mjs packages/orchestrator/src/runtime-env.test.ts`
- `git diff --check -- ...`

运行态验证：

- 本机：
  - `uv --directory /Users/storm/.config/openwork/bocha-search-mcp run python -c "import bocha_search_mcp"`
- pod：
  - `uv --directory /root/.config/openwork/bocha-search-mcp run python -c "import bocha_search_mcp"`

两端都已成功 import。

## 结论

- 当前 Bocha MCP 已从“第三方 npm server + 双变量兼容”迁移为“官方 uv repo + `BOCHA_API_KEY`”
- 这次修改同时覆盖了：
  - 仓库模板
  - 配置同步脚本
  - pod 初始化脚本
  - 本机运行态
  - pod 运行态
- 后续如果再看到 `@iflow-mcp/yoko19191-bocha-ai-mcp-server` 或 `BOCAI_*` 回流，优先检查是否有未同步的旧脚本、旧 pod、旧全局配置在回写。
