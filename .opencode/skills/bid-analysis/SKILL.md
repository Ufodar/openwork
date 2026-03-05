---
name: bid-analysis
description: 分析招标文件，提取评标方法、评分标准、资质要求、截止时间等关键信息，确定投标文件结构。触发词：分析招标文件、提取招标要求、评分标准是什么、招标需求分析、提取应答表结构。注意：本 skill 只负责"分析和提取"，不负责"撰写和填写"——后者由 bid-drafting 处理。
requires:
  - tender_main_file: "招标文件 (PDF/DOCX)"
provides:
  - requirements.csv: "需求矩阵"
  - .worktree/index.json: "工作树根节点 (条件: >=10条)"
  - .worktree/conventions.md: "写作约定框架"
  - .worktree/material-registry.json: "材料索引 (条件: 参考文件>=5)"
  - .bid/facts.json: "项目关键事实 (可选)"
  - file-triage.json: "文件分类 (条件: 文件数>=10)"
---

## Workflow

**⚠ 通用约束（适用于本 skill 所有步骤）：**
- 本 skill 只分析和提取，**不撰写**任何投标应答内容（撰写由 bid-drafting 处理）
- 所有输出均为结构化数据文件（`.json`、`.csv`、`.md` 状态文件），不生成独立的文档内容
- **禁止生成 .py / .js / .sh 脚本**——只能调用 `.opencode/skills/` 中已有的脚本
- 如果某个操作失败 2 次，切换方法（见 document-writer 的 2-Strike 规则）

### Step 0: 文件分类（File Triage）

**触发条件**：会话目录下文件数 ≥ 10。低于 10 个文件时跳过此步，直接进入 Step 1。

当用户上传大量文件时，agent 需要先了解"手里有什么"再开始分析。

**流程：**

1. **快速扫描** — 对会话目录下所有文件（递归），仅读取：
   - **重要**：`documents/` 目录在 `.gitignore` 中，glob/grep 无法搜索。使用 `bash: find <SESSION_ROOT>/ -type f` 列出文件。
   - 扫描前先排除目录：`.tmp/`、`.worktree/`、`.bid/`、`reports/`、`.archive/`、`artifacts/`
   - 文件名 + 扩展名 + 文件大小

2. **预过滤（filename-only 分类）** — 在读取任何文件内容之前，先按文件名模式快速分类：

   | 模式 | 分类 | 说明 |
   |------|------|------|
   | `*_page-NNNN.jpg` | `image_asset` | PDF 导出的页面图片，关联到同名 PDF |
   | `ilovepdf_pages-to-jpg*.zip` | `archive` | 包含 JPG 导出的压缩包，跳过 |
   | 文件名含"招标"且为 `.docx/.pdf` | `tender_main` 候选 | 仍需读取内容确认 |
   | `.xlsx/.xls/.csv` 且名含"清单"/"报价"/"价格" | `pricing_data` 候选 | 仍需读取确认 |
   | 文件名含"授权"/"资质"/"营业执照"/"审计" | `qualification` | 仅记文件名，不读内容 |
   | 文件名含"彩页"/"产品"/"数据手册"且为 `.pdf` | `product_doc` | 仍需读取前 2 页确认参数 |

   **关键规则**：`image_asset` 和 `archive` 类文件**不计入分批数量**，不读取内容。它们在 file-triage.json 中单独列出，附带关联的源 PDF 路径。

3. **内容读取分类** — 仅对预过滤后**未能确定分类**的文件读取内容：
   - 前 2 页或前 3000 字符（PDF 用 bash 提取，DOCX 用 pandoc 转文本）
   - **不读全文内容**
   - 将每个文件归入以下类别之一：

   | 类别 | 判断依据 |
   |------|---------|
   | `tender_main` | 含评标方法、投标人须知、技术要求等章节结构的主体招标/采购文件 |
   | `tender_attachment` | 文件名含"格式"/"模板"/"附件"/"清单"；或在 tender_main 中被引用的附件 |
   | `historical_bid` | 含投标函/技术方案/以投标公司视角撰写的历史标书或方案文档 |
   | `qualification` | PDF/图片形式的营业执照、资质证书、业绩合同、审计报告、授权书等 |
   | `pricing_data` | xlsx/csv 格式，含价格/数量/型号等列的报价或清单数据 |
   | `product_doc` | 产品参数表、数据手册、白皮书、说明书等厂商技术资料 |
   | `image_asset` | PDF 导出的页面图片（`_page-NNNN.jpg`）——关联到源 PDF，不单独处理 |
   | `archive` | ZIP/RAR 等压缩包——如内含已提取的文件则跳过，否则标记待提取 |
   | `other` | 无法确信分类的文件 |

4. **输出** — 在会话根目录写入 `file-triage.json`（v2）：

   ```json
   {
     "version": 2,
     "total": 156,
     "classified_by_name": 116,
     "classified_by_content": 13,
     "by_category": {
       "tender_main": [
         { "rel_path": "招标文件.pdf", "name": "招标文件.pdf", "size": 4567890 }
       ],
       "tender_attachment": [
         { "rel_path": "附件/投标文件格式.docx", "name": "投标文件格式.docx", "size": 7340032 }
       ],
       "qualification": [ "..." ],
       "historical_bid": [ "..." ],
       "pricing_data": [ "..." ],
       "product_doc": [ "..." ],
       "image_asset": [ "..." ],
       "archive": [ "..." ],
       "other": [ "..." ]
     },
     "ambiguous": [
       { "rel_path": "附件3.pdf", "name": "附件3.pdf", "size": 204800, "candidates": ["tender_attachment", "qualification"], "reason": "..." }
     ]
   }
   ```

   > 每个 entry 的字段：`rel_path`（session 相对路径）、`name`、`size`。`image_asset` 条目额外包含 `source_pdf` 字段指向关联的 PDF。完整字段约束见 `docs/contracts/bid-session-file-contract.md` Section 7。
   > 兼容说明：如读到 v1（类别值为字符串数组），可兼容读取；**新写入必须为 v2**。

5. **确认** — 向用户展示分类摘要（按类别汇总数量，不逐文件列出），重点确认：
   - `tender_main` 识别是否正确
   - `ambiguous` 项请用户澄清
   - 如果没有识别出 `tender_main` → 必须请用户指定哪个是招标文件

**分批策略**：仅对需要**内容读取**的文件分批（预过滤后的剩余文件）。文件数 > 50 时，分批扫描（每批 20 个）。批次顺序：文件名含"招标"的优先，然后按文件大小降序（大文件更可能是主体文件）。每批结果追加到 file-triage.json。`image_asset` 和 `archive` 不参与分批。

**与后续步骤的衔接**：
- Step 1 直接从 triage 的 `tender_main[].rel_path` 取招标文件
- Step 4.5 使用 triage 分类作为 material-registry 的 `type` 字段初始值
- document-writer 模板探测从 `tender_attachment` 中搜索模板
- bid-drafting 路径 E 从 `qualification` 取资质文件
- bid-drafting 路径 F 从 `pricing_data` 取报价数据

### Step 1: 读取招标文件
读取用户指定的招标文件（通常是 PDF 或 Word）。如果 Step 0 已执行，直接从 `file-triage.json` 的 `tender_main[].rel_path` 取文件路径。

**文本提取方法**（按优先级）：
1. **缓存优先** → 检查 `<SESSION_ROOT>/.tmp/tender_text.txt` 是否存在。如存在且非空，直接读取缓存，**跳过重新提取**。这避免了重复提取同一招标文件消耗大量 token。
2. **DOCX** → `bash: python3 -c "import zipfile,re; z=zipfile.ZipFile('<path>'); xml=z.read('word/document.xml').decode(); print(re.sub(r'<[^>]+>','',xml))" > <SESSION_ROOT>/.tmp/tender_text.txt`
3. **PDF** → `bash: python3 -c "..."` 使用 `pdfplumber` 或 `PyPDF2`，输出到 `<SESSION_ROOT>/.tmp/tender_text.txt`；如未安装则使用 `read` 工具直接读 PDF（Claude 原生支持读 PDF）
4. 回退 → 使用 `read` 工具直接读文件（Claude 可读 docx/pdf）

**重要**：提取结果必须缓存到 `<SESSION_ROOT>/.tmp/tender_text.txt`。后续所有需要引用招标文件全文的步骤（Step 2-5）应读取此缓存文件，而非重新提取原始文档。这可节省数百万 token 的重复消耗。

**分段阅读策略**：招标文件通常 40-100 页。不要一次读全文（可能超 context），按以下顺序分段：
1. 首先读**目录**（通常在前 2 页）→ 了解整体结构和页码范围
2. 读**评分标准**章节（通常在"评标方法"或"评标标准"标题下）→ 确定分值分布
3. 读**项目需求书/技术要求**（通常最长的章节）→ 提取所有要求条目
4. 读**商务要求/资质要求**→ 提取商务和资质条目
5. 读**投标文件格式**章节 → 识别模板结构（供 template_findings 报告）

**常见招标文件结构**（中国政府采购）：
- 第一部分：投标邀请函（项目概况、资格要求、时间节点）
- 第二部分：招标项目要求（技术要求、商务要求、评标方法、**项目需求书**）
- 第三部分：投标须知（投标文件编写规则）
- 第四部分：合同条款
- 第五部分：附件/投标文件格式

### Step 2: 按核心提取清单逐项提取
按下方"核心提取清单"逐项提取信息。特别注意：
- 识别所有带标记（★/#/●/▲）的条目
- 标注每个评分因素的评分机制类型（逐项扣减 vs 档次评分）
- 缺失的信息标注为"未找到"

### Step 3: 确定点对点应答表结构
根据提取的要求条目，确定应答表的行列结构（参见下方"点对点应答表结构"）。

### Step 4: 外化分析结果
- 始终生成 `requirements.csv`（列定义参见 `references/requirements-matrix-template.csv`），方便用户在 Excel 中查看。
- 如提取出 ≥ 10 条要求 → 同时构建 `.worktree/`（结构参见 `references/worktree-schema.json`）：
  字段完整定义见 `references/worktree-schema.json`，此处仅列创建步骤。
  1. 创建 `.worktree/index.json`（总览 + children 列表）
  2. 为每条要求创建 `nodes/<id>.json`（含招标原文、定位、优先级、评分机制）
  3. 创建 `conventions.md`，包含五个区域：
     - **一、格式约定**：暂为空，待撰写阶段首次写入时填充
     - **二、关键决策日志**：空表格框架（决策ID | 决策内容 | 影响节点 | 决策依据 | 记录时间）
     - **三、一致性检查点**：空检查清单框架，待首个关键决策产生后填充
     - **四、格式快照**：空框架，由 document-writer Phase 2 确定目标文档后填充（字体、标题层级、编号格式、表格边框、段落间距）
     - **五、质量基线**：空框架，由 bid-drafting 完成前 3 个节点后自动填充（平均应答字数、实质内容比、偏离标注完整率）
  4. 两者的 status 字段保持同步
  5. 如有需要，生成 `.bid/facts.json`（schema 参见 `references/facts-template.json`），记录项目关键事实（公司名、项目名、项目编号、截止日期、预算等）。此文件供后续 bid-qc 确定性脚本使用。`.bid/` 目录位于会话根目录下，如不存在则创建。
- 如 < 10 条 → 默认只写 requirements.csv；若后续需要执行 Step 4.5（参考文件 ≥ 5），创建**轻量工作树**（`.worktree/index.json` + `conventions.md`，不创建 `nodes/`）以承载 `material-registry.json` 和恢复状态。

### Step 4.5: 构建材料索引（当会话目录下的参考文件 >= 5 个时）

浏览会话目录下的参考文件（用户可能上传到根目录、子目录或任意位置——不要假设 `refs/` 目录存在），构建 `.worktree/material-registry.json`（schema 参见 `references/material-registry-template.json`）。
扫描时排除目录：`.tmp/`、`.worktree/`、`.bid/`、`reports/`、`.archive/`、`artifacts/`。

#### 分批策略（当 file-triage.json 存在时使用）

详细的分批优先级表、每批处理流程、token 预算、渐进式索引规则见 `references/material-registry-guide.md`。

**关键要点**：
- 按类别优先级分 6 批处理（tender_main 最先，other 兜底）
- qualification 类只记文件名 + 子类型，不读内容
- 每子批次完成后立即持久化 registry
- 批次 1-2 完成后即可开始 drafting（不必等全部索引完）

#### 无 file-triage.json 时的回退

如果 Step 0 未执行（文件数 < 10），按原始逻辑处理：对每个文件快速了解内容概要（读取前几页/首 sheet/首 slide），一次性构建 registry。若 `.worktree/` 不存在且需要 registry，先创建轻量工作树（index + conventions）。

**每个文件一个条目**：type、format、covers、useful_for_reqs、quality、caveats
- useful_for_reqs 可在此阶段粗略填写（基于文件内容和 requirements.csv 的匹配），后续阶段逐步精确化
- 该索引是全项目共享的，不是某个节点私有的

此步骤为后续 bid-drafting 阶段提供"先查索引、再开文件"的快速路径。

### Step 4.6: 材料缺口分析（Material Gap Detection）

registry 构建完成后（或批次 1-2 完成后），执行缺口分析：

1. 遍历 requirements.csv 中所有 pending 节点
2. 对每个节点，在 material-registry.json 中搜索 useful_for_reqs 匹配
3. 分类结果：
   - **有直接匹配**（high relevance）→ 标注为 "material_ready"
   - **有间接匹配**（medium/low）→ 标注为 "material_partial"
   - **无匹配** → 标注为 "material_gap"
4. 输出缺口报告到 `.worktree/material-gaps.json`
5. 向用户报告缺口节点，建议补充材料或标记为需要从零撰写

### Step 5: 向用户汇报分析摘要
简要汇报：评标方法、分值分布、★ 项数量、关键时间节点。指出需要用户确认的不确定项。

### Step 5.5: Autopilot 阶段标记（自动执行）

**当本 skill 作为 Autopilot Stage 1 被调用时**，在 Step 5 完成后必须执行：

1. 更新 `.worktree/index.json` 的 autopilot 状态：
   ```json
   {
     "autopilot": {
       "stages": [
         { "id": 1, "status": "done", "progress": "analysis complete" }
       ],
       "current_stage": 1.5
     }
   }
   ```
   - 将 `stages[1].status` 设为 `"done"`
   - 将 `current_stage` 推进到下一个阶段（1.5 如有答疑文件，否则 2）

2. **不要等待用户指令** — 阶段标记是自动的，Stage 1 的所有产出（requirements.csv、index.json、conventions.md、material-registry.json）就绪即标记 done

3. 检查是否存在答疑/补遗文件（文件名含"答疑"/"补遗"/"澄清"）：
   - 如存在 → `current_stage = 1.5`
   - 如不存在 → `current_stage = 2`（跳过 1.5）

---

## 招标文件分析 — 领域知识

### 核心提取清单

分析招标文件时，以下信息必须提取（缺失的标注为未找到）：

- **评标方法**：综合评分法 / 最低价法 / 性价比法
- **分值分布**：商务分 / 技术分 / 价格分 各占多少
- **各评分因素明细**：每个因素的分值、评分标准、评分机制（见下文）
- **投标截止时间** / 开标时间
- **格式要求**：装订方式、份数、命名规范、密封要求
- **资质要求**：必须具备的资质证书、业绩要求、人员要求
- **交货期 / 工期要求**
- **保修期 / 质保期要求**
- **付款方式 / 付款比例**
- **星标/核心产品要求**（见下文标记分类）
- **投标保证金**：金额、缴纳方式、缴纳截止时间

### 招标文件要求标记分类

中国政府采购招标文件使用特殊标记区分要求等级，这直接影响投标策略：

- **★（星号/星标）**= 实质性条款。负偏离 = 废标（投标直接作废）。必须 100% 满足，无商量余地。
- **#（井号）**= 需提供截图/证明材料。投标文件中必须附上对应的产品截图或证明文件说明。
- **●（圆点）**= 需现场演示/视频演示。通常需准备演示视频存入 U 盘随投标文件提交。
- **▲（三角/核心产品）**= 核心产品标记。招标方指定该项必须使用特定品牌/型号/厂商的产品，投标时必须响应指定产品。
- **无标记** = 普通要求。负偏离通常按分扣减（如每项 -1 分），不会直接废标。

**关键**：分析阶段必须识别并分类所有带标记的条目。遗漏一个 ★ 项可能导致整个投标作废。

### 评分机制类型

不同评分因素采用不同评分机制，影响内容撰写策略：

**逐项扣减型**：按负偏离数量扣分（如 # 项 -2 分/项，普通项 -1 分/项）
- 应对策略：追求完整性，确保每项都有明确响应，减少负偏离数量

**档次评分型**：按整体质量分档（如 无瑕疵 8 分 / 1 处瑕疵 5 分 / 2 处瑕疵 2 分 / 3 处及以上 0 分）
- 应对策略：追求深度和质量，宁可少写几项也要确保写的部分精准无误

分析时标注每个评分因素属于哪种机制，供后续撰写阶段参考。

### 模板发现与报告

模板/格式的最终决策由 agent 层（document-writer）管控，本 skill 专注于分析。

但在 Step 1（读取招标文件）过程中，如果发现以下内容，**必须在 index.json 中报告**（`template_findings` 字段）：

- 包含 "投标文件格式"/"响应文件格式"/"投标文件编制格式" 等标题的章节 → 记录章节标题、页码/位置
- 单独的格式模板附件（如压缩包内的 .docx 模板文件）→ 记录文件名和路径
- 格式要求的散落描述（如"投标文件应按以下顺序编排：..."）→ 记录原文和位置

```json
"template_findings": {
  "found": true,
  "type": "embedded_chapter | standalone_file | scattered_description",
  "location": "招标文件.pdf p.78-85 '第七章 投标文件格式'",
  "structure_summary": "包含 9 个章节模板：投标函、法人授权书、资格声明..."
}
```

这些报告供 document-writer 的目标文档决策门使用。如果 agent 层已在分析前完成了模板探测，此报告作为交叉验证。

### 点对点应答表结构

点对点应答表是投标文件的核心交付物，分析阶段需确定其结构：

- 行来源：招标文件的技术/商务要求条目 + 评分细则条目
- 列结构：序号、招标要求原文、响应内容、偏离情况（正偏离/无偏离/负偏离）、证明材料页码
- 星标/核心项单独标注，便于撰写阶段重点关注
- 应答表可能分为商务应答和技术应答两张

### 准确性保障

- 使用 `bash: date -Iseconds` 获取当前精确时间，不要猜测
- 商务关键值（日期、金额、数量）绝不编造，缺失用 `<<TBD: xxx>>` 占位
- 每个提取的事实必须有来源引用：文件名 + 定位信息 + 原文摘录

## Example

用户："分析一下这个招标文件 @某市信息化项目招标文件.pdf"

1. 读取 PDF，发现 82 页，含技术需求 + 商务要求 + 评分标准
2. 提取：综合评分法，技术 60 分 / 商务 20 分 / 价格 20 分
3. 识别 12 个 ★ 项、8 个 # 项、2 个 ● 项
4. 提取出 47 条（≥10）→ 构建 .worktree/（47 个节点）+ requirements.csv
5. 汇报："本项目采用综合评分法，共 47 项要求（12 项★实质性条款），技术标占 60 分..."

### 参考文件

- `references/facts-template.json` — 关键事实的示例 schema（可选参考，非强制格式）
- `references/requirements-matrix-template.csv` — 需求矩阵列定义和示例行（可选参考）
- `references/material-registry-template.json` — 材料索引 schema（Step 4.5 构建时参照）
