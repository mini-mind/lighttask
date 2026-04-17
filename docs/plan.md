# Task-only 重构实施计划

本文档记录本轮 Task-only 重构的施工总计划与验收基线。当前主干实现已经按本计划收口，因此本文档保留为“为什么这样改、改到了什么算完成”的实施依据。

## 1. 已冻结的设计约束

以下事项已视为确定，不再回到“要不要这样做”的阶段：

1. `Plan` 只是任务分组容器。
2. `Task` 是唯一真源对象。
3. `Graph` 完全移除。
4. 依赖关系直接写在 `Task.dependsOnTaskIds`。
5. `Task` 使用单轴状态，不再使用 `designStatus + executionStatus`。
6. `draft` 是真实任务状态，表示仍在编辑。
7. `draft -> todo` 允许。
8. `todo -> draft` 允许，表示返工。
9. 除 `todo -> draft` 外，不支持任意状态回退。
10. 应用层只能编辑 `draft` 任务的定义字段。
11. 删除任务时，LightTask 自动解除同一 `Plan` 内其他任务对它的依赖。
12. 不允许跨 `Plan` 依赖。
13. `launchPlan`、`publishGraph`、`materializePlanTasks`、`advancePlan` 退出终局主链。
14. `Runtime` / `Output` 继续保留，但不承担编排真源职责。
15. `deleteTask` 采用硬删除；软删除、归档、恢复站由应用层负责。
16. `advanceTask.action` 必须显式传入；不保留“按当前状态猜默认动作”。

## 2. 目标终局

重构完成后，LightTask 的主链应收口为：

```text
createPlan
  -> createTask(status=draft)
  -> updateTask(仅限 draft 编辑定义字段)
  -> advanceTask(finalize: draft -> todo)
  -> getPlanSchedulingFacts(planId)
  -> advanceTask(正式执行推进)
  -> Runtime / Output 留痕
```

不再存在的主链：

```text
saveGraph
  -> publishGraph
  -> materializePlanTasks
  -> launchPlan
```

## 3. 目标数据结构

### 3.1 `Plan`

目标字段：

- `id`
- `title`
- `revision`
- `createdAt`
- `updatedAt`
- `metadata?`
- `extensions?`

收口动作：

- 删除 `Plan` 生命周期状态机在主模型中的地位。
- 删除 `advancePlan` 的公共主职责。
- 保留 `createPlan / listPlans / getPlan / updatePlan`。
- `Plan` 不内嵌任务列表，任务归属统一通过 `Task.planId` 表达。

### 3.2 `Task`

目标字段：

- `id`
- `planId`
- `title`
- `summary?`
- `status`
- `dependsOnTaskIds`
- `steps`
- `revision`
- `createdAt`
- `updatedAt`
- `metadata?`
- `extensions?`
- `idempotencyKey?`

冻结约束：

- `planId` 必填，每个 `Task` 只属于一个 `Plan`。
- `createTask` 仅允许创建 `draft`；省略 `status` 时默认是 `draft`。
- `planId` 创建后不可迁移到其他 `Plan`。
- `id`、`revision`、`createdAt`、`updatedAt`、`idempotencyKey` 不属于应用层可编辑定义字段。

目标状态集：

- `draft`
- `todo`
- `dispatched`
- `running`
- `blocked_by_approval`
- `completed`
- `failed`
- `cancelled`

### 3.3 `Runtime` / `Output`

保留：

- 当前基础模型。
- 运行留痕。
- 结果留痕。

不新增：

- Agent / instance / owner 等业务特化一等字段。

### 3.4 对象关系

终局关系图冻结为：

```text
Plan (1)
  └── Task (N)
        ├── dependsOnTaskIds -> Task (same Plan only, N:N)
        ├── SchedulingFactView (derived, read-only)
        ├── Runtime (0..N, sidecar trace)
        └── Output (0..N, result trace)
```

产品理解冻结为：

- `Plan` 只回答“这批任务属于哪一组协作”。
- `Task` 只回答“任务本身是什么、依赖谁、现在处于什么状态”。
- `SchedulingFactView` 只回答“现在谁能做、谁被阻塞、谁有风险”。
- `Runtime` / `Output` 只回答“执行时发生了什么、产出了什么”。
- 真正参与调度判断的只有 `Task`。

### 3.5 任务字段分层

为了避免实现时再争论“哪些字段算编辑、哪些字段算运行”，本轮直接冻结为两类字段。

定义字段：

这些字段由应用层在 `draft` 态负责编辑：

- `title`
- `summary`
- `dependsOnTaskIds`
- `metadata`
- `extensions`
- `steps` 的结构性字段：
  - `steps[].id`
  - `steps[].title`
  - `steps[].stage`

运行留痕字段：

这些字段不允许应用层通过 `updateTask` 直接写入：

- `id`
- `planId`
- `status`
- `revision`
- `createdAt`
- `updatedAt`
- `steps[].status`

补充约束：

- `steps[].status` 只有在任务脱离 `draft` 后才有意义。
- 写请求可以携带请求级 `idempotencyKey` 作为幂等控制参数，但它不属于定义字段编辑。
- 风险标记不是 `Task` 持久字段，不新增 `isRisky` 一类存储字段。
- 返工风险通过 `getPlanSchedulingFacts` 即时计算，不反写成新的任务状态。

## 4. 目标规则

### 4.1 依赖约束

- `dependsOnTaskIds` 只能引用同一 `Plan` 内的其他任务。
- 不允许自依赖。
- 不允许环。
- 删除某个任务时，自动从其他任务的 `dependsOnTaskIds` 中移除它。
- 依赖满足的唯一标准是：上游任务状态为 `completed`。
- 若上游任务处于 `failed` 或 `cancelled`，下游任务保持阻塞，等待应用层自行决策。

### 4.2 编辑权限

- 只有 `draft` 任务允许 `updateTask` 修改定义字段。
- 非 `draft` 任务调用 `updateTask` 修改定义字段时，返回状态冲突错误。
- 允许应用层通过任务推进动作让 `draft -> todo`。
- 允许应用层通过任务推进动作让 `todo -> draft`。

定义字段白名单冻结为：

- `title`
- `summary`
- `dependsOnTaskIds`
- `steps`
- `metadata`
- `extensions`

`updateTask` 明确禁止直接修改：

- `id`
- `planId`
- `status`
- `revision`
- `createdAt`
- `updatedAt`

额外说明：

- `steps` 在 `draft` 态可作为任务设计的一部分整体编辑。
- 任务脱离 `draft` 后，如需推进步骤，只能走 `advanceTask` 所属的受控执行链。
- 非 `draft` 任务即使只修改 `dependsOnTaskIds`，也视为非法定义编辑。
- 依赖关系的新增、删除、重排，统一视为定义编辑，只能发生在 `draft`。
- 删除任务不是 `updateTask` 的一种变体，必须走独立 `deleteTask`。
- `idempotencyKey` 可以作为写请求的请求级幂等键传入，但它不属于任务定义字段，也不允许被应用层当作对象字段直接编辑。

### 4.3 状态机

任务状态机收口为：

- `draft --finalize--> todo`
- `todo --return_to_draft--> draft`
- `todo --dispatch--> dispatched`
- `dispatched --start--> running`
- `running --request_approval--> blocked_by_approval`
- `blocked_by_approval --approve--> running`
- `running --complete--> completed`
- `todo/dispatched/running/blocked_by_approval --fail--> failed`
- `todo/dispatched/running/blocked_by_approval --cancel--> cancelled`

补充说明：

- `advanceTask.action` 在公开 API 中为必填。
- `todo -> draft` 是唯一明确允许的返工倒流。
- `dispatched / running / completed / failed / cancelled` 不回到 `draft`。
- 已经开始或终态任务想重做，应新建任务。

动作集合冻结为：

- `finalize`
- `return_to_draft`
- `dispatch`
- `start`
- `request_approval`
- `approve`
- `complete`
- `fail`
- `cancel`

### 4.4 调度规则

调度计算直接基于任务集合：

- `draft` 自己不可执行。
- 依赖 `draft` 的任务被阻塞。
- 依赖未 `completed` 的任务被阻塞。
- 依赖 `failed / cancelled` 上游的任务被阻塞，并返回专门阻塞原因。
- 只有 `todo` 且依赖全部满足的任务可执行。
- `dispatched / running / blocked_by_approval` 视为“已开始但不再 runnable”。
- 终态任务不进入可执行集合。
- 调度事实必须同时给出“当前是否可执行”和“为什么不可执行/为什么有风险”。

### 4.5 返工风险规则

若某上游任务从 `todo` 回到 `draft`：

- 尚未开始的后继任务：重新阻塞。
- `dispatched / running / blocked_by_approval` 后继任务：不中断，但标记 `upstream_returned_to_draft`。
- 已完成的后继任务：不回滚，但标记 `upstream_returned_to_draft`。
- `failed / cancelled` 后继任务：不额外增加返工风险标记。

### 4.6 Revision 与幂等

- `updateTask / advanceTask / deleteTask / updatePlan / advanceRuntime / advanceOutput` 必须要求 `expectedRevision`。
- `createTask / createPlan / createRuntime / createOutput` 不要求 `expectedRevision`，但都应允许可选 `idempotencyKey`。
- 相同对象上重复提交同一 `idempotencyKey` 的同类写操作，应返回同一逻辑结果，而不是重复副作用。
- 相同对象上重复提交同一 `idempotencyKey` 但输入语义不同，应返回冲突错误。
- `getPlanSchedulingFacts` 是纯读接口，不引入 graph revision 一类读时校验参数。

### 4.7 风险与阻塞的表达方式

- “阻塞”只通过调度事实表达，不引入新的任务状态。
- “风险”只通过调度事实表达，不引入新的任务状态。
- `blocked_by_approval` 仍是任务自身状态，因为它描述任务当前生命周期位置。
- `upstream_returned_to_draft` 不是任务状态，而是调度视图中的 `riskReasonCodes` 之一。
- 同一个任务可以同时处于“非阻塞但有风险”的情况。

### 4.8 删除规则

- `deleteTask` 必须要求 `expectedRevision`。
- 删除任务后，内核在同一一致性边界内完成：
  - 删除任务本身。
  - 解绑同 `Plan` 内其他任务对它的依赖。
  - 重新计算后续调度事实所需的依赖快照。
- `deleteTask` 不负责软删除、归档、恢复站。
- `deleteTask` 不触发级联删除 `Runtime` / `Output`。
- `Runtime` / `Output` 是否需要保留历史悬挂引用，由应用层自己治理。

## 5. 目标公共 API

### 5.1 保留并重写语义

- `createTask`
- `updateTask`
- `advanceTask`
- `deleteTask`
- `listTasks`
- `listTasksByPlan`
- `getTask`
- `createPlan`
- `listPlans`
- `getPlan`
- `updatePlan`
- `getPlanSchedulingFacts`
- `createRuntime / advanceRuntime / listRuntimes / getRuntime`
- `createOutput / advanceOutput / listOutputs / getOutput`

### 5.2 任务相关 API 形状冻结

#### `createTask`

目标输入至少包含：

- `planId`
- `title`
- `status?`，仅允许省略或显式传 `draft`
- `summary?`
- `dependsOnTaskIds?`
- `steps?`
- `metadata?`
- `extensions?`
- `idempotencyKey?`

目标行为：

- 自动校验 `planId` 存在。
- 自动校验依赖只指向同 `Plan` 任务。
- 自动校验无自依赖、无环。
- 默认 `dependsOnTaskIds = []`。
- 默认 `steps = []`。

#### `updateTask`

目标输入至少包含：

- `expectedRevision`
- `title?`
- `summary?`
- `dependsOnTaskIds?`
- `steps?`
- `metadata?`
- `extensions?`
- `idempotencyKey?`

目标行为：

- 只允许更新任务定义字段。
- 仅 `draft` 任务允许调用成功。
- 若输入里出现系统字段，直接视为校验错误。
- 若更新后引入跨 `Plan` 依赖、自依赖或环，直接拒绝。

#### `advanceTask`

目标输入至少包含：

- `expectedRevision`
- `action`
- `idempotencyKey?`

动作语义：

- `finalize`：`draft -> todo`
- `return_to_draft`：`todo -> draft`
- `dispatch`：`todo -> dispatched`
- `start`：`dispatched -> running`
- `request_approval`：`running -> blocked_by_approval`
- `approve`：`blocked_by_approval -> running`
- `complete`：`running -> completed`
- `fail`：`todo / dispatched / running / blocked_by_approval -> failed`
- `cancel`：`todo / dispatched / running / blocked_by_approval -> cancelled`

#### `deleteTask`

目标输入至少包含：

- `expectedRevision`
- `idempotencyKey?`

目标输出至少包含：

- `taskId`
- `planId`
- `detachedFromTaskIds`

说明：

- `detachedFromTaskIds` 用于告诉应用层哪些下游依赖被自动解除。
- 该返回值不代表新增持久化对象，只是一次删除结果摘要。

### 5.3 调度事实接口重塑

`getPlanSchedulingFacts(planId)` 目标输出应至少包含：

- `draftTaskIds`
- `runnableTaskIds`
- `blockedTaskIds`
- `activeTaskIds`
- `terminalTaskIds`
- `riskTaskIds`
- `byTaskId`

`byTaskId[taskId]` 目标字段应至少包含：

- `taskId`
- `status`
- `isDraft`
- `isRunnable`
- `isBlocked`
- `isActive`
- `isTerminal`
- `isRisky`
- `blockReasonCodes`
- `riskReasonCodes`
- `unmetDependencyTaskIds`
- `missingDependencyTaskIds`
- `riskyDependencyTaskIds`
- `dependencyTaskIds`
- `downstreamTaskIds`

建议 block/risk reason 集合：

- `self_draft`
- `dependency_in_draft`
- `dependency_not_done`
- `dependency_failed`
- `dependency_cancelled`
- `dependency_missing`
- `upstream_returned_to_draft`

进一步冻结：

- `blockReasonCodes` / `riskReasonCodes` 使用数组，避免多原因场景被单值覆盖。
- `draftTaskIds / runnableTaskIds / blockedTaskIds / activeTaskIds / terminalTaskIds` 视为主桶且彼此互斥。
- `riskTaskIds` 可以与 `activeTaskIds` 或 `terminalTaskIds` 交叉，但不应与 `draftTaskIds / runnableTaskIds` 交叉。
- `blockedTaskIds` 与 `activeTaskIds` 不交叉，避免把“正在推进”和“被依赖阻塞”混成一类。
- 是否“有风险”以 `riskTaskIds` 和 `riskReasonCodes` 为准，不在 `Task.status` 上复写。
- `dependency_missing` 主要用于读时兜底，正常写路径不应制造这种状态。

### 5.4 查询接口收口

任务查询语义应同步收口：

- `listTasks` / `listTasksByPlan` 的筛选条件统一围绕 `status`。
- 删除 `designStatus` / `executionStatus` 双轴查询口径。
- `planId + status` 应成为最小可用查询组合。

计划查询语义保持简单：

- 本轮不新增 `deletePlan`。
- 本轮不恢复 `advancePlan`。
- `Plan` 查询只承接容器级读取，不承接生命周期判定。

### 5.5 明确移除

- `getGraph`
- `saveGraph`
- `editGraph`
- `getPublishedGraph`
- `publishGraph`
- `materializePlanTasks`
- `launchPlan`
- `advancePlan`

## 6. 源码改造范围

以下改造范围已经足够具体，可直接开工。

### 6.1 `data-structures`

必须修改：

- [src/data-structures/ds-task.ts](../src/data-structures/ds-task.ts)
- [src/data-structures/ds-status.ts](../src/data-structures/ds-status.ts)
- [src/data-structures/ds-plan.ts](../src/data-structures/ds-plan.ts)
- [src/data-structures/ds-event.ts](../src/data-structures/ds-event.ts)
- [src/data-structures/index.ts](../src/data-structures/index.ts)

必须删除：

- `src/data-structures/ds-graph.ts`

### 6.2 `rules`

必须重写或新增：

- [src/rules/rule-task-fsm.ts](../src/rules/rule-task-fsm.ts)
- [src/rules/index.ts](../src/rules/index.ts)

必须删除或退出主链：

- `src/rules/rule-graph.ts`
- `src/rules/rule-plan-fsm.ts`

必须新增的规则能力：

- 同 Plan 依赖校验。
- 环检测。
- `todo -> draft` 风险传播计算。

### 6.3 `ports`

必须修改：

- [src/ports/port-task-repo.ts](../src/ports/port-task-repo.ts)
- [src/ports/port-plan-repo.ts](../src/ports/port-plan-repo.ts)
- [src/ports/port-consistency.ts](../src/ports/port-consistency.ts)
- [src/ports/in-memory.ts](../src/ports/in-memory.ts)
- [src/ports/index.ts](../src/ports/index.ts)

必须删除：

- `src/ports/port-graph-repo.ts`
- in-memory graph repository 相关实现与导出。

### 6.4 `core`

必须重写：

- [src/core/create-task.ts](../src/core/create-task.ts)
- [src/core/update-task.ts](../src/core/update-task.ts)
- [src/core/advance-task.ts](../src/core/advance-task.ts)
- [src/core/list-tasks.ts](../src/core/list-tasks.ts)
- [src/core/list-tasks-by-plan.ts](../src/core/list-tasks-by-plan.ts)
- [src/core/get-plan-scheduling-facts.ts](../src/core/get-plan-scheduling-facts.ts)
- [src/core/types.ts](../src/core/types.ts)
- [src/core/lighttask.ts](../src/core/lighttask.ts)
- [src/core/notify-event.ts](../src/core/notify-event.ts)
- [src/core/task-snapshot.ts](../src/core/task-snapshot.ts)
- [src/core/query-filters.ts](../src/core/query-filters.ts)
- [src/core/plan-snapshot.ts](../src/core/plan-snapshot.ts)

必须新增：

- `delete-task.ts` 或等价用例，实现自动解绑依赖。
- `task-dependency-snapshot.ts` 或等价模块，实现依赖校验与风险传播复用。

必须删除：

- `src/core/assert-graph-task-references.ts`
- `src/core/collect-published-plan-tasks.ts`
- `src/core/edit-graph.ts`
- `src/core/get-graph.ts`
- `src/core/get-published-graph.ts`
- `src/core/graph-snapshot.ts`
- `src/core/launch-plan.ts`
- `src/core/materialize-plan-tasks.ts`
- `src/core/materialized-task-governance.ts`
- `src/core/publish-graph.ts`
- `src/core/save-graph.ts`
- `src/core/advance-plan.ts`
- `src/core/lifecycle-policy.ts`
- plan lifecycle 相关残余模块。

### 6.5 `index`

必须修改：

- [src/index.ts](../src/index.ts)

目标：

- 删除全部 Graph 相关类型和 API 导出。
- 删除 `launchPlan` / `materializePlanTasks` / `advancePlan` 相关导出。
- 暴露新的任务依赖与调度事实类型。

## 7. 测试改造计划

### 7.1 必须删除的测试

- `src/tests/lighttask.graph.api.test.ts`
- `src/tests/lighttask.materialize.api.test.ts`
- `src/tests/lighttask.launch.api.test.ts`
- Graph rule / graph repo 相关测试。

### 7.2 必须重写的测试

- [src/tests/lighttask.scheduling.api.test.ts](../src/tests/lighttask.scheduling.api.test.ts)
- [src/tests/lighttask.task.flow.api.test.ts](../src/tests/lighttask.task.flow.api.test.ts)
- [src/tests/lighttask.query.api.test.ts](../src/tests/lighttask.query.api.test.ts)
- [src/tests/lighttask.runtime.api.test.ts](../src/tests/lighttask.runtime.api.test.ts)
- [src/tests/lighttask.output.api.test.ts](../src/tests/lighttask.output.api.test.ts)
- [src/tests/lighttask.task.idempotency.api.test.ts](../src/tests/lighttask.task.idempotency.api.test.ts)
- [src/tests/lighttask.notify.api.test.ts](../src/tests/lighttask.notify.api.test.ts)
- [src/tests/public-export-contract.test.ts](../src/tests/public-export-contract.test.ts)
- [src/tests/ports.in-memory.test.ts](../src/tests/ports.in-memory.test.ts)
- [src/tests/data-structures.test.ts](../src/tests/data-structures.test.ts)
- [src/tests/arch-check.test.ts](../src/tests/arch-check.test.ts)
- [src/tests/cli.test.ts](../src/tests/cli.test.ts)

### 7.3 必须新增的测试场景

1. `draft` 任务不可执行。
2. 依赖 `draft` 的下游任务被阻塞。
3. `draft -> todo` 后下游恢复正常调度。
4. `todo -> draft` 后未开始下游重新阻塞。
5. `todo -> draft` 后已开始/已完成下游被标记风险而不回滚。
6. 非 `draft` 任务禁止应用层改定义字段。
7. 删除任务时自动解除其他任务依赖。
8. 删除任务后调度事实立即更新。
9. 跨 `Plan` 依赖被拒绝。
10. 环依赖被拒绝。
11. 依赖 `failed` 上游返回 `dependency_failed`。
12. 依赖 `cancelled` 上游返回 `dependency_cancelled`。
13. `createTask` 不能以 `todo` 作为初始状态。
14. `dispatch` 只允许推进当前 `runnable` 任务。
15. `getPlanSchedulingFacts` 能区分 `draft / runnable / blocked / active / terminal / risk` 六类任务。
16. `updateTask` 不能修改 `planId` 或 `status`。
17. `deleteTask` 的自动解绑在同一一致性边界内完成。
18. `getPlanSchedulingFacts` 不再依赖 `publishedGraphRevision`。
19. 公共导出不再暴露 Graph 能力。

## 8. 事件与兼容收口

### 8.1 事件收口

保留：

- `task.created`
- `task.updated`
- `task.advanced`
- `task.deleted`
- `plan.created`
- `plan.updated`
- `runtime.created`
- `runtime.advanced`
- `output.created`
- `output.advanced`

删除：

- `graph.saved`
- `graph.published`
- `plan.task_provenance_synced`
- `plan.launched`
- `plan.advanced`

### 8.2 向后兼容策略

这轮不保留旧公开 API 兼容壳。

执行原则：

- 不新增 `Graph` 兼容别名。
- 不新增“自动把任务关系投影成 Graph”的过渡层。
- 不保留 `launchPlan` 的空实现占位。

## 9. 分阶段施工顺序

### 阶段一：冻结主类型

目标：

- 先改 `Task / Plan / Event` 类型定义。
- 删除 `Graph` 类型出口。
- 冻结 `createTask / updateTask / advanceTask / deleteTask / getPlanSchedulingFacts` 输入输出类型。

完成标准：

- `src/core/types.ts`、`src/data-structures/*`、`src/index.ts` 形成新的类型骨架。
- 编译错误只允许残留在待改模块，不允许主类型继续摇摆。

阶段自检：

- `npm run typecheck`

### 阶段二：重写任务状态机与调度规则

目标：

- 落地单轴 `Task.status`。
- 落地 `draft <-> todo` 规则。
- 落地依赖校验、阻塞原因和风险传播。

完成标准：

- 规则层测试能够覆盖新状态机和依赖逻辑。
- `rule-task-fsm` 不再暴露旧默认动作猜测语义。

阶段自检：

- `npm run build`
- `node --test ./dist/tests/rules.fsm.test.js`

### 阶段三：重写 core 主链

目标：

- `createTask / updateTask / advanceTask / deleteTask`
- `getPlanSchedulingFacts`
- 删除 Graph / materialize / launch 主链

完成标准：

- core 编译通过。
- 非 `draft` 禁止改定义字段的规则已落地。
- `getPlanSchedulingFacts` 不再返回 node/graph 视角字段。
- 旧 graph 主链在源码层彻底消失。

阶段自检：

- `npm run build`
- `node --test ./dist/tests/lighttask.task.flow.api.test.js ./dist/tests/lighttask.scheduling.api.test.js`

### 阶段四：重写 ports 与 in-memory 适配器

目标：

- 删除 graph repo。
- 保留 consistency 端口。
- 让 `deleteTask` 自动解绑依赖可在同一一致性边界内完成。

完成标准：

- in-memory 端口测试通过。
- graph repository 类型与实现均已删除。

阶段自检：

- `npm run build`
- `node --test ./dist/tests/ports.in-memory.test.js`

### 阶段五：重写测试矩阵

目标：

- 删除旧 graph 测试。
- 补齐新任务依赖、返工风险、自动解绑测试。

完成标准：

- `npm run check` 全绿。
- `public-export-contract` 已覆盖 Graph API 彻底移除。

阶段自检：

- `npm run check`

### 阶段六：文档与发布收口

目标：

- README、架构、接入指南、PRD、CHANGELOG 与实现口径一致。
- 公共导出契约和发布物一致。

完成标准：

- `npm pack --dry-run` 通过。
- 文档中不再把 `Graph / publishGraph / materializePlanTasks / launchPlan` 写成主链。
- README 与接入指南已明确对象关系、状态边界和删除/返工语义。

阶段自检：

- `npm pack --dry-run`

## 10. 验收标准

重构完成后，必须同时满足：

1. 公开 API 不再暴露 Graph 主能力。
2. 调度仅基于任务集合与任务依赖。
3. 应用层只能编辑 `draft` 任务定义。
4. `todo -> draft` 返工链路与风险传播可用。
5. 删除任务的自动解绑链路可用。
6. `advanceTask` 所有动作均为显式动作，不存在默认猜测推进。
7. `getPlanSchedulingFacts` 不再暴露 graph/node 视角字段。
8. 文档、代码、测试三者对同一主链达成一致。
9. `npm run check` 通过。
10. `npm pack --dry-run` 通过。

## 11. 风险与处理

### 风险一：改动面大

处理：

- 先冻结类型与 API。
- 再按阶段删除旧链路。
- 不做新旧双轨长期共存。

### 风险二：测试重写成本高

处理：

- 明确先删旧 Graph 测试，再补新 Task-only 测试。
- 避免为了“让旧测试继续绿”引入过渡兼容层。

### 风险三：文档先行但代码暂未跟上

处理：

- 所有文档均明确标注“目标终局方向”。
- 以本计划为唯一实施口径。

## 12. 计划自审

### 已检查项

- 是否还残留未决的产品方向：没有。
- 是否还依赖 Graph 作为过渡真源：没有。
- 是否明确了 `draft -> todo` 与 `todo -> draft`：是。
- 是否明确了删除任务后的自动解绑：是。
- 是否明确了任务字段的定义字段/运行留痕字段边界：是。
- 是否明确了创建、更新、推进、删除 API 的输入输出形状：是。
- 是否明确了依赖满足标准与失败上游的阻塞语义：是。
- 是否明确了 `Plan` 的收口方向：是。
- 是否明确了需要删哪些源码模块：是。
- 是否明确了测试删改范围：是。
- 是否明确了验收入口：是。

### 仍需再决策的事项

- 无。

### 结论

当前计划已经细化到足以直接开工：

- 设计约束已冻结。
- 主模型已冻结。
- 迁移顺序已冻结。
- 文件级改造范围已冻结。
- 测试与验收标准已冻结。

后续应直接进入实现，不再回到“还需不需要再定一轮方向”的阶段。
