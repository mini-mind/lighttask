import assert from "node:assert/strict";
import test from "node:test";
import { createLightTask } from "../index";
import { createRuntimeLifecyclePolicy } from "../policies";
import {
  DEFAULT_TASK_POLICY_ID,
  createTestLightTask,
  createTestLightTaskOptions,
} from "./adapters-fixture";

test("Runtime API：支持创建、推进和过滤查询", () => {
  const { lighttask } = createTestLightTask();
  const runtime = lighttask.runs.create({
    id: "runtime_1",
    kind: "agent_run",
    title: "执行一次",
    ownerRef: {
      kind: "task",
      id: "task_1",
    },
  });
  assert.equal(runtime.status, "queued");

  const running = lighttask.runs.update(runtime.id, {
    expectedRevision: runtime.revision,
    action: "start",
  });
  assert.equal(running.status, "running");
  assert.deepEqual(
    lighttask.runs
      .list({
        status: "running",
      })
      .map((item) => item.id),
    ["runtime_1"],
  );
});

test("Runtime API：上一次带 key，这一次不带 key 仍应按新请求处理", () => {
  const { lighttask } = createTestLightTask();
  const runtime = lighttask.runs.create({
    id: "runtime_no_key_pollution",
    kind: "agent_run",
    title: "执行一次",
  });
  const running = lighttask.runs.update(runtime.id, {
    expectedRevision: runtime.revision,
    action: "start",
    idempotencyKey: "req_runtime_1",
  });

  const completed = lighttask.runs.update(runtime.id, {
    expectedRevision: running.revision,
    action: "complete",
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.idempotencyKey, undefined);
});

test("Runtime API：支持使用自定义 runtimeLifecycle", () => {
  const runtimeLifecycle = createRuntimeLifecyclePolicy({
    initialStatus: "running",
    transitionTable: {
      queued: {
        start: "running",
      },
      running: {
        cancel: "cancelled",
      },
      completed: {},
      failed: {},
      cancelled: {},
    },
    terminalStatuses: ["completed", "failed", "cancelled"],
    defaultActionPriority: ["cancel"],
  });
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      runtimeLifecycle,
    }),
  );
  lighttask.plans.create({
    id: "plan_runtime_custom",
    title: "计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });

  const runtime = lighttask.runs.create({
    id: "runtime_custom",
    kind: "agent_run",
    title: "自定义运行时",
  });
  assert.equal(runtime.status, "running");

  const cancelled = lighttask.runs.update(runtime.id, {
    expectedRevision: runtime.revision,
  });
  assert.equal(cancelled.status, "cancelled");
});

test("Runtime API：deleteRuntime 只删除运行记录本身", () => {
  const { lighttask } = createTestLightTask();
  const runtime = lighttask.runs.create({
    id: "runtime_to_remove",
    kind: "agent_run",
    title: "待删除运行时",
  });

  const removed = lighttask.runs.remove(runtime.id, {
    expectedRevision: runtime.revision,
  });
  assert.deepEqual(removed, { runtimeId: runtime.id });
  assert.equal(lighttask.runs.get(runtime.id), undefined);
});
