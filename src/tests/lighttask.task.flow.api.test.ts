import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError } from "../index";
import { createTestLightTask } from "./adapters-fixture";

test("Task API：draft 任务可编辑、finalize 后进入调度主链", () => {
  const { lighttask, planId } = createTestLightTask();
  const task = lighttask.tasks.create({
    planId,
    title: "草稿任务",
    dependsOnTaskIds: [],
    steps: [
      {
        id: "step_1",
        title: "分析",
        stage: "investigate",
      },
    ],
  });

  assert.equal(task.status, "draft");
  assert.deepEqual(
    task.steps.map((step) => step.status),
    ["todo"],
  );

  const updated = lighttask.tasks.update(task.id, {
    expectedRevision: task.revision,
    title: "已设计完成",
    summary: "补齐定义字段",
    metadata: { priority: "p1" },
  });
  assert.equal(updated.title, "已设计完成");
  assert.equal(updated.status, "draft");

  const finalized = lighttask.tasks.move(task.id, {
    action: "finalize",
    expectedRevision: updated.revision,
  });
  assert.equal(finalized.status, "todo");
});

test("Task API：非 draft 任务禁止 updateTask 修改定义字段", () => {
  const { lighttask, planId } = createTestLightTask();
  const task = lighttask.tasks.create({
    planId,
    title: "任务一",
  });
  const finalized = lighttask.tasks.move(task.id, {
    action: "finalize",
    expectedRevision: task.revision,
  });

  assert.throws(
    () =>
      lighttask.tasks.update(task.id, {
        expectedRevision: finalized.revision,
        title: "不应成功",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );
});

test("Task API：updateTask 传入系统字段时直接报校验错误，不静默忽略", () => {
  const { lighttask, planId } = createTestLightTask();
  const task = lighttask.tasks.create({
    planId,
    title: "任务一",
  });

  assert.throws(
    () =>
      lighttask.tasks.update(task.id, {
        expectedRevision: task.revision,
        status: "todo",
      } as never),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "updateTask 不允许直接修改系统字段");
      return true;
    },
  );
});

test("Task API：dispatch/start/request_approval/approve/complete 按终局状态机推进", () => {
  const { lighttask, planId } = createTestLightTask();
  const task = lighttask.tasks.create({
    planId,
    title: "执行任务",
    steps: [
      { id: "s1", title: "分析", stage: "investigate" },
      { id: "s2", title: "实现", stage: "implement" },
    ],
  });
  const todo = lighttask.tasks.move(task.id, {
    action: "finalize",
    expectedRevision: task.revision,
  });
  const dispatched = lighttask.tasks.move(task.id, {
    action: "dispatch",
    expectedRevision: todo.revision,
  });
  assert.equal(dispatched.status, "dispatched");
  assert.deepEqual(
    dispatched.steps.map((step) => step.status),
    ["doing", "todo"],
  );

  const running = lighttask.tasks.move(task.id, {
    action: "start",
    expectedRevision: dispatched.revision,
  });
  assert.equal(running.status, "running");
  assert.deepEqual(
    running.steps.map((step) => step.status),
    ["done", "doing"],
  );

  const waitingApproval = lighttask.tasks.move(task.id, {
    action: "request_approval",
    expectedRevision: running.revision,
  });
  assert.equal(waitingApproval.status, "blocked_by_approval");

  const resumed = lighttask.tasks.move(task.id, {
    action: "approve",
    expectedRevision: waitingApproval.revision,
  });
  const completed = lighttask.tasks.move(task.id, {
    action: "complete",
    expectedRevision: resumed.revision,
  });
  assert.equal(completed.status, "completed");
  assert.deepEqual(
    completed.steps.map((step) => step.status),
    ["done", "done"],
  );
});

test("Task API：todo 可回到 draft，deleteTask 会自动解绑下游依赖", () => {
  const { lighttask, planId } = createTestLightTask();
  const upstream = lighttask.tasks.create({
    planId,
    title: "上游",
  });
  const downstream = lighttask.tasks.create({
    planId,
    title: "下游",
    dependsOnTaskIds: [upstream.id],
  });
  const upstreamTodo = lighttask.tasks.move(upstream.id, {
    action: "finalize",
    expectedRevision: upstream.revision,
  });
  const upstreamDraft = lighttask.tasks.move(upstream.id, {
    action: "return_to_draft",
    expectedRevision: upstreamTodo.revision,
  });
  assert.equal(upstreamDraft.status, "draft");

  const deleted = lighttask.tasks.remove(upstream.id, {
    expectedRevision: upstreamDraft.revision,
  });
  assert.deepEqual(deleted.detachedFromTaskIds, [downstream.id]);
  assert.deepEqual(lighttask.tasks.get(downstream.id)?.dependsOnTaskIds, []);
});

test("Task API：updateTask 允许携带请求级 idempotencyKey", () => {
  const { lighttask, planId } = createTestLightTask();
  const task = lighttask.tasks.create({
    planId,
    title: "草稿任务",
  });

  const updated = lighttask.tasks.update(task.id, {
    expectedRevision: task.revision,
    title: "草稿任务-更新",
    idempotencyKey: "req_update_task_1",
  });

  assert.equal(updated.title, "草稿任务-更新");
  assert.equal(updated.idempotencyKey, "req_update_task_1");
});
