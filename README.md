# LightTask

LightTask 是面向上层业务应用的 TypeScript 编排内核。当前版本已经切到 Task-first：

- `Task` 是唯一真源对象
- `Graph` 只是任务依赖关系与约束关系视图
- `Task` 使用 `designStatus + executionStatus` 双轴状态
- `Runtime` / `Output` 负责执行上下文与结果留痕，不替代 `Task`

## 最小启动

如果你只是想先把主链在本地跑通，可以直接使用公开的 `lighttask/ports/in-memory` 适配器：

```ts
import { createLightTask } from "lighttask";
import { createInMemoryLightTaskPorts } from "lighttask/ports/in-memory";

const lighttask = createLightTask(createInMemoryLightTaskPorts());
```

## 核心对象

### `Plan`

- 一轮编排实例的容器边界
- 承接计划级生命周期与元信息

### `Task`

- 唯一真源对象
- 承接任务定义、计划归属、设计态、执行态、步骤和扩展字段

当前实现里：

- `designStatus` 只支持 `draft | ready`
- `executionStatus` 表达执行推进
- `planId` 由任务自己声明，Graph 只负责依赖关系视图

### `Graph`

- 只描述任务之间的依赖关系与约束关系
- 不生成任务，不覆盖任务设计字段，不作为执行真源

### `Runtime` / `Output`

- `Runtime` 记录执行上下文
- `Output` 记录结构化产物

## 用人话理解这些对象

- `Plan` 像一张项目工作台，定义“这一轮协作”的边界。
- `Task` 像工作台上的真实待办卡片，谁来做、做到哪一步、是不是还在草稿，都看它。
- `Graph` 像卡片之间的依赖线，只回答“先做谁、后做谁、谁卡住谁”，不再承载任务正文。
- `Runtime` 像一次执行过程的运行记录，记录是谁在跑、跑时带了什么上下文。
- `Output` 像这次执行产出的结果物，沉淀文本、文件、结构化结果。

把它们连起来理解就是：

- `Plan` 下面有一批 `Task`
- `Graph` 只是这批 `Task` 的依赖视图
- 调度器读取 `Task + Graph` 得到“谁现在能动”
- 上层人或 Agent 真正推进的是 `Task`
- `Runtime` 和 `Output` 负责记录“任务怎么跑过、产出了什么”

## 主链

```text
Plan
  -> Task[]
  -> Graph(依赖关系视图)
  -> getPlanSchedulingFacts
  -> 上层执行器 / 人 / Agent
  -> advanceTask
  -> Runtime / Output
```

## 关键语义

### 1. 任务先归属计划，再发布关系视图

如果一个任务要被某个 `Plan` 调度，它必须先由任务自身声明 `planId`。

```ts
lighttask.createPlan({
  id: "plan_alpha",
  title: "主流程",
});

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

### 2. 草稿任务不会进入调度

- `designStatus = draft`：任务定义未完成，不进入调度池
- `designStatus = ready`：允许进入调度池

### 3. Graph 只负责关系

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

`publishGraph` 的作用是：

- 发布一份关系视图快照
- 同步推进 `plan.revision`
- 强制上层基于最新依赖基线重新确认计划

它不会：

- 创建任务
- 修改任务标题、摘要、metadata
- 代替任务声明计划归属

### 4. 调度直接基于任务集合 + 关系视图

```ts
const facts = lighttask.getPlanSchedulingFacts("plan_alpha", {
  expectedPublishedGraphRevision: 1,
});
```

调度事实会明确返回：

- 哪些节点 `runnable`
- 哪些节点因前置未完成阻塞
- 哪些节点因 `designStatus = draft` 阻塞
- 哪些节点已经终态

### 5. `materializePlanTasks` 只同步关系 provenance

这个 API 的作用是：

- 只把已发布关系视图 revision 回写到任务的 `lighttask` provenance
- 不再把 Graph 设计字段投影回任务
- 可选把已移除节点的旧 provenance 标成 `orphaned`

### 6. `launchPlan` 只做计划确认闭环

`launchPlan` 当前只做两件事：

- 读取最新已发布图上的任务快照
- 把 `ready` 计划确认到 `confirmed`

它不再隐含：

- 图发布
- 任务物化
- 任务设计同步

## 一致性边界

对接真实存储时，推荐实现 `consistency.run(scope, work)` 端口，把这些多对象写入放进同一一致性边界：

- `publishGraph`
- `materializePlanTasks`
- `launchPlan`

内置 in-memory 适配器提供的是 no-op 边界；如果你的仓储共享同一数据库/事务能力，应在应用层适配成真实事务。

## 本地开发

```bash
npm install
npm run check
```

如果你是在当前仓库里做本地试跑，可直接参考 [`src/cli/smoke.ts`](/data/projects/lighttask/src/cli/smoke.ts) 里的最小组装方式。

## 文档

- [架构说明](docs/architecture.md)
- [应用层接入指南](docs/application-developer-guide.md)
- [PRD](docs/lighttask-kernel-replacement-prd.md)
- [重构收敛记录](docs/plan.md)
- [变更记录](CHANGELOG.md)
