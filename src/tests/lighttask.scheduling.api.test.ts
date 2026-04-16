import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskGraph, type LightTaskTask, createLightTask } from "../index";
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
  designStatus?: TaskRecordFixture["designStatus"];
  executionStatus: TaskRecordFixture["executionStatus"];
  governanceState?: "active" | "orphaned";
  orphanedAtGraphRevision?: number;
}): TaskRecordFixture {
  const governance =
    input.governanceState === "orphaned"
      ? {
          state: "orphaned" as const,
          orphanedAtGraphRevision: input.orphanedAtGraphRevision,
        }
      : {
          state: "active" as const,
        };

  return {
    id: input.id,
    planId: input.planId,
    title: `任务 ${input.nodeId}`,
    designStatus: input.designStatus ?? "ready",
    executionStatus: input.executionStatus,
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
          governance,
        },
      },
    },
  };
}

function createPublishedGraphRepository(planId: string, graph: LightTaskGraph) {
  return {
    get(targetPlanId: string, scope?: string) {
      return targetPlanId === planId && scope === "published" ? structuredClone(graph) : undefined;
    },
    create() {
      throw new Error("本用例不应写入图仓储");
    },
    saveIfRevisionMatches() {
      throw new Error("本用例不应更新图仓储");
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
      nodeTaskId: "task_node_a",
      executionStatus: "completed",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_b",
      planId: "plan_scheduling_facts",
      nodeId: "node_b",
      nodeTaskId: "task_node_b",
      executionStatus: "queued",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_d",
      planId: "plan_scheduling_facts",
      nodeId: "node_d",
      nodeTaskId: "task_node_d",
      executionStatus: "running",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_e",
      planId: "plan_scheduling_facts",
      nodeId: "node_e",
      nodeTaskId: "task_node_e",
      executionStatus: "queued",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_f",
      planId: "plan_scheduling_facts",
      nodeId: "node_f",
      nodeTaskId: "task_node_f",
      executionStatus: "failed",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_g",
      planId: "plan_scheduling_facts",
      nodeId: "node_g",
      nodeTaskId: "task_node_g",
      executionStatus: "queued",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_h",
      planId: "plan_scheduling_facts",
      nodeId: "node_h",
      nodeTaskId: "task_node_h",
      executionStatus: "blocked_by_approval",
    }),
    createSchedulingTestTaskFixture({
      id: "task_node_i",
      planId: "plan_scheduling_facts",
      nodeId: "node_i",
      nodeTaskId: "task_node_i",
      executionStatus: "dispatched",
    }),
  ];

  for (const task of seededTasks) {
    const created = taskRepository.create(task);
    assert.equal(created.ok, true);
  }

  const publishedGraph: LightTaskGraph = {
    nodes: [
      { id: "node_a", taskId: "task_node_a", label: "任务 A" },
      { id: "node_b", taskId: "task_node_b", label: "任务 B" },
      { id: "node_c", taskId: "graph_task_c", label: "任务 C" },
      { id: "node_d", taskId: "task_node_d", label: "任务 D" },
      { id: "node_e", taskId: "task_node_e", label: "任务 E" },
      { id: "node_f", taskId: "task_node_f", label: "任务 F" },
      { id: "node_g", taskId: "task_node_g", label: "任务 G" },
      { id: "node_h", taskId: "task_node_h", label: "任务 H" },
      { id: "node_i", taskId: "task_node_i", label: "任务 I" },
    ],
    edges: [
      { id: "edge_ab", fromNodeId: "node_b", toNodeId: "node_a", kind: "depends_on" },
      { id: "edge_ed", fromNodeId: "node_e", toNodeId: "node_d", kind: "depends_on" },
      { id: "edge_gf", fromNodeId: "node_g", toNodeId: "node_f", kind: "depends_on" },
    ],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskRepository,
      graphRepository: createPublishedGraphRepository("plan_scheduling_facts", publishedGraph),
    }),
  );
  lighttask.createPlan({
    id: "plan_scheduling_facts",
    title: "调度事实",
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
    graphTaskId: "task_node_b",
    taskId: "task_node_b",
    taskDesignStatus: "ready",
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
    taskDesignStatus: undefined,
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

test("LightTask Scheduling Facts API 会忽略 orphaned 物化任务", () => {
  const taskRepository = createInMemoryTaskRepository<TaskRecordFixture>();
  const created = taskRepository.create(
    createSchedulingTestTaskFixture({
      id: "task_node_orphaned",
      planId: "plan_scheduling_orphaned",
      nodeId: "node_orphaned",
      nodeTaskId: "graph_task_orphaned_v1",
      executionStatus: "completed",
      governanceState: "orphaned",
      orphanedAtGraphRevision: 2,
    }),
  );
  assert.equal(created.ok, true);

  const publishedGraph: LightTaskGraph = {
    nodes: [{ id: "node_orphaned", taskId: "graph_task_orphaned_v2", label: "任务孤儿" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskRepository,
      graphRepository: createPublishedGraphRepository("plan_scheduling_orphaned", publishedGraph),
    }),
  );
  lighttask.createPlan({
    id: "plan_scheduling_orphaned",
    title: "忽略孤儿任务",
  });

  const facts = lighttask.getPlanSchedulingFacts("plan_scheduling_orphaned", {
    expectedPublishedGraphRevision: 1,
  });

  assert.deepEqual(facts.readyNodeIds, ["node_orphaned"]);
  assert.deepEqual(facts.completedNodeIds, []);
  assert.deepEqual(facts.byNodeId.node_orphaned, {
    nodeId: "node_orphaned",
    graphTaskId: "graph_task_orphaned_v2",
    taskId: undefined,
    taskDesignStatus: undefined,
    taskStatus: undefined,
    isReady: true,
    isRunnable: false,
    isTerminal: false,
    blockReason: {
      code: "missing_task",
    },
  });
});

test("LightTask Scheduling Facts API 在已发布图 revision 不匹配时返回 REVISION_CONFLICT", () => {
  const publishedGraph: LightTaskGraph = {
    nodes: [{ id: "node_1", taskId: "graph_task_1", label: "任务一" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      graphRepository: createPublishedGraphRepository(
        "plan_scheduling_revision_conflict",
        publishedGraph,
      ),
    }),
  );
  lighttask.createPlan({
    id: "plan_scheduling_revision_conflict",
    title: "revision 冲突",
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

test("LightTask Scheduling Facts API 会把 designStatus 非 ready 显式表达为调度阻塞", () => {
  const taskRepository = createInMemoryTaskRepository<TaskRecordFixture>();
  const created = taskRepository.create(
    createSchedulingTestTaskFixture({
      id: "task_node_draft",
      planId: "plan_scheduling_design_block",
      nodeId: "node_draft",
      nodeTaskId: "task_node_draft",
      designStatus: "draft",
      executionStatus: "queued",
    }),
  );
  assert.equal(created.ok, true);

  const publishedGraph: LightTaskGraph = {
    nodes: [{ id: "node_draft", taskId: "task_node_draft", label: "草稿任务" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskRepository,
      graphRepository: createPublishedGraphRepository(
        "plan_scheduling_design_block",
        publishedGraph,
      ),
    }),
  );
  lighttask.createPlan({
    id: "plan_scheduling_design_block",
    title: "设计态阻塞",
  });

  const facts = lighttask.getPlanSchedulingFacts("plan_scheduling_design_block", {
    expectedPublishedGraphRevision: 1,
  });

  assert.deepEqual(facts.readyNodeIds, ["node_draft"]);
  assert.deepEqual(facts.runnableNodeIds, []);
  assert.deepEqual(facts.blockedNodeIds, ["node_draft"]);
  assert.deepEqual(facts.byNodeId.node_draft, {
    nodeId: "node_draft",
    graphTaskId: "task_node_draft",
    taskId: "task_node_draft",
    taskDesignStatus: "draft",
    taskStatus: "queued",
    isReady: true,
    isRunnable: false,
    isTerminal: false,
    blockReason: {
      code: "task_design_incomplete",
      taskDesignStatus: "draft",
    },
  });
});

test("LightTask Scheduling Facts API 可直接基于 graph.taskId 命中真实 Task，无需先物化 provenance", () => {
  const taskRepository = createInMemoryTaskRepository<TaskRecordFixture>();
  const created = taskRepository.create({
    id: "task_direct_ref",
    planId: "plan_scheduling_direct_ref",
    title: "直接引用任务",
    designStatus: "ready",
    executionStatus: "queued",
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    steps: [],
  });
  assert.equal(created.ok, true);

  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));
  lighttask.createPlan({
    id: "plan_scheduling_direct_ref",
    title: "直接任务引用",
  });
  lighttask.saveGraph("plan_scheduling_direct_ref", {
    nodes: [{ id: "node_direct_ref", taskId: "task_direct_ref", label: "任务直连" }],
    edges: [],
  });
  lighttask.publishGraph("plan_scheduling_direct_ref", {
    expectedRevision: 1,
  });

  const facts = lighttask.getPlanSchedulingFacts("plan_scheduling_direct_ref", {
    expectedPublishedGraphRevision: 1,
  });

  assert.deepEqual(facts.runnableNodeIds, ["node_direct_ref"]);
  assert.deepEqual(facts.byNodeId.node_direct_ref, {
    nodeId: "node_direct_ref",
    graphTaskId: "task_direct_ref",
    taskId: "task_direct_ref",
    taskDesignStatus: "ready",
    taskStatus: "queued",
    isReady: true,
    isRunnable: true,
    isTerminal: false,
    blockReason: undefined,
  });
});

test("LightTask Scheduling Facts API 会拒绝 graph 引用未归属当前计划的 Task", () => {
  const taskRepository = createInMemoryTaskRepository<TaskRecordFixture>();
  const created = taskRepository.create({
    id: "task_cross_plan_ref",
    planId: "plan_other_owner",
    title: "跨计划任务",
    designStatus: "ready",
    executionStatus: "queued",
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    steps: [],
  });
  assert.equal(created.ok, true);

  const publishedGraph: LightTaskGraph = {
    nodes: [{ id: "node_cross_plan", taskId: "task_cross_plan_ref", label: "跨计划节点" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskRepository,
      graphRepository: createPublishedGraphRepository("plan_scheduling_cross_plan", publishedGraph),
    }),
  );
  lighttask.createPlan({
    id: "plan_scheduling_cross_plan",
    title: "跨计划引用冲突",
  });

  expectLightTaskError(
    () =>
      lighttask.getPlanSchedulingFacts("plan_scheduling_cross_plan", {
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "STATE_CONFLICT",
      message: "图节点引用的任务未归属当前计划",
      details: {
        planId: "plan_scheduling_cross_plan",
        nodeId: "node_cross_plan",
        taskId: "task_cross_plan_ref",
        taskPlanId: "plan_other_owner",
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
