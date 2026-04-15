import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, createLightTask } from "../index";
import { createTestLightTaskOptions } from "./ports-fixture";

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
  lighttask.advancePlan(planId, { expectedRevision: 1 });
  lighttask.advancePlan(planId, { expectedRevision: 2 });
  lighttask.saveGraph(planId, {
    nodes: [
      {
        id: "node_launch_1",
        taskId: "graph_task_launch_1",
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

test("LightTask Launch API 会先物化已发布图再确认计划", () => {
  const lighttask = createReadyPlanWithPublishedGraph("plan_launch_success");

  const result = lighttask.launchPlan("  plan_launch_success  ", {
    expectedRevision: 3,
    expectedPublishedGraphRevision: 1,
  });

  assert.equal(result.plan.id, "plan_launch_success");
  assert.equal(result.plan.status, "confirmed");
  assert.equal(result.plan.revision, 4);
  assert.equal(result.publishedGraph.revision, 1);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, "任务一");
  assert.equal(result.tasks[0].status, "queued");
  assert.deepEqual(result.tasks[0].extensions?.namespaces?.lighttask, {
    kind: "materialized_plan_task",
    source: {
      graphScope: "published",
      graphRevision: 1,
      nodeId: "node_launch_1",
      nodeTaskId: "graph_task_launch_1",
    },
  });
  assert.equal(lighttask.getPlan("plan_launch_success")?.status, "confirmed");
  assert.equal(lighttask.listTasksByPlan("plan_launch_success").length, 1);
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
    expectedRevision: 3,
    expectedPublishedGraphRevision: 1,
  });
  expectLightTaskError(
    () =>
      confirmedLightTask.launchPlan("plan_launch_confirmed", {
        expectedRevision: 4,
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
      message: "未找到已发布图快照，无法物化计划任务",
      details: {
        planId: "plan_launch_missing_published",
      },
    },
  );
});

test("LightTask Launch API 在计划 revision 不匹配时返回 REVISION_CONFLICT", () => {
  const lighttask = createReadyPlanWithPublishedGraph("plan_launch_plan_revision_conflict");

  expectLightTaskError(
    () =>
      lighttask.launchPlan("plan_launch_plan_revision_conflict", {
        expectedRevision: 4,
        expectedPublishedGraphRevision: 1,
      }),
    {
      code: "REVISION_CONFLICT",
      message: "expectedRevision 与当前 revision 不一致",
      details: {
        currentRevision: 3,
        expectedRevision: 4,
      },
    },
  );
  assert.equal(lighttask.getPlan("plan_launch_plan_revision_conflict")?.status, "ready");
  assert.equal(lighttask.listTasksByPlan("plan_launch_plan_revision_conflict").length, 0);
});

test("LightTask Launch API 在已发布图 revision 不匹配时返回 REVISION_CONFLICT", () => {
  const lighttask = createReadyPlanWithPublishedGraph("plan_launch_graph_revision_conflict");

  expectLightTaskError(
    () =>
      lighttask.launchPlan("plan_launch_graph_revision_conflict", {
        expectedRevision: 3,
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
    expectedRevision: 3,
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
  assert.ok(result.tasks[0].metadata);
  result.tasks[0].metadata.lane = { id: "mutated" };
  assert.ok(result.tasks[0].extensions);
  result.tasks[0].extensions.properties = { priority: "p9" };

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
  assert.equal(storedTasks[0].title, "任务一");
  assert.deepEqual(storedTasks[0].metadata, { lane: { id: "alpha" } });
  assert.deepEqual(storedTasks[0].extensions, {
    properties: { priority: "p1" },
    namespaces: {
      planner: { source: "graph" },
      lighttask: {
        kind: "materialized_plan_task",
        source: {
          graphScope: "published",
          graphRevision: 1,
          nodeId: "node_launch_1",
          nodeTaskId: "graph_task_launch_1",
        },
      },
    },
  });
});
