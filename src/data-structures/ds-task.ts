import { cloneOptional } from "./ds-clone";
import type { StructuredEntityExtensions } from "./ds-extension";
import type { RevisionState } from "./ds-revision";
import { createInitialRevision } from "./ds-revision";
import type { TaskStatus } from "./ds-status";

export type TaskStage = "investigate" | "design" | "implement" | "verify" | "converge";

export type TaskStepStatus = "todo" | "doing" | "done";

export interface TaskStepRecord {
  id: string;
  title: string;
  stage: TaskStage;
  status: TaskStepStatus;
}

export interface TaskRecord extends RevisionState {
  id: string;
  planId: string;
  title: string;
  summary?: string;
  status: TaskStatus;
  dependsOnTaskIds: string[];
  steps: TaskStepRecord[];
  createdAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface CreateTaskRecordInput {
  id: string;
  planId: string;
  title: string;
  createdAt: string;
  summary?: string;
  status?: TaskStatus;
  dependsOnTaskIds?: string[];
  steps?: TaskStepRecord[];
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export function createTaskRecord(input: CreateTaskRecordInput): TaskRecord {
  const revision = createInitialRevision(input.createdAt, input.idempotencyKey);
  return {
    id: input.id,
    planId: input.planId.trim(),
    title: input.title.trim(),
    summary: input.summary?.trim() || undefined,
    status: input.status ?? "draft",
    dependsOnTaskIds: cloneOptional(input.dependsOnTaskIds) ?? [],
    steps: cloneOptional(input.steps) ?? [],
    createdAt: input.createdAt,
    updatedAt: revision.updatedAt,
    revision: revision.revision,
    idempotencyKey: revision.idempotencyKey,
    metadata: cloneOptional(input.metadata),
    extensions: cloneOptional(input.extensions),
  };
}
