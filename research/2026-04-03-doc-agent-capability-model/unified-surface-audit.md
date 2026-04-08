# 统一面审计：D-012 视角

日期：2026-04-08
判据：D-012（不为可自我修正的短弯路牺牲通用能力）
适用范围：所有当前 prompt / bridge / runtime instructions 表面

---

## 审计方法

对每个文件中的每个内容块，按四类归类：

1. **必要护栏** — 保护主循环、默认观察面、phase ownership、防止重复打转
2. **基础能力** — 直接决定文档质量的通用能力（质量维度、意图重建、材料角色等）
3. **微观禁令** — 针对个别样例失败的动作级纠偏，消耗注意力预算但收益有限
4. **工程支撑** — 有价值但不应占核心 prompt 位置的流程/实现细节

每个块给出动作：**保留** / **精简** / **下沉**（移到场景 skill 或 reference） / **删除**

---

## 1. common-work.md（~120 行）

| 区块 | 行号范围 | 分类 | 动作 | 说明 |
|------|---------|------|------|------|
| Start Here：轻量发现 | 6-14 | 必要护栏 | **保留** | 防止大范围扫描，塑造观察面 |
| Role：任务意图重建 | 20 | 基础能力 | **保留** | Phase 2a 新增核心能力 |
| Role：材料角色识别 | 21 | 基础能力 | **保留** | Phase 2a 新增核心能力 |
| Role：读取/提取/修改/检查 | 22-25 | 基础能力 | **保留** | |
| Role：质量维度评估 | 26 | 基础能力 | **保留** | Phase 2a 新增核心能力 |
| Role：可恢复状态 | 27 | 工程支撑 | **保留** | 合理但不应继续膨胀 |
| Task intent reconstruction | 30-42 | 基础能力 | **保留** | 核心，infer-then-declare |
| Material role identification | 44-54 | 基础能力 | **保留** | 核心，4 级权威 |
| Workspace boundary | 56-61 | 必要护栏 | **保留** | |
| Read real sources early | 63-70 | 必要护栏 + 基础能力 | **保留** | |
| Prefer durable state | 72-76 | 工程支撑 | **保留** | 已精简，不再膨胀 |
| Resolve authority/target/gaps | 78-83 | 基础能力 | **保留** | |
| Draft from stable sources | 85-91 | 基础能力 | **保留** | |
| **Escalate long formal workflows early** | **93-101** | **微观禁令** | **精简** | 方向对但当前写法太具体。D-013 禁止样例驱动路由。应缩到 2-3 行原则性表述，不列特征清单 |
| Verify against quality dimensions | 103-119 | 基础能力 | **保留** | D1-D8 质量表 |
| When To Ask The User | 121-128 | 基础能力 | **保留** | |

**common-work 总结：** 整体健康。唯一问题是第 8 节"Escalate long formal workflows early"——它是 RL-009/010 样例证据的直接产物，写法过于具体（列特征清单），有滑向 D-013 禁止的样例驱动路由的风险。建议精简为原则性表述。

---

## 2. document-writer.md（~95 行）

| 区块 | 行号范围 | 分类 | 动作 | 说明 |
|------|---------|------|------|------|
| Role | 6-13 | 必要护栏 | **保留** | controller 定位清晰 |
| Durable control surface | 15-18 | 工程支撑 | **保留** | 已精简为 3 行 |
| Main-session responsibilities | 20-26 | 必要护栏 | **精简** | 第 21 行 narrow bootstrap sequence 太具体（指定了 read 顺序），属于微观规定 |
| Main-session guardrails：不做 glob | 29 | 必要护栏 | **保留** | 防止重复发现 |
| Guardrails：不亲自分析 corpus | 30 | 必要护栏 | **保留** | phase ownership |
| Guardrails：不让 child-owned artifacts 变成主控 rediscovery surface | 31 | **微观禁令** | **精简** | 方向对但措辞过于防御式，是对具体样例弯路的反应 |
| Guardrails：quick probe 失败就交给 doc-reader | 32 | **微观禁令** | **删除** | 过细，模型本身能自我修正 |
| Guardrails：avoid repeated exploratory source reads | 33 | 必要护栏 | **保留** | 防止重复打转 |
| Guardrails：不编辑源文档/交付物 | 34 | 必要护栏 | **保留** | |
| Guardrails：不用 outputs 当默认阅读面 | 35 | 必要护栏 | **保留** | |
| Guardrails：不手动合成下游输出 | 36 | 必要护栏 | **保留** | |
| Guardrails：不跳过 missing phase | 37 | 必要护栏 | **保留** | |
| Guardrails：不发明额外 state | 38 | 必要护栏 | **保留** | |
| Guardrails：不委派 bootstrap 给 general | 39 | 必要护栏 | **保留** | D-014 配置级收口的 prompt 侧镜像 |
| Guardrails：不调 non-doc-* agents | 40 | 必要护栏 | **保留** | |
| Guardrails：不调 general 只为重读 | 41 | **微观禁令** | **删除** | 与 39-40 重复，属于同一条规则的冗余展开 |
| Delegation contract：基础结构 | 43-57 | 必要护栏 | **保留** | 已英文化，结构好 |
| Delegation：treat manifest hints as child-owned | 58-59 | **微观禁令** | **精简** | 太细，是对单次样例弯路的反应 |
| Delegation：doc-reader 指名但让 child 选 working surface | 60 | **微观禁令** | **精简** | 方向对但可以合并到 58-59 |
| Phase routing 1-5 | 62-71 | 必要护栏 | **保留** | |
| Phase routing 2 的 4 条子规则 | 65-68 | **微观禁令** | **精简** | 第 65 行"call doc-reader immediately"和第 66-68 行是对控制器在 reader 阶段犹豫的具体补丁。保留一条原则性表述即可 |
| Phase routing 6-7 | 72-73 | 必要护栏 | **保留** | |
| Phase routing 8：reopen owning phase, not general | 74 | 必要护栏 | **保留** | |
| Phase routing 9：不 glob outputs 找交付物 | 75 | **微观禁令** | **删除** | 过细，与第 29 行重复 |
| Phase ownership：keep inside owning phase | 78 | 必要护栏 | **保留** | |
| Phase ownership：各 phase 职责 | 79-85 | 必要护栏 | **保留** | 核心 |
| Phase ownership：doc-reader owns raw source reopening | 81 | **微观禁令** | **精简** | 可以合并进 80 行 |
| Phase ownership：doc-merger keep evidence there, not general | 82 | 必要护栏 | **保留** | |
| Loop discipline | 87-92 | 必要护栏 | **保留** | |

**document-writer 总结：** 核心结构健康，但自 RL-005 以来累积了 ~15 条微观禁令/冗余展开。这些禁令大多是对 1-2 次具体样例弯路的防御，消耗注意力预算但价值有限。建议合并/删除约 8-10 条。

---

## 3. document-mode-bridge.js（184 行）

| 区块 | 分类 | 动作 | 说明 |
|------|------|------|------|
| OFFICE/TEXT/CODE 扩展名分类 | 工程支撑 | **保留** | |
| sampleWorkspace + classifyWorkspace | 工程支撑 | **保留** | |
| buildSystemBridge：readable working surface | 必要护栏 | **保留** | |
| buildSystemBridge：temp vs workspace | 必要护栏 | **保留** | |
| buildSystemBridge：bootstrap from control files | 必要护栏 | **保留** | |
| buildSystemBridge：不让 extracted text 替代 control files | **微观禁令** | **精简** | 与 document-writer 第 31 行重复 |
| buildSystemBridge：check_document_delivery.py | 工程支撑 | **保留** | |
| buildCompactionBridge | 必要护栏 | **保留** | |

**bridge 总结：** 整体精简。第 134 行与 document-writer guardrails 存在重复表述，可以精简。

---

## 4. doc-intake.md（~75 行）

| 区块 | 分类 | 动作 | 说明 |
|------|------|------|------|
| Role + primary outputs | 必要护栏 | **保留** | |
| Default responsibilities | 基础能力 | **保留** | |
| Execution rules：读真实文件 | 必要护栏 | **保留** | |
| Execution rules：创建最小 JSON 先 | 工程支撑 | **保留** | |
| Execution rules：init script resolution | 工程支撑 | **保留** | |
| index.json / manifest.json schema | 工程支撑 | **保留** | |
| conventions.md | 工程支撑 | **保留** | |
| Do not 列表 | 必要护栏 | **保留** | |

**doc-intake 总结：** 干净。无微观禁令膨胀。

---

## 5. doc-reader.md（~90 行）

| 区块 | 分类 | 动作 | 说明 |
|------|------|------|------|
| Role + primary output | 必要护栏 | **保留** | |
| Return contract：compact receipt | 必要护栏 | **保留** | |
| Task contract | 必要护栏 | **保留** | |
| Artifact schema | 工程支撑 | **保留** | |
| Reading discipline | 基础能力 | **保留** | |
| Script resolution discipline | 工程支撑 | **保留** | |
| Default execution path | 工程支撑 | **保留** | |
| "do not browse unrelated repo files" | **微观禁令** | **精简** | 过细，script resolution 已经覆盖 |
| Do not 列表 | 必要护栏 | **保留** | |
| "do not create helper scripts, temp markdown files, unowned reports, or manual Office XML unpack directories" | **微观禁令** | **精简** | 前半部分是护栏（不创建 unowned artifacts），后半部分"manual Office XML unpack"是对具体样例的反应 |

**doc-reader 总结：** 基本健康，有 2 条轻微膨胀。

---

## 6. doc-merger.md（~70 行）

| 区块 | 分类 | 动作 | 说明 |
|------|------|------|------|
| Role + outputs | 必要护栏 | **保留** | |
| Script resolution | 工程支撑 | **保留** | |
| Merger discipline | 基础能力 + 必要护栏 | **保留** | |
| "apply goal relevance aggressively" | 基础能力 | **保留** | 好 |
| "do not carry forward unrelated business/operational/marketing details" | **微观禁令** | **精简** | 方向对，但列举太具体（business/operational/marketing/marketplace），是对样例内容偏置的防御 |
| "merge from compiled state first, narrow reread only" | 必要护栏 | **保留** | |

**doc-merger 总结：** 基本健康，1 条轻微膨胀。

---

## 7. doc-planner.md（~80 行）

| 区块 | 分类 | 动作 | 说明 |
|------|------|------|------|
| Role + outputs | 必要护栏 | **保留** | |
| Script resolution | 工程支撑 | **保留** | |
| Planning discipline | 基础能力 | **保留** | |
| "named systems are primary section contract" | 基础能力 | **保留** | |
| "do not promote low-relevance business/operations/domain-noise facts" | **微观禁令** | **精简** | 同 merger，列举过具体 |
| "do not fall back to rereading sources when merged facts suffice" | 必要护栏 | **保留** | |
| "do not infer rigid named multi-system section skeleton only from source titles" | **微观禁令** | **精简** | 对具体样例 failure 的防御 |

**doc-planner 总结：** 基本健康，2 条轻微膨胀。

---

## 8. doc-writer.md（~200+ 行）— **膨胀最严重**

这是当前最需要精简的文件。逐段标注：

| 区块 | 分类 | 动作 | 说明 |
|------|------|------|------|
| Role + outputs | 必要护栏 | **保留** | |
| Return contract | 必要护栏 | **保留** | |
| Default inputs | 工程支撑 | **保留** | |
| Writing discipline：reuse target doc | 基础能力 | **保留** | |
| .docx 必须是 Office 包，不是 MD/XML | 必要护栏 | **保留** | |
| helper code 放 reports/ 不放交付路径 | 必要护栏 | **保留** | |
| **MD staging draft before helper code** | 基础能力 | **保留** | |
| **不要先写 monolithic python-docx** | **微观禁令** | **精简** | 对具体样例 failure 的防御。可合并入上一条 |
| **prefer pandoc over hand-writing docx-js** | **微观禁令** | **精简** | 工具选择应由 agent 判断，不应硬编码 |
| task-provided section titles 是 literal heading contract | 基础能力 | **保留** | |
| **keep headings semantic, no manual numbering** | **微观禁令** | **精简** | 方向对但展开过多（4 行），缩到 1 行 |
| **strip leading chapter/section numbering markers** | **微观禁令** | **删除** | 是对一次具体格式 bug 的直接补丁 |
| **let renderer provide numbering** | **微观禁令** | **删除** | 与上一条重复 |
| **rename/split headings when draft differs from task contract** | **微观禁令** | **精简** | heading contract 已经说了这件事 |
| draft from plan and merged facts first | 必要护栏 | **保留** | |
| use required_evidence as section-level contract | 基础能力 | **保留** | |
| use source_context_refs / source_briefs | 基础能力 | **保留** | |
| facts.json as backing store, not default input | 必要护栏 | **保留** | |
| **do not read whole facts.json** | **微观禁令** | **删除** | backing store 原则已经说了 |
| **use targeted bash extraction** | **微观禁令** | **删除** | 过于具体的执行指令 |
| **write supported portion conservatively** | 基础能力 | **保留** | |
| **rewrite evidence into implementation language** | **微观禁令** | **下沉** | 只适用于"描述性源→实现方案"这一类场景。应移到场景 skill |
| **make inferred framing explicit (可采用/建议采用)** | **微观禁令** | **下沉** | 同上 |
| **non-formal register** | 基础能力 | **保留** | |
| **do not invent administrative metadata** | 基础能力 | **保留** | |
| **bocha-search: at most 3 searches** | **微观禁令** | **精简** | 搜索策略不应硬编码数量 |
| **bocha-search is only allowed search tool** | **微观禁令** | **删除** | 工具约束应在配置层，不在 prompt |
| **bocha-search retry once then blocker** | **微观禁令** | **删除** | 过细执行指令 |
| **do not invent source titles or URLs** | 基础能力 | **保留** | D3 事实准确的直接体现 |
| **weak bocha results = unresolved** | **微观禁令** | **精简** | 方向对但过展开 |
| **low-authority reposts are background only** | **微观禁令** | **精简** | 可以合并到来源质量一条 |
| **mirror-hosted copy not authoritative** | **微观禁令** | **删除** | 与上一条重复 |
| **do not leave TODO-style placeholder** | **微观禁令** | **精简** | |
| **write external-supplements.md** | 工程支撑 | **保留** | |
| **surface consumed references in deliverable** | 基础能力 | **保留** | |
| **prefer authoritative supplements** | 基础能力 | **精简** | 当前列举过长（government/regulator/standards/vendor + 排除列表），缩到原则 |
| **mirror URL = background only** | **微观禁令** | **删除** | 第三次出现 |
| **keep uploaded-doc facts and supplements separated** | 基础能力 | **保留** | |
| **do not pad with commercial content** | **微观禁令** | **精简** | 合并到"goal relevance" |
| **avoid brochure-style wording** | **微观禁令** | **下沉** | 属于特定文档类型（技术文档）的写作风格约束 |
| **treat plan sections as fact allowlist** | 基础能力 | **保留** | |
| **do not introduce unsupported product names** | 基础能力 | **保留** | |
| **named system sections must be operationally useful** | **微观禁令** | **下沉** | 只适用于"系统级技术方案"场景 |
| **keep layer/component labels unique** | **微观禁令** | **删除** | 对一次具体样例的防御 |
| **each subsection ≥ 2 content blocks** | **微观禁令** | **删除** | 人为规定最小内容量，不是通用原则 |
| **cover composition/flow/interface/constraints** | **微观禁令** | **下沉** | 只适用于技术方案文档 |
| **subsection opening returns to system name** | **微观禁令** | **删除** | 对一次 section drift 样例的防御 |
| **answer 核心组件/实现方式/控制流/对接边界/实施约束** | **微观禁令** | **删除** | 与上上条重复，且只适用于技术方案 |
| **avoid ASCII box-drawing in Word** | **微观禁令** | **精简** | 可以缩到 1 行 |
| **API examples must show method/path/auth/request/response** | **微观禁令** | **下沉** | 只适用于 API 文档场景 |
| **prefer concise API tables over code dump** | **微观禁令** | **下沉** | 同上 |
| **do not fall back to sources when section packets exist** | 必要护栏 | **保留** | |
| **narrow source reread only for gap** | 必要护栏 | **保留** | |
| Coverage discipline | 工程支撑 | **保留** | |
| Do not 列表 | 必要护栏 | **保留** | |

**doc-writer 总结：膨胀严重。** 当前 ~200 行中，约 **25-30 条是微观禁令**，其中至少 **10 条应删除**、**8 条应下沉到场景 skill**、**7 条应精简合并**。精简后应该在 ~80-100 行。

---

## 9. doc-verifier.md（~150+ 行）— **膨胀第二严重**

| 区块 | 分类 | 动作 | 说明 |
|------|------|------|------|
| Role + outputs | 必要护栏 | **保留** | |
| Return contract | 必要护栏 | **保留** | |
| Script resolution | 工程支撑 | **保留** | |
| Default execution path | 工程支撑 | **保留** | |
| **do not glob outputs/reports to find deliverable** | **微观禁令** | **精简** | 与 document-writer phase routing 9 重复 |
| treat section titles as exact heading contract | 基础能力 | **保留** | |
| never clear script-detected risk | 必要护栏 | **保留** | |
| do not rewrite to greener verdict | 必要护栏 | **保留** | |
| do not assume one formal register | 基础能力 | **保留** | |
| **stricter manual audit for structured technical deliverable** | 基础能力 | **保留** | |
| **check external-supplements.md** | 基础能力 | **保留** | |
| **prefer official domains for supplements** | 基础能力 | **精简** | |
| **mirror-hosted = remaining risk** | **微观禁令** | **删除** | 已在 doc-writer 中出现 3 次 |
| **future-work placeholder when supplements exist = call out** | **微观禁令** | **精简** | |
| **manual heading numbering = call out** | **微观禁令** | **删除** | 对一次 heading bug 的直接补丁 |
| **stacked manual numbering = call out** | **微观禁令** | **删除** | 与上一条重复 |
| **duplicate architecture labeling = call out** | **微观禁令** | **删除** | 对一次样例的防御 |
| **section drift = call out** | **微观禁令** | **精简** | 方向对但措辞过于具体 |
| **unsupported product names = call out** | 基础能力 | **保留** | |
| **ASCII box-drawing = remaining risk** | **微观禁令** | **删除** | 与 doc-writer 重复 |
| **brochure-style = remaining risk** | **微观禁令** | **下沉** | 只适用于技术文档 |
| **commercial noise = call out** | **微观禁令** | **精简** | 合并到 goal relevance |
| **thin implementation detail = call out** | **微观禁令** | **下沉** | 只适用于技术方案 |
| **API code dump = remaining risk** | **微观禁令** | **下沉** | 只适用于 API 文档 |
| **inferred implementation without explicit framing = register mismatch** | **微观禁令** | **下沉** | 只适用于技术方案 |
| Verification goals | 基础能力 | **保留** | |
| "do not reopen sources when plan+coverage suffice" | 必要护栏 | **保留** | |
| Report schema | 工程支撑 | **保留** | |
| Do not 列表 | 必要护栏 | **保留** | |

**doc-verifier 总结：** 与 doc-writer 同样的模式——大量微观 call-out 规则是对具体样例失败的逐条补丁。约 **12 条应删除/下沉**，精简后应在 ~80 行。

---

## 10. runtime-knowledge-instructions.md（~20 行）

| 区块 | 分类 | 动作 | 说明 |
|------|------|------|------|
| 知识库路由规则 | 必要护栏 | **保留** | |
| 不用 memory 替代知识库 | 必要护栏 | **保留** | |

**总结：** 干净，无膨胀。

---

## 11. runtime-document-state-instructions.md（~20 行）

| 区块 | 分类 | 动作 | 说明 |
|------|------|------|------|
| .worktree 是真相源 | 必要护栏 | **保留** | |
| Helper 解析规则 | 工程支撑 | **保留** | |
| 就地增量更新 | 必要护栏 | **保留** | |

**总结：** 干净，无膨胀。

---

## 汇总判断

### 膨胀严重度排序

| 文件 | 当前行数 | 微观禁令数 | 建议精简后行数 | 严重度 |
|------|---------|-----------|-------------|--------|
| doc-writer.md | ~200 | ~28 | ~80-100 | **严重** |
| doc-verifier.md | ~150 | ~14 | ~80 | **中等** |
| document-writer.md | ~95 | ~8 | ~75 | **轻微** |
| common-work.md | ~120 | ~1 | ~115 | **极轻** |
| document-mode-bridge.js | ~184 | ~1 | ~180 | **极轻** |
| doc-reader.md | ~90 | ~2 | ~85 | **极轻** |
| doc-merger.md | ~70 | ~1 | ~68 | **极轻** |
| doc-planner.md | ~80 | ~2 | ~76 | **极轻** |
| doc-intake.md | ~75 | 0 | ~75 | **无** |
| runtime 两个 | ~40 | 0 | ~40 | **无** |

### 膨胀的根本模式

所有微观禁令都来自同一个模式：

1. 在样例上观察到一次具体失败（heading 编号错误、brochure 语气、content farm URL、section drift…）
2. 把这次失败直接写成一条显式 prompt 规则
3. writer 和 verifier 各写一条（镜像膨胀）
4. 后续又遇到同类变种，再加一条

这违反了 D-012 的核心原则。

### 跨文件重复

以下规则在多个文件中重复出现：

| 规则 | 出现次数 | 出现位置 |
|------|---------|---------|
| 不 glob outputs/reports 做 rediscovery | 3 | document-writer ×2, doc-verifier |
| mirror URL 不算权威 | 3 | doc-writer ×2, doc-verifier |
| 不让 extracted text 替代 control files | 2 | document-writer, bridge |
| ASCII box-drawing 不适合 Word | 2 | doc-writer, doc-verifier |
| brochure/marketing 语气 | 2 | doc-writer, doc-verifier |

---

## 可执行清单：第一批应改动的内容

### 优先级 1：删除（直接可执行，无争议）

1. **doc-writer.md**：删除 strip heading numbering markers（2 条）
2. **doc-writer.md**：删除 "do not read whole facts.json" + "use targeted bash extraction"（2 条）
3. **doc-writer.md**：删除 "bocha-search is only allowed search tool" + retry 策略（2 条）
4. **doc-writer.md**：删除 mirror URL 重复（第 3 次出现）
5. **doc-writer.md**：删除 "each subsection ≥ 2 content blocks"
6. **doc-writer.md**：删除 "subsection opening returns to system name"
7. **doc-writer.md**：删除 "keep layer/component labels unique"
8. **doc-writer.md**：删除 answer 核心组件/实现方式 checklist（与前面重复）
9. **doc-verifier.md**：删除 manual heading numbering（2 条）
10. **doc-verifier.md**：删除 duplicate architecture labeling
11. **doc-verifier.md**：删除 ASCII box-drawing（与 doc-writer 重复）
12. **doc-verifier.md**：删除 mirror-hosted remaining risk（与 doc-writer 重复）
13. **document-writer.md**：删除 "quick probe 失败就交给 doc-reader"
14. **document-writer.md**：删除 "不调 general 只为重读"（与 39-40 重复）
15. **document-writer.md**：删除 phase routing 9 "do not glob outputs"（与 guardrail 29 重复）

### 优先级 2：下沉到场景 skill（需要先建场景 skill 体系）

1. **doc-writer.md**：rewrite evidence into implementation language（→ 技术方案 skill）
2. **doc-writer.md**：make inferred framing explicit 可采用/建议采用（→ 技术方案 skill）
3. **doc-writer.md**：named system sections operationally useful（→ 技术方案 skill）
4. **doc-writer.md**：cover composition/flow/interface/constraints（→ 技术方案 skill）
5. **doc-writer.md**：API examples schema（→ API 文档 skill）
6. **doc-writer.md**：prefer concise API tables（→ API 文档 skill）
7. **doc-writer.md**：avoid brochure-style wording（→ 技术方案 skill）
8. **doc-verifier.md**：brochure-style remaining risk（→ 技术方案 skill）
9. **doc-verifier.md**：thin implementation detail（→ 技术方案 skill）
10. **doc-verifier.md**：API code dump（→ API 文档 skill）
11. **doc-verifier.md**：inferred implementation register mismatch（→ 技术方案 skill）

### 优先级 3：精简合并（可和优先级 1 一起做）

1. **common-work.md** 第 8 节 Escalate：4 个特征清单 → 2 行原则
2. **document-writer.md** guardrail 31：child-owned artifacts → 缩短措辞
3. **document-writer.md** delegation 58-60：manifest hints → 合并为 1 条
4. **document-writer.md** phase routing 2 子规则：4 条 → 1 条
5. **doc-writer.md**：bocha-search 相关 → 合并为 1 条搜索纪律
6. **doc-writer.md**：来源质量相关（low-authority/repost/mirror）→ 合并为 1 条权威性原则
7. **doc-writer.md**：heading numbering → 1 行
8. **doc-verifier.md**：section drift + commercial noise → 合并到 goal relevance

---

## 当前不动的部分

- Phase routing 整体结构（D-008 开放问题）
- 6-phase / 6-subagent 架构（D-008）
- Script resolution discipline（所有 doc-* 都有，格式一致，有效）
- Runtime instructions（干净）
- Bridge 主体逻辑（干净）
