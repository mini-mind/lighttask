import assert from "node:assert/strict";
import test from "node:test";
import { createLightTask } from "../index";
import { createRuntimeLifecyclePolicy } from "../rules";
import { createTestLightTask, createTestLightTaskOptions } from "./ports-fixture";

test("Runtime API：支持创建、推进和过滤查询", () => {
  const { lighttask } = createTestLightTask();
  const runtime = lighttask.createRuntime({
    id: "runtime_1",
    kind: "agent_run",
    title: "执行一次",
    ownerRef: {
      kind: "task",
      id: "task_1",
    },
  });
  assert.equal(runtime.status, "queued");

  const running = lighttask.advanceRuntime(runtime.id, {
    expectedRevision: runtime.revision,
    action: "start",
  });
  assert.equal(running.status, "running");
  assert.deepEqual(
    lighttask
      .listRuntimes({
        status: "running",
      })
      .map((item) => item.id),
    ["runtime_1"],
  );
});

test("Runtime API：上一次带 key，这一次不带 key 仍应按新请求处理", () => {
  const { lighttask } = createTestLightTask();
  const runtime = lighttask.createRuntime({
    id: "runtime_no_key_pollution",
    kind: "agent_run",
    title: "执行一次",
  });
  const running = lighttask.advanceRuntime(runtime.id, {
    expectedRevision: runtime.revision,
    action: "start",
    idempotencyKey: "req_runtime_1",
  });

  const completed = lighttask.advanceRuntime(runtime.id, {
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
  lighttask.createPlan({
    id: "plan_runtime_custom",
    title: "计划",
  });

  const runtime = lighttask.createRuntime({
    id: "runtime_custom",
    kind: "agent_run",
    title: "自定义运行时",
  });
  assert.equal(runtime.status, "running");

  const cancelled = lighttask.advanceRuntime(runtime.id, {
    expectedRevision: runtime.revision,
  });
  assert.equal(cancelled.status, "cancelled");
});
