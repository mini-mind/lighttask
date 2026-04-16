import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskGraph, type LightTaskTask, createLightTask } from "../index";
import { createInMemoryTaskRepository } from "../ports/in-memory";
import { createTestLightTaskOptions } from "./ports-fixture";

type ExpectedLightTaskError = {
  code: string;
  message?: string;
  details?: Record<string, unknown>;
};

type TaskRecordFixture = LightTaskTask & {
  lastAdvanceFingerprint?: string;
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

function createLaunchTestLightTask() {
  let nextTaskIndex = 0;

  return createLightTask(
    createTestLightTaskOptions({
      clock: {
        now() {
          return "2026-04-14T00:00:00.000Z";
        },
      },
      idGenerator: {
        nextTaskId() {
          nextTaskIndex += 1;
          return `task_launch_${nextTaskIndex}`;
        },
      },
    }),
  );
}

function createLaunchTaskRef(
  lighttask: ReturnType<typeof createLightTask>,
  title: string,
  planId?: string,
): { id: string; title: string } {
  const task = lighttask.createTask({ title, planId });
  return {
    id: task.id,
    title: task.title,
  };
}

function createReadyPlanWithPublishedGraph(planId: string) {
  const lighttask = createLaunchTestLightTask();
  lighttask.createPlan({
    id: planId,
    title: "发射计划",
    metadata: { owner: { name: "tester" } },
    extensions: {
      properties: { priority: "p1" },
      namespaces: { planner: { lane: "ready" } },
    },
  });
  const task = createLaunchTaskRef(lighttask, "任务一", planId);
  lighttask.advancePlan(planId, { expectedRevision: 1 });
  lighttask.advancePlan(planId, { expectedRevision: 2 });
  lighttask.saveGraph(planId, {
    nodes: [
      {
        id: "node_launch_1",
        taskId: task.id,
        label: "任务一",
        metadata: { lane: { id: "alpha" } },
        extensions: {
          properties: { priority: "p1" },
          namespaces: { planner: { source: "graph" } },
        },
      },
    ],
    edges: [],
    metadata: { channel: { name: "published" } },
    extensions: {
      properties: { scope: "draft" },
      namespaces: { planner: { stage: "draft" } },
    },
  });
  lighttask.publishGraph(planId, {
    expectedRevision: 1,
  });

  return lighttask;
}

function createExpectedMaterializedTaskProvenance(input: {
  graphRevision: number;
  nodeId: string;
  nodeTaskId: string;
  governanceState?: "active" | "orphaned";
  orphanedAtGraphRevision?: number;
}) {
  if (input.governanceState === "orphaned") {
    return {
      kind: "materialized_plan_task" as const,
      source: {
        graphScope: "published" as const,
        graphRevision: input.graphRevision,
        nodeId: input.nodeId,
        nodeTaskId: input.nodeTaskId,
      },
      governance: {
        state: "orphaned" as const,
        orphanedAtGraphRevision: input.orphanedAtGraphRevision,
      },
    };
  }

  return {
    kind: "materialized_plan_task" as const,
    source: {
      graphScope: "published" as const,
      graphRevision: input.graphRevision,
      nodeId: input.nodeId,
      nodeTaskId: input.nodeTaskId,
    },
    governance: {
      state: "active" as const,
    },
  };
}

test("LightTask Launch API 会先收集已发布图中的任务快照再确认计划", () => {
  const lighttask = createReadyPlanWithPublishedGraph("plan_launch_success");

  const result = lighttask.launchPlan("  plan_launch_success  ", {
    expectedRevision: 4,
    expectedPublishedGraphRevision: 1,
  });

  assert.equal(result.plan.id, "plan_launch_success");
  assert.equal(result.plan.status, "confirmed");
  assert.equal(result.plan.revision, 5);
  assert.equal(result.publishedGraph.revision, 1);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, "任务一");
  assert.equal(result.tasks[0].executionStatus, "queued");
  assert.equal(result.tasks[0].extensions, undefined);
  assert.equal(lighttask.getPlan("plan_launch_success")?.status, "confirmed");
  assert.equal(lighttask.listTasksByPlan("plan_launch_success").length, 1);
});

test("LightTask Launch API 在 graph.taskId 已直接指向真实 Task 时优先复用真实任务", () => {
  const lighttask = createLaunchTestLightTask();
  const task = lighttask.createTask({
    title: "真实发射任务",
    planId: "plan_launch_direct_ref",
  });
  lighttask.createPlan({
    id: "plan_launch_direct_ref",
    title: "直接引用发射",
  });
  lighttask.advancePlan("plan_launch_direct_ref", { expectedRevision: 1 });
  lighttask.advancePlan("plan_launch_direct_ref", { expectedRevision: 2 });
  lighttask.saveGraph("plan_launch_direct_ref", {
    nodes: [{ id: "node_launch_direct_ref", taskId: task.id, label: "图侧标签" }],
    edges: [],
  });
  lighttask.publishGraph("plan_launch_direct_ref", {
    expectedRevision: 1,
  });

  const result = lighttask.launchPlan("plan_launch_direct_ref", {
    expectedRevision: 4,
    expectedPublishedGraphRevision: 1,
  });

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].id, task.id);
  assert.equal(result.tasks[0].title, "真实发射任务");
  assert.equal(result.tasks[0].planId, "plan_launch_direct_ref");
  assert.equal(lighttask.listTasksByPlan("plan_launch_direct_ref").length, 1);
});

test("LightTask Launch API 只允许 ready 状态计划发射", () => {
  const draftLightTask = createLaunchTestLightTask();
  draftLightTask.createPlan({
    id: "plan_launch_draft",
    title: "草稿计划",
  });
  expectLightTaskError(
    () =>
      draftLightTask.launchPlan("plan_launch_draft", {
        expectedRevision: 1,
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "STATE_CONFLICT",
      message: "只有 ready 状态的计划可以发射",
      details: {
        planId: "plan_launch_draft",
        currentStatus: "draft",
      },
    },
  );

  const planningLightTask = createLaunchTestLightTask();
  planningLightTask.createPlan({
    id: "plan_launch_planning",
    title: "规划中计划",
  });
  planningLightTask.advancePlan("plan_launch_planning", {
    expectedRevision: 1,
  });
  expectLightTaskError(
    () =>
      planningLightTask.launchPlan("plan_launch_planning", {
        expectedRevision: 2,
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "STATE_CONFLICT",
      message: "只有 ready 状态的计划可以发射",
      details: {
        planId: "plan_launch_planning",
        currentStatus: "planning",
      },
    },
  );

  const confirmedLightTask = createReadyPlanWithPublishedGraph("plan_launch_confirmed");
  confirmedLightTask.launchPlan("plan_launch_confirmed", {
    expectedRevision: 4,
    expectedPublishedGraphRevision: 1,
  });
  expectLightTaskError(
    () =>
      confirmedLightTask.launchPlan("plan_launch_confirmed", {
        expectedRevision: 5,
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "STATE_CONFLICT",
      message: "只有 ready 状态的计划可以发射",
      details: {
        planId: "plan_launch_confirmed",
        currentStatus: "confirmed",
      },
    },
  );
});

test("LightTask Launch API 在已发布图缺失时返回 NOT_FOUND", () => {
  const lighttask = createLaunchTestLightTask();
  lighttask.createPlan({
    id: "plan_launch_missing_published",
    title: "缺失已发布图",
  });
  lighttask.advancePlan("plan_launch_missing_published", { expectedRevision: 1 });
  lighttask.advancePlan("plan_launch_missing_published", { expectedRevision: 2 });

  expectLightTaskError(
    () =>
      lighttask.launchPlan("plan_launch_missing_published", {
        expectedRevision: 3,
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "NOT_FOUND",
      message: "未找到已发布图快照，无法发射计划",
      details: {
        planId: "plan_launch_missing_published",
      },
    },
  );
});

test("LightTask Launch API 在图引用缺失真实 Task 时透传 NOT_FOUND", () => {
  const publishedGraph: LightTaskGraph = {
    nodes: [{ id: "node_launch_missing_task", taskId: "task_launch_missing", label: "缺失任务" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      graphRepository: {
        get(planId, scope) {
          return planId === "plan_launch_missing_task" && scope === "published"
            ? structuredClone(publishedGraph)
            : undefined;
        },
        create() {
          throw new Error("本用例不应写入图仓储");
        },
        saveIfRevisionMatches() {
          throw new Error("本用例不应更新图仓储");
        },
      },
      clock: {
        now() {
          return "2026-04-14T00:00:00.000Z";
        },
      },
      idGenerator: {
        nextTaskId() {
          return "task_launch_unused";
        },
      },
    }),
  );
  lighttask.createPlan({
    id: "plan_launch_missing_task",
    title: "缺失真实任务",
  });
  lighttask.advancePlan("plan_launch_missing_task", { expectedRevision: 1 });
  lighttask.advancePlan("plan_launch_missing_task", { expectedRevision: 2 });

  expectLightTaskError(
    () =>
      lighttask.launchPlan("plan_launch_missing_task", {
        expectedRevision: 3,
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "NOT_FOUND",
      message: "图节点引用的任务不存在，无法发射计划",
      details: {
        planId: "plan_launch_missing_task",
        nodeId: "node_launch_missing_task",
        taskId: "task_launch_missing",
      },
    },
  );
});

test("LightTask Launch API 在图引用未归属当前计划任务时透传 STATE_CONFLICT", () => {
  const taskRepository = createInMemoryTaskRepository<TaskRecordFixture>();
  taskRepository.create({
    id: "task_launch_external_plan",
    title: "外部计划任务",
    planId: "plan_launch_external_owner",
    designStatus: "ready",
    executionStatus: "queued",
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    steps: [
      {
        id: "task_launch_external_plan_investigate",
        title: "investigate",
        stage: "investigate",
        status: "doing",
      },
    ],
  });
  const publishedGraph: LightTaskGraph = {
    nodes: [
      {
        id: "node_launch_cross_plan",
        taskId: "task_launch_external_plan",
        label: "跨计划任务",
      },
    ],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskRepository,
      graphRepository: {
        get(planId, scope) {
          return planId === "plan_launch_cross_plan" && scope === "published"
            ? structuredClone(publishedGraph)
            : undefined;
        },
        create() {
          throw new Error("本用例不应写入图仓储");
        },
        saveIfRevisionMatches() {
          throw new Error("本用例不应更新图仓储");
        },
      },
    }),
  );
  lighttask.createPlan({
    id: "plan_launch_cross_plan",
    title: "跨计划冲突",
  });
  lighttask.advancePlan("plan_launch_cross_plan", { expectedRevision: 1 });
  lighttask.advancePlan("plan_launch_cross_plan", { expectedRevision: 2 });

  expectLightTaskError(
    () =>
      lighttask.launchPlan("plan_launch_cross_plan", {
        expectedRevision: 3,
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "STATE_CONFLICT",
      message: "图节点引用的任务未归属当前计划，无法发射计划",
      details: {
        planId: "plan_launch_cross_plan",
        nodeId: "node_launch_cross_plan",
        taskId: "task_launch_external_plan",
        taskPlanId: "plan_launch_external_owner",
      },
    },
  );
});

test("LightTask Launch API 在计划 revision 不匹配时返回 REVISION_CONFLICT", () => {
  const lighttask = createReadyPlanWithPublishedGraph("plan_launch_plan_revision_conflict");

  expectLightTaskError(
    () =>
      lighttask.launchPlan("plan_launch_plan_revision_conflict", {
        expectedRevision: 3,
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "REVISION_CONFLICT",
      message: "expectedRevision 与当前 revision 不一致",
      details: {
        currentRevision: 4,
        expectedRevision: 3,
      },
    },
  );
  assert.equal(lighttask.getPlan("plan_launch_plan_revision_conflict")?.status, "ready");
  assert.equal(lighttask.listTasksByPlan("plan_launch_plan_revision_conflict").length, 1);
});

test("LightTask Launch API 在已发布图 revision 不匹配时返回 REVISION_CONFLICT", () => {
  const lighttask = createReadyPlanWithPublishedGraph("plan_launch_graph_revision_conflict");

  expectLightTaskError(
    () =>
      lighttask.launchPlan("plan_launch_graph_revision_conflict", {
        expectedRevision: 4,
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
  assert.equal(lighttask.getPlan("plan_launch_graph_revision_conflict")?.status, "ready");
});

test("LightTask Launch API 返回结果与内部计划图任务快照隔离", () => {
  const lighttask = createReadyPlanWithPublishedGraph("plan_launch_snapshot");

  const result = lighttask.launchPlan("plan_launch_snapshot", {
    expectedRevision: 4,
    expectedPublishedGraphRevision: 1,
  });

  result.plan.title = "外部篡改计划";
  assert.ok(result.plan.metadata);
  result.plan.metadata.owner = { name: "mutated" };
  assert.ok(result.plan.extensions);
  result.plan.extensions.properties = { priority: "p9" };

  result.publishedGraph.nodes[0].label = "外部篡改节点";
  assert.ok(result.publishedGraph.metadata);
  result.publishedGraph.metadata.channel = { name: "mutated" };

  result.tasks[0].title = "外部篡改任务";

  const storedPlan = lighttask.getPlan("plan_launch_snapshot");
  const storedPublishedGraph = lighttask.getPublishedGraph("plan_launch_snapshot");
  const storedTasks = lighttask.listTasksByPlan("plan_launch_snapshot");

  assert.ok(storedPlan);
  assert.equal(storedPlan.title, "发射计划");
  assert.deepEqual(storedPlan.metadata, { owner: { name: "tester" } });
  assert.deepEqual(storedPlan.extensions, {
    properties: { priority: "p1" },
    namespaces: { planner: { lane: "ready" } },
  });

  assert.ok(storedPublishedGraph);
  assert.equal(storedPublishedGraph.nodes[0].label, "任务一");
  assert.deepEqual(storedPublishedGraph.metadata, { channel: { name: "published" } });

  assert.equal(storedTasks.length, 1);
});

test("LightTask Launch API 不会在发射期间治理已移除节点任务", () => {
  const lighttask = createLaunchTestLightTask();
  const taskA = createLaunchTaskRef(lighttask, "任务 A", "plan_launch_no_task_sync");
  const taskB = createLaunchTaskRef(lighttask, "任务 B", "plan_launch_no_task_sync");
  lighttask.createPlan({
    id: "plan_launch_no_task_sync",
    title: "发射不做任务治理",
  });
  lighttask.advancePlan("plan_launch_no_task_sync", { expectedRevision: 1 });
  lighttask.advancePlan("plan_launch_no_task_sync", { expectedRevision: 2 });
  lighttask.saveGraph("plan_launch_no_task_sync", {
    nodes: [
      { id: "node_a", taskId: taskA.id, label: "任务 A" },
      { id: "node_b", taskId: taskB.id, label: "任务 B" },
    ],
    edges: [],
  });
  lighttask.publishGraph("plan_launch_no_task_sync", {
    expectedRevision: 1,
  });
  lighttask.materializePlanTasks("plan_launch_no_task_sync", {
    expectedPublishedGraphRevision: 1,
    removedNodePolicy: "keep",
  });
  lighttask.saveGraph("plan_launch_no_task_sync", {
    expectedRevision: 1,
    nodes: [{ id: "node_a", taskId: taskA.id, label: "任务 A" }],
    edges: [],
  });
  lighttask.publishGraph("plan_launch_no_task_sync", {
    expectedRevision: 2,
  });

  const result = lighttask.launchPlan("plan_launch_no_task_sync", {
    expectedRevision: 5,
    expectedPublishedGraphRevision: 2,
  });
  const listed = lighttask.listTasksByPlan("plan_launch_no_task_sync");
  const listedWithOrphaned = lighttask.listTasksByPlan("plan_launch_no_task_sync", {
    includeOrphaned: true,
  });

  assert.equal(result.plan.status, "confirmed");
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, "任务 A");
  assert.equal(listed.length, 2);
  assert.equal(listedWithOrphaned.length, 2);
  assert.equal(
    listed.some((task) => task.title === "任务 B"),
    true,
  );
  assert.equal(
    listedWithOrphaned.some((task) => task.title === "任务 B"),
    true,
  );
  assert.deepEqual(
    listedWithOrphaned.find((task) => task.title === "任务 B")?.extensions?.namespaces?.lighttask,
    createExpectedMaterializedTaskProvenance({
      graphRevision: 1,
      nodeId: "node_b",
      nodeTaskId: taskB.id,
    }),
  );
});
