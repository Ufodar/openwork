# `common-work` 与 `document-writer` 提示层审计

日期：2026-04-04  
适用范围：OpenWork 第二阶段文档系统  
目标：把当前两个核心 Agent prompt 中的内容，按“基础能力 / harness / 过程支撑 / 实现细节 / 窄场景偏置”重新分类，为后续重构提供明确切口。

---

## 1. 审计方法

本次审计只看两个核心文件：

- [common-work.md](../../.opencode/agent/common-work.md)
- [document-writer.md](../../.opencode/agent/document-writer.md)

判断标准来自同目录中的综合研究结论：

- [README.md](./README.md)

每个内容块按下面五类之一归类：

1. **基础能力**
   - 属于广义文档系统长期都需要的核心能力
   - 直接决定“写得好不好”

2. **Harness**
   - 不直接定义内容质量，但会改变 Agent 的观察面、动作面、检查面、恢复面
   - 让“做对更容易、做错更难”

3. **过程支撑**
   - 有工程价值，但更偏流程与韧性
   - 不是用户感知到的核心能力

4. **实现细节**
   - 与当前系统实现绑定
   - 不应长期占据核心 prompt 的注意力

5. **窄场景偏置**
   - 会把基础 Agent 的默认工作模型悄悄缩窄到某一类文档或某一类用户

每一块还会给出一个动作建议：

- **保留**
- **精简**
- **下沉**
- **改写**
- **删除**
- **开放问题**

---

## 2. 总体结论

先给一句压缩判断：

### `common-work`

当前的 [common-work.md](../../.opencode/agent/common-work.md) 已经很接近“薄宪法层”，整体方向是对的。  
但它仍然有三类问题：

1. **缺少真正的基础能力内容**
   - 例如任务意图重建
   - 例如通用质量判断框架
   - 例如材料角色识别

2. **仍夹带少量实现耦合与技术偏置**
   - 例如直接点名 `openwork_knowledge_search`
   - 例如出现 `API`、`host`、`凭证`

3. **有些过程支撑占了核心 prompt 的位置**
   - 例如过细的状态面列举
   - 例如较重的 `.docx -> Markdown` 默认路线表达

### `document-writer`

当前的 [document-writer.md](../../.opencode/agent/document-writer.md) 已经是“控制器形态”，不是过去的大杂烩，这一点是明确进步。  
但它的问题也很集中：

1. **它仍然过度承担 workflow prose**
   - phase routing 太明确、太线性
   - 对广义文档任务来说可能过重

2. **它更像流程控制器，不像质量控制器**
   - 它很会决定下一步找谁
   - 但对“写得好不好”的约束仍然依赖下游

3. **它仍有历史偏置的补丁痕迹**
   - 例如第 52 行明确出现“non-proposal document”的补丁式说明
   - 这不是解决偏置，而是在承认偏置存在

所以整体上：

- `common-work` 的主要问题是**少了该有的基础能力**
- `document-writer` 的主要问题是**还背着偏重的流程控制**

---

## 3. `common-work.md` 分块审计

### 3.1 Start Here

位置：
- [common-work.md:6](../../.opencode/agent/common-work.md#L6)
- [common-work.md:14](../../.opencode/agent/common-work.md#L14)

内容摘要：
- `<WORKSPACE>` 是默认 cwd
- 只做一次轻量发现
- 不要 `glob **/*`
- 优先读取 `.worktree/**` / `reports/**`
- 二进制文档优先转文本后再读

分类：
- `当前工作区根目录就是 <WORKSPACE>`：**Harness**
- `只做一次轻量发现 / 不要 glob **/*`：**Harness**
- `优先读取 .worktree/** / reports/**`：**过程支撑**
- `二进制文档优先转文本后再读`：**Harness**

判断：
- 这一块整体是有效的。
- 它确实在塑造 observation surface，而不是在教业务内容。
- 但第 13 行把 `.worktree/index.json`、`.worktree/sources/manifest.json`、`.worktree/text/*.txt`、`reports/**` 列得有点细，已经逼近实现层注意力噪音。

建议：
- **保留整体**
- 第 13 行改为更抽象的表达，例如：
  - “如果 workspace 中已存在 durable state 或已提取的文本副本，优先读取这些可恢复观察面”

### 3.2 Role

位置：
- [common-work.md:16](../../.opencode/agent/common-work.md#L16)
- [common-work.md:26](../../.opencode/agent/common-work.md#L26)

内容摘要：
- 读取和理解材料
- 提取事实和结构
- 修改或组装目标文档
- 检查交付质量与一致性
- 长任务中留下可恢复状态
- 尽量直接完成，不默认走隐藏编排

分类：
- 前四条：**基础能力**
- “留下可恢复状态”：**过程支撑**
- “不要默认隐藏编排”：**Harness**

判断：
- 这里是好骨架，但还不够完整。
- 它缺失了当前第二阶段最关键的两个能力：
  - **任务意图重建**
  - **质量判断**

现在它更像：
- 读取
- 提取
- 修改
- 检查

但还不像：
- 先重建任务
- 判断材料角色
- 用一套质量框架决定“这版是否真的好”

建议：
- **改写**
- 应补进 2 句高价值内容：
  - 在用户目标不完整时，先重建任务意图
  - 在起草与交付前，使用通用质量维度进行判断

### 3.3 Workspace boundary

位置：
- [common-work.md:30](../../.opencode/agent/common-work.md#L30)
- [common-work.md:35](../../.opencode/agent/common-work.md#L35)

分类：
- 全部属于 **Harness**

判断：
- 这一块清楚、通用、必要。
- 它塑造的是安全的工作环境，不带窄场景偏置。

建议：
- **保留**

### 3.4 Read real sources early

位置：
- [common-work.md:37](../../.opencode/agent/common-work.md#L37)
- [common-work.md:43](../../.opencode/agent/common-work.md#L43)

分类拆分：
- 第 39 行“先读真实材料，再决定路线”：**基础能力 + Harness**
- 第 40 行附加知识库优先 probe：**Harness**
- 第 41-43 行避免发现后停住：**Harness**

判断：
- “先读真实材料”这条很重要，必须保留。
- 问题主要在第 40 行：直接点名 `openwork_knowledge_search`，把基础 Agent 的心智模型绑到了具体产品能力上。
- 对用户来说，他需要的是：
  - “如果有已附加知识且当前问题明显是事实检索，就优先用这些知识”
- 而不是：
  - “先调用某个具体工具名”

建议：
- **保留原则，抽象掉工具名**
- 这一块应该表达能力，不应该表达产品实现词

### 3.5 Prefer durable state over rediscovery

位置：
- [common-work.md:45](../../.opencode/agent/common-work.md#L45)
- [common-work.md:50](../../.opencode/agent/common-work.md#L50)

分类：
- 整体偏 **过程支撑**
- 其中“优先恢复已有状态而不是重扫”也带有 **Harness** 价值

判断：
- 这块不是错的，但它占的“位置”比它的重要性更高。
- 它主要解决的是：
  - 恢复
  - 续跑
  - 避免重复发现

这很重要，但不是文档系统最核心的价值来源。

建议：
- **保留，但降权**
- 在后续重构里，它应该仍存在，但不应继续膨胀，也不应比“任务建模”“质量判断”更靠近核心位置

### 3.6 Resolve authority, target, and gaps

位置：
- [common-work.md:52](../../.opencode/agent/common-work.md#L52)
- [common-work.md:57](../../.opencode/agent/common-work.md#L57)

分类拆分：
- 第 54-55 行：**基础能力**
- 第 56-57 行：**基础能力 + 窄场景偏置**

判断：
- 这一块是当前 `common-work` 里最接近“材料角色识别”的地方，价值很高。
- 问题在于第 56-57 行的例子仍然明显偏技术语境：
  - `API 细节`
  - `URL`
  - `host`
  - `凭证`

这些内容不是完全不能出现，但放在基础 Agent 核心 prompt 里，会形成默认语境偏置。

建议：
- **保留这一块的结构**
- **删除技术偏置例子**
- 把它改成更广义的表达：
  - “如果本地资料无法补齐关键事实、规则细节或必要依据，再使用可用检索能力寻找权威来源”

### 3.7 Draft from stable sources

位置：
- [common-work.md:59](../../.opencode/agent/common-work.md#L59)
- [common-work.md:64](../../.opencode/agent/common-work.md#L64)

分类拆分：
- 第 61 行：**基础能力**
- 第 62-64 行：**过程支撑 + Harness**

判断：
- “已有模板或半成品时，优先在其基础上修改”是很好的广义文档原则。
- 但第 63 行“长篇 `.docx` 优先保留 Markdown 源稿”虽然工程上很合理，却不应被写成过强默认。
- 这是一个非常典型的例子：
  - 它是有效工程经验
  - 但不是所有文档任务的核心能力

建议：
- **保留**
- 但把 `.docx -> Markdown` 规则改成条件化表达，例如：
  - “当目标文档较长、需要多轮修订或重新生成时，优先维护稳定可编辑源稿”

### 3.8 Verify and reroute

位置：
- [common-work.md:66](../../.opencode/agent/common-work.md#L66)
- [common-work.md:71](../../.opencode/agent/common-work.md#L71)

分类：
- 第 68-69 行：**Harness**
- 第 70-71 行：**基础能力 + Harness**

判断：
- 这里有价值，但当前验证仍偏“完成性验证”：
  - 文件在不在
  - 能不能打开
  - 路径稳不稳

它还没有上升到：
- 目的对齐
- 受众匹配
- 结构完整
- 语言精确
- 来源忠实

建议：
- **保留**
- 后续应把“验证”从“完成检查”扩展成“质量判断”

### 3.9 When To Ask The User

位置：
- [common-work.md:73](../../.opencode/agent/common-work.md#L73)
- [common-work.md:83](../../.opencode/agent/common-work.md#L83)

分类：
- **基础能力 + Harness**

判断：
- 这块整体很好，而且跟你一直强调的用户体验方向一致。
- 它避免系统在一开始把用户拉进一个漫长澄清流程。

建议：
- **保留**
- 但应在未来和“infer-then-declare”明确结合起来，而不是只保留“什么时候问”

---

## 4. `document-writer.md` 分块审计

### 4.1 Role

位置：
- [document-writer.md:6](../../.opencode/agent/document-writer.md#L6)
- [document-writer.md:13](../../.opencode/agent/document-writer.md#L13)

分类：
- **Harness**

判断：
- 它很明确地把自己定义成：
  - main controller
  - hidden `doc-*` narrow workers
- 这属于典型的 orchestrator-workers 架构。

问题不在这里写得不好，而在于：
- 这个架构是否对广义文档任务是最优，还没有证据

建议：
- **作为当前中间态保留**
- **开放问题**
- 不要再继续把它写得更厚

### 4.2 Durable control surface

位置：
- [document-writer.md:15](../../.opencode/agent/document-writer.md#L15)
- [document-writer.md:24](../../.opencode/agent/document-writer.md#L24)

分类：
- **过程支撑**

判断：
- 这块有用，但列举太重。
- 它说明 controller 在读哪些状态面，但在 prompt 里逐条列出这么多路径，会持续消耗注意力。

建议：
- **精简**
- 长期更适合抽成一个更稳定的“control surface contract”，而不是继续放在入口 prompt 里大量占位

### 4.3 Main-session responsibilities

位置：
- [document-writer.md:26](../../.opencode/agent/document-writer.md#L26)
- [document-writer.md:31](../../.opencode/agent/document-writer.md#L31)

分类：
- **Harness**

判断：
- 这是当前 `document-writer` 最健康的一块。
- 它清楚表达了 controller 做什么：
  - 看状态
  - 选下一步
  - 调 subagent
  - 读 receipt

建议：
- **保留**

### 4.4 Main-session guardrails

位置：
- [document-writer.md:33](../../.opencode/agent/document-writer.md#L33)
- [document-writer.md:40](../../.opencode/agent/document-writer.md#L40)

分类：
- **Harness**

判断：
- 这些 guardrails 在当前架构下是有意义的。
- 它们避免 controller 自己跨层做事。

但要注意：
- 这块的价值建立在“当前 controller/subagent 拆分是合理的”这个前提上
- 如果未来架构简化，这部分很多规则会一起失效

建议：
- **当前保留**
- **长期视架构是否收缩而定**

### 4.5 Delegation contract

位置：
- [document-writer.md:42](../../.opencode/agent/document-writer.md#L42)
- [document-writer.md:52](../../.opencode/agent/document-writer.md#L52)

分类拆分：
- 第 43-51 行：**Harness**
- 第 45 行中英混合字段：**实现细节噪音**
- 第 52 行 non-proposal 兜底：**窄场景偏置补丁**

判断：
- 这一块的“contract”价值很高，是典型 harness 内容。
- 但写法上有两个明显问题：

1. 中英混用  
   `Current user objective`、`允许的输入文件`、`验收标准` 混在一起，说明这一层还没形成成熟契约语言。

2. 第 52 行是补丁  
   它不是在定义广义文档系统，而是在承认系统默认会强行 proposal 化。

建议：
- **保留 contract 结构**
- **统一契约语言**
- **删除补丁式“non-proposal”说明**
- 真正的修复方式不是加补丁，而是从基础层移除 proposal/bid 偏置

### 4.6 Phase routing

位置：
- [document-writer.md:54](../../.opencode/agent/document-writer.md#L54)
- [document-writer.md:61](../../.opencode/agent/document-writer.md#L61)

分类：
- **Harness**

判断：
- 这是最有争议、也最关键的一块。
- 它清晰、可执行、可恢复，但也非常重，而且是强线性的。

问题不是写得不清楚，而是：
- 是否所有广义文档任务都值得默认走这 6+1 步
- 是否应该把“最可能的下一步”写成这么强的固定序列

建议：
- **当前保留为中间态**
- **标记为开放问题**
- 不建议现在继续把这一块写得更厚
- 后续更值得研究的是：
  - 它能否变成条件式深度
  - 或更轻的 chaining / evaluator-optimizer 变体

### 4.7 Phase ownership

位置：
- [document-writer.md:63](../../.opencode/agent/document-writer.md#L63)
- [document-writer.md:68](../../.opencode/agent/document-writer.md#L68)

分类：
- **Harness**

判断：
- ownership 是好东西。
- 它明确了每个阶段谁对什么输出负责。

但这里也混入了少量窄偏置痕迹：
- `exact system names`
- `external-support obligations`

这类约束未必错，但更像特定文档类型的强化条目，而不是所有文档任务的普遍规律。

建议：
- **保留 ownership 原则**
- **把偏具体的场景强化项后续下沉到场景 skill**

### 4.8 Loop discipline

位置：
- [document-writer.md:70](../../.opencode/agent/document-writer.md#L70)
- [document-writer.md:75](../../.opencode/agent/document-writer.md#L75)

分类：
- **Harness**

判断：
- 这块很好，是当前 controller 最成熟的一块之一。
- 它直接增强了恢复与续跑质量。

建议：
- **保留**

---

## 5. 两个核心 prompt 的综合判断

### 5.1 `common-work` 更像“缺内容”

它现在的问题主要不是太乱，而是：
- 还没真正装入足够强的基础文档能力

尤其缺：
- 任务意图重建
- 材料角色识别
- 通用质量框架

### 5.2 `document-writer` 更像“太重”

它现在的问题主要不是没结构，而是：
- 已经是一个有效控制器
- 但还背着比较重的流程逻辑
- 并且带着少量历史偏置补丁

### 5.3 两者的最佳分工应更清楚

后续更理想的分工应该是：

- `common-work`
  - 提供基础文档能力
  - 提供最通用的文档工作姿势
  - 不背内部实现词，不背窄场景偏置

- `document-writer`
  - 只在长程、正式、多阶段任务里出场
  - 负责控制循环
  - 不再承担更多基础能力定义工作

---

## 6. 直接可执行的后续动作建议

### 6.1 对 `common-work` 的动作

1. **保留**
   - `Workspace boundary`
   - `Read real sources early`
   - `Verify and reroute`
   - `When To Ask The User`

2. **精简**
   - `.worktree/**` 路径逐条列举
   - 过重的状态面细节
   - `.docx -> Markdown` 的强默认写法

3. **改写**
   - `Resolve authority, target, and gaps`
   - 抽掉技术例子
   - 抽掉具体工具名

4. **新增**
   - 任务意图重建协议
   - 通用质量维度
   - 材料角色识别原则

### 6.2 对 `document-writer` 的动作

1. **保留**
   - `Main-session responsibilities`
   - `Main-session guardrails`
   - `Phase ownership`
   - `Loop discipline`

2. **精简**
   - `Durable control surface` 的逐条路径列举

3. **改写**
   - `Delegation contract` 的语言统一
   - 删除补丁式 non-proposal 兜底

4. **暂不下结论**
   - `Phase routing` 是否需要保留为强线性结构

---

## 7. 最后的判断

如果只用一句话总结这次审计：

> `common-work` 现在更像一个还没装满核心能力的薄宪法层；`document-writer` 更像一个已经可用、但仍偏重且带有历史偏置补丁的控制器。

所以后续最合理的方向不是：

- 继续给 `document-writer` 叠规则
- 继续给基础层加更多实现细节

而是：

1. 先把基础文档能力重新装回 `common-work`
2. 再把 `document-writer` 收成更干净的长程控制器
3. 把偏场景、偏强化的内容留给场景 skill，而不是继续塞在这两个核心 prompt 里

