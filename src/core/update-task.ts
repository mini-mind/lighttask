import { bumpRevision } from "../data-structures";
import { assertExpectedRevision } from "../rules";
import { cloneOptional } from "./clone";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishTaskUpdatedEvent, resolveNotifyPublisher } from "./notify-event";
import { assertTaskDependencies, normalizeDependsOnTaskIds } from "./task-dependency-snapshot";
import { clonePersistedTask, normalizeDefinitionSteps, toPublicTask } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  LightTaskTask,
  PersistedLightTask,
  UpdateTaskInput,
} from "./types";

function hasOwnField(input: UpdateTaskInput, fieldName: keyof UpdateTaskInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, fieldName);
}

const FORBIDDEN_UPDATE_TASK_FIELDS = [
  "id",
  "planId",
  "status",
  "revision",
  "createdAt",
  "updatedAt",
] as const;

function buildUpdateTaskFingerprint(taskId: string, input: UpdateTaskInput): string {
  return JSON.stringify({
    taskId,
    title: hasOwnField(input, "title") ? (input.title ?? null) : undefined,
    summary: hasOwnField(input, "summary") ? (input.summary ?? null) : undefined,
    dependsOnTaskIds: hasOwnField(input, "dependsOnTaskIds")
      ? (input.dependsOnTaskIds ?? null)
      : undefined,
    steps: hasOwnField(input, "steps") ? (input.steps ?? null) : undefined,
    metadata: hasOwnField(input, "metadata") ? (input.metadata ?? null) : undefined,
    extensions: hasOwnField(input, "extensions") ? (input.extensions ?? null) : undefined,
  });
}

export function updateTaskUseCase(
  options: CreateLightTaskOptions,
  taskId: string,
  input: UpdateTaskInput,
): LightTaskTask {
  const publishEvent = resolveNotifyPublisher(options);
  const getTask = requireLightTaskFunction(options.taskRepository?.get, "taskRepository.get");
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  const saveIfRevisionMatches = requireLightTaskFunction(
    options.taskRepository?.saveIfRevisionMatches,
    "taskRepository.saveIfRevisionMatches",
  );
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    throwLightTaskError(createLightTaskError("VALIDATION_ERROR", "任务 ID 不能为空", { taskId }));
  }

  const storedTask = getTask(normalizedTaskId);
  if (!storedTask) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到任务", { taskId: normalizedTaskId }),
    );
  }
  const rawInput = input as unknown as Record<string, unknown>;
  const forbiddenFields = FORBIDDEN_UPDATE_TASK_FIELDS.filter((fieldName) =>
    Object.prototype.hasOwnProperty.call(rawInput, fieldName),
  );
  if (forbiddenFields.length > 0) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "updateTask 不允许直接修改系统字段", {
        taskId: normalizedTaskId,
        fields: forbiddenFields,
      }),
    );
  }
  if (storedTask.status !== "draft") {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "只有 draft 任务允许修改定义字段", {
        taskId: normalizedTaskId,
        currentStatus: storedTask.status,
      }),
    );
  }

  assertExpectedRevision(storedTask.revision, input.expectedRevision);
  const fingerprint = buildUpdateTaskFingerprint(normalizedTaskId, input);
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  if (input.idempotencyKey?.trim() && normalizedIdempotencyKey === storedTask.idempotencyKey) {
    if (storedTask.lastUpdateFingerprint === fingerprint) {
      return toPublicTask(storedTask);
    }
    if (storedTask.lastUpdateFingerprint !== undefined) {
      throwLightTaskError(
        createLightTaskError(
          "STATE_CONFLICT",
          "相同 idempotencyKey 对应的请求内容不一致，拒绝处理。",
          {
            idempotencyKey: normalizedIdempotencyKey,
            incomingFingerprint: fingerprint,
            storedFingerprint: storedTask.lastUpdateFingerprint,
          },
        ),
      );
    }
  }

  const nextTitle = hasOwnField(input, "title") ? input.title?.trim() : storedTask.title;
  if (!nextTitle) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "任务标题不能为空", { title: input.title }),
    );
  }
  const nextSummary = hasOwnField(input, "summary")
    ? input.summary?.trim() || undefined
    : storedTask.summary;
  const nextDependsOnTaskIds = hasOwnField(input, "dependsOnTaskIds")
    ? normalizeDependsOnTaskIds(input.dependsOnTaskIds)
    : storedTask.dependsOnTaskIds;
  const nextSteps = hasOwnField(input, "steps")
    ? normalizeDefinitionSteps(normalizedTaskId, input.steps)
    : storedTask.steps;

  const allTasks = listTasks().map((task) => clonePersistedTask(task));
  assertTaskDependencies({
    taskId: storedTask.id,
    planId: storedTask.planId,
    dependsOnTaskIds: nextDependsOnTaskIds,
    allTasks: allTasks.map((task) =>
      task.id === storedTask.id
        ? {
            ...clonePersistedTask(storedTask),
            dependsOnTaskIds: nextDependsOnTaskIds,
          }
        : task,
    ),
  });

  const nextRevision = bumpRevision(storedTask, clockNow(), normalizedIdempotencyKey);
  const nextTask: PersistedLightTask = {
    ...clonePersistedTask(storedTask),
    title: nextTitle,
    summary: nextSummary,
    dependsOnTaskIds: nextDependsOnTaskIds,
    steps: nextSteps,
    metadata: hasOwnField(input, "metadata")
      ? cloneOptional(input.metadata ?? undefined)
      : storedTask.metadata,
    extensions: hasOwnField(input, "extensions")
      ? cloneOptional(input.extensions ?? undefined)
      : storedTask.extensions,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
    lastUpdateFingerprint: fingerprint,
  };

  const saved = saveIfRevisionMatches(nextTask, storedTask.revision);
  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicTask = toPublicTask(saved.task);
  publishTaskUpdatedEvent(publishEvent, publicTask);
  return publicTask;
}
