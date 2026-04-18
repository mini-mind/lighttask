# LightTask 架构

## 1. 架构一句话

LightTask 的架构是：

- `Plan` 只是任务分组边界
- `Task` 是唯一真源对象
- 依赖关系直接写在 `Task` 上
- 调度只读取 `Task` 集合
- `Runtime` / `Output` 负责执行留痕
- `Graph` 退出主架构

## 2. 分层

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

- 定义 `Task / Plan / Runtime / Output / Event / Revision` 等基础结构
- 不再保留 `Graph` 作为核心结构

### `rules`

- 定义任务生命周期策略与默认状态机
- 定义依赖约束与调度计算规则
- 定义 revision 与幂等规则

### `ports`

- 定义任务、计划、运行时、输出等仓储端口
- 定义通知、时钟、ID 生成器、一致性边界端口
- 不再保留图仓储端口

### `core`

- 把对象模型、规则和端口组合成对外 API
- 对上层提供任务编排、调度事实、运行留痕能力

## 3. 核心对象

### `Plan`

`Plan` 的职责只剩两件事：

- 表示一组任务的容器边界
- 承接分组级元信息

它不再负责：

- 流程图发布
- 启动流程
- 确认流程
- 冻结依赖基线

因此，`Plan` 不再需要独立生命周期状态机。

### `Task`

`Task` 是唯一的编排真源。

它直接承接：

- `id`
- `planId`
- `dependsOnTaskIds`
- `status`
- `title`
- `summary`
- `metadata`
- `extensions`
- `steps`
- `createdAt / updatedAt`

补充冻结：

- 默认内置策略下，`createTask` 初始只允许创建 `draft`
- 若注入了自定义 `taskLifecycle`，`createTask` 只允许创建该策略的 `initialStatus`
- `planId` 创建后不可迁移
- 风险不回写成新的任务字段，而是留在调度视图里表达

### `Runtime`

- 记录执行上下文
- 记录某次执行过程的运行信息
- 默认走内置最小生命周期；如应用层确有必要，可通过 `createLightTask({ runtimeLifecycle })` 注入替代策略
- 不负责定义任务编排关系

### `Output`

- 记录结构化结果、交付物和产出快照
- 不负责替代任务状态

### 对象关系图

```text
Plan 1 --- n Task
Task n --- n Task   (dependsOnTaskIds，同 Plan 内依赖)
Task 1 --- n SchedulingFactView
Task 1 --- n Runtime? / Output?   (通过 refs 建弱关联)
```

这张图对应的架构含义是：

- `Plan` 是容器边界，不是总控状态机
- `Task` 是唯一真源，也是调度输入
- `SchedulingFactView` 是即时读取视图，不是持久化真源
- `Runtime` / `Output` 是留痕对象，不是依赖真源

## 4. 状态模型

LightTask 使用单轴任务状态，并通过任务生命周期策略解释这些状态的系统性质。

默认内置状态集：

- `draft`
- `todo`
- `dispatched`
- `running`
- `blocked_by_approval`
- `completed`
- `failed`
- `cancelled`

### 产品语义

- `draft`：任务仍在编辑中，不能执行
- `todo`：任务设计完成，可以进入正式待办
- `dispatched`：已分派
- `running`：执行中
- `blocked_by_approval`：等待审批
- `completed / failed / cancelled`：终态

### 特殊迁移规则

默认方向仍然是向前推进，但为了给应用层容错空间，明确放开一个返工例外：

- `draft -> todo`
- `todo -> draft`

除此之外，不再支持任意回退。  
如果应用层业务上要“重做已开始甚至已完成的任务”，应新建一个新的 `Task`。

### 生命周期边界

- 默认 8 态只是内置默认策略
- `createLightTask({ taskLifecycle })` 可注入自定义任务生命周期策略
- `advanceTask / updateTask / getPlanSchedulingFacts` 统一读取任务生命周期策略
- `Task.status` 是 `string`，状态合法性由 `taskLifecycle` 注册表约束
- 应用层若需要更多业务语义，应优先在自己的字段中扩展

## 5. 编辑权限边界

LightTask 负责区分“任务定义编辑”和“任务运行推进”。

### 应用层可编辑

- 仅 `draft` 任务允许应用层直接修改定义字段
- 可修改字段包括：
  - `title`
  - `summary`
  - `dependsOnTaskIds`
  - `metadata`
  - `extensions`
  - 其他编排定义字段
  - `steps[].id / title / stage`

### 应用层不可编辑

一旦任务脱离 `draft`：

- 应用层不再允许直接修改任务定义字段
- 任务只能通过 LightTask 的状态推进与运行留痕接口继续变化

### LightTask 仍可更新

即使任务不在 `draft`，LightTask 仍可以更新：

- `status`
- `steps`
- `updatedAt`
- 运行留痕相关字段

进一步冻结：

- `steps[].status` 属于运行留痕，不属于应用层定义编辑范围
- 写接口允许携带请求级 `idempotencyKey`，但它属于并发控制参数，不属于任务定义字段
- `planId` 创建后不可迁移
- 风险标记不反写回 `Task`，而是由调度事实即时推导

## 6. 依赖模型

依赖关系不再通过 `Graph.nodes + Graph.edges` 保存，而是直接挂在任务上：

```ts
type Task = {
  id: string;
  planId: string;
  dependsOnTaskIds: string[];
  status: TaskStatus;
  // ...
};
```

### 依赖约束

- 依赖只能发生在同一 `Plan` 内
- 不允许跨 `Plan` 依赖
- 不允许自依赖
- 不允许形成环

## 7. 调度模型

`getPlanSchedulingFacts` 直接读取某个 `Plan` 下的全部 `Task`。

### 调度输入

- 某个 `Plan` 内全部任务
- 每个任务的 `dependsOnTaskIds`
- 每个任务的 `status`

### 调度输出

建议统一返回：

- `planId`
- `draftTaskIds`
- `runnableTaskIds`
- `blockedTaskIds`
- `activeTaskIds`
- `terminalTaskIds`
- `riskTaskIds`
- `byTaskId`

每个任务都应带清晰解释：

- `isDraft`
- `isRunnable`
- `isBlocked`
- `isActive`
- `isTerminal`
- `isRisky`
- `blockReasonCodes`
- `riskReasonCodes`
- `dependencyTaskIds`
- `downstreamTaskIds`
- `unmetDependencyTaskIds`
- `missingDependencyTaskIds`
- `riskyDependencyTaskIds`

这里的 `SchedulingFacts` 是即时计算视图，不是新的持久化主对象。

### 关键规则

- 可编辑状态会落入 `draftTaskIds`
- 可调度状态在依赖满足时进入 `runnableTaskIds`
- `active = true` 的状态进入 `activeTaskIds`
- `terminal = true` 的状态进入 `terminalTaskIds`
- 依赖状态的 `completionOutcome` 会进一步区分 `dependency_not_done / dependency_failed / dependency_cancelled`
- 调度事实要同时表达“是否可执行”和“为什么不可执行/为什么有风险”

### 返工风险规则

如果某个上游任务从 `todo` 回到 `draft`：

- 尚未开始的后继任务重新阻塞
- 已经开始的后继任务不自动回滚
- 已经完成的后继任务不自动回滚
- 但它们都需要收到“上游返工风险”标记，供应用层提示用户

## 8. 删除语义

LightTask 对删除任务只做系统层兜底，不做产品层治理。

### 内核行为

- 删除任务时，自动解除同一 `Plan` 内其他任务对它的依赖
- 删除后立刻基于新的依赖集合重新计算调度事实
- 同一删除请求重复提交相同 `idempotencyKey` 时，返回同一删除结果摘要，而不是重复解绑副作用
- 不级联删除 `Runtime` / `Output`

### 应用层行为

由应用层自己决定：

- 是否允许删除
- 是否弹窗确认
- 是否先做备份
- 是否做软删除、归档或回收站

## 9. 事件边界

事件主线采用精简聚合模型。

建议保留：

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

建议移除：

- `graph.saved`
- `graph.published`
- `plan.task_provenance_synced`
- `plan.launched`

## 10. 一致性边界

虽然 `Graph` 会退出，但一致性边界仍然保留。

原因是这些动作依然可能涉及多对象联动写入：

- 删除任务并自动解除多个下游依赖
- 任务从 `todo -> draft` 后批量标记下游风险
- 任务依赖编辑后批量更新任务快照

因此 `consistency.run(scope, work)` 端口仍然有价值。

## 11. 与应用层的边界

LightTask 负责：

- 任务定义与状态推进
- 任务间依赖约束
- 调度事实计算
- 运行与结果留痕

LightTask 不负责：

- UI
- 流程图编辑器
- planner session
- provider / agent 适配
- 执行实例归属
- 外部执行心跳与回调
- 产品级软删除/归档/恢复

## 12. 结论

LightTask 不是“把 Graph 缩小”，而是：

- 以 `Plan + Task + Runtime + Output` 作为主模型
- 让 `Plan` 退回分组意义
- 让 `draft` 直接成为任务状态的一部分
- 让应用层围绕任务本身组织产品，而不是围绕图快照组织产品
