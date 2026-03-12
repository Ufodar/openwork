# Route E: Qualification Assembly (资质文件组装)

> Extracted from bid-drafting SKILL.md. This file contains the full matching table, format conversion rules, insertion logic, and output schema.

## 流程

### 1. 匹配

将招标要求中的每条资质要求（来自 requirements.csv 中 `分类 == "资格要求"` 的行）与 triage 中的 qualification 文件匹配：

| 资质类型 | 文件匹配信号 |
|---------|------------|
| 营业执照 | 文件名含 "营业执照" / "business_license" |
| 资质证书 | 文件名含 "资质" / "证书" / "认证" / "ISO" / "CMMI" |
| 业绩合同 | 文件名含 "合同" / "业绩" / "案例" / "project" |
| 财务报表 | 文件名含 "审计" / "财务" / "资产负债" / "audit" |
| 授权书 | 文件名含 "授权" / "authorization" |
| 人员证书 | 文件名含 "人员" / "工程师" / "PMP" 或证书类关键词 + 人名 |
| 其他 | 基于前 2 页内容做语义匹配 |

### 2. 排序

按招标文件要求的顺序排列（如有明确顺序要求），否则使用通用顺序：
营业执照 → 资质证书 → 业绩合同 → 财务报表 → 人员证书 → 授权书 → 其他

### 3. 格式转换

对每个匹配到的文件：
- PDF 扫描件 → 使用 bash + ghostscript/imagemagick 转为图片（每页一张）
- 原生图片（jpg/png）→ 直接使用
- DOCX → 走路径 A（格式保真复制：加载 docx skill → XML 层面复制章节 → 对齐样式 → tracked changes）

### 4. 插入

按顺序写入目标文档的资格证明章节：
- 每类文件前插入标题（如"一、营业执照"）
- 使用 docx skill 的图片插入 XML 知识
- 每份文件之间插入分页符
- 保持修订标记

### 5. 缺失报告

对未匹配到文件的招标要求：
- 在目标文档对应位置插入占位符 `<<待补充：XX证书>>`
- 设置节点 status: blocked, blocked_by: "缺少XX证书"
- 汇总所有缺失项，报告给用户

## 输出产物

`reports/drafting/<timestamp>-qualification-mapping.json`（路径相对于 workspace 根目录）

```json
{
  "mappings": [
    { "requirement": "营业执照", "file": "营业执照.pdf", "status": "inserted", "pages": [45, 46] },
    { "requirement": "ISO27001", "file": "ISO27001证书.pdf", "status": "inserted", "pages": [47] },
    { "requirement": "近三年审计报告", "file": null, "status": "missing" }
  ],
  "summary": { "total": 12, "inserted": 10, "missing": 2 }
}
```

## 与 bid-qc 的衔接

QC 的 vision sub-agent 可以 verify 已插入的资质文件——检查公司名、有效期、证书编号是否与 `.bid/facts.json` 一致。无需修改 bid-qc。
