# 标书 Agent 提示词重构共识审查

时间：2026-03-13  
输入材料：

- `research/2026-03-12-document-agent-real-session-study.md`
- Anthropic 官方提示工程建议与 Claude Code/sub-agents 文档
- OpenCode 源码：`internal/llm/prompt/prompt.go`、`internal/llm/tools/bash.go`、`internal/llm/agent/agent-tool.go`
- 当前提示词与 skills：`document-writer.md`、`bid-analysis`、`bid-drafting`、`bid-qc`、`bid-dedupe`

## 评审团队

三位评审成员是同一岗位：`Prompt Systems Architect`。  
区别只在他们审视系统时的偏置。

- A：最关注上下文密度、可检索性、首步成功率
- B：最关注流程可控性、状态恢复、长任务稳定性
- C：最关注工具路由、运行时约束、失败恢复

## 证据基础

### Anthropic 官方建议

共同认可的几条高优先级原则：

- 指令要直接，不要让模型先读一大段背景再猜重点。
- 复杂任务要拆成可组合的小阶段，不要把完整流程硬塞进一个巨型提示词。
- 当任务脆弱且只有一条安全路径时，给低自由度精确指令；其余场景给中高自由度。
- 子 agent 只有在任务说明非常具体时才可靠。

### OpenCode 源码观察

- `prompt.go` 直接把项目上下文文件拼接到 prompt 末尾，没有更高层的工作流解释器。
- `bash.go` 明确要求优先使用专用 read/search 工具，不要把 `find`/`grep`/`cat`/`ls` 当默认路径。
- `agent-tool.go` 里的子 agent 是一次性、无状态、只读型工具，不能替代主流程编排。

### 真实会话报告结论

- 问题主因不是“缺少更多 skill”，而是首读太慢、探索太多、路径不稳定、失败重试过长。
- 文档任务的第一性需求是尽快读到真实文件，而不是先规划半天。
- 通用 `bash` 仍会出现，但不能成为默认搜索/读取策略。

## 第一轮立场

### A 的主张

当前最大问题是“提示词过长且职责混杂”。  
`document-writer.md` 和 `bid-*` 把路由、状态机、领域知识、禁止项、脚本策略、输出 schema 混在一起。  
既然 OpenCode 只是原样拼 prompt，那么这种写法天然伤害首步决策和 skill 组合能力。

结论：

- 顶层 prompt 只保留边界、路由、失败策略。
- 领域细节下沉到引用文件。
- skill 必须按“结果”拆分，而不是按“整套工作流阶段”堆满细节。

### B 的主张

完全去掉流程结构也不行。  
标书任务是长链路任务，缺乏状态文件和恢复点会导致多轮对话严重漂移。

结论：

- 需要保留 `.worktree/`、`requirements.csv`、`.bid/facts.json`、`reports/` 这套持久状态。
- 但它们应该是“按需创建的工具”，不是每次都强制走完整仪式。
- 简单请求不应被拖进完整分析流水线。

### C 的主张

当前 prompt 还犯了另一个错误：把“禁止生成脚本”写成了绝对规则。  
这直接削弱了 agent 在真实文档任务里的执行能力。  
真实报告里已经显示，大量成功任务依赖 `python3`、`pandoc`、`node`、`npm`、现成技能脚本。

结论：

- 不能一刀切禁止脚本。
- 真正应该禁止的是：把临时脚本产物误当最终交付物，或者绕过已有确定性脚本去做高风险写入。

## 第二轮反驳

### A 反驳 B

如果继续让 `document-writer` 承担“完整标书 SOP”，那它还是会重新长成 500 行。  
状态持久化应该留，但只能保留“何时创建、怎么复用、什么时候必须读”的规则。

B 接受：

- 顶层 prompt 不再描述完整阶段机。
- 只定义何时使用状态文件，不定义庞大阶段脚本。

### B 反驳 C

允许脚本不代表应该重新回到“先写一个大 Python/JS 再试试看”。  
对表格写入、QC、装配这类高风险环节，必须优先走已有确定性脚本。

C 接受：

- 允许一次性 inline 脚本用于提取、清洗、校验、批量整理。
- 不允许用自造脚本替代 `assemble_response_table.py`、`verify_docx_table.py`、`check_deterministic.py` 这类已存在的确定性能力。

### C 反驳 A

如果只强调“短 prompt”，但不补明确的工具路由，模型还是会回到无休止 `find/ls/cat`。  
真实报告已经证明它会这么做。

A 接受：

- 顶层 prompt 必须加入“首读优先”和“最多两次发现动作”的硬约束。
- 必须按文件扩展名或任务类型做第一工具路由。

## 最终一致结论

### 1. 顶层 prompt 只负责四件事

- 工作区边界
- 首步路由
- 失败恢复
- 何时提问用户

顶层 prompt 不再承载完整领域手册，也不再强迫所有任务走同一条工作流。

### 2. 只在脆弱边界保留低自由度

低自由度必须只用于这些位置：

- `<WORKSPACE>` 边界
- `target_doc` 选择
- `requirements.csv` + 确定性装配脚本
- `.tmp/` 使用位置
- 同一路径/同方法两次失败后的切换

其他位置应给中等自由度，让 agent 可组合地完成材料搜索、内容整理、章节撰写。

### 3. bid skills 按“结果”拆，不按“整条流程”压死

- `bid-analysis`：只负责分析、提取、建状态
- `bid-drafting`：只负责把内容写进稳定目标
- `bid-qc`：只负责找问题并输出发现
- `bid-dedupe`：只负责跨标书重复风险

任何 skill 都不应该隐含“必须把整套标书流程跑完”。

### 4. 首次有效读取优先于规划

统一规则：

- 最多 2 次发现动作后，必须进入一次真实读取。
- 先读真实文件，再决定是否需要更重的工作树或 registry。
- 避免反复 listing、反复 `find`、反复读同一段目录。

### 5. 允许脚本，但限制脚本的职责

允许：

- `python3 - <<'PY'`
- `node - <<'NODE'`
- 调用 `.opencode/skills/**/scripts/*`
- 用脚本做提取、转换、校验、批处理

不允许：

- 把独立 `.md` 章节草稿当最终交付
- 用自造脚本去替代已有确定性装配或校验脚本
- 在工作区外落临时文件

### 6. requirements.csv 不应成为所有任务的唯一入口

它应只在这些情形作为主数据面：

- 点对点应答
- 响应表装配
- 需要逐条跟踪状态的需求矩阵

对于叙述型章节、方案章节、服务方案、实施方案，不应强制先把所有内容绕写进 CSV。

### 7. 状态文件是为了恢复，不是为了增加仪式感

默认保留这些状态对象：

- `requirements.csv`
- `.worktree/index.json`
- `.worktree/conventions.md`
- `.bid/facts.json`
- `reports/`

但只在任务规模值得时创建。  
简单请求不应被额外状态拖慢。

## 由共识导出的重写原则

### document-writer

- 删掉大段领域教材
- 改成“边界 + 路由 + 失败策略 + 交付约束”
- 明确 skills 可组合，不强制完整流水线

### bid-analysis

- 只保留：如何识别招标文件、如何快速读取、产出哪些状态文件、何时向用户确认
- 不再嵌入超长流程台本

### bid-drafting

- 改成模式化：`response-table mode` / `narrative-section mode` / `qualification mode` / `pricing mode`
- 去掉“所有任务都必须 CSV-only”的绝对规则
- 保留“响应表写入必须走确定性脚本”的强约束

### bid-qc

- findings-first
- 先确定性脚本，再看 uncovered，再做判断性补充
- 不再把百科式领域清单堆成主体

### bid-dedupe

- 保持短小
- 精确图片区重、长文本重复、可疑语义复查三层即可

## 最终执行决定

按上述共识重写：

- `.opencode/agent/document-writer.md`
- `.opencode/skills/bid-analysis/SKILL.md`
- `.opencode/skills/bid-drafting/SKILL.md`
- `.opencode/skills/bid-qc/SKILL.md`
- `.opencode/skills/bid-dedupe/SKILL.md`

同时补齐缺失的路径契约文档：

- `docs/contracts/bid-session-file-contract.md`

这是本轮重构的最小闭环。
