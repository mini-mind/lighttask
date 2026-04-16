import assert from "node:assert/strict";
import test from "node:test";
import type { LightTaskDomainEvent } from "../index";
import { createLightTask } from "../index";
import { createInMemoryNotifyCollector } from "../ports/in-memory";
import { createTestLightTaskOptions } from "./ports-fixture";

function getEventByType<TType extends LightTaskDomainEvent["type"]>(
  events: readonly LightTaskDomainEvent[],
  type: TType,
): Extract<LightTaskDomainEvent, { type: TType }> {
  const event = events.find(
    (candidate): candidate is Extract<LightTaskDomainEvent, { type: TType }> =>
      candidate.type === type,
  );

  assert.ok(event, `未找到事件 ${type}`);
  return event;
}

test("LightTask Notify API 在任务 create/update/advance 成功后发布事件，幂等重放不重复发布", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));

  const task = lighttask.createTask({
    title: "通知任务",
    designStatus: "draft",
  });

  let events = notify.listPublished();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "task.created");
  assert.equal(events[0].aggregate, "task");
  assert.equal(events[0].aggregateId, task.id);
  assert.equal(events[0].revision, 1);
  assert.equal(events[0].payload.task.executionStatus, "queued");
  assert.equal(events[0].payload.task.designStatus, "draft");

  notify.clear();

  const updated = lighttask.updateTask(task.id, {
    expectedRevision: 1,
    designStatus: "ready",
    summary: "补齐设计",
  });

  events = notify.listPublished();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "task.updated");
  assert.equal(events[0].aggregateId, task.id);
  assert.equal(events[0].revision, 2);
  assert.equal(events[0].payload.task.designStatus, "ready");
  assert.equal(events[0].payload.task.summary, "补齐设计");
  assert.equal(updated.revision, 2);

  notify.clear();

  const advanced = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 2,
    idempotencyKey: "req_task_advance_1",
  });

  events = notify.listPublished();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "task.advanced");
  assert.equal(events[0].aggregateId, task.id);
  assert.equal(events[0].revision, 3);
  assert.equal(events[0].idempotencyKey, "req_task_advance_1");
  assert.equal(events[0].payload.task.executionStatus, "dispatched");
  assert.equal(advanced.revision, 3);

  const replayed = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 2,
    idempotencyKey: "req_task_advance_1",
  });

  assert.equal(replayed.revision, 3);
  assert.equal(notify.listPublished().length, 1);
});

test("LightTask Notify API 在 plan create/update/advance 成功后分别发布事件", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));

  lighttask.createPlan({
    id: "plan_notify",
    title: "通知计划",
  });
  lighttask.updatePlan("plan_notify", {
    expectedRevision: 1,
    metadata: {
      owner: { name: "tester" },
    },
  });
  lighttask.advancePlan("plan_notify", {
    expectedRevision: 2,
  });

  const events = notify.listPublished();
  assert.deepEqual(
    events.map((event) => event.type),
    ["plan.created", "plan.updated", "plan.advanced"],
  );
  const updatedEvent = getEventByType(events, "plan.updated");
  const advancedEvent = getEventByType(events, "plan.advanced");

  assert.equal(updatedEvent.aggregate, "plan");
  assert.equal(updatedEvent.aggregateId, "plan_notify");
  assert.equal(updatedEvent.payload.plan.revision, 2);
  assert.deepEqual(updatedEvent.payload.plan.metadata, {
    owner: { name: "tester" },
  });
  assert.equal(advancedEvent.payload.plan.status, "planning");
});

test("LightTask Notify API 在 materializePlanTasks 成功后发布 plan.task_provenance_synced 快照事件", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  const task = lighttask.createTask({
    title: "任务一",
    planId: "plan_materialize_notify",
  });
  lighttask.createPlan({
    id: "plan_materialize_notify",
    title: "物化通知",
  });
  lighttask.saveGraph("plan_materialize_notify", {
    nodes: [
      {
        id: "node_materialize_notify_1",
        taskId: task.id,
        label: "任务一",
        metadata: { owner: { name: "graph" } },
      },
    ],
    edges: [],
    metadata: {
      channel: { name: "published" },
    },
  });
  lighttask.publishGraph("plan_materialize_notify", {
    expectedRevision: 1,
  });
  notify.clear();

  const result = lighttask.materializePlanTasks("plan_materialize_notify", {
    expectedPublishedGraphRevision: 1,
    removedNodePolicy: "keep",
  });

  const firstRead = notify.listPublished();
  assert.deepEqual(
    firstRead.map((event) => event.type),
    ["plan.task_provenance_synced"],
  );
  const event = getEventByType(firstRead, "plan.task_provenance_synced");
  assert.equal(event.aggregate, "plan");
  assert.equal(event.aggregateId, "plan_materialize_notify");
  assert.equal(event.revision, 1);
  assert.equal(event.id, "plan.task_provenance_synced:plan_materialize_notify:r1");
  assert.equal(event.payload.plan.status, "draft");
  assert.equal(event.payload.publishedGraph.revision, 1);
  assert.equal(event.payload.tasks.length, 1);
  assert.equal(event.payload.tasks[0].title, "任务一");

  result.plan.title = "外部篡改计划";
  result.publishedGraph.nodes[0].label = "外部篡改节点";
  result.tasks[0].title = "外部篡改任务";
  event.payload.plan.title = "再次篡改计划";
  event.payload.publishedGraph.nodes[0].label = "再次篡改节点";
  event.payload.tasks[0].title = "再次篡改任务";

  const secondRead = notify.listPublished();
  const reloadedEvent = getEventByType(secondRead, "plan.task_provenance_synced");
  assert.equal(reloadedEvent.payload.plan.title, "物化通知");
  assert.equal(reloadedEvent.payload.publishedGraph.nodes[0].label, "任务一");
  assert.equal(reloadedEvent.payload.tasks[0].title, "任务一");
  assert.equal(reloadedEvent.payload.tasks[0].metadata, undefined);
});

test("LightTask Notify API 对同一已发布图 revision 的重复 materialize 发布稳定事件 ID", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  const task = lighttask.createTask({
    title: "任务一",
    planId: "plan_materialize_notify_idempotent",
  });
  lighttask.createPlan({
    id: "plan_materialize_notify_idempotent",
    title: "幂等物化通知",
  });
  lighttask.saveGraph("plan_materialize_notify_idempotent", {
    nodes: [{ id: "node_1", taskId: task.id, label: "任务一" }],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_notify_idempotent", {
    expectedRevision: 1,
  });
  notify.clear();

  lighttask.materializePlanTasks("plan_materialize_notify_idempotent", {
    expectedPublishedGraphRevision: 1,
    removedNodePolicy: "keep",
  });
  lighttask.materializePlanTasks("plan_materialize_notify_idempotent", {
    expectedPublishedGraphRevision: 1,
    removedNodePolicy: "keep",
  });

  const events = notify.listPublished();
  assert.deepEqual(
    events.map((event) => event.type),
    ["plan.task_provenance_synced", "plan.task_provenance_synced"],
  );
  const [firstEvent, secondEvent] = events as [
    Extract<LightTaskDomainEvent, { type: "plan.task_provenance_synced" }>,
    Extract<LightTaskDomainEvent, { type: "plan.task_provenance_synced" }>,
  ];
  assert.equal(firstEvent.id, "plan.task_provenance_synced:plan_materialize_notify_idempotent:r1");
  assert.equal(secondEvent.id, firstEvent.id);
  assert.equal(firstEvent.revision, 1);
  assert.equal(secondEvent.revision, 1);
  assert.deepEqual(secondEvent.payload.tasks, firstEvent.payload.tasks);
});

test("LightTask Notify API 在 graph save/publish 成功后发布隔离快照", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  const task = lighttask.createTask({
    title: "任务一",
    planId: "plan_graph_notify",
  });
  notify.clear();
  lighttask.createPlan({
    id: "plan_graph_notify",
    title: "图通知",
  });

  const savedGraph = lighttask.saveGraph("plan_graph_notify", {
    nodes: [
      {
        id: "node_1",
        taskId: task.id,
        label: "任务一",
        metadata: { rank: 1 },
      },
    ],
    edges: [],
    metadata: {
      owner: { name: "tester" },
    },
  });
  const publishedGraph = lighttask.publishGraph("plan_graph_notify", {
    expectedRevision: 1,
  });

  savedGraph.nodes[0].label = "外部篡改";
  assert.ok(savedGraph.metadata);
  savedGraph.metadata.owner = { name: "mutated" };

  const firstRead = notify.listPublished();
  assert.deepEqual(
    firstRead.map((event) => event.type),
    ["plan.created", "graph.saved", "plan.updated", "graph.published"],
  );
  const planUpdatedEvent = getEventByType(firstRead, "plan.updated");
  const graphSavedEvent = getEventByType(firstRead, "graph.saved");
  const graphPublishedEvent = getEventByType(firstRead, "graph.published");

  assert.equal(planUpdatedEvent.aggregate, "plan");
  assert.equal(planUpdatedEvent.aggregateId, "plan_graph_notify");
  assert.equal(planUpdatedEvent.payload.plan.revision, 2);
  assert.equal(graphSavedEvent.aggregate, "graph");
  assert.equal(graphSavedEvent.aggregateId, "plan_graph_notify");
  assert.equal(graphSavedEvent.payload.scope, "draft");
  assert.equal(graphPublishedEvent.payload.scope, "published");
  assert.equal(graphPublishedEvent.payload.graph.revision, publishedGraph.revision);

  graphSavedEvent.payload.graph.nodes[0].label = "再次篡改";
  assert.ok(graphSavedEvent.payload.graph.metadata);
  graphSavedEvent.payload.graph.metadata.owner = { name: "twice-mutated" };

  const secondRead = notify.listPublished();
  const reloadedGraphSavedEvent = getEventByType(secondRead, "graph.saved");
  assert.equal(reloadedGraphSavedEvent.payload.graph.nodes[0].label, "任务一");
  assert.deepEqual(reloadedGraphSavedEvent.payload.graph.metadata, {
    owner: { name: "tester" },
  });
});

test("LightTask Notify API 在 runtime create/advance 成功后发布事件", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));

  lighttask.createRuntime({
    id: "runtime_notify",
    kind: "plan_launch",
    title: "运行时通知",
  });
  lighttask.advanceRuntime("runtime_notify", {
    expectedRevision: 1,
    result: {
      outcome: "ok",
    },
  });

  const events = notify.listPublished();
  assert.deepEqual(
    events.map((event) => event.type),
    ["runtime.created", "runtime.advanced"],
  );
  assert.equal(events[0].aggregate, "runtime");
  assert.equal(events[0].aggregateId, "runtime_notify");
  const advancedEvent = getEventByType(events, "runtime.advanced");
  assert.equal(advancedEvent.payload.runtime.status, "running");
});

test("LightTask Notify API 在 output create/advance 成功后发布事件", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));

  lighttask.createOutput({
    id: "output_notify",
    kind: "summary",
    runtimeRef: {
      id: "runtime_notify_only_ref",
    },
    items: [
      {
        id: " artifact_created ",
        kind: " text ",
      },
    ],
  });
  lighttask.advanceOutput("output_notify", {
    expectedRevision: 1,
    items: [
      {
        id: "artifact_advanced",
        kind: "structured",
        status: "ready",
      },
    ],
  });

  const events = notify.listPublished();
  assert.deepEqual(
    events.map((event) => event.type),
    ["output.created", "output.advanced"],
  );
  assert.equal(events[0].aggregate, "output");
  assert.equal(events[0].aggregateId, "output_notify");
  const createdEvent = getEventByType(events, "output.created");
  const advancedEvent = getEventByType(events, "output.advanced");
  assert.deepEqual(createdEvent.payload.output.items, [
    {
      id: "artifact_created",
      kind: "text",
      status: "declared",
    },
  ]);
  assert.equal(advancedEvent.payload.output.status, "sealed");
  assert.deepEqual(advancedEvent.payload.output.items, [
    {
      id: "artifact_advanced",
      kind: "structured",
      status: "ready",
    },
  ]);

  advancedEvent.payload.output.items = [
    {
      id: "artifact_mutated",
      kind: "broken",
      status: "mutated",
    },
  ];
  const secondRead = notify.listPublished();
  const advancedEventSecondRead = getEventByType(secondRead, "output.advanced");
  assert.deepEqual(advancedEventSecondRead.payload.output.items, [
    {
      id: "artifact_advanced",
      kind: "structured",
      status: "ready",
    },
  ]);
});

test("LightTask Notify API 在 launchPlan 期间按顺序发布 plan 编排事件", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  const task = lighttask.createTask({
    title: "任务一",
    planId: "plan_launch_notify",
  });
  lighttask.createPlan({
    id: "plan_launch_notify",
    title: "发射通知",
  });
  lighttask.advancePlan("plan_launch_notify", {
    expectedRevision: 1,
  });
  lighttask.advancePlan("plan_launch_notify", {
    expectedRevision: 2,
  });
  lighttask.saveGraph("plan_launch_notify", {
    nodes: [{ id: "node_launch_notify_1", taskId: task.id, label: "任务一" }],
    edges: [],
  });
  lighttask.publishGraph("plan_launch_notify", {
    expectedRevision: 1,
  });
  notify.clear();

  const launched = lighttask.launchPlan("plan_launch_notify", {
    expectedRevision: 4,
    expectedPublishedGraphRevision: 1,
  });

  const events = notify.listPublished();
  assert.deepEqual(
    events.map((event) => event.type),
    ["plan.advanced", "plan.launched"],
  );

  const planAdvancedEvent = getEventByType(events, "plan.advanced");
  const planLaunchedEvent = getEventByType(events, "plan.launched");

  assert.equal(planAdvancedEvent.revision, 5);
  assert.equal(planAdvancedEvent.payload.plan.status, "confirmed");

  assert.equal(planLaunchedEvent.aggregate, "plan");
  assert.equal(planLaunchedEvent.aggregateId, "plan_launch_notify");
  assert.equal(planLaunchedEvent.revision, 5);
  assert.equal(planLaunchedEvent.id, "plan.launched:plan_launch_notify:r5");
  assert.equal(planLaunchedEvent.payload.plan.status, "confirmed");
  assert.equal(planLaunchedEvent.payload.publishedGraph.revision, 1);
  assert.equal(planLaunchedEvent.payload.tasks[0].id, launched.tasks[0].id);
});
