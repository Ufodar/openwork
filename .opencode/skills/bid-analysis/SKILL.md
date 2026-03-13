---
name: bid-analysis
description: Use when analyzing a tender package, extracting scoring and requirement items, identifying the main tender file, or building bid state before drafting.
requires:
  - tender_main_file: "招标文件主文件（PDF 或 DOCX，必须可在当前 WORKSPACE 中访问）"
provides:
  - requirements.csv: "需求矩阵"
  - .worktree/index.json: "多轮任务状态根节点（按需）"
  - .worktree/conventions.md: "写作约定与关键决策（按需）"
  - .worktree/material-registry.json: "参考材料索引（按需）"
  - .bid/facts.json: "项目事实基线（按需）"
  - file-triage.json: "文件分类结果（按需）"
---

# Bid Analysis

## Goal

只做分析和提取，不写投标正文。  
你的目标是把招标文件和参考材料整理成后续可继续使用的状态文件。

## Core Rules

### 1. First read beats over-planning

- 最多允许 2 次发现动作后，就必须读到一个真实文件。
- 不要反复 `find` / `ls` / `glob` 却迟迟不读招标文件。

### 2. Reuse existing state

如果这些文件已经存在且内容可信，先复用，再增量更新：

- `file-triage.json`
- `requirements.csv`
- `.worktree/index.json`
- `.worktree/conventions.md`
- `.worktree/material-registry.json`
- `.bid/facts.json`

### 3. Persist only workspace-relative paths

所有写入状态文件的路径都必须使用 workspace 相对路径。  
路径规则以 [bid-session-file-contract.md](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/docs/contracts/bid-session-file-contract.md) 为准。

### 4. Office / path safety at analysis start

- 主文件路径必须直接复用 `find` / `glob` / `ls` 返回的精确值，不要重写中文文件名。
- 不要直接对 `.docx` / `.xlsx` / `.pptx` 使用原始 `read`；优先走对应 Office skill、文本提取、或转换后的缓存文件。
- 若提取方案依赖 `file` / `pandoc` / `soffice` / 特定 Python 模块，先做一次小预检，缺失就切备选路线。
- 同一文件、同一提取方法连续失败 2 次后，必须换工具或换路径来源，不要继续撞同一个错误。

## Minimum Output Contract

### Always produce

- `requirements.csv`

### Produce when useful

- `file-triage.json`
  - 当前工作区文件较多
  - 招标主文件不明显
  - 后续会频繁检索材料
- `.worktree/index.json` + `.worktree/conventions.md`
  - 需求条目较多
  - 任务明显会跨多轮继续
  - 之后还要进入 drafting / qc
- `.bid/facts.json`
  - 当项目名称、公司名、项目编号、预算、截止日期等关键事实已能从招标文件或用户输入中确认
- `.worktree/material-registry.json`
  - 参考材料不少于 5 份
  - 或用户明确需要后续材料检索/匹配

## Procedure

### Step 1: Identify the tender main file

先用一轮轻量发现动作确认 workspace 里有哪些候选文件。  
主文件优先级：

1. 用户明确指定的文件
2. 文件名和内容都明显像主体招标文件的 PDF / DOCX
3. `file-triage.json` 已确认的 `tender_main`

如果有多个候选且无法区分，只问用户一个问题，不要盲猜。

### Step 2: Read the tender in the shortest useful slices

优先读取：

1. 目录 / 章节结构
2. 评分标准 / 评标方法
3. 技术要求 / 项目需求
4. 商务 / 资质 / 交付 / 服务要求
5. 投标文件格式 / 附件 / 模板信息

不要默认一次读完整篇。  
先建立结构，再抽取重点条目。

### Step 3: Route the first extraction by file type

- `.docx`：优先直接读取或提取 XML 文本
- `.pdf`：优先 PDF 读取能力
- `.xlsx/.xls/.csv`：仅在其是附件或报价/清单要求时读取

这里的“直接读取”是指走适合该格式的提取方式，不是对二进制 Office 文件直接使用 `read`。

如果已经提取过全文缓存，优先复用：

- `<WORKSPACE>/.tmp/tender_text.txt`

### Step 4: Build `requirements.csv`

`requirements.csv` 是最低保留面。  
至少覆盖这些信息：

- 需求 ID
- 简短标题
- 招标原文或要求摘要
- 招标定位
- 优先级（如 ★ / # / ● / normal）
- 评分机制
- 状态（默认 `pending`）

若列名使用中文也可以，但语义必须稳定。

参考模板：

- [requirements-matrix-template.csv](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/skills/bid-analysis/references/requirements-matrix-template.csv)

### Step 5: Create durable state only when it will pay off

#### Worktree

当需求条目多、后续会分多轮处理、或下一步明显要进入 drafting / qc 时，创建：

- `.worktree/index.json`
- `.worktree/conventions.md`

字段定义参考：

- [worktree-schema.json](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/skills/bid-analysis/references/worktree-schema.json)

#### Facts

当以下关键信息可被确认时，写入 `.bid/facts.json`：

- 项目名称
- 项目编号
- 投标主体名称
- 预算
- 截止日期
- 其他会被后续质检反复使用的事实

#### File triage

当工作区文件多或材料复杂时，写 `file-triage.json` v2。  
不要写旧版字符串数组结构。

#### Material registry

只有在参考材料足够多、并且后续确实需要“先查索引再开文件”时，才建立 `material-registry.json`。

使用规则参考：

- [material-registry-guide.md](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/skills/bid-analysis/references/material-registry-guide.md)
- [material-registry-template.json](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/skills/bid-analysis/references/material-registry-template.json)

### Step 6: Report only what changes the next action

向用户汇报时，优先给出：

- 评分方法与分值结构
- ★ / 核心项数量
- 关键时间节点
- 明显缺口
- 下一步最合适做什么

不要把整份招标文件复述一遍。

## What Not To Do

- 不要在这个 skill 里撰写投标正文
- 不要为了“看起来完整”强行建立全套状态文件
- 不要反复 listing 而不读真实文件
- 不要把绝对路径写进任何状态文件
- 不要生成 v1 的 `file-triage.json`

## Escalate To User Only When Blocked

只在这些情况提问：

- 招标主文件无法确认
- 招标文件与附件互相冲突
- 评分标准或模板位置明显不清晰
- 用户要直接 drafting，但当前缺少必要的目标文件或关键信息
