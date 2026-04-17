import { cloneOptional } from "./ds-clone";
import type { StructuredEntityExtensions } from "./ds-extension";
import type { RevisionState } from "./ds-revision";
import { createInitialRevision } from "./ds-revision";

export interface PlanRecord extends RevisionState {
  id: string;
  title: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface CreatePlanRecordInput {
  id: string;
  title: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export function createPlanRecord(input: CreatePlanRecordInput): PlanRecord {
  const revision = createInitialRevision(input.createdAt, input.idempotencyKey);

  return {
    id: input.id,
    title: input.title.trim(),
    createdAt: input.createdAt,
    updatedAt: revision.updatedAt,
    revision: revision.revision,
    idempotencyKey: revision.idempotencyKey,
    metadata: cloneOptional(input.metadata),
    extensions: cloneOptional(input.extensions),
  };
}
