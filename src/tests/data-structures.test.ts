import assert from "node:assert/strict";
import test from "node:test";
import { createCoreError } from "../data-structures/ds-error";
import { createDomainEvent } from "../data-structures/ds-event";
import { createGraphSnapshot } from "../data-structures/ds-graph";
import { createPlanSessionRecord } from "../data-structures/ds-plan";
import {
  assertRevisionMonotonic,
  bumpRevision,
  createInitialRevision,
} from "../data-structures/ds-revision";
import { isPlanTerminalStatus, isTaskTerminalStatus } from "../data-structures/ds-status";
import { createTaskRecord } from "../data-structures/ds-task";

test("数据结构层：任务与计划记录可按默认规则初始化", () => {
  const now = "2026-04-13T00:00:00.000Z";
  const task = createTaskRecord({
    id: "task_1",
    title: "编排任务",
    createdAt: now,
  });
  const plan = createPlanSessionRecord({
    id: "plan_1",
    title: "规划会话",
    createdAt: now,
  });

  assert.equal(task.status, "queued");
  assert.equal(task.revision, 1);
  assert.equal(plan.status, "draft");
  assert.equal(plan.revision, 1);
});

test("数据结构层：Task/Plan 记录支持 trim、显式状态与扩展字段透传", () => {
  const taskExtensions = {
    properties: { priority: "high" },
    namespaces: { orchestrator: { source: "unit-test" } },
  };
  const planExtensions = {
    presentation: { color: "amber" },
    namespaces: { planner: { lane: "core" } },
  };
  const task = createTaskRecord({
    id: "task_2",
    title: "  任务标题  ",
    summary: "  摘要  ",
    status: "running",
    createdAt: "2026-04-13T00:00:00.000Z",
    metadata: { source: "unit-test" },
    extensions: taskExtensions,
    idempotencyKey: "req_task_1",
  });
  const plan = createPlanSessionRecord({
    id: "plan_2",
    title: "  规划标题  ",
    status: "planning",
    createdAt: "2026-04-13T00:00:00.000Z",
    metadata: { owner: "tester" },
    extensions: planExtensions,
    idempotencyKey: "req_plan_1",
  });

  taskExtensions.properties.priority = "low";
  planExtensions.presentation.color = "blue";

  assert.equal(task.title, "任务标题");
  assert.equal(task.summary, "摘要");
  assert.equal(task.status, "running");
  assert.equal(task.idempotencyKey, "req_task_1");
  assert.deepEqual(task.metadata, { source: "unit-test" });
  assert.deepEqual(task.extensions, {
    properties: { priority: "high" },
    namespaces: { orchestrator: { source: "unit-test" } },
  });
  assert.equal(task.updatedAt, "2026-04-13T00:00:00.000Z");

  assert.equal(plan.title, "规划标题");
  assert.equal(plan.status, "planning");
  assert.equal(plan.idempotencyKey, "req_plan_1");
  assert.deepEqual(plan.metadata, { owner: "tester" });
  assert.deepEqual(plan.extensions, {
    presentation: { color: "amber" },
    namespaces: { planner: { lane: "core" } },
  });
  assert.equal(plan.updatedAt, "2026-04-13T00:00:00.000Z");
});

test("数据结构层：图快照保留节点和依赖边", () => {
  const nodes = [
    { id: "n1", taskId: "t1", label: "任务一" },
    { id: "n2", taskId: "t2", label: "任务二" },
  ];
  const edges = [{ id: "e1", fromNodeId: "n1", toNodeId: "n2", kind: "depends_on" as const }];

  const snapshot = createGraphSnapshot({
    nodes,
    edges,
    createdAt: "2026-04-13T00:00:00.000Z",
  });

  nodes.push({ id: "n3", taskId: "t3", label: "任务三" });
  edges.push({ id: "e2", fromNodeId: "n2", toNodeId: "n3", kind: "depends_on" });

  assert.equal(snapshot.nodes.length, 2);
  assert.equal(snapshot.edges.length, 1);
  assert.equal(snapshot.revision, 1);
});

test("数据结构层：图快照与输入对象隔离，避免引用穿透", () => {
  const nodes = [
    {
      id: "n1",
      taskId: "t1",
      label: "原始标签",
      metadata: { rank: 1 },
      extensions: { presentation: { x: 1, y: 2 } },
    },
  ];
  const edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    kind: "depends_on" | "blocks" | "relates_to";
    metadata: { weight: number };
    extensions: { properties: { required: boolean } };
  }> = [
    {
      id: "e1",
      fromNodeId: "n1",
      toNodeId: "n1",
      kind: "relates_to" as const,
      metadata: { weight: 1 },
      extensions: { properties: { required: true } },
    },
  ];
  const metadata = { source: { name: "tester" } };
  const extensions = {
    presentation: { zoom: 1 },
    namespaces: { graphEditor: { lane: "alpha" } },
  };

  const snapshot = createGraphSnapshot({
    nodes,
    edges,
    metadata,
    extensions,
    createdAt: "2026-04-13T00:00:00.000Z",
  });

  const firstNode = nodes[0];
  const firstEdge = edges[0];
  assert.ok(firstNode.metadata);
  assert.ok(firstEdge.metadata);

  firstNode.label = "外部改写";
  firstNode.metadata.rank = 99;
  assert.ok(firstNode.extensions);
  firstNode.extensions.presentation = { x: 99, y: 99 };
  firstEdge.kind = "depends_on";
  firstEdge.metadata.weight = 99;
  firstEdge.extensions.properties.required = false;
  metadata.source.name = "mutated";
  extensions.presentation.zoom = 3;

  assert.equal(snapshot.nodes[0].label, "原始标签");
  assert.deepEqual(snapshot.nodes[0].metadata, { rank: 1 });
  assert.deepEqual(snapshot.nodes[0].extensions, { presentation: { x: 1, y: 2 } });
  assert.equal(snapshot.edges[0].kind, "relates_to");
  assert.deepEqual(snapshot.edges[0].metadata, { weight: 1 });
  assert.deepEqual(snapshot.edges[0].extensions, { properties: { required: true } });
  assert.deepEqual(snapshot.metadata, { source: { name: "tester" } });
  assert.deepEqual(snapshot.extensions, {
    presentation: { zoom: 1 },
    namespaces: { graphEditor: { lane: "alpha" } },
  });
});

test("数据结构层：图快照支持空图结构", () => {
  const snapshot = createGraphSnapshot({
    nodes: [],
    edges: [],
    createdAt: "2026-04-13T00:00:00.000Z",
  });

  assert.equal(snapshot.nodes.length, 0);
  assert.equal(snapshot.edges.length, 0);
});

test("数据结构层：图快照透传 idempotencyKey", () => {
  const snapshot = createGraphSnapshot({
    nodes: [],
    edges: [],
    createdAt: "2026-04-13T00:00:00.000Z",
    idempotencyKey: "req_graph_1",
  });
  assert.equal(snapshot.idempotencyKey, "req_graph_1");
});

test("数据结构层：事件结构包含版本与修订信息", () => {
  const event = createDomainEvent({
    id: "evt_1",
    type: "task.created",
    aggregate: "task",
    aggregateId: "task_1",
    occurredAt: "2026-04-13T00:00:00.000Z",
    revision: 3,
    payload: { title: "任务" },
  });

  assert.equal(event.version, 1);
  assert.equal(event.revision, 3);
  assert.equal(event.type, "task.created");
  assert.equal(event.aggregate, "task");
  assert.equal(event.aggregateId, "task_1");
  assert.equal(event.occurredAt, "2026-04-13T00:00:00.000Z");
  assert.deepEqual(event.payload, { title: "任务" });
});

test("数据结构层：事件结构支持幂等键透传", () => {
  const event = createDomainEvent({
    id: "evt_2",
    type: "plan.updated",
    aggregate: "plan",
    aggregateId: "plan_1",
    occurredAt: "2026-04-13T00:00:00.000Z",
    revision: 4,
    idempotencyKey: "req_evt_1",
    payload: { revision: 4 },
  });

  assert.equal(event.idempotencyKey, "req_evt_1");
});

test("数据结构层：事件 payload 与输入对象隔离", () => {
  const payload = {
    task: {
      id: "task_3",
      labels: ["alpha"],
    },
  };
  const event = createDomainEvent({
    id: "evt_3",
    type: "task.advanced",
    aggregate: "task",
    aggregateId: "task_3",
    occurredAt: "2026-04-13T00:00:00.000Z",
    revision: 5,
    payload,
  });

  payload.task.id = "task_3_mutated";
  payload.task.labels.push("beta");

  assert.deepEqual(event.payload, {
    task: {
      id: "task_3",
      labels: ["alpha"],
    },
  });
});

test("数据结构层：revision 递增规则可验证", () => {
  const initial = createInitialRevision("2026-04-13T00:00:00.000Z");
  const next = bumpRevision(initial, "2026-04-13T00:01:00.000Z", "req_1");
  assert.equal(initial.revision, 1);
  assert.equal(next.revision, 2);
  assert.equal(next.idempotencyKey, "req_1");
  assert.doesNotThrow(() => assertRevisionMonotonic(initial, next));
});

test("数据结构层：初始 revision 支持透传 idempotencyKey", () => {
  const initial = createInitialRevision("2026-04-13T00:00:00.000Z", "req_rev_1");
  assert.equal(initial.idempotencyKey, "req_rev_1");
});

test("数据结构层：revision 非单调递增时抛出冲突错误", () => {
  assert.throws(
    () =>
      assertRevisionMonotonic(
        { revision: 3, updatedAt: "2026-04-13T00:00:00.000Z" },
        { revision: 3, updatedAt: "2026-04-13T00:01:00.000Z" },
      ),
    /REVISION_CONFLICT/,
  );
});

test("数据结构层：revision 非整数时抛出校验错误", () => {
  assert.throws(
    () =>
      assertRevisionMonotonic(
        { revision: 1.5, updatedAt: "2026-04-13T00:00:00.000Z" },
        { revision: 2, updatedAt: "2026-04-13T00:01:00.000Z" },
      ),
    /VALIDATION_ERROR/,
  );
});

test("数据结构层：终态与错误契约可用", () => {
  assert.equal(isTaskTerminalStatus("completed"), true);
  assert.equal(isTaskTerminalStatus("running"), false);
  assert.equal(isPlanTerminalStatus("archived"), true);
  assert.equal(isPlanTerminalStatus("planning"), false);

  const error = createCoreError("STATE_CONFLICT", "状态冲突", {
    current: "running",
    expected: "queued",
  });
  assert.equal(error.code, "STATE_CONFLICT");
  assert.equal(error.message, "状态冲突");
});

test("数据结构层：终态判定覆盖所有状态枚举", () => {
  const taskStatuses = [
    "queued",
    "dispatched",
    "running",
    "completed",
    "failed",
    "cancelled",
    "blocked_by_approval",
  ] as const;
  const planStatuses = ["draft", "planning", "ready", "confirmed", "archived", "failed"] as const;

  const taskTerminal = taskStatuses.filter((status) => isTaskTerminalStatus(status));
  const planTerminal = planStatuses.filter((status) => isPlanTerminalStatus(status));

  assert.deepEqual(taskTerminal, ["completed", "failed", "cancelled"]);
  assert.deepEqual(planTerminal, ["archived", "failed"]);
});

test("数据结构层：错误契约支持 details 缺省与透传", () => {
  const withDetails = createCoreError("VALIDATION_ERROR", "参数错误", {
    field: "title",
  });
  const withoutDetails = createCoreError("NOT_FOUND", "未找到");

  assert.deepEqual(withDetails.details, { field: "title" });
  assert.equal(withoutDetails.details, undefined);
});

test("数据结构层：错误契约会隔离入参 details 引用", () => {
  const details = {
    field: {
      name: "title",
    },
  };
  const error = createCoreError("VALIDATION_ERROR", "参数错误", details);
  details.field.name = "summary";

  assert.deepEqual(error.details, {
    field: {
      name: "title",
    },
  });
});

test("数据结构层：revision 抛错也遵循 LightTaskError 契约", () => {
  try {
    assertRevisionMonotonic(
      { revision: 2, updatedAt: "2026-04-13T00:00:00.000Z" },
      { revision: 2, updatedAt: "2026-04-13T00:01:00.000Z" },
    );
    assert.fail("应抛出 revision 冲突错误");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "LightTaskError");
    assert.equal((error as Error & { code?: string }).code, "REVISION_CONFLICT");
    assert.deepEqual((error as Error & { details?: Record<string, unknown> }).details, {
      previous: 2,
      next: 2,
    });
    assert.deepEqual(
      (error as Error & { coreError?: { code: string; message: string } }).coreError,
      {
        code: "REVISION_CONFLICT",
        message: "revision 必须单调递增",
        details: {
          previous: 2,
          next: 2,
        },
      },
    );
  }
});

test("数据结构层：Task/Plan metadata 与输入对象隔离", () => {
  const taskMetadata = { source: { channel: "cli" } };
  const planMetadata = { owner: { name: "tester" } };

  const task = createTaskRecord({
    id: "task_3",
    title: "任务",
    createdAt: "2026-04-13T00:00:00.000Z",
    metadata: taskMetadata,
  });
  const plan = createPlanSessionRecord({
    id: "plan_3",
    title: "计划",
    createdAt: "2026-04-13T00:00:00.000Z",
    metadata: planMetadata,
  });

  taskMetadata.source.channel = "api";
  planMetadata.owner.name = "mutated";

  assert.deepEqual(task.metadata, { source: { channel: "cli" } });
  assert.deepEqual(plan.metadata, { owner: { name: "tester" } });
});
