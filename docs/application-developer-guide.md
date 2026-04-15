# LightTask 上层应用开发者使用教程

这份教程面向需要把 LightTask 接入业务应用的开发者，重点覆盖三个问题：

1. LightTask 的核心对象分别解决什么问题。
2. 如何基于公开 API 和端口契约完成最小接入。
3. 如何把计划、图、任务、运行态、输出和事件串成一条完整链路。

## 1. 先理解核心对象

| 对象 | 作用 | 典型使用时机 |
| --- | --- | --- |
| `Task` | 承接单个任务的状态、步骤和推进历史 | 执行、审批、失败重试、人工处理 |
| `Plan` | 承接流程级别的生命周期 | 创建流程、进入规划、准备启动、确认发射 |
| `Graph` | 描述计划中的节点和依赖关系 | 设计流程结构、修改草稿图、发布执行版本 |
| `Runtime` | 记录运行过程中的上下文和结果 | 发起执行、跟踪执行状态、沉淀执行结果 |
| `Output` | 记录结构化产物和交付物 | 保存文本、结构化结果、附件索引 |
| `Domain Event` | 对接应用的通知、日志、自动化订阅 | 发任务事件、发计划事件、监听编排事件 |

一个典型链路通常是：

`创建计划 -> 进入 ready -> 保存草稿图 -> 发布图 -> 发射计划 -> 物化任务 -> 推进任务/运行态 -> 生成输出 -> 消费领域事件`

## 2. 安装与公开入口

LightTask 当前公开的入口分成三类：

- `lighttask`：核心 API 与主要类型
- `lighttask/ports`：端口契约类型
- `lighttask/data-structures`：错误结构、基础数据结构与少量辅助工厂

在仓库内本地开发时可以直接运行：

```bash
npm install
npm run check
npm run dev:cli -- demo
```

## 3. 初始化一个最小可运行的内核

`createLightTask` 需要你注入自己的仓储、时钟、ID 生成器和可选通知端口。为了让示例能单文件运行，下面先写一组最小内存适配器。

```ts
import { randomUUID } from "node:crypto";
import {
  type LightTaskDomainEvent,
  type LightTaskGraph,
  type LightTaskOutput,
  type LightTaskPlan,
  type LightTaskRuntime,
  type LightTaskTask,
  createLightTask,
} from "lighttask";
import { createCoreError } from "lighttask/data-structures";
import type {
  GraphRepository,
  NotifyPort,
  OutputRepository,
  PlanRepository,
  RuntimeRepository,
  TaskRepository,
} from "lighttask/ports";

type PersistedTask = LightTaskTask & { lastAdvanceFingerprint?: string };
type PersistedPlan = LightTaskPlan;
type PersistedGraph = LightTaskGraph;
type PersistedRuntime = LightTaskRuntime;
type PersistedOutput = LightTaskOutput;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createRevisionConflictError(
  entityName: string,
  entityIdLabel: string,
  entityId: string,
  expectedRevision: number,
  actualRevision: number,
) {
  return createCoreError("REVISION_CONFLICT", `${entityName} revision 冲突，保存被拒绝`, {
    [entityIdLabel]: entityId,
    expectedRevision,
    actualRevision,
  });
}

function createDuplicateIdError(entityName: string, entityIdLabel: string, entityId: string) {
  return createCoreError("STATE_CONFLICT", `${entityName} ID 已存在，禁止覆盖已有记录`, {
    [entityIdLabel]: entityId,
  });
}

function createMissingError(entityName: string, entityIdLabel: string, entityId: string) {
  return createCoreError("NOT_FOUND", `${entityName}不存在，无法保存变更`, {
    [entityIdLabel]: entityId,
  });
}

function createKeyedRepository<TRecord extends { id: string; revision: number }>(config: {
  entityName: string;
  entityIdLabel: string;
}) {
  const records = new Map<string, TRecord>();

  return {
    list() {
      return Array.from(records.values()).map(clone);
    },
    get(id: string) {
      const record = records.get(id);
      return record ? clone(record) : undefined;
    },
    create(record: TRecord) {
      const snapshot = clone(record);
      if (records.has(snapshot.id)) {
        return {
          ok: false as const,
          error: createDuplicateIdError(config.entityName, config.entityIdLabel, snapshot.id),
        };
      }

      records.set(snapshot.id, snapshot);
      return { ok: true as const, record: clone(snapshot) };
    },
    saveIfRevisionMatches(record: TRecord, expectedRevision: number) {
      const snapshot = clone(record);
      const current = records.get(snapshot.id);

      if (!current) {
        return {
          ok: false as const,
          error: createMissingError(config.entityName, config.entityIdLabel, snapshot.id),
        };
      }

      if (current.revision !== expectedRevision) {
        return {
          ok: false as const,
          error: createRevisionConflictError(
            config.entityName,
            config.entityIdLabel,
            snapshot.id,
            expectedRevision,
            current.revision,
          ),
        };
      }

      records.set(snapshot.id, snapshot);
      return { ok: true as const, record: clone(snapshot) };
    },
  };
}

function createTaskRepository(): TaskRepository<PersistedTask> {
  const repository = createKeyedRepository<PersistedTask>({
    entityName: "任务",
    entityIdLabel: "taskId",
  });

  return {
    list: repository.list,
    get: repository.get,
    create(task) {
      const result = repository.create(task);
      return result.ok ? { ok: true, task: result.record } : result;
    },
    saveIfRevisionMatches(task, expectedRevision) {
      const result = repository.saveIfRevisionMatches(task, expectedRevision);
      return result.ok ? { ok: true, task: result.record } : result;
    },
  };
}

function createPlanRepository(): PlanRepository<PersistedPlan> {
  const repository = createKeyedRepository<PersistedPlan>({
    entityName: "计划",
    entityIdLabel: "planId",
  });

  return {
    list: repository.list,
    get: repository.get,
    create(plan) {
      const result = repository.create(plan);
      return result.ok ? { ok: true, plan: result.record } : result;
    },
    saveIfRevisionMatches(plan, expectedRevision) {
      const result = repository.saveIfRevisionMatches(plan, expectedRevision);
      return result.ok ? { ok: true, plan: result.record } : result;
    },
  };
}

function createRuntimeRepository(): RuntimeRepository<PersistedRuntime> {
  const repository = createKeyedRepository<PersistedRuntime>({
    entityName: "运行时",
    entityIdLabel: "runtimeId",
  });

  return {
    list: repository.list,
    get: repository.get,
    create(runtime) {
      const result = repository.create(runtime);
      return result.ok ? { ok: true, runtime: result.record } : result;
    },
    saveIfRevisionMatches(runtime, expectedRevision) {
      const result = repository.saveIfRevisionMatches(runtime, expectedRevision);
      return result.ok ? { ok: true, runtime: result.record } : result;
    },
  };
}

function createOutputRepository(): OutputRepository<PersistedOutput> {
  const repository = createKeyedRepository<PersistedOutput>({
    entityName: "输出",
    entityIdLabel: "outputId",
  });

  return {
    list: repository.list,
    get: repository.get,
    create(output) {
      const result = repository.create(output);
      return result.ok ? { ok: true, output: result.record } : result;
    },
    saveIfRevisionMatches(output, expectedRevision) {
      const result = repository.saveIfRevisionMatches(output, expectedRevision);
      return result.ok ? { ok: true, output: result.record } : result;
    },
  };
}

function createGraphRepository(): GraphRepository<PersistedGraph> {
  const drafts = new Map<string, PersistedGraph>();
  const published = new Map<string, PersistedGraph>();

  function resolveStore(scope: "draft" | "published" = "draft") {
    return scope === "published" ? published : drafts;
  }

  return {
    get(planId, scope) {
      const graph = resolveStore(scope).get(planId);
      return graph ? clone(graph) : undefined;
    },
    create(planId, graph, scope) {
      const store = resolveStore(scope);
      const snapshot = clone(graph);

      if (store.has(planId)) {
        return {
          ok: false as const,
          error: createDuplicateIdError("计划图", "planId", planId),
        };
      }

      store.set(planId, snapshot);
      return { ok: true as const, graph: clone(snapshot) };
    },
    saveIfRevisionMatches(planId, graph, expectedRevision, scope) {
      const store = resolveStore(scope);
      const current = store.get(planId);
      const snapshot = clone(graph);

      if (!current) {
        return {
          ok: false as const,
          error: createMissingError("计划图", "planId", planId),
        };
      }

      if (current.revision !== expectedRevision) {
        return {
          ok: false as const,
          error: createRevisionConflictError(
            "计划图",
            "planId",
            planId,
            expectedRevision,
            current.revision,
          ),
        };
      }

      store.set(planId, snapshot);
      return { ok: true as const, graph: clone(snapshot) };
    },
  };
}

function createNotifyCollector() {
  const events: LightTaskDomainEvent[] = [];

  const notify: NotifyPort<LightTaskDomainEvent> = {
    publish(event) {
      events.push(clone(event));
    },
  };

  return {
    notify,
    listPublished() {
      return events.map(clone);
    },
  };
}

const eventCollector = createNotifyCollector();

const lighttask = createLightTask({
  taskRepository: createTaskRepository(),
  planRepository: createPlanRepository(),
  graphRepository: createGraphRepository(),
  runtimeRepository: createRuntimeRepository(),
  outputRepository: createOutputRepository(),
  notify: eventCollector.notify,
  clock: {
    now() {
      return new Date().toISOString();
    },
  },
  idGenerator: {
    nextTaskId() {
      return `task_${randomUUID()}`;
    },
  },
});
```

这套示例适配器只用于帮助理解接入方式。真正落地时，建议把这些端口接到你的数据库、事件总线和应用时钟体系里。

## 4. 从计划到任务的完整链路

下面用一个“内容生产流程”把核心 API 串起来。

```ts
const plan = lighttask.createPlan({
  id: "content_pipeline",
  title: "内容生产流程",
  metadata: {
    owner: "growth-team",
  },
});

const planning = lighttask.advancePlan(plan.id, {
  expectedRevision: plan.revision,
});

const ready = lighttask.advancePlan(plan.id, {
  expectedRevision: planning.revision,
});

const draftGraph = lighttask.saveGraph(plan.id, {
  nodes: [
    { id: "node_research", taskId: "graph_task_research", label: "收集素材" },
    { id: "node_write", taskId: "graph_task_write", label: "撰写初稿" },
    { id: "node_review", taskId: "graph_task_review", label: "内容审核" },
  ],
  edges: [
    {
      id: "edge_write_depends_on_research",
      fromNodeId: "node_write",
      toNodeId: "node_research",
      kind: "depends_on",
    },
    {
      id: "edge_review_depends_on_write",
      fromNodeId: "node_review",
      toNodeId: "node_write",
      kind: "depends_on",
    },
  ],
  metadata: {
    version: "v1",
  },
});

const publishedGraph = lighttask.publishGraph(plan.id, {
  expectedRevision: draftGraph.revision,
});

const launchResult = lighttask.launchPlan(plan.id, {
  expectedRevision: ready.revision,
  expectedPublishedGraphRevision: publishedGraph.revision,
});

console.log(launchResult.plan.status);
console.log(launchResult.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })));
```

此时你已经拿到了：

- 一个状态为 `confirmed` 的计划
- 一份稳定的已发布图快照
- 一组从已发布图物化出来的任务

## 5. 读取调度事实，而不是把策略写死在内核里

LightTask 会告诉你当前哪些节点可运行、哪些节点被阻塞，以及阻塞原因。应用层可以在此基础上实现自己的派发策略。

```ts
const factsBeforeStart = lighttask.getPlanSchedulingFacts(plan.id, {
  expectedPublishedGraphRevision: publishedGraph.revision,
});

console.log(factsBeforeStart.runnableNodeIds);
// ["node_research"]

const researchTask = launchResult.tasks.find((task) => task.title === "收集素材");
if (!researchTask) {
  throw new Error("缺少 research 任务");
}

const dispatched = lighttask.advanceTask(researchTask.id, {
  expectedRevision: researchTask.revision,
  action: "dispatch",
  idempotencyKey: "dispatch_research_v1",
});

const running = lighttask.advanceTask(dispatched.id, {
  expectedRevision: dispatched.revision,
  action: "start",
  idempotencyKey: "start_research_v1",
});

lighttask.advanceTask(running.id, {
  expectedRevision: running.revision,
  action: "complete",
  idempotencyKey: "complete_research_v1",
});

const factsAfterComplete = lighttask.getPlanSchedulingFacts(plan.id, {
  expectedPublishedGraphRevision: publishedGraph.revision,
});

console.log(factsAfterComplete.runnableNodeIds);
// ["node_write"]
```

这里有两个实战要点：

- `advanceTask` 需要显式传入 `expectedRevision`，用来保护并发更新。
- 任务推进建议始终带上 `idempotencyKey`，方便重复请求时做幂等重放。

## 6. 修改草稿图，并按版本重新发布

`saveGraph` 用于保存整份草稿图，`editGraph` 用于对草稿图做增量编辑。已发布图在重新发布前保持稳定，因此非常适合承接“设计中”和“执行中”两个阶段。

```ts
const editedDraft = lighttask.editGraph(plan.id, {
  expectedRevision: draftGraph.revision,
  operations: [
    {
      type: "upsert_node",
      node: { id: "node_publish", taskId: "graph_task_publish", label: "发布上线" },
    },
    {
      type: "upsert_edge",
      edge: {
        id: "edge_publish_depends_on_review",
        fromNodeId: "node_publish",
        toNodeId: "node_review",
        kind: "depends_on",
      },
    },
  ],
  idempotencyKey: "graph_patch_v2",
});

const republishedGraph = lighttask.publishGraph(plan.id, {
  expectedRevision: editedDraft.revision,
});
```

增量编辑有三个边界建议：

- 只在草稿图上做修改。
- 发布前允许多次调整草稿。
- 执行中的任务仍然以当时的已发布图为准，直到你显式重新发布。

## 7. 用 `Runtime` 记录执行过程

当任务真正开始执行时，建议创建一个 `Runtime` 记录运行上下文、执行关系和最终结果。

```ts
const runtime = lighttask.createRuntime({
  id: "runtime_research_001",
  kind: "agent_run",
  title: "素材收集执行",
  ownerRef: {
    kind: "task",
    id: researchTask.id,
  },
  parentRef: {
    kind: "plan",
    id: plan.id,
  },
  relatedRefs: [
    {
      kind: "graph_node",
      id: "node_research",
    },
  ],
  context: {
    channel: "wecom",
  },
});

const runtimeRunning = lighttask.advanceRuntime(runtime.id, {
  expectedRevision: runtime.revision,
});

const runtimeCompleted = lighttask.advanceRuntime(runtime.id, {
  expectedRevision: runtimeRunning.revision,
  result: {
    sourceCount: 12,
    outcome: "ok",
  },
});
```

`Runtime` 适合承接：

- 具体执行实例
- 执行上下文
- 执行结果
- 与任务、计划、图节点之间的关系引用

## 8. 用 `Output` 管理结构化产物

当运行过程产出报告、文本、结构化数据或附件索引时，建议用 `Output` 记录。

```ts
const output = lighttask.createOutput({
  id: "output_research_summary_001",
  kind: "research_summary",
  runtimeRef: {
    id: runtimeCompleted.id,
  },
  ownerRef: {
    kind: "task",
    id: researchTask.id,
  },
  payload: {
    text: "已完成素材梳理和可信度筛选",
  },
  items: [
    {
      id: "artifact_summary_markdown",
      kind: "text",
      role: "final",
      label: "素材摘要",
      contentType: "text/markdown",
    },
  ],
});

const revisedOutput = lighttask.advanceOutput(output.id, {
  expectedRevision: output.revision,
  payload: {
    text: "已完成素材梳理、可信度筛选和要点归并",
  },
});

const sealedOutput = lighttask.advanceOutput(revisedOutput.id, {
  expectedRevision: revisedOutput.revision,
});
```

这条链路里，`Output` 的默认生命周期很适合做“先生成草稿，再封板归档”的产物管理。

## 9. 消费领域事件

如果你注入了 `notify` 端口，LightTask 会在成功提交后发出领域事件。你可以把这些事件接到消息总线、审计日志或应用自己的自动化流程上。

```ts
const eventTypes = eventCollector.listPublished().map((event) => event.type);

console.log(eventTypes);
// 例如：
// [
//   "plan.created",
//   "plan.advanced",
//   "graph.saved",
//   "graph.published",
//   "plan.tasks_materialized",
//   "plan.launched",
//   "task.advanced",
//   "runtime.created",
//   "runtime.advanced",
//   "output.created",
//   "output.advanced"
// ]
```

推荐的消费方式：

- 把事件当成“事实流”使用，而不是回写业务主状态的唯一来源。
- 在应用层决定是否转发到 MQ、WebSocket、Webhook 或审计系统。
- 按 `event.type` 做订阅路由，按 `payload` 读取最新快照。

## 10. 接入到正式应用时的建议

### 仓储实现

- `list`、`get`、`create`、`saveIfRevisionMatches` 是最核心的仓储契约。
- 返回给 LightTask 的对象必须与存储态隔离，避免外部修改污染内部状态。
- `saveIfRevisionMatches` 最好映射到数据库的条件更新或乐观锁能力。

### 错误处理

- 业务层应捕获 `LightTaskError` 并根据 `code` 做分支处理。
- 常见错误码包括 `VALIDATION_ERROR`、`STATE_CONFLICT`、`REVISION_CONFLICT`、`NOT_FOUND`。

### 架构落位

- 把 LightTask 放在应用的核心编排层。
- 把页面、接口、执行器、通知通道和调度策略保留在应用自己的边界内。
- 通过 `lighttask/ports` 对齐接口类型，通过 `lighttask` 调用公共 API。

## 11. 一个推荐的落地顺序

1. 先接通 `taskRepository`、`planRepository`、`graphRepository`、`clock`、`idGenerator`。
2. 跑通“计划 -> 图 -> 发布 -> 发射 -> 任务物化”这条主链。
3. 再接入 `runtimeRepository` 和 `outputRepository`，补执行记录与产物归档。
4. 最后接入 `notify`，把领域事件并入你的应用事件系统。

做到这一步，LightTask 就已经可以作为上层应用的公共编排内核使用了。
