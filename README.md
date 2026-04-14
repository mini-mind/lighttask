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

- 任务创建、查询、推进、幂等重放。
- 计划创建、查询。
- 图快照读取、保存。
- 任务状态机、DAG 校验、revision 规则。
- 最小端口：任务仓储、计划仓储（core 当前仅依赖 `get/create`）、图仓储、时钟、ID 生成器。
- 统一错误面：`LightTaskError`。

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

- `createLightTask`：入参仍需显式提供 `taskRepository`、`planRepository`、`graphRepository`、`clock`、`idGenerator`；运行时只会在对应 API 被调用时校验该用例实际依赖的端口函数。
- `createTask / listTasks / getTask / advanceTask`：只依赖任务侧当前用到的端口函数，不前置耦合 `planRepository` / `graphRepository`。
- `planRepository`（core 边界）：当前 `createPlan/getPlan/getGraph/saveGraph` 仅要求 `get/create`；`list/saveIfRevisionMatches` 仍保留在 `ports` 完整契约中，供后续计划用例扩展。
- `saveGraph`（路径最小依赖）：始终先读取 `planRepository.get` 与 `graphRepository.get` 决定分支；首次创建路径额外要求 `graphRepository.create` + `clock.now`，更新路径额外要求 `graphRepository.saveIfRevisionMatches` + `clock.now`。
- `createTask`：`title.trim()` 后必须非空。
- `createTask`：`idGenerator.nextTaskId()` 的返回值会做 `trim()`，且结果必须非空。
- `getTask` / `advanceTask`：`taskId.trim()` 后必须非空。
- `createPlan`：`input.id.trim()` 后必须非空。
- `getPlan` / `getGraph` / `saveGraph`：`planId.trim()` 后必须非空。
- `getGraph` / `saveGraph`：`planId.trim()` 后必须非空，且计划必须存在；当计划不存在时优先返回 `NOT_FOUND`，不进入图规则校验。
- `advanceTask`：必须显式传入 `expectedRevision`；省略 `action` 时按当前状态选择默认动作。
- `saveGraph`：首次保存不得传 `expectedRevision`；更新时必须显式传入 `expectedRevision`。
- `advanceTask.idempotencyKey`：用于任务推进的幂等重放；同一任务上，相同 key + 相同请求语义会直接返回 replay 快照且不重复写入，相同 key + 不同语义会拒绝处理。
- `saveGraph.idempotencyKey` / 图快照上的 `idempotencyKey`：当前只作为图快照元数据记录，不提供 replay / 去重语义。
- `idempotencyKey`：空白值会被视为未提供；任务推进会在空白输入时保留任务历史幂等键。
- 端口契约：仓储读写返回值应与存储态隔离，不得共享可变引用。
- 端口契约：仓储写入不得原地修改调用方传入对象；调用方后续篡改原入参也不应污染存储态。
- 端口契约：仓储常规失败应返回 `CoreError` 形状；若端口直接抛原生异常，公共 API 会归一化为 `LightTaskError(INVARIANT_VIOLATION)`，该路径只作为违约防御而非常规语义。
- 错误：统一抛 `LightTaskError`，可按 `code`、`message`、`details` 判别。

## 使用

```bash
npm install
npm run check
npm run dev:cli -- demo
```
