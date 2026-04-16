# LightTask 架构

LightTask 现在采用 Task-first 架构：

- `Task` 是唯一真源对象
- `Graph` 是依赖关系视图
- `Plan` 是容器边界
- `Runtime` / `Output` 是执行补充对象

## 分层

```text
[上层应用]
     |
     v
[core]
  /   \
 v     v
[rules] [ports]
    \   /
     v v
[data-structures]
```

### `data-structures`

- 定义任务、计划、图、运行时、输出、事件、revision 等基础结构

### `rules`

- 定义状态迁移、依赖校验、拓扑排序、幂等与 revision 规则

### `ports`

- 定义仓储、通知、时钟、ID 生成器、一致性边界等端口

### `core`

- 组合对象模型、规则与端口，对外提供稳定 API

## 核心对象关系

```text
Plan
  -> Task[]
  -> Graph(依赖关系视图)
  -> getPlanSchedulingFacts
  -> advanceTask
  -> Runtime / Output
```

### `Plan`

- 承接计划级生命周期与元信息
- 不承接任务设计真相

### `Task`

- 承接计划归属、设计态、执行态、步骤与扩展字段
- 是调度、审批、执行、补偿、审计的主对象

当前收口结果：

- `designStatus` 只支持 `draft | ready`
- `executionStatus` 表达执行推进

### `Graph`

- 只表达任务间依赖与约束
- 只允许引用已经声明 `planId` 的任务
- 不再负责生成任务或改写任务设计字段

### `Runtime` / `Output`

- `Runtime` 记录执行上下文
- `Output` 记录结构化产物

## 用人话看对象关系

如果把 LightTask 当成一个协作产品，而不是代码库，可以这样理解：

- `Plan` 是一张工作台，负责承接“这一轮任务编排”。
- `Task` 是工作台上的真实任务卡片，是唯一真源。
- `Graph` 是卡片之间的依赖线，只负责描述顺序和阻塞关系。
- `Runtime` 是任务执行过程的运行记录。
- `Output` 是执行后留下的结果物。

所以主关系不是“图生成任务”，而是：

- 先有 `Plan`
- `Task` 显式归属到 `Plan`
- `Graph` 引用这些 `Task`，形成依赖视图
- 调度器读取 `Task + Graph`
- 上层执行器推进 `Task`
- `Runtime / Output` 记录过程和结果

## 调度

`getPlanSchedulingFacts` 直接基于：

- 已归属当前计划的任务集合
- 已发布关系视图
- 任务设计态
- 任务执行态

输出：

- `readyNodeIds`
- `runnableNodeIds`
- `blockedNodeIds`
- `terminalNodeIds`
- 每个节点的 `blockReason`

## 关系同步与计划确认 API

### `publishGraph`

- 发布关系视图快照
- 推进 `plan.revision`
- 要求图上所有任务已经归属当前计划

### `materializePlanTasks`

- 只同步关系 provenance
- 不覆盖任务标题、摘要、metadata、extensions 设计字段
- 可把已移除节点的旧 provenance 标记为 `orphaned`

### `launchPlan`

- 读取已发布图上的任务快照
- 把 `ready` 计划确认为 `confirmed`

## 一致性边界

多对象写入通过 `consistency.run(scope, work)` 端口收口。推荐把下面这些 use case 放进同一事务或等价一致性边界：

- `publishGraph`
- `materializePlanTasks`
- `launchPlan`

如果未提供该端口，内核会退化为普通顺序执行。

## 事件边界

当前保留这些主线事件：

- `task.created / task.updated / task.advanced`
- `plan.created / plan.updated / plan.advanced / plan.launched`
- `graph.saved / graph.published`
- `runtime.created / runtime.advanced`
- `output.created / output.advanced`

`plan.task_provenance_synced` 表示“某个已发布图 revision 已经同步到任务 provenance”，不再表示“Graph 生成任务”。
