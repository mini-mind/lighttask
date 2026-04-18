import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryTaskRepository } from "../adapters/memory";
import type { PersistedLightTask } from "../api/types";
import { LightTaskError, createLightTask } from "../index";
import {
  DEFAULT_TASK_POLICY_ID,
  createTestLightTask,
  createTestLightTaskOptions,
} from "./adapters-fixture";

test("Scheduling Facts：能区分 draft/runnable/blocked/active/terminal/risk", () => {
  const { lighttask, planId } = createTestLightTask();
  const draft = lighttask.tasks.create({
    planId,
    title: "草稿",
  });
  const runnable = lighttask.tasks.create({
    planId,
    title: "可执行",
  });
  const blocked = lighttask.tasks.create({
    planId,
    title: "被阻塞",
    dependsOnTaskIds: [draft.id],
  });
  const active = lighttask.tasks.create({
    planId,
    title: "进行中",
  });
  const terminal = lighttask.tasks.create({
    planId,
    title: "已完成",
  });

  const runnableTodo = lighttask.tasks.move(runnable.id, {
    action: "finalize",
    expectedRevision: runnable.revision,
  });
  const blockedTodo = lighttask.tasks.move(blocked.id, {
    action: "finalize",
    expectedRevision: blocked.revision,
  });
  const activeTodo = lighttask.tasks.move(active.id, {
    action: "finalize",
    expectedRevision: active.revision,
  });
  const activeDispatched = lighttask.tasks.move(active.id, {
    action: "dispatch",
    expectedRevision: activeTodo.revision,
  });
  const activeRunning = lighttask.tasks.move(active.id, {
    action: "start",
    expectedRevision: activeDispatched.revision,
  });
  const terminalTodo = lighttask.tasks.move(terminal.id, {
    action: "finalize",
    expectedRevision: terminal.revision,
  });
  const terminalDispatched = lighttask.tasks.move(terminal.id, {
    action: "dispatch",
    expectedRevision: terminalTodo.revision,
  });
  const terminalRunning = lighttask.tasks.move(terminal.id, {
    action: "start",
    expectedRevision: terminalDispatched.revision,
  });
  const terminalCompleted = lighttask.tasks.move(terminal.id, {
    action: "complete",
    expectedRevision: terminalRunning.revision,
  });

  assert.equal(runnableTodo.status, "todo");
  assert.equal(blockedTodo.status, "todo");
  assert.equal(activeRunning.status, "running");
  assert.equal(terminalCompleted.status, "completed");

  const facts = lighttask.plans.schedule(planId);
  assert.deepEqual(facts.editableTaskIds, [draft.id]);
  assert.deepEqual(facts.runnableTaskIds, [runnable.id]);
  assert.deepEqual(facts.blockedTaskIds, [blocked.id]);
  assert.deepEqual(facts.activeTaskIds, [active.id]);
  assert.deepEqual(facts.terminalTaskIds, [terminal.id]);
  assert.deepEqual(facts.byTaskId[blocked.id].blockReasonCodes, ["dependency_not_schedulable"]);
});

test("Scheduling Facts：todo 返回 draft 后，已开始下游被标记为风险", () => {
  const taskRepository = createInMemoryTaskRepository<PersistedLightTask>();
  taskRepository.create({
    id: "task_upstream",
    planId: "plan_risk",
    title: "上游",
    status: "draft",
    dependsOnTaskIds: [],
    revision: 3,
    idempotencyKey: "req_upstream",
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:03:00.000Z",
    steps: [],
  });
  taskRepository.create({
    id: "task_downstream",
    planId: "plan_risk",
    title: "下游",
    status: "dispatched",
    dependsOnTaskIds: ["task_upstream"],
    revision: 4,
    idempotencyKey: "req_downstream",
    createdAt: "2026-04-16T00:01:00.000Z",
    updatedAt: "2026-04-16T00:04:00.000Z",
    steps: [],
  });
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskRepository,
    }),
  );
  const planId = "plan_risk";
  lighttask.plans.create({
    id: planId,
    title: "风险计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });
  const facts = lighttask.plans.schedule(planId);
  assert.deepEqual(facts.riskyTaskIds, ["task_downstream"]);
  assert.deepEqual(facts.byTaskId.task_downstream.riskReasonCodes, [
    "upstream_became_not_schedulable",
  ]);
});

test("Scheduling Facts：failed/cancelled/missing 依赖会映射到明确阻塞原因", () => {
  const taskRepository = createInMemoryTaskRepository<PersistedLightTask>();
  taskRepository.create({
    id: "task_failed",
    planId: "plan_blocked",
    title: "失败上游",
    status: "failed",
    dependsOnTaskIds: [],
    revision: 2,
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:01:00.000Z",
    steps: [],
  });
  taskRepository.create({
    id: "task_cancelled",
    planId: "plan_blocked",
    title: "取消上游",
    status: "cancelled",
    dependsOnTaskIds: [],
    revision: 2,
    createdAt: "2026-04-16T00:00:10.000Z",
    updatedAt: "2026-04-16T00:01:10.000Z",
    steps: [],
  });
  taskRepository.create({
    id: "task_wait_failed",
    planId: "plan_blocked",
    title: "等待失败上游",
    status: "todo",
    dependsOnTaskIds: ["task_failed"],
    revision: 1,
    createdAt: "2026-04-16T00:02:00.000Z",
    updatedAt: "2026-04-16T00:02:00.000Z",
    steps: [],
  });
  taskRepository.create({
    id: "task_wait_cancelled",
    planId: "plan_blocked",
    title: "等待取消上游",
    status: "todo",
    dependsOnTaskIds: ["task_cancelled"],
    revision: 1,
    createdAt: "2026-04-16T00:02:10.000Z",
    updatedAt: "2026-04-16T00:02:10.000Z",
    steps: [],
  });
  taskRepository.create({
    id: "task_wait_missing",
    planId: "plan_blocked",
    title: "等待缺失上游",
    status: "todo",
    dependsOnTaskIds: ["task_missing"],
    revision: 1,
    createdAt: "2026-04-16T00:02:20.000Z",
    updatedAt: "2026-04-16T00:02:20.000Z",
    steps: [],
  });
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskRepository,
    }),
  );
  lighttask.plans.create({
    id: "plan_blocked",
    title: "阻塞计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });

  const facts = lighttask.plans.schedule("plan_blocked");
  assert.deepEqual(facts.byTaskId.task_wait_failed.blockReasonCodes, ["dependency_failed"]);
  assert.deepEqual(facts.byTaskId.task_wait_cancelled.blockReasonCodes, ["dependency_cancelled"]);
  assert.deepEqual(facts.byTaskId.task_wait_missing.blockReasonCodes, ["dependency_missing"]);
  assert.deepEqual(facts.byTaskId.task_wait_missing.missingDependencyTaskIds, ["task_missing"]);
});

test("Scheduling Facts：未完成上游会映射为 dependency_not_done", () => {
  const { lighttask, planId } = createTestLightTask("plan_not_done");
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
  const downstreamTodo = lighttask.tasks.move(downstream.id, {
    action: "finalize",
    expectedRevision: downstream.revision,
  });

  const facts = lighttask.plans.schedule(planId);
  assert.equal(upstreamTodo.status, "todo");
  assert.equal(downstreamTodo.status, "todo");
  assert.deepEqual(facts.byTaskId[downstream.id].blockReasonCodes, ["dependency_not_done"]);
  assert.deepEqual(facts.byTaskId[downstream.id].unmetDependencyTaskIds, [upstream.id]);
});

test("Scheduling/Dependency：创建与编辑阶段会拒绝跨 Plan、自依赖和环依赖", () => {
  const { lighttask, planId } = createTestLightTask("plan_dep_a");
  lighttask.plans.create({
    id: "plan_dep_b",
    title: "计划 B",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });
  const taskA = lighttask.tasks.create({
    planId,
    title: "任务 A",
  });
  const taskB = lighttask.tasks.create({
    planId,
    title: "任务 B",
  });
  const taskOtherPlan = lighttask.tasks.create({
    planId: "plan_dep_b",
    title: "任务 C",
  });

  assert.throws(
    () =>
      lighttask.tasks.create({
        planId,
        title: "跨计划创建",
        dependsOnTaskIds: [taskOtherPlan.id],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );

  assert.throws(
    () =>
      lighttask.tasks.update(taskA.id, {
        expectedRevision: taskA.revision,
        dependsOnTaskIds: [taskA.id],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );

  assert.throws(
    () =>
      lighttask.tasks.update(taskA.id, {
        expectedRevision: taskA.revision,
        dependsOnTaskIds: [taskOtherPlan.id],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );

  const taskBLinked = lighttask.tasks.update(taskB.id, {
    expectedRevision: taskB.revision,
    dependsOnTaskIds: [taskA.id],
  });
  assert.deepEqual(taskBLinked.dependsOnTaskIds, [taskA.id]);

  assert.throws(
    () =>
      lighttask.tasks.update(taskA.id, {
        expectedRevision: taskA.revision,
        dependsOnTaskIds: [taskB.id],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );
});
