---
name: hermes-learning-loop
description: 在 OpenWork 中，任务完成后把经过证据验证的流程知识沉淀为共享 skill；适用于非平凡任务、重复调试、根因分析和发现可复用约束的场景。
---

# OpenWork Hermes Learning Loop

## 何时使用

仅在以下场景结束后使用：

- 任务涉及明显的探索、调试、架构判断或多轮修复
- 同一类问题反复出现，已经识别出稳定失败模式
- 发现了可复用的工作流、架构约束、反模式或验证步骤
- 用户明确要求系统“记住”这次经验，供未来 session 复用

不要把它用于一次性的小修、小范围文案改动或临时试验。

## 目标

把已经被代码、日志、文档或成功执行结果支持的经验，沉淀为 **OpenWork 共享 skill**，供未来同一 workspace、同一部署链路、同一多用户系统复用。

在 OpenWork 中，默认沉淀位置是：

```text
<WORKSPACE>/.opencode/skills/
```

而不是 `~/.codex/skills`。只有在经验明确属于操作者本机私有工作流、且不应进入项目版本控制时，才考虑停留在项目外。

## 非谈判规则

- 只保留有证据支持的经验：代码、日志、文档、成功执行结果
- 只保留可复用内容：工作流、架构约束、反模式、验证步骤
- 不要保留启发式关键字匹配、prompt hack、只为过测试的修补
- 不要写入 secrets、token、cookie、个人数据或一次性业务内容
- 优先补现有 skill，不要重复创建含义重叠的新 skill
- skill 要短、可操作、能被未来 session 直接调用

## 决策输出

每次使用时，必须先做一个明确决策，只能是以下四种之一：

1. `unchanged`：不改任何 skill
2. `patch`：补现有 skill
3. `create`：创建新 skill
4. `delete` / `supersede`：删除或替换过时 skill

如果经验只适用于当前一次性任务、当前输入材料、或单个临时故障，不要创建 skill，选择 `unchanged`。

## OpenWork 专用流程

### 1. 先确认是否值得沉淀

逐项检查：

- 这个经验未来在 OpenWork 中是否可能再次出现？
- 它是否能帮助未来 session 少走弯路？
- 它是否属于共享产品行为，而不是个人电脑/个人偏好？

如果任何一项答案是否定的，优先保持 `unchanged`。

### 2. 收集证据

只整理最小必要证据：

- 哪段代码或配置说明了这个约束
- 哪条日志或失败现象暴露了问题
- 哪次成功执行证明了修正后的流程有效

不要把长篇回顾塞进 skill。

### 3. 选择沉淀位置

- **共享 OpenWork 行为**：写到 `<WORKSPACE>/.opencode/skills/<skill-name>/SKILL.md`
- **仅个人本机有效**：不要写进项目级 skill；通常保持 `unchanged`

### 4. 写入内容

优先包含这些部分：

- 触发条件
- 约束
- 应做什么
- 不要做什么
- 如何验证

### 5. 验证共享 skill 是否真可用

如果这个 skill 预期要在 hosted / isolated session 中生效，还必须检查：

- `.opencode/skills/<skill-name>/SKILL.md` 已存在
- 相关 agent 的 `permission.skill` 允许调用它
- runtime skill allowlist 会把它镜像进 session workspace

如果没有做到这三点，就不算真正完成。

## 明确避免

- 不要把“这次正好有效”的临时招数写成 skill
- 不要把测试文件里的特殊断言当成通用产品逻辑
- 不要把样例驱动、业务词表驱动、关键字猜测写进共享 skill
- 不要把长篇 incident 复盘直接复制成 skill

## 结束时如何汇报

使用这个 skill 后，对用户只汇报 3 件事：

- 决策结果：`unchanged / patch / create / delete`
- 影响路径：哪个 shared skill 被改了
- 1-2 句 durable lesson

不要输出冗长 retrospective，除非用户明确要。
