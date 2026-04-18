import assert from "node:assert/strict";
import test from "node:test";
import { createLightTask } from "../index";
import { createInMemoryNotifyCollector } from "../ports/in-memory";
import { createTaskLifecyclePolicy } from "../rules";
import { createTestLightTaskOptions } from "./ports-fixture";

test("Notify API：发布 task created/updated/advanced/deleted 事件", () => {
  const notify = createInMemoryNotifyCollector();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  lighttask.createPlan({
    id: "plan_notify",
    title: "通知计划",
  });
  const task = lighttask.createTask({
    planId: "plan_notify",
    title: "任务一",
  });
  const updated = lighttask.updateTask(task.id, {
    expectedRevision: task.revision,
    title: "任务一-更新",
  });
  const todo = lighttask.advanceTask(task.id, {
    action: "finalize",
    expectedRevision: updated.revision,
  });
  lighttask.deleteTask(task.id, {
    expectedRevision: todo.revision,
  });

  assert.deepEqual(
    notify.listPublished().map((event) => event.type),
    ["plan.created", "task.created", "task.updated", "task.advanced", "task.deleted"],
  );
});

test("Notify API：deleteTask 自动解绑下游时会先发布 task.updated 再发布 task.deleted", () => {
  const notify = createInMemoryNotifyCollector();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  lighttask.createPlan({
    id: "plan_notify_detach",
    title: "通知计划",
  });
  const upstream = lighttask.createTask({
    planId: "plan_notify_detach",
    title: "上游任务",
  });
  const downstream = lighttask.createTask({
    planId: "plan_notify_detach",
    title: "下游任务",
    dependsOnTaskIds: [upstream.id],
  });

  notify.clear();
  lighttask.deleteTask(upstream.id, {
    expectedRevision: upstream.revision,
  });

  const published = notify.listPublished();
  assert.deepEqual(
    published.map((event) => event.type),
    ["task.updated", "task.deleted"],
  );
  const updatedPayload = published[0]?.payload as
    | { task: { id: string; dependsOnTaskIds: string[] } }
    | undefined;
  assert.equal(updatedPayload?.task.id, downstream.id);
  assert.deepEqual(updatedPayload?.task.dependsOnTaskIds, []);
});

test("Notify API：task.deleted 事件沿用统一时钟并使用真实版本链", () => {
  const notify = createInMemoryNotifyCollector();
  const fixedNow = "2026-04-16T00:00:00.000Z";
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      notify,
      clock: {
        now: () => fixedNow,
      },
    }),
  );
  lighttask.createPlan({
    id: "plan_notify_deleted_meta",
    title: "通知计划",
  });
  const task = lighttask.createTask({
    planId: "plan_notify_deleted_meta",
    title: "待删任务",
  });

  notify.clear();
  lighttask.deleteTask(task.id, {
    expectedRevision: task.revision,
    idempotencyKey: "req_delete_event",
  });

  const deletedEvent = notify.listPublished()[0];
  assert.equal(deletedEvent?.type, "task.deleted");
  assert.equal(deletedEvent?.revision, task.revision + 1);
  assert.equal(deletedEvent?.occurredAt, fixedNow);
  assert.equal(deletedEvent?.idempotencyKey, "req_delete_event");
});

test("Notify API：带 idempotencyKey 的 deleteTask 不应泄漏 plan.updated 事件", () => {
  const notify = createInMemoryNotifyCollector();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  lighttask.createPlan({
    id: "plan_notify_idempotent_delete",
    title: "通知计划",
  });
  const task = lighttask.createTask({
    planId: "plan_notify_idempotent_delete",
    title: "任务一",
  });

  notify.clear();
  lighttask.deleteTask(task.id, {
    expectedRevision: task.revision,
    idempotencyKey: "req_delete_notify_1",
  });

  assert.deepEqual(
    notify.listPublished().map((event) => event.type),
    ["task.deleted"],
  );
});

test("Notify API：自定义 taskLifecycle 会把陌生状态 key 原样带入事件 payload", () => {
  const notify = createInMemoryNotifyCollector();
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      notify,
      taskLifecycle: createTaskLifecyclePolicy({
        initialStatus: "ready_for_work",
        statusDefinitions: [
          {
            key: "ready_for_work",
            editable: false,
            schedulable: true,
            active: false,
            terminal: false,
          },
          {
            key: "done_for_now",
            editable: false,
            schedulable: false,
            active: false,
            terminal: true,
            completionOutcome: "success",
          },
        ],
        actionDefinitions: [
          { key: "complete", requiresRunnable: true, stepProgress: "complete_all" },
        ],
        transitionDefinitions: [
          {
            from: "ready_for_work",
            action: "complete",
            to: "done_for_now",
          },
        ],
        terminalStatuses: ["done_for_now"],
      }),
    }),
  );
  lighttask.createPlan({
    id: "plan_notify_custom_status",
    title: "通知计划",
  });

  const task = lighttask.createTask({
    planId: "plan_notify_custom_status",
    title: "自定义状态任务",
  });

  const createdEventPayload = notify.listPublished().find((event) => event.type === "task.created")
    ?.payload as { task: { status: string } } | undefined;
  assert.equal(createdEventPayload?.task.status, "ready_for_work");

  lighttask.advanceTask(task.id, {
    action: "complete",
    expectedRevision: task.revision,
  });

  const advancedEventPayload = notify
    .listPublished()
    .find((event) => event.type === "task.advanced")?.payload as
    | { task: { status: string } }
    | undefined;
  assert.equal(advancedEventPayload?.task.status, "done_for_now");
});
