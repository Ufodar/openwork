# 文档提示层分层宪章

## 目的

这份说明用来定义：在 OpenWork 里，文档 agent 的指导规则到底应该放在哪一层。

当前的直接目标不是再增加更多 prompt 规则，而是停止下面这些层之间的相互重叠：

- runtime instructions
- runtime knowledge / document-state carrier instructions
- plugin hook 注入
- `common-work`
- `document-writer`
- 隐藏的 `doc-*` subagent prompts

如果这些层继续混在一起，每一次局部修复都会重新引入重复、冲突，或者额外的注意力噪音。

## 当前诊断

当前系统的问题，已经不再主要是 bridge 太重，而是：

1. `common-work` 仍然承载了过多行为规则、实现细节和恢复策略。
2. `document-writer` 仍然把 controller 逻辑、task 模板细节和 workflow 实现细节混在了一起。
3. 一些规则同时存在于多个层里，容易造成路由冲突。
4. session 动态事实和静态产品契约，还没有始终被清楚地区分开。

相较之下，runtime 相关层次已经比 agent prompt 本体更接近合理形态。

## 分层模型

### 1. Runtime Session Instruction

这一层只定义 hosted runtime 的运行边界。

这里允许放：

- `<WORKSPACE>` 就是当前根目录
- 哪些临时但可重开的产物该放在哪里
- 稳定交付物和 durable state 必须放在哪里
- `/tmp`、`/private/tmp`、`external_directory` 这些路径不能怎么用

这里不应放：

- 文档 workflow 策略
- 超出通用运行能力范围的知识库路由策略
- 样例特定 guidance
- controller 行为或 phase sequencing

这一层应该回答：

- agent 在哪里可以安全地读写？
- 什么算稳定产物，什么算临时产物？

### 2. Runtime Knowledge Instruction

这一层承载当前 session 的动态知识库事实。

这里允许放：

- 当前附加了多少个知识库
- 当前附加的是哪些知识库
- 对相关事实检索 / 解释类请求，必须先 probe 一次 attached knowledge 再走更宽 fallback 的规则
- attached knowledge 不足时应该怎么处理

这里不应放：

- 完整文档 workflow
- 宽泛的文档发现策略
- 类似 bridge 的静态二进制文件规则
- 样例特定的检索启发式

这一层应该回答：

- 当前到底附加了哪些知识？
- 在什么情况下 agent 不能跳过它们？

### 3. Runtime Document-State Instruction

这一层定义文件型状态面的地位。

这里允许放：

- `.worktree/**`、`requirements.csv`、`reports/**` 是 durable state surface
- 即使有 overlay，file-backed state 仍然是 source of truth
- 如果 overlay 失效，就继续直接从文件推进

这里不应放：

- 冗长的 workflow 叙事
- 按工具逐条教学的 prose
- controller routing
- 特定领域的 drafting guidance

这一层应该回答：

- durable state surface 到底是什么？
- 当 helper 和文件不一致时，谁是权威？

### 4. Document Mode Bridge

这一层是通用 document-mode guardrail，加上 compaction continuity。

这里允许放：

- 不要直接 `read` 原始二进制 Office 文件
- 优先使用 workspace 内提取出的文本副本
- 如果 bootstrap state / text ref 已存在，优先复用
- 完成交付前必须做 delivery validation
- compaction 时保留精确文件名、目标路径、blocker 和下一步动作

这里不应放：

- 像 attached knowledge 这样的 session 动态事实
- 产品级 routing policy
- phase sequencing
- subagent 选择逻辑
- 基于评测样例长出来的 heuristics

这一层应该回答：

- 哪些是 document mode 下绝不能犯的通用错误？
- 哪些 continuity 信息必须穿过 compaction 保留下来？

### 5. `common-work`

这一层是通用文档工作的宪法型 agent。

它应该保持很薄。

这里允许放：

- workspace-safe 的文档操作姿势
- 尽早读取真实源文件
- 优先复用 durable state，而不是重复发现
- 起草前先解决 authority 和 target
- 完成前必须验证
- 少量静态路由护栏，用来避免它和 runtime knowledge / runtime state 规则直接冲突

这里不应放：

- 大段工具目录解释
- 很重的 MCP 术语
- 隐藏拓扑解释
- 详细 task-call 模板
- 重复的恢复 / fallback 梯子
- controller 专属 phase 逻辑
- 样例化、场景化的领域规则

这一层应该回答：

- 一个通用文档 agent 应该怎样思考？
- 相比 raw OpenCode，它最小但有效的 durable 规则是什么？

### 6. `document-writer`

这一层是更严格的长程正式文档 workflow controller。

这里允许放：

- phase sequencing
- 每个 `doc-*` subagent 分别拥有哪个 phase
- task-call contract 形状
- receipt discipline
- controller 级别的恢复与 reroute 规则

这里不应放：

- 已经在别处定义好的底层提取策略
- 重复的 workspace / runtime 规则
- 本应属于 runtime knowledge instruction 的知识库路由规则
- 应该下沉到具体 subagent prompt 的重复长 prose

这一层应该回答：

- 当前缺的是哪个 phase？
- 下一步应该启动哪个 subagent？
- 应该给它什么窄 contract？

### 7. Hidden `doc-*` Subagent Prompts

这些层应该是 phase-local、职责很窄的。

这里允许放：

- 精确输入文件
- 精确拥有的输出
- phase-specific 验收标准
- phase-specific 停止条件

这里不应放：

- main controller 职责
- 全局 runtime policy
- 宽泛的产品哲学
- 本应属于 `document-writer` 的跨 phase 规则

这些层应该回答：

- 这个 phase 只做什么？
- 它拥有哪些文件？
- 它在什么条件下停止？

## 反模式

下面这些都属于设计错误，应该视为回归：

1. 同一条规则同时放进多个层，除非一份是静态规则，另一份只是最小动态特化
2. 把 session 动态事实放进静态 agent prompt 或静态 bridge 文本
3. 让 `common-work` 用产品实现词汇充当自己的心智模型
4. 把 bridge 当成 workflow policy 的垃圾桶
5. 把 controller 行为塞进 runtime instruction
6. 让评测样例里的名词、结构或阶段逻辑泄漏到共享层

## 当前优先级判断

按照当前代码库状态，下一步清理优先级应当是：

1. `common-work`
2. `document-writer`
3. workflow package 设计
4. helper / MCP 简化

当前的 runtime instructions 和 document bridge 当然还不是完美的，但它们已经不是提示层混乱的主要来源了。

## 建议的下一步顺序

### 第一步：冻结这份宪章

之后不要再机会主义地修改 prompt 层，而不先对照这份分层模型。

### 第二步：薄化 `common-work`

把 `common-work` 压回宪法层，只保留：

- workspace boundary
- read real sources early
- state-first
- authority / target resolution
- verification before finish

除此之外的内容都应该被重新质疑。

### 第三步：薄化 `document-writer`

只保留：

- control loop
- phase ownership
- task-call contract
- receipt handling
- reroute rules

把 phase-local 细节下沉到对应 subagent prompt。

### 第四步：再决定 workflow package 的形态

只有在 `common-work` 已经明显变薄之后，系统才应该决定是否：

- 保留现在的隐藏 `doc-*` 模型
- 引入 `using-document-workflows`
- 或进一步走向更显式的 workflow package

在 `common-work` 和 `document-writer` 仍然过载时，不要做这个决定。

### 第五步：再回看 helper 和 MCP 面

只有在层次边界稳定之后，系统才应该决定：

- 某些 helper verb 是否值得变成薄 CLI helper
- 某些 MCP 面是否应该继续收缩
- 某些实现词汇是否应该彻底从 agent 可见层消失

## 工作规则

当要新增一条规则时，按顺序先问这几个问题：

1. 这是 runtime 运行边界吗？
2. 这是 session 动态事实吗？
3. 这是通用 document-mode guardrail 吗？
4. 这是 constitutional document-agent rule 吗？
5. 这是 controller logic 吗？
6. 这是 phase-local behavior 吗？

如果答案不清楚，就不应该把这条规则加进去，直到它的层级归属先被说清楚。
