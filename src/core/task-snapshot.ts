import { isTaskDesignStatus } from "../data-structures";
import type { TaskAction } from "../rules";
import { cloneValue } from "./clone";
import type {
  LightTaskTask,
  PersistedLightTask,
  TaskDesignStatus,
  TaskExecutionStatus,
  TaskStage,
} from "./types";

const DEFAULT_STAGES: ReadonlyArray<TaskStage> = [
  "investigate",
  "design",
  "implement",
  "verify",
  "converge",
];

const DEFAULT_TASK_DESIGN_STATUS = "ready" as const;
const DEFAULT_TASK_EXECUTION_STATUS = "queued" as const;

export function resolveTaskDesignStatus(
  designStatus: TaskDesignStatus | undefined,
): TaskDesignStatus {
  const normalized = designStatus?.trim();

  if (!normalized) {
    return DEFAULT_TASK_DESIGN_STATUS;
  }

  if (!isTaskDesignStatus(normalized)) {
    throw new Error(`invalid task designStatus: ${normalized}`);
  }

  return normalized;
}

export function resolveTaskExecutionStatus(
  task: Pick<PersistedLightTask, "executionStatus">,
): TaskExecutionStatus {
  return task.executionStatus ?? DEFAULT_TASK_EXECUTION_STATUS;
}

export function clonePersistedTask(task: PersistedLightTask): PersistedLightTask {
  const snapshot = cloneValue(task);
  snapshot.designStatus = resolveTaskDesignStatus(snapshot.designStatus);
  snapshot.executionStatus = resolveTaskExecutionStatus(snapshot);
  snapshot.updatedAt = snapshot.updatedAt ?? snapshot.createdAt;
  return snapshot;
}

export function toPublicTask(task: PersistedLightTask): LightTaskTask {
  const snapshot = clonePersistedTask(task);
  const { lastAdvanceFingerprint: _lastAdvanceFingerprint, ...publicTask } = snapshot;
  return publicTask;
}

export function createDefaultTaskSteps(
  taskId: string,
  designStatus: TaskDesignStatus = DEFAULT_TASK_DESIGN_STATUS,
): PersistedLightTask["steps"] {
  return DEFAULT_STAGES.map((stage) => ({
    id: `${taskId}_${stage}`,
    // 编排层只保留稳定 stage code，展示文案由应用层决定。
    title: stage,
    stage,
    status: designStatus === "draft" ? "todo" : stage === "investigate" ? "doing" : "todo",
  }));
}

export function buildAdvanceFingerprint(
  taskId: string,
  action: TaskAction,
  expectedRevision: number,
): string {
  return `${taskId}:${action}:${expectedRevision}`;
}
