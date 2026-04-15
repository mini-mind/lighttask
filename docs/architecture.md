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
4. `core`：`createTask / getTask / listTasks / listTasksByPlan / advanceTask / createPlan / listPlans / getPlan / updatePlan / advancePlan / getGraph / saveGraph / getPublishedGraph / publishGraph / materializePlanTasks / getPlanSchedulingFacts / launchPlan / createRuntime / getRuntime / listRuntimes / advanceRuntime` 编排入口，组合规则、端口与 `data-structures` 稳定入口，不承载应用层策略；其中计划、图、运行时、调度事实读取与任务物化相关编排都应按 use case 路径最小化依赖校验，避免构造期前置耦合无关端口。
5. 上层应用：`linpo`、`TopoFlow`、未来 uTools 应用，位于本仓库之外。

## 幂等与路径最小依赖

1. 任务幂等只存在于 `advanceTask`：`idempotencyKey` 参与请求语义指纹判定，相同 key + 相同语义返回 replay 快照且不重复写入，相同 key + 不同语义返回冲突。
2. 图快照上的 `idempotencyKey` 当前只是 `saveGraph` 写入的元数据，不承担任务 replay 那类幂等去重语义。
3. 任务 API 采用按路径最小依赖校验：`createTask` 只要求 `taskRepository.create`、`clock.now`、`idGenerator.nextTaskId`；`listTasks` 只要求 `taskRepository.list`；`listTasksByPlan` 也只要求 `taskRepository.list`；`getTask` 只要求 `taskRepository.get`；`advanceTask` 只要求 `taskRepository.get/saveIfRevisionMatches`。
4. 图 API 按运行时分支最小化依赖：`saveGraph` 先读取 `planRepository.get` 与 `graphRepository.get(draft)` 判断草稿图是否已存在；创建分支只继续要求 `graphRepository.create`，更新分支只继续要求 `graphRepository.saveIfRevisionMatches`，两条 draft 写路径都要求 `clock.now`。`publishGraph` 只读取 `planRepository.get`、`graphRepository.get(draft|published)`，并在必要时要求 `graphRepository.create` 或 `graphRepository.saveIfRevisionMatches` 写入 `published` 作用域。
5. `materializePlanTasks` 只读取 `planRepository.get`、`graphRepository.get(published)`、`taskRepository.list`，并按是否需要创建/同步任务延迟要求 `taskRepository.create`、`taskRepository.saveIfRevisionMatches`、`clock.now`、`idGenerator.nextTaskId`。
6. `getPlanSchedulingFacts` 只读取 `planRepository.get`、`graphRepository.get(published)` 与 `taskRepository.list`，输出稳定顺序与节点调度事实，不自动物化缺失任务，也不替上层做派发、审批、批量或优先级决策。
7. `launchPlan` 只负责关闭 `ready` 计划到“已发布图 -> 任务网络 -> confirmed 计划”的最小编排回路；它依赖 `planRepository.get`，并组合 `materializePlanTasks` 与 `advancePlan`，但不内置运行时、通知传输或应用层调度策略。
8. runtime API 也按路径最小依赖校验：`createRuntime` 只要求 `runtimeRepository.create` 与 `clock.now`，并允许一次性写入最小关系字段 `parentRef / ownerRef / relatedRefs`；其中 `parentRef` 与 `ownerRef` 都按稳定引用做归一化校验，`relatedRefs` 只承担 create-only 的补充关系表达，不引入跨聚合存在性检查、生命周期联动或关系查询；`listRuntimes` 只要求 `runtimeRepository.list`；`getRuntime` 只要求 `runtimeRepository.get`；`advanceRuntime` 只要求 `runtimeRepository.get/saveIfRevisionMatches` 与 `clock.now`，且关系字段在推进阶段保持只读，不允许改写。
9. 调度基础能力由内核提供（图规则、状态机、可运行候选计算所需对象与状态），但具体调度策略、优先级、批量派发、人工审批介入策略由上层应用定义，以保持 core 通用且不臃肿。

## 硬约束

1. `rules` 禁止依赖 `ports`。
2. `ports` 禁止依赖 `rules`。
3. `core` 是唯一同时依赖 `rules` 与 `ports` 的层。
4. 公共错误面统一为 `LightTaskError`：`code`、`message`、`details`。
5. 当前仓库不实现应用层 API、DB/Runtime 适配器、实时通道或 uTools 壳。
6. `ports` 返回的读写快照必须与存储态隔离；仓储写入不得原地修改调用方传入对象；仓储常规失败走结构化结果，直接抛异常仅视为违约防御路径。
7. 领域事件通知属于通用内核能力，但只抽象到 `port-notify.publish(event)` 这一层；当前仍保持 transport-free 的单事件直发，允许像 `launchPlan` 这样按同一聚合顺序发布 `plan.tasks_materialized -> plan.advanced -> plan.launched`，但不引入批量封装；具体 SSE / WebSocket / callback 等传输机制必须保留在上层应用或 adapter。

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
5. 已落地：`port-runtime`（运行时记录 `list/get/create/saveIfRevisionMatches`）
6. 已落地：`port-notify`（单聚合快照或最小编排步骤完成后的领域事件发布 `publish(event)`，不绑定传输协议）
7. 预留：`port-policy`
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
9. 已落地：`uc-advance-plan`
10. 已落地：`uc-create-runtime`
11. 已落地：`uc-get-runtime`
12. 已落地：`uc-list-runtimes`
13. 已落地：`uc-advance-runtime`
14. 已落地：`uc-list-plans`
15. 已落地：`uc-update-plan`
16. 已落地：`uc-list-tasks-by-plan`
17. 已落地：`uc-get-published-graph`
18. 已落地：`uc-publish-graph`
19. 已落地：`uc-materialize-plan-tasks`
20. 已落地：`uc-get-plan-scheduling-facts`
21. 已落地：`uc-launch-plan`
22. 预留：`uc-idempotent-replay`

### 第 5 批：上层应用预留（不在本仓库实现）
1. `linpo` 应用封装
2. `TopoFlow` 应用封装
3. uTools 应用壳与平台适配
