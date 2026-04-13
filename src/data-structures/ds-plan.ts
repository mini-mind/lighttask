import { cloneOptional } from "./ds-clone";
import type { RevisionState } from "./ds-revision";
import { createInitialRevision } from "./ds-revision";
import type { PlanLifecycleStatus } from "./ds-status";

export interface PlanSessionRecord extends RevisionState {
  id: string;
  title: string;
  status: PlanLifecycleStatus;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePlanSessionRecordInput {
  id: string;
  title: string;
  createdAt: string;
  status?: PlanLifecycleStatus;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export function createPlanSessionRecord(input: CreatePlanSessionRecordInput): PlanSessionRecord {
  const revision = createInitialRevision(input.createdAt, input.idempotencyKey);

  return {
    id: input.id,
    title: input.title.trim(),
    status: input.status ?? "draft",
    createdAt: input.createdAt,
    updatedAt: revision.updatedAt,
    revision: revision.revision,
    idempotencyKey: revision.idempotencyKey,
    // 防止调用方后续修改入参对象污染已创建记录。
    metadata: cloneOptional(input.metadata),
  };
}
