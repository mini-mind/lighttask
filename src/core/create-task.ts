import { isTaskDesignStatus } from "../data-structures";
import { cloneOptional } from "./clone";
import { resolveTaskLifecyclePolicy } from "./lifecycle-policy";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishTaskCreatedEvent, resolveNotifyPublisher } from "./notify-event";
import { createDefaultTaskSteps, resolveTaskDesignStatus, toPublicTask } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  CreateTaskInput,
  LightTaskTask,
  PersistedLightTask,
  TaskDesignStatus,
} from "./types";

function resolveOptionalPlanId(planId: string | undefined): string | undefined {
  const normalizedPlanId = planId?.trim();
  return normalizedPlanId || undefined;
}

function assertTaskDesignStatus(designStatus: string | undefined): TaskDesignStatus | undefined {
  const normalizedDesignStatus = designStatus?.trim();
  if (!normalizedDesignStatus) {
    return undefined;
  }

  if (!isTaskDesignStatus(normalizedDesignStatus)) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "designStatus 仅支持 draft 或 ready", {
        designStatus,
        supportedDesignStatuses: ["draft", "ready"],
      }),
    );
  }

  return normalizedDesignStatus;
}

export function createTaskUseCase(
  options: CreateLightTaskOptions,
  input: CreateTaskInput,
): LightTaskTask {
  const publishEvent = resolveNotifyPublisher(options);
  const taskLifecycle = resolveTaskLifecyclePolicy(options);
  const nextTaskId = requireLightTaskFunction(
    options.idGenerator?.nextTaskId,
    "idGenerator.nextTaskId",
  );
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const createTask = requireLightTaskFunction(
    options.taskRepository?.create,
    "taskRepository.create",
  );
  const taskId = nextTaskId().trim();
  const now = clockNow();
  const title = input.title.trim();
  const summary = input.summary?.trim() || undefined;
  const planId = resolveOptionalPlanId(input.planId);
  const designStatus = resolveTaskDesignStatus(assertTaskDesignStatus(input.designStatus));

  if (!taskId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "任务 ID 不能为空", {
        taskId,
      }),
    );
  }

  if (!title) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "任务标题不能为空", {
        title: input.title,
      }),
    );
  }

  if (input.planId !== undefined && !planId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "planId 不能为空", {
        planId: input.planId,
      }),
    );
  }

  const task: PersistedLightTask = {
    id: taskId,
    planId,
    title,
    summary,
    designStatus,
    executionStatus: taskLifecycle.initialStatus,
    revision: 1,
    idempotencyKey: undefined,
    createdAt: now,
    updatedAt: now,
    steps: createDefaultTaskSteps(taskId, designStatus),
    metadata: cloneOptional(input.metadata),
    extensions: cloneOptional(input.extensions),
  };

  const created = createTask(task);
  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  // 以仓储返回的快照为准，避免持久化层规范化后的结果无法反映到 API 返回值。
  const publicTask = toPublicTask(created.task);
  publishTaskCreatedEvent(publishEvent, publicTask);
  return publicTask;
}
