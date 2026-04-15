import { cloneOptional, cloneValue } from "./ds-clone";
import type { StructuredEntityExtensions } from "./ds-extension";
import type { RevisionState } from "./ds-revision";
import { createInitialRevision } from "./ds-revision";

export type DependencyKind = "depends_on" | "blocks" | "relates_to";

export interface GraphNodeRecord {
  id: string;
  taskId: string;
  label: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface GraphEdgeRecord {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: DependencyKind;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface GraphSnapshot extends RevisionState {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  createdAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface CreateGraphSnapshotInput {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  createdAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export function createGraphSnapshot(input: CreateGraphSnapshotInput): GraphSnapshot {
  const revision = createInitialRevision(input.createdAt, input.idempotencyKey);

  return {
    // 图快照是不可变视图，需要深拷贝保证快照稳定。
    nodes: cloneValue(input.nodes),
    edges: cloneValue(input.edges),
    createdAt: input.createdAt,
    metadata: cloneOptional(input.metadata),
    extensions: cloneOptional(input.extensions),
    updatedAt: revision.updatedAt,
    revision: revision.revision,
    idempotencyKey: revision.idempotencyKey,
  };
}
