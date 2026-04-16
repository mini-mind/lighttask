import assert from "node:assert/strict";
import test from "node:test";
import { createLightTask } from "../index";
import { createTestLightTaskOptions } from "./ports-fixture";

test("LightTask Query API 支持任务过滤与软删除默认隐藏", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const taskA = lighttask.createTask({
    title: "任务 A",
    planId: "plan_query_filters",
  });
  const taskB = lighttask.createTask({
    title: "任务 B",
    planId: "plan_query_filters",
  });
  lighttask.createPlan({
    id: "plan_query_filters",
    title: "查询过滤",
  });
  lighttask.saveGraph("plan_query_filters", {
    nodes: [
      { id: "node_a", taskId: taskA.id, label: "任务 A" },
      { id: "node_b", taskId: taskB.id, label: "任务 B" },
    ],
    edges: [],
  });
  lighttask.publishGraph("plan_query_filters", {
    expectedRevision: 1,
  });

  const first = lighttask.materializePlanTasks("plan_query_filters", {
    expectedPublishedGraphRevision: 1,
  });
  const materializedTaskA = first.tasks.find((task) => task.id === taskA.id);
  const materializedTaskB = first.tasks.find((task) => task.id === taskB.id);
  assert.ok(materializedTaskA);
  assert.ok(materializedTaskB);
  lighttask.createTask({
    title: "草稿查询任务",
    designStatus: "draft",
  });
  const dispatched = lighttask.advanceTask(materializedTaskA.id, {
    expectedRevision: materializedTaskA.revision,
  });
  assert.equal(dispatched.executionStatus, "dispatched");

  lighttask.saveGraph("plan_query_filters", {
    expectedRevision: 1,
    nodes: [{ id: "node_a", taskId: taskA.id, label: "任务 A" }],
    edges: [],
  });
  lighttask.publishGraph("plan_query_filters", {
    expectedRevision: 2,
  });
  lighttask.materializePlanTasks("plan_query_filters", {
    expectedPublishedGraphRevision: 2,
  });

  assert.deepEqual(
    lighttask.listTasksByPlan("plan_query_filters").map((task) => task.id),
    [materializedTaskA.id],
  );
  assert.deepEqual(
    lighttask
      .listTasksByPlan("plan_query_filters", { includeOrphaned: true })
      .map((task) => task.id)
      .sort(),
    [materializedTaskA.id, materializedTaskB.id].sort(),
  );
  assert.deepEqual(
    lighttask
      .listTasks({ planId: "plan_query_filters", executionStatus: "dispatched" })
      .map((task) => task.id),
    [materializedTaskA.id],
  );
  assert.deepEqual(
    lighttask.listTasks({ designStatus: "draft" }).map((task) => task.title),
    ["草稿查询任务"],
  );
  assert.deepEqual(
    lighttask
      .listTasks({
        includeOrphaned: true,
        materializedSource: {
          nodeId: "node_b",
          governanceState: "orphaned",
        },
      })
      .map((task) => task.id),
    [materializedTaskB.id],
  );
});

test("LightTask Query API 支持运行时按 kind/status/引用过滤", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createRuntime({
    id: "runtime_query_a",
    kind: "worker",
    title: "运行时 A",
    ownerRef: { kind: "task", id: "task_a" },
    parentRef: { kind: "plan", id: "plan_a" },
    relatedRefs: [{ kind: "task", id: "task_related" }],
  });
  lighttask.createRuntime({
    id: "runtime_query_b",
    kind: "observer",
    title: "运行时 B",
    ownerRef: { kind: "task", id: "task_b" },
  });
  lighttask.advanceRuntime("runtime_query_a", {
    expectedRevision: 1,
  });

  assert.deepEqual(
    lighttask.listRuntimes({ kind: "worker" }).map((runtime) => runtime.id),
    ["runtime_query_a"],
  );
  assert.deepEqual(
    lighttask.listRuntimes({ status: "running" }).map((runtime) => runtime.id),
    ["runtime_query_a"],
  );
  assert.deepEqual(
    lighttask
      .listRuntimes({ ownerRef: { kind: "task", id: "task_a" } })
      .map((runtime) => runtime.id),
    ["runtime_query_a"],
  );
  assert.deepEqual(
    lighttask
      .listRuntimes({ relatedRef: { kind: "task", id: "task_related" } })
      .map((runtime) => runtime.id),
    ["runtime_query_a"],
  );
});

test("LightTask Query API 支持输出按 kind/status/runtimeRef/ownerRef 过滤", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createOutput({
    id: "output_query_a",
    kind: "summary",
    runtimeRef: { kind: "runtime", id: "runtime_a" },
    ownerRef: { kind: "task", id: "task_a" },
  });
  lighttask.createOutput({
    id: "output_query_b",
    kind: "artifact",
    ownerRef: { kind: "task", id: "task_b" },
  });
  lighttask.advanceOutput("output_query_a", {
    expectedRevision: 1,
    status: "sealed",
  });

  assert.deepEqual(
    lighttask.listOutputs({ kind: "summary" }).map((output) => output.id),
    ["output_query_a"],
  );
  assert.deepEqual(
    lighttask.listOutputs({ status: "sealed" }).map((output) => output.id),
    ["output_query_a"],
  );
  assert.deepEqual(
    lighttask
      .listOutputs({ runtimeRef: { kind: "runtime", id: "runtime_a" } })
      .map((output) => output.id),
    ["output_query_a"],
  );
  assert.deepEqual(
    lighttask.listOutputs({ ownerRef: { kind: "task", id: "task_b" } }).map((output) => output.id),
    ["output_query_b"],
  );
});
