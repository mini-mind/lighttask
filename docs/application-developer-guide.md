# LightTask 应用层接入指南

这份指南只回答一件事：应用层应该怎样用“任务为中心”的方式接入 LightTask。

## 1. 先记住三个判断

1. `Task` 是主对象
2. `Graph` 只描述关系
3. `Plan` 负责容器与确认边界

如果换成产品语言去记：

- `Plan` 是一张工作台
- `Task` 是工作台上的真实任务卡片
- `Graph` 是卡片之间的依赖线
- `Runtime` 是执行过程记录
- `Output` 是执行产物

## 2. 先把内核跑起来

```ts
import { createLightTask } from "lighttask";
import { createInMemoryLightTaskPorts } from "lighttask/ports/in-memory";

const lighttask = createLightTask(createInMemoryLightTaskPorts());
```

如果你是在业务应用里正式接入，应把这些端口换成自己的数据库、事件通道和事务设施实现。

## 3. 推荐接入顺序

### 第一步：创建计划

```ts
lighttask.createPlan({
  id: "plan_alpha",
  title: "主流程",
});
```

### 第二步：创建任务并声明归属

```ts
const taskA = lighttask.createTask({
  title: "任务 A",
  planId: "plan_alpha",
});

const taskB = lighttask.createTask({
  title: "任务 B",
  planId: "plan_alpha",
  designStatus: "draft",
});
```

关键理解：

- 任务是否属于某个计划，由 `task.planId` 决定
- Graph 不再负责把任务“认领”进计划

### 第三步：保存并发布关系视图

```ts
lighttask.saveGraph("plan_alpha", {
  nodes: [
    { id: "node_a", taskId: taskA.id, label: "任务 A" },
    { id: "node_b", taskId: taskB.id, label: "任务 B" },
  ],
  edges: [{ id: "edge_ba", fromNodeId: "node_b", toNodeId: "node_a", kind: "depends_on" }],
});

lighttask.publishGraph("plan_alpha", {
  expectedRevision: 1,
});
```

`publishGraph` 的产品语义是：

- 当前依赖关系快照正式定版
- 当前计划的依赖基线发生变化
- 计划需要基于这个新基线重新确认

### 第四步：读取调度事实

```ts
const facts = lighttask.getPlanSchedulingFacts("plan_alpha", {
  expectedPublishedGraphRevision: 1,
});
```

重点看：

- `runnableNodeIds`
- `blockedNodeIds`
- `byNodeId[nodeId].blockReason`

### 第五步：推进任务

```ts
lighttask.advanceTask(taskA.id, {
  expectedRevision: taskA.revision,
});
```

## 4. 双轴状态怎么理解

### `designStatus`

- `draft`：设计未完成，不参与调度
- `ready`：允许参与调度

### `executionStatus`

- `queued`
- `dispatched`
- `running`
- `completed`
- `failed`
- `cancelled`

应用层应该把这两条轴分开理解：

- 设计态回答“能不能进调度池”
- 执行态回答“已经跑到哪一步”
- 应用层查询和展示任务推进进度时，统一读取 `executionStatus`

## 5. Graph 现在还能做什么

Graph 只做三件事：

1. 描述谁依赖谁
2. 描述哪些节点会阻塞或放行
3. 给编辑器/可视化层提供结构视图

Graph 不再做：

1. 生成任务
2. 投影任务标题、摘要、metadata
3. 决定任务是否归属某个计划

## 6. 关系同步与计划确认 API 怎么理解

### `materializePlanTasks`

这个 API 现在的作用不是“从图里生成任务”，而是：

- 给任务同步已发布图的 provenance
- 可选把已从图里移除的旧 provenance 标记为 `orphaned`

如果你只是做正常调度，不需要依赖它来创建任务。

### `launchPlan`

这个 API 现在只做：

- 按最新已发布图收集任务快照
- 把 `ready` 计划推进到 `confirmed`

它不再自动发布图，也不再隐含任务设计同步。

## 7. 一致性边界怎么接

如果你的任务仓储、计划仓储、图仓储共享同一事务能力，建议实现 `consistency.run(scope, work)`：

- `publishGraph`
- `materializePlanTasks`
- `launchPlan`

这能把多对象写入包进同一一致性边界。

## 8. 哪些能力不要塞进内核

- 页面和交互
- 实时消息通道
- provider / agent 适配
- planner session
- 审批 UI
- 业务专属 read model

LightTask 负责稳定公共语义，上层应用负责真实产品流程。
