# 视觉工具子 agent 调用协议

## 概述

视觉子 agent 是一个**无上下文的工具型 agent**，用于从投标文件的图片中提取信息、校验信息或评估图片质量。
QC 主 agent 按需调用，每次调用只处理一张图片的一个任务。

**设计原则**：
- **工具型，非自治型** — 子 agent 不需要项目上下文，不做决策。它只回答具体问题。
- **按需调用，非全量扫描** — QC 主 agent 根据检查需要选择性调用。
- **结构化输出** — 返回 JSON，不返回自然语言叙述，方便主 agent 做交叉校验。

## 前置条件

1. 目标文档已 unpack，图片文件在 `<unpacked>/word/media/` 目录下
2. 主 agent 已通过 `document.xml` 的关系映射（`word/_rels/document.xml.rels`）确定每张图片的位置（在哪个章节下）

## 调用方式

通过 bash 启动 opencode CLI 子 session（或直接用 vision API），传入：
- 图片文件路径
- 任务模式（extract / verify / assess）
- 任务参数（文档类型 / 预期值 / 无）

---

## 模式 1: extract（信息提取）

**输入参数**：
- `image_path`: 图片文件路径
- `doc_type`: 文档类型提示（可选，提高提取准确率）
  - `business_license`（营业执照）
  - `qualification_cert`（资质证书）
  - `audit_report`（审计报告）
  - `social_insurance`（社保证明）
  - `performance_contract`（业绩合同）
  - `authorization_letter`（授权书）
  - `test_report`（检测报告）
  - `personnel_cert`（人员证书）
  - `id_card`（身份证）
  - `other`（其他）

**输出**：按文档类型返回结构化字段 JSON。

### business_license 提取字段

| 字段 | 说明 |
|------|------|
| companyName | 公司名称（全称） |
| creditCode | 统一社会信用代码 |
| legalRep | 法定代表人 |
| registeredCapital | 注册资本 |
| establishDate | 成立日期 |
| validUntil | 营业期限 |
| businessScope | 经营范围（摘要） |
| address | 住所 |

### qualification_cert 提取字段

| 字段 | 说明 |
|------|------|
| holderName | 持证单位名称 |
| certType | 证书类型 |
| certLevel | 资质等级/级别 |
| certNumber | 证书编号 |
| issuer | 发证机关 |
| issueDate | 发证日期 |
| validUntil | 有效期至 |
| scope | 资质范围 |

### audit_report 提取字段

| 字段 | 说明 |
|------|------|
| auditedEntity | 被审计单位 |
| auditFirm | 审计机构 |
| fiscalYear | 审计年度 |
| opinionType | 审计意见类型（无保留/保留/否定/无法表示） |
| revenue | 营业收入（如可见） |
| netAssets | 净资产（如可见） |

### social_insurance 提取字段

| 字段 | 说明 |
|------|------|
| companyName | 缴纳单位 |
| period | 缴纳时段 |
| insuredCount | 参保人数 |
| insuranceTypes | 险种列表 |
| sealPresent | 是否有社保局章 |

### performance_contract 提取字段

| 字段 | 说明 |
|------|------|
| partyA | 甲方名称 |
| partyB | 乙方名称（应为投标公司） |
| contractAmount | 合同金额 |
| signDate | 签订日期 |
| projectName | 项目名称 |
| projectType | 项目类型 |
| completionDate | 竣工/验收日期（如可见） |

### authorization_letter 提取字段

| 字段 | 说明 |
|------|------|
| authorizer | 授权方（公司/厂商名称） |
| authorized | 被授权方 |
| scope | 授权范围/产品型号 |
| validUntil | 授权有效期 |
| region | 授权区域（如有） |

### personnel_cert 提取字段

| 字段 | 说明 |
|------|------|
| holderName | 持证人姓名 |
| certType | 证书类型 |
| certLevel | 等级 |
| certNumber | 证书编号 |
| validUntil | 有效期 |

---

## 模式 2: verify（信息校验）

**输入参数**：
- `image_path`: 图片文件路径
- `expected`: 预期值 JSON（要校验的字段和预期值）

**输出**：
- `results`: 逐字段校验结果数组
  - `field`: 字段名
  - `expected`: 预期值
  - `actual`: 图片中实际读到的值
  - `match`: true/false
  - `note`: 差异说明（仅 match=false 时）

**示例**：

输入 expected:
```json
{"companyName": "XX科技有限公司", "validUntil": "2028-12-31"}
```

输出：
```json
{
  "results": [
    {"field": "companyName", "expected": "XX科技有限公司", "actual": "XX科技有限公司", "match": true},
    {"field": "validUntil", "expected": "2028-12-31", "actual": "2025-06-30", "match": false, "note": "证书将在投标截止日前过期"}
  ]
}
```

---

## 模式 3: assess（质量评估）

**输入参数**：
- `image_path`: 图片文件路径

**输出**：

| 字段 | 类型 | 说明 |
|------|------|------|
| legible | boolean | 是否可辨认 |
| colorType | string | `"color_scan"` / `"bw_scan"` / `"bw_copy"` / `"photo"` |
| sealPresent | boolean | 是否有公章/印章 |
| sealColor | string | `"red"` / `"blue"` / `"none"` |
| completeness | string | `"full"` / `"partial"` / `"cover_only"` |
| issues | string[] | 具体问题描述列表 |

---

## QC 主 agent 的调用策略

**不要对所有图片全量调用。**按以下优先级选择性调用：

### 必须调用（Blocker 防护）

1. **营业执照** → extract + verify(companyName 与 facts.json 一致)
2. **资质证书（招标要求的）** → extract + verify(有效期覆盖投标截止日)
3. **业绩证明** → extract + verify(金额/时间满足招标门槛)
4. **厂商授权书** → extract + verify(产品型号与投标配置一致)

### 建议调用（High 风险项）

5. **审计报告** → extract + verify(年度正确、审计意见类型)
6. **社保证明** → extract + verify(时段正确、公司名一致)
7. **法人身份证/授权委托书** → extract + verify(姓名链一致)

### 可选调用（Medium/Low）

8. 所有图片 → assess（批量质量评估：清晰度、彩色/黑白、公章）
9. 技术方案中的截图 → assess（是否清晰、是否与章节相关）
