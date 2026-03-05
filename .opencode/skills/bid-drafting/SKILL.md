---
name: bid-drafting
description: 撰写/组装商务标或技术标内容——填写应答表、编写技术方案、商务承诺等。触发词：写技术方案、写商务标、填应答表、填写点对点应答、撰写投标文件、组装标书内容。注意：本 skill 只负责"撰写和填写"，前置的"分析和提取"由 bid-analysis 处理。
requires:
  - target_doc: "目标文档路径, 来自 .worktree/index.json 的 target_doc 字段或用户 @ 引用"
  - requirements_source: "requirements.csv 或 .worktree/index.json (至少一个)"
  - conventions.md: "写作约定, 来自 .worktree/conventions.md (如不存在则本 skill 创建)"
provides:
  - filled_target_doc: "已填充内容的目标文档"
  - updated_worktree: "更新后的 .worktree/ 状态 (current_focus, node status)"
  - reports/drafting-quality.json: "确定性自检报告 (可选)"
---

## Workflow

### Step 1: 确认前置条件 + 恢复进度

**前置检查（强制）：**
0. 确认目标文档已确定。读取 `.worktree/index.json` 中的 `target_doc` 字段，或检查用户是否通过 @ 指定了目标文件。如果两者均无 → **停止**，提示用户先确定目标文档（"往哪个文件里写？"）。不要硬编码搜索 `target/` 目录。

1. 检查 `.worktree/index.json` 是否存在：
   - 如有 → 读取 index.json 获取总览和 current_focus，读取 conventions.md 恢复写作约定，以此为任务清单。如 conventions.md 不存在，按 `bid-analysis/references/worktree-schema.json` 的 conventions.md 定义创建（五个区域：格式约定、关键决策日志、一致性检查点、格式快照、质量基线）。首次撰写前必须完成此创建。
   - 如无 → 检查 requirements.csv，如有则以其为任务清单
   - 都无 → 向用户确认先做分析还是直接撰写
2. 恢复工作树后，从 current_focus 指向的节点继续，不要从头开始

### Step 2: 确定写作范围
与用户确认本轮要写的部分（整个商务标？整个技术标？某几个章节？某张应答表？）。

### Step 3: 逐项撰写（写入 CSV，不直接改 docx 表格）

**⚠ 核心规则：应答内容只写入 requirements.csv，不要用 python-docx 代码直接操作 docx 表格。**

LLM 生成的 python-docx 代码存在系统性的表格行索引错位问题（off-by-N），导致内容写入错误的单元格。因此：
- ✅ 将应答内容写入 requirements.csv 的"响应内容"列
- ✅ 将偏离标注写入 requirements.csv 的"偏离情况"列
- ✅ 将证明材料页码写入 requirements.csv 的"证明材料页码"列
- ❌ 不要生成 python-docx 代码来写表格单元格
- ❌ 不要用 `table.rows[i].cells[j]` 之类的代码操作目标文档

CSV 写入完成后，由 Step 4.7 的确定性脚本负责将 CSV 内容组装到 docx 表格中。

按工作树节点（或 csv 行）逐项处理。每个节点的处理流程：
1. 读取 conventions.md（刷新约束和决策记忆）
   - 首次撰写时如"四、格式快照"为空，先读取目标文档样式基线（字体、标题层级、段落间距），写入格式快照区
   - 前 3 个节点完成后如"五、质量基线"为空，计算前 3 个节点的平均应答字数和实质内容比，写入质量基线区
2. **材料查找流程**（按优先级）：
   a. 如有 `.worktree/material-registry.json` → 先查索引的 `useful_for_reqs` 字段定位候选材料
   b. 如无 registry 或 registry 中无匹配 → 按 `file-triage.json` 的分类筛选（product_doc + historical_bid 优先）
   c. 如连 triage 也无 → 用 `bash: find` 搜索会话目录，排除 `.tmp/`、`.worktree/`、`.bid/` 等
   d. **★/# 项的材料搜索不可跳过** — 即使 registry 标记为 material_gap，也要尝试从产品文档中提取相关能力描述
3. 读取节点的 node.json（获取招标原文和已搜集材料）
4. 从候选材料中提取/组装内容（组装优先于生成）
   - **技术指标类**：从产品彩页/数据手册提取具体参数
   - **能力/方案类**（如"本地化部署"、"二次开发"）：从产品白皮书/技术方案中提取架构说明和功能描述，结合招标要求组织应答
   - **资质/证明类**：引用文件名和页码即可，内容在路径 E 组装
5. 每条应答使用下方"点对点应答 Output Template"的格式
6. 如搜集到新材料 → 更新 material-registry.json 和节点的 materials 列表
7. 如搜索某路径未果 → 记录到节点的 materials[].searched_paths
8. **完成一项立即更新 requirements.csv**（写入响应内容、偏离情况、证明材料页码列，更新 status 为 done）
9. 如有工作树，同步更新节点 status + index.json summary/current_focus

### Step 4: 完整性检查
撰写完成后，用下方"完整性检查清单"核对是否遗漏。

### Step 4.5: 确定性自检（Deterministic Self-Check）

运行确定性自检脚本验证已撰写的应答质量：

```bash
python .opencode/skills/bid-drafting/scripts/check_drafting_quality.py \
  --requirements <SESSION_ROOT>/requirements.csv \
  --conventions <SESSION_ROOT>/.worktree/conventions.md \
  --output <SESSION_ROOT>/reports/drafting-quality.json
```

处理结果：
- `response_length` fail → 标记对应节点为 needs_review
- `bare_satisfy` fail → 立即重写该条应答（最常见的质量问题）
- `star_substance` fail → Blocker，必须补充实质内容
- `tbd_unresolved` fail → 检查是否有可用材料，有则填写，无则保持 TBD 但标记 blocked
- `quality_trend` fail → 向用户报告衰减指标，建议暂停

### Step 4.7: 表格组装（CSV → docx，确定性脚本）

**在应答内容全部写入 CSV 后**，运行确定性组装脚本将 CSV 中的应答数据填入目标文档的表格：

```bash
python .opencode/skills/bid-drafting/scripts/assemble_response_table.py \
  --requirements <SESSION_ROOT>/requirements.csv \
  --target <SESSION_ROOT>/<target_doc> \
  --output <SESSION_ROOT>/<target_doc> \
  --report <SESSION_ROOT>/reports/assembly-report.json
```

**注意**：`--target` 和 `--output` 可以是同一路径（原地更新）。脚本按**内容匹配**（而非行索引）将 CSV 的响应内容写入 docx 表格的正确行，从根本上避免 off-by-N 错位问题。

处理组装报告：
- 检查 `summary.unmapped_csv` — 如有未匹配的 CSV 行，说明表格中缺少对应的招标要求行，需人工处理
- 检查 `summary.unmapped_table` — 如有未匹配的表格行，可能是表格中有但 CSV 中没有的要求，需补充分析
- 检查 `warnings` — 如有"cell already has content"警告，说明某些单元格已有非占位符内容，脚本跳过了覆写

**分批执行**：如果只完成了部分 CSV 行（如一个大章节），可以随时运行组装脚本。脚本只处理 status=done 的行，不影响 pending 行。

### Step 4.8: 表格验证（docx vs CSV 交叉校验）

组装完成后，运行验证脚本确认内容已正确填入 docx：

```bash
python .opencode/skills/bid-drafting/scripts/verify_docx_table.py \
  --requirements <SESSION_ROOT>/requirements.csv \
  --target <SESSION_ROOT>/<target_doc> \
  --output <SESSION_ROOT>/reports/verify-report.json
```

处理验证结果：
- `exact_match` → 正常，无需处理
- `partial_match` → 检查是否是格式差异（如换行符、空格），通常可接受
- `mismatch` → **严重问题**，CSV 和 docx 内容不一致。检查原因，必要时重新运行组装
- `empty` → docx 单元格为空但 CSV 有内容，组装可能失败
- `placeholder` → docx 单元格仍有占位符，组装可能被跳过（因已有非占位符内容）

**只有验证通过后，才能进入 Step 5 交付。**

### Step 5: 交付暂停点
确保目标文档处于 packed（有效）状态。汇报已完成项和剩余项。

---

## 特殊组装路径

### 路径 E：资质文件组装（Qualification Assembly）

**触发条件**：当前处理的 worktree 节点属于"资格证明文件"类章节，且 `file-triage.json` 中有 `qualification` 类别的文件。

详细流程（匹配表、格式转换、插入逻辑、输出 schema）见 `references/route-e-qualification.md`。

**核心步骤**：匹配资质要求与 triage 文件 → 按招标顺序排列 → 格式转换 → 插入目标文档 → 缺失项报告给用户。

---

### 路径 F：报价数据填充（Pricing Data Population）

**触发条件**：当前处理的 worktree 节点属于"报价/商务"类章节，且 `file-triage.json` 中有 `pricing_data` 类别的文件。

详细流程（列映射、填充逻辑、校验规则、安全规则）见 `references/route-f-pricing.md`。

**核心步骤**：读取源数据 → 读取目标表结构 → 列映射 → 填充 → 校验一致性。
**安全规则**：价格数据只能来自用户源文件，填充后必须向用户展示汇总，确认后才标记 done。

---

## 投标文件撰写 — 领域知识

### 商务标完整性检查清单（撰写后核对）

商务标（商务部分）撰写完成后，核对是否遗漏以下内容：

- **资质材料清单**：营业执照（三证合一）、税务登记证、组织机构代码证、审计报告（近三年）、社保证明、纳税证明、类似项目业绩合同及验收报告
- **开标分项一览表**：设备清单及报价明细、软件清单、服务费用、总价
- **商务承诺**：工期承诺、保修期承诺、质保承诺、售后响应时间承诺、付款条件确认
- **点对点应答表（商务部分）**：逐条应答商务要求，标注偏离情况
- **授权文件**：厂商授权书、代理商资格证明

### 技术标完整性检查清单（撰写后核对）

技术标（技术部分）撰写完成后，核对是否遗漏以下内容：

- **技术方案**：按评分标准的技术评分因素组织章节，而非按自己的逻辑
- **项目管理方案**：里程碑计划、人员配置、风险管理
- **售后服务方案**：响应时间、服务站点、备件策略、培训计划
- **实施计划**：项目进度甘特图、阶段交付物、验收方案
- **点对点应答表（技术部分）**：逐条应答技术要求

### 点对点应答内容规范（安全护栏）

**这是最容易出错的地方。** Claude 的摘要倾向会导致生成泛泛的"符合"/"满足"/"响应"，而招标文件通常明确警告：仅回复"满足"/"响应"将视为未实质性响应，按负偏离处理。

每条应答必须遵守：

1. **禁止** 使用笼统的"符合"、"满足"、"响应"作为应答内容
2. **必须** 包含具体数值、数量或实质性描述
3. **技术指标类**：重述具体数字（如"支持 64 核心运算单元，2.7GHz 基础频率"）
4. **方案描述类**：说明 HOW — 如何满足该要求的具体方法/措施
5. **偏离标注**：正偏离（超出要求）/ 无偏离（满足要求）/ 负偏离（不满足，需说明原因）
6. **证明材料页码**：每行引用证明材料在投标文件中的页码位置

### 应答自检规则（写完每条后执行）

每写完一条应答，立即检查：
- 字数 >= 20 字？（低于此阈值几乎不可能是实质性应答）
- 是否包含具体数值、型号、或措施描述？
- 是否以 `<<TBD>>` 占位但给出了理由？
- ★项的应答是否明确标注"无偏离"并有依据？

如果某条应答不满足以上任一条件，标记为 `status: needs_review` 而非 `done`。

### 点对点应答 Output Template

每条应答按此格式写入应答表：

**示例（技术指标类）**：
| 序号 | 招标要求 | 响应内容 | 偏离 | 证明材料 |
|------|---------|---------|------|---------|
| 3.1.2 | 处理器不低于 8 核心，主频不低于 2.5GHz | 配置 Intel Xeon Silver 4314，16 核心 2.4GHz（睿频 3.4GHz），超出要求 | 正偏离 | 详见厂商数据手册 p.12 |

**示例（方案描述类）**：
| 序号 | 招标要求 | 响应内容 | 偏离 | 证明材料 |
|------|---------|---------|------|---------|
| 5.2.1 | 提供 7×24 小时技术支持服务 | XX公司在本市设有服务站点（地址：...），配备 3 名驻场工程师，提供 7×24 小时电话响应（30 分钟内）+ 4 小时现场到达，详见售后服务方案第 3.2 节 | 无偏离 | 详见技术标 p.45 |

### 写作原则

- **组装优先于生成**：优先从源材料中提取/复制，无源材料时才从零撰写
- **点对点方法**：重述要求 → 提供响应 → 引用证据 → 标注偏离
- **技术方案按评分因素组织**：章节结构跟着评分标准走，不要自由发挥结构
- **用目标文档的视角写**：第一人称用投标公司名，不用"我们"/"本公司"等模糊称谓（除非招标文件模板要求）
- **技术参数以厂商文档为准**：点对点应答表中的技术指标（数值、型号、性能参数）必须来自用户提供的厂商官方文档（数据手册/白皮书），不要从联网搜索结果或 AI 记忆中填写。找不到对应参数时用 `<<TBD: 需厂商确认>>` 占位。
- **质量优先**：每条应答都值得认真写。不要因为列表长就降低后续条目的质量。宁可在一个暂停点交付已完成的高质量部分，也不要用空洞的"满足/符合"敷衍全部条目。

### 约束传播规则

每个节点撰写前，执行一致性检查：

1. **读取 conventions.md 的决策日志** — 检查当前节点是否涉及已有决策
2. **涉及已有决策时** — 必须与决策内容一致，不得偏离
3. **做出新决策时** — 立即追加到 conventions.md 的决策日志，标注影响节点范围
4. **修改已有决策** — 先评估影响范围（哪些已完成节点需要回溯修改），向用户确认后再修改

典型需要记录的决策：
- 产品选型（品牌/型号确定后影响所有参数引用）
- 服务承诺（响应时间/质保期确定后影响多处描述）
- 时间框架（工期/交付期确定后影响进度表和甘特图）
- 公司信息（全称/简称规则、法人代表、联系方式）
- 价格框架（总价/分项价确定后影响报价表和商务条款）

### 刷新检查点（每处理 5 个节点后强制执行，★/# 项每 3 个后执行）

每完成 5 个节点的撰写后（如果连续处理 ★ 或 # 项，则每 3 个后），暂停执行以下刷新：

1. **重读 conventions.md 全文** — 刷新决策日志、格式约定、格式快照、质量基线的记忆。**此步不可跳过。**
2. **质量衰减检测**（需质量基线已建立）：
   - 计算最近 5 个节点的平均应答字数，与质量基线比较
   - 如平均字数下降 > 30% → 警告信号
   - 检查最近 5 个应答是否出现笼统用语（"符合"、"满足"、"响应"）
   - 检查偏离标注是否变得模糊或缺失
   - 可选：运行 `python .opencode/skills/bid-drafting/scripts/check_drafting_quality.py --requirements <SESSION_ROOT>/requirements.csv --trend-only --output <SESSION_ROOT>/reports/quality-trend.json`
3. **如发现衰减** → 向用户报告衰减指标（"前3节点平均287字，最近5节点平均98字"），建议暂停
4. **更新 index.json 进度** → 标记安全暂停点
5. **更新 conventions.md 五、质量基线** → 追加本轮检查点的质量快照（时间戳、节点范围、指标值）

### 检查点文件（每个刷新检查点写入）

每次执行刷新检查点或完成暂停点（Step 5）时，写入 `.worktree/last-checkpoint.md`：
- 当前阶段和 autopilot stage（如适用）
- 最后完成的节点 ID 和状态
- 从 conventions.md 决策日志中提取的关键进行中决策（最近 5 条）
- 质量指标快照（已完成数、最近均值、趋势）
- 下一步动作（明确到具体节点 ID）

### 状态外化（长任务保障）

遵循 agent 层的工作树协议：
- 如有 `.worktree/` → 每完成一个节点，更新节点 status + index.json summary/current_focus + requirements.csv
- 如无工作树 → 维护 requirements.csv 记录每项完成状态
- 写作约定记录在 `.worktree/conventions.md`（或无工作树时在进度文件中注明）

## Example

用户："把技术应答表填一下，参考 @厂商数据手册.pdf"

1. 读取 .worktree/index.json（或 requirements.csv），筛选技术类待处理项（status=pending）共 23 条
2. 确认范围：用户要求填技术应答表，聚焦技术指标类条目
3. 逐条处理：读取厂商数据手册提取参数 → 按 output template 格式**写入 requirements.csv** → 更新 csv 状态为 done
4. 完成 18 条，5 条因缺少厂商数据标记为 `<<TBD: 需厂商确认>>`
5. 运行质量自检脚本 → 全部通过
6. 运行组装脚本：`assemble_response_table.py` 将 18 条应答从 CSV 填入 docx 表格
7. 运行验证脚本：`verify_docx_table.py` 确认 18 条全部 exact_match
8. 汇报："已完成 18/23 条技术应答，5 条待厂商确认参数。文档已组装验证通过。"

### 参考文件

- `references/business-outline.md` — 商务标常见章节结构
- `references/technical-outline.md` — 技术标常见章节结构
