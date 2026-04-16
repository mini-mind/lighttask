import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import type { CoreError, CoreErrorCode } from "../data-structures/ds-error";
import { LightTaskError } from "../data-structures/ds-error";
import { createGraphSnapshot } from "../data-structures/ds-graph";
import type { GraphEdgeRecord } from "../data-structures/ds-graph";
import {
  applyGraphEditOperations,
  assertExpectedRevision,
  assertNextRevision,
  decideIdempotency,
  findReadyNodeIds,
  normalizeGraphEditOperations,
  topologicalSort,
  validateDagSnapshot,
} from "../rules";

const NOW = "2026-04-13T00:00:00.000Z";

function expectLightTaskError(
  action: () => void,
  expected: {
    code: CoreErrorCode;
    message?: string;
    details?: Record<string, unknown>;
  },
): void {
  assert.throws(action, (error) => {
    assert.ok(error instanceof LightTaskError);
    assert.equal(error.code, expected.code);

    if (expected.message !== undefined) {
      assert.equal(error.coreError.message, expected.message);
    }

    if (expected.details !== undefined) {
      assert.deepEqual(error.coreError.details, expected.details);
    }

    return true;
  });
}

function expectContainsValidationError(
  errors: CoreError[],
  expectedDetails: Record<string, unknown>,
): void {
  const keys = Object.keys(expectedDetails);
  assert.ok(
    errors.some(
      (error) =>
        error.code === "VALIDATION_ERROR" &&
        keys.every((key) => isDeepStrictEqual(error.details?.[key], expectedDetails[key])),
    ),
  );
}

function createSnapshot(nodeIds: string[], edges: GraphEdgeRecord[]) {
  return createGraphSnapshot({
    nodes: nodeIds.map((nodeId) => ({
      id: nodeId,
      taskId: `task_${nodeId}`,
      label: `节点 ${nodeId}`,
    })),
    edges,
    createdAt: NOW,
  });
}

test("规则层 DAG：正常图可通过校验并返回规范化依赖", () => {
  const snapshot = createSnapshot(
    ["n1", "n2", "n3"],
    [
      { id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
      { id: "e2", fromNodeId: "n1", toNodeId: "n3", kind: "blocks" },
      { id: "e3", fromNodeId: "n2", toNodeId: "n3", kind: "relates_to" },
    ],
  );

  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, true);
  assert.equal(validation.errors.length, 0);
  assert.deepEqual(
    validation.normalizedEdges.map((edge) => `${edge.prerequisiteNodeId}->${edge.dependentNodeId}`),
    ["n1->n2", "n1->n3"],
  );
});

test("规则层 DAG：重复节点可识别", () => {
  const snapshot = createSnapshot(["n1", "n1"], []);
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.errors, [
    {
      code: "VALIDATION_ERROR",
      message: "检测到重复节点 id",
      details: {
        nodeId: "n1",
        nodeIndex: 1,
      },
    },
  ]);
});

test("规则层 DAG：重复节点 taskId 可识别", () => {
  const snapshot = createGraphSnapshot({
    nodes: [
      { id: "n1", taskId: "task_shared", label: "节点一" },
      { id: "n2", taskId: "task_shared", label: "节点二" },
    ],
    edges: [],
    createdAt: NOW,
  });
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.errors, [
    {
      code: "VALIDATION_ERROR",
      message: "检测到重复节点 taskId",
      details: {
        taskId: "task_shared",
        nodeId: "n2",
        nodeIndex: 1,
        duplicateOfNodeId: "n1",
      },
    },
  ]);
});

test("规则层 DAG：重复边可识别", () => {
  const snapshot = createSnapshot(
    ["n1", "n2"],
    [
      { id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
      { id: "e2", fromNodeId: "n1", toNodeId: "n2", kind: "blocks" },
    ],
  );
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  expectContainsValidationError(validation.errors, {
    edgeId: "e2",
    normalizedKey: "n1->n2",
  });
});

test("规则层 DAG：重复边 id 可识别", () => {
  const snapshot = createSnapshot(
    ["n1", "n2", "n3"],
    [
      { id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
      { id: "e1", fromNodeId: "n3", toNodeId: "n1", kind: "depends_on" },
    ],
  );
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  expectContainsValidationError(validation.errors, {
    edgeId: "e1",
    edgeIndex: 1,
  });
});

test("规则层 DAG：同 kind/from/to 的重复边关系可识别", () => {
  const snapshot = createSnapshot(
    ["n1", "n2"],
    [
      { id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
      { id: "e2", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
    ],
  );
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  expectContainsValidationError(validation.errors, {
    edgeId: "e2",
    edgeIndex: 1,
    edgeKey: "depends_on:n2->n1",
  });
});

test("规则层 DAG：端点不存在可识别", () => {
  const snapshot = createSnapshot(
    ["n1"],
    [{ id: "e1", fromNodeId: "n1", toNodeId: "n_missing", kind: "depends_on" }],
  );
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  expectContainsValidationError(validation.errors, {
    edgeId: "e1",
    fromNodeId: "n1",
    toNodeId: "n_missing",
  });
});

test("规则层 DAG：自环可识别", () => {
  const snapshot = createSnapshot(
    ["n1"],
    [{ id: "e1", fromNodeId: "n1", toNodeId: "n1", kind: "depends_on" }],
  );
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  expectContainsValidationError(validation.errors, {
    edgeId: "e1",
    nodeId: "n1",
    kind: "depends_on",
  });
});

test("规则层 DAG：同一快照会聚合多个错误而非 fail-fast", () => {
  const snapshot = createSnapshot(
    ["n1", "n1", "n2"],
    [
      { id: "e1", fromNodeId: "n1", toNodeId: "n1", kind: "depends_on" },
      { id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
      { id: "e3", fromNodeId: "n2", toNodeId: "n_missing", kind: "depends_on" },
    ],
  );

  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length >= 3);
  expectContainsValidationError(validation.errors, {
    nodeId: "n1",
    nodeIndex: 1,
  });
  expectContainsValidationError(validation.errors, {
    edgeId: "e1",
    edgeIndex: 1,
  });
  expectContainsValidationError(validation.errors, {
    edgeId: "e3",
    fromNodeId: "n2",
    toNodeId: "n_missing",
  });
});

test("规则层 DAG：环路可识别且拓扑排序会抛错", () => {
  const snapshot = createSnapshot(
    ["n1", "n2"],
    [
      { id: "e1", fromNodeId: "n1", toNodeId: "n2", kind: "depends_on" },
      { id: "e2", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
    ],
  );
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  expectContainsValidationError(validation.errors, {
    unresolvedNodeIds: ["n1", "n2"],
  });
  expectLightTaskError(() => topologicalSort(snapshot), {
    code: "VALIDATION_ERROR",
    message: "DAG 校验失败，无法执行拓扑排序",
    details: {
      errors: validation.errors,
    },
  });
});

test("规则层 DAG：拓扑排序结果稳定", () => {
  const snapshot = createSnapshot(
    ["n3", "n1", "n2", "n4"],
    [{ id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" }],
  );

  const order = topologicalSort(snapshot);
  assert.deepEqual(order, ["n3", "n1", "n2", "n4"]);
});

test("规则层 DAG：ready 节点计算只看 DAG 依赖并保持节点顺序", () => {
  const snapshot = createSnapshot(
    ["n1", "n2", "n3", "n4", "n5"],
    [
      { id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
      { id: "e2", fromNodeId: "n4", toNodeId: "n5", kind: "blocks" },
      { id: "e3", fromNodeId: "n3", toNodeId: "n2", kind: "relates_to" },
    ],
  );

  const readyNodeIds = findReadyNodeIds(snapshot, ["n1", "n4"]);
  assert.deepEqual(readyNodeIds, ["n2", "n3", "n5"]);
});

test("规则层 DAG：当全部节点已完成时 ready 为空", () => {
  const snapshot = createSnapshot(
    ["n1", "n2"],
    [{ id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" }],
  );
  const readyNodeIds = findReadyNodeIds(snapshot, ["n1", "n2"]);
  assert.deepEqual(readyNodeIds, []);
});

test("规则层 DAG：completedNodeIds 含未知节点时抛错", () => {
  const snapshot = createSnapshot(["n1"], []);
  expectLightTaskError(() => findReadyNodeIds(snapshot, ["n_missing"]), {
    code: "VALIDATION_ERROR",
    message: "completedNodeIds 包含不存在的节点",
    details: {
      missingCompletedNodeIds: ["n_missing"],
    },
  });
});

test("规则层 DAG：非法图上计算 ready 会抛错", () => {
  const snapshot = createSnapshot(
    ["n1", "n2"],
    [
      { id: "e1", fromNodeId: "n1", toNodeId: "n2", kind: "depends_on" },
      { id: "e2", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
    ],
  );
  const validation = validateDagSnapshot(snapshot);
  expectLightTaskError(() => findReadyNodeIds(snapshot, []), {
    code: "VALIDATION_ERROR",
    message: "DAG 校验失败，无法计算 ready 节点",
    details: {
      errors: validation.errors,
    },
  });
});

test("规则层 GraphEdit：按顺序执行 upsert/remove 并保持替换语义显式", () => {
  const snapshot = createSnapshot(
    ["n1", "n2"],
    [{ id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" }],
  );

  const edited = applyGraphEditOperations(snapshot, [
    {
      type: "upsert_node",
      node: {
        id: "n1",
        taskId: "task_n1_v2",
        label: "节点 n1 v2",
      },
    },
    {
      type: "upsert_node",
      node: {
        id: "n3",
        taskId: "task_n3",
        label: "节点 n3",
      },
    },
    { type: "remove_edge", edgeId: "e1" },
    { type: "remove_node", nodeId: "n2" },
    {
      type: "upsert_edge",
      edge: {
        id: "e2",
        fromNodeId: "n3",
        toNodeId: "n1",
        kind: "blocks",
      },
    },
  ]);

  assert.deepEqual(edited.nodes, [
    { id: "n1", taskId: "task_n1_v2", label: "节点 n1 v2" },
    { id: "n3", taskId: "task_n3", label: "节点 n3" },
  ]);
  assert.deepEqual(edited.edges, [{ id: "e2", fromNodeId: "n3", toNodeId: "n1", kind: "blocks" }]);
});

test("规则层 GraphEdit：补丁契约会标准化 trim 输入且不回写原始参数", () => {
  const rawUpsertNode = {
    type: "upsert_node" as const,
    node: {
      id: " n1 ",
      taskId: " task_n1 ",
      label: " 节点 n1 ",
    },
  };
  const rawUpsertEdge = {
    type: "upsert_edge" as const,
    edge: {
      id: " e1 ",
      fromNodeId: " n1 ",
      toNodeId: " n3 ",
      kind: "blocks" as const,
    },
  };
  const operations = [
    rawUpsertNode,
    {
      type: "remove_node" as const,
      nodeId: " n2 ",
    },
    rawUpsertEdge,
    {
      type: "remove_edge" as const,
      edgeId: " e2 ",
    },
  ];

  const normalized = normalizeGraphEditOperations(operations);

  assert.deepEqual(normalized, [
    {
      type: "upsert_node",
      node: {
        id: "n1",
        taskId: "task_n1",
        label: "节点 n1",
      },
    },
    {
      type: "remove_node",
      nodeId: "n2",
    },
    {
      type: "upsert_edge",
      edge: {
        id: "e1",
        fromNodeId: "n1",
        toNodeId: "n3",
        kind: "blocks",
      },
    },
    {
      type: "remove_edge",
      edgeId: "e2",
    },
  ]);
  assert.equal(rawUpsertNode.node.id, " n1 ");
  assert.equal(rawUpsertEdge.edge.fromNodeId, " n1 ");
});

test("规则层 GraphEdit：补丁契约会拒绝空 operations", () => {
  expectLightTaskError(() => normalizeGraphEditOperations([]), {
    code: "VALIDATION_ERROR",
    message: "operations 不能为空",
    details: {
      operationCount: 0,
    },
  });
});

test("规则层 GraphEdit：补丁契约会拒绝非法 edge.kind", () => {
  expectLightTaskError(
    () =>
      normalizeGraphEditOperations([
        {
          type: "upsert_edge",
          edge: {
            id: "e1",
            fromNodeId: "n1",
            toNodeId: "n2",
            kind: "invalid_kind",
          },
        },
      ]),
    {
      code: "VALIDATION_ERROR",
      message: "edge.kind 非法",
      details: {
        operationIndex: 0,
        operationType: "upsert_edge",
        field: "edge.kind",
        value: "invalid_kind",
        allowedValues: ["depends_on", "blocks", "relates_to"],
      },
    },
  );
});

test("规则层 GraphEdit：补丁契约会拒绝重复 destructive 操作", () => {
  expectLightTaskError(
    () =>
      normalizeGraphEditOperations([
        { type: "remove_node", nodeId: " n1 " },
        { type: "remove_node", nodeId: "n1" },
      ]),
    {
      code: "VALIDATION_ERROR",
      message: "同一补丁内不允许重复删除同一节点",
      details: {
        operationIndex: 1,
        operationType: "remove_node",
        nodeId: "n1",
        duplicateOfOperationIndex: 0,
      },
    },
  );
});

test("规则层 GraphEdit：删除仍被边引用的节点会显式报错", () => {
  const snapshot = createSnapshot(
    ["n1", "n2"],
    [{ id: "e1", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" }],
  );

  expectLightTaskError(
    () => applyGraphEditOperations(snapshot, [{ type: "remove_node", nodeId: "n1" }]),
    {
      code: "VALIDATION_ERROR",
      message: "待删除节点仍被边引用，禁止隐式级联删除",
      details: {
        operationIndex: 0,
        operationType: "remove_node",
        nodeId: "n1",
        referencedEdgeIds: ["e1"],
      },
    },
  );
});

test("规则层 GraphEdit：删除不存在的节点会显式报错", () => {
  const snapshot = createSnapshot(["n1"], []);

  expectLightTaskError(
    () => applyGraphEditOperations(snapshot, [{ type: "remove_node", nodeId: "n_missing" }]),
    {
      code: "VALIDATION_ERROR",
      message: "待删除节点不存在",
      details: {
        operationIndex: 0,
        operationType: "remove_node",
        nodeId: "n_missing",
      },
    },
  );
});

test("规则层 GraphEdit：删除不存在的边会显式报错", () => {
  const snapshot = createSnapshot(["n1"], []);

  expectLightTaskError(
    () => applyGraphEditOperations(snapshot, [{ type: "remove_edge", edgeId: "e_missing" }]),
    {
      code: "VALIDATION_ERROR",
      message: "待删除边不存在",
      details: {
        operationIndex: 0,
        operationType: "remove_edge",
        edgeId: "e_missing",
      },
    },
  );
});

test("规则层 Idempotency：同 key 同指纹判定 replay", () => {
  const decision = decideIdempotency({
    incomingIdempotencyKey: "req_1",
    storedIdempotencyKey: "req_1",
    incomingFingerprint: "fp_1",
    storedFingerprint: "fp_1",
  });

  assert.equal(decision.decision, "replay");
  assert.equal(decision.error, undefined);
});

test("规则层 Idempotency：同 key 且双方指纹缺省判定 replay", () => {
  const decision = decideIdempotency({
    incomingIdempotencyKey: "req_1",
    storedIdempotencyKey: "req_1",
  });
  assert.equal(decision.decision, "replay");
});

test("规则层 Idempotency：幂等键会先做 trim 再比较", () => {
  const decision = decideIdempotency({
    incomingIdempotencyKey: "  req_1  ",
    storedIdempotencyKey: "req_1",
  });
  assert.equal(decision.decision, "replay");
});

test("规则层 Idempotency：缺失 incoming key 判定 proceed", () => {
  const decision = decideIdempotency({
    storedIdempotencyKey: "req_1",
    incomingFingerprint: "fp_1",
    storedFingerprint: "fp_1",
  });
  assert.equal(decision.decision, "proceed");
});

test("规则层 Idempotency：空白 key 会归一化为缺失并判定 proceed", () => {
  const decision = decideIdempotency({
    incomingIdempotencyKey: "   ",
    storedIdempotencyKey: "   ",
    incomingFingerprint: "fp_1",
    storedFingerprint: "fp_1",
  });
  assert.equal(decision.decision, "proceed");
});

test("规则层 Idempotency：缺失 stored key 判定 proceed", () => {
  const decision = decideIdempotency({
    incomingIdempotencyKey: "req_1",
    incomingFingerprint: "fp_1",
  });
  assert.equal(decision.decision, "proceed");
});

test("规则层 Idempotency：不同 key 判定 proceed", () => {
  const decision = decideIdempotency({
    incomingIdempotencyKey: "req_new",
    storedIdempotencyKey: "req_old",
    incomingFingerprint: "fp_1",
    storedFingerprint: "fp_1",
  });
  assert.equal(decision.decision, "proceed");
});

test("规则层 Idempotency：同 key 但仅一侧指纹存在判定 conflict", () => {
  const decision = decideIdempotency({
    incomingIdempotencyKey: "req_1",
    storedIdempotencyKey: "req_1",
    incomingFingerprint: "fp_1",
  });
  assert.equal(decision.decision, "conflict");
  assert.equal(decision.error?.code, "STATE_CONFLICT");
});

test("规则层 Idempotency：仅 storedFingerprint 存在时也判定 conflict", () => {
  const decision = decideIdempotency({
    incomingIdempotencyKey: "req_1",
    storedIdempotencyKey: "req_1",
    storedFingerprint: "fp_1",
  });
  assert.equal(decision.decision, "conflict");
  assert.equal(decision.error?.code, "STATE_CONFLICT");
});

test("规则层 Idempotency：同 key 不同指纹判定 conflict", () => {
  const decision = decideIdempotency({
    incomingIdempotencyKey: "req_1",
    storedIdempotencyKey: "req_1",
    incomingFingerprint: "fp_new",
    storedFingerprint: "fp_old",
  });

  assert.equal(decision.decision, "conflict");
  assert.equal(decision.error?.code, "STATE_CONFLICT");
  assert.equal(decision.reason, decision.error?.message);
  assert.deepEqual(decision.error?.details, {
    idempotencyKey: "req_1",
    incomingFingerprint: "fp_new",
    storedFingerprint: "fp_old",
  });
});

test("规则层 Revision：expected 与 next 校验可通过", () => {
  assert.doesNotThrow(() => assertExpectedRevision(3, 3));
  assert.doesNotThrow(() => assertNextRevision(3, 4));
});

test("规则层 Revision：expected 与 next 校验冲突时抛错", () => {
  expectLightTaskError(() => assertExpectedRevision(3, 2), {
    code: "REVISION_CONFLICT",
    message: "expectedRevision 与当前 revision 不一致",
    details: {
      currentRevision: 3,
      expectedRevision: 2,
    },
  });
  expectLightTaskError(() => assertNextRevision(3, 5), {
    code: "REVISION_CONFLICT",
    message: "nextRevision 必须严格等于 previousRevision + 1",
    details: {
      previousRevision: 3,
      nextRevision: 5,
    },
  });
});

test("规则层 Revision：抛错遵循 LightTaskError 契约", () => {
  try {
    assertExpectedRevision(3, 2);
    assert.fail("应抛出 revision 冲突错误");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "LightTaskError");
    assert.equal((error as Error & { code?: string }).code, "REVISION_CONFLICT");
    assert.deepEqual(
      (error as Error & { coreError?: { details?: Record<string, unknown> } }).coreError?.details,
      {
        currentRevision: 3,
        expectedRevision: 2,
      },
    );
  }
});

test("规则层 Revision：非法 revision 输入可识别", () => {
  expectLightTaskError(() => assertExpectedRevision(0, 1), {
    code: "VALIDATION_ERROR",
    message: "currentRevision 必须是大于等于 1 的整数",
    details: {
      currentRevision: 0,
    },
  });
  expectLightTaskError(() => assertExpectedRevision(-1, 1), {
    code: "VALIDATION_ERROR",
    message: "currentRevision 必须是大于等于 1 的整数",
    details: {
      currentRevision: -1,
    },
  });
  expectLightTaskError(() => assertExpectedRevision(1.5, 1), {
    code: "VALIDATION_ERROR",
    message: "currentRevision 必须是大于等于 1 的整数",
    details: {
      currentRevision: 1.5,
    },
  });
  expectLightTaskError(() => assertNextRevision(2, 0), {
    code: "VALIDATION_ERROR",
    message: "nextRevision 必须是大于等于 1 的整数",
    details: {
      nextRevision: 0,
    },
  });
  expectLightTaskError(() => assertNextRevision(1, 2.5), {
    code: "VALIDATION_ERROR",
    message: "nextRevision 必须是大于等于 1 的整数",
    details: {
      nextRevision: 2.5,
    },
  });
});
