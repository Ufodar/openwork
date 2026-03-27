# Qin Raw vs Pod `common-work` 对读

时间：2026-03-27

## 输入与会话

- 输入文档：
  - `/Users/storm/Pictures/秦老师/天河监控运维一体化平台软件介绍v0.3.docx`
  - `/Users/storm/Pictures/秦老师/融合算力云平台白皮书.docx`
- 模型：
  - `my-company/MiniMax-2.5`
- 当前正式有效会话：
  - raw：`ses_2d29c9d1dffe4iThsecrQmF8n4`
  - pod：`ses_2d29c971effeFgqEbe3AL4wZ8N`

## 先说明：这轮为什么比前几轮更可信

- compare harness 之前会错误订阅 workspace 级 `/w/<workspace>/opencode/event` 流，这会把 shared hosted 入口噪音带进对比本身。
- compare harness 之前还把“最后一条 assistant message 未 completed”误判成整轮未收口，即使前一条已完成且 `.docx` 已生成。
- 这轮已修正两点：
  - compare/live harness 默认不再依赖 workspace 级 event stream
  - settle 判定改为看“最后一条已完成且有内容的 assistant turn”
- 因此，这轮 `raw vs pod` 结果可以当作当前主 baseline，而不是再混入 harness 自己制造的假阴性超时。

## 产物路径

- raw：
  - `tmp/compare-agents/qin-abc-minimax/raw-opencode-workspace/outputs/融合算力平台三大系统技术材料.docx`
  - `tmp/compare-agents/qin-abc-minimax/raw-opencode-workspace/.tmp/docx-draft/技术材料.md`
- pod：
  - `tmp/compare-agents/qin-abc-minimax/downloads/pod/outputs/三大系统技术方案.docx`

## 工具调用对比

### raw

- `elapsedMs = 213978`
- `opencodeVersion = 1.3.3`
- `toolCounts = { glob: 1, skill: 1, bash: 5, read: 2, webfetch: 2, write: 1 }`
- `toolIssueCounts = { webfetch: 1 }`
- 观察：
  - 成功生成 `.docx`
  - 仍依赖 `.tmp/docx-draft`、`.tmp/docx-read/*` 这类中间 Markdown
  - 这轮仍没有走到 `bocha-search`
  - `webfetch` 仍出现 `The operation was aborted.`
  - `export` JSON 自身损坏，当前结果来自 `run-jsonl` 回退分析，而不是完整 `export`

### pod

- `elapsedMs = 355799`
- `health.version = 1.3.3`
- `toolCounts = { glob: 2, bocha-search_bocha_web_search: 3, skill: 2, bash: 10, read: 2, write: 2, edit: 4 }`
- `toolIssueCounts = {}`
- 观察：
  - 成功生成最终 `.docx`
  - 明确走到了 `bocha-search`
  - 这轮没有再出现 `/tmp/*.md` 权限错误
  - 这轮也没有再出现 `glob/skill` 连接噪音
  - 用户可见总结已只报告稳定相对路径，不再暴露 pod 内绝对路径

## `/tmp` 与 session-local `.tmp`

- 当前最新 pod lane 已确认：
  - 不再把中间稿写到系统 `/tmp`
  - 改为写入当前 session workspace 下的：
    - `<WORKSPACE>/.tmp/whitepaper.md`
    - `<WORKSPACE>/.tmp/monitoring.md`
    - `<WORKSPACE>/.tmp/system/*`
- 这说明之前要优先收掉的“跨 session /tmp 路径碰撞”在当前主 baseline 中已经不再复现。
- 当前看到的 temp 路径已经是 session-local `.tmp`，属于隔离后可接受的中间态，而不是旧的 shared `/tmp`。

## 当前质量判断

- pod 当前优于 raw 的点：
  - 结构更像正式申报技术材料
  - 真实使用了 `bocha-search`
  - 当前 lane 已无工具报错
  - `/tmp` 误用在当前正式 baseline 中已不再出现
- raw 当前优于 pod 的点：
  - 总耗时更短
  - 稳定保留 `.md + .docx` 组合产物
- raw 当前弱于 pod 的点：
  - `webfetch` 仍有失败
  - `export` JSON 仍可能损坏
  - 文稿更像技术草稿式生成，而不是正式申报 prose

## 新结论

- 当前修正后的正式 baseline 已经支持更强的判断：
  - `pod common-work` 不仅“不弱于 raw”，而且在这轮里更像真实最终交付件。
- 当前 `/tmp` 问题的状态也需要更新：
  - 它不是这轮主 baseline 的当前 blocker 了；
  - 最新 pod lane 里已不再复现系统 `/tmp` 读写碰撞，实际中间文件已收回 session-local `.tmp`。
- 下一步应继续盯的重点不再是旧的 shared `/tmp`，而是：
  - raw 的 `webfetch` 不稳定
  - raw 的 `export` 坏 JSON
  - pod 的文稿质量是否能在更多真实样例上继续保持领先
