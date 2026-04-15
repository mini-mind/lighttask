# LightTask

LightTask 是一个面向上层业务应用的 TypeScript 编排内核，用统一的数据模型承接任务、计划、流程图、运行态、输出和领域事件，帮助团队把“流程怎么建、任务怎么跑、结果怎么落”沉淀成可复用的公共能力。

## 它能带来什么

- 用同一套核心对象承接任务流、计划流和执行流，减少应用层重复建模。
- 通过已发布图驱动任务物化，让流程设计和执行启动之间有清晰边界。
- 提供稳定的调度事实计算，便于上层应用实现自己的派发、优先级和审批策略。
- 通过 `ports` 子入口对接现有存储、时钟、ID 生成器和事件系统，方便嵌入已有产品架构。

## 适合构建的场景

- AI 协作任务流与人工审核链路
- 内容生产、交付、审批等多阶段流程
- 需要任务图建模和执行跟踪的工作流产品
- 希望把核心编排逻辑从应用代码中沉淀为公共库的团队

## 核心能力

- 任务 API：`createTask`、`listTasks`、`listTasksByPlan`、`getTask`、`advanceTask`
- 计划 API：`createPlan`、`listPlans`、`getPlan`、`updatePlan`、`advancePlan`
- 图 API：`getGraph`、`saveGraph`、`editGraph`、`getPublishedGraph`、`publishGraph`
- 编排 API：`materializePlanTasks`、`getPlanSchedulingFacts`、`launchPlan`
- 运行态 API：`createRuntime`、`listRuntimes`、`getRuntime`、`advanceRuntime`
- 输出 API：`createOutput`、`listOutputs`、`getOutput`、`advanceOutput`
- 事件能力：提交成功后通过 `notify.publish(event)` 推送领域事件

## 快速感受接入方式

```ts
import { createLightTask } from "lighttask";

const lighttask = createLightTask({
  taskRepository,
  planRepository,
  graphRepository,
  runtimeRepository,
  outputRepository,
  notify,
  clock: {
    now: () => new Date().toISOString(),
  },
  idGenerator: {
    nextTaskId: () => `task_${crypto.randomUUID()}`,
  },
});

const plan = lighttask.createPlan({
  id: "content_pipeline",
  title: "内容生产流程",
});

lighttask.advancePlan(plan.id, { expectedRevision: plan.revision });
lighttask.advancePlan(plan.id, { expectedRevision: 2 });

const draftGraph = lighttask.saveGraph(plan.id, {
  nodes: [{ id: "node_write", taskId: "graph_task_write", label: "撰写初稿" }],
  edges: [],
});

const publishedGraph = lighttask.publishGraph(plan.id, {
  expectedRevision: draftGraph.revision,
});

const launched = lighttask.launchPlan(plan.id, {
  expectedRevision: 3,
  expectedPublishedGraphRevision: publishedGraph.revision,
});

console.log(launched.tasks.map((task) => task.title));
```

完整接入示例见 [docs/application-developer-guide.md](/data/projects/lighttask/docs/application-developer-guide.md)。

## 文档导航

- [上层应用开发者使用教程](/data/projects/lighttask/docs/application-developer-guide.md)
- [产品需求文档](/data/projects/lighttask/docs/lighttask-kernel-replacement-prd.md)
- [架构说明](/data/projects/lighttask/docs/architecture.md)

## 本地开发

```bash
npm install
npm run check
npm run dev:cli -- demo
```

`README` 面向接入者提供入口信息，详细的端口实现方式、端到端示例和接入建议请查看教程文档。
