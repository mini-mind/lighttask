import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskGraph, createLightTask } from "../index";
import { assertInvalidDependencyCases, createTestLightTaskOptions } from "./ports-fixture";

type ExpectedLightTaskError = {
  code: string;
  message?: string;
  details?: Record<string, unknown>;
  verify?: (error: LightTaskError) => void;
};

// 仅在本文件内复用错误断言，避免把局部测试模式扩散成跨文件 DSL。
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

      expected.verify?.(error);
      return true;
    },
    message,
  );
}

function expectInvariantViolationFromTypeError(
  action: () => unknown,
  message?: string,
  verify?: (error: LightTaskError) => void,
): void {
  expectLightTaskError(action, {
    code: "INVARIANT_VIOLATION",
    message,
    details: {
      originalErrorName: "TypeError",
    },
    verify,
  });
}

test("LightTask Graph API 查询不存在图快照时返回 undefined", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_empty",
    title: "空图计划",
  });

  assert.equal(lighttask.getGraph("plan_graph_empty"), undefined);
});

test("LightTask Graph API 查询不存在已发布图快照时返回 undefined", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_published_empty",
    title: "空发布图计划",
  });

  assert.equal(lighttask.getPublishedGraph("plan_graph_published_empty"), undefined);
});

test("LightTask Graph API 在计划不存在但图快照存在时返回 NOT_FOUND", () => {
  const orphanGraph: LightTaskGraph = {
    nodes: [{ id: "node_orphan", taskId: "task_orphan", label: "孤儿任务" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get(planId) {
        return planId === "plan_orphan" ? structuredClone(orphanGraph) : undefined;
      },
      create() {
        return {
          ok: true as const,
          graph: structuredClone(orphanGraph),
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          graph: structuredClone(orphanGraph),
        };
      },
    },
  });

  expectLightTaskError(() => lighttask.getGraph("plan_orphan"), {
    code: "NOT_FOUND",
    message: "未找到计划，无法读取图快照",
    details: {
      planId: "plan_orphan",
    },
  });
});

test("LightTask Graph API 在计划不存在但已发布图快照存在时返回 NOT_FOUND", () => {
  const orphanGraph: LightTaskGraph = {
    nodes: [{ id: "node_orphan_published", taskId: "task_orphan", label: "孤儿已发布任务" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get(planId, scope) {
        return planId === "plan_orphan_published" && scope === "published"
          ? structuredClone(orphanGraph)
          : undefined;
      },
      create() {
        return {
          ok: true as const,
          graph: structuredClone(orphanGraph),
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          graph: structuredClone(orphanGraph),
        };
      },
    },
  });

  expectLightTaskError(() => lighttask.getPublishedGraph("plan_orphan_published"), {
    code: "NOT_FOUND",
    message: "未找到计划，无法读取已发布图快照",
    details: {
      planId: "plan_orphan_published",
    },
  });
});

test("LightTask Graph API 查询时会标准化 planId", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_trim",
    title: "图查询标准化",
  });
  lighttask.saveGraph("plan_graph_trim", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });

  const stored = lighttask.getGraph("  plan_graph_trim  ");
  assert.ok(stored);
  assert.equal(stored.revision, 1);
});

test("LightTask Graph API 查询已发布图时会标准化 planId", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_published_trim",
    title: "已发布图查询标准化",
  });
  lighttask.saveGraph("plan_graph_published_trim", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });
  lighttask.publishGraph("plan_graph_published_trim", {
    expectedRevision: 1,
  });

  const stored = lighttask.getPublishedGraph("  plan_graph_published_trim  ");
  assert.ok(stored);
  assert.equal(stored.revision, 1);
});

test("LightTask Graph API 查询空白 planId 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  expectLightTaskError(() => lighttask.getGraph("   "), {
    code: "VALIDATION_ERROR",
    message: "计划 ID 不能为空",
    details: {
      planId: "   ",
    },
  });
});

test("LightTask Graph API 查询已发布图时空白 planId 会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  expectLightTaskError(() => lighttask.getPublishedGraph("   "), {
    code: "VALIDATION_ERROR",
    message: "计划 ID 不能为空",
    details: {
      planId: "   ",
    },
  });
});

test("LightTask Graph API 保存时会标准化 planId", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_save_trim",
    title: "图写入标准化",
  });

  const graph = lighttask.saveGraph("  plan_graph_save_trim  ", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });

  assert.equal(graph.revision, 1);
  assert.equal(lighttask.getGraph("plan_graph_save_trim")?.revision, 1);
});

test("LightTask Graph API 保存空白 planId 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  expectLightTaskError(
    () =>
      lighttask.saveGraph("   ", {
        nodes: [],
        edges: [],
      }),
    {
      code: "VALIDATION_ERROR",
      message: "计划 ID 不能为空",
      details: {
        planId: "   ",
      },
    },
  );
});

test("LightTask Graph API 支持创建并读取图快照", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_create",
    title: "图快照创建",
  });

  const graph = lighttask.saveGraph("plan_graph_create", {
    nodes: [
      { id: "node_1", taskId: "task_1", label: "任务一" },
      { id: "node_2", taskId: "task_2", label: "任务二" },
    ],
    edges: [{ id: "edge_1", fromNodeId: "node_2", toNodeId: "node_1", kind: "depends_on" }],
  });

  assert.equal(graph.revision, 1);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);

  const stored = lighttask.getGraph("plan_graph_create");
  assert.ok(stored);
  assert.equal(stored.revision, 1);
  assert.equal(stored.nodes.length, 2);
});

test("LightTask Graph API 支持按 expectedRevision 更新图快照", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_update",
    title: "图快照更新",
  });

  lighttask.saveGraph("plan_graph_update", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });

  const updated = lighttask.saveGraph("plan_graph_update", {
    expectedRevision: 1,
    nodes: [
      { id: "node_1", taskId: "task_1", label: "任务一" },
      { id: "node_2", taskId: "task_2", label: "任务二" },
    ],
    edges: [{ id: "edge_1", fromNodeId: "node_2", toNodeId: "node_1", kind: "depends_on" }],
  });

  assert.equal(updated.revision, 2);
  assert.equal(updated.nodes.length, 2);
});

test("LightTask Graph API 支持发布草稿图并读取已发布图", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_publish",
    title: "图草稿发布",
  });

  lighttask.saveGraph("plan_graph_publish", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "草稿任务" }],
    edges: [],
  });

  const published = lighttask.publishGraph("plan_graph_publish", {
    expectedRevision: 1,
  });

  assert.equal(published.revision, 1);
  assert.equal(published.nodes[0].label, "草稿任务");

  const storedDraft = lighttask.getGraph("plan_graph_publish");
  const storedPublished = lighttask.getPublishedGraph("plan_graph_publish");
  assert.ok(storedDraft);
  assert.ok(storedPublished);
  assert.equal(storedDraft.revision, 1);
  assert.equal(storedPublished.revision, 1);
  assert.equal(storedPublished.nodes[0].label, "草稿任务");
});

test("LightTask Graph API 发布后草稿与已发布语义保持隔离，直到再次发布才刷新", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_publish_boundary",
    title: "图发布边界",
  });

  lighttask.saveGraph("plan_graph_publish_boundary", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "草稿 v1" }],
    edges: [],
  });
  lighttask.publishGraph("plan_graph_publish_boundary", {
    expectedRevision: 1,
  });

  lighttask.saveGraph("plan_graph_publish_boundary", {
    expectedRevision: 1,
    nodes: [{ id: "node_1", taskId: "task_1", label: "草稿 v2" }],
    edges: [],
  });

  const draftAfterUpdate = lighttask.getGraph("plan_graph_publish_boundary");
  const publishedBeforeRepublish = lighttask.getPublishedGraph("plan_graph_publish_boundary");
  assert.ok(draftAfterUpdate);
  assert.ok(publishedBeforeRepublish);
  assert.equal(draftAfterUpdate.revision, 2);
  assert.equal(draftAfterUpdate.nodes[0].label, "草稿 v2");
  assert.equal(publishedBeforeRepublish.revision, 1);
  assert.equal(publishedBeforeRepublish.nodes[0].label, "草稿 v1");

  const republished = lighttask.publishGraph("plan_graph_publish_boundary", {
    expectedRevision: 2,
  });
  assert.equal(republished.revision, 2);
  assert.equal(republished.nodes[0].label, "草稿 v2");
});

test("LightTask Graph API 会标准化并持久化 idempotencyKey", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_idempotency",
    title: "图幂等键",
  });

  const created = lighttask.saveGraph("plan_graph_idempotency", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
    idempotencyKey: " idem_graph_create ",
  });
  assert.equal(created.idempotencyKey, "idem_graph_create");

  const updated = lighttask.saveGraph("plan_graph_idempotency", {
    expectedRevision: 1,
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
    idempotencyKey: " idem_graph_update ",
  });
  assert.equal(updated.idempotencyKey, "idem_graph_update");

  const stored = lighttask.getGraph("plan_graph_idempotency");
  assert.ok(stored);
  assert.equal(stored.idempotencyKey, "idem_graph_update");
});

test("LightTask Graph API 会把空白 idempotencyKey 视为未提供", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_blank_idempotency",
    title: "图空白幂等键",
  });

  const graph = lighttask.saveGraph("plan_graph_blank_idempotency", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
    idempotencyKey: "   ",
  });

  assert.equal(graph.idempotencyKey, undefined);
  assert.equal(lighttask.getGraph("plan_graph_blank_idempotency")?.idempotencyKey, undefined);
});

test("LightTask Graph API 在 expectedRevision 冲突时会拒绝覆盖已有图快照", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_revision_conflict",
    title: "图 revision 冲突",
  });
  lighttask.saveGraph("plan_graph_revision_conflict", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_graph_revision_conflict", {
        expectedRevision: 2,
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [],
      }),
    {
      code: "REVISION_CONFLICT",
      message: "expectedRevision 与当前 revision 不一致",
      details: {
        expectedRevision: 2,
        currentRevision: 1,
      },
    },
  );
});

test("LightTask Graph API 在读取后图被并发删除时返回 NOT_FOUND", () => {
  const persistedGraph: LightTaskGraph = {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  let graphDeletedAfterRead = false;
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get(planId) {
        if (planId !== "plan_graph_deleted") {
          return undefined;
        }
        graphDeletedAfterRead = true;
        return structuredClone(persistedGraph);
      },
      create() {
        return {
          ok: true as const,
          graph: structuredClone(persistedGraph),
        };
      },
      saveIfRevisionMatches(planId) {
        assert.equal(planId, "plan_graph_deleted");
        assert.equal(graphDeletedAfterRead, true);
        return {
          ok: false as const,
          error: {
            code: "NOT_FOUND" as const,
            message: "计划图不存在，无法保存变更",
            details: { planId },
          },
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_deleted",
    title: "图并发删除",
  });

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_graph_deleted", {
        expectedRevision: 1,
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [],
      }),
    {
      code: "NOT_FOUND",
      message: "计划图不存在，无法保存变更",
      details: {
        planId: "plan_graph_deleted",
      },
    },
  );
});

test("LightTask Graph API 发布图时会标准化 planId", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_publish_trim",
    title: "图发布标准化",
  });
  lighttask.saveGraph("plan_graph_publish_trim", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });

  const published = lighttask.publishGraph("  plan_graph_publish_trim  ", {
    expectedRevision: 1,
  });

  assert.equal(published.revision, 1);
  assert.equal(lighttask.getPublishedGraph("plan_graph_publish_trim")?.revision, 1);
});

test("LightTask Graph API 发布图时空白 planId 会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  expectLightTaskError(
    () =>
      lighttask.publishGraph("   ", {
        expectedRevision: 1,
      }),
    {
      code: "VALIDATION_ERROR",
      message: "计划 ID 不能为空",
      details: {
        planId: "   ",
      },
    },
  );
});

test("LightTask Graph API 发布图前要求计划已存在", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  expectLightTaskError(
    () =>
      lighttask.publishGraph("plan_publish_missing", {
        expectedRevision: 1,
      }),
    {
      code: "NOT_FOUND",
      message: "未找到计划，无法发布图快照",
      details: {
        planId: "plan_publish_missing",
      },
    },
  );
});

test("LightTask Graph API 发布图前要求草稿图已存在", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_publish_without_draft",
    title: "无草稿不可发布",
  });

  expectLightTaskError(
    () =>
      lighttask.publishGraph("plan_publish_without_draft", {
        expectedRevision: 1,
      }),
    {
      code: "NOT_FOUND",
      message: "未找到图草稿，无法发布图快照",
      details: {
        planId: "plan_publish_without_draft",
      },
    },
  );
});

test("LightTask Graph API 发布图时 expectedRevision 为必填字段", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_publish_need_revision",
    title: "发布 revision 必填",
  });
  lighttask.saveGraph("plan_publish_need_revision", {
    nodes: [],
    edges: [],
  });

  expectLightTaskError(
    () =>
      lighttask.publishGraph("plan_publish_need_revision", {
        expectedRevision: undefined as never,
      }),
    {
      code: "VALIDATION_ERROR",
      message: "expectedRevision 必须是大于等于 1 的整数",
    },
  );
});

test("LightTask Graph API 发布图时 expectedRevision 与草稿 revision 不一致会抛冲突错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_publish_revision_conflict",
    title: "发布 revision 冲突",
  });
  lighttask.saveGraph("plan_publish_revision_conflict", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });

  expectLightTaskError(
    () =>
      lighttask.publishGraph("plan_publish_revision_conflict", {
        expectedRevision: 2,
      }),
    {
      code: "REVISION_CONFLICT",
      message: "expectedRevision 与当前 revision 不一致",
      details: {
        expectedRevision: 2,
        currentRevision: 1,
      },
    },
  );
});

test("LightTask Graph API 保存图快照前要求计划已存在", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_missing", {
        nodes: [],
        edges: [],
      }),
    {
      code: "NOT_FOUND",
      message: "未找到计划，无法保存图快照",
      details: {
        planId: "plan_missing",
      },
    },
  );
});

test("LightTask Graph API 保存图快照时不应重复探测 plan 与 graph", () => {
  let getPlanCallCount = 0;
  let getGraphCallCount = 0;
  let storedGraph: LightTaskGraph | undefined;
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    planRepository: {
      get(planId: string) {
        getPlanCallCount += 1;
        return planId === "plan_graph_single_read"
          ? {
              id: "plan_graph_single_read",
              title: "单次读取校验",
              status: "draft",
              revision: 1,
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z",
            }
          : undefined;
      },
      create() {
        throw new Error("本用例不应触达 plan create");
      },
    },
    graphRepository: {
      get(planId: string) {
        getGraphCallCount += 1;
        return planId === "plan_graph_single_read" && storedGraph
          ? structuredClone(storedGraph)
          : undefined;
      },
      create(planId: string, graph: LightTaskGraph) {
        assert.equal(planId, "plan_graph_single_read");
        storedGraph = structuredClone(graph);
        return {
          ok: true as const,
          graph: structuredClone(graph),
        };
      },
      saveIfRevisionMatches(planId: string, graph: LightTaskGraph, expectedRevision: number) {
        assert.equal(planId, "plan_graph_single_read");
        assert.ok(storedGraph);
        assert.equal(expectedRevision, storedGraph.revision);
        storedGraph = structuredClone(graph);
        return {
          ok: true as const,
          graph: structuredClone(graph),
        };
      },
    },
  });

  lighttask.saveGraph("plan_graph_single_read", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });
  lighttask.saveGraph("plan_graph_single_read", {
    expectedRevision: 1,
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });

  assert.equal(getPlanCallCount, 2);
  assert.equal(getGraphCallCount, 2);
});

test("LightTask Graph API 在计划不存在且图输入非法时优先返回 NOT_FOUND", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_missing", {
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [
          { id: "edge_1", fromNodeId: "node_1", toNodeId: "node_missing", kind: "depends_on" },
        ],
      }),
    {
      code: "NOT_FOUND",
      message: "未找到计划，无法保存图快照",
      verify(error) {
        assert.equal("errors" in (error.details ?? {}), false);
      },
    },
  );
});

test("LightTask Graph API 首次保存图快照时不接受 expectedRevision", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_first_revision",
    title: "首次保存 revision 约束",
  });

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_graph_first_revision", {
        expectedRevision: 1,
        nodes: [],
        edges: [],
      }),
    {
      code: "VALIDATION_ERROR",
      message: "首次保存图快照时不应传 expectedRevision",
      details: {
        planId: "plan_graph_first_revision",
      },
    },
  );
});

test("LightTask Graph API 更新图快照时 expectedRevision 为必填字段", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_need_revision",
    title: "更新 revision 必填",
  });
  lighttask.saveGraph("plan_graph_need_revision", {
    nodes: [],
    edges: [],
  });

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_graph_need_revision", {
        nodes: [],
        edges: [],
      }),
    {
      code: "VALIDATION_ERROR",
      message: "更新图快照时 expectedRevision 为必填字段",
      details: {
        planId: "plan_graph_need_revision",
      },
    },
  );
});

test("LightTask Graph API 会拒绝非法 DAG 图结构", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_invalid",
    title: "非法图校验",
  });

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_graph_invalid", {
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [
          { id: "edge_1", fromNodeId: "node_1", toNodeId: "node_missing", kind: "depends_on" },
        ],
      }),
    {
      code: "VALIDATION_ERROR",
      message: "图结构校验失败",
      verify(error) {
        assert.ok(Array.isArray(error.details?.errors));
      },
    },
  );
});

test("LightTask Graph API 返回快照应与内部状态隔离", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_snapshot",
    title: "图快照隔离",
  });

  const graph = lighttask.saveGraph("plan_graph_snapshot", {
    nodes: [
      {
        id: "node_1",
        taskId: "task_1",
        label: "任务一",
        metadata: { rank: 1 },
        extensions: { presentation: { x: 1, y: 2 } },
      },
    ],
    edges: [
      {
        id: "edge_1",
        fromNodeId: "node_1",
        toNodeId: "node_1",
        kind: "relates_to",
        extensions: { properties: { required: true } },
      },
    ],
    metadata: { owner: { name: "tester" } },
    extensions: {
      presentation: { zoom: 1 },
      namespaces: { graphEditor: { lane: "alpha" } },
    },
  });

  graph.nodes[0].label = "外部篡改";
  assert.ok(graph.nodes[0].metadata);
  graph.nodes[0].metadata.rank = 99;
  assert.ok(graph.nodes[0].extensions);
  graph.nodes[0].extensions.presentation = { x: 99, y: 99 };
  assert.ok(graph.edges[0].extensions);
  graph.edges[0].extensions.properties = { required: false };
  assert.ok(graph.metadata);
  graph.metadata.owner = { name: "mutated" };
  assert.ok(graph.extensions);
  graph.extensions.presentation = { zoom: 3 };

  const stored = lighttask.getGraph("plan_graph_snapshot");
  assert.ok(stored);
  assert.equal(stored.nodes[0].label, "任务一");
  assert.deepEqual(stored.nodes[0].metadata, { rank: 1 });
  assert.deepEqual(stored.nodes[0].extensions, { presentation: { x: 1, y: 2 } });
  assert.deepEqual(stored.edges[0].extensions, { properties: { required: true } });
  assert.deepEqual(stored.metadata, { owner: { name: "tester" } });
  assert.deepEqual(stored.extensions, {
    presentation: { zoom: 1 },
    namespaces: { graphEditor: { lane: "alpha" } },
  });
});

test("LightTask Graph API 在端口直接抛出原生异常时会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get() {
        throw new TypeError("图仓储 get 异常");
      },
      create() {
        return {
          ok: true as const,
          graph: {} as LightTaskGraph,
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          graph: {} as LightTaskGraph,
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_error",
    title: "图读取异常",
  });

  expectInvariantViolationFromTypeError(
    () => lighttask.getGraph("plan_graph_error"),
    "图仓储 get 异常",
  );
});

test("LightTask Graph API 在 saveGraph 读取计划时若端口抛原生异常会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    planRepository: {
      get() {
        throw new TypeError("计划仓储 get 异常");
      },
      create() {
        return {
          ok: true as const,
          plan: {} as never,
        };
      },
    },
  });

  expectInvariantViolationFromTypeError(() =>
    lighttask.saveGraph("plan_graph_plan_get_error", {
      nodes: [],
      edges: [],
    }),
  );
});

test("LightTask Graph API 在 saveGraph 读取图快照时若端口抛原生异常会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get() {
        throw new TypeError("图仓储 get 异常");
      },
      create() {
        return {
          ok: true as const,
          graph: {} as LightTaskGraph,
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          graph: {} as LightTaskGraph,
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_preload_error",
    title: "图写前读取异常",
  });

  expectInvariantViolationFromTypeError(() =>
    lighttask.saveGraph("plan_graph_preload_error", {
      nodes: [],
      edges: [],
    }),
  );
});

test("LightTask Graph API 在 save 写路径直接抛出原生异常时会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get() {
        return undefined;
      },
      create() {
        throw new TypeError("图仓储 create 异常");
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          graph: {} as LightTaskGraph,
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_create_error",
    title: "图写路径异常",
  });

  expectInvariantViolationFromTypeError(
    () =>
      lighttask.saveGraph("plan_graph_create_error", {
        nodes: [],
        edges: [],
      }),
    "图仓储 create 异常",
  );
});

test("LightTask Graph API 在首次保存并发冲突导致 create 返回 ok:false 时会透传冲突错误", () => {
  let createCalled = false;
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get() {
        return undefined;
      },
      create(planId) {
        createCalled = true;
        assert.equal(planId, "plan_graph_create_conflict");
        return {
          ok: false as const,
          error: {
            code: "STATE_CONFLICT" as const,
            message: "计划图 ID 已存在，禁止覆盖已有记录",
            details: {
              planId,
            },
          },
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          graph: {} as LightTaskGraph,
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_create_conflict",
    title: "图首次保存并发冲突",
  });

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_graph_create_conflict", {
        nodes: [],
        edges: [],
      }),
    {
      code: "STATE_CONFLICT",
      message: "计划图 ID 已存在，禁止覆盖已有记录",
      details: {
        planId: "plan_graph_create_conflict",
      },
      verify() {
        assert.equal(createCalled, true);
      },
    },
  );
});

test("LightTask Graph API 在 update 写路径 saveIfRevisionMatches 返回 REVISION_CONFLICT 时会显式抛出冲突错误", () => {
  const persistedGraph: LightTaskGraph = {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  let saveCalled = false;
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get(planId) {
        return planId === "plan_graph_update_repo_revision_conflict"
          ? structuredClone(persistedGraph)
          : undefined;
      },
      create() {
        return {
          ok: true as const,
          graph: structuredClone(persistedGraph),
        };
      },
      saveIfRevisionMatches(planId, graph, expectedRevision) {
        saveCalled = true;
        assert.equal(planId, "plan_graph_update_repo_revision_conflict");
        assert.equal(graph.revision, 2);
        assert.equal(expectedRevision, 1);
        return {
          ok: false as const,
          error: {
            code: "REVISION_CONFLICT" as const,
            message: "计划图 revision 冲突，保存被拒绝",
            details: {
              planId,
              expectedRevision,
              actualRevision: 2,
            },
          },
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_update_repo_revision_conflict",
    title: "图更新并发冲突",
  });

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_graph_update_repo_revision_conflict", {
        expectedRevision: 1,
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [],
      }),
    {
      code: "REVISION_CONFLICT",
      details: {
        actualRevision: 2,
      },
      verify() {
        assert.equal(saveCalled, true);
      },
    },
  );
});

test("LightTask Graph API 在 update 写路径 saveIfRevisionMatches 抛原生异常时会归一化为 LightTaskError", () => {
  const persistedGraph: LightTaskGraph = {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get(planId) {
        return planId === "plan_graph_update_error" ? structuredClone(persistedGraph) : undefined;
      },
      create() {
        return {
          ok: true as const,
          graph: structuredClone(persistedGraph),
        };
      },
      saveIfRevisionMatches() {
        throw new TypeError("图仓储 saveIfRevisionMatches 异常");
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_update_error",
    title: "图更新异常",
  });

  expectInvariantViolationFromTypeError(
    () =>
      lighttask.saveGraph("plan_graph_update_error", {
        expectedRevision: 1,
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [],
      }),
    "图仓储 saveIfRevisionMatches 异常",
  );
});

test("LightTask Graph API 在注入坏依赖时会逐项报告缺失 graph 端口函数", () => {
  const invalidOptionsCases = [
    {
      name: "graphRepository.get",
      options: {
        graphRepository: {
          create() {
            return { ok: true as const, graph: {} as LightTaskGraph };
          },
          saveIfRevisionMatches() {
            return { ok: true as const, graph: {} as LightTaskGraph };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.getGraph("plan_missing");
      },
    },
    {
      name: "graphRepository.create",
      options: {
        graphRepository: {
          get() {
            return undefined;
          },
          saveIfRevisionMatches() {
            return { ok: true as const, graph: {} as LightTaskGraph };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createPlan({
          id: "plan_invalid_graph_create_dependency",
          title: "graph create 坏依赖校验",
        });
        lighttask.saveGraph("plan_invalid_graph_create_dependency", {
          nodes: [],
          edges: [],
        });
      },
    },
    {
      name: "graphRepository.create",
      options: {
        graphRepository: {
          get(_planId: string, scope?: "draft" | "published") {
            return scope === "draft"
              ? {
                  nodes: [],
                  edges: [],
                  revision: 1,
                  createdAt: "2026-04-14T00:00:00.000Z",
                  updatedAt: "2026-04-14T00:00:00.000Z",
                }
              : undefined;
          },
          saveIfRevisionMatches() {
            return { ok: true as const, graph: {} as LightTaskGraph };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createPlan({
          id: "plan_invalid_publish_create_dependency",
          title: "publish create 坏依赖校验",
        });
        lighttask.publishGraph("plan_invalid_publish_create_dependency", {
          expectedRevision: 1,
        });
      },
    },
    {
      name: "graphRepository.saveIfRevisionMatches",
      options: {
        graphRepository: {
          get() {
            return {
              nodes: [],
              edges: [],
              revision: 1,
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z",
            };
          },
          create() {
            return { ok: true as const, graph: {} as LightTaskGraph };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createPlan({
          id: "plan_invalid_graph_save_dependency",
          title: "graph save 坏依赖校验",
        });
        lighttask.saveGraph("plan_invalid_graph_save_dependency", {
          expectedRevision: 1,
          nodes: [],
          edges: [],
        });
      },
    },
    {
      name: "graphRepository.saveIfRevisionMatches",
      options: {
        graphRepository: {
          get(_planId: string, scope?: "draft" | "published") {
            return {
              nodes: [],
              edges: [],
              revision: scope === "published" ? 1 : 2,
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z",
            };
          },
          create() {
            return { ok: true as const, graph: {} as LightTaskGraph };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createPlan({
          id: "plan_invalid_publish_save_dependency",
          title: "publish save 坏依赖校验",
        });
        lighttask.publishGraph("plan_invalid_publish_save_dependency", {
          expectedRevision: 2,
        });
      },
    },
  ];

  assertInvalidDependencyCases(invalidOptionsCases);
});

test("LightTask Graph API 在 saveGraph 注入坏依赖时仍会抛出统一校验错误", () => {
  const baseOptions = createTestLightTaskOptions();
  const lighttask = createLightTask({
    ...baseOptions,
    planRepository: {
      ...baseOptions.planRepository,
      get: "invalid-plan-get" as never,
    },
  });

  expectLightTaskError(
    () =>
      lighttask.saveGraph("plan_invalid_probe_dependency", {
        nodes: [],
        edges: [],
      }),
    {
      code: "VALIDATION_ERROR",
      message: "planRepository.get 必须是函数",
      details: {
        path: "planRepository.get",
      },
    },
  );
});

test("LightTask Graph API 走更新路径时不应前置要求 graphRepository.create", () => {
  const persistedGraph: LightTaskGraph = {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
  let createCalled = false;
  let saveCalled = false;

  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get(planId: string) {
        return planId === "plan_graph_update_without_create"
          ? structuredClone(persistedGraph)
          : undefined;
      },
      create() {
        createCalled = true;
        return {
          ok: true as const,
          graph: structuredClone(persistedGraph),
        };
      },
      saveIfRevisionMatches(_planId: string, graph: LightTaskGraph, _expectedRevision: number) {
        saveCalled = true;
        return {
          ok: true as const,
          graph: structuredClone(graph),
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_update_without_create",
    title: "更新路径不前置 create",
  });

  const updated = lighttask.saveGraph("plan_graph_update_without_create", {
    expectedRevision: 1,
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });
  assert.equal(updated.revision, 2);
  assert.equal(createCalled, false);
  assert.equal(saveCalled, true);
});

test("LightTask Graph API 走首次创建路径时不应前置要求 graphRepository.saveIfRevisionMatches", () => {
  let createCalled = false;
  let saveCalled = false;
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    graphRepository: {
      get() {
        return undefined;
      },
      create(_planId: string, graph: LightTaskGraph) {
        createCalled = true;
        return {
          ok: true as const,
          graph: structuredClone(graph),
        };
      },
      saveIfRevisionMatches() {
        saveCalled = true;
        return {
          ok: true as const,
          graph: {} as LightTaskGraph,
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_create_without_save_if",
    title: "首次路径不前置 saveIfRevisionMatches",
  });

  const created = lighttask.saveGraph("plan_graph_create_without_save_if", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });
  assert.equal(created.revision, 1);
  assert.equal(createCalled, true);
  assert.equal(saveCalled, false);
});

test("LightTask Graph API 只要求当前 graph 用例依赖，不前置耦合 task 与 idGenerator", () => {
  let storedGraph: LightTaskGraph | undefined;
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    taskRepository: {},
    planRepository: {
      get(planId: string) {
        return planId === "plan_graph_minimal_repo"
          ? {
              id: "plan_graph_minimal_repo",
              title: "图最小依赖",
              status: "draft",
              revision: 1,
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z",
            }
          : undefined;
      },
      create() {
        throw new Error("本用例不应触达 plan create");
      },
    },
    graphRepository: {
      get(planId: string) {
        return planId === "plan_graph_minimal_repo" && storedGraph
          ? structuredClone(storedGraph)
          : undefined;
      },
      create(planId: string, graph: LightTaskGraph) {
        assert.equal(planId, "plan_graph_minimal_repo");
        storedGraph = structuredClone(graph);
        return {
          ok: true as const,
          graph: structuredClone(graph),
        };
      },
      saveIfRevisionMatches(planId: string, graph: LightTaskGraph, expectedRevision: number) {
        assert.equal(planId, "plan_graph_minimal_repo");
        assert.ok(storedGraph);
        assert.equal(expectedRevision, storedGraph.revision);
        storedGraph = structuredClone(graph);
        return {
          ok: true as const,
          graph: structuredClone(graph),
        };
      },
    },
    idGenerator: {},
  });

  const created = lighttask.saveGraph("plan_graph_minimal_repo", {
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });
  const updated = lighttask.saveGraph("plan_graph_minimal_repo", {
    expectedRevision: 1,
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
    edges: [],
  });

  assert.equal(created.revision, 1);
  assert.equal(updated.revision, 2);
  assert.equal(lighttask.getGraph("plan_graph_minimal_repo")?.revision, 2);
});
