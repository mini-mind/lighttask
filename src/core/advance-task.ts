import { bumpRevision } from "../data-structures";
import { decideIdempotency } from "../rules";
import { assertExpectedRevision } from "../rules";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishTaskAdvancedEvent, resolveNotifyPublisher } from "./notify-event";
import { buildPlanSchedulingFacts } from "./task-dependency-snapshot";
import { requireTaskStatusDefinition, resolveTaskLifecyclePolicy } from "./task-lifecycle";
import { applyTaskStepProgress } from "./task-progress";
import { clonePersistedTask, toPublicTask } from "./task-snapshot";
import type {
  AdvanceTaskInput,
  CreateLightTaskOptions,
  LightTaskTask,
  PersistedLightTask,
} from "./types";

function buildAdvanceTaskFingerprint(taskId: string, input: AdvanceTaskInput): string {
  return JSON.stringify({
    taskId,
    action: input.action,
    expectedRevision: input.expectedRevision,
  });
}

function assertTaskActionAllowed(
  options: CreateLightTaskOptions,
  task: PersistedLightTask,
  input: AdvanceTaskInput,
  allTasks: PersistedLightTask[],
): void {
  const taskLifecycle = resolveTaskLifecyclePolicy(options);
  if (taskLifecycle.requiresRunnable(input.action)) {
    const facts = buildPlanSchedulingFacts(task.planId, allTasks, taskLifecycle);
    if (!facts.byTaskId[task.id]?.isRunnable) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "当前动作只允许推进 runnable 任务", {
          taskId: task.id,
          currentStatus: task.status,
          action: input.action,
          blockReasonCodes: facts.byTaskId[task.id]?.blockReasonCodes ?? [],
        }),
      );
    }
  }
}

export function advanceTaskUseCase(
  options: CreateLightTaskOptions,
  taskId: string,
  input: AdvanceTaskInput,
): LightTaskTask {
  const publishEvent = resolveNotifyPublisher(options);
  const taskLifecycle = resolveTaskLifecyclePolicy(options);
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

  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  const fingerprint = buildAdvanceTaskFingerprint(normalizedTaskId, input);
  const idempotencyDecision = decideIdempotency({
    incomingIdempotencyKey: normalizedIdempotencyKey,
    storedIdempotencyKey: storedTask.idempotencyKey,
    incomingFingerprint: fingerprint,
    storedFingerprint: storedTask.lastAdvanceFingerprint,
  });
  if (idempotencyDecision.decision === "replay") {
    return toPublicTask(storedTask);
  }
  if (idempotencyDecision.decision === "conflict" && idempotencyDecision.error) {
    throwLightTaskError(idempotencyDecision.error);
  }

  assertExpectedRevision(storedTask.revision, input.expectedRevision);
  assertTaskActionAllowed(options, storedTask, input, listTasks());
  requireTaskStatusDefinition(taskLifecycle, storedTask.status, {
    taskId: storedTask.id,
  });

  const transition = taskLifecycle.transition(storedTask.status, input.action);
  if (!transition.ok) {
    throwLightTaskError(transition.error);
  }
  transition.hooks?.apply?.({
    currentStatus: storedTask.status,
    action: input.action,
    nextStatus: transition.status,
  });

  const nextRevision = bumpRevision(storedTask, clockNow(), normalizedIdempotencyKey);
  const nextTask: PersistedLightTask = {
    ...clonePersistedTask(storedTask),
    status: transition.status,
    steps: applyTaskStepProgress(storedTask.steps, taskLifecycle.resolveStepProgress(input.action)),
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
    lastAdvanceFingerprint: fingerprint,
  };
  const saved = saveIfRevisionMatches(nextTask, storedTask.revision);
  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicTask = toPublicTask(saved.task);
  transition.hooks?.notify?.({
    currentStatus: storedTask.status,
    action: input.action,
    nextStatus: transition.status,
  });
  publishTaskAdvancedEvent(publishEvent, publicTask);
  return publicTask;
}
