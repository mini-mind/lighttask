import { cloneOptional } from "./ds-clone";
import type { StructuredEntityExtensions } from "./ds-extension";
import type { RevisionState } from "./ds-revision";
import { createInitialRevision } from "./ds-revision";
import type { RuntimeLifecycleStatus } from "./ds-status";

export interface RuntimeParentRef extends Record<string, unknown> {
  kind: string;
  id: string;
}

export interface RuntimeRecord extends RevisionState {
  id: string;
  kind: string;
  title: string;
  status: RuntimeLifecycleStatus;
  parentRef?: RuntimeParentRef;
  context?: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface CreateRuntimeRecordInput {
  id: string;
  kind: string;
  title: string;
  createdAt: string;
  status?: RuntimeLifecycleStatus;
  parentRef?: RuntimeParentRef;
  context?: Record<string, unknown>;
  result?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export function createRuntimeRecord(input: CreateRuntimeRecordInput): RuntimeRecord {
  const revision = createInitialRevision(input.createdAt, input.idempotencyKey);

  return {
    id: input.id,
    kind: input.kind.trim(),
    title: input.title.trim(),
    status: input.status ?? "queued",
    parentRef: cloneOptional(input.parentRef),
    context: cloneOptional(input.context),
    result: cloneOptional(input.result),
    createdAt: input.createdAt,
    updatedAt: revision.updatedAt,
    revision: revision.revision,
    idempotencyKey: revision.idempotencyKey,
    metadata: cloneOptional(input.metadata),
    extensions: cloneOptional(input.extensions),
  };
}
