# Isolated Runtime MCP Sanitization And Hosted Probe Crash

更新时间：2026-03-26

## 背景

这一轮目标不是直接优化文稿质量，而是先把 hosted `common-work` 的基础运行前提修正到可比较状态。

上一轮已经缩到一个明确问题：

- hosted 隔离 runtime 里 `skill(name=docx)` 会报 `Error: Unable to connect. Is the computer able to access the url?`
- 同时在 pod 的 isolated runtime 日志中，看到了一个明显的宿主机配置泄漏：
  - `mcp.filesystem.command = ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/storm/Documents/code"]`

这说明 session-local OpenCode runtime 仍然会继承宿主机不安全的 `filesystem` MCP 配置。

## 这轮完成的代码修复

代码改动：

- [session-workspaces.ts](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-workspaces.ts)
- [session-opencode-runtime.ts](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-opencode-runtime.ts)
- [session-workspaces.test.ts](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-workspaces.test.ts)
- [session-opencode-runtime.test.ts](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/packages/server/src/session-opencode-runtime.test.ts)

修复内容：

1. 新增 hosted-safe `filesystem` MCP 清洗逻辑。
2. 对 session runtime overlay 写入链做清洗：
   - 如果 `mcp.filesystem` 指向绝对路径，且该路径不在当前 `workspacePath/runtimeDir` 下，则从 runtime carrier config 中移除。
3. 对 isolated runtime seeding 链做清洗：
   - 从宿主机复制到 session-local `OPENCODE_CONFIG_DIR` 的 `opencode.json/opencode.jsonc` 会再次清洗，避免把宿主机绝对路径 `filesystem` 带进 hosted session。

这个修复没有改 OpenCode 源码，只改了 OpenWork server 的 runtime 组装。

## 测试结果

本地测试：

```bash
bun test packages/server/src/server.proxy-session-create.test.ts \
  packages/server/src/session-workspaces.test.ts \
  packages/server/src/session-opencode-runtime.test.ts
```

结果：`12 pass`

本地二进制构建：

```bash
corepack pnpm --filter openwork-server build:bin
```

结果：成功

pod 同步后测试：

```bash
ssh ... 'cd /root/ai_staff/openwork && \
  bun test packages/server/src/server.proxy-session-create.test.ts \
    packages/server/src/session-workspaces.test.ts \
    packages/server/src/session-opencode-runtime.test.ts && \
  corepack pnpm --filter openwork-server build:bin'
```

结果：`12 pass`，`build:bin` 成功。

## live probe 新结论

为了验证 hosted 真实行为，又补跑了一个最小 probe：

- 脚本：[pod-hosted-skill-probe.mjs](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/tmp/pod-hosted-skill-probe.mjs)
- 目标：只让 pod 上的 hosted `common-work` 做一次 `brainstorming` skill 可见性检查

结果不是旧的 `skill` 连接错误先出现，而是更高优先级的新 blocker：

1. `POST /auth/login` 正常
2. `POST /w/.../opencode/session` 正常
3. `POST /w/.../opencode/session/<sessionId>/prompt_async` 返回 `204`
4. 随后共享主 `opencode` 进程直接退出
5. `openwork-orchestrator` 跟着退出
6. `openwork-server` 和前端代理也被清理掉

从 `/tmp/openwork-restart.log` 可见关键链路：

- `POST /w/user-c503.../opencode/session 200`
- `POST /w/user-c503.../opencode/session/ses_2d628c80dffe5KRyUSAj2WCqzA/prompt_async 204`
- `[opencode] ERROR Process exited`
- `[openwork-orchestrator] Shutting down`

所以当前结论是：

- `unsafe filesystem MCP` 泄漏这个具体问题已经被代码层修掉并通过单元测试。
- 但 hosted 最小 probe 现在暴露出一个更底层的新问题：
  - shared OpenCode 1.2.6 主进程会在最小 `common-work` probe 后直接退出。

这意味着：

- 不能再把当前 blocker 继续表述成“isolated runtime skill 连接错误”。
- 当前更应该优先查：
  - 为什么 `prompt_async` 之后共享 `opencode` 主进程会退出
  - 这是 `common-work` prompt、OpenCode 1.2.6、还是 orchestrator 封装层触发的 crash

## pod 恢复情况

probe 触发 crash 后，`restart-pod.sh` 又因为前端重建被系统杀死：

- `vite build`
- `Exit status 137`

所以这次没有再用 `restart-pod.sh` 恢复，而是直接复用了现有 `dist/` 和 `dist/bin/`，手工拉起：

- `node scripts/serve-web-prod.mjs`
- `packages/orchestrator/dist/bin/openwork serve ...`

恢复后健康检查重新成功：

```bash
curl http://127.0.0.1:8789/health
```

## 当前建议

下一轮不要再先追 `docx skill`。

优先顺序应该改成：

1. 先复现并定位 `prompt_async` 后共享 `opencode` 主进程退出的根因。
2. 把这个 crash 与 session-isolated runtime 的 `filesystem` 泄漏问题分开看。
3. 只有主 shared OpenCode 不再因最小 probe 崩掉，才值得继续验证 hosted `skill` 链是否真的恢复。
