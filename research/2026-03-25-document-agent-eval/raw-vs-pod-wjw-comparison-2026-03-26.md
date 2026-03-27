# WJW Raw vs Pod 对读

时间：2026-03-26

## 输入与基线

- 样例：
  - 卫健委三文档点对点方案
- 模型：
  - `my-company/MiniMax-2.5`
- lane：
  - raw OpenCode：`ses_2d74acea0ffezKzT9jqcBiRPKH`
  - pod OpenWork `common-work`：`ses_2d74ac031ffea2GsQFgHpo1lEL`

## 直接结论

- 第二真实样例没有推翻当前主基线：`pod common-work` 没有显著弱于 raw。
- 而且在修复 `common-work` 的 `.tmp` 交付收口后，pod WJW 已能稳定同时落出 `.md + .docx`。
- 现在这轮更像是两种文稿风格差异，而不是交付链是否完整：
  - raw 更偏“投标底稿/偏离汇总”
  - pod 更偏“正式方案写法/章节展开”

## 工具行为

### raw

- 可恢复工具统计：
  - `skill: 1`
  - `glob: 1`
  - `bash: 4`
  - `read: 5`
  - `write: 1`
- 主要路径：
  - 使用 `docx` skill
  - `pandoc` 提取三份文档到 workspace-local `.tmp/docx-read`
  - 多次 `read` 招标文件与应答文档
  - 一次性 `write` 成完整 Markdown
  - 再转成 `.docx`

### pod

- 工具统计：
  - `skill: 1`
  - `bash: 5`
  - `read: 5`
  - `write: 1`
- `toolIssueCounts = {}`
- 主要路径：
  - 同样先用 `docx` skill 和本地提取
  - 没有额外搜索、没有 task 拆分
  - 最终只落出 Markdown

## 产物差异

### raw 优点

- 最终直接产出：
  - `点对点解决方案.md`
  - `outputs/点对点解决方案.docx`
- 没有 `[供应商名称]` 这类模板占位残留
- 负偏离项、待确认问题、偏离汇总写得更直给，像投标底稿

### raw 问题

- 正文更像“把招标要求摊平重写”
- `ascii_table_lines` 很高，阅读观感更像工作稿
- 技术展开深度不如 pod，尤其在操作系统能力分解上更平

### pod 优点

- 结构更像正式交付方案
- `需求拆解` 和 `点对点对应方案` 的章节展开更充分
- 对操作系统、超融合、存储、备份恢复的技术分类更完整
- 没有显著工具失败，链路很干净
- 修复后已能稳定回写：
  - `点对点解决方案.md`
  - `点对点解决方案.docx`
- 修复后的 Markdown 已去掉 `[供应商名称]` 占位

### pod 问题

- 早期首轮确实只落出 `.md`，但该问题已在最新回归中修复
- 标题文本仍保留 `第一章 / 1.1 / 1.2.1` 这类人工编号
- 结尾总结仍有模板感

## 当前判断

- 如果按“最终交付像不像正式方案”评，pod 更强。
- raw 仍保留它的优点：偏离汇总更直给、投标底稿感更强。
- 但随着 `.tmp` 收口问题修复，pod 已不再因为“只出 Markdown / 留模板占位”被拉低。
- 所以这轮更准确的判断是：
  - `pod common-work` 在第二真实样例上已经达到“主观质量不弱于 raw，交付链也完整”的状态
  - 下一步该修的是文稿风格细节，而不是基线能力缺失
