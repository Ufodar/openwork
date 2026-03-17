---
name: bid-dedupe
description: Use when comparing two or more bid drafts for risky duplicate text, duplicate images, residual company names, or collusion-style similarity.
requires:
  - bid_docs: "至少 2 份位于当前 WORKSPACE 内的投标文件 .docx"
provides:
  - reports/dedupe/<timestamp>-dedupe-report.md: "查重报告"
---

# Bid Dedupe

## Goal

识别真正有风险的重复，而不是把招标文件规定的固定格式也误报为问题。

## Boundary

- 只比较当前 `<WORKSPACE>` 内的文件
- 所有落盘记录一律使用 workspace 相对路径
- 不比较其他 session 或系统目录中的文件

## Procedure

### Step 1: Confirm the comparison set

先确认要比较的文件清单。  
如果用户没有点名，按当前工作区内最相关的 2 到 4 份投标文件开始，不要一上来扫一切。

### Step 2: Do exact image dedupe first

图片区重是最高风险层。  
先做精确哈希比对，再决定是否需要视觉复查。

关注：

- 拓扑图
- 架构图
- 截图
- 组织架构图
- 方案示意图

相同图片通常比相同表格更危险。

### Step 3: Then do exact text duplicate detection

优先查叙述性章节中的长文本重复：

- 技术方案
- 实施方案
- 售后方案
- 项目团队说明

固定表格、投标函模板、招标文件强制格式不要直接判高风险。

### Step 4: Only do semantic review around suspicious regions

语义相似度检查只对可疑区域做，不做全文漫扫。  
目标是确认这些情况：

- 只是换了公司名和项目名
- 结构相同但措辞略改
- 行业通用表达，不应误报

### Step 5: Check residual entities

额外检查：

- 其他投标方公司名残留
- 旧项目名残留
- 陪标/历史标书中的特定标识未替换

## Report Format

报告按风险级别排序。  
每条发现至少包含：

- 风险级别
- 类型（图片 / 文字 / 残留信息 / 语义相似）
- 文件 A 位置
- 文件 B 位置
- 描述
- 是否属于合理重复

输出路径建议：

- `reports/dedupe/<timestamp>-dedupe-report.md`

## Risk Rules

高风险通常包括：

- 完全相同图片
- 大段叙述重复
- 明显只是替换了公司名/项目名
- 其他投标方实体残留

低风险或合理重复通常包括：

- 招标文件要求的固定格式表格
- 必须一致的声明模板
- 极短、行业通用的常见表述

## What Not To Do

- 不要把所有相似都等价成串标
- 不要忽略图片区重
- 不要把固定格式表格当成主要风险
- 不要在没有明确比较对象时盲扫整个 workspace
