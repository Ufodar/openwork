# OpenWork 共享治理规则

本文件定义跨 agent 共享的治理规则。

- 角色、工作流和任务路由，留在各自的 agent prompt 中。
- 持久经验沉淀、共享 skill 分层和禁止项，以本文件为唯一策略来源。
- `hermes-learning-loop` 的详细执行步骤，以对应 skill 为准；本文件只定义何时触发、允许沉淀什么、应沉淀到哪里。

## Hermes learning loop

在以下场景结束后，使用 `hermes-learning-loop` skill：

- 非平凡任务
- 重复调试
- 根因分析
- 发现了可复用的工作流、架构约束、反模式或验证步骤

每次使用该 skill 前，必须先明确做出一个决策：

- `unchanged`
- `patch`
- `create`
- `delete`

如果当前 agent 没有足够的文件权限把 lesson 落到目标 skill 位置，不要伪造“已经沉淀完成”。
此时应把 durable lesson、建议位置和建议动作明确上浮给有权限的主代理，由主代理完成最终落盘。

## 共享经验沉淀分层

OpenWork 中的经验沉淀必须先判断作用范围，再决定写入位置。

### 1. 系统级共享经验

满足以下条件时，视为系统级共享经验：

- 对多个用户都成立
- 不依赖单个项目源码仓库
- 预期跨 workspace、跨 session 复用

写入：

```text
~/.config/opencode/skills/<skill-name>/SKILL.md
```

这才是 OpenWork 多用户系统的全局共享 skill 面。

### 2. 项目级共享经验

满足以下条件时，视为项目级共享经验：

- 只对当前源码仓库或当前产品实现成立
- 应随仓库一起版本化、评审和发布

写入：

```text
.opencode/skills/<skill-name>/SKILL.md
```

仅当你正在项目源码 workspace 中工作时，才使用这个位置。

### 3. 会话级临时产物

以下位置不是 durable 共享记忆面：

- `documents/sessions/<runtimeId>`
- hosted / isolated session 当前 `<WORKSPACE>` 下的 runtime 副本

不要把共享 skill 写进这些会话级 runtime 副本中，并把它误当成系统已经完成自我升级。

### 4. 不应沉淀的经验

满足以下任一情况时，优先选择 `unchanged`：

- 只适用于当前一次性任务
- 只适用于当前输入材料
- 只适用于操作者个人本机偏好
- 证据不足，仍停留在猜测层

## 允许沉淀与禁止沉淀

只允许沉淀：

- 经过证据支持的工作流
- 架构约束
- 反模式
- 验证步骤

禁止沉淀：

- 启发式关键字匹配
- prompt hack
- 只为过测试的修补
- 一次性业务结论
- secrets、token、cookie、个人数据

## 完成条件

如果某个 lesson 预期要进入未来 session 的真实行为面，只写下 skill 文件还不够，还必须确认：

- 写入位置与 lesson 的作用范围一致
- 负责最终落盘的 agent 真的具备对应位置的文件权限
- 相关 agent 的 `permission.skill` 允许调用该 skill
- hosted / isolated session 的加载链路确实能发现它

如果上述条件没有同时满足，就不算真正完成了共享经验沉淀。
