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

test("LightTask Notify API 在任务成功提交后发布事件，幂等重放不重复发布", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));

  const task = lighttask.createTask({
    title: "通知任务",
  });

  let events = notify.listPublished();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "task.created");
  assert.equal(events[0].aggregate, "task");
  assert.equal(events[0].aggregateId, task.id);
  assert.equal(events[0].revision, 1);
  assert.equal(events[0].payload.task.status, "queued");

  notify.clear();

  const advanced = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_task_advance_1",
  });

  events = notify.listPublished();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "task.advanced");
  assert.equal(events[0].aggregateId, task.id);
  assert.equal(events[0].revision, 2);
  assert.equal(events[0].idempotencyKey, "req_task_advance_1");
  assert.equal(events[0].payload.task.status, "dispatched");
  assert.equal(advanced.revision, 2);

  const replayed = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_task_advance_1",
  });

  assert.equal(replayed.revision, 2);
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

test("LightTask Notify API 在 graph save/publish 成功后发布隔离快照", () => {
  const notify = createInMemoryNotifyCollector<LightTaskDomainEvent>();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  lighttask.createPlan({
    id: "plan_graph_notify",
    title: "图通知",
  });

  const savedGraph = lighttask.saveGraph("plan_graph_notify", {
    nodes: [
      {
        id: "node_1",
        taskId: "task_1",
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
    ["plan.created", "graph.saved", "graph.published"],
  );
  const graphSavedEvent = getEventByType(firstRead, "graph.saved");
  const graphPublishedEvent = getEventByType(firstRead, "graph.published");

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
