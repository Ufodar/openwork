# common-work Skill / MCP Stack (2026-03-27)

## Goal

让 `common-work` 在新建文档会话里只暴露少量高价值能力：

- 少而准的 session-visible skills
- 按阶段触发的补充 skill
- 小而稳的 MCP 栈
- 不把 generic dev / growth / sales / release 能力带进文档工作区

## Recommended Session-Visible Skills

文档会话默认只保留下面这组：

- `docx`
- `pdf`
- `xlsx`
- `pptx`
- `doc-normalize`
- `doc-coauthoring`
- `content-research-writer`
- `internal-comms`
- `image-enhancer`
- `file-organizer`

补充规则：

- `doc-*` 前缀技能默认允许进入文档会话，因为这类技能天然是文档域能力。
- 其他 skill 不再靠描述词里的 `document` / `report` / `writing` 等关键词模糊放行。
- 这可以避免 `status-report-writer`、`frontend-design`、`mcp-builder`、`skill-creator` 这类看起来“沾边”但会分散文档任务注意力的能力进入默认列表。

## Repo-Level Skill Curation

### Keep

保留两类 skill：

- OpenWork / OpenCode / 桌面端开发直接相关
  - `browser-setup-devtools`
  - `cargo-lock-manager`
  - `frontend-design`
  - `mcp-builder`
  - `opencode-bridge`
  - `opencode-mirror`
  - `opencode-primitives`
  - `openwork-core`
  - `openwork-debug`
  - `openwork-docker-chrome-mcp`
  - `openwork-orchestrator-npm-publish`
  - `release`
  - `skill-creator`
  - `solidjs-patterns`
  - `tauri-solidjs`
- 文档工作和交付直接相关
  - `content-research-writer`
  - `doc-coauthoring`
  - `doc-normalize`
  - `docx`
  - `file-organizer`
  - `image-enhancer`
  - `internal-comms`
  - `pdf`
  - `pptx`
  - `xlsx`

### Remove

从项目内直接删除这些明显偏离 OpenWork 主线和当前文档工作流的 skill：

- `algorithmic-art`
- `artifacts-builder`
- `brand-guidelines`
- `canvas-design`
- `competitive-ads-extractor`
- `developer-growth-analysis`
- `domain-name-brainstormer`
- `invoice-organizer`
- `lead-research-assistant`
- `meeting-insights-analyzer`
- `tailored-resume-generator`

删除标准：

- repo 内没有真实功能链依赖
- 不属于 OpenWork 开发/发布链
- 不属于当前文档 agent 交付链
- 继续保留只会增加技能面噪音

## Recommended common-work Routing

`common-work` 建议按阶段路由，不要一次把所有 skill 都拉进来：

1. 格式处理阶段
   - `docx` / `pdf` / `xlsx` / `pptx`
2. 长文结构共创阶段
   - `doc-coauthoring`
3. 联网补充与引用阶段
   - `content-research-writer`
4. 内部汇报口径润色阶段
   - `internal-comms`
5. 图像/截图质量补救阶段
   - `image-enhancer`

默认原则：

- 先格式，后补充。
- 同一阶段只启一个主补充 skill。
- 不把 generic brainstorming / generic writing 当成文档会话起手能力。

## Recommended MCP Stack

### Keep by default

- `Notion`
  - 用于内部知识库、需求页、决策记录、资料页。
  - 官方文档：<https://developers.notion.com/docs/mcp>
- `Linear`
  - 适合 OpenWork 自身的迭代计划、issue 跟踪、项目执行。
  - 当前项目里已有 quick-connect，保留是合理的。
- `Context7`
  - 用于 SDK / API / 框架 / 产品官方文档检索，适合“文档里要写技术依据、接口说明、产品能力边界”的场景。
  - 官方项目：<https://github.com/upstash/context7>
- `GitHub`
  - 用于 repo 关联的 issue / PR / release / README / 设计文档。
  - 官方文档：<https://docs.github.com/en/copilot/concepts/context/mcp>
- 浏览器 MCP：`Playwright` 或现有 `Control Chrome`
  - 用于登录后页面、真实渲染验证、截图、网页内容无法稳定直接抓取时。
  - 官方 Playwright MCP：<https://github.com/microsoft/playwright-mcp>
- `Sentry`
  - 只在 OpenWork 自身线上故障分析、release 回归、错误追踪场景下保留。
  - 不属于文档会话默认 MCP，但对产品运维仍有价值。

### Do not keep by default

- `filesystem`
  - hosted 文档会话已经有 `<WORKSPACE>` 文件工具边界；再加一层 `filesystem` MCP 只会重复能力并扩大误用面。
- `memory`
  - 长任务优先靠 workspace 内状态文件恢复，不要先引入跨任务记忆层。
- `sequential-thinking`
  - 适合补模型分解能力，但不应成为 `common-work` 默认依赖；文档长任务的主恢复机制仍应是 `.worktree/**`、`reports/**`、Markdown 草稿和结构化状态文件。
- 与文档主线无关的业务 MCP
  - 例如 CRM、支付、营销自动化类 MCP，不应该默认进文档工作区。
  - 对当前 OpenWork 项目，`HubSpot` 和 `Stripe` 不应该继续占据默认 quick-connect 位。

## Why This Stack

依据当前官方资料，MCP 生态里最稳定、最常见的模式并不是“多多益善”，而是：

- 少量高价值 server
- 与任务强相关
- 尽量避免和已有本地/原生能力重复

参考来源：

- MCP 官方 servers 仓库：<https://github.com/modelcontextprotocol/servers>
- GitHub 官方 MCP 文档：<https://docs.github.com/en/copilot/concepts/context/mcp>
- GitHub 官方 GitHub MCP Server 使用文档：<https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server>
- Notion 官方 MCP 文档：<https://developers.notion.com/docs/mcp>
- Notion 官方连接说明：<https://developers.notion.com/guides/mcp/get-started-with-mcp>
- Playwright 官方 MCP 仓库：<https://github.com/microsoft/playwright-mcp>
- Context7 官方仓库：<https://github.com/upstash/context7>
- GitHub MCP Registry 官方博客：<https://github.blog/ai-and-ml/generative-ai/how-to-find-install-and-manage-mcp-servers-with-the-github-mcp-registry/>

## Implementation Guidance

对 OpenWork 当前实现，建议分两层落地：

1. 产品可见层
   - 文档会话的 skill 列表和 slash palette 只暴露上面的最小 skill 集。
   - 全局项目 skill 目录删掉明显无关的 skill，避免 skills 页和命令发现面继续膨胀。
2. common-work 提示层
   - 明确写死“格式优先、补充按阶段启用、MCP 小栈默认、不要为流行而接入”。
3. MCP quick-connect 层
   - 保留 `Notion / Linear / Context7 / Sentry / Control Chrome`
   - 增补 `GitHub` 前，先确认 OpenWork 里采用哪种稳定接入方式
   - 删掉 `HubSpot / Stripe`

这样既能减少新会话噪音，也不会把 `common-work` 变成新的“大杂烩总控 prompt”。
