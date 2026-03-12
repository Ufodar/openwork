---
name: bid-drafting
description: Use when drafting or assembling bid content into a target document, including point-to-point responses, narrative sections, qualification materials, pricing tables, or targeted revisions.
requires:
  - target_doc: "稳定目标文件；来自用户明确指定或 `.worktree/index.json` 的 `target_doc`"
  - tender_or_requirements: "招标文件、requirements.csv、或 `.worktree/index.json` 中至少一种"
provides:
  - target_doc: "已更新的目标文档"
  - requirements.csv: "逐条应答任务的主数据面（按需）"
  - .worktree/index.json: "进度与当前焦点（按需）"
  - reports/drafting-quality.json: "质量检查报告（按需）"
  - reports/assembly-report.json: "响应表装配报告（按需）"
  - reports/verify-report.json: "响应表验证报告（按需）"
---

# Bid Drafting

## Goal

把内容写进一个稳定目标，而不是制造一堆中间稿。  
优先复用已有材料，只有缺口部分才生成新的连接性内容。

## Before Writing

### 1. Confirm the stable target

开始前必须明确 `target_doc`：

- 优先使用用户指定的目标文件
- 其次使用 `.worktree/index.json` 里的 `target_doc`
- 如果两者都没有，只问一个问题：`本轮内容应该写进哪个文件？`

### 2. Rehydrate the current state

如存在，先读取并复用：

- `.worktree/index.json`
- `.worktree/conventions.md`
- `requirements.csv`
- `.bid/facts.json`
- `file-triage.json`
- `.worktree/material-registry.json`

不要每次都从零开始搜索。

### 3. Read before drafting

在真正动笔前，至少读这三类材料中的相关部分：

- 当前目标章节或目标表格
- 对应招标要求
- 直接相关的参考材料

不要先写一大段计划或一大段正文，再回头核对。

## Choose The Right Drafting Mode

不要把所有写作都强行塞进一种流程。

### Mode A: Response-table mode

适用于：

- 点对点应答
- 响应表
- 逐条需求矩阵
- 需要逐项记录状态的评分项

做法：

1. 以 `requirements.csv` 为主数据面更新响应内容
2. 运行质量检查脚本
3. 用确定性脚本把 CSV 装配回 docx
4. 再运行验证脚本确认 docx 和 CSV 一致

命令：

```bash
python .opencode/skills/bid-drafting/scripts/check_drafting_quality.py \
  --requirements <WORKSPACE>/requirements.csv \
  --conventions <WORKSPACE>/.worktree/conventions.md \
  --output <WORKSPACE>/reports/drafting-quality.json

python .opencode/skills/bid-drafting/scripts/assemble_response_table.py \
  --requirements <WORKSPACE>/requirements.csv \
  --target <WORKSPACE>/<target_doc> \
  --output <WORKSPACE>/<target_doc> \
  --report <WORKSPACE>/reports/assembly-report.json

python .opencode/skills/bid-drafting/scripts/verify_docx_table.py \
  --requirements <WORKSPACE>/requirements.csv \
  --target <WORKSPACE>/<target_doc> \
  --output <WORKSPACE>/reports/verify-report.json
```

硬规则：

- 不要靠猜测表格行号直接改单元格
- 有确定性脚本时，不要自造替代流程

### Mode B: Narrative-section mode

适用于：

- 技术方案
- 实施方案
- 售后服务方案
- 商务承诺
- 用户指定的某一章、某一节、某一段

做法：

1. 先定位目标文档中的对应章节或插入位置
2. 从招标要求和参考材料提取事实与结构
3. 组装并改写成符合本项目的内容
4. 直接写回 `target_doc`
5. 把会影响后续章节的决定写入 `.worktree/conventions.md`

硬规则：

- 不要强制把整章内容先绕写进 `requirements.csv`
- 不要用独立 `.md` 章节草稿替代最终标书内容

### Mode C: Qualification assembly

适用于：

- 营业执照
- 资质证书
- 审计报告
- 业绩证明
- 授权书等资格材料整理

参考：

- [route-e-qualification.md](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/skills/bid-drafting/references/route-e-qualification.md)

### Mode D: Pricing mode

适用于：

- 报价表
- 清单映射
- 价格明细填充

参考：

- [route-f-pricing.md](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/skills/bid-drafting/references/route-f-pricing.md)

## Writing Rules

### 1. Reuse beats invention

- 有现成材料时，先抽取、重排、改写
- 只有材料不足时，才生成新的桥接内容

### 2. Facts stay anchored

下列信息必须可追溯：

- 公司名
- 项目名
- 日期
- 金额
- 资质等级
- 型号和技术参数

缺失时不要假装知道。

### 3. Style fidelity matters

写回目标文档时，优先保持原模板的：

- 标题层级
- 编号体系
- 表格结构
- 字体字号
- 段落格式

如果最终视觉风格和目标模板明显不一致，这次写入就是失败的。

### 4. Scripts are allowed, but persistent scratch files are not the default

允许：

- 调用现有 skill 脚本
- 用 inline `python3` / `node` 做提取、清洗、批量检查
- 在 `<WORKSPACE>/.tmp/` 下落临时文件

默认不做：

- 把长期保留的 `.py` / `.js` / `.sh` 草稿脚本写进工作区
- 把独立 `.md` 当最终章节交付
- 为了一个简单改写先搭一个复杂脚本工程

### 5. Do not force full-tender analysis for a narrow request

如果用户只是要改某一段、补某一表、写某一章：

- 只补本轮必要状态
- 只读本轮相关材料
- 不要因为“流程更完整”就把任务拖进全量分析

## Progress And State

当任务会跨多轮持续时：

- 更新 `.worktree/index.json` 的 `current_focus`
- 在 `.worktree/conventions.md` 记录关键决策
- 对逐条应答任务同步更新 `requirements.csv`

当任务只是一次性的局部修改时：

- 不要为了仪式感创建一整套状态

## Failure Policy

### Two-strike rule

同一条路径或同一方法连续失败 2 次后，必须切换：

1. 检查 canonical 路径是否错误
2. 换工具或换路线
3. 仍无法继续时，问用户一个阻塞问题

### High-risk triggers that require stopping

以下情况不要继续盲写：

- `target_doc` 不明确
- 招标文件要求互相冲突
- ★ / 核心项缺少关键材料
- 报价来源不明确
- 发现多个相互矛盾的版本而无法判定哪个为准

## Done Criteria

### Response-table mode

- `requirements.csv` 已更新
- `drafting-quality.json` 已生成并可接受
- `assembly-report.json` 已生成
- `verify-report.json` 无严重错位

### Narrative-section mode

- 目标章节已写回 `target_doc`
- 关键决策已记入 `conventions.md`（如需要）
- 用户能直接继续下一轮，而不需要重新解释你刚做了什么

## What Not To Do

- 不要把所有 drafting 都压成 CSV-only
- 不要忽略已有确定性脚本
- 不要生成脱离目标文档的“最终章节.md”
- 不要在没有明确 target 的情况下盲写
- 不要把长篇泛泛“满足 / 符合 / 响应”当成合格投标内容
