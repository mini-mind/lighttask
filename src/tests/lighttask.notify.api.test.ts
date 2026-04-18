import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryNotifyCollector } from "../adapters/memory";
import { createLightTask } from "../index";
import { defineTaskPolicies, defineTaskPolicy } from "../policies";
import { DEFAULT_TASK_POLICY_ID, createTestLightTaskOptions } from "./adapters-fixture";

test("Notify API：发布 task created/updated/advanced/deleted 事件", () => {
  const notify = createInMemoryNotifyCollector();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  lighttask.plans.create({
    id: "plan_notify",
    title: "通知计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });
  const task = lighttask.tasks.create({
    planId: "plan_notify",
    title: "任务一",
  });
  const updated = lighttask.tasks.update(task.id, {
    expectedRevision: task.revision,
    title: "任务一-更新",
  });
  const todo = lighttask.tasks.move(task.id, {
    action: "finalize",
    expectedRevision: updated.revision,
  });
  lighttask.tasks.remove(task.id, {
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
  lighttask.plans.create({
    id: "plan_notify_detach",
    title: "通知计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });
  const upstream = lighttask.tasks.create({
    planId: "plan_notify_detach",
    title: "上游任务",
  });
  const downstream = lighttask.tasks.create({
    planId: "plan_notify_detach",
    title: "下游任务",
    dependsOnTaskIds: [upstream.id],
  });

  notify.clear();
  lighttask.tasks.remove(upstream.id, {
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
  lighttask.plans.create({
    id: "plan_notify_deleted_meta",
    title: "通知计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });
  const task = lighttask.tasks.create({
    planId: "plan_notify_deleted_meta",
    title: "待删任务",
  });

  notify.clear();
  lighttask.tasks.remove(task.id, {
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
  lighttask.plans.create({
    id: "plan_notify_idempotent_delete",
    title: "通知计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });
  const task = lighttask.tasks.create({
    planId: "plan_notify_idempotent_delete",
    title: "任务一",
  });

  notify.clear();
  lighttask.tasks.remove(task.id, {
    expectedRevision: task.revision,
    idempotencyKey: "req_delete_notify_1",
  });

  assert.deepEqual(
    notify.listPublished().map((event) => event.type),
    ["task.deleted"],
  );
});

test("Notify API：自定义 taskPolicy 会把陌生状态 key 原样带入事件 payload", () => {
  const notify = createInMemoryNotifyCollector();
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      notify,
      taskPolicies: defineTaskPolicies({
        policies: {
          custom_notify: defineTaskPolicy({
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
        },
      }),
    }),
  );
  lighttask.plans.create({
    id: "plan_notify_custom_status",
    title: "通知计划",
    taskPolicyId: "custom_notify",
  });

  const task = lighttask.tasks.create({
    planId: "plan_notify_custom_status",
    title: "自定义状态任务",
  });

  const createdEventPayload = notify.listPublished().find((event) => event.type === "task.created")
    ?.payload as { task: { status: string } } | undefined;
  assert.equal(createdEventPayload?.task.status, "ready_for_work");

  lighttask.tasks.move(task.id, {
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

test("Notify API：deletePlan/deleteRuntime/deleteOutput 会发布对应 deleted 事件", () => {
  const notify = createInMemoryNotifyCollector();
  const lighttask = createLightTask(createTestLightTaskOptions({ notify }));
  const planId = "plan_notify_deleted";
  lighttask.plans.create({
    id: planId,
    title: "删除通知计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });

  const runtime = lighttask.runs.create({
    id: "runtime_notify_deleted",
    kind: "agent_run",
    title: "待删运行时",
  });
  const output = lighttask.outputs.create({
    id: "output_notify_deleted",
    kind: "artifact",
  });

  notify.clear();
  lighttask.runs.remove(runtime.id, {
    expectedRevision: runtime.revision,
  });
  lighttask.outputs.remove(output.id, {
    expectedRevision: output.revision,
  });
  lighttask.plans.remove(planId, {
    expectedRevision: lighttask.plans.get(planId)?.revision ?? 0,
  });

  assert.deepEqual(
    notify.listPublished().map((event) => event.type),
    ["runtime.deleted", "output.deleted", "plan.deleted"],
  );
});
