import { cloneOptional } from "./ds-clone";
import type { StructuredEntityExtensions } from "./ds-extension";
import type { RevisionState } from "./ds-revision";
import { createInitialRevision } from "./ds-revision";

export type OutputLifecycleStatus = "open" | "sealed";
export type OutputItemStatus = "declared" | (string & {});

export interface OutputRuntimeRef extends Record<string, unknown> {
  id: string;
}

export interface OutputOwnerRef extends Record<string, unknown> {
  kind: string;
  id: string;
}

export interface OutputItemRecord {
  id: string;
  kind: string;
  status: OutputItemStatus;
  role?: string;
  label?: string;
  contentType?: string;
  schema?: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface OutputRecord extends RevisionState {
  id: string;
  kind: string;
  status: OutputLifecycleStatus;
  runtimeRef?: OutputRuntimeRef;
  ownerRef?: OutputOwnerRef;
  payload?: Record<string, unknown>;
  items?: OutputItemRecord[];
  createdAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface CreateOutputRecordInput {
  id: string;
  kind: string;
  createdAt: string;
  status?: OutputLifecycleStatus;
  runtimeRef?: OutputRuntimeRef;
  ownerRef?: OutputOwnerRef;
  payload?: Record<string, unknown>;
  items?: OutputItemRecord[];
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export function createOutputRecord(input: CreateOutputRecordInput): OutputRecord {
  const revision = createInitialRevision(input.createdAt, input.idempotencyKey);

  return {
    id: input.id,
    kind: input.kind.trim(),
    status: input.status ?? "open",
    runtimeRef: cloneOptional(input.runtimeRef),
    ownerRef: cloneOptional(input.ownerRef),
    payload: cloneOptional(input.payload),
    items: cloneOptional(input.items),
    createdAt: input.createdAt,
    updatedAt: revision.updatedAt,
    revision: revision.revision,
    idempotencyKey: revision.idempotencyKey,
    metadata: cloneOptional(input.metadata),
    extensions: cloneOptional(input.extensions),
  };
}
