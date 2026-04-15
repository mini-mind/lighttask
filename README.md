# LightTask

LightTask 是通用人机协作编排内核，不是 uTools 应用。目标是为 `linpo`、`TopoFlow` 等应用层提供可复用的核心能力。

## 定位

- `multica`：作为核心功能参考，挖其芯为核。
- `lazyai`：只取极简 harness 思路，补足 codex 式编排、验证与协作能力。
- `linpo`、`TopoFlow`：属于应用层，当前仓库只提供通用内核。

## 范围

- 纯 TypeScript 内核库。
- 只保留公共 API 与 CLI 冒烟入口（根入口 + `data-structures`/`rules`/`ports` 子入口）。
- 不承载 uTools 壳、页面、预加载脚本和应用层策略。

## 当前能力

- 任务：`createTask / listTasks / listTasksByPlan / getTask / advanceTask`，包含 revision guard 与任务推进幂等重放。
- 计划：`createPlan / listPlans / getPlan / updatePlan / advancePlan`。
- 图：`getGraph / saveGraph / editGraph / getPublishedGraph / publishGraph`，明确区分 draft 与 published 边界。
- 运行态：`createRuntime / listRuntimes / getRuntime / advanceRuntime`，并对 `parentRef / ownerRef / relatedRefs` 做统一归一化校验。
- 输出：`createOutput / listOutputs / getOutput / advanceOutput`。
- 编排闭环：`materializePlanTasks / getPlanSchedulingFacts / launchPlan`，覆盖已发布图物化、稳定调度事实计算与计划启动。
- 通知与事件：支持 transport-free 的 `notify.publish(event)`，当前事件边界覆盖 task / plan / graph / runtime / output 单聚合事件，以及 `plan.tasks_materialized`、`plan.launched` 两个编排事件。
- 核心规则：任务/计划状态机、DAG 校验、revision 规则、统一错误面 `LightTaskError`。
- 最小端口：任务、计划、图、运行态、输出仓储，通知端口，时钟，ID 生成器；各 API 仅在调用路径上校验实际依赖的端口函数。

## 目录

```text
lighttask/
├─ README.md
├─ AGENTS.md
├─ .gitignore
├─ package.json            # 包定义与脚本入口
├─ tsconfig.json           # TypeScript 编译配置
├─ src/                    # 源码根目录
│  ├─ data-structures/     # 数据结构层：实体、状态、事件、错误、revision
│  ├─ rules/               # 规则层：FSM、DAG、幂等、revision 规则
│  ├─ ports/               # 端口层：仓储、时钟、ID 生成等接口契约
│  ├─ core/                # 内核编排入口（组合规则层，不承载应用层策略）
│  ├─ cli/                 # 命令行入口与冒烟验证
│  └─ tests/               # API 与规则回归测试
```

## 契约

- `createLightTask`：入参可提供 `taskRepository`、`planRepository`、`graphRepository`、`runtimeRepository`、`outputRepository`、`notify`、`clock`、`idGenerator`；运行时只会在对应 API 被调用时校验该用例实际依赖的端口函数。
- 任务 API：`createTask / listTasks / listTasksByPlan / getTask / advanceTask` 仅依赖任务路径当前用到的端口函数；`advanceTask` 要求显式 `expectedRevision`，并以 `idempotencyKey` 提供 replay/冲突判定。
- 计划 API：`createPlan / listPlans / getPlan / updatePlan / advancePlan` 基于 `planRepository` 完整契约；`createPlan` 与各读取/更新入口都会先做 `trim()` 与非空校验。
- 图 API：`getGraph / saveGraph / editGraph / getPublishedGraph / publishGraph` 以 `planId` 为边界；`saveGraph` 与 `publishGraph` 按创建/更新分支最小化依赖 `graphRepository.create/saveIfRevisionMatches`，并分别维护 draft / published 快照。`saveGraph.idempotencyKey` 当前只写入图元数据，不提供 replay 语义。
- 编排 API：`materializePlanTasks` 以 published graph 为唯一任务物化来源；`getPlanSchedulingFacts` 只输出稳定顺序、ready/runnable/blocked/terminal 等事实，不替上层做派发策略；`launchPlan` 关闭 `ready -> published graph -> tasks -> confirmed plan` 的最小编排回路。
- runtime API：`createRuntime / listRuntimes / getRuntime / advanceRuntime` 只依赖运行态路径当前用到的端口函数；`parentRef / ownerRef / relatedRefs` 在创建时做统一对象引用归一化与空白校验，推进时保持关系字段只读。
- output API：`createOutput / listOutputs / getOutput / advanceOutput` 与其他聚合一致，采用结构化快照、显式 `expectedRevision` 与统一错误面。
- notify：未注入 `notify` 时保持兼容；注入后在成功提交后发布领域事件。当前事件边界覆盖 task / plan / graph / runtime / output 单聚合事件，以及 `plan.tasks_materialized`、`plan.launched` 编排事件，不绑定 SSE / WebSocket / callback 等传输。
- 端口契约：仓储读写返回值应与存储态隔离，不得共享可变引用；仓储写入不得原地修改调用方传入对象。
- 端口契约：仓储常规失败应返回 `CoreError` 形状；若端口直接抛原生异常，公共 API 会归一化为 `LightTaskError(INVARIANT_VIOLATION)`，该路径只作为违约防御而非常规语义。
- 错误：统一抛 `LightTaskError`，可按 `code`、`message`、`details` 判别。

## 使用

```bash
npm install
npm run check
npm run dev:cli -- demo
```
