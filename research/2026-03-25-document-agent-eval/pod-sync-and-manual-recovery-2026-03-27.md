# pod 代码对齐与手工恢复（2026-03-27）

## 背景

- 当前已有真实用户开始使用 pod 里的 OpenWork。
- 这轮优先级不再是继续长样例评测，而是先保证：
  - 本地 `dev` 工作树和 pod `/root/ai_staff/openwork` 的实际代码内容一致
  - pod 上的 OpenWork 能恢复到稳定可用状态

## 结论

- 当前 pod 上运行的关键代码内容已经和本地工作树对齐。
- pod 当前可用，并且不是“短暂恢复”：
  - `http://127.0.0.1:8789/health -> 200`
  - `http://127.0.0.1:32765/openwork/health -> 200`
  - `http://127.0.0.1:32765/ -> 200`
- 当前运行方式不是依赖 `restart-pod.sh`/`recover-pod-runtime.sh` 的恢复链，而是：
  - 在 pod 上完成最新代码构建
  - 直接手工拉起两条 `serve-web-prod.mjs`
  - 直接手工拉起 compiled orchestrator

## 对齐证据

- 这轮先把本地当前工作树的变更和未跟踪文件打包同步到 pod `/root/ai_staff/openwork`。
- 然后抽取 8 个关键文件做本地/远端 SHA-256 对比，结果完全一致：
  - `AGENTS.md`
  - `.opencode/agent/common-work.md`
  - `packages/app/src/app/lib/tool-monitor/analyze.ts`
  - `packages/server/src/session-workspaces.ts`
  - `packages/server/src/session-opencode-runtime.ts`
  - `scripts/start-pod.sh`
  - `scripts/restart-pod.sh`
  - `scripts/recover-pod-runtime.sh`

## 本轮真实故障

- pod 当时已经完全不可用：
  - `127.0.0.1:8789` down
  - `127.0.0.1:32765/openwork/health` down
- 关键根因不是“代码没同步”，而是：
  - 服务曾被拉起
  - 随后又被 `/admin/runtime/restart` 维护控制路径打掉
- 这点可从：
  - `tmp/restart-pod-detached.log`
  - `tmp/restart-pod.log`
  直接看到：
  - `POST /admin/runtime/restart 200`
  - `GET /admin/runtime/restart 200`
  - `Shutting down`

## 采取的恢复方式

- 不再继续依赖不稳定的恢复脚本链。
- 在 pod 上直接执行：
  - 最新前端构建
  - `openwork-server` binary 构建
  - `opencode-router` binary 构建
  - `openwork-orchestrator` binary 构建
- 然后用 `nohup` 手工拉起：
  - `node scripts/serve-web-prod.mjs`
  - `OPENWORK_WEB_PORT=32765 node scripts/serve-web-prod.mjs`
  - `packages/orchestrator/dist/bin/openwork serve ... --opencode-source downloaded ...`
- 运行参数保持：
  - `OPENWORK_DISABLE_SHARED_WORKSPACE_EVENT_TRACKING=1`
  - `--opencode-source downloaded`

## live 运行证据

- 手工恢复后，延迟复检仍保持健康：
  - `8789=up`
  - `32765=up`
- 当前 pod 进程快照：
  - `1634850 node scripts/serve-web-prod.mjs`
  - `1634851 node scripts/serve-web-prod.mjs`
  - `1634852 packages/orchestrator/dist/bin/openwork serve ...`
  - `1635080 .../sidecars/opencode/1.3.3/linux-x64/opencode serve ...`
  - `1635185 packages/opencode-router/dist/bin/opencode-router serve /root/ai_staff/openwork`
  - `1635208 packages/server/dist/bin/openwork-server --host 0.0.0.0 --port 8789 ...`
- orchestrator 日志确认：
  - `Run ID: dfdfcc6e-0f1b-4b55-b639-2b7b1b806e0b`
  - OpenCode、router、OpenWork server 都已进入 healthy

## 当前判断

- “pod 是否在跑最新修改内容”这件事，这轮已经有内容哈希证据支撑，不再只是口头判断。
- “pod 是否可正常使用”这件事，这轮已经有：
  - 构建成功
  - 延迟健康检查成功
  - 公共入口 HTML 200
  - orchestrator/server/router/opencode 全链进程在位

## 剩余风险

- 当前 pod 可用，但恢复方式仍是手工拉起，不是稳定的标准化运维路径。
- `restart-pod.sh` / `recover-pod-runtime.sh` 这条链仍需要后续继续修，重点是：
  - 为什么服务起来后会再触发 `/admin/runtime/restart`
  - 如何避免恢复脚本在健康后再次自杀式清场
- 此外，这轮对齐仍是“当前 dirty 工作树同步到 pod”，不是规范的：
  - 本地提交
  - push
  - pod pull/build
- 这条流程纪律已经写回 `AGENTS.md`，后续应回到规范路径。
