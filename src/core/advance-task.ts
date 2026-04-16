import { bumpRevision } from "../data-structures";
import { assertExpectedRevision, assertNextRevision, decideIdempotency } from "../rules";
import { resolveTaskLifecyclePolicy } from "./lifecycle-policy";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishTaskAdvancedEvent, resolveNotifyPublisher } from "./notify-event";
import { applyTaskStepProgress } from "./task-progress";
import { buildAdvanceFingerprint, clonePersistedTask, toPublicTask } from "./task-snapshot";
import type { AdvanceTaskInput, CreateLightTaskOptions, LightTaskTask } from "./types";

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

export function advanceTaskUseCase(
  options: CreateLightTaskOptions,
  taskId: string,
  input: AdvanceTaskInput,
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

  const task = clonePersistedTask(storedTask);
  if (input.expectedRevision === undefined) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "expectedRevision 为必填字段", {
        taskId: normalizedTaskId,
      }),
    );
  }

  if (task.designStatus !== "ready") {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "当前任务未处于 ready 设计态，不能推进执行状态", {
        taskId: normalizedTaskId,
        currentDesignStatus: task.designStatus,
      }),
    );
  }

  const action = input.action ?? taskLifecycle.selectDefaultAction(task.executionStatus);
  if (!action) {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "任务没有可推进的进行中阶段", {
        taskId: normalizedTaskId,
        currentStatus: task.executionStatus,
      }),
    );
  }

  const expectedRevision = input.expectedRevision;
  const incomingFingerprint = buildAdvanceFingerprint(task.id, action, expectedRevision);
  // 先判定幂等语义，再进入 revision 与状态迁移，避免重复请求污染状态。
  const idempotencyDecision = decideIdempotency({
    incomingIdempotencyKey: input.idempotencyKey,
    storedIdempotencyKey: task.idempotencyKey,
    incomingFingerprint,
    storedFingerprint: task.lastAdvanceFingerprint,
  });
  if (idempotencyDecision.decision === "conflict") {
    throwLightTaskError(
      idempotencyDecision.error ??
        createLightTaskError("STATE_CONFLICT", idempotencyDecision.reason, {
          taskId: normalizedTaskId,
        }),
    );
  }
  if (idempotencyDecision.decision === "replay") {
    return toPublicTask(task);
  }

  const nextRevision = bumpRevision(
    {
      revision: task.revision,
      updatedAt: task.updatedAt ?? task.createdAt,
      idempotencyKey: task.idempotencyKey,
    },
    options.clock?.now?.() ?? task.updatedAt ?? task.createdAt,
    input.idempotencyKey?.trim() || task.idempotencyKey,
  );
  assertExpectedRevision(task.revision, expectedRevision);
  assertNextRevision(task.revision, nextRevision.revision);

  const transition = taskLifecycle.transition(task.executionStatus, action);
  if (!transition.ok) {
    throwLightTaskError(transition.error);
  }

  task.executionStatus = transition.status;
  task.revision = nextRevision.revision;
  task.updatedAt = nextRevision.updatedAt;
  task.idempotencyKey = nextRevision.idempotencyKey;
  task.lastAdvanceFingerprint = incomingFingerprint;
  applyTaskStepProgress(task, action, taskLifecycle);

  const saved = saveIfRevisionMatches(task, storedTask.revision);
  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  // 保存成功后统一返回仓储权威快照，避免内存中间态与持久化结果漂移。
  const publicTask = toPublicTask(saved.task);
  publishTaskAdvancedEvent(publishEvent, publicTask);
  return publicTask;
}
