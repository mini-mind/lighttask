import assert from "node:assert/strict";
import test from "node:test";
import {
  bumpRevision,
  createDomainEvent,
  createPlanRecord,
  createTaskRecord,
  isTaskStatus,
} from "../models";

test("数据结构层：Task/Plan 记录按终局模型初始化", () => {
  const now = "2026-04-16T00:00:00.000Z";
  const task = createTaskRecord({
    id: "task_1",
    planId: "plan_1",
    title: "编排任务",
    createdAt: now,
    status: "draft",
  });
  const plan = createPlanRecord({
    id: "plan_1",
    title: "规划容器",
    taskPolicyId: "policy_default",
    createdAt: now,
  });

  assert.equal(task.status, "draft");
  assert.deepEqual(task.dependsOnTaskIds, []);
  assert.deepEqual(task.steps, []);
  assert.equal(plan.revision, 1);
  assert.equal(plan.taskPolicyId, "policy_default");
  assert.equal(plan.updatedAt, now);
});

test("数据结构层：Task 记录支持 trim、依赖和步骤透传", () => {
  const task = createTaskRecord({
    id: "task_2",
    planId: "plan_1",
    title: "  任务标题  ",
    summary: "  摘要  ",
    status: "todo",
    dependsOnTaskIds: ["task_1"],
    steps: [
      {
        id: "step_1",
        title: "分析",
        stage: "investigate",
        status: "todo",
      },
    ],
    createdAt: "2026-04-16T00:00:00.000Z",
    idempotencyKey: "req_1",
  });

  assert.equal(task.title, "任务标题");
  assert.equal(task.summary, "摘要");
  assert.equal(task.status, "todo");
  assert.deepEqual(task.dependsOnTaskIds, ["task_1"]);
  assert.equal(task.idempotencyKey, "req_1");
});

test("数据结构层：状态辅助函数与 revision 演进符合终局口径", () => {
  assert.equal(isTaskStatus("running"), true);
  assert.equal(isTaskStatus("custom_reviewing"), true);
  assert.equal(isTaskStatus("   "), false);

  const next = bumpRevision(
    {
      revision: 1,
      updatedAt: "2026-04-16T00:00:00.000Z",
    },
    "2026-04-16T01:00:00.000Z",
    "req_2",
  );
  assert.deepEqual(next, {
    revision: 2,
    updatedAt: "2026-04-16T01:00:00.000Z",
    idempotencyKey: "req_2",
  });
});

test("数据结构层：事件结构保留聚合、版本和 payload 快照", () => {
  const payload = {
    task: {
      id: "task_1",
    },
  };
  const event = createDomainEvent({
    id: "event_1",
    type: "task.created",
    aggregate: "task",
    aggregateId: "task_1",
    occurredAt: "2026-04-16T00:00:00.000Z",
    revision: 1,
    payload,
  });
  payload.task.id = "task_2";

  assert.equal(event.version, 1);
  assert.equal(event.type, "task.created");
  assert.deepEqual(event.payload, {
    task: {
      id: "task_1",
    },
  });
});
