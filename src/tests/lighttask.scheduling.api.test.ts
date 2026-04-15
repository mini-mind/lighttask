import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskTask, createLightTask } from "../index";
import { createInMemoryTaskRepository } from "../ports/in-memory";
import { createTestLightTaskOptions } from "./ports-fixture";

type TaskRecordFixture = LightTaskTask & {
  lastAdvanceFingerprint?: string;
};

type ExpectedLightTaskError = {
  code: string;
  message?: string;
  details?: Record<string, unknown>;
};

function expectLightTaskError(
  action: () => unknown,
  expected: ExpectedLightTaskError,
  message?: string,
): void {
  assert.throws(
    action,
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, expected.code);

      if (expected.message !== undefined) {
        assert.equal(error.coreError.message, expected.message);
      }

      for (const [detailKey, detailValue] of Object.entries(expected.details ?? {})) {
        assert.equal(
          (error.details as Record<string, unknown> | undefined)?.[detailKey],
          detailValue,
        );
      }

      return true;
    },
    message,
  );
}

function createSchedulingTestTaskFixture(input: {
  id: string;
  planId: string;
  nodeId: string;
  nodeTaskId: string;
  status: TaskRecordFixture["status"];
}): TaskRecordFixture {
  return {
    id: input.id,
    planId: input.planId,
    title: `任务 ${input.nodeId}`,
    status: input.status,
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    steps: [],
    extensions: {
      namespaces: {
        lighttask: {
          kind: "materialized_plan_task",
          source: {
            graphScope: "published",
            graphRevision: 1,
            nodeId: input.nodeId,
            nodeTaskId: input.nodeTaskId,
          },
        },
      },
    },
  };
}

test("LightTask Scheduling Facts API 返回稳定顺序、节点分类与显式阻塞原因", () => {
  const taskRepository = createInMemoryTaskRepository<TaskRecordFixture>();
  const seededTasks = [
    createSchedulingTestTaskFixture({
      id: "task_node_a",
      planId: "plan_scheduling_facts",
      nodeId: "node_a",
      nodeTaskId: "graph_task_a",
      status: "completed",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_b",
      planId: "plan_scheduling_facts",
      nodeId: "node_b",
      nodeTaskId: "graph_task_b",
      status: "queued",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_d",
      planId: "plan_scheduling_facts",
      nodeId: "node_d",
      nodeTaskId: "graph_task_d",
      status: "running",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_e",
      planId: "plan_scheduling_facts",
      nodeId: "node_e",
      nodeTaskId: "graph_task_e",
      status: "queued",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_f",
      planId: "plan_scheduling_facts",
      nodeId: "node_f",
      nodeTaskId: "graph_task_f",
      status: "failed",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_g",
      planId: "plan_scheduling_facts",
      nodeId: "node_g",
      nodeTaskId: "graph_task_g",
      status: "queued",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_h",
      planId: "plan_scheduling_facts",
      nodeId: "node_h",
      nodeTaskId: "graph_task_h",
      status: "blocked_by_approval",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_i",
      planId: "plan_scheduling_facts",
      nodeId: "node_i",
      nodeTaskId: "graph_task_i",
      status: "dispatched",
    }),
  ];

  for (const task of seededTasks) {
    const created = taskRepository.create(task);
    assert.equal(created.ok, true);
  }

  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));
  lighttask.createPlan({
    id: "plan_scheduling_facts",
    title: "调度事实",
  });
  lighttask.saveGraph("plan_scheduling_facts", {
    nodes: [
      { id: "node_a", taskId: "graph_task_a", label: "任务 A" },
      { id: "node_b", taskId: "graph_task_b", label: "任务 B" },
      { id: "node_c", taskId: "graph_task_c", label: "任务 C" },
      { id: "node_d", taskId: "graph_task_d", label: "任务 D" },
      { id: "node_e", taskId: "graph_task_e", label: "任务 E" },
      { id: "node_f", taskId: "graph_task_f", label: "任务 F" },
      { id: "node_g", taskId: "graph_task_g", label: "任务 G" },
      { id: "node_h", taskId: "graph_task_h", label: "任务 H" },
      { id: "node_i", taskId: "graph_task_i", label: "任务 I" },
    ],
    edges: [
      { id: "edge_ab", fromNodeId: "node_b", toNodeId: "node_a", kind: "depends_on" },
      { id: "edge_ed", fromNodeId: "node_e", toNodeId: "node_d", kind: "depends_on" },
      { id: "edge_gf", fromNodeId: "node_g", toNodeId: "node_f", kind: "depends_on" },
    ],
  });
  lighttask.publishGraph("plan_scheduling_facts", {
    expectedRevision: 1,
  });

  const beforeTaskCount = lighttask.listTasksByPlan("plan_scheduling_facts").length;
  const facts = lighttask.getPlanSchedulingFacts("  plan_scheduling_facts  ", {
    expectedPublishedGraphRevision: 1,
  });

  assert.equal(facts.planId, "plan_scheduling_facts");
  assert.equal(facts.planStatus, "draft");
  assert.equal(facts.publishedGraphRevision, 1);
  assert.deepEqual(facts.orderedNodeIds, [
    "node_a",
    "node_b",
    "node_c",
    "node_d",
    "node_e",
    "node_f",
    "node_g",
    "node_h",
    "node_i",
  ]);
  assert.deepEqual(facts.readyNodeIds, ["node_b", "node_c", "node_d", "node_h", "node_i"]);
  assert.deepEqual(facts.runnableNodeIds, ["node_b"]);
  assert.deepEqual(facts.blockedNodeIds, [
    "node_c",
    "node_d",
    "node_e",
    "node_g",
    "node_h",
    "node_i",
  ]);
  assert.deepEqual(facts.terminalNodeIds, ["node_a", "node_f"]);
  assert.deepEqual(facts.completedNodeIds, ["node_a"]);

  assert.deepEqual(facts.byNodeId.node_b, {
    nodeId: "node_b",
    graphTaskId: "graph_task_b",
    taskId: "task_node_b",
    taskStatus: "queued",
    isReady: true,
    isRunnable: true,
    isTerminal: false,
    blockReason: undefined,
  });
  assert.deepEqual(facts.byNodeId.node_c, {
    nodeId: "node_c",
    graphTaskId: "graph_task_c",
    taskId: undefined,
    taskStatus: undefined,
    isReady: true,
    isRunnable: false,
    isTerminal: false,
    blockReason: {
      code: "missing_task",
    },
  });
  assert.deepEqual(facts.byNodeId.node_d?.blockReason, {
    code: "task_running",
    taskStatus: "running",
  });
  assert.deepEqual(facts.byNodeId.node_e?.blockReason, {
    code: "waiting_for_prerequisites",
    unmetPrerequisites: [{ nodeId: "node_d", taskStatus: "running" }],
  });
  assert.deepEqual(facts.byNodeId.node_g?.blockReason, {
    code: "waiting_for_prerequisites",
    unmetPrerequisites: [{ nodeId: "node_f", taskStatus: "failed" }],
  });
  assert.deepEqual(facts.byNodeId.node_h?.blockReason, {
    code: "task_blocked_by_approval",
    taskStatus: "blocked_by_approval",
  });
  assert.deepEqual(facts.byNodeId.node_i?.blockReason, {
    code: "task_dispatched",
    taskStatus: "dispatched",
  });
  assert.equal(lighttask.listTasksByPlan("plan_scheduling_facts").length, beforeTaskCount);
});

test("LightTask Scheduling Facts API 在已发布图 revision 不匹配时返回 REVISION_CONFLICT", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_scheduling_revision_conflict",
    title: "revision 冲突",
  });
  lighttask.saveGraph("plan_scheduling_revision_conflict", {
    nodes: [{ id: "node_1", taskId: "graph_task_1", label: "任务一" }],
    edges: [],
  });
  lighttask.publishGraph("plan_scheduling_revision_conflict", {
    expectedRevision: 1,
  });

  expectLightTaskError(
    () =>
      lighttask.getPlanSchedulingFacts("plan_scheduling_revision_conflict", {
        expectedPublishedGraphRevision: 2,
      }),
    {
      code: "REVISION_CONFLICT",
      message: "expectedPublishedGraphRevision 与当前已发布图 revision 不一致",
      details: {
        currentPublishedGraphRevision: 1,
        expectedPublishedGraphRevision: 2,
      },
    },
  );
});

test("LightTask Scheduling Facts API 在已发布图缺失时返回 NOT_FOUND", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_scheduling_missing_graph",
    title: "缺失已发布图",
  });

  expectLightTaskError(
    () =>
      lighttask.getPlanSchedulingFacts("plan_scheduling_missing_graph", {
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "NOT_FOUND",
      message: "未找到已发布图快照，无法计算计划调度事实",
      details: {
        planId: "plan_scheduling_missing_graph",
      },
    },
  );
});
