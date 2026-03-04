---
name: bid-qc
description: 检查投标文件质量，合规审查，查找错误和遗漏。触发词：检查投标文件、审查标书、投标合规检查、标书质量检查、投标文件有没有问题
requires:
  - target_doc: "投标文件 .docx (必须)"
  - tender_file: "招标文件 (必须, 校验基线)"
  - .bid/facts.json: "事实校验基线 (可选, 降级运行)"
  - requirements.csv: "检查清单骨架 (可选, 降级运行)"
provides:
  - reports/qc-deterministic.json: "确定性检查报告"
  - reports/qc-full.md: "完整 QC 报告 (含 LLM 判断层)"
---

## Workflow

### Step 1: 确认检查范围
必须有：目标文档（投标文件 .docx） + 招标文件（校验基线）。
可选：`.worktree/index.json` 或 `requirements.csv`（检查清单骨架）、`.bid/facts.json`（事实校验基线，位于会话根目录下的 `.bid/` 子目录，由 bid-analysis 阶段生成）。
如有工作树 → 利用节点信息定位每条要求在目标文档中的位置，提高检查精度。

### Step 2a: 确定性初筛（硬规则预检层）

运行确定性检查脚本，获取预检结果：

```bash
python .opencode/skills/bid-qc/scripts/check_deterministic.py \
  --unpacked <SESSION_ROOT>/.tmp/unpacked/<docname>/ \
  --facts <SESSION_ROOT>/.bid/facts.json \
  --requirements <SESSION_ROOT>/requirements.csv \
  --output <SESSION_ROOT>/reports/qc-deterministic.json
```

`--facts` 和 `--requirements` 为可选参数——脚本在未传入时优雅降级（对应检查标记为 skip），不会报错。

此步骤是**预检**，不是完整检查。脚本输出中每个 check 包含 `scope`（实际验证了什么）和 `uncovered`（需要 Step 2c 补充什么）。

| Check | 实际检查内容 | 不检查（需 LLM 补充） |
|-------|-------------|---------------------|
| entity_presence | 公司名/项目名在全文中的存在性；黑名单公司名残留 | 全称vs简称混用；合作方名称匹配 |
| amount_consistency | 特定格式报价表的分项合计=总价；预算上限 | 非标准表格；单价×数量=行合计；正文金额 |
| date_presence | `.bid/facts.json` 日期在全文中的存在性；截止日期是否过期 | 文档内部日期交叉比对 |
| star_coverage | CSV 元数据中★项的 status 和 deviation | docx 中实际响应内容是否充实 |
| placeholder_residue | `<<TBD>>`、中文占位词、红色高亮 | 语义占位 |
| headers_footers | 页眉页脚中的公司名/项目名 | 密级标识 |

**关键**：`pass` 仅代表 scope 范围内通过。`not_applicable` = 脚本无法匹配文档结构，LLM 必须手动检查。

### Step 2b: 图片信息校验（视觉子 agent）

**前置**：读取 `references/vision-agent-protocol.md` 了解调用协议。

处理流程：
1. 解析 `<unpacked>/word/_rels/document.xml.rels`，建立 rId → 图片文件的映射
2. 解析 document.xml，确定每张图片所在的章节位置
3. 结合 `.bid/facts.json` 和 requirements.csv，确定哪些图片需要校验
4. 按 vision-agent-protocol.md 的"调用策略"优先级，逐张调用视觉子 agent
5. 收集所有 extract/verify/assess 结果

**典型校验矩阵**：

| 图片类型 | 调用模式 | 校验内容 | 对应 `.bid/facts.json` 字段 |
|---------|---------|---------|-------------------|
| 营业执照 | extract→verify | 公司名、信用代码、法人、有效期 | companyName, creditCode, legalRep |
| 资质证书 | extract→verify | 持证单位、等级、有效期 | companyName + 招标要求的资质类型 |
| 审计报告 | extract→verify | 被审计单位、年度、意见类型 | companyName + 招标要求的年份 |
| 社保证明 | extract→verify | 缴纳单位、时段、人数 | companyName + 招标要求的时段 |
| 业绩合同 | extract→verify | 乙方、金额、日期、项目类型 | companyName + 招标业绩门槛 |
| 授权书 | extract→verify | 授权方、产品型号、有效期 | 投标配置中的品牌型号 |
| 所有图片 | assess | 清晰度、彩色/黑白、公章 | — |

输出整合到 Step 3 的统一报告中，置信度标注为 **视觉提取** — 子 agent 从图片中读取的信息。

### Step 2c: LLM 补充检查（语义判断层）

**输入**：Step 2a 的 JSON 报告 + Step 2b 的视觉提取结果。**必须**逐项阅读每个 check 的 `uncovered` 列表。

处理逻辑：
1. `status: "fail"` → 记录为确定性发现，无需重复
2. `status: "pass"` → **仍需检查 uncovered 中列出的每一条**
3. `status: "not_applicable"` → **必须完整手动检查该维度**
4. `status: "skip"` → 如有替代信息源，尝试手动检查

LLM 必须补充的检查（对应脚本 uncovered + 脚本完全不涉及的维度）：
1. **实体一致性（深度）** — 全称vs简称混用；合作方名称与资质文件匹配
2. **金额一致性（深度）** — 非标准表格；单价×数量=行合计；正文金额与表格一致
3. **日期一致性（深度）** — 同一日期/期限在多处出现时是否一致
4. **★项实质性** — 文档中的实际响应内容是否充实
5. **应答实质性** — 每条点对点应答是否有实质内容
6. **技术参数一致性** — 应答参数与厂商资料匹配
7. **偏离标注正确性** — "正偏离"是否真的超出要求
8. **方案完整性** — 技术方案是否覆盖评分要素各子项
9. **资质文件有效性（深度）** — Step 2b 未覆盖的语义判断，如经营范围是否覆盖项目类型

### Step 3: 合并输出
按以下格式输出结果，Blocker 和 High 级别排在最前。每条发现标注来源和置信度：

| 来源 | 置信度标注 |
|------|----------|
| Step 2a 的 fail 项 | **确定性** — 脚本 scope 内必定存在的问题 |
| Step 2b 视觉子 agent 发现 | **视觉提取** — 从图片中 OCR/识别的信息，准确度取决于图片质量 |
| Step 2a `pass` 但 uncovered 由 LLM 发现 | **判断性** — 脚本未覆盖的维度 |
| Step 2a `not_applicable` 由 LLM 手动检查 | **判断性** — 脚本无法执行，完全依赖 LLM |
| Step 2c 独立发现 | **判断性** — LLM 评估，建议人工复核 |

| 序号 | 级别 | 维度 | 位置 | 问题描述 | 修复建议 | 置信度 |
|------|------|------|------|---------|---------|--------|

每个问题必须有"位置"（文件 + 章节/页码）和具体描述。置信度标注为"确定性"（来自脚本）、"视觉提取"（来自视觉子 agent）或"判断性"（来自 LLM）。

### Step 4: 同步状态
- 如有 `.worktree/` → 更新对应节点的 status + index.json summary + requirements.csv
- 如仅有 requirements.csv → 更新 csv 对应条目的状态

---

## 投标文件质检 — 领域知识

### 7 个检查维度

#### 1. 合规覆盖率
- 招标文件的每项要求是否都有对应响应
- 星标（★）项是否 100% 满足（缺失 = 废标）
- 井号（#）项是否附带截图/证明
- 圆点（●）项是否准备演示材料

#### 2. 事实正确性
- 日期：投标截止、开标、交货期、保修起止是否正确且相互一致
- 金额：报价明细加总是否等于总价，预算是否超标
- 技术参数：引用的产品参数是否与厂商资料一致
- 如有 `.bid/facts.json`，以其为校验基线；如无，直接对照招标文件验证

> 脚本覆盖范围：`date_presence` 仅检查 `.bid/facts.json` 日期在全文中的存在性和过期；`amount_consistency` 仅检查特定格式报价表的合计和预算上限。日期交叉比对、非标准表格、正文金额等需 LLM 补充。

#### 3. 实体一致性
- 投标公司名称全文一致（全称 vs 简称不混用，除非有明确规则）
- 不出现其他公司的名称残留（从历史标书复制后未替换干净）
- 项目名称与招标文件一致
- 合作方/供应商名称与其提供的资质材料一致

> 脚本覆盖范围：`entity_presence` 仅检查公司名/项目名/项目编号在全文中的存在性和黑名单残留。全称vs简称混用、合作方匹配等需 LLM 补充。

#### 4. 资质文件检查
- 资质证书上的公司名称与投标公司一致 → **Step 2b 视觉子 agent extract→verify**
- 证书有效期是否超过投标截止日期 → **Step 2b 视觉子 agent extract→verify**
- 审计报告的年份是否符合招标要求（通常要求近三年） → **Step 2b 视觉子 agent extract→verify**
- 业绩证明的项目金额/类型是否满足招标门槛 → **Step 2b 视觉子 agent extract→verify**
- 经营范围是否覆盖项目类型 → **Step 2c LLM 语义判断（基于 Step 2b 提取的经营范围文本）**

> 注：维度 4 的检查对象主要是图片（扫描件），必须通过视觉子 agent 提取图片中的文字信息后才能校验。

#### 5. 格式合规
- 章节结构是否与招标文件要求一致
- 页眉页脚是否正确（公司名、项目名、密级标识等）
- ⚠️ 装订份数、电子版份数是否满足要求 → **提醒用户人工确认**
- ⚠️ 签章位置是否完整 → **提醒用户人工确认**

#### 6. 查重标记
- 是否有大段文字与其他投标方标书雷同（串标风险）
- 图片是否与其他标书共用（最高串标风险）
- 是否残留其他项目的特定信息（旧日期、旧客户名）

#### 7. 点对点应答完整性
- 每行是否有实质性响应（非空、非笼统"符合"）
- 偏离标注是否完整
- 证明材料页码是否填写
- 星标/核心项是否有充分响应

### 严重程度分级

| 级别 | 含义 | 处理 |
|------|------|------|
| **Blocker** | 不修复则无法提交或必然废标 | 必须修复 |
| **High** | 大概率导致废标或重大扣分 | 强烈建议修复 |
| **Medium** | 影响评分但不会废标 | 建议修复 |
| **Low** | 可优化项 | 视时间决定 |

## Example

用户："检查一下投标文件有没有问题"

1. 确认范围：投标文件.docx + 招标文件.pdf + requirements.csv
2. 逐维度检查，发现 3 个问题
3. 输出：
   | 序号 | 级别 | 维度 | 位置 | 问题描述 | 修复建议 | 置信度 |
   |------|------|------|------|---------|---------|--------|
   | 1 | Blocker | 合规覆盖率 | 技术应答表 3.2.1 | ★ 项未响应 | 必须补充应答 | 确定性 |
   | 2 | High | 实体一致性 | 第 4 章 p.23 | 出现"ABC公司"（应为"XYZ公司"） | 全文替换 | 确定性 |
   | 3 | Medium | 格式合规 | 页眉 | 缺少密级标识 | 添加"商密"标识 | 判断性 |
4. 更新 requirements.csv 中 3.2.1 行状态为 blocked

### 参考文件

- `references/qc-checklist.md` — 提交前门控检查清单
- `references/vision-agent-protocol.md` — 视觉子 agent 调用协议
