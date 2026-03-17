# Route F: Pricing Data Population (报价数据填充)

> Extracted from bid-drafting SKILL.md. This file contains column mapping logic, fill rules, validation checks, and safety rules.

## 流程

### 1. 读取源数据

用 xlsx skill 读取 pricing_data 文件：
- 提取列头和行数据
- 识别数据结构：设备清单 / 报价明细 / 费率表 / 工程量清单

### 2. 读取目标表结构

从目标文档中提取报价表的表头和结构：
- 如果模板中有空白报价表 → 按其列结构填充
- 如果没有 → 从招标文件的报价格式要求推导

### 3. 列映射

将源数据列映射到目标表列：
- 自动匹配：同名列
- 语义匹配：近义列（如 "单价" ↔ "含税单价"）
- 无法匹配的列 → 报告给用户确认

### 4. 填充

将数据写入目标文档的表格：
- 使用 docx skill 的表格 XML 操作
- 保留原始数字精度（不四舍五入）
- 计算派生列：小计 = 单价 × 数量，总计 = Σ 小计

### 5. 校验

填充完成后的一致性检查：
- 逐行：小计 == 单价 × 数量
- 汇总：总计 == Σ 所有小计
- 预算：总价 ≤ `.bid/facts.json` 的 budget（如有）
- 校验失败 → 标记节点为 blocked，报告给用户

## 安全规则

- 价格数据**只能**来自用户提供的源文件，绝不可编造价格
- 填充完成后**必须**向用户展示汇总：总价、金额最大的前 5 项
- 用户确认后才标记节点为 done
