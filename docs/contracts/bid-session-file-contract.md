# Bid Session File Contract

本文件是标书工作区内路径、状态文件、报告文件的单一事实来源。

## 1. Workspace Model

- 当前会话的真实根目录就是 `<WORKSPACE>`。
- 所有读写、索引、报告、临时文件都必须位于 `<WORKSPACE>` 内。
- 任何持久化到 JSON / CSV / Markdown 的路径都必须使用 **workspace 相对路径**。
- 不要在持久化状态里写绝对路径。

## 2. Allowed Persistent Roots

以下路径是允许长期保留的：

- `requirements.csv`
- `file-triage.json`
- `.worktree/`
- `.bid/`
- `reports/`
- 用户可见的成品文件和工作副本

以下路径只能作为临时区：

- `.tmp/`

## 3. Path Rules

- `rel_path` 一律相对于 `<WORKSPACE>`。
- `target_doc`、`tender_file`、`facts_ref`、`node_ref`、`conventions_ref` 都必须是相对路径。
- 如果系统传入绝对路径，可用于本轮执行；写回状态前必须转换成相对路径。
- 转换后若越界，则拒绝持久化并要求用户把文件放入当前工作区。

## 4. Standard Directories

### 4.1 `.tmp/`

只放临时提取物、解包目录、缓存文本、一次性中间产物。

常见例子：

- `.tmp/tender_text.txt`
- `.tmp/tender_work/`
- `.tmp/unpacked/<docname>/`

禁止把系统 `/tmp` 当默认工作目录。

### 4.2 `.worktree/`

放可恢复的任务状态：

- `index.json`
- `conventions.md`
- `nodes/<id>.json`
- `material-registry.json`
- `material-gaps.json`

### 4.3 `.bid/`

放项目级事实基线：

- `.bid/facts.json`

### 4.4 `reports/`

放可审计报告：

- `reports/drafting-quality.json`
- `reports/assembly-report.json`
- `reports/verify-report.json`
- `reports/qc-deterministic.json`
- `reports/qc-full.md`
- `reports/dedupe/<timestamp>-dedupe-report.md`

## 5. Target Document Rules

- `target_doc` 必须指向当前工作区中的稳定目标文件。
- 一个正在执行的写作任务应尽量围绕一个稳定 `target_doc` 展开。
- 如需保护原件，可在工作区内创建工作副本，再把副本路径写入 `target_doc`。
- 不要把临时 `.md` 草稿当成 `target_doc`。

## 6. Worktree Minimum Contract

### 6.1 `requirements.csv`

适用于逐条应答、需求矩阵、响应表装配。  
至少应能容纳这些逻辑列：

- `id`
- `title` 或 `requirement`
- `tender_location`
- `priority`
- `scoring`
- `status`
- `response`
- `deviation`
- `proof`

列名允许中英文变体，但语义必须一致。

### 6.2 `.worktree/index.json`

必须至少包含：

- `version`
- `project`
- `tender_file`
- `target_doc`
- `phase`
- `summary`
- `current_focus`
- `conventions_ref`
- `children`

具体字段定义以：

- `.opencode/skills/bid-analysis/references/worktree-schema.json`

为准。

### 6.3 `.worktree/conventions.md`

至少保留这五个区块：

- 格式约定
- 关键决策日志
- 一致性检查点
- 格式快照
- 质量基线

## 7. `file-triage.json` v2 Contract

`file-triage.json` 必须写成 v2，不再使用旧版字符串数组结构。

最小示例：

```json
{
  "version": 2,
  "total": 12,
  "classified_by_name": 8,
  "classified_by_content": 4,
  "by_category": {
    "tender_main": [
      {
        "rel_path": "招标文件.pdf",
        "name": "招标文件.pdf",
        "size": 4567890
      }
    ],
    "tender_attachment": [],
    "qualification": [],
    "historical_bid": [],
    "pricing_data": [],
    "product_doc": [],
    "image_asset": [],
    "archive": [],
    "other": []
  },
  "ambiguous": []
}
```

规则：

- `version` 必须为 `2`
- `by_category.<category>` 的条目必须是对象数组，不再是字符串数组
- 基础字段：
  - `rel_path`
  - `name`
  - `size`
- `image_asset` 条目额外允许：
  - `source_pdf`

推荐类别：

- `tender_main`
- `tender_attachment`
- `qualification`
- `historical_bid`
- `pricing_data`
- `product_doc`
- `image_asset`
- `archive`
- `other`

## 8. Report Contract

- 报告是审计面，不是控制面。
- 报告路径可以写进回复中，也可以被后续步骤再次读取。
- 报告应优先写到 `reports/`，不要散落在工作区根目录。

## 9. Compatibility Policy

- 新写入必须遵守本 contract。
- 读取旧文件时允许做兼容，但回写时必须升级到当前约定。
