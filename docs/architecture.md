# LightTask 架构

## 分层定义

```text
[上层应用 / uTools / 服务]
          |
          v
[L3 内核编排层 core]
      /           \
     v             v
[L1 规则层 rules] [L2 端口层 ports]
          \        /
           v      v
      [L0 数据结构层 data-structures]
```

## 职责

1. `data-structures`：实体、状态、事件、错误、revision 等基础结构。
2. `rules`：状态机、DAG、幂等、revision 校验等纯规则。
3. `ports`：仓储、时钟、ID 生成器等端口契约；仓库内允许放仅供 CLI/测试复用的极简本地实现。
4. `core`：`createTask / getTask / listTasks / advanceTask / createPlan / getPlan / getGraph / saveGraph` 编排入口，组合规则、端口与 `data-structures` 稳定入口，不承载应用层策略；其中计划编排当前只依赖 `planRepository.get/create`，运行时依赖校验也应按 use case 路径最小化，避免构造期前置耦合无关端口。
5. 上层应用：`linpo`、`TopoFlow`、未来 uTools 应用，位于本仓库之外。

## 幂等与路径最小依赖

1. 任务幂等只存在于 `advanceTask`：`idempotencyKey` 参与请求语义指纹判定，相同 key + 相同语义返回 replay 快照且不重复写入，相同 key + 不同语义返回冲突。
2. 图快照上的 `idempotencyKey` 当前只是 `saveGraph` 写入的元数据，不承担任务 replay 那类幂等去重语义。
3. 任务 API 采用按路径最小依赖校验：`createTask` 只要求 `taskRepository.create`、`clock.now`、`idGenerator.nextTaskId`；`listTasks` 只要求 `taskRepository.list`；`getTask` 只要求 `taskRepository.get`；`advanceTask` 只要求 `taskRepository.get/saveIfRevisionMatches`。
4. `saveGraph` 也按运行时分支最小化依赖：先读取 `planRepository.get` 与 `graphRepository.get` 判断图是否已存在；创建分支只继续要求 `graphRepository.create`，更新分支只继续要求 `graphRepository.saveIfRevisionMatches`，两条写路径都要求 `clock.now`。

## 硬约束

1. `rules` 禁止依赖 `ports`。
2. `ports` 禁止依赖 `rules`。
3. `core` 是唯一同时依赖 `rules` 与 `ports` 的层。
4. 公共错误面统一为 `LightTaskError`：`code`、`message`、`details`。
5. 当前仓库不实现应用层 API、DB/Runtime 适配器、实时通道或 uTools 壳。
6. `ports` 返回的读写快照必须与存储态隔离；仓储写入不得原地修改调用方传入对象；仓储常规失败走结构化结果，直接抛异常仅视为违约防御路径。

## 稳定入口与实现隔离

1. `core` 依赖 `ports` 时，只能走稳定入口（`ports/index` 或 `port-*` 契约文件），禁止耦合 `ports/in-memory` 等实现文件。
2. `core` 与 `ports` 都禁止深层导入 `data-structures/ds-*` 叶子模块，应改走 `data-structures` 稳定入口或各层私有封装。

## 模块批次清单

### 第 1 批：数据结构层
1. `ds-task`
2. `ds-plan`
3. `ds-graph`
4. `ds-status`
5. `ds-event`
6. `ds-error`
7. `ds-revision`

### 第 2 批：规则层
1. `rule-task-fsm`
2. `rule-plan-fsm`
3. `rule-graph`
4. `rule-idempotency`
5. `rule-revision`

### 第 3 批：端口层
1. 已落地：`port-task-repo`（任务记录 `list/get/create/saveIfRevisionMatches`）
2. 已落地：`port-system`（`clock` / `idGenerator`）
3. 已落地：`port-plan-repo`（计划记录 `list/get/create/saveIfRevisionMatches`；其中 `core` 当前仅消费 `get/create`，`list/saveIfRevisionMatches` 作为完整契约与后续能力预留）
4. 已落地：`port-graph-repo`（按 `planId` 读写图快照 `get/create/saveIfRevisionMatches`）
5. 预留：`port-runtime`
6. 预留：`port-policy`
7. 预留：`port-notify`
8. 预留：`port-telemetry`

### 第 4 批：编排层（TDD）
1. 已落地：`uc-create-task`
2. 已落地：`uc-get-task`
3. 已落地：`uc-list-tasks`
4. 已落地：`uc-advance-task`
5. 已落地：`uc-create-plan`
6. 已落地：`uc-get-plan`
7. 已落地：`uc-get-graph`
8. 已落地：`uc-save-graph`
9. 预留：`uc-advance-plan`
10. 预留：`uc-idempotent-replay`

### 第 5 批：上层应用预留（不在本仓库实现）
1. `linpo` 应用封装
2. `TopoFlow` 应用封装
3. uTools 应用壳与平台适配
