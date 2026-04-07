# 文档 Agent 能力模型与 Harness Engineering 综合研究结论

日期：2026-04-03  
适用范围：OpenWork 第二阶段文档系统重构  
状态：研究结论，非实现方案

---

## 0. 这份报告回答什么问题

这份报告不讨论某一条 prompt 应该怎么改，也不讨论下一步先写哪个脚本。

它回答的是更上位的问题：

1. 一个真正广义可用的文档 Agent，核心能力到底是什么。
2. 为什么长程文档任务里，单 Agent 很容易越做越差。
3. 什么叫对文档 Agent 有意义的 Harness Engineering。
4. 当前 OpenWork 已经做对了什么，还缺了什么。
5. 第二阶段后续投入，应该优先打在哪些真正的杠杆上。

这份结论必须同时覆盖两个维度：

- **维度 A：文档基础能力模型**
- **维度 B：Harness Engineering**

只看 A，会得到“懂文档但不稳定”的系统。  
只看 B，会得到“流程很完整但文档不够好”的系统。

---

## 1. 研究材料与方法

这份 `README.md` 不是凭空写出的结论，而是基于三份主研究材料和一份补充审计材料重新综合后的结果：

- [track-a-capability-model.md](./track-a-capability-model.md)
- [track-b-harness-engineering.md](./track-b-harness-engineering.md)
- [synthesis.md](./synthesis.md)
- [prompt-surface-audit.md](./prompt-surface-audit.md)

其中：

- `track-a` 更偏**文档基础能力模型**
- `track-b` 更偏**harness engineering 与前沿模式**
- `synthesis` 更偏**把两条轴映射回当前 OpenWork 代码**

这些材料都很有价值，但它们并不完全一致。  
因此这份总报告不直接照抄任何单份材料，而是先显式列出冲突，再给出我的暂定判断。

## 1.5 本目录的使用方式

本目录不是单篇报告，而是当前 OpenWork 第二阶段文档重构的研究与 handoff 包。

如果你是新的 coding agent，或者是在长时间中断后回来继续推进，建议按下面顺序进入：

1. 先读 [handoff.md](./handoff.md)
2. 再读 [decisions.md](./decisions.md)
3. 再读 [status.md](./status.md)
4. 再读 [prompt-surface-audit.md](./prompt-surface-audit.md)
5. 最后把这份 `README.md` 当成总框架与判断依据

各文件分工如下：

- `README.md`
  - 综合结论。回答“问题是什么、为什么是这样、后续应投在哪些杠杆上”。
- `prompt-surface-audit.md`
  - 当前两份核心 prompt 的结构性审计。回答“哪些内容属于基础能力、harness、过程支撑、实现细节或窄场景偏置”。
- `status.md`
  - 当前进度、已完成结论、未完成问题、下一步建议。
- `decisions.md`
  - 当前已经拍板的研究结论与工作纪律，避免后续来回摇摆。
- `run-ledger.md`
  - 关键研究轮次与产物台账，避免后来者不知道哪些判断是怎么来的。
- `handoff.md`
  - 给新 agent 的最短接力入口，只保留继续推进所需的关键信息。

---

## 2. 当前研究中的主要冲突与暂定判断

这一节是本次完善 `README` 最重要的新内容。  
后面所有结论，都以这里的冲突处理方式为前提。

### 2.1 冲突一：第二阶段的第一刀，应先改 Prompt/Skill，还是先改 Harness/代码

**冲突来源**

- [synthesis.md](./synthesis.md) 倾向于先做一个“2a 阶段”，只改 `common-work`、skills、`document-verify` 等 `.md` 层，先验证仅靠能力模型植入能否改善质量。
- 我之前的独立分析更强调：真正大的杠杆在 harness，尤其是任务建模、观察面、动作面、检查面，而不只是 prompt wording。

**我的判断**

这不是二选一，而是**先后顺序问题**：

1. 先明确能力模型与质量框架
2. 再做最小 prompt/skill 清理，把明显窄偏置和错误心智模型拿掉
3. 然后再进入 harness/代码级实现

也就是说：

- 不能直接跳过 prompt 层去写代码
- 也不能以为只改 prompt 就能解决第二阶段核心问题

**暂定结论：**  
“先完成能力模型和 prompt 层最小收口，再进入 harness 实装”更成立。

### 2.2 冲突二：动作面应该更工作化，还是继续以系统原语为主

**冲突来源**

- 我前面的判断强调：`document-writer` 不应继续以 `doc_state_*`、`state_get_*`、`openwork_knowledge*` 这类实现词为心智模型，而应更接近文档工作动词。
- [track-b-harness-engineering.md](./track-b-harness-engineering.md) 强调：很多成功 agent 系统的底层其实使用的是系统原语，如 Read、Edit、Bash、Glob，而不是高层领域工具。

**我的判断**

这两者并不真正矛盾，它们发生在**两个不同层次**：

- **底层工具 substrate**：可以继续是系统原语
- **Agent 面前的工作模型与路由表述**：应当尽量是工作化的

所以正确说法不是“系统原语错了”，而是：

> 不应让内部实现词直接成为文档 Agent 的默认思考语言。

**暂定结论：**  
底层可以保留系统原语，但上层 skill、router、controller 以及 agent 提示层应尽量工作化。

### 2.3 冲突三：是否应该把任务澄清做成显式前置步骤

**冲突来源**

- [track-b-harness-engineering.md](./track-b-harness-engineering.md) 倾向于把 task clarification 前置成一个更强的 harness step。
- [track-a-capability-model.md](./track-a-capability-model.md) 更强调“先推断、再声明、必要时才问”。

**我的判断**

从用户体验和广义文档任务的角度看，完全前置成问答环节会带来明显摩擦。  
但完全静默假设也会导致错位。

因此更合理的是：

- 默认 **infer-then-declare**
- 高风险歧义时才变成显式单问题确认

**暂定结论：**  
“先推断后声明，必要时只问最少阻塞问题”比“先问一轮再干活”更对。

### 2.4 冲突四：当前 6-phase / 6-subagent 架构是合理基础，还是过度拆分

**冲突来源**

- 当前主线和阶段性文档默认接受 `document-writer + doc-*` 这套控制器/子代理形态。
- [track-b-harness-engineering.md](./track-b-harness-engineering.md) 根据 Anthropic/OpenAI 的外部模式，怀疑这套结构对广义文档任务可能过度拆分。

**我的判断**

这件事目前还不能定论。

原因是：

- 现有结构在恢复性、阶段可见性、流程控制上确实有价值
- 但它是否对“最终文档质量”真的最优，还没有足够证据
- 特别是广义文档任务未必都需要六段式编排

所以这里不能直接写成结论，只能写成：

> 当前编排架构是一个可工作的中间态，但是否应该简化成更轻的 prompt chaining / evaluator-optimizer 结构，仍是开放问题。

**暂定结论：**  
先把它当“可运行中间态”，不要把“是否过度拆分”写成已证实结论。

### 2.5 冲突五：skills 现在算不算真正的 harness

**冲突来源**

- 我之前在总报告里把 skills skeleton 偏正向地归到“真 harness”一侧。
- [track-b-harness-engineering.md](./track-b-harness-engineering.md) 更严格，认为当前 skills 仍然更多是 procedure prose，不算强 harness。

**我的判断**

更准确的说法应该是：

- 当前 skills 是**harness 入口和结构挂点**
- 但它们本身还没有足够强到可以算“成熟 harness”

它们更像：

- 有潜力的结构壳
- 而不是已经实现了强观察面、强动作面、强门控的真正能力放大器

**暂定结论：**  
当前 skills 应定义为“潜在 harness / harness hooks”，而不是直接算成熟 harness。

### 2.6 冲突六：当前系统到底是“已投入很多并且做得不错”，还是“在错误方向上过度投资”

**冲突来源**

- 我的总报告强调：恢复面和过程控制面已经明显较强，这不是无效投入。
- [synthesis.md](./synthesis.md) 则更强调：系统投入重心与实际需要之间存在错位，流程支撑很多，但质量模型、任务建模、观察面设计明显缺失。

**我的判断**

这两句话其实都成立，只是指向不同层次：

- 从**系统韧性**看，当前投入并没有白做
- 从**结果质量杠杆**看，当前投入确实错位了

因此最准确的表述是：

> 当前系统在恢复与流程控制上相对成熟，但在能力放大型 harness 和文档基础能力上投入不足，导致用户最关心的成果质量提升仍然不够。

**暂定结论：**  
当前系统不是“方向全错”，而是“过程支撑相对强，能力放大相对弱”。

---

## 3. 当前讨论中最需要纠正的误区

### 3.1 过程产物不是没用，但它们不是核心本身

当前系统已经投入了很多在：

- phase 编排
- durable state
- receipts
- 恢复与续跑
- runtime carrier
- subagent 分工

这些都很重要，但它们主要解决的是：

- 任务别中断
- 状态别丢
- 流程别乱

它们并不直接等于：

- 文档更准确
- 结构更好
- 语言更合适
- 场景覆盖更广

因此必须明确：

> 过程产物只有在它能显著改变 Agent 的观察面、动作面、检查面、恢复面时，才属于有效 harness；否则只是过程痕迹。

### 3.2 “写得出来”不等于“写得好”

文档任务不像编译器那样有天然的 yes/no 标准。  
用户通常只能给出主观判断：

- 感觉不对
- 不够专业
- 不完整
- 不像给这个对象看的
- 读起来不顺

因此系统不能等用户定义标准后再工作，而必须内建一套**跨场景通用的质量判断框架**。

### 3.3 第二阶段不能只谈 prompt，也不能只谈流程

现在最危险的偏差有两个：

1. 继续把问题理解成“prompt 不够好”
2. 继续把问题理解成“再加状态、再加流程、再加产物”

第二阶段真正该处理的是：

> 如何让一个模型，在广义文档任务里更容易做对事情、少做错事情、并且能在长程任务里维持质量。

---

## 4. 文档 Agent 的两条正交轴

后续所有设计都应该先判断自己落在哪条轴上。

### 4.1 轴 A：文档基础能力模型

它回答：

- 好文档是什么
- 文档任务的核心能力有哪些
- 系统如何弥补用户提问质量不足
- 系统如何覆盖更广场景，而不是只对某一类文档强

### 4.2 轴 B：Harness Engineering

它回答：

- 系统如何塑造 Agent 的工作环境
- 如何收窄观察面
- 如何设计动作面
- 如何让错误更容易被发现和修正
- 如何让长任务不因为状态漂移而失控
- 如何建立可验证的质量回路

### 4.3 为什么这两条轴必须一起看

因为真实的能力不是：

- 仅靠模型自身
- 仅靠基础 prompt
- 仅靠流程状态

而是：

> **实际能力 = 模型能力 × 文档基础能力模型 × Harness Engineering**

这和前沿研究的结论一致：Agent 的能力单位应理解为 **model + scaffold/harness**，而不是只看模型或只看 prompt。

参考：

- [METR：Measuring AI Ability to Complete Long Tasks](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/)
- [OpenAI：A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)
- [Anthropic：Building Effective AI Agents](https://resources.anthropic.com/hubfs/Building%20Effective%20AI%20Agents-%20Architecture%20Patterns%20and%20Implementation%20Frameworks.pdf?hsLang=en)

---

## 5. 文档基础能力模型：什么才是文档 Agent 的“核心能力”

这一部分是后续所有 prompt、skill、harness 的上游。

### 5.1 任务意图重建

普通用户经常不会给完整规范，只会说：

- 帮我整理一下
- 出一版正式的
- 改得更专业一点
- 按这些材料写个说明

因此系统必须具备：

- 识别文档类型
- 推断交付目的
- 判断受众
- 补足默认质量预期
- 在必要时只问最少的阻塞问题

如果系统做不到这一层，后面无论流程多稳，都只是把一个模糊目标执行得更稳定。

### 5.2 材料角色识别

多文档任务里，输入材料并不等价。

系统必须能区分：

- 哪些是**绑定约束**
- 哪些是**权威事实来源**
- 哪些是**背景参考**
- 哪些是**结构示例**
- 哪些只是噪音

如果所有材料都被当成同一种“source”，就会出现：

- 权威与背景混写
- 模板内容被误当成事实
- 示例风格被误当成必须继承的内容
- 低价值材料稀释真正重要的信息

### 5.3 结构与组织能力

文档 Agent 的价值不只是提取信息，还要完成：

- 信息取舍
- 主次分层
- 段落组织
- 章节节奏
- 过渡与连贯

很多 AI 生成文档失败，不是因为单句差，而是因为：

- 结构像拼接
- 重点错位
- 局部都对，但整体不像一个成品

### 5.4 受众与语体适配能力

同一批材料，面向不同读者，文档应该完全不同：

- 管理层摘要
- 会议纪要
- 正式报告
- 对外说明
- 比较分析
- 方案草稿

因此系统不能把某一种语言风格或某一种“正式文档习惯”默认化。

### 5.5 通用质量判断能力

系统必须在内部具备一套**跨场景的质量判断框架**，至少覆盖这些维度：

1. **目的对齐**：这份文档有没有完成它该做的事。
2. **受众适配**：写法和信息量是否匹配目标读者。
3. **事实准确与来源忠实**：是否编造、误引、错写。
4. **结构完整**：该有的部分是否存在，范围是否闭合。
5. **逻辑连贯**：是否前后打架、跳跃、重复。
6. **语言精确**：是否空泛、模糊、泛化过度。
7. **格式与惯例符合**：是否符合目标文档的基本形式要求。

用户未必能把这些维度说出来，但系统内部必须能用这些维度进行判断。

### 5.6 场景广度优先于单一场景深挖

在当前阶段，系统要先覆盖的是广义文档任务，而不是过早锁定某个业务：

- 总结
- 汇报
- 说明
- 比较
- 改写
- 正式信函
- 简报
- 会议纪要
- 方案草稿
- 申请材料

因此任何基础层规则，只要悄悄默认了：

- API 文档
- 程序员语境
- 标书式写法
- 技术方案式 authority

就会损伤系统广度。

---

## 6. Harness Engineering：什么才是对文档 Agent 有意义的 Harness

这一部分是本轮研究最容易被低估，但实际上极其关键的部分。

### 6.1 Harness 不是“辅助设施”，而是能力放大器

对文档 Agent 来说，真正有价值的 harness 不是：

- 多一个 state 文件
- 多一个 prompt
- 多一个流程步骤

而是：

> 让 Agent 更容易看到重要信息、更容易选择正确动作、更容易检查错误、更容易恢复到正确状态的外部结构。

### 6.2 六类关键 Harness

#### H1. 任务建模 Harness

解决：

- 用户说得很差时，系统如何快速建立一个可执行的内部任务模型

应该包括：

- task type
- target deliverable
- audience
- purpose
- constraints
- scope
- acceptance shape

如果这层弱，后面所有阶段都可能建立在错误目标上。

#### H2. 观察面 Harness

解决：

- Agent 到底先看什么
- 在大量材料中什么最先可见
- 哪些内容值得进入上下文

对文档任务来说，观察面比“记住所有东西”更重要。  
正确的方向是：

- 收窄观察面
- 突出高价值材料
- 避免一开始就面对全部 workspace / 全部 facts / 全部输出

#### H3. 动作面 Harness

解决：

- Agent 面前有哪些动作
- 这些动作是否贴近文档工作本身

好的动作面更接近：

- intake
- extract
- compare
- outline
- draft
- revise
- verify

而不是更接近：

- `doc_state_*`
- `state_get_*`
- 某个产品内部 MCP 名称

#### H4. 检查面 Harness

解决：

- 系统如何判断“这版不行”
- 错误如何显式暴露
- 质量问题如何结构化反馈

这是文档 Agent 非常核心的一层，因为“写完了”和“写得好”之间的差距主要就出在这里。

#### H5. 恢复面 Harness

解决：

- 中断后如何继续
- 压缩后如何继续
- 换轮对话后如何继续

但恢复面不是简单“从哪个文件继续读”，而是：

- 如何恢复目标
- 如何恢复当前阶段
- 如何恢复关键 blocker
- 如何恢复下一步判断

#### H6. 评测面 Harness

解决：

- 系统质量如何长期可比较
- 长程任务的退化如何被发现
- 主观质量如何转成可追踪指标

前沿资料都强调：长任务系统如果没有 workflow-level eval，很容易出现“看起来能跑，但质量慢慢漂掉”的问题。

---

## 7. 为什么单 Agent 在长程任务里会退化

这里不再用“记忆不够”这种太浅的解释。

### 7.1 可靠性会随任务长度乘法衰减

长任务失败，常常不是因为某一步完全不会，而是因为每一步都可能出现一点偏差，最后累积失控。

METR 的结论很清楚：

- 长任务里真正重要的是**可靠性**和**对错误的适应能力**
- Agent 能做多长的任务，取决于它能否在错误开始出现时及时纠偏

### 7.2 观察面太宽，重要信息被稀释

文档任务天然有大量材料、版本、状态和约束。  
如果系统不主动设计 observation surface，模型就会：

- 平均用力
- 过度依赖最近上下文
- 忽略真正高权重信息

### 7.3 动作面太散，Agent 会偏向“能做的”，而不是“该做的”

只要动作面中实现层词汇太多、重叠动作太多，Agent 就更容易：

- 选择内部工具路径
- 选择最熟悉的动作
- 继续写而不是先验证
- 继续改而不是先重建任务

### 7.4 检查面不硬，系统会过早宣布完成

长任务里非常常见的问题是：

- 结构像样了
- 文本也生成了
- 文件也有了

但实际上：

- 重点错了
- 受众不对
- 结构没闭合
- 关键内容缺失
- 引用和支撑不足

如果没有好的 checking harness，系统就会过早停机。

### 7.5 恢复面如果只保留过程痕迹，不能解决真正问题

恢复真正需要的是：

- 恢复目标
- 恢复上下文压缩后的关键判断
- 恢复下一步应该做什么

如果恢复面只是“保留很多过程文件”，而不能让系统快速回到正确判断，那它价值有限。

---

## 8. 当前 OpenWork 的现实位置

这一部分不是抽象评论，而是对当前主线的结构判断。

### 8.1 当前系统已经明显较强的部分

#### A. 它已经有比较强的恢复面

在这些文件里都能看到：

- [common-work.md](../../.opencode/agent/common-work.md)
- [document-writer.md](../../.opencode/agent/document-writer.md)
- [session-workspaces.ts](../../packages/server/src/session-workspaces.ts)
- [document-state.ts](../../packages/server/src/document-state.ts)
- [document-state-mcp.ts](../../packages/server/src/document-state-mcp.ts)

当前系统已经具备：

- durable state
- 文件型状态面
- phase 工件
- runtime carriers
- 子代理回执

这说明系统在“不中断、可恢复、可继续推进”上已经投入很多，而且不是无效投入。

#### B. 它已经有比较强的过程控制面

尤其是：

- `common-work` 已经薄化为宪法层
- `document-writer` 已经较明确地承担 controller 职责
- 第二阶段 skeleton 已经进入主线  
  见 [2026-04-03-document-superpowers-stage2-baseline.md](../../docs/plans/2026-04-03-document-superpowers-stage2-baseline.md)

这说明系统并不是还停留在完全无序状态。

### 8.2 当前系统仍然薄弱的部分

#### A. 任务建模面偏弱

当前系统还缺一个稳定的、结构化的任务模型层。  
它还没有把“用户真实要什么文档”正式建模为一个清晰对象。

后果是：

- 用户输入差时，系统容易靠经验猜
- 长程任务里目标容易漂
- “summary / report / proposal / rewrite / compare” 等任务形状的区分不够前置

#### B. 观察面还是偏过程态，不够质量导向

当前的状态面更像在回答：

- 现在做到哪一步
- 哪些工件存在
- 哪些 phase 已完成

但不够强地回答：

- 当前草稿最主要的质量问题是什么
- 哪些信息是真正高优先级
- 哪些未覆盖项最影响结果质量
- 哪些冲突是必须先处理的

这点在当前状态面和工具面里非常明显：

- `.worktree/index.json` 仍偏向过程摘要，而不是完整任务模型
- `document-state-mcp` 系列工具更像“过程状态观察面”，还不是“能力放大型观察面”
- `document-state.ts` 的 phase 推断仍然主要依赖文件存在性，而不是基于“现在最该做什么”的条件判断

#### C. 动作面还泄漏大量实现层词汇

这是当前最明确的问题之一。

在 [opencode.jsonc](../../opencode.jsonc) 里，`document-writer` 仍然拿着这些动作面：

- `doc_state_*`
- `state_get_*`
- `openwork_knowledge*`

这说明系统当前对 Agent 暴露的不是足够工作化的动作面，而还是很偏内部实现层。

这里需要结合“冲突二”的暂定判断来理解：

- 不是说系统底层不能用这些能力
- 而是说这些实现层词不应继续充当上层 agent 的主心智模型

#### D. 质量判断面还不够成为系统骨架

当前系统当然不是没有验证：

- [doc-verifier.md](../../.opencode/prompts/doc-verifier.md)
- 各类 `coverage` / `verify` 文件

但它还没有形成一套更基础、更通用、跨场景的质量判断骨架。  
这意味着：

- 验证更像阶段动作
- 还没上升为整个系统的持续约束

这也是 `track-a` 和 `synthesis` 都强烈指出的空白：

- 当前系统有结构验证
- 但还没有稳定的“通用质量维度 -> 结构化判断 -> 可回写反馈”闭环

#### E. 场景广度仍有隐性偏置风险

在 [common-work.md](../../.opencode/agent/common-work.md) 与 [document-writer.md](../../.opencode/agent/document-writer.md) 里，虽然大方向已经比以前好很多，但仍然存在一些潜在缩窄场景的表达。

例如当 prompt 中反复出现：

- API
- host
- 凭证
- 技术 authority
- `.docx` 长文默认路线

即使本意只是举例，也会对广义文档场景形成偏置。

这一点需要特别谨慎，因为它会让基础层在不自知的情况下收缩成：

- 技术文档代理
- 技术方案代理
- proposal/bid 派生代理

而不是广义文档代理。

---

## 9. 当前系统里，什么是真 Harness，什么只是潜在 Harness 或过程支撑

为了后续不再混淆，这里明确分类。

### 9.1 可以认定为“真 Harness”的东西

- `common-work` 薄宪法层  
  它在收窄任务姿势和基础工作模式。

- `document-writer` 的 controller 定位  
  它在定义任务推进方式，而不是只是多一份提示词。

- knowledge attachment 的动态约束  
  它改变了事实检索类任务的默认路由。

- runtime/session instruction layering  
  它在塑造 Agent 看到的上下文边界。

### 9.2 更准确地说是“潜在 Harness / Harness Hooks”的东西

- skills skeleton  
  它们为“先选工作模式，再开始干活”提供结构入口，但目前还没有强到足以单独算成熟 harness。

- `document-verify` 的现有框架  
  它已经是质量环路的入口，但当前仍更多偏结构验证，还没成为完整质量判断 harness。

- `.worktree/**` 中的部分控制事实  
  它们提供了可恢复的控制面，但是否真正改善了 observation/action/checking，要逐项判定。

### 9.3 目前更像“过程支撑”的东西

- 大量 phase 工件本身
- 仅用于表明过程走到哪一步的状态文件
- 不能直接改变观察面/动作面/检查面的 receipts
- 以产品实现词表达的工具面

这些不是没价值，而是它们还没有真正升级成“能力放大器”。

---

## 10. 第二阶段后续真正该优先投入的杠杆

基于这轮研究，后续优先级不该再是“再多造一个流程层”，而应该是下面这些。

### Priority 1：任务建模 Harness

需要一个更清晰的文档任务模型，至少能表达：

- task type
- target deliverable
- audience
- purpose
- scope
- constraints
- quality criteria

这是后续所有场景 skill 与 checking 的共同上游。

### Priority 2：观察面 Harness

要让 Agent 更容易看见：

- 当前最重要的材料
- 当前最重要的缺口
- 当前草稿的关键问题
- 当前约束与 blocker

而不是默认继续暴露大量过程态或大块原始状态。

### Priority 3：动作面工作化

未来的系统动作面应该逐步从：

- `doc_state_*`
- `state_get_*`
- `openwork_knowledge*`

迁移到更接近文档工作的动词集合。

这不一定意味着立刻改工具实现，但至少意味着：

- Prompt 不应继续把实现词当心智模型
- 技能和动作面命名要更工作化

### Priority 4：通用质量判断框架

这套框架应当进入：

- 基础 prompt 约束
- checking harness
- 场景 skill 的质量扩展
- eval framework

否则系统仍然会停留在“写出东西”而不是“写出更好的东西”。

### Priority 5：场景 skill 体系

在基础能力和通用 harness 之上，再逐步引入：

- summary
- rewrite
- report
- meeting-brief
- comparison
- proposal
- evidence-check

让场景差异被 skill 吸收，而不是继续污染基础层。

---

## 11. 暂不下结论、仍需继续研究的开放问题

下面这些问题现在不能写成定论，只能继续验证：

1. `document-writer + doc-*` 这套 6-phase 架构是否过度拆分。
2. 第二阶段的第一刀究竟应先落在 prompt/skill 层，还是先落在 harness/代码层。
3. 未来 observation harness 更适合落成：
   - 新的 file-backed control surface
   - 新的 MCP/tool surface
   - 还是两者组合。
4. 场景 skill 的最佳颗粒度应该按：
   - 文档类型
   - 操作类型
   - 还是质量目标
   来切分。

这几项都与设计方向直接相关，因此后续实现前必须继续验证。

---

## 12. 明确不建议的方向

下面这些方向如果不加区分地继续走，很容易把第二阶段做偏。

### 12.1 不建议把“更多过程产物”当成默认答案

只要产物不能显著改善 observation / action / checking / recovery，就不要新增。

### 12.2 不建议继续让基础层背窄场景偏置

任何默认带着：

- 程序员语境
- 技术 authority 偏置
- proposal-only 结构
- API/host/凭证类例子

的基础提示词，都会持续压缩文档系统广度。

### 12.3 不建议把 Harness 简化为“记忆系统”

记忆只是恢复面的一部分。  
真正的 harness 更大，包含：

- 任务建模
- 观察面
- 动作面
- 检查面
- 评测面

### 12.4 不建议把 Superpowers 的 coding 内容直接搬过来

真正可迁移的是：

- 先选工作模式
- 收窄观察面
- 约束动作面
- 用少量真会被消费的工件做 handoff
- 在关键转换点设 gate

不该直接迁移的是：

- TDD 内容
- 代码审查式成功标准
- diff 驱动的完成判断
- coding 专属 phase 习惯

---

## 13. 最终结论

这轮研究之后，可以明确得出下面这组结论。

### 13.1 当前系统的问题，不是“没有流程”，而是“能力模型与 Harness 还没有对齐”

系统已经有较强的流程支撑和恢复机制，但这些支撑还没有充分转化为：

- 更好的任务建模
- 更强的观察面
- 更工作化的动作面
- 更稳定的质量判断

### 13.2 第二阶段不该再只谈 prompt，也不该再只谈 state

第二阶段真正应该统一到这个框架里：

> **文档 Agent = 基础文档能力模型 × Harness Engineering**

### 13.3 当前最值得继续研究和设计的，不是更多流程，而是更好的 Harness

尤其是：

- 任务建模 harness
- observation harness
- action harness
- checking/eval harness

### 13.4 过程产物仍然有价值，但它们必须接受更严格的判断

以后任何新产物、新 state、新 helper、新 prompt 规则，都应该先回答：

1. 它改善的是哪一类 harness？
2. 它服务的是基础能力、场景 skill，还是只是过程支撑？
3. 它有没有减少错误动作的概率？
4. 它有没有提高对结果质量的控制力？
5. 它有没有扩大广义文档场景覆盖，而不是缩窄？

如果这些问题答不上来，就不应该进入主线核心结构。

---

## 14. 对 `synthesis.md` 路线图的修正意见

[synthesis.md](./synthesis.md) 给出了一条很积极的路线图，这份总报告吸收其大部分方向，但需要做三点修正：

### 14.1 “阶段 2a 只改 Markdown”是可行实验，不应当被写成默认正确顺序

这个顺序适合作为低成本试探，但不应被当作已经被证明最优的路线。  
更准确的说法应是：

- 先把能力模型和质量框架明确
- 再做 prompt/skill 最小收口实验
- 再决定哪些点必须进入 harness/代码层

### 14.2 “最高杠杆的 5 个变更”里，优先级判断大体合理，但需要显式区分“概念优先级”和“实现顺序”

例如：

- 任务意图重建和通用质量框架，在概念上确实是高优先级
- 但工程实现未必必须先于最小偏置清理发生

因此后续任何路线图都应分开写：

- 概念优先级
- 工程顺序

### 14.3 “新的 observation / quality tools”不能默认直接进入主线

像 `synthesis.md` 中提到的：

- current draft summary
- quality delta
- token-budget aware MCP

这些都可能有价值，但还没有经过“是不是第二真相源 / 是不是增加复杂度”的严格审查。  
因此它们目前应被视为：

- 值得研究的 harness 候选项
- 而不是当前已确认的第二阶段主线事实

---

## 15. 建议的后续研究顺序

在不急着改代码的前提下，建议后续按这个顺序推进：

1. 先正式定义“文档任务模型”
2. 再定义“通用文档质量框架”
3. 再重新审视当前 observation/action surfaces
4. 然后再决定哪些 harness 需要落成新的状态面、skill 或 helper
5. 最后才进入第二阶段实现

这样做，才能避免第二阶段再次变成：

- 看起来很有结构
- 但真正的结果质量提升不够明显

---

## 16. 附：与当前代码最相关的观察入口

后续如果要继续深挖，优先围绕这些文件展开：

- [common-work.md](../../.opencode/agent/common-work.md)
- [document-writer.md](../../.opencode/agent/document-writer.md)
- [opencode.jsonc](../../opencode.jsonc)
- [session-workspaces.ts](../../packages/server/src/session-workspaces.ts)
- [document-state.ts](../../packages/server/src/document-state.ts)
- [document-state-mcp.ts](../../packages/server/src/document-state-mcp.ts)
- [2026-04-03-document-superpowers-stage2-baseline.md](../../docs/plans/2026-04-03-document-superpowers-stage2-baseline.md)

这几处基本就能覆盖：

- 当前系统怎样定义基础能力
- 当前系统怎样暴露动作面
- 当前系统怎样组织恢复面
- 当前系统第二阶段准备到了什么程度
