---
name: bid-qc
description: Use when checking a bid draft for blocker risks, compliance gaps, fact inconsistencies, qualification issues, or submission-readiness problems.
requires:
  - target_doc: "待检查的投标文件 .docx"
  - tender_file: "招标文件主文件"
  - requirements.csv: "可选，逐条应答检查骨架"
  - .bid/facts.json: "可选，事实校验基线"
provides:
  - reports/qc-deterministic.json: "确定性预检结果"
  - reports/qc-full.md: "完整 QC 报告"
---

# Bid QC

## Goal

先找问题，再谈修改。  
本 skill 的首要产出是**发现项**，不是重写内容。

## Review Priority

发现项按严重度输出：

1. `Blocker`
2. `High`
3. `Medium`
4. `Low`

优先暴露会导致废标、重大扣分、事实错误、资质失效、表格错位的问题。  
不要先沉迷于排版小问题。

## Inputs

必须明确：

- `target_doc`
- `tender_file`

优先复用：

- `.bid/facts.json`
- `requirements.csv`
- `.worktree/index.json`
- `.worktree/conventions.md`

## Procedure

### Step 1: Rebuild the check scope

先确定这次检查的真实范围：

- 是全文件检查，还是只看某几章
- 是合规检查，还是事实/资质/报价的专项检查
- 是否已有 `requirements.csv` 可作为应答清单骨架

如果用户没有特别限定，默认做“全文件 + 重点风险优先”的检查。

### Step 2: Run deterministic pre-screen first

如目标文档尚未解包，先在 `<WORKSPACE>/.tmp/unpacked/<docname>/` 下准备解包目录。  
然后运行确定性脚本：

```bash
python .opencode/skills/bid-qc/scripts/check_deterministic.py \
  --unpacked <WORKSPACE>/.tmp/unpacked/<docname>/ \
  --facts <WORKSPACE>/.bid/facts.json \
  --requirements <WORKSPACE>/requirements.csv \
  --output <WORKSPACE>/reports/qc-deterministic.json
```

重要规则：

- 脚本先跑，LLM 后补
- `pass` 只代表脚本 `scope` 范围内通过
- `uncovered` 列表必须逐项处理

### Step 3: Read uncovered items, not the whole universe

对 `qc-deterministic.json` 中每个 check：

- `fail`：直接记为确定性发现
- `pass`：继续检查 `uncovered`
- `not_applicable`：手工补查该维度
- `skip`：看是否缺少输入，可否补齐

这一步的目标是把注意力集中在脚本没覆盖到的高风险区域，而不是全文漫游。

### Step 4: Use visual checks only where they matter

当检查对象涉及扫描件、资质图片、营业执照、审计报告、业绩合同、授权书时，启用视觉检查路径。

参考：

- [vision-agent-protocol.md](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/skills/bid-qc/references/vision-agent-protocol.md)

视觉层主要负责：

- 从图片里提取公司名、证书类型、有效期、金额、日期等可见事实
- 检查图片是否清晰、是否张冠李戴

LLM 负责：

- 语义判断
- 与招标要求的匹配
- 与事实基线的交叉核对

### Step 5: Emit findings-first report

报告必须以问题列表为主体，不要先写长篇概述。  
每条问题都要包含：

- 严重度
- 维度
- 位置
- 问题描述
- 修复建议
- 置信度

置信度标签：

- `确定性`：来自脚本 fail
- `视觉提取`：来自图像提取/识别
- `判断性`：来自语义审查

参考门控清单：

- [qc-checklist.md](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/skills/bid-qc/references/qc-checklist.md)

## High-Value Check Dimensions

优先检查这些维度：

- ★ / 核心项是否缺失或实质性不足
- 公司名、项目名、项目编号是否一致
- 日期是否冲突或过期
- 报价总价、分项合计、预算约束
- 资质和授权是否匹配投标主体与项目要求
- 点对点应答是否空洞、缺页码、缺偏离说明
- 页眉页脚、残留旧项目名、残留其他公司名

## What Not To Do

- 不要在没有 findings 的情况下先重写整份文档
- 不要把所有精力放在低风险排版问题上
- 不要忽略 `uncovered`
- 不要把脚本 `pass` 误当成“这一维度已经完全没问题”

## Stop And Ask Only If Blocked

只在这些情况提问：

- `target_doc` 或 `tender_file` 不明确
- 缺少关键输入，导致某个高风险维度无法判断
- 用户需要你直接修复，而不是先报告问题
