import type {
  CoreError,
  DependencyKind,
  GraphEdgeRecord,
  GraphNodeRecord,
  GraphSnapshot,
} from "../data-structures";
import { createCoreError, throwCoreError } from "../data-structures";

export interface NormalizedDagEdge {
  prerequisiteNodeId: string;
  dependentNodeId: string;
  sourceEdgeId: string;
  sourceKind: "depends_on" | "blocks";
}

export interface DagValidationResult {
  ok: boolean;
  nodeIds: string[];
  normalizedEdges: NormalizedDagEdge[];
  errors: CoreError[];
}

export type GraphEditOperation =
  | {
      type: "upsert_node";
      node: GraphNodeRecord;
    }
  | {
      type: "remove_node";
      nodeId: string;
    }
  | {
      type: "upsert_edge";
      edge: GraphEdgeRecord;
    }
  | {
      type: "remove_edge";
      edgeId: string;
    };

export interface GraphEditResult {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
}

const GRAPH_EDGE_KINDS: DependencyKind[] = ["depends_on", "blocks", "relates_to"];

function normalizeDependencyEdge(edge: GraphEdgeRecord): NormalizedDagEdge | undefined {
  if (edge.kind === "relates_to") {
    return undefined;
  }

  if (edge.kind === "depends_on") {
    return {
      // A depends_on B 表示 B 是前置，排序边方向要转成 B -> A。
      prerequisiteNodeId: edge.toNodeId,
      dependentNodeId: edge.fromNodeId,
      sourceEdgeId: edge.id,
      sourceKind: edge.kind,
    };
  }

  return {
    // A blocks B 表示 A 先于 B，排序边方向保持 A -> B。
    prerequisiteNodeId: edge.fromNodeId,
    dependentNodeId: edge.toNodeId,
    sourceEdgeId: edge.id,
    sourceKind: edge.kind,
  };
}

function createValidationError(message: string, details?: Record<string, unknown>): CoreError {
  return createCoreError("VALIDATION_ERROR", message, details);
}

function describeValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecordValue(
  value: unknown,
  message: string,
  details: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throwCoreError(
      createValidationError(message, {
        ...details,
        actualType: describeValueType(value),
      }),
    );
  }

  return value;
}

function assertNonEmptyTrimmedString(
  value: unknown,
  field: string,
  details: Record<string, unknown>,
): string {
  if (typeof value !== "string") {
    throwCoreError(
      createValidationError(`${field} 必须是字符串`, {
        ...details,
        field,
        actualType: describeValueType(value),
      }),
    );
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throwCoreError(
      createValidationError(`${field} 不能为空`, {
        ...details,
        field,
        value,
      }),
    );
  }

  return normalizedValue;
}

function assertDependencyKind(value: unknown, details: Record<string, unknown>): DependencyKind {
  if (typeof value !== "string" || !GRAPH_EDGE_KINDS.includes(value as DependencyKind)) {
    throwCoreError(
      createValidationError("edge.kind 非法", {
        ...details,
        field: "edge.kind",
        value,
        allowedValues: GRAPH_EDGE_KINDS,
      }),
    );
  }

  return value as DependencyKind;
}

function assertDistinctDestructiveTarget(
  seenTargets: Map<string, number>,
  targetId: string,
  operationType: "remove_node" | "remove_edge",
  operationIndex: number,
): void {
  const duplicatedWith = seenTargets.get(targetId);
  if (duplicatedWith !== undefined) {
    throwCoreError(
      createValidationError(
        operationType === "remove_node"
          ? "同一补丁内不允许重复删除同一节点"
          : "同一补丁内不允许重复删除同一边",
        operationType === "remove_node"
          ? {
              operationIndex,
              operationType,
              nodeId: targetId,
              duplicateOfOperationIndex: duplicatedWith,
            }
          : {
              operationIndex,
              operationType,
              edgeId: targetId,
              duplicateOfOperationIndex: duplicatedWith,
            },
      ),
    );
  }

  seenTargets.set(targetId, operationIndex);
}

export function normalizeGraphEditOperations(operations: unknown): GraphEditOperation[] {
  if (!Array.isArray(operations)) {
    throwCoreError(
      createValidationError("operations 必须是数组", {
        actualType: describeValueType(operations),
      }),
    );
  }

  if (operations.length === 0) {
    throwCoreError(
      createValidationError("operations 不能为空", {
        operationCount: 0,
      }),
    );
  }

  const normalizedOperations: GraphEditOperation[] = [];
  const removedNodeIndexes = new Map<string, number>();
  const removedEdgeIndexes = new Map<string, number>();

  // 先收口补丁契约层的形状与 trim 规则，再把存在性/引用性留给顺序应用规则处理。
  for (let index = 0; index < operations.length; index += 1) {
    const operation = assertRecordValue(operations[index], "operation 必须是对象", {
      operationIndex: index,
    });
    const operationType = operation.type;

    if (
      operationType !== "upsert_node" &&
      operationType !== "remove_node" &&
      operationType !== "upsert_edge" &&
      operationType !== "remove_edge"
    ) {
      throwCoreError(
        createValidationError("operation.type 非法", {
          operationIndex: index,
          field: "type",
          value: operationType,
        }),
      );
    }

    if (operationType === "upsert_node") {
      const node = assertRecordValue(operation.node, "node 必须是对象", {
        operationIndex: index,
        operationType,
      });
      const id = assertNonEmptyTrimmedString(node.id, "node.id", {
        operationIndex: index,
        operationType,
      });
      const taskId = assertNonEmptyTrimmedString(node.taskId, "node.taskId", {
        operationIndex: index,
        operationType,
      });
      const label = assertNonEmptyTrimmedString(node.label, "node.label", {
        operationIndex: index,
        operationType,
      });

      normalizedOperations.push({
        type: operationType,
        node: {
          id,
          taskId,
          label,
          ...(node.metadata !== undefined
            ? { metadata: node.metadata as GraphNodeRecord["metadata"] }
            : {}),
          ...(node.extensions !== undefined
            ? { extensions: node.extensions as GraphNodeRecord["extensions"] }
            : {}),
        },
      });
      continue;
    }

    if (operationType === "remove_node") {
      const nodeId = assertNonEmptyTrimmedString(operation.nodeId, "nodeId", {
        operationIndex: index,
        operationType,
      });
      assertDistinctDestructiveTarget(removedNodeIndexes, nodeId, operationType, index);
      normalizedOperations.push({
        type: operationType,
        nodeId,
      });
      continue;
    }

    if (operationType === "upsert_edge") {
      const edge = assertRecordValue(operation.edge, "edge 必须是对象", {
        operationIndex: index,
        operationType,
      });
      const id = assertNonEmptyTrimmedString(edge.id, "edge.id", {
        operationIndex: index,
        operationType,
      });
      const fromNodeId = assertNonEmptyTrimmedString(edge.fromNodeId, "edge.fromNodeId", {
        operationIndex: index,
        operationType,
      });
      const toNodeId = assertNonEmptyTrimmedString(edge.toNodeId, "edge.toNodeId", {
        operationIndex: index,
        operationType,
      });
      const kind = assertDependencyKind(edge.kind, {
        operationIndex: index,
        operationType,
      });

      if (fromNodeId === toNodeId) {
        throwCoreError(
          createValidationError("edge 不允许自环", {
            operationIndex: index,
            operationType,
            edgeId: id,
            fromNodeId,
            toNodeId,
            kind,
          }),
        );
      }

      normalizedOperations.push({
        type: operationType,
        edge: {
          id,
          fromNodeId,
          toNodeId,
          kind,
          ...(edge.metadata !== undefined
            ? { metadata: edge.metadata as GraphEdgeRecord["metadata"] }
            : {}),
          ...(edge.extensions !== undefined
            ? { extensions: edge.extensions as GraphEdgeRecord["extensions"] }
            : {}),
        },
      });
      continue;
    }

    const edgeId = assertNonEmptyTrimmedString(operation.edgeId, "edgeId", {
      operationIndex: index,
      operationType,
    });
    assertDistinctDestructiveTarget(removedEdgeIndexes, edgeId, operationType, index);
    normalizedOperations.push({
      type: operationType,
      edgeId,
    });
  }

  return normalizedOperations;
}

function findEdgeReferenceIds(edges: GraphEdgeRecord[], nodeId: string): string[] {
  return edges
    .filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId)
    .map((edge) => edge.id);
}

export function applyGraphEditOperations(
  snapshot: Pick<GraphSnapshot, "nodes" | "edges">,
  operations: GraphEditOperation[],
): GraphEditResult {
  const nodes = structuredClone(snapshot.nodes);
  const edges = structuredClone(snapshot.edges);

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];

    if (operation.type === "upsert_node") {
      const existedIndex = nodes.findIndex((node) => node.id === operation.node.id);
      if (existedIndex >= 0) {
        nodes[existedIndex] = structuredClone(operation.node);
      } else {
        nodes.push(structuredClone(operation.node));
      }
      continue;
    }

    if (operation.type === "remove_node") {
      const existedIndex = nodes.findIndex((node) => node.id === operation.nodeId);
      if (existedIndex < 0) {
        throwCoreError(
          createValidationError("待删除节点不存在", {
            operationIndex: index,
            operationType: operation.type,
            nodeId: operation.nodeId,
          }),
        );
      }

      const referencedEdgeIds = findEdgeReferenceIds(edges, operation.nodeId);
      if (referencedEdgeIds.length > 0) {
        throwCoreError(
          createValidationError("待删除节点仍被边引用，禁止隐式级联删除", {
            operationIndex: index,
            operationType: operation.type,
            nodeId: operation.nodeId,
            referencedEdgeIds,
          }),
        );
      }

      nodes.splice(existedIndex, 1);
      continue;
    }

    if (operation.type === "upsert_edge") {
      const existedIndex = edges.findIndex((edge) => edge.id === operation.edge.id);
      if (existedIndex >= 0) {
        edges[existedIndex] = structuredClone(operation.edge);
      } else {
        edges.push(structuredClone(operation.edge));
      }
      continue;
    }

    const existedIndex = edges.findIndex((edge) => edge.id === operation.edgeId);
    if (existedIndex < 0) {
      throwCoreError(
        createValidationError("待删除边不存在", {
          operationIndex: index,
          operationType: operation.type,
          edgeId: operation.edgeId,
        }),
      );
    }

    edges.splice(existedIndex, 1);
  }

  return { nodes, edges };
}

function topoSortFromNormalizedEdges(
  nodeIds: string[],
  normalizedEdges: NormalizedDagEdge[],
): string[] {
  const nodeOrder = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  nodeIds.forEach((nodeId, index) => {
    nodeOrder.set(nodeId, index);
    adjacency.set(nodeId, []);
    inDegree.set(nodeId, 0);
  });

  for (const edge of normalizedEdges) {
    adjacency.get(edge.prerequisiteNodeId)?.push(edge.dependentNodeId);
    inDegree.set(edge.dependentNodeId, (inDegree.get(edge.dependentNodeId) ?? 0) + 1);
  }

  // 稳定拓扑排序：每一轮都按节点声明顺序取可执行节点，避免结果抖动。
  const ready = nodeIds
    .filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)
    .sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));

  const order: string[] = [];

  while (ready.length > 0) {
    const nextNodeId = ready.shift();
    if (!nextNodeId) {
      break;
    }

    order.push(nextNodeId);

    for (const dependentNodeId of adjacency.get(nextNodeId) ?? []) {
      const currentInDegree = (inDegree.get(dependentNodeId) ?? 0) - 1;
      inDegree.set(dependentNodeId, currentInDegree);

      if (currentInDegree === 0) {
        ready.push(dependentNodeId);
      }
    }

    ready.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
  }

  return order;
}

export function validateDagSnapshot(
  snapshot: Pick<GraphSnapshot, "nodes" | "edges">,
): DagValidationResult {
  const errors: CoreError[] = [];
  const nodeIds: string[] = [];

  const nodeIdSet = new Set<string>();
  const nodeIdByTaskId = new Map<string, string>();
  const edgeIdSet = new Set<string>();
  const edgeKeySet = new Set<string>();
  const normalizedEdgeSet = new Set<string>();
  const normalizedEdges: NormalizedDagEdge[] = [];

  for (let index = 0; index < snapshot.nodes.length; index += 1) {
    const node = snapshot.nodes[index];
    nodeIds.push(node.id);

    if (nodeIdSet.has(node.id)) {
      errors.push(
        createValidationError("检测到重复节点 id", {
          nodeId: node.id,
          nodeIndex: index,
        }),
      );
      continue;
    }

    nodeIdSet.add(node.id);

    const duplicatedNodeId = nodeIdByTaskId.get(node.taskId);
    if (duplicatedNodeId) {
      errors.push(
        createValidationError("检测到重复节点 taskId", {
          taskId: node.taskId,
          nodeId: node.id,
          nodeIndex: index,
          duplicateOfNodeId: duplicatedNodeId,
        }),
      );
      continue;
    }

    nodeIdByTaskId.set(node.taskId, node.id);
  }

  for (let index = 0; index < snapshot.edges.length; index += 1) {
    const edge = snapshot.edges[index];

    if (edgeIdSet.has(edge.id)) {
      errors.push(
        createValidationError("检测到重复边 id", {
          edgeId: edge.id,
          edgeIndex: index,
        }),
      );
    } else {
      edgeIdSet.add(edge.id);
    }

    const edgeKey = `${edge.kind}:${edge.fromNodeId}->${edge.toNodeId}`;
    if (edgeKeySet.has(edgeKey)) {
      errors.push(
        createValidationError("检测到重复边关系", {
          edgeId: edge.id,
          edgeIndex: index,
          edgeKey,
        }),
      );
    } else {
      edgeKeySet.add(edgeKey);
    }

    if (!nodeIdSet.has(edge.fromNodeId) || !nodeIdSet.has(edge.toNodeId)) {
      errors.push(
        createValidationError("依赖边端点不存在", {
          edgeId: edge.id,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
        }),
      );
      continue;
    }

    const normalized = normalizeDependencyEdge(edge);
    if (!normalized) {
      continue;
    }

    // 只对 DAG 依赖边做自环校验，relates_to 不参与 DAG 语义。
    if (normalized.prerequisiteNodeId === normalized.dependentNodeId) {
      errors.push(
        createValidationError("DAG 不允许自环依赖", {
          edgeId: edge.id,
          nodeId: normalized.prerequisiteNodeId,
          kind: normalized.sourceKind,
        }),
      );
      continue;
    }

    const normalizedKey = `${normalized.prerequisiteNodeId}->${normalized.dependentNodeId}`;
    if (normalizedEdgeSet.has(normalizedKey)) {
      errors.push(
        createValidationError("检测到重复 DAG 依赖关系", {
          edgeId: edge.id,
          normalizedKey,
        }),
      );
      continue;
    }

    normalizedEdgeSet.add(normalizedKey);
    normalizedEdges.push(normalized);
  }

  if (errors.length === 0) {
    const order = topoSortFromNormalizedEdges(nodeIds, normalizedEdges);
    if (order.length !== nodeIds.length) {
      const resolved = new Set(order);
      const unresolvedNodeIds = nodeIds.filter((nodeId) => !resolved.has(nodeId));

      errors.push(
        createValidationError("DAG 存在环路，无法得到完整拓扑序", {
          unresolvedNodeIds,
        }),
      );
    }
  }

  return {
    ok: errors.length === 0,
    nodeIds,
    normalizedEdges,
    errors,
  };
}

export function topologicalSort(snapshot: Pick<GraphSnapshot, "nodes" | "edges">): string[] {
  const validation = validateDagSnapshot(snapshot);

  if (!validation.ok) {
    throwCoreError(
      createValidationError("DAG 校验失败，无法执行拓扑排序", {
        errors: validation.errors,
      }),
    );
  }

  return topoSortFromNormalizedEdges(validation.nodeIds, validation.normalizedEdges);
}

export function findReadyNodeIds(
  snapshot: Pick<GraphSnapshot, "nodes" | "edges">,
  completedNodeIds: Iterable<string>,
): string[] {
  const validation = validateDagSnapshot(snapshot);

  if (!validation.ok) {
    throwCoreError(
      createValidationError("DAG 校验失败，无法计算 ready 节点", {
        errors: validation.errors,
      }),
    );
  }

  const completedSet = new Set(completedNodeIds);
  const nodeIdSet = new Set(validation.nodeIds);
  const missingCompletedNodeIds = [...completedSet].filter((nodeId) => !nodeIdSet.has(nodeId));

  if (missingCompletedNodeIds.length > 0) {
    throwCoreError(
      createValidationError("completedNodeIds 包含不存在的节点", {
        missingCompletedNodeIds,
      }),
    );
  }

  const prerequisitesByNode = new Map<string, Set<string>>();
  for (const nodeId of validation.nodeIds) {
    prerequisitesByNode.set(nodeId, new Set());
  }

  for (const edge of validation.normalizedEdges) {
    prerequisitesByNode.get(edge.dependentNodeId)?.add(edge.prerequisiteNodeId);
  }

  // ready 的边界：节点未完成，且其所有前置都已完成。
  const readyNodeIds: string[] = [];
  for (const nodeId of validation.nodeIds) {
    if (completedSet.has(nodeId)) {
      continue;
    }

    const prerequisites = prerequisitesByNode.get(nodeId);
    const isReady = [...(prerequisites ?? [])].every((prerequisiteNodeId) =>
      completedSet.has(prerequisiteNodeId),
    );

    if (isReady) {
      readyNodeIds.push(nodeId);
    }
  }

  return readyNodeIds;
}
