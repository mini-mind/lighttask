import assert from "node:assert/strict";
import test from "node:test";
import { type LightTaskTask, createLightTask } from "../index";
import {
  createPlanLifecyclePolicy,
  createRuntimeLifecyclePolicy,
  createTaskLifecyclePolicy,
} from "../rules";
import { createTestLightTaskOptions } from "./ports-fixture";

const customTaskLifecycle = createTaskLifecyclePolicy({
  initialStatus: "backlog",
  transitionTable: {
    backlog: {
      activate: "active",
    },
    active: {
      finish: "done",
    },
    done: {},
  },
  terminalStatuses: ["done"],
  defaultActionPriority: ["activate", "finish"],
  stepProgressByAction: {
    activate: "advance_one",
    finish: "complete_all",
  },
});

const customPlanLifecycle = createPlanLifecyclePolicy({
  initialStatus: "outline",
  transitionTable: {
    outline: {
      review: "reviewing",
    },
    reviewing: {
      seal: "sealed",
    },
    sealed: {},
  },
  terminalStatuses: ["sealed"],
  defaultActionPriority: ["review", "seal"],
});

const customRuntimeLifecycle = createRuntimeLifecyclePolicy({
  initialStatus: "waiting_boot",
  transitionTable: {
    waiting_boot: {
      boot: "live",
    },
    live: {
      stop: "closed",
    },
    closed: {},
  },
  terminalStatuses: ["closed"],
  defaultActionPriority: ["boot", "stop"],
});

function createCustomizedLightTask() {
  return createLightTask(
    createTestLightTaskOptions({
      taskLifecycle: customTaskLifecycle,
      planLifecycle: customPlanLifecycle,
      runtimeLifecycle: customRuntimeLifecycle,
      scheduling: {
        isTaskCompleted(task) {
          return task.executionStatus === "done";
        },
        isTaskTerminal(task) {
          return task.executionStatus === "done";
        },
      },
    }),
  );
}

function getRequiredTaskByNodeId(
  tasksByNodeId: ReadonlyMap<string, LightTaskTask>,
  nodeId: string,
) {
  const task = tasksByNodeId.get(nodeId);
  assert.ok(task, `缺少节点 ${nodeId} 对应的任务`);
  return task;
}

test("LightTask Lifecycle API 支持注入自定义任务/计划/运行时生命周期", () => {
  const lighttask = createCustomizedLightTask();

  const task = lighttask.createTask({
    title: "自定义任务状态",
  });
  assert.equal(task.designStatus, "ready");
  assert.equal(task.executionStatus, "backlog");
  assert.equal(task.executionStatus, "backlog");

  const activeTask = lighttask.advanceTask(task.id, {
    expectedRevision: 1,
  });
  assert.equal(activeTask.executionStatus, "active");
  assert.equal(activeTask.executionStatus, "active");
  assert.equal(activeTask.steps[0].status, "done");
  assert.equal(activeTask.steps[1].status, "doing");

  const doneTask = lighttask.advanceTask(task.id, {
    expectedRevision: 2,
  });
  assert.equal(doneTask.executionStatus, "done");
  assert.equal(doneTask.executionStatus, "done");
  assert.ok(doneTask.steps.every((step) => step.status === "done"));

  const plan = lighttask.createPlan({
    id: "plan_custom_lifecycle",
    title: "自定义计划状态",
  });
  assert.equal(plan.status, "outline");
  assert.equal(lighttask.advancePlan(plan.id, { expectedRevision: 1 }).status, "reviewing");
  assert.equal(lighttask.advancePlan(plan.id, { expectedRevision: 2 }).status, "sealed");

  const runtime = lighttask.createRuntime({
    id: "runtime_custom_lifecycle",
    kind: "worker",
    title: "自定义运行时状态",
  });
  assert.equal(runtime.status, "waiting_boot");
  assert.equal(lighttask.advanceRuntime(runtime.id, { expectedRevision: 1 }).status, "live");
  assert.equal(lighttask.advanceRuntime(runtime.id, { expectedRevision: 2 }).status, "closed");
});

test("LightTask Lifecycle API 支持基于自定义完成态与可运行态计算调度事实", () => {
  const lighttask = createCustomizedLightTask();
  lighttask.createPlan({
    id: "plan_custom_scheduling",
    title: "自定义调度状态",
  });
  const seededTaskA = lighttask.createTask({
    title: "任务 A",
    planId: "plan_custom_scheduling",
  });
  const seededTaskB = lighttask.createTask({
    title: "任务 B",
    planId: "plan_custom_scheduling",
  });
  const seededTaskC = lighttask.createTask({
    title: "任务 C",
    planId: "plan_custom_scheduling",
  });
  lighttask.saveGraph("plan_custom_scheduling", {
    nodes: [
      { id: "node_a", taskId: seededTaskA.id, label: "任务 A" },
      { id: "node_b", taskId: seededTaskB.id, label: "任务 B" },
      { id: "node_c", taskId: seededTaskC.id, label: "任务 C" },
    ],
    edges: [{ id: "edge_ab", fromNodeId: "node_b", toNodeId: "node_a", kind: "depends_on" }],
  });
  lighttask.publishGraph("plan_custom_scheduling", {
    expectedRevision: 1,
  });

  const materialized = lighttask.materializePlanTasks("plan_custom_scheduling", {
    expectedPublishedGraphRevision: 1,
  });
  const tasksByNodeId = new Map<string, LightTaskTask>();
  for (const task of materialized.tasks) {
    const provenance = task.extensions?.namespaces?.lighttask as
      | {
          source?: {
            nodeId?: string;
          };
        }
      | undefined;
    const nodeId = provenance?.source?.nodeId;
    assert.ok(nodeId);
    tasksByNodeId.set(nodeId, task);
  }

  const taskA = getRequiredTaskByNodeId(tasksByNodeId, "node_a");
  const doneA = lighttask.advanceTask(taskA.id, {
    expectedRevision: taskA.revision,
    action: "activate",
  });
  lighttask.advanceTask(doneA.id, {
    expectedRevision: doneA.revision,
    action: "finish",
  });

  const taskC = getRequiredTaskByNodeId(tasksByNodeId, "node_c");
  const activeC = lighttask.advanceTask(taskC.id, {
    expectedRevision: taskC.revision,
    action: "activate",
  });
  assert.equal(activeC.executionStatus, "active");

  const facts = lighttask.getPlanSchedulingFacts("plan_custom_scheduling", {
    expectedPublishedGraphRevision: 1,
  });

  assert.deepEqual(facts.completedNodeIds, ["node_a"]);
  assert.deepEqual(facts.runnableNodeIds, ["node_b"]);
  assert.equal(facts.byNodeId.node_a.isTerminal, true);
  assert.equal(facts.byNodeId.node_b.isRunnable, true);
  assert.deepEqual(facts.byNodeId.node_c.blockReason, {
    code: "task_waiting_transition",
    taskStatus: "active",
  });
});
