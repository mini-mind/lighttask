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

function createMaterializeTestLightTask(
  overrides: Partial<Parameters<typeof createLightTask>[0]> = {},
) {
  let nextTaskIndex = 0;

  return createLightTask(
    createTestLightTaskOptions({
      clock: overrides.clock ?? {
        now() {
          return "2026-04-14T00:00:00.000Z";
        },
      },
      idGenerator: overrides.idGenerator ?? {
        nextTaskId() {
          nextTaskIndex += 1;
          return `task_materialized_${nextTaskIndex}`;
        },
      },
      ...overrides,
    }),
  );
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

test("LightTask Materialize API 只读取已发布图并按拓扑顺序创建计划任务", () => {
  const requestedScopes: Array<string | undefined> = [];
  const publishedGraph: LightTaskGraph = {
    nodes: [
      { id: "node_a", taskId: "graph_task_a", label: "任务 A" },
      { id: "node_b", taskId: "graph_task_b", label: "任务 B" },
    ],
    edges: [{ id: "edge_1", fromNodeId: "node_a", toNodeId: "node_b", kind: "depends_on" }],
    revision: 3,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createMaterializeTestLightTask({
    graphRepository: {
      get(planId, scope) {
        assert.equal(planId, "plan_materialize_create");
        requestedScopes.push(scope);
        assert.equal(scope, "published");
        return structuredClone(publishedGraph);
      },
      create() {
        throw new Error("本用例不应写入图仓储");
      },
      saveIfRevisionMatches() {
        throw new Error("本用例不应更新图仓储");
      },
    },
  });
  lighttask.createPlan({
    id: "plan_materialize_create",
    title: "物化任务创建",
  });

  const result = lighttask.materializePlanTasks("  plan_materialize_create  ", {
    expectedPublishedGraphRevision: 3,
  });

  assert.deepEqual(requestedScopes, ["published"]);
  assert.equal(result.plan.id, "plan_materialize_create");
  assert.equal(result.publishedGraph.revision, 3);
  assert.deepEqual(
    result.tasks.map((task) => task.title),
    ["任务 B", "任务 A"],
  );
  assert.deepEqual(
    result.tasks.map((task) => task.id),
    ["task_materialized_1", "task_materialized_2"],
  );
  assert.equal(result.tasks[0].id === "graph_task_b", false);
  assert.equal(result.tasks[0].planId, "plan_materialize_create");
  assert.deepEqual(result.tasks[0].extensions?.namespaces?.lighttask, {
    ...createExpectedMaterializedTaskProvenance({
      graphRevision: 3,
      nodeId: "node_b",
      nodeTaskId: "graph_task_b",
    }),
  });
  assert.equal(lighttask.listTasksByPlan("plan_materialize_create").length, 2);
});

test("LightTask Materialize API 重复调用同一已发布 revision 时保持自然幂等", () => {
  const lighttask = createMaterializeTestLightTask();
  lighttask.createPlan({
    id: "plan_materialize_idempotent",
    title: "幂等物化",
  });
  lighttask.saveGraph("plan_materialize_idempotent", {
    nodes: [
      { id: "node_1", taskId: "graph_task_1", label: "任务一" },
      { id: "node_2", taskId: "graph_task_2", label: "任务二" },
    ],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_idempotent", {
    expectedRevision: 1,
  });

  const first = lighttask.materializePlanTasks("plan_materialize_idempotent", {
    expectedPublishedGraphRevision: 1,
    removedNodePolicy: "keep",
  });
  const second = lighttask.materializePlanTasks("plan_materialize_idempotent", {
    expectedPublishedGraphRevision: 1,
    removedNodePolicy: "keep",
  });

  assert.deepEqual(
    second.tasks.map((task) => ({ id: task.id, revision: task.revision })),
    first.tasks.map((task) => ({ id: task.id, revision: task.revision })),
  );
  assert.equal(lighttask.listTasksByPlan("plan_materialize_idempotent").length, 2);
});

test("LightTask Materialize API 在已发布图 revision 不匹配时返回 REVISION_CONFLICT", () => {
  const lighttask = createMaterializeTestLightTask();
  lighttask.createPlan({
    id: "plan_materialize_revision_conflict",
    title: "revision 冲突",
  });
  lighttask.saveGraph("plan_materialize_revision_conflict", {
    nodes: [{ id: "node_1", taskId: "graph_task_1", label: "任务一" }],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_revision_conflict", {
    expectedRevision: 1,
  });

  expectLightTaskError(
    () =>
      lighttask.materializePlanTasks("plan_materialize_revision_conflict", {
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

test("LightTask Materialize API 在已发布图缺失时返回 NOT_FOUND", () => {
  const lighttask = createMaterializeTestLightTask();
  lighttask.createPlan({
    id: "plan_materialize_missing_published",
    title: "缺失已发布图",
  });

  expectLightTaskError(
    () =>
      lighttask.materializePlanTasks("plan_materialize_missing_published", {
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "NOT_FOUND",
      message: "未找到已发布图快照，无法物化计划任务",
      details: {
        planId: "plan_materialize_missing_published",
      },
    },
  );
});

test("LightTask Materialize API 只基于已发布图物化，不受草稿后续修改影响", () => {
  const lighttask = createMaterializeTestLightTask();
  lighttask.createPlan({
    id: "plan_materialize_published_only",
    title: "发布边界物化",
  });
  lighttask.saveGraph("plan_materialize_published_only", {
    nodes: [{ id: "node_1", taskId: "graph_task_1", label: "发布版本" }],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_published_only", {
    expectedRevision: 1,
  });
  lighttask.saveGraph("plan_materialize_published_only", {
    expectedRevision: 1,
    nodes: [{ id: "node_1", taskId: "graph_task_1", label: "草稿版本" }],
    edges: [],
  });

  const result = lighttask.materializePlanTasks("plan_materialize_published_only", {
    expectedPublishedGraphRevision: 1,
  });

  assert.equal(result.tasks[0].title, "发布版本");
  assert.equal(lighttask.getGraph("plan_materialize_published_only")?.nodes[0].label, "草稿版本");
  assert.equal(
    lighttask.getPublishedGraph("plan_materialize_published_only")?.nodes[0].label,
    "发布版本",
  );
});

test("LightTask Materialize API 会结构化同步物化任务且不推进运行态", () => {
  const lighttask = createMaterializeTestLightTask();
  lighttask.createPlan({
    id: "plan_materialize_sync",
    title: "结构同步",
  });
  lighttask.saveGraph("plan_materialize_sync", {
    nodes: [
      {
        id: "node_sync",
        taskId: "graph_task_sync_v1",
        label: "旧标题",
        metadata: { owner: "alpha" },
        extensions: {
          properties: { priority: "p1" },
        },
      },
    ],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_sync", {
    expectedRevision: 1,
  });

  const created = lighttask.materializePlanTasks("plan_materialize_sync", {
    expectedPublishedGraphRevision: 1,
  });
  const advanced = lighttask.advanceTask(created.tasks[0].id, {
    expectedRevision: 1,
  });

  lighttask.saveGraph("plan_materialize_sync", {
    expectedRevision: 1,
    nodes: [
      {
        id: "node_sync",
        taskId: "graph_task_sync_v2",
        label: "新标题",
        metadata: { owner: "beta" },
        extensions: {
          presentation: { badge: "updated" },
        },
      },
    ],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_sync", {
    expectedRevision: 2,
  });

  const synced = lighttask.materializePlanTasks("plan_materialize_sync", {
    expectedPublishedGraphRevision: 2,
  });

  assert.equal(synced.tasks[0].id, created.tasks[0].id);
  assert.equal(synced.tasks[0].title, "新标题");
  assert.equal(synced.tasks[0].status, "dispatched");
  assert.equal(synced.tasks[0].revision, 3);
  assert.equal(synced.tasks[0].steps[0].status, "done");
  assert.equal(synced.tasks[0].steps[1].status, "doing");
  assert.deepEqual(synced.tasks[0].metadata, { owner: "beta" });
  assert.deepEqual(synced.tasks[0].extensions, {
    presentation: { badge: "updated" },
    namespaces: {
      lighttask: {
        ...createExpectedMaterializedTaskProvenance({
          graphRevision: 2,
          nodeId: "node_sync",
          nodeTaskId: "graph_task_sync_v2",
        }),
      },
    },
  });
  assert.equal(advanced.status, "dispatched");
});

test("LightTask Materialize API 只同步图权威字段并保护任务实例字段", () => {
  const taskRepository = createInMemoryTaskRepository<TaskRecordFixture>();
  taskRepository.create({
    id: "task_materialized_seed",
    planId: "plan_materialize_boundary",
    title: "旧标题",
    summary: "旧摘要",
    status: "dispatched",
    revision: 4,
    idempotencyKey: "task_materialized_seed_key",
    createdAt: "2026-04-01T00:00:00.000Z",
    steps: [
      {
        id: "task_materialized_seed_investigate",
        title: "调查",
        stage: "investigate",
        status: "done",
      },
      {
        id: "task_materialized_seed_design",
        title: "设计",
        stage: "design",
        status: "doing",
      },
    ],
    metadata: { owner: "legacy" },
    extensions: {
      properties: { priority: "p9" },
      namespaces: {
        lighttask: {
          ...createExpectedMaterializedTaskProvenance({
            graphRevision: 1,
            nodeId: "node_boundary",
            nodeTaskId: "graph_task_boundary_v1",
          }),
        },
        legacy: { preserved: false },
      },
    },
    lastAdvanceFingerprint: "fingerprint_boundary",
  });
  const lighttask = createMaterializeTestLightTask({
    taskRepository,
  });
  lighttask.createPlan({
    id: "plan_materialize_boundary",
    title: "同步边界",
  });
  lighttask.saveGraph("plan_materialize_boundary", {
    nodes: [
      {
        id: "node_boundary",
        taskId: "graph_task_boundary_v2",
        label: "新标题",
        metadata: { owner: "graph" },
        extensions: {
          properties: { priority: "p1" },
          namespaces: { planner: { source: "published" } },
        },
      },
    ],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_boundary", {
    expectedRevision: 1,
  });

  const result = lighttask.materializePlanTasks("plan_materialize_boundary", {
    expectedPublishedGraphRevision: 1,
    removedNodePolicy: "keep",
  });

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].id, "task_materialized_seed");
  assert.equal(result.tasks[0].title, "新标题");
  assert.equal(result.tasks[0].summary, undefined);
  assert.deepEqual(result.tasks[0].metadata, { owner: "graph" });
  assert.deepEqual(result.tasks[0].extensions, {
    properties: { priority: "p1" },
    namespaces: {
      planner: { source: "published" },
      lighttask: {
        ...createExpectedMaterializedTaskProvenance({
          graphRevision: 1,
          nodeId: "node_boundary",
          nodeTaskId: "graph_task_boundary_v2",
        }),
      },
    },
  });
  assert.equal(result.tasks[0].status, "dispatched");
  assert.equal(result.tasks[0].createdAt, "2026-04-01T00:00:00.000Z");
  assert.equal(result.tasks[0].revision, 5);
  assert.equal(result.tasks[0].idempotencyKey, "task_materialized_seed_key");
  assert.deepEqual(result.tasks[0].steps, [
    {
      id: "task_materialized_seed_investigate",
      title: "调查",
      stage: "investigate",
      status: "done",
    },
    {
      id: "task_materialized_seed_design",
      title: "设计",
      stage: "design",
      status: "doing",
    },
  ]);
});

test("LightTask Materialize API 不删除已从新发布图移除的旧物化任务", () => {
  const lighttask = createMaterializeTestLightTask();
  lighttask.createPlan({
    id: "plan_materialize_no_delete",
    title: "不删除旧任务",
  });
  lighttask.saveGraph("plan_materialize_no_delete", {
    nodes: [
      { id: "node_a", taskId: "graph_task_a", label: "任务 A" },
      { id: "node_b", taskId: "graph_task_b", label: "任务 B" },
    ],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_no_delete", {
    expectedRevision: 1,
  });
  const first = lighttask.materializePlanTasks("plan_materialize_no_delete", {
    expectedPublishedGraphRevision: 1,
    removedNodePolicy: "keep",
  });

  lighttask.saveGraph("plan_materialize_no_delete", {
    expectedRevision: 1,
    nodes: [{ id: "node_a", taskId: "graph_task_a", label: "任务 A" }],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_no_delete", {
    expectedRevision: 2,
  });

  const second = lighttask.materializePlanTasks("plan_materialize_no_delete", {
    expectedPublishedGraphRevision: 2,
    removedNodePolicy: "keep",
  });
  const listed = lighttask.listTasksByPlan("plan_materialize_no_delete");

  assert.equal(second.tasks.length, 1);
  assert.equal(second.tasks[0].id, first.tasks[0].id);
  assert.equal(
    second.tasks.some((task) => task.id === first.tasks[1].id),
    false,
  );
  assert.equal(listed.length, 2);
  assert.equal(
    listed.some((task) => task.id === first.tasks[1].id && task.title === "任务 B"),
    true,
  );
  assert.deepEqual(
    listed.find((task) => task.id === first.tasks[1].id)?.extensions?.namespaces?.lighttask,
    createExpectedMaterializedTaskProvenance({
      graphRevision: 1,
      nodeId: "node_b",
      nodeTaskId: "graph_task_b",
      governanceState: "orphaned",
      orphanedAtGraphRevision: 2,
    }),
  );
});

test("LightTask Materialize API 在节点重新出现时复用旧任务并恢复 active 治理状态", () => {
  const lighttask = createMaterializeTestLightTask();
  lighttask.createPlan({
    id: "plan_materialize_reactivate",
    title: "重新激活旧任务",
  });
  lighttask.saveGraph("plan_materialize_reactivate", {
    nodes: [{ id: "node_a", taskId: "graph_task_a_v1", label: "任务 A" }],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_reactivate", {
    expectedRevision: 1,
  });

  const first = lighttask.materializePlanTasks("plan_materialize_reactivate", {
    expectedPublishedGraphRevision: 1,
  });

  lighttask.saveGraph("plan_materialize_reactivate", {
    expectedRevision: 1,
    nodes: [],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_reactivate", {
    expectedRevision: 2,
  });
  lighttask.materializePlanTasks("plan_materialize_reactivate", {
    expectedPublishedGraphRevision: 2,
    removedNodePolicy: "keep",
  });

  lighttask.saveGraph("plan_materialize_reactivate", {
    expectedRevision: 2,
    nodes: [{ id: "node_a", taskId: "graph_task_a_v2", label: "任务 A 回归" }],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_reactivate", {
    expectedRevision: 3,
  });

  const reactivated = lighttask.materializePlanTasks("plan_materialize_reactivate", {
    expectedPublishedGraphRevision: 3,
    removedNodePolicy: "keep",
  });

  assert.equal(reactivated.tasks.length, 1);
  assert.equal(reactivated.tasks[0].id, first.tasks[0].id);
  assert.equal(reactivated.tasks[0].title, "任务 A 回归");
  assert.deepEqual(reactivated.tasks[0].extensions?.namespaces?.lighttask, {
    ...createExpectedMaterializedTaskProvenance({
      graphRevision: 3,
      nodeId: "node_a",
      nodeTaskId: "graph_task_a_v2",
    }),
  });
  assert.equal(
    lighttask
      .listTasksByPlan("plan_materialize_reactivate")
      .filter((task) => task.id === first.tasks[0].id).length,
    1,
  );
});

test("LightTask Materialize API 不会改写非物化的手工计划任务", () => {
  const taskRepository = createInMemoryTaskRepository<TaskRecordFixture>();
  const seededTask: TaskRecordFixture = {
    id: "task_manual_seed",
    planId: "plan_materialize_manual",
    title: "手工任务",
    summary: "保留原值",
    status: "queued",
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    steps: [
      {
        id: "task_manual_seed_investigate",
        title: "investigate",
        stage: "investigate",
        status: "doing",
      },
    ],
    metadata: { owner: "manual" },
  };
  taskRepository.create(seededTask);
  const lighttask = createMaterializeTestLightTask({
    taskRepository,
  });
  lighttask.createPlan({
    id: "plan_materialize_manual",
    title: "手工任务隔离",
  });
  lighttask.saveGraph("plan_materialize_manual", {
    nodes: [{ id: "node_1", taskId: "graph_task_1", label: "物化任务" }],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_manual", {
    expectedRevision: 1,
  });

  const result = lighttask.materializePlanTasks("plan_materialize_manual", {
    expectedPublishedGraphRevision: 1,
  });
  const listed = lighttask.listTasksByPlan("plan_materialize_manual");
  const manualTask = listed.find((task) => task.id === "task_manual_seed");

  assert.equal(result.tasks.length, 1);
  assert.ok(manualTask);
  assert.equal(manualTask.title, "手工任务");
  assert.equal(manualTask.revision, 1);
  assert.equal(manualTask.summary, "保留原值");
});

test("LightTask Materialize API 对空白 planId、缺失计划与空白节点标签返回错误", () => {
  const lighttask = createMaterializeTestLightTask();

  expectLightTaskError(
    () =>
      lighttask.materializePlanTasks("   ", {
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "VALIDATION_ERROR",
      message: "计划 ID 不能为空",
      details: {
        planId: "   ",
      },
    },
  );

  expectLightTaskError(
    () =>
      lighttask.materializePlanTasks("plan_materialize_missing_plan", {
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "NOT_FOUND",
      message: "未找到计划，无法物化计划任务",
      details: {
        planId: "plan_materialize_missing_plan",
      },
    },
  );

  lighttask.createPlan({
    id: "plan_materialize_blank_label",
    title: "空白节点标签",
  });
  lighttask.saveGraph("plan_materialize_blank_label", {
    nodes: [{ id: "node_blank", taskId: "graph_task_blank", label: "   " }],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_blank_label", {
    expectedRevision: 1,
  });

  expectLightTaskError(
    () =>
      lighttask.materializePlanTasks("plan_materialize_blank_label", {
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "VALIDATION_ERROR",
      message: "已发布图节点标签不能为空，无法物化计划任务",
      details: {
        planId: "plan_materialize_blank_label",
        nodeId: "node_blank",
        label: "   ",
      },
    },
  );
});

test("LightTask Materialize API 仅支持 keep removedNodePolicy", () => {
  const lighttask = createMaterializeTestLightTask();
  lighttask.createPlan({
    id: "plan_materialize_invalid_policy",
    title: "非法治理策略",
  });
  lighttask.saveGraph("plan_materialize_invalid_policy", {
    nodes: [{ id: "node_1", taskId: "graph_task_1", label: "任务一" }],
    edges: [],
  });
  lighttask.publishGraph("plan_materialize_invalid_policy", {
    expectedRevision: 1,
  });

  expectLightTaskError(
    () =>
      lighttask.materializePlanTasks("plan_materialize_invalid_policy", {
        expectedPublishedGraphRevision: 1,
        removedNodePolicy: "archive" as unknown as "keep",
      }),
    {
      code: "VALIDATION_ERROR",
      message: "removedNodePolicy 仅支持 keep",
      details: {
        removedNodePolicy: "archive",
      },
    },
  );
});
