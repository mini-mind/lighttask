import { createTaskRecord } from "../data-structures";
import type { TaskStatus } from "../data-structures";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishTaskCreatedEvent, resolveNotifyPublisher } from "./notify-event";
import { assertTaskDependencies, normalizeDependsOnTaskIds } from "./task-dependency-snapshot";
import { resolveTaskLifecyclePolicy } from "./task-lifecycle";
import { normalizeDefinitionSteps, toPublicTask } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  CreateTaskInput,
  LightTaskTask,
  PersistedLightTask,
} from "./types";

function buildCreateTaskFingerprint(input: {
  planId: string;
  title: string;
  status?: TaskStatus;
  summary?: string;
  dependsOnTaskIds: string[];
  steps: unknown[];
  metadata?: Record<string, unknown>;
  extensions?: unknown;
}): string {
  return JSON.stringify(input);
}

export function createTaskUseCase(
  options: CreateLightTaskOptions,
  input: CreateTaskInput,
): LightTaskTask {
  const publishEvent = resolveNotifyPublisher(options);
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  const createTask = requireLightTaskFunction(
    options.taskRepository?.create,
    "taskRepository.create",
  );
  const taskLifecycle = resolveTaskLifecyclePolicy(options);
  const nextTaskId = requireLightTaskFunction(
    options.idGenerator?.nextTaskId,
    "idGenerator.nextTaskId",
  );
  const planId = input.planId.trim();
  const title = input.title.trim();
  const status = input.status ?? taskLifecycle.initialStatus;
  const dependsOnTaskIds = normalizeDependsOnTaskIds(input.dependsOnTaskIds);

  if (!planId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "planId 不能为空", { planId: input.planId }),
    );
  }
  if (!title) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "任务标题不能为空", { title: input.title }),
    );
  }
  if (status !== taskLifecycle.initialStatus) {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "createTask 初始状态只允许生命周期策略的初始状态", {
        status,
        initialStatus: taskLifecycle.initialStatus,
      }),
    );
  }
  if (!getPlan(planId)) {
    throwLightTaskError(createLightTaskError("NOT_FOUND", "未找到计划", { planId }));
  }

  const taskId = nextTaskId().trim();
  if (!taskId) {
    throwLightTaskError(
      createLightTaskError("INVARIANT_VIOLATION", "idGenerator.nextTaskId 返回了空白任务 ID"),
    );
  }

  const steps = normalizeDefinitionSteps(taskId, input.steps);
  const allTasks = listTasks();
  const planTasks = allTasks.filter((task) => task.planId === planId);
  assertTaskDependencies({
    taskId,
    planId,
    dependsOnTaskIds,
    allTasks,
  });

  const fingerprint = buildCreateTaskFingerprint({
    planId,
    title,
    status,
    summary: input.summary?.trim() || undefined,
    dependsOnTaskIds,
    steps,
    metadata: input.metadata,
    extensions: input.extensions,
  });
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  if (normalizedIdempotencyKey) {
    const replayed = planTasks.find((task) => task.idempotencyKey === normalizedIdempotencyKey);
    if (replayed) {
      if (replayed.lastCreateFingerprint === fingerprint) {
        return toPublicTask(replayed);
      }
      throwLightTaskError(
        createLightTaskError(
          "STATE_CONFLICT",
          "相同 idempotencyKey 对应的请求内容不一致，拒绝处理。",
          {
            idempotencyKey: normalizedIdempotencyKey,
            incomingFingerprint: fingerprint,
            storedFingerprint: replayed.lastCreateFingerprint,
          },
        ),
      );
    }
  }

  const task: PersistedLightTask = {
    ...createTaskRecord({
      id: taskId,
      planId,
      title,
      createdAt: clockNow(),
      status,
      summary: input.summary,
      dependsOnTaskIds,
      steps,
      metadata: input.metadata,
      extensions: input.extensions,
      idempotencyKey: normalizedIdempotencyKey,
    }),
    lastCreateFingerprint: fingerprint,
  };
  const created = createTask(task);
  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  const publicTask = toPublicTask(created.task);
  publishTaskCreatedEvent(publishEvent, publicTask);
  return publicTask;
}
