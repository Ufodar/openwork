# Bid Collaboration Workbench Design

**目标**：新增一条独立于 `common-work` 与 `document-writer` 的“多人协作投标工作台”产品线，支持按投标章节切分协作、节点级独立对话、参考材料显式绑定、章节产物单独生成与实时合并。

## 设计判断

- 不改造 `common-work` 与 `document-writer` 的职责边界。
- 新模块是一个独立视图，不是 `document-writer` 的复杂模式开关。
- 章节协作状态必须落到显式状态文件，不能靠提示词、标题关键字或临时会话记忆维持。
- 节点与文件关联由用户或程序显式维护，不做启发式自动匹配。
- 每个叶子节点使用独立 session，以缩小上下文与目标，支持多人并行推进。

## 首版范围

首版只做最小可用闭环，不一次性做满：

1. 新增独立入口与独立页面 `bid-workbench`
2. 左侧四类文件区：
   - 招标文件
   - 参考文件
   - 产出文件
   - 投标模板文件
3. 中间显示投标文档标题树
4. 支持节点级元数据：
   - 是否叶子节点
   - 锁定状态
   - 当前编辑人
   - 关联参考文件列表
   - 关联产出文件列表
   - 绑定 sessionId
5. 支持节点级单独对话入口
6. 支持“写入总文档”动作，将节点产出登记到总文档编排状态

## 明确不在首版做的事

- 不做自动标题抽取的复杂 `.docx` 解析链
- 不做实时协同编辑协议
- 不做自动推断“某章节应该选哪些参考文件”
- 不做复杂权限系统

## 状态模型

所有工作台状态落到 workspace 内显式文件：

- `.openwork/bid-workbench/index.json`
- `.openwork/bid-workbench/outline.json`
- `.openwork/bid-workbench/marks.json`

以上是首版收敛方案。进入第二阶段后，这些 JSON 文件不再作为唯一真相源，而是逐步退为导出/兼容层。

## 第二阶段修正

你后续追加的要求改变了核心判断，工作台需要进入第二阶段：

1. 章节树不是手工主导，而是以“投标文件”的层级结构为主源
2. 用户手动修改投标文件后，点击刷新时需要重新同步章节树
3. `输入源 -> 章节 -> 产出 -> 锁状态 -> 当前编写人 -> 是否已并入主文档` 这些关系不适合继续只放 JSON，应该进入服务端数据库账本

因此，第二阶段的 source of truth 改成：

- 投标文件层级结构：来自用户指定的投标文件
- 协作关系账本：来自工作区数据库
- JSON：只作为导出、调试或兼容缓存，不再承担主状态职责

## 第二阶段数据库账本

建议在每个 workspace 下新增独立 sqlite：

- `.openwork/bid-workbench/state.db`

原因：

- 这是工作区私有协作状态，不应该混进 OpenCode 自己的 `opencode.db`
- 关系数据需要增删改查、去重、事务和刷新同步
- 后续如果要支持多人同时编辑、恢复、审计，sqlite 比纯 JSON 稳定得多

### 建议表结构

`bid_projects`

- `id`
- `workspace_id`
- `title`
- `tender_source_path`
- `template_source_path`
- `root_output_path`
- `outline_revision`
- `created_at`
- `updated_at`

`bid_sections`

- `id`
- `project_id`
- `section_key`
- `title`
- `level`
- `parent_section_key`
- `order_index`
- `source_locator`
- `source_hash`
- `is_leaf`
- `session_id`
- `locked_by`
- `locked_at`
- `merged_into_master`
- `merged_output_path`
- `created_at`
- `updated_at`

`bid_section_sources`

- `id`
- `project_id`
- `section_key`
- `source_type` `tender|reference|template|output`
- `source_path`
- `role`
- `created_at`

`bid_section_marks`

- `id`
- `project_id`
- `section_key`
- `author`
- `kind`
- `text`
- `created_at`

`bid_refresh_runs`

- `id`
- `project_id`
- `triggered_by`
- `source_path`
- `source_hash`
- `status`
- `summary`
- `created_at`

## 第二阶段刷新规则

刷新不是“清空后重来”，而是受控同步：

1. 用户明确指定一个投标文件作为章节主源
2. 服务端读取该文件的层级结构，得到新的 outline snapshot
3. 按 `section_key/source_locator/source_hash` 做同步
4. 自动执行：
   - 新章节：新增 section 记录
   - 删除章节：标记失效或删除未绑定产物的孤立章节
   - 标题修改：更新 title / level / parent / order
   - 已有会话、锁、产出、标记：尽量保留并迁移到匹配章节
5. 生成一条 `refresh_run` 记录，前端展示这次刷新影响了哪些节点

这里的关键是：

- 刷新是显式动作，不做后台偷偷同步
- 同步依据是文档结构位置与稳定 section_key，不靠启发式关键词匹配
- 如果章节变化导致无法安全映射，必须把冲突显式展示给用户，而不是自动猜

## 第二阶段章节提取原则

“章节树来自投标文件层级结构”不等于“猜哪些段落像标题”。

正确约束：

- 优先读取文档中显式 heading / outline / list level / numbering 结构
- 如果源文档本身没有稳定层级结构，就不能伪装成能自动抽取
- 无法可靠提取时，前端应提示“该投标文件缺少稳定层级结构，请人工整理或另选主文件”

这条约束是为了避免重新回到启发式标题识别。

## 节点状态模型修正（2026-04-30 补充）

第二阶段推进后，之前把节点状态理解成单一 `status` 字段的方向需要修正。

当前更合适的原则是：

1. Phase 0 不引入主观“业务状态下拉框”
2. 优先保存和展示客观协作事实
3. 不把调度/排队语义混进节点主状态

### Phase 0 节点客观事实

当前节点先以这些状态面为主：

- 锁定人 `lockOwner`
- 加锁时间 `lockAcquiredAt`
- 最近一次成功发送 user prompt 的人 `recentPromptAuthor`
- 最近一次成功发送 user prompt 的时间 `recentPromptAt`
- 参与过该节点对话的人集合 `participants`
- 当前绑定会话 `activeSessionId`
- 参考文件绑定
- 范围选择
- 产出文件集合
- 主产出文件
- 是否已登记合并
- 是否已实际合并

### Phase 0 明确不做的状态

当前阶段不做：

- 手动选择 `todo / in-progress / ready-for-merge / done / blocked`
- 把 `queued`、`running` 一类执行调度状态写成节点主业务状态
- 根据 agent 结果自动智能推断章节业务状态

原因：

- 这些状态主观性较强
- 容易和协作状态、执行状态混淆
- 会让产品验证成本上升

### 协作规则

节点协作先按下面的客观规则工作：

1. 用户成功发送消息时，节点自动加锁给该用户
2. 未解锁前，其他用户不能再发送问题
3. 其他用户仍然可以进入页面查看对话与执行过程
4. 用户可主动解锁，解锁后其他人可以继续接手发送
5. `recentPromptAuthor` 只在成功发送一条 user prompt 后更新
6. `participants` 记录所有成功发过 prompt 的用户

### 执行状态边界

OpenCode session 本身可能存在 `idle / running / error` 等执行事实，但这些不应直接当作章节业务状态。

更合适的做法是：

- 执行事实来自 session/runtime
- 工作台只在需要时读取这些事实用于展示或交互控制
- 节点主记录不再把 `queued` 等调度词汇当成生命周期字段

## 第二阶段前端变化

前端不再直接把 `outline.json` 当真相源，而是：

1. 读取 `bid project` 与 `bid sections`
2. 展示数据库中的当前章节树
3. 点击“刷新”时调用服务端刷新接口
4. 刷新成功后重载 sections / sources / marks / merge status

左侧文件区仍然保留，但其中：

- 投标文件区需要支持“设为章节主源”
- 模板文件区需要支持“设为主模板”
- 参考文件和产出文件继续绑定到 section

## 实现顺序修正

第二阶段建议顺序：

1. 设计并落地 workspace 私有 sqlite 账本
2. 落地 bid-workbench server API
3. 落地“投标文件 -> 章节树 snapshot”提取器
4. 落地手动刷新同步
5. 前端从数据库驱动状态
6. 最后再考虑导出 JSON / 主文档结构级合并

## 当前落地状态（2026-04-30）

当前实现已经按第二阶段落地到下面这条状态链：

1. 左侧四类文件区继续直接使用 workspace inbox 路径
2. 用户显式选择一个文件作为章节主源
3. 服务端读取主源结构并刷新章节树
4. `state.db` 保存：
   - `章节 -> session`
   - `章节 -> 锁/当前编辑人`
   - `章节 -> reference/output/template 绑定`
   - `章节 -> mergedIntoMaster / mergedOutputPath`
   - `章节 -> marks`
5. 前端页面只读写 server API，不再直接改本地 JSON

## 历史方案说明

下面这些 JSON 文件只代表第一阶段历史方案，不再是当前实现目标，也不应再被生产代码当成 source of truth：

- `.openwork/bid-workbench/index.json`
- `.openwork/bid-workbench/outline.json`
- `.openwork/bid-workbench/marks.json`

这些文件后续如果还保留，也只能作为：

- 调试导出
- 兼容迁移
- 人工排障辅助

## 文件布局

工作台文件区直接使用 session 文档目录下的显式分类路径：

- `bid-workbench/tender/`
- `bid-workbench/reference/`
- `bid-workbench/output/`
- `bid-workbench/templates/`

这样可以复用现有上传、预览、OnlyOffice 打开能力，同时与旧模块目录隔离。

## 节点级 session 方案

- 每个叶子节点首次发起对话时创建一个独立 session
- session 标题采用稳定格式：`投标节点｜<节点标题>`
- session 视图暂时仍走 `document-agent`，agent lock 默认 `common-work`
- 工作台只负责“节点到 session 的绑定”，不改现有 agent 工作流

后续如果需要专门的 `bid-node-writer` agent，再单独加，不混进首版。

## 总文档合并方案

首版不做复杂 `.docx` 结构级合并。

首版“写入总文档”定义为：

- 把节点当前选定产出文件登记到数据库账本
- 在工作台页面的“总文档编排清单”中显示已写入节点
- 为后续真正章节合并保留稳定状态面

这是故意收敛。先把协作切分、节点状态、文件绑定、独立会话这几个核心问题做对。

## 实现路径

1. 扩展前端 view / route / agents 入口，增加 `bid-workbench`
2. 落地 `state.db` 与 `bid-workbench` server API
3. 新增工作台页面，改为只通过 server API 读写状态
4. 接入上传到四类目录
5. 接入章节主源选择与手动刷新
6. 接入节点级 session 创建与打开
7. 接入节点 reference/output/template 绑定、锁、标记与“写入总文档”

## 验收标准

- 现有 `document-agent` / `document-writer` 路由和行为不变
- 能单独进入新的 `bid-workbench` 页面
- 左侧四类文件上传与展示正常
- 标题树状态能持久化到 workspace 文件
- 叶子节点可创建独立 session 并再次打开
- 节点可显式关联多个参考文件与多个产出文件
- “写入总文档”能稳定登记，不依赖模型记忆
