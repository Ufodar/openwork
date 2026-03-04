# Material Registry Construction Guide

> Extracted from bid-analysis SKILL.md Step 4.5. This file contains the detailed batching strategy, per-batch processing flow, token budget, and progressive indexing rules.

## 分批策略（当 file-triage.json 存在时使用）

如果 Step 0 已生成 file-triage.json，按以下优先级分批处理：

| 批次 | 类别 | 处理深度 | 说明 |
|------|------|---------|------|
| 1 | `tender_main` + `tender_attachment` | 读前 3000 字符 | 最关键，通常 < 5 个文件 |
| 2 | `historical_bid` | 读前 3000 字符 | 结构可复用，通常 < 20 个 |
| 3 | `product_doc` | 读前 3000 字符 | 技术参数来源 |
| 4 | `pricing_data` | 读前 3000 字符 | 报价参考 |
| 5 | `qualification` | **仅文件名 + 类型** | 不读内容（由路径 E 在组装时处理），token 消耗 ≈ 0 |
| 6 | `other` | 读前 3000 字符 | 兜底 |

## 每批处理流程

1. 从 file-triage.json 取出该批文件列表
   - v2 读取 `by_category.<category>[].rel_path`
   - v1 读取字符串数组时，按文件名回退匹配为 `rel_path`
2. 每个子批次最多 20 个文件。对每个文件：
   - 读取前 3000 字符 / 前 2 页
   - 提取：description、covers[]、useful_for_reqs[]、quality、caveats
   - 追加到 material-registry.json
3. **每个子批次完成后立即持久化** material-registry.json 到磁盘
4. 更新 index.json 的 `registry_progress` 字段：
   ```json
   "registry_progress": {
     "total": 156,
     "indexed": 45,
     "current_batch": "historical_bid",
     "batch_order": ["tender_main", "tender_attachment", "historical_bid", "product_doc", "pricing_data", "qualification", "other"]
   }
   ```

## qualification 特殊处理

资质类文件只记录 `文件名 + 检测到的子类型`（营业执照/资质证书/审计报告/业绩合同/授权书/人员证书/其他），不读取文件内容。内容在 bid-drafting 路径 E 组装时才读取。

## 渐进式索引

- 批次 1-2 完成后即可开始 drafting 阶段（不必等全部索引完）
- 剩余批次可按需索引：当 drafting 遇到某节点需要的材料不在 registry 中时，按 search_scope 即时扫描并补充 registry
- Token 预算：每子批次最多 20 × 3000 字符 ≈ 60K token。超出则自动拆分
