import { bumpRevision } from "../data-structures";
import { isTaskDesignStatus } from "../data-structures";
import { assertExpectedRevision, assertNextRevision } from "../rules";
import { cloneOptional } from "./clone";
import { resolveTaskLifecyclePolicy } from "./lifecycle-policy";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishTaskUpdatedEvent, resolveNotifyPublisher } from "./notify-event";
import {
  clonePersistedTask,
  createDefaultTaskSteps,
  resolveTaskDesignStatus,
  resolveTaskExecutionStatus,
  toPublicTask,
} from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  LightTaskTask,
  PersistedLightTask,
  TaskDesignStatus,
  UpdateTaskInput,
} from "./types";

function assertTaskId(taskId: string): string {
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "任务 ID 不能为空", {
        taskId,
      }),
    );
  }

  return normalizedTaskId;
}

function hasOwnField(input: UpdateTaskInput, fieldName: keyof UpdateTaskInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, fieldName);
}

function assertUpdatableFields(taskId: string, input: UpdateTaskInput): void {
  if (
    !hasOwnField(input, "planId") &&
    !hasOwnField(input, "title") &&
    !hasOwnField(input, "summary") &&
    !hasOwnField(input, "designStatus") &&
    !hasOwnField(input, "metadata") &&
    !hasOwnField(input, "extensions")
  ) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "更新任务时至少提供一个可变更字段", {
        taskId,
      }),
    );
  }
}

function resolveExplicitPlanId(
  task: PersistedLightTask,
  incomingPlanId: string | undefined,
): string | undefined {
  if (incomingPlanId === undefined) {
    return task.planId;
  }

  const normalizedPlanId = incomingPlanId.trim();
  if (!normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "planId 不能为空", {
        taskId: task.id,
        planId: incomingPlanId,
      }),
    );
  }

  if (task.planId && task.planId !== normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "任务已归属其他计划，不能变更计划归属", {
        taskId: task.id,
        currentPlanId: task.planId,
        nextPlanId: normalizedPlanId,
      }),
    );
  }

  return normalizedPlanId;
}

function resolveExplicitTaskDesignStatus(
  taskId: string,
  designStatus: TaskDesignStatus | undefined,
): TaskDesignStatus {
  const normalizedDesignStatus = designStatus?.trim();

  if (!normalizedDesignStatus) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "designStatus 不能为空", {
        taskId,
        designStatus,
      }),
    );
  }

  if (!isTaskDesignStatus(normalizedDesignStatus)) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "designStatus 仅支持 draft 或 ready", {
        taskId,
        designStatus,
        supportedDesignStatuses: ["draft", "ready"],
      }),
    );
  }

  return normalizedDesignStatus;
}

function hasStartedTaskSteps(task: PersistedLightTask): boolean {
  return task.steps.some((step) => step.status !== "todo");
}

function syncTaskStepsForDesignStatus(
  task: PersistedLightTask,
  previousDesignStatus: TaskDesignStatus,
  nextDesignStatus: TaskDesignStatus,
  initialExecutionStatus: string,
): void {
  const currentExecutionStatus = resolveTaskExecutionStatus(task);
  if (currentExecutionStatus !== initialExecutionStatus || hasStartedTaskSteps(task)) {
    return;
  }

  if (previousDesignStatus === nextDesignStatus) {
    return;
  }

  // 设计意图：仅在任务尚未进入执行推进前，才让设计态切换重置默认步骤游标。
  task.steps = createDefaultTaskSteps(task.id, nextDesignStatus);
}

export function updateTaskUseCase(
  options: CreateLightTaskOptions,
  taskId: string,
  input: UpdateTaskInput,
): LightTaskTask {
  const publishEvent = resolveNotifyPublisher(options);
  const taskLifecycle = resolveTaskLifecyclePolicy(options);
  const getTask = requireLightTaskFunction(options.taskRepository?.get, "taskRepository.get");
  const saveIfRevisionMatches = requireLightTaskFunction(
    options.taskRepository?.saveIfRevisionMatches,
    "taskRepository.saveIfRevisionMatches",
  );
  const normalizedTaskId = assertTaskId(taskId);
  const storedTask = getTask(normalizedTaskId);

  if (!storedTask) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到任务", {
        taskId: normalizedTaskId,
      }),
    );
  }

  if (input.expectedRevision === undefined) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "expectedRevision 为必填字段", {
        taskId: normalizedTaskId,
      }),
    );
  }

  assertUpdatableFields(normalizedTaskId, input);
  assertExpectedRevision(storedTask.revision, input.expectedRevision);
  assertNextRevision(storedTask.revision, storedTask.revision + 1);

  const task = clonePersistedTask(storedTask);
  const nextTitle = hasOwnField(input, "title") ? input.title?.trim() : task.title;
  if (!nextTitle) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "任务标题不能为空", {
        title: input.title,
      }),
    );
  }

  const previousDesignStatus = resolveTaskDesignStatus(task.designStatus);
  const nextDesignStatus = hasOwnField(input, "designStatus")
    ? resolveExplicitTaskDesignStatus(normalizedTaskId, input.designStatus)
    : previousDesignStatus;
  const nextPlanId = resolveExplicitPlanId(task, input.planId);
  const nextRevision = bumpRevision(
    {
      revision: task.revision,
      updatedAt: task.updatedAt ?? task.createdAt,
      idempotencyKey: task.idempotencyKey,
    },
    options.clock?.now?.() ?? task.updatedAt ?? task.createdAt,
    task.idempotencyKey,
  );

  const nextTask: PersistedLightTask = {
    ...task,
    planId: nextPlanId,
    title: nextTitle,
    summary: hasOwnField(input, "summary")
      ? typeof input.summary === "string"
        ? input.summary.trim() || undefined
        : undefined
      : task.summary,
    designStatus: nextDesignStatus,
    executionStatus: resolveTaskExecutionStatus(task),
    metadata: hasOwnField(input, "metadata")
      ? cloneOptional(input.metadata ?? undefined)
      : task.metadata,
    extensions: hasOwnField(input, "extensions")
      ? cloneOptional(input.extensions ?? undefined)
      : task.extensions,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
  };

  syncTaskStepsForDesignStatus(
    nextTask,
    previousDesignStatus,
    nextDesignStatus,
    taskLifecycle.initialStatus,
  );

  const saved = saveIfRevisionMatches(nextTask, storedTask.revision);
  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicTask = toPublicTask(saved.task);
  publishTaskUpdatedEvent(publishEvent, publicTask);
  return publicTask;
}
