import { cloneOptional } from "./ds-clone";
import type { RevisionState } from "./ds-revision";
import { createInitialRevision } from "./ds-revision";
import type { TaskLifecycleStatus } from "./ds-status";

export interface TaskRecord extends RevisionState {
  id: string;
  title: string;
  summary?: string;
  planId?: string;
  status: TaskLifecycleStatus;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskRecordInput {
  id: string;
  title: string;
  createdAt: string;
  summary?: string;
  planId?: string;
  status?: TaskLifecycleStatus;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export function createTaskRecord(input: CreateTaskRecordInput): TaskRecord {
  const revision = createInitialRevision(input.createdAt, input.idempotencyKey);

  // 数据结构层只做确定性初始化，不做编排规则。
  return {
    id: input.id,
    title: input.title.trim(),
    summary: input.summary?.trim() || undefined,
    planId: input.planId,
    status: input.status ?? "queued",
    createdAt: input.createdAt,
    updatedAt: revision.updatedAt,
    revision: revision.revision,
    idempotencyKey: revision.idempotencyKey,
    // 防止调用方后续修改入参对象污染已创建记录。
    metadata: cloneOptional(input.metadata),
  };
}
