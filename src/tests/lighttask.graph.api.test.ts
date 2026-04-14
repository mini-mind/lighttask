import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedLightGraph } from "../core/types";
import { LightTaskError, createLightTask } from "../index";
import type { GraphRepository } from "../ports";
import { createTestLightTaskOptions } from "./ports-fixture";

test("LightTask Graph API 查询不存在图快照时返回 undefined", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_empty",
    title: "空图计划",
  });

  assert.equal(lighttask.getGraph("plan_graph_empty"), undefined);
});

test("LightTask Graph API 在计划不存在但图快照存在时返回 NOT_FOUND", () => {
  const orphanGraph: PersistedLightGraph = {
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

  assert.throws(
    () => lighttask.getGraph("plan_orphan"),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.coreError.message, "未找到计划，无法读取图快照");
      return true;
    },
  );
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

test("LightTask Graph API 查询空白 planId 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () => lighttask.getGraph("   "),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "计划 ID 不能为空");
      return true;
    },
  );
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

  assert.throws(
    () =>
      lighttask.saveGraph("   ", {
        nodes: [],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "计划 ID 不能为空");
      return true;
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

  assert.throws(
    () =>
      lighttask.saveGraph("plan_graph_revision_conflict", {
        expectedRevision: 2,
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "REVISION_CONFLICT");
      return true;
    },
  );
});

test("LightTask Graph API 在读取后图被并发删除时返回 NOT_FOUND", () => {
  const persistedGraph: PersistedLightGraph = {
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

  assert.throws(
    () =>
      lighttask.saveGraph("plan_graph_deleted", {
        expectedRevision: 1,
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "NOT_FOUND");
      return true;
    },
  );
});

test("LightTask Graph API 保存图快照前要求计划已存在", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.saveGraph("plan_missing", {
        nodes: [],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.coreError.message, "未找到计划，无法保存图快照");
      return true;
    },
  );
});

test("LightTask Graph API 在计划不存在且图输入非法时优先返回 NOT_FOUND", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.saveGraph("plan_missing", {
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [
          { id: "edge_1", fromNodeId: "node_1", toNodeId: "node_missing", kind: "depends_on" },
        ],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.coreError.message, "未找到计划，无法保存图快照");
      assert.equal("errors" in (error.details ?? {}), false);
      return true;
    },
  );
});

test("LightTask Graph API 首次保存图快照时不接受 expectedRevision", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_first_revision",
    title: "首次保存 revision 约束",
  });

  assert.throws(
    () =>
      lighttask.saveGraph("plan_graph_first_revision", {
        expectedRevision: 1,
        nodes: [],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "首次保存图快照时不应传 expectedRevision");
      assert.equal(error.details?.planId, "plan_graph_first_revision");
      return true;
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

  assert.throws(
    () =>
      lighttask.saveGraph("plan_graph_need_revision", {
        nodes: [],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "更新图快照时 expectedRevision 为必填字段");
      assert.equal(error.details?.planId, "plan_graph_need_revision");
      return true;
    },
  );
});

test("LightTask Graph API 会拒绝非法 DAG 图结构", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_graph_invalid",
    title: "非法图校验",
  });

  assert.throws(
    () =>
      lighttask.saveGraph("plan_graph_invalid", {
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [
          { id: "edge_1", fromNodeId: "node_1", toNodeId: "node_missing", kind: "depends_on" },
        ],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "图结构校验失败");
      assert.ok(Array.isArray(error.details?.errors));
      return true;
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
    nodes: [{ id: "node_1", taskId: "task_1", label: "任务一", metadata: { rank: 1 } }],
    edges: [],
  });

  graph.nodes[0].label = "外部篡改";
  assert.ok(graph.nodes[0].metadata);
  graph.nodes[0].metadata.rank = 99;

  const stored = lighttask.getGraph("plan_graph_snapshot");
  assert.ok(stored);
  assert.equal(stored.nodes[0].label, "任务一");
  assert.deepEqual(stored.nodes[0].metadata, { rank: 1 });
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
          graph: {} as PersistedLightGraph,
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          graph: {} as PersistedLightGraph,
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_error",
    title: "图读取异常",
  });

  assert.throws(
    () => lighttask.getGraph("plan_graph_error"),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      return true;
    },
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
          graph: {} as PersistedLightGraph,
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_create_error",
    title: "图写路径异常",
  });

  assert.throws(
    () =>
      lighttask.saveGraph("plan_graph_create_error", {
        nodes: [],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      return true;
    },
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
          graph: {} as PersistedLightGraph,
        };
      },
    },
  });
  lighttask.createPlan({
    id: "plan_graph_create_conflict",
    title: "图首次保存并发冲突",
  });

  assert.throws(
    () =>
      lighttask.saveGraph("plan_graph_create_conflict", {
        nodes: [],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.details?.planId, "plan_graph_create_conflict");
      assert.equal(createCalled, true);
      return true;
    },
  );
});

test("LightTask Graph API 在 update 写路径 saveIfRevisionMatches 返回 REVISION_CONFLICT 时会显式抛出冲突错误", () => {
  const persistedGraph: PersistedLightGraph = {
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

  assert.throws(
    () =>
      lighttask.saveGraph("plan_graph_update_repo_revision_conflict", {
        expectedRevision: 1,
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "REVISION_CONFLICT");
      assert.equal(error.details?.actualRevision, 2);
      assert.equal(saveCalled, true);
      return true;
    },
  );
});

test("LightTask Graph API 在 update 写路径 saveIfRevisionMatches 抛原生异常时会归一化为 LightTaskError", () => {
  const persistedGraph: PersistedLightGraph = {
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

  assert.throws(
    () =>
      lighttask.saveGraph("plan_graph_update_error", {
        expectedRevision: 1,
        nodes: [{ id: "node_1", taskId: "task_1", label: "任务一" }],
        edges: [],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      return true;
    },
  );
});

test("LightTask Graph API 在注入坏依赖时会逐项报告缺失 graph 端口函数", () => {
  const invalidOptionsCases = [
    {
      name: "graphRepository.get",
      options: {
        graphRepository: {
          create() {
            return { ok: true as const, graph: {} as PersistedLightGraph };
          },
          saveIfRevisionMatches() {
            return { ok: true as const, graph: {} as PersistedLightGraph };
          },
        } as unknown as GraphRepository<PersistedLightGraph>,
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
            return { ok: true as const, graph: {} as PersistedLightGraph };
          },
        } as unknown as GraphRepository<PersistedLightGraph>,
      },
    },
    {
      name: "graphRepository.saveIfRevisionMatches",
      options: {
        graphRepository: {
          get() {
            return undefined;
          },
          create() {
            return { ok: true as const, graph: {} as PersistedLightGraph };
          },
        } as unknown as GraphRepository<PersistedLightGraph>,
      },
    },
  ];

  for (const invalidCase of invalidOptionsCases) {
    assert.throws(
      () =>
        createLightTask({
          ...createTestLightTaskOptions(),
          ...invalidCase.options,
        }),
      (error) => {
        assert.ok(error instanceof LightTaskError);
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.equal(error.details?.path, invalidCase.name);
        return true;
      },
      `${invalidCase.name} 缺失时应报对应 path`,
    );
  }
});
