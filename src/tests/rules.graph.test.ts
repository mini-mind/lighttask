import assert from "node:assert/strict";
import test from "node:test";
import { createGraphSnapshot } from "../data-structures/ds-graph";
import type { GraphEdgeRecord } from "../data-structures/ds-graph";
import {
  assertExpectedRevision,
  assertNextRevision,
  decideIdempotency,
  findReadyNodeIds,
  topologicalSort,
  validateDagSnapshot,
} from "../rules";

const NOW = "2026-04-13T00:00:00.000Z";

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
  assert.equal(validation.errors[0]?.code, "VALIDATION_ERROR");
  assert.match(validation.errors[0]?.message ?? "", /重复节点/);
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
  assert.ok(validation.errors.some((error) => /重复 DAG 依赖关系/.test(error.message)));
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
  assert.ok(validation.errors.some((error) => /重复边 id/.test(error.message)));
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
  assert.ok(validation.errors.some((error) => /重复边关系/.test(error.message)));
});

test("规则层 DAG：端点不存在可识别", () => {
  const snapshot = createSnapshot(
    ["n1"],
    [{ id: "e1", fromNodeId: "n1", toNodeId: "n_missing", kind: "depends_on" }],
  );
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => /端点不存在/.test(error.message)));
});

test("规则层 DAG：自环可识别", () => {
  const snapshot = createSnapshot(
    ["n1"],
    [{ id: "e1", fromNodeId: "n1", toNodeId: "n1", kind: "depends_on" }],
  );
  const validation = validateDagSnapshot(snapshot);

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => /自环/.test(error.message)));
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
  assert.ok(validation.errors.some((error) => /环路/.test(error.message)));
  assert.throws(() => topologicalSort(snapshot), /DAG 校验失败/);
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
  assert.throws(
    () => findReadyNodeIds(snapshot, ["n_missing"]),
    /completedNodeIds 包含不存在的节点/,
  );
});

test("规则层 DAG：非法图上计算 ready 会抛错", () => {
  const snapshot = createSnapshot(
    ["n1", "n2"],
    [
      { id: "e1", fromNodeId: "n1", toNodeId: "n2", kind: "depends_on" },
      { id: "e2", fromNodeId: "n2", toNodeId: "n1", kind: "depends_on" },
    ],
  );
  assert.throws(() => findReadyNodeIds(snapshot, []), /DAG 校验失败，无法计算 ready 节点/);
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
  assert.match(decision.reason, /不一致/);
});

test("规则层 Revision：expected 与 next 校验可通过", () => {
  assert.doesNotThrow(() => assertExpectedRevision(3, 3));
  assert.doesNotThrow(() => assertNextRevision(3, 4));
});

test("规则层 Revision：expected 与 next 校验冲突时抛错", () => {
  assert.throws(() => assertExpectedRevision(3, 2), /REVISION_CONFLICT/);
  assert.throws(() => assertNextRevision(3, 5), /REVISION_CONFLICT/);
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
  assert.throws(() => assertExpectedRevision(0, 1), /VALIDATION_ERROR/);
  assert.throws(() => assertExpectedRevision(-1, 1), /VALIDATION_ERROR/);
  assert.throws(() => assertExpectedRevision(1.5, 1), /VALIDATION_ERROR/);
  assert.throws(() => assertNextRevision(2, 0), /VALIDATION_ERROR/);
  assert.throws(() => assertNextRevision(1, 2.5), /VALIDATION_ERROR/);
});
